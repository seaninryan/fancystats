import { describe, it, expect } from "vitest";
import { emptyData, applyImport, upsertMatchStubs, applySiteSync, setPlayerField, markOut } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { suggestionContext, playerOutlook, mySquad, sellCandidates, buyTargets, fixtureRuns, FORM_WINDOW } from "../src/lib/suggestions.js";

const NOW = 1765000000000;
const DAY = 86400000;
const TEAMS = [1, 2, 3, 4].map((id) => ({ id, name: `Club ${id}`, shortName: `C${id}` }));
// Player 10 (club 1) and 11 (club 1) and 20 (club 2), 30 (club 3), 40 (club 4).
const PLAYERS = [[10, 1], [11, 1], [20, 2], [30, 3], [40, 4]].map(([id, teamId]) => ({ id, name: `P${id}`, teamId }));

// Played rounds 1..6: club 1 beats everyone, club 4 loses to everyone. Player 10 scores in
// every club-1 match; 11 plays only some; 20/30/40 play every match.
const PAIRS = [[1, 2, 3, 4], [1, 3, 2, 4], [1, 4, 2, 3], [1, 2, 3, 4], [1, 3, 2, 4], [1, 4, 2, 3]];
function played() {
  let d = emptyData();
  PAIRS.forEach(([a, b, c, e], i) => {
    const r = i + 1;
    for (const [k, [h, aw]] of [[a, b], [c, e]].entries()) {
      const eventId = r * 10 + k;
      const homeWins = h === 1 || aw === 4;
      const apps = [];
      const app = (pid, teamId, goals) => ({ eventId, playerId: pid, teamId, started: true, minutes: 90, goals, assists: 0 });
      for (const [pid, tid] of [[10, 1], [20, 2], [30, 3], [40, 4]]) if (tid === h || tid === aw) apps.push(app(pid, tid, pid === 10 ? 1 : 0));
      if ((h === 1 || aw === 1) && r % 2 === 0) apps.push(app(11, 1, 0)); // 11 misses odd rounds
      d = applyImport(d, {
        match: { eventId, round: r, kickoff: NOW - (10 - r) * DAY, status: "finished", homeTeamId: h, awayTeamId: aw,
          homeScore: homeWins ? 2 : 0, awayScore: homeWins ? 0 : 2,
          goalTimes: { home: homeWins ? [10, 20] : [], away: homeWins ? [] : [10, 20] }, partial: false },
        teams: TEAMS, players: PLAYERS, appearances: apps,
      }, NOW);
    }
  });
  for (const [pid, pos] of [[10, "FWD"], [11, "MID"], [20, "FWD"], [30, "MID"], [40, "FWD"]]) d = setPlayerField(d, pid, "gamePosition", pos);
  for (const [pid, price] of [[10, 9.5], [20, 7], [30, 6], [40, 5]]) d = setPlayerField(d, pid, "price", price);
  return d;
}
// Upcoming round 7: club 4 hosts club 1 (hard for 4, easy for 1), club 2 hosts club 3.
function withFixtures(d) {
  return upsertMatchStubs(d, [
    { eventId: 71, round: 7, kickoff: NOW + DAY, status: "notstarted", homeTeamId: 4, awayTeamId: 1 },
  ], TEAMS);
}
function squad(d, siteIds) {
  return applySiteSync(d, {
    capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {},
    myTeam: { "6": { lines: [[siteIds[0]], [siteIds[1]]], bench: siteIds.slice(2), captain: siteIds[0], shown: {}, names: {}, total: 50 } },
  }, [{ playerId: "10", siteId: 510 }, { playerId: "11", siteId: 511 }, { playerId: "40", siteId: 540 }], NOW);
}
const view = (d) => seasonView(d, d.meta.seasonId);

