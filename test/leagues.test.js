// test/leagues.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { teamLines } from "../src/lib/myTeam.js";
import { ordinal, leaguePositions, privateLeagues, leagueStandings, leagueRace, opponentTeam, squadComparison } from "../src/lib/leagues.js";

const NOW = 1765000000000;
const ME = 7378;
const team = (ids, captain, total) => ({
  lines: [[ids[0]], [ids[1]], [ids[2]], [ids[3]]], bench: [ids[4]], captain,
  shown: Object.fromEntries(ids.map((id) => [id, 2])), names: Object.fromEntries(ids.map((id) => [id, `P${id}`])), total,
});
function view(extra = {}) {
  const d0 = applyImport(emptyData(), {
    match: { eventId: 100, round: 1, kickoff: NOW - 1e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
      homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [],
  }, NOW);
  const d = applySiteSync(d0, {
    capturedAt: NOW, siteTeamId: ME, clubs: [], players: [], history: {},
    myTeam: { "2": team([1, 2, 3, 501, 5], 501, 60) },
    yourLeagues: [
      { code: "Overall", name: "Overall League", position: 50, private: false },
      { code: "Galway United", name: "Galway United", position: 3, private: false },
      { code: "abc", name: "Mini", position: 1, private: true },
    ],
    leagues: { abc: { name: "Mini", periods: {
      Overall: [[1, ME, "Sean", 100], [2, 8, "Billy", 95], [3, 9, "Alfie", 90]],
      "1": [[1, 8, "Billy", 60], [2, ME, "Sean", 40], [3, 9, "Alfie", 30]],
      "2": [[1, ME, "Sean", 60], [2, 9, "Alfie", 60], [3, 8, "Billy", 35]],
    } } },
    opponents: { "8": { manager: "Billy", gw: 2, team: team([1, 2, 7, 501, 9], 7, 35), details: { "Triple Captain Used": "Yes" } } },
    me: { details: {} },
    ...extra,
  }, [{ playerId: "10", siteId: 501 }], NOW);
  return seasonView(d, d.meta.seasonId);
}

describe("leagues", () => {
  it("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 50, 101].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "50th", "101st"]);
  });
  it("positions in every league, and the private ones with sizes", () => {
    expect(leaguePositions(view()).map((l) => `${l.name}:${l.position}`)).toEqual(["Overall League:50", "Galway United:3", "Mini:1"]);
    expect(privateLeagues(view())).toEqual([{ code: "abc", name: "Mini", myRank: 1, size: 3 }]);
  });
  it("standings with latest gameweek points, movement and gap", () => {
    const s = leagueStandings(view(), "abc");
    expect(s.map((r) => [r.rank, r.manager, r.gwPoints, r.total, r.gap, r.move, r.isMe])).toEqual([
      [1, "Sean", 60, 100, 0, 1, true],     // before GW2: Billy 60, Sean 40, Alfie 30 -> Sean was 2nd
      [2, "Billy", 35, 95, -5, -1, false],  // was 1st
      [3, "Alfie", 60, 90, -10, 0, false],  // was 3rd
    ]);
    expect(s[0].gw).toBe(2);
    expect(leagueStandings(view(), "nope")).toEqual([]);
  });
  it("race series per manager per gameweek", () => {
    const r = leagueRace(view(), "abc");
    expect(r.map((x) => x.manager)).toEqual(["Sean", "Billy", "Alfie"]);
    expect(r[1].points).toEqual([{ round: 1, value: 60 }, { round: 2, value: 35 }]);
  });
  it("an opponent's team, built like mine", () => {
    const t = opponentTeam(view(), 8);
    expect(t.manager).toBe("Billy");
    expect(t.total).toBe(35);
    expect(t.lines.map((l) => l.label)).toEqual(["GK", "DEF", "MID", "FWD"]);
    expect(t.lines[3].players[0]).toMatchObject({ siteId: 501, playerId: "10", name: "A Keena" });
    expect(t.details["Triple Captain Used"]).toBe("Yes");
    expect(opponentTeam(view(), 9)).toBe(null);
  });
  it("squad comparison against my latest gameweek", () => {
    const c = squadComparison(view(), 8);
    expect([...c.shared].sort()).toEqual([1, 2, 501]);
    expect([...c.theirsOnly].sort()).toEqual([7, 9]);
    expect(c.mineOnly.map((e) => e.siteId).sort()).toEqual([3, 5]);
    expect(c.myCaptain).toBe(501);
    expect(c.theirCaptain).toBe(7);
  });
  it("teamLines builds lines and bench from a raw team", () => {
    const t = teamLines(view(), team([1, 2, 3, 501, 5], 501, 60));
    expect(t.total).toBe(60);
    expect(t.bench.map((e) => e.siteId)).toEqual([5]);
    expect(t.lines[3].players[0].captain).toBe(true);
  });
});
