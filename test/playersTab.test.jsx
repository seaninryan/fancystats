// test/playersTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, addFantasyOnlyPlayers } from "../src/lib/store.js";
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
