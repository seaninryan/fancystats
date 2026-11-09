import { describe, it, expect } from "vitest";
import { emptyData, applyImport, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { myTeamGameweeks, myTeamGameweek, myTeamSeries } from "../src/lib/myTeam.js";

const NOW = 1765000000000;
function synced(myTeam) {
  const d = applyImport(emptyData(), {
    match: { eventId: 100, round: 1, kickoff: NOW - 1e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
      homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }],
    appearances: [],
  }, NOW);
  const s = applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {}, myTeam },
    [{ playerId: "10", siteId: 501 }], NOW);
  return seasonView(s, s.meta.seasonId);
}
const GW = (total, captain) => ({
  lines: [[601], [602, 603], [604], [501]], bench: [605], captain,
  shown: { "501": 16, "601": 3, "602": 2, "603": 1, "604": 5, "605": 0 },
  names: { "501": "Aidan Keena", "601": "Ed McGinty", "602": "Joe Redmond", "603": "Lee Grace", "604": "Jack Byrne", "605": "Hugo Cunha" },
  total,
});

describe("myTeam", () => {
  it("lists captured gameweeks in order", () => {
    expect(myTeamGameweeks(synced({ "10": GW(50, 501), "2": GW(40, 501) }))).toEqual([2, 10]);
    expect(myTeamGameweeks(seasonView(emptyData(), 87682))).toEqual([]);
  });
  it("builds a gameweek: labelled lines, bench, captain, linked players", () => {
    const t = myTeamGameweek(synced({ "3": GW(83, 501) }), 3);
    expect(t.gw).toBe(3);
    expect(t.total).toBe(83);
    expect(t.lines.map((l) => l.label)).toEqual(["GK", "DEF", "MID", "FWD"]);
    expect(t.lines[3].players[0]).toEqual({ siteId: 501, playerId: "10", name: "A Keena", points: 16, captain: true });
    expect(t.lines[0].players[0]).toEqual({ siteId: 601, playerId: null, name: "Ed McGinty", points: 3, captain: false });
    expect(t.bench.map((e) => e.name)).toEqual(["Hugo Cunha"]);
  });
  it("labels lines XI when the site's rows aren't the usual four", () => {
    const t = myTeamGameweek(synced({ "1": { ...GW(10, null), lines: [[601, 602, 603, 604, 501]] } }), 1);
    expect(t.lines.map((l) => l.label)).toEqual(["XI"]);
  });
  it("returns null for a gameweek that wasn't captured", () => {
    expect(myTeamGameweek(synced({ "1": GW(10, 501) }), 7)).toBe(null);
  });
  it("season series of totals", () => {
    expect(myTeamSeries(synced({ "2": GW(40, 501), "1": GW(55, 501) }))).toEqual([{ gw: 1, total: 55 }, { gw: 2, total: 40 }]);
  });
});
