// test/settingsTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import SettingsTab, { appliedMessage } from "../src/components/SettingsTab.jsx";

const data = () => ({ ...emptyData(), teams: { 1: { name: "Bohemians", shortName: "BOH" } } });

describe("SettingsTab SSR", () => {
  it("hosts both console imports and the legacy paste card", () => {
    const html = renderToStaticMarkup(<SettingsTab data={data()} update={() => {}} />);
    expect(html).toContain("Import via console"); // SofaScore matches
    expect(html).toContain("Import from Fantasy LOI"); // prices/positions/points
    expect(html).toContain("Import from the fantasy game (paste)"); // legacy fallback
  });
  it("links out to both sites in a new tab, without leaking a referer", () => {
    const html = renderToStaticMarkup(<SettingsTab data={data()} update={() => {}} />);
    expect(html).toContain('href="https://www.sofascore.com/football/tournament/ireland/premier-division/192#id:87682"');
    expect(html).toContain('href="https://fantasyloi.leagueofireland.ie/Stats/PlayerStats"');
    // SofaScore blocks a github.io referer, so both links must suppress it
    expect(html.match(/rel="noreferrer"/g)).toHaveLength(2);
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
  });
  it("builds the SofaScore deep link from meta, so a new season follows automatically", () => {
    const next = { ...data(), meta: { ...emptyData().meta, tournamentId: 192, seasonId: 99999 } };
    const html = renderToStaticMarkup(<SettingsTab data={next} update={() => {}} />);
    expect(html).toContain("premier-division/192#id:99999");
  });
  it("keeps the legacy paste card collapsed by default", () => {
    const html = renderToStaticMarkup(<SettingsTab data={data()} update={() => {}} />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open"); // shipped closed
  });
});

describe("appliedMessage", () => {
  it("names which of the five imports landed", () => {
    expect(appliedMessage(180, "price")).toBe("Applied 180 players — prices");
    expect(appliedMessage(22, "GK")).toBe("Applied 22 players — goalkeeper positions");
    expect(appliedMessage(60, "DEF")).toBe("Applied 60 players — defender positions");
    expect(appliedMessage(70, "MID")).toBe("Applied 70 players — midfielder positions");
    expect(appliedMessage(40, "FWD")).toBe("Applied 40 players — forward positions");
  });
});
