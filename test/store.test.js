// test/store.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, upsertMatchStubs, setPlayerField,
  setAdjustment, deriveRealPosition, playerTotals, positionMismatch,
} from "../src/lib/store.js";

const NOW = 1765000000000;

function importedFixture() {
  return applyImport(emptyData(), {
    match: {
      eventId: 100, round: 1, kickoff: 1764900000000, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0,
      goalTimes: { home: [40], away: [] }, partial: false,
    },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }, { id: 11, name: "B Burke", teamId: 1 }],
    appearances: [
      { eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 1, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 },
      { eventId: 100, playerId: 11, teamId: 1, started: false, subOnMin: 60, subOffMin: null, minutes: 30, positionPlayed: "M", goals: 0, assists: 1, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 },
    ],
  }, NOW);
}

describe("applyImport", () => {
  it("writes match, teams, appearances and stamps importedAt", () => {
    const d = importedFixture();
    expect(d.matches["100"].importedAt).toBe(NOW);
    expect(d.teams["1"].name).toBe("Shamrock Rovers");
    expect(d.appearances["100:10"].goals).toBe(1);
  });
  it("creates unknown players with default user fields", () => {
    const p = importedFixture().players["10"];
    expect(p).toMatchObject({ name: "A Keena", teamId: 1, gamePosition: null, realPosition: null, price: null, starred: false, inSquad: false, pasteAlias: null });
  });
  it("re-import replaces that match's appearances but keeps user player fields", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    d = setPlayerField(d, 10, "starred", true);
    const re = applyImport(d, {
      match: { ...d.matches["100"], eventId: 100, homeScore: 2 },
      teams: [], players: [{ id: 10, name: "Aidan Keena", teamId: 1 }],
      appearances: [{ eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 2, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
    }, NOW + 1);
    expect(re.appearances["100:10"].goals).toBe(2);
    expect(re.appearances["100:11"]).toBeUndefined(); // old appearance for this match removed
    expect(re.players["10"].gamePosition).toBe("FWD"); // user-owned survives
    expect(re.players["10"].starred).toBe(true);
    expect(re.players["10"].name).toBe("Aidan Keena"); // import-owned updated
  });
  it("does not mutate its input", () => {
    const d = emptyData();
    importedFixture();
    expect(d.matches).toEqual({});
  });
});

describe("upsertMatchStubs", () => {
  it("adds new fixtures without importedAt", () => {
    const d = upsertMatchStubs(emptyData(), [
      { eventId: 200, round: 2, kickoff: 1, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null },
    ], [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }]);
    expect(d.matches["200"].importedAt).toBeUndefined();
    expect(d.teams["2"].shortName).toBe("BOH");
  });
  it("updates status/scores on imported matches but preserves importedAt and goalTimes", () => {
    let d = importedFixture();
    d = upsertMatchStubs(d, [{ eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 }], []);
    expect(d.matches["100"].importedAt).toBe(NOW);
    expect(d.matches["100"].goalTimes.home).toEqual([40]);
  });
});

describe("user edits", () => {
  it("setPlayerField sets gamePositionSource=manual when editing gamePosition", () => {
    const d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    expect(d.players["10"].gamePosition).toBe("MID");
    expect(d.players["10"].gamePositionSource).toBe("manual");
  });
  it("setAdjustment stores deltas and removes empty ones", () => {
    let d = setAdjustment(importedFixture(), "100:10", { assists: 1, note: "won pen" });
    expect(d.adjustments["100:10"].assists).toBe(1);
    d = setAdjustment(d, "100:10", null);
    expect(d.adjustments["100:10"]).toBeUndefined();
  });
});

describe("derived queries", () => {
  it("deriveRealPosition: majority of positionPlayed, mapped to fantasy positions", () => {
    const apps = [
      { positionPlayed: "F" }, { positionPlayed: "F" }, { positionPlayed: "M" },
    ];
    expect(deriveRealPosition(apps)).toEqual({ position: "FWD", count: 2, total: 3 });
    expect(deriveRealPosition([])).toBeNull();
  });
  it("playerTotals aggregates stats and fantasy points by gamePosition", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    const t = playerTotals(d, 10);
    // full match 3 + win 2 + goal(FWD) 4 = 9
    expect(t).toMatchObject({ minutes: 90, goals: 1, assists: 0, starts: 1, subApps: 0, points: 9 });
  });
  it("playerTotals applies adjustments", () => {
    let d = importedFixture();
    d = setPlayerField(d, 11, "gamePosition", "MID");
    d = setAdjustment(d, "100:11", { assists: 1 });
    // sub 1 + win 2 + assists (1+1)*3 = 9
    expect(playerTotals(d, 11).points).toBe(9);
    expect(playerTotals(d, 11).assists).toBe(2);
  });
  it("playerTotals returns null points when gamePosition unset", () => {
    expect(playerTotals(importedFixture(), 10).points).toBeNull();
  });
  it("positionMismatch flags game vs derived disagreement (min 3 observations)", () => {
    const apps3 = [{ positionPlayed: "F" }, { positionPlayed: "F" }, { positionPlayed: "F" }];
    expect(positionMismatch({ gamePosition: "DEF", realPosition: null }, apps3)).toBe(true);
    expect(positionMismatch({ gamePosition: "FWD", realPosition: null }, apps3)).toBe(false);
    expect(positionMismatch({ gamePosition: "DEF", realPosition: "DEF" }, apps3)).toBe(false); // manual override wins
    expect(positionMismatch({ gamePosition: "DEF", realPosition: null }, apps3.slice(0, 2))).toBe(false); // too few
  });
});

describe("review fixes", () => {
  it("setAdjustment keeps boolean-false deltas (clearing an erroneous red card)", () => {
    let d = importedFixture();
    d.appearances["100:10"].red = true;
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    expect(playerTotals(d, 10).points).toBe(5); // 3 fullMatch + 2 win + 4 goal − 4 red
    d = setAdjustment(d, "100:10", { red: false, note: "card rescinded" });
    expect(d.adjustments["100:10"]).toBeDefined();
    expect(playerTotals(d, 10).points).toBe(9);
  });
  it("upsertMatchStubs keeps import-owned fields when kickoff moves", () => {
    let d = importedFixture();
    d = upsertMatchStubs(d, [{ eventId: 100, round: 1, kickoff: 1764999999999, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 }], []);
    expect(d.matches["100"].kickoff).toBe(1764999999999);
    expect(d.matches["100"].importedAt).toBe(NOW);
    expect(d.matches["100"].goalTimes.home).toEqual([40]);
  });
  it("playerTotals counts stats but no points for matches without goalTimes", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    d = upsertMatchStubs(d, [{ eventId: 101, round: 2, kickoff: 1765000000001, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0 }], []);
    d.appearances["101:10"] = { ...d.appearances["100:10"], eventId: 101, goals: 0 };
    const t = playerTotals(d, 10);
    expect(t.points).toBe(9); // only the goalTimes-bearing match scores
    expect(t.minutes).toBe(180);
  });
  it("player ids work as strings end to end", () => {
    let d = importedFixture();
    d = setPlayerField(d, "10", "gamePosition", "FWD");
    expect(playerTotals(d, "10").points).toBe(9);
  });
});
