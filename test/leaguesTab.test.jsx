// test/leaguesTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

import LeaguesTab from "../src/components/LeaguesTab.jsx";
import MyTeamTab from "../src/components/MyTeamTab.jsx";

describe("LeaguesTab SSR", () => {
  it("points to Settings without league data", () => {
    const d = emptyData();
    expect(renderToStaticMarkup(<LeaguesTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />)).toContain("Fantasy sync");
  });
  it("shows the first private league's standings and race", () => {
    const html = renderToStaticMarkup(<LeaguesTab data={view()} openPlayer={() => {}} />);
    expect(html).toContain("Mini");
    expect(html).toContain("Billy");
    expect(html).toContain("Alfie");
    expect(html).toContain("GW 2");
    expect(html).toContain("Cumulative");
  });
});

describe("MyTeamTab header", () => {
  it("lists league positions", () => {
    const html = renderToStaticMarkup(<MyTeamTab data={view()} openPlayer={() => {}} />);
    expect(html).toContain("50th overall");
    expect(html).toContain("3rd Galway United");
    expect(html).toContain("1st Mini");
  });
});
