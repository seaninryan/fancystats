// test/fantasyImport.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import UnmatchedLinks from "../src/components/UnmatchedLinks.jsx";
import FantasyImport from "../src/components/FantasyImport.jsx";

const dataWithPlayers = () => ({
  ...emptyData(),
  teams: { 1: { name: "Bohemians", shortName: "BOH" }, 2: { name: "Dundalk", shortName: "DUN" } },
  players: {
    10: { name: "Colm Whelan", teamId: 1 },
    11: { name: "Sam Todd", teamId: 1 },
    12: { name: "Colm Whelan", teamId: 2 },
  },
});

describe("UnmatchedLinks SSR", () => {
  it("renders a select per unmatched row with suggestions and all players", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan", teamId: "1" }]}
        links={{}} onChange={() => {}} />);
    expect(html).toContain("C. Whelan");
    expect(html).toContain("Suggested");
    expect(html).toContain("All players");
    expect(html).toContain("skip");
    expect(html).toContain("(BOH)");
  });
  it("renders a header and a cell per column", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan", price: 8.3, gamePosition: "DEF" }]}
        links={{}} onChange={() => {}}
        columns={[
          { label: "Pos", width: "3.5rem", value: (u) => u.gamePosition },
          { label: "Price", width: "4.5rem", value: (u) => `€${u.price}` },
        ]} />);
    expect(html).toContain("Pos");
    expect(html).toContain("Price");
    expect(html).toContain("DEF");
    expect(html).toContain("8.3");
  });
  it("renders nothing when there is nothing to link", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[]} links={{}} onChange={() => {}} />);
    expect(html).toBe("");
  });
  it("marks a linked row as done", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan" }]}
        links={{ 0: "10" }} onChange={() => {}} />);
    expect(html).toContain("link-done");
  });
});

describe("FantasyImport SSR", () => {
  it("renders the snippet and the paste box", () => {
    const html = renderToStaticMarkup(<FantasyImport data={dataWithPlayers()} update={() => {}} />);
    expect(html).toContain("Import from Fantasy LOI");
    expect(html).toContain("/Stats/PlayerStats");
    expect(html).toContain("Copy snippet");
  });
});
