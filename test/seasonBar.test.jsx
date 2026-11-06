// test/seasonBar.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, migrateSeasons, startNewSeason } from "../src/lib/store.js";
import SeasonBar, { SeasonBanner } from "../src/components/SeasonBar.jsx";

const two = () => startNewSeason(migrateSeasons(emptyData()), { seasonId: 99999, label: "2027" });

describe("SeasonBar SSR", () => {
  it("renders nothing with a single season", () => {
    expect(renderToStaticMarkup(<SeasonBar data={migrateSeasons(emptyData())} viewSeason={87682} onChange={() => {}} />)).toBe("");
  });
  it("offers a picker and no banner when viewing the current season", () => {
    const html = renderToStaticMarkup(<SeasonBar data={two()} viewSeason={99999} onChange={() => {}} />);
    expect(html).toContain("<select");
    expect(html).toContain("2026");
    expect(html).not.toContain("read-only");
  });
  it("shows a read-only banner with a way back when viewing a past season", () => {
    const html = renderToStaticMarkup(<SeasonBanner data={two()} viewSeason={87682} onChange={() => {}} />);
    expect(renderToStaticMarkup(<SeasonBar data={two()} viewSeason={87682} onChange={() => {}} />)).not.toContain("read-only");
    expect(renderToStaticMarkup(<SeasonBanner data={two()} viewSeason={99999} onChange={() => {}} />)).toBe("");
    expect(html).toContain("Viewing 2026 (read-only)");
    expect(html).toContain("Back to 2027");
  });
});
