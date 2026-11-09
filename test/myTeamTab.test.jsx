import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import MyTeamTab from "../src/components/MyTeamTab.jsx";

const NOW = 1765000000000;
const gw = (total) => ({
  lines: [[601], [602], [603], [604]], bench: [605], captain: 604,
  shown: { "601": 3, "602": 2, "603": 5, "604": 16, "605": 0 },
  names: { "601": "Ed McGinty", "602": "Joe Redmond", "603": "Jack Byrne", "604": "Tommy Lonergan", "605": "Hugo Cunha" },
  total,
});

describe("MyTeamTab SSR", () => {
  it("points to Settings when nothing is captured", () => {
    const d = emptyData();
    const html = renderToStaticMarkup(<MyTeamTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />);
    expect(html).toContain("Fantasy sync");
  });
  it("shows the latest gameweek with lines, captain, bench and total", () => {
    const d = applySiteSync(emptyData(), { capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {},
      myTeam: { "34": gw(40), "35": gw(83) } }, [], NOW);
    const html = renderToStaticMarkup(<MyTeamTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />);
    expect(html).toContain("83 pts");
    expect(html).toContain("Tommy Lonergan");
    expect(html).toContain("(c)");
    expect(html).toContain("Bench");
    expect(html).toContain("GW 35");
  });
});
