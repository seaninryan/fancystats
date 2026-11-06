// test/playersTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, addFantasyOnlyPlayers, applyImport, setPlayerField, migrateSeasons, startNewSeason } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import PlayersTab from "../src/components/PlayersTab.jsx";
import PlayerDetail from "../src/components/PlayerDetail.jsx";

const dataWithGhost = () => addFantasyOnlyPlayers({
  ...emptyData(),
  teams: { 1: { name: "Shamrock Rovers", shortName: "SRO" } },
}, [{ name: "Daniel Mandroiu", teamId: 1, gamePosition: "MID", price: 6.5, sitePoints: 0 }], 1000);

describe("PlayersTab SSR", () => {
  it("renders a never-played player as a marked ghost row", () => {
    const html = renderToStaticMarkup(
      <PlayersTab data={dataWithGhost()} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain("Daniel Mandroiu");
    expect(html).toContain("ghost-row");
    expect(html).toContain("hasn&#x27;t played yet");
  });
  it("renders an ordinary empty table without ghost markup", () => {
    const html = renderToStaticMarkup(
      <PlayersTab data={emptyData()} update={() => {}} openPlayer={() => {}} />);
    expect(html).not.toContain("ghost-row");
  });
});

// The spec claims PlayerDetail needs no change because it already handles zero
// appearances and its absence filter is `k.endsWith(':' + playerId)`. That only holds
// for a colon-free string id — prove it rather than assume it.
describe("PlayerDetail with a fantasy-only player", () => {
  it("opens a never-played player without crashing", () => {
    const html = renderToStaticMarkup(
      <PlayerDetail data={dataWithGhost()} update={() => {}}
        playerId="fx-daniel-mandroiu-1" onBack={() => {}} />);
    expect(html).toContain("Daniel Mandroiu");
    expect(html).toContain("watch");
    expect(html).toContain("6.5");
  });
});

describe("PlayerDetail remove affordance", () => {
  it("offers Remove on a fantasy-only record", () => {
    const html = renderToStaticMarkup(
      <PlayerDetail data={dataWithGhost()} update={() => {}}
        playerId="fx-daniel-mandroiu-1" onBack={() => {}} />);
    expect(html).toContain("Remove");
    expect(html).toContain("not played");
  });
});

describe("last season", () => {
  const NOW = 1765000000000;
  const app = { eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 2, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 };
  const rolled = () => {
    let d = migrateSeasons(emptyData());
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: NOW - 1e9, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0, goalTimes: { home: [10, 20], away: [] }, partial: false },
      teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
      players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app],
    }, NOW);
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    return startNewSeason(d, { seasonId: 99999, label: "2027" });
  };
  it("PlayerDetail shows the previous-season line", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayerDetail data={seasonView(d, 99999)} fullData={d} update={() => {}} playerId="10" onBack={() => {}} />);
    expect(html).toContain("2026:");
    expect(html).toContain("1 apps");
    expect(html).toContain("2G 0A");
  });
  it("PlayerDetail hides the line when viewing a past season", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayerDetail data={seasonView(d, 87682)} fullData={d} readOnly update={() => {}} playerId="10" onBack={() => {}} />);
    expect(html).not.toContain("2026:");
  });
  it("PlayersTab adds a Last column once a previous season exists", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayersTab data={seasonView(d, 99999)} fullData={d} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain(">Last<");
  });
  it("PlayersTab has no Last column with a single season or when read-only", () => {
    expect(renderToStaticMarkup(<PlayersTab data={emptyData()} update={() => {}} openPlayer={() => {}} />)).not.toContain(">Last<");
    const d = rolled();
    expect(renderToStaticMarkup(
      <PlayersTab data={seasonView(d, 87682)} fullData={d} readOnly update={() => {}} openPlayer={() => {}} />)).not.toContain(">Last<");
  });
});
