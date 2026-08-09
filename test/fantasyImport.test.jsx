// test/fantasyImport.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import UnmatchedLinks from "../src/components/UnmatchedLinks.jsx";

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
  it("renders the optional description", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan", price: 8.3 }]}
        links={{}} onChange={() => {}} describe={(u) => `€${u.price}`} />);
    expect(html).toContain("8.3");
  });
});
