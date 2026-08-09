import { describe, it, expect } from "vitest";
import { parsePaste, matchPlayers, normalizeName, suggestLinks } from "../src/lib/pasteImport.js";

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
  it("vertical copies with a rank column take the last number before the next name", () => {
    expect(parsePaste("Padraig Amond\n1\n10\nGraham Burke\n2\n9.9")).toEqual([
      { name: "Padraig Amond", value: 10 },
      { name: "Graham Burke", value: 9.9 },
    ]);
  });
  it("parses 3-column copies (name/team/value) and rank-led rows", () => {
    expect(parsePaste("Padraig Amond\tBohemians\t10")).toEqual([{ name: "Padraig Amond", value: 10 }]);
    expect(parsePaste("1\tPadraig Amond\t10")).toEqual([{ name: "Padraig Amond", value: 10 }]);
  });
  it("drops table-header words", () => {
    expect(parsePaste("Player\nValue\nPadraig Amond\n10")).toEqual([{ name: "Padraig Amond", value: 10 }]);
  });
  it("ignores the fantasyloi 'Club Picture' image-cell text", () => {
    const text = [
      "Club Picture\tLuke Turner\t116",
      "Club Picture\tDaryl Horgan\t116",
      "Club Picture\tEd McGinty\t116",
      "Club Picture\tHarry Wood\t115",
    ].join("\n");
    expect(parsePaste(text)).toEqual([
      { name: "Luke Turner", value: 116 },
      { name: "Daryl Horgan", value: 116 },
      { name: "Ed McGinty", value: 116 },
      { name: "Harry Wood", value: 115 },
    ]);
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
  it("two players with identical names stay unmatched, never silently matched", () => {
    const ps = {
      21: { name: "John Murphy", teamId: 1, pasteAlias: null },
      22: { name: "John Murphy", teamId: 2, pasteAlias: null },
    };
    const { matched, unmatched } = matchPlayers([{ name: "John Murphy", value: 5 }], ps);
    expect(matched).toEqual([]);
    expect(unmatched.map((u) => u.name)).toEqual(["John Murphy"]);
  });
});

describe("suggestLinks", () => {
  const players = {
    30: { name: "Pico", teamId: 1, pasteAlias: null },
    31: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    32: { name: "Aaron Greene", teamId: 1, pasteAlias: null },
  };
  it("ranks the shared-word candidate first (Pico Lopez → Pico)", () => {
    expect(suggestLinks("Pico Lopez", players)[0]).toBe("30");
  });
  it("matches on shared surname", () => {
    expect(suggestLinks("G. Burke", players)[0]).toBe("31");
  });
  it("returns empty for nothing similar", () => {
    expect(suggestLinks("Zlatan Ibrahimović", players)).toEqual([]);
  });
});

describe("matchPlayers with customName", () => {
  it("matches a paste row against the user's display-name override", () => {
    const players = { 30: { name: "Pico", customName: "Pico Lopez", teamId: 1, pasteAlias: null } };
    const { matched } = matchPlayers([{ name: "Pico Lopez", value: 4.5 }], players);
    expect(matched[0]?.playerId).toBe("30");
  });
});

describe("two-column site format (price + total points)", () => {
  it("attaches furniture-line numbers to the name above (tabs)", () => {
    expect(parsePaste("Arlo Doherty\nClub Picture\t4.0\t25\nBrian Maher\nClub Picture\t5.9\t5")).toEqual([
      { name: "Arlo Doherty", value: 25, price: 4 },
      { name: "Brian Maher", value: 5, price: 5.9 },
    ]);
  });
  it("multi-space separators work too", () => {
    expect(parsePaste("Conor Kearns\nClub Picture    4.8    25")).toEqual([
      { name: "Conor Kearns", value: 25, price: 4.8 },
    ]);
  });
  it("a leading integer rank is never taken as a price", () => {
    expect(parsePaste("1\tJohn Smith\t10")).toEqual([{ name: "John Smith", value: 10 }]);
  });
  it("vertical decimal variant: price line then points line", () => {
    expect(parsePaste("Wessel Speel\n5.5\n96")).toEqual([
      { name: "Wessel Speel", value: 96, price: 5.5 },
    ]);
  });
  it("matchPlayers carries the price through", () => {
    const players = { 7: { name: "Arlo Doherty" } };
    const { matched } = matchPlayers([{ name: "Arlo Doherty", value: 25, price: 4 }], players);
    expect(matched).toEqual([{ playerId: "7", name: "Arlo Doherty", value: 25, price: 4 }]);
  });
});

describe("matchPlayers with a per-row teamId", () => {
  const players = {
    21: { name: "John Murphy", teamId: 1, pasteAlias: null },
    22: { name: "John Murphy", teamId: 2, pasteAlias: null },
    23: { name: "Colm Whelan", teamId: 1, pasteAlias: null },
  };
  it("resolves same-named players using the row's club", () => {
    const { matched } = matchPlayers([{ name: "John Murphy", teamId: 1, price: 5 }], players);
    expect(matched[0].playerId).toBe("21");
  });
  it("teamId is compared loosely (string row id vs number player id)", () => {
    const { matched } = matchPlayers([{ name: "John Murphy", teamId: "2" }], players);
    expect(matched[0].playerId).toBe("22");
  });
  it("a name on the wrong club stays unmatched instead of matching by name", () => {
    const { matched, unmatched } = matchPlayers([{ name: "Colm Whelan", teamId: 2 }], players);
    expect(matched).toEqual([]);
    expect(unmatched[0].name).toBe("Colm Whelan");
  });
  it("no teamId on the row keeps the old name-only behaviour", () => {
    const { matched, unmatched } = matchPlayers([{ name: "John Murphy" }], players);
    expect(matched).toEqual([]);            // ambiguous, as before
    expect(unmatched[0].name).toBe("John Murphy");
  });
  it("surname+initial matching is club-constrained too", () => {
    const { matched } = matchPlayers([{ name: "J. Murphy", teamId: 2 }], players);
    expect(matched[0].playerId).toBe("22");
  });
});

describe("suggestLinks with a teamId", () => {
  const players = {
    31: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    32: { name: "Graham Burke", teamId: 2, pasteAlias: null },
  };
  it("ranks the same-club candidate first", () => {
    expect(suggestLinks("Graham Burke", players, 2)[0]).toBe("32");
  });
  it("without a teamId the order is unchanged", () => {
    expect(suggestLinks("Graham Burke", players)).toEqual(["31", "32"]);
  });
});
