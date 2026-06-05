import { describe, it, expect } from "vitest";
import { fetchJson, fetchSeasonEvents, importMatch, API } from "../src/lib/sofascore.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

// Stub fetcher: map of url-suffix -> {status, body}; records calls.
function stub(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const { status = 200, body } = hit[1];
    return { ok: status < 400, status, json: async () => body };
  };
  f.calls = calls;
  return f;
}

describe("fetchJson", () => {
  it("returns parsed body on 200", async () => {
    const f = stub({ "/event/1": { body: { a: 1 } } });
    expect(await fetchJson("/event/1", f)).toEqual({ a: 1 });
    expect(f.calls[0]).toBe(API + "/event/1");
  });
  it("throws with status on failure", async () => {
    const f = stub({ "/event/1": { status: 403, body: {} } });
    await expect(fetchJson("/event/1", f)).rejects.toThrow("403");
  });
  it("suppresses the Referer header (SofaScore 403s github.io referrers)", async () => {
    let seenOpts;
    const f = async (url, opts) => { seenOpts = opts; return { ok: true, status: 200, json: async () => ({}) }; };
    await fetchJson("/x", f);
    expect(seenOpts?.referrerPolicy).toBe("no-referrer");
  });
});

describe("fetchSeasonEvents", () => {
  const meta = { tournamentId: 192, seasonId: 87682 };
  const ev = (id, ts) => ({
    id, startTimestamp: ts, status: { type: "finished" }, roundInfo: { round: 1 },
    homeTeam: { id: 1, name: "Shamrock Rovers", nameCode: "SRO" },
    awayTeam: { id: 2, name: "Bohemians", nameCode: "BOH" },
    homeScore: { current: 1 }, awayScore: { current: 0 },
  });
  it("walks past and upcoming pages and returns stubs + teams", async () => {
    const f = stub({
      "/unique-tournament/192/season/87682/events/last/0": { body: { events: [ev(11, 100)], hasNextPage: true } },
      "/unique-tournament/192/season/87682/events/last/1": { body: { events: [ev(12, 200)], hasNextPage: false } },
      "/unique-tournament/192/season/87682/events/next/0": { body: { events: [ev(13, 300)], hasNextPage: false } },
    });
    const { stubs, teams } = await fetchSeasonEvents(meta, f);
    expect(stubs.map((s) => s.eventId).sort()).toEqual([11, 12, 13]);
    expect(stubs[0]).toMatchObject({ round: 1, homeTeamId: 1, awayTeamId: 2 });
    expect(teams.find((t) => t.id === 2).shortName).toBe("BOH");
  });
  it("tolerates a 404 on the upcoming feed (end of season)", async () => {
    const f = stub({
      "/unique-tournament/192/season/87682/events/last/0": { body: { events: [ev(11, 100)], hasNextPage: false } },
      "/unique-tournament/192/season/87682/events/next/0": { status: 404, body: {} },
    });
    const { stubs } = await fetchSeasonEvents(meta, f);
    expect(stubs).toHaveLength(1);
  });
  it("stops after one page when hasNextPage is absent (treated as last page)", async () => {
    const f = stub({
      "/unique-tournament/192/season/87682/events/last/0": { body: { events: [ev(11, 100)] } },
      "/unique-tournament/192/season/87682/events/next/0": { status: 404, body: {} },
    });
    const { stubs } = await fetchSeasonEvents(meta, f);
    expect(stubs).toHaveLength(1);
    expect(f.calls.filter((u) => u.includes("/last/"))).toHaveLength(1);
  });
});

describe("importMatch", () => {
  it("fetches event+lineups+incidents and returns normalized result", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { body: lineups },
      "/event/555/incidents": { body: incidents },
    });
    const res = await importMatch(555, f);
    expect(res.match.partial).toBe(false);
    expect(res.appearances.length).toBeGreaterThan(0);
  });
  it("survives lineups 404 as a partial import", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { status: 404, body: {} },
      "/event/555/incidents": { body: incidents },
    });
    const res = await importMatch(555, f);
    expect(res.match.partial).toBe(true);
    expect(res.appearances).toEqual([]);
  });
  it("propagates event fetch failure", async () => {
    const f = stub({ "/event/555": { status: 403, body: {} } });
    await expect(importMatch(555, f)).rejects.toThrow("403");
  });
  it("propagates non-404 lineups failure (rate limit must not fake a partial import)", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { status: 403, body: {} },
      "/event/555/incidents": { body: incidents },
    });
    await expect(importMatch(555, f)).rejects.toThrow("403");
  });
  it("incidents 404 still imports with empty incidents", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { body: lineups },
      // incidents route unmatched -> stub returns 404
    });
    const res = await importMatch(555, f);
    expect(res.match.partial).toBe(false);
    expect(res.appearances.length).toBeGreaterThan(0);
    expect(res.match.goalTimes).toEqual({ home: [], away: [] });
  });
});
