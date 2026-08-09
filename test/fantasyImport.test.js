import { describe, it, expect } from "vitest";
import { parseFantasyBlob, mapClubs, withTeamIds, buildFantasySnippet } from "../src/lib/fantasyImport.js";

const goodBlob = () => ({
  meta: { source: "fantasyloi", capturedAt: 1770000000000, clubs: [{ id: "14420", name: "Bohemians" }] },
  players: [
    { name: "Colm Whelan", clubId: "14420", position: "FWD", price: 8.3, sitePoints: 137 },
    { name: "Sam Todd", clubId: "14420", position: "DEF", price: 5.5, sitePoints: 61 },
  ],
});

describe("parseFantasyBlob", () => {
  it("accepts a JSON string and normalizes rows", () => {
    const { clubs, players } = parseFantasyBlob(JSON.stringify(goodBlob()));
    expect(clubs).toEqual([{ id: "14420", name: "Bohemians" }]);
    expect(players[0]).toEqual({
      name: "Colm Whelan", clubId: "14420", gamePosition: "FWD", price: 8.3, sitePoints: 137,
    });
  });
  it("accepts an already-parsed object", () => {
    expect(parseFantasyBlob(goodBlob()).players).toHaveLength(2);
  });
  it("coerces a numeric clubId to a string and nulls an unknown position", () => {
    const blob = goodBlob();
    blob.players = [{ name: "X Y", clubId: 14420, position: "Sweeper", price: null, sitePoints: 0 }];
    expect(parseFantasyBlob(blob).players[0]).toEqual({
      name: "X Y", clubId: "14420", gamePosition: null, price: null, sitePoints: 0,
    });
  });
  it("drops rows with no name", () => {
    const blob = goodBlob();
    blob.players.push({ name: "  ", price: 1 });
    expect(parseFantasyBlob(blob).players).toHaveLength(2);
  });
  it("rejects unparseable text", () => {
    expect(() => parseFantasyBlob("not json")).toThrow(/Couldn't parse/);
  });
  it("rejects a blob from somewhere else", () => {
    expect(() => parseFantasyBlob({ meta: { source: "sofascore" }, players: [{ name: "A" }] }))
      .toThrow(/not a Fantasy LOI capture/);
  });
  it("rejects an empty capture", () => {
    expect(() => parseFantasyBlob({ meta: { source: "fantasyloi" }, players: [] }))
      .toThrow(/No players/);
  });
  it("accepts numeric strings and rejects junk, keeping 0 distinct from empty", () => {
    const blob = goodBlob();
    blob.players = [
      { name: "A", price: "8.3", sitePoints: "137" },
      { name: "B", price: "", sitePoints: 0 },
      { name: "C", price: "n/a", sitePoints: NaN },
    ];
    const rows = parseFantasyBlob(blob).players;
    expect(rows[0]).toMatchObject({ price: 8.3, sitePoints: 137 });
    expect(rows[1]).toMatchObject({ price: null, sitePoints: 0 });
    expect(rows[2]).toMatchObject({ price: null, sitePoints: null });
  });
});

describe("mapClubs", () => {
  const teams = {
    1: { name: "Bohemians", shortName: "BOH" },
    2: { name: "St. Patrick's Athletic", shortName: "STP" },
    3: { name: "Shamrock Rovers", shortName: "SRO" },
  };
  const clubs = [
    { id: "14420", name: "Bohemians" },
    { id: "55386", name: "St Patricks Athletic" },
    { id: "99999", name: "Cork City" },
  ];
  it("auto-resolves across punctuation drift", () => {
    const m = mapClubs(clubs, teams);
    expect(m["14420"]).toBe("1");
    expect(m["55386"]).toBe("2"); // "St Patricks Athletic" vs "St. Patrick's Athletic"
  });
  it("leaves an unknown club unresolved rather than guessing", () => {
    expect(mapClubs(clubs, teams)["99999"]).toBe(null);
  });
  it("a stored override wins over auto-resolution", () => {
    expect(mapClubs(clubs, teams, { 14420: "3" })["14420"]).toBe("3");
  });
  it("handles missing clubs/teams without throwing", () => {
    expect(mapClubs(undefined, undefined)).toEqual({});
  });
});

describe("withTeamIds", () => {
  it("attaches the resolved teamId, null when unresolved", () => {
    const players = [
      { name: "A", clubId: "14420" },
      { name: "B", clubId: "99999" },
      { name: "C", clubId: null },
    ];
    const rows = withTeamIds(players, { 14420: "1", 99999: null });
    expect(rows.map((r) => r.teamId)).toEqual(["1", null, null]);
    expect(rows[0].name).toBe("A"); // other fields survive
  });
});

describe("buildFantasySnippet", () => {
  const snip = buildFantasySnippet();
  it("posts the site's own search form", () => {
    expect(snip).toContain("/Stats/PlayerStats");
    expect(snip).toContain("__RequestVerificationToken");
    expect(snip).toContain('method: "POST"');
    expect(snip).toContain('credentials: "include"');
    expect(snip).toContain("table.table tbody tr"); // scoped to the results table, not any table on the page
  });
  it("runs both statistic passes and every position", () => {
    expect(snip).toContain('"Value"');
    expect(snip).toContain('"Total Score"');
    for (const p of ["Goalkeeper", "Defender", "Midfielder", "Forward"]) expect(snip).toContain(p);
  });
  it("guards the host and the logged-out case", () => {
    expect(snip).toContain("fantasyloi.leagueofireland.ie");
    expect(snip).toContain("logged in");
  });
  it("stashes the blob for copying, with a runnable fallback", () => {
    expect(snip).toContain("fancystatsFantasyBlob");
    expect(snip).toContain("navigator.clipboard.writeText");
    expect(snip).toContain("copy(fancystatsFantasyBlob)");
    expect(snip).toContain('"fantasyloi"'); // meta.source the app validates
  });
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(snip)).not.toThrow();
  });
});
