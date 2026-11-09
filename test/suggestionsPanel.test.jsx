import { describe, it, expect } from "vitest";
import { emptyData, applyImport, upsertMatchStubs, applySiteSync, setPlayerField } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { renderToStaticMarkup } from "react-dom/server";
import MyTeamTab from "../src/components/MyTeamTab.jsx";

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

const html = (d) => renderToStaticMarkup(<MyTeamTab data={view(d)} openPlayer={() => {}} />);

describe("SuggestionsPanel SSR", () => {
  it("shows the three sections, squad and non-owned players, and the form-only note", () => {
    const h = html(squad(played(), [510, 511, 540]));
    expect(h).toContain("Suggestions");
    expect(h).toContain("Weakest in your squad");
    expect(h).toContain("Buy targets");
    expect(h).toContain("P11");
    expect(h).toContain("P20");
    expect(h).toContain("outlook is form only");
    expect(h).not.toContain("Best fixture runs");
  });
  it("adds fixture runs and the favoured tag when fixtures are upcoming", () => {
    const h = html(squad(withFixtures(played()), [510, 511, 540]));
    expect(h).toContain("Best fixture runs");
    expect(h).toContain("🎯");
    expect(h).not.toContain("outlook is form only");
  });
  it("is absent without a captured squad", () => {
    expect(html(emptyData())).not.toContain("Suggestions");
  });
});
