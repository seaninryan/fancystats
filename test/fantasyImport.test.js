import { describe, it, expect } from "vitest";
import { parseFantasyBlob } from "../src/lib/fantasyImport.js";

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
});
