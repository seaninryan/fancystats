import { describe, it, expect } from "vitest";
import { parsePaste, matchPlayers, normalizeName } from "../src/lib/pasteImport.js";

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation", () => {
    expect(normalizeName("Pádraig O'Conor")).toBe("padraig oconor");
    expect(normalizeName("James-Taylor,  Douglas ")).toBe("james taylor douglas");
  });
});

describe("parsePaste", () => {
  it("parses tab-separated rows and skips junk", () => {
    const text = [
      "Player Stats", "Statistic", "Value",          // page furniture
      "Padraig Amond\t10",
      "Graham Burke\t9.9",
      "Sign In", "© Fantasy LOI",
    ].join("\n");
    expect(parsePaste(text)).toEqual([
      { name: "Padraig Amond", value: 10 },
      { name: "Graham Burke", value: 9.9 },
    ]);
  });
  it("parses name/number alternating lines", () => {
    const text = "Padraig Amond\n10\nGraham Burke\n9.9";
    expect(parsePaste(text)).toEqual([
      { name: "Padraig Amond", value: 10 },
      { name: "Graham Burke", value: 9.9 },
    ]);
  });
  it("ignores pure-number noise without a preceding name", () => {
    expect(parsePaste("2026\n\nPadraig Amond\t10")).toEqual([{ name: "Padraig Amond", value: 10 }]);
  });
});

describe("matchPlayers", () => {
  const players = {
    10: { name: "Pádraig Amond", teamId: 1, pasteAlias: null },
    11: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    12: { name: "Patrick O'Conor", teamId: 2, pasteAlias: null },
    13: { name: "Sean Boyd", teamId: 2, pasteAlias: "S. Boyd (FLOI)" },
  };
  it("matches on normalized full name (diacritics-insensitive)", () => {
    const { matched } = matchPlayers([{ name: "Padraig Amond", value: 10 }], players);
    expect(matched).toEqual([{ playerId: "10", name: "Padraig Amond", value: 10 }]);
  });
  it("matches via remembered pasteAlias", () => {
    const { matched } = matchPlayers([{ name: "S. Boyd (FLOI)", value: 5 }], players);
    expect(matched[0].playerId).toBe("13");
  });
  it("matches surname + first initial", () => {
    const { matched } = matchPlayers([{ name: "P. O'Conor", value: 4.5 }], players);
    expect(matched[0].playerId).toBe("12");
  });
  it("reports unmatched and ambiguous names as unmatched", () => {
    const ps = { ...players, 14: { name: "Paul O'Conor", teamId: 3, pasteAlias: null } };
    const { matched, unmatched } = matchPlayers(
      [{ name: "P. O'Conor", value: 4.5 }, { name: "Nobody Real", value: 1 }], ps);
    expect(matched).toEqual([]);
    expect(unmatched.map((u) => u.name)).toEqual(["P. O'Conor", "Nobody Real"]);
  });
});
