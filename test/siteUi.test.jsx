import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, applyImport, setPlayerField, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import PlayerDetail from "../src/components/PlayerDetail.jsx";
import { PtsPill } from "../src/components/Pills.jsx";

const NOW = 1765000000000;
const app = (eventId, extra = {}) => ({ eventId, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null,
  minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false,
  penMissed: 0, penSaved: 0, ...extra });
function fixture(history) {
  let d = emptyData();
  const teams = [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }];
  const players = [{ id: 10, name: "A Keena", teamId: 1 }];
  d = applyImport(d, { match: { eventId: 100, round: 1, kickoff: NOW - 2e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
    homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false }, teams, players, appearances: [app(100, { goals: 1 })] }, NOW);
  d = applyImport(d, { match: { eventId: 101, round: 2, kickoff: NOW - 1e6, status: "finished", homeTeamId: 2, awayTeamId: 1,
    homeScore: 0, awayScore: 0, goalTimes: { home: [], away: [] }, partial: false }, teams, players, appearances: [app(101)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  return applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: [{ id: "c1", name: "Shamrock Rovers" }, { id: "c2", name: "Bohemians" }],
    players: [], myTeam: {}, history },
    [{ playerId: "10", siteId: 501 }], NOW);
}
const render = (d) => {
  const v = seasonView(d, d.meta.seasonId);
  return renderToStaticMarkup(
    <PlayerDetail data={v} fullData={d} update={() => {}} readOnly={false} playerId="10" onBack={() => {}} />,
  );
};

describe("points source in the UI", () => {
  it("PtsPill marks our estimates", () => {
    expect(renderToStaticMarkup(<PtsPill pts={4} est />)).toContain("est");
    expect(renderToStaticMarkup(<PtsPill pts={4} />)).not.toContain("est");
  });
  it("PlayerDetail shows the site total, the disagreement, and italic estimates", () => {
    const html = render(fixture({ "501": [[1, "c1", "c2", 12, [["Appearance", "Full Game", 3], ["Team Result", "Win", 2], ["Goals", "1", 4], ["Assists", "1", 3]]]] }));
    expect(html).toContain("12");
    expect(html).toContain("ours 9 (assists)");
    expect(html).toContain("our estimate");
  });
  it("PlayerDetail flags weeks the player was not in the fantasy game", () => {
    const html = render(fixture({ "501": [[2, "c2", "c1", 4, [["Appearance", "Full Game", 3], ["Team Result", "Draw", 1]]]] }));
    expect(html).toContain("not in the fantasy game that week");
  });
});
