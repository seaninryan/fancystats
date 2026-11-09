// test/seasons.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setAdjustment, setAbsence, setPlayerField, migrateSeasons, startNewSeason, playerTotals, leagueTable } from "../src/lib/store.js";
import { seasonView, guestTeams, seasonList, previousSeasonId, previousSeasonTotals } from "../src/lib/seasons.js";

const NOW = 1765000000000;
const TEAMS = [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }];
const app = (eventId, playerId, goals) => ({ eventId, playerId, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 });
const match = (eventId, round, homeScore) => ({ eventId, round, kickoff: NOW - 1e9 + eventId, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore, awayScore: 0, goalTimes: { home: Array(homeScore).fill(10), away: [] }, partial: false });

// 2026: event 100 (Keena 2 goals). Rollover. 2027: event 200 (Keena 1 goal).
function twoSeasons() {
  let d = migrateSeasons(emptyData());
  d = applyImport(d, { match: match(100, 1, 2), teams: TEAMS, players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app(100, 10, 2)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  d = setPlayerField(d, 10, "price", 7.5);
  d = setAdjustment(d, "100:10", { goals: 0, assists: 1, note: "x" });
  d = setAbsence(d, 100, 10, "old knock", NOW);
  d = startNewSeason(d, { seasonId: 99999, label: "2027" });
  d = applyImport(d, { match: match(200, 1, 1), teams: TEAMS, players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app(200, 10, 1)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "MID");
  return d;
}

describe("seasonView", () => {
  it("keeps only the requested season's matches, appearances, adjustments, absences", () => {
    const d = twoSeasons();
    const old = seasonView(d, 87682);
    expect(Object.keys(old.matches)).toEqual(["100"]);
    expect(Object.keys(old.appearances)).toEqual(["100:10"]);
    expect(Object.keys(old.adjustments)).toEqual(["100:10"]);
    expect(Object.keys(old.absences)).toEqual(["100:10"]);
    const cur = seasonView(d, 99999);
    expect(Object.keys(cur.matches)).toEqual(["200"]);
    expect(Object.keys(cur.adjustments)).toEqual([]);
  });
  it("restores archived fantasy fields for a past season, live ones for the current", () => {
    const d = twoSeasons();
    expect(seasonView(d, 87682).players["10"]).toMatchObject({ gamePosition: "FWD", price: 7.5 });
    expect(seasonView(d, 99999).players["10"]).toMatchObject({ gamePosition: "MID", price: null });
  });
  it("nulls fantasy fields of players with no archive entry in a past season", () => {
    let d = twoSeasons();
    d = applyImport(d, { match: match(201, 2, 0), teams: TEAMS, players: [{ id: 77, name: "New Guy", teamId: 1 }], appearances: [app(201, 77, 0)] }, NOW);
    d = setPlayerField(d, 77, "gamePosition", "DEF");
    d = setPlayerField(d, 77, "price", 5);
    expect(seasonView(d, 87682).players["77"]).toMatchObject({ gamePosition: null, price: null, inSquad: false });
  });
  it("derivations on a view only see that season", () => {
    const d = twoSeasons();
    expect(playerTotals(seasonView(d, 87682), 10).goals).toBe(2);
    expect(playerTotals(seasonView(d, 99999), 10).goals).toBe(1);
    const rovers = leagueTable(seasonView(d, 99999)).find((r) => String(r.teamId) === "1");
    expect(rovers.played).toBe(1);
  });
  it("does not mutate its input", () => {
    const d = twoSeasons();
    const snap = structuredClone(d);
    seasonView(d, 87682);
    expect(d).toEqual(snap);
  });
});

describe("seasonList / previousSeasonId", () => {
  it("lists seasons newest first with the current flagged", () => {
    expect(seasonList(twoSeasons())).toEqual([
      { seasonId: 99999, label: "2027", current: true },
      { seasonId: 87682, label: "2026", current: false },
    ]);
  });
  it("previousSeasonId is the newest non-current season, else null", () => {
    expect(previousSeasonId(twoSeasons())).toBe(87682);
    expect(previousSeasonId(migrateSeasons(emptyData()))).toBeNull();
  });
});

describe("previousSeasonTotals", () => {
  it("returns last season's label and totals scored at last season's position", () => {
    const t = previousSeasonTotals(twoSeasons(), 10);
    expect(t).toMatchObject({ seasonId: 87682, label: "2026", apps: 1, goals: 2, assists: 1, minutes: 90 });
    expect(t.points).toBeGreaterThan(0);
  });
  it("null without a previous season or without appearances in it", () => {
    expect(previousSeasonTotals(migrateSeasons(emptyData()), 10)).toBeNull();
    let d = twoSeasons();
    d = applyImport(d, { match: match(201, 2, 0), teams: TEAMS, players: [{ id: 77, name: "New Guy", teamId: 1 }], appearances: [app(201, 77, 0)] }, NOW);
    expect(previousSeasonTotals(d, 77)).toBeNull();
  });
  it("points is null when the player had no fantasy position that season", () => {
    let d = migrateSeasons(emptyData());
    d = applyImport(d, { match: match(100, 1, 1), teams: TEAMS, players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app(100, 10, 1)] }, NOW);
    d = startNewSeason(d, { seasonId: 99999, label: "2027" });
    const t = previousSeasonTotals(d, 10);
    expect(t).toMatchObject({ apps: 1, goals: 1 });
    expect(t.points).toBeNull();
  });
});

describe("guest clubs (end-of-season playoffs)", () => {
  const T = [1, 2, 3, 4].map((id) => ({ id, name: `Club ${id}`, shortName: `C${id}` }));
  const m = (eventId, h, a) => ({ eventId, round: 1, kickoff: NOW - 1e9 + eventId, status: "finished", homeTeamId: h, awayTeamId: a, homeScore: 0, awayScore: 0, goalTimes: { home: [], away: [] }, partial: false });
  const a = (eventId, playerId, teamId) => ({ ...app(eventId, playerId, 0), teamId });
  function season() {
    let d = migrateSeasons(emptyData());
    for (let i = 0; i < 10; i++) {
      d = applyImport(d, { match: m(300 + i, 1, 2), teams: T, players: [{ id: 11, name: "Home P", teamId: 1 }], appearances: [a(300 + i, 11, 1)] }, NOW);
    }
    // Playoff: club 2 v guest club 3; player 33 is a guest; player 12 (club 2) plays it too.
    d = applyImport(d, { match: m(400, 2, 3), teams: T, players: [{ id: 33, name: "Guest", teamId: 3 }, { id: 12, name: "Two", teamId: 2 }], appearances: [a(400, 33, 3), a(400, 12, 2)] }, NOW);
    return d;
  }
  it("a club with under a quarter of the busiest club's matches is a guest", () => {
    const d = season();
    expect([...guestTeams(d.matches)]).toEqual([3]);
    expect(guestTeams({ 1: m(1, 1, 2), 2: m(2, 2, 3) }).size).toBe(0); // too early to judge
  });
  it("the view drops guest matches, their appearances, the guest club and its players", () => {
    const v = seasonView(season(), 87682);
    expect(Object.keys(v.matches)).not.toContain("400");
    expect(Object.keys(v.appearances).some((k) => k.startsWith("400:"))).toBe(false);
    expect(v.teams["3"]).toBeUndefined();
    expect(v.players["33"]).toBeUndefined();
    expect(v.players["11"]).toBeDefined();
    expect(v.players["12"]).toBeDefined(); // a league club's player stays
    expect(leagueTable(v).map((r) => r.teamId).sort()).toEqual([1, 2]);
  });
});