describe("suggestions", () => {
  it("form is points per team match over the last 5, a missed match counting 0", () => {
    const v = view(played());
    const s = suggestionContext(v, NOW);
    const p10 = playerOutlook(s, "10");
    const p11 = playerOutlook(s, "11");
    expect(p10.games).toBe(FORM_WINDOW);
    expect(p10.form).toBeCloseTo(p10.points / 5);
    expect(p11.games).toBe(5);
    expect(p11.points).toBeLessThan(p10.points);
    expect(p11.form).toBeCloseTo(p11.points / 5); // 3 missed matches still in the denominator
  });
  it("no upcoming fixtures: outlook is form alone", () => {
    const s = suggestionContext(view(played()), NOW);
    expect(s.anyUpcoming).toBe(false);
    const p = playerOutlook(s, "10");
    expect(p.fixtures).toEqual([]);
    expect(p.ease).toBe(0);
    expect(p.score).toBeCloseTo(p.form);
  });
  it("fixture ease from each side, and the outlook formula", () => {
    const s = suggestionContext(view(withFixtures(played())), NOW);
    expect(s.anyUpcoming).toBe(true);
    const one = s.upcoming.get(1)[0];
    const four = s.upcoming.get(4)[0];
    expect(one).toMatchObject({ eventId: 71, round: 7, opponentId: 4, home: false });
    expect(four).toMatchObject({ opponentId: 1, home: true });
    expect(one.ease).toBeGreaterThan(0);
    expect(four.ease).toBeCloseTo(-one.ease);
    expect(one.tag).toMatch(/🎯/);
    expect(four.tag).toBe(null);
    const p = playerOutlook(s, "10");
    expect(p.ease).toBeCloseTo(one.ease);
    expect(p.score).toBeCloseTo(p.form + Math.abs(p.form) * 0.5 * one.ease);
    expect(playerOutlook(s, "40").score).toBeLessThan(playerOutlook(s, "40").form + 1e-9);
  });
  it("the squad is the latest captured gameweek, XI then bench", () => {
    expect(mySquad(view(played()))).toEqual([]);
    const sq = mySquad(view(squad(played(), [510, 511, 540])));
    expect(sq.map((e) => e.playerId)).toEqual(["10", "11", "40"]);
  });
  it("sell candidates: out players first, then weakest outlook", () => {
    let d = squad(played(), [510, 511, 540]);
    let rows = sellCandidates(suggestionContext(view(d), NOW));
    expect(rows.map((r) => r.entry.playerId)).toEqual(["11", "40", "10"]);
    d = markOut(d, "10", "hamstring", NOW);
    rows = sellCandidates(suggestionContext(view(d), NOW));
    expect(rows[0].entry.playerId).toBe("10");
    expect(rows[0].outlook.out).toBeTruthy();
  });
  it("buy targets: not owned, not out, has games, by position, limited", () => {
    let d = squad(played(), [510, 511, 540]);
    const s = suggestionContext(view(d), NOW);
    expect(buyTargets(s).map((o) => o.playerId)).toEqual(["20", "30"].sort((a, b) =>
      playerOutlook(s, b).score - playerOutlook(s, a).score));
    expect(buyTargets(s, { position: "MID" }).map((o) => o.playerId)).toEqual(["30"]);
    expect(buyTargets(s, { limit: 1 })).toHaveLength(1);
    d = markOut(d, "20", "", NOW);
    expect(buyTargets(suggestionContext(view(d), NOW)).map((o) => o.playerId)).toEqual(["30"]);
  });
  it("fixture runs: clubs with upcoming fixtures, easiest first", () => {
    expect(fixtureRuns(suggestionContext(view(played()), NOW))).toEqual([]);
    const runs = fixtureRuns(suggestionContext(view(withFixtures(played())), NOW));
    expect(runs.map((r) => r.teamId)).toEqual([1, 4]);
    expect(runs[0].name).toBe("Club 1");
    expect(runs[0].ease).toBeGreaterThan(runs[1].ease);
  });
});
