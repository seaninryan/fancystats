// test/teamsTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, applyImport, addFantasyOnlyPlayers } from "../src/lib/store.js";
import TeamsTab from "../src/components/TeamsTab.jsx";

const NOW = 1765000000000;

// One club with a real appearance-holder and one never-played registered player.
function dataForTeam() {
  const d = applyImport(emptyData(), {
    match: {
      eventId: 100, round: 1, kickoff: 1764900000000, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0,
      goalTimes: { home: [40], away: [] }, partial: false,
    },
    // team 1 sorts first alphabetically, so it is the club TeamsTab selects by default
    teams: [{ id: 1, name: "Bohemians", shortName: "BOH" }, { id: 2, name: "Shamrock Rovers", shortName: "SHR" }],
    players: [{ id: 10, name: "Graham Burke", teamId: 1 }],
    appearances: [{ eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 1, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
  }, NOW);
  return addFantasyOnlyPlayers(d, [
    { name: "Paddy Madden", teamId: 1, gamePosition: "FWD", price: 7.5, sitePoints: 0 },
    { name: "Daniel Mandroiu", teamId: 2, gamePosition: "MID", price: 6, sitePoints: 0 },
  ], NOW);
}

describe("TeamsTab SSR", () => {
  it("lists the club's never-played players as marked ghost rows", () => {
    const html = renderToStaticMarkup(
      <TeamsTab data={dataForTeam()} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain("Graham Burke");
    expect(html).toContain("Paddy Madden");
    expect(html).toContain("ghost-row");
    expect(html).toContain("hasn&#x27;t played yet");
  });
  it("does not leak another club's never-played players in", () => {
    const html = renderToStaticMarkup(
      <TeamsTab data={dataForTeam()} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain("Paddy Madden");          // Bohemians' own ghost shows
    expect(html).not.toContain("Daniel Mandroiu");   // Rovers' does not
  });
  it("renders no ghost markup when a club has none", () => {
    const d = dataForTeam();
    delete d.players["fx-paddy-madden-1"];
    delete d.players["fx-daniel-mandroiu-2"];
    const html = renderToStaticMarkup(
      <TeamsTab data={d} update={() => {}} openPlayer={() => {}} />);
    expect(html).not.toContain("ghost-row");
  });
});
