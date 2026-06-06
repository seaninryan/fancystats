// test/gameweekChart.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GameweekChart from "../src/components/GameweekChart.jsx";

const series = [
  { key: "10", label: "A Keena", color: "#0e7a3c", points: [{ round: 1, value: 9 }, { round: 2, value: null }, { round: 3, value: 3 }] },
  { key: "20", label: "C Smith", color: "#c8102e", points: [{ round: 1, value: 3 }, { round: 2, value: 6 }, { round: 3, value: -1 }] },
];

describe("GameweekChart", () => {
  it("renders nothing with no series", () => {
    expect(renderToStaticMarkup(
      <GameweekChart series={[]} cumulative={false} onToggleCumulative={() => {}} onClear={() => {}} />,
    )).toBe("");
  });
  it("renders controls and children without crashing", () => {
    const html = renderToStaticMarkup(
      <GameweekChart series={series} cumulative onToggleCumulative={() => {}} onClear={() => {}}>
        <button>Pts</button>
      </GameweekChart>,
    );
    expect(html).toContain("Cumulative");
    expect(html).toContain("Clear");
    expect(html).toContain("Pts");
  });
});
