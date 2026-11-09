// test/sitePoints.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setPlayerField, setMatchRound, setAdjustment, applySiteSync, playerTotals, leagueTable, allMatchTeamPoints, hotEventIds, mismatchInfo } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { playerWeeklySeries, teamWeeklySeries } from "../src/lib/series.js";
import { siteIndex, appearancePoints, diffComponents, unresolvedSummary } from "../src/lib/sitePoints.js";

const NOW = 1765000000000;
const TEAMS = [
  { id: 1, name: "Shamrock Rovers", shortName: "SRO" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
  { id: 3, name: "Derry City", shortName: "DER" },
];
const CLUBS = [{ id: "c1", name: "Shamrock Rovers" }, { id: "c2", name: "Bohemians" }, { id: "c3", name: "Derry City" }];
const app = (eventId, playerId, teamId, extra = {}) => ({
  eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F",
  goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...extra,
});
const match = (eventId, round, home, away, hs, as) => ({
  eventId, round, kickoff: NOW - 1e7 + eventId, status: "finished", homeTeamId: home, awayTeamId: away,
  homeScore: hs, awayScore: as, goalTimes: { home: Array(hs).fill(10), away: Array(as).fill(20) }, partial: false,
});
const imp = (d, m, apps, players = [{ id: 10, name: "A Keena", teamId: 1 }, { id: 11, name: "B Burke", teamId: 1 }]) =>
  applyImport(d, { match: m, teams: TEAMS, players, appearances: apps }, NOW);

// R1: SRO 1-0 BOH (Keena scores). R2: DER 0-0 SRO. R3: SRO 2-1 BOH (only Burke plays).
function base() {
  let d = emptyData();
  d = imp(d, match(100, 1, 1, 2, 1, 0), [app(100, 10, 1, { goals: 1 })]);
  d = imp(d, match(101, 2, 3, 1, 0, 0), [app(101, 10, 1)]);
  d = imp(d, match(103, 3, 1, 2, 2, 1), [app(103, 11, 1)]);
  return setPlayerField(d, 10, "gamePosition", "FWD");
}
const FT_WIN_GOAL_ASSIST = [["Appearance", "Full Game", 3], ["Team Result", "Win", 2], ["Goals", "1", 4], ["Assists", "1", 3]];
const sync = (d, history) =>
  applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: CLUBS, players: [], history, myTeam: {} },
    [{ playerId: "10", siteId: 501 }], NOW);
const view = (d) => seasonView(d, d.meta.seasonId);

describe("siteIndex + appearancePoints", () => {
  it("site total wins over our scoring", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    const r = appearancePoints(v, v.appearances["100:10"]);
    expect(r).toMatchObject({ total: 12, source: "site" });
    expect(r.ours.total).toBe(9); // FWD: full game 3 + win 2 + goal 4
  });
  it("falls back to our scoring where the site has nothing", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    expect(appearancePoints(v, v.appearances["101:10"])).toMatchObject({ total: 4, source: "ours", site: null });
  });
  it("ignores crest order and a repeated current-club crest", () => {
    const v = view(sync(base(), { "501": [[2, "c1", "c1", 7, [["Appearance", "Full Game", 3]]]] }));
    expect(appearancePoints(v, v.appearances["101:10"]).total).toBe(7);
  });
  it("splits a double gameweek by the clubs in each block", () => {
    let d = imp(base(), match(102, 1, 1, 3, 0, 0), [app(102, 10, 1)]);
    d = sync(d, { "501": [[1, "c2", "c1", 12, FT_WIN_GOAL_ASSIST], [1, "c3", "c1", 5, [["Appearance", "Full Game", 3]]]] });
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"]).total).toBe(12);
    expect(appearancePoints(v, v.appearances["102:10"]).total).toBe(5);
  });
  it("a round override re-points a site gameweek", () => {
    let d = sync(base(), { "501": [[5, "c3", "c1", 7, [["Appearance", "Full Game", 3]]]] });
    expect(siteIndex(view(d)).unresolved).toEqual([{ playerId: "10", siteId: 501, gw: 5, total: 7, reason: "no-match" }]);
    d = setMatchRound(d, 101, 5);
    const v = view(d);
    expect(siteIndex(v).unresolved).toEqual([]);
    expect(appearancePoints(v, v.appearances["101:10"]).total).toBe(7);
  });
  it("lists a site appearance SofaScore doesn't have", () => {
    const v = view(sync(base(), { "501": [[3, "c1", "c2", 3, [["Appearance", "Sub", 1], ["Team Result", "Win", 2]]]] }));
    expect(siteIndex(v).unresolved).toEqual([{ playerId: "10", siteId: 501, gw: 3, total: 3, reason: "no-appearance" }]);
  });
  it("a Didn't Play block zeroes an appearance we have, and is otherwise ignored", () => {
    const dnp = [["Appearance", "Didn't Play", 0], ["Team Result", "N/A", 0]];
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 0, dnp], [3, "c1", "c2", 0, dnp], [9, "c1", "c2", 0, dnp]] }));
    expect(appearancePoints(v, v.appearances["100:10"])).toMatchObject({ total: 0, source: "site" });
    expect(siteIndex(v).unresolved).toEqual([]);
  });
  it("site points apply without a game position", () => {
    let d = sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    d = setPlayerField(d, 10, "gamePosition", null);
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"])).toMatchObject({ total: 12, source: "site", ours: null });
    expect(appearancePoints(v, v.appearances["101:10"])).toMatchObject({ total: null, source: null });
  });
  it("an explicit position (what-if) always uses our scoring", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    expect(appearancePoints(v, v.appearances["100:10"], { position: "MID" })).toMatchObject({ total: 10, source: "ours" });
  });
  it("a user adjustment does not override the site", () => {
    let d = setAdjustment(base(), "100:10", { assists: 1, note: "won pen" });
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"]).total).toBe(12);
  });
  it("raw (non-view) data never uses site points", () => {
    const d = sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    expect(appearancePoints(d, d.appearances["100:10"])).toMatchObject({ total: 9, source: "ours" });
  });
});

describe("diffComponents", () => {
  it("names the components that differ", () => {
    expect(diffComponents(FT_WIN_GOAL_ASSIST, [["fullMatch", 3], ["win", 2], ["goals", 4]])).toEqual(["assists"]);
    expect(diffComponents([["Appearance", "Started", 2], ["Clean Sheet", "No", 0]], [["startedSubbedOff", 2], ["cleanSheet", 2]]))
      .toEqual(["clean sheet"]);
    expect(diffComponents([["Yellow Cards", "2", -3]], [["yellow", -1], ["secondYellow", -2]])).toEqual([]);
  });
});

describe("unresolvedSummary", () => {
  it("groups unresolved blocks by gameweek and reason with player names", () => {
    const d = sync(base(), { "501": [[5, "c3", "c1", 7, [["Appearance", "Full Game", 3]]], [3, "c1", "c2", 3, [["Appearance", "Sub", 1]]]] });
    expect(unresolvedSummary(view(d))).toEqual([
      { gw: 3, reason: "no-appearance", count: 1, names: ["A Keena"] },
      { gw: 5, reason: "no-match", count: 1, names: ["A Keena"] },
    ]);
  });
});

describe("derivations use site points", () => {
  const synced = () => view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
  it("playerTotals: site 12 for R1 + ours 4 for R2", () => {
    expect(playerTotals(synced(), "10").points).toBe(16);
  });
  it("leagueTable fantasy and allMatchTeamPoints", () => {
    const v = synced();
    expect(leagueTable(v).find((r) => r.teamId === 1).fantasy).toBe(16); // Burke has no position -> nothing
    expect(allMatchTeamPoints(v).get(100)).toEqual({ home: 12, away: 0 });
  });
  it("series: player and team fantasy per gameweek", () => {
    const v = synced();
    expect(playerWeeklySeries(v, "10", "fantasy").find((p) => p.round === 1).value).toBe(12);
    expect(teamWeeklySeries(v, 1, "fantasy").find((p) => p.round === 1).value).toBe(12);
  });
  it("hotEventIds scores with site points", () => {
    let d = imp(base(), match(103, 3, 1, 2, 2, 1), [app(103, 10, 1), app(103, 11, 1)]);
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST], [2, "c3", "c1", 12, FT_WIN_GOAL_ASSIST], [3, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    expect(hotEventIds(view(d), "10").size).toBeGreaterThan(0);
  });
  it("mismatchInfo compares our scoring on both sides", () => {
    let d = setPlayerField(base(), 10, "realPosition", "MID");
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    // ours FWD (9 + 4) vs ours MID (10 + 4): delta -1, the site's 12 plays no part
    expect(mismatchInfo(view(d), "10")).toEqual({ realPosition: "MID", delta: -1 });
  });
});
