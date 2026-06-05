// test/store.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, upsertMatchStubs, setPlayerField,
  setAdjustment, deriveRealPosition, playerTotals, positionMismatch,
  applyPasteResults, matchRound, setMatchRound, playerAppearances, appearancesByPlayer,
  markOut, clearOut, activeFlag, mismatchInfo, isSupersededPostponed, staleInfo,
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

describe("applyPasteResults", () => {
  it("price paste sets price + timestamp", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A Keena", value: 9.5 }], "price", NOW);
    expect(d.players["10"].price).toBe(9.5);
    expect(d.players["10"].priceUpdatedAt).toBe(NOW);
  });
  it("position paste sets gamePosition with source=paste", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A Keena", value: 9.5 }], "FWD", NOW);
    expect(d.players["10"]).toMatchObject({ gamePosition: "FWD", gamePositionSource: "paste" });
  });
  it("position paste never clobbers a manual gamePosition", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    d = applyPasteResults(d, [{ playerId: "10", name: "A Keena", value: 9.5 }], "FWD", NOW);
    expect(d.players["10"].gamePosition).toBe("MID");
  });
  it("remembers manual-link aliases", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A. Keena (FLOI)", value: 9.5, alias: "A. Keena (FLOI)" }], "price", NOW);
    expect(d.players["10"].pasteAlias).toBe("A. Keena (FLOI)");
  });
});

describe("round overrides", () => {
  it("matchRound prefers the user override", () => {
    expect(matchRound({ round: 12 })).toBe(12);
    expect(matchRound({ round: 12, roundOverride: 14 })).toBe(14);
  });
  it("setMatchRound sets and clears the override", () => {
    let d = importedFixture();
    d = setMatchRound(d, 100, 14);
    expect(matchRound(d.matches["100"])).toBe(14);
    d = setMatchRound(d, 100, null);
    expect(d.matches["100"].roundOverride).toBeUndefined();
    expect(matchRound(d.matches["100"])).toBe(1);
  });
  it("setting the override to the natural round clears it", () => {
    let d = setMatchRound(importedFixture(), 100, 1);
    expect(d.matches["100"].roundOverride).toBeUndefined();
  });
  it("roundOverride survives re-import and re-sync", () => {
    let d = setMatchRound(importedFixture(), 100, 14);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [], appearances: [],
    }, NOW + 5);
    expect(matchRound(d.matches["100"])).toBe(14);
    d = upsertMatchStubs(d, [{ eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 }], []);
    expect(matchRound(d.matches["100"])).toBe(14);
  });
});

describe("availability flags", () => {
  it("markOut adds an active flag; clearOut closes it; history retained", () => {
    let d = markOut(importedFixture(), 10, "ACL injury", NOW);
    expect(activeFlag(d.players["10"])).toMatchObject({ note: "ACL injury", setAt: NOW, clearedAt: null });
    d = markOut(d, 10, "second note ignored while active", NOW + 1);
    expect(d.players["10"].flags).toHaveLength(1);
    d = clearOut(d, 10, NOW + 2);
    expect(activeFlag(d.players["10"])).toBeNull();
    expect(d.players["10"].flags[0].clearedAt).toBe(NOW + 2);
    d = markOut(d, 10, "World Cup", NOW + 3);
    expect(d.players["10"].flags).toHaveLength(2);
    expect(activeFlag(d.players["10"]).note).toBe("World Cup");
  });
  it("flags survive re-import", () => {
    let d = markOut(importedFixture(), 10, "suspended", NOW);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [],
    }, NOW + 5);
    expect(activeFlag(d.players["10"]).note).toBe("suspended");
  });
});

describe("playerTotals options", () => {
  it("position override re-scores without changing the stored position", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "DEF");
    expect(playerTotals(d, 10).points).toBe(3 + 2 + 6 + 4);      // fullMatch+win+DEF goal+CS
    expect(playerTotals(d, 10, { position: "FWD" }).points).toBe(3 + 2 + 4); // FWD goal, no CS
    expect(d.players["10"].gamePosition).toBe("DEF");
  });
  it("eventIds filter restricts which matches count", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(playerTotals(d, 10, { eventIds: new Set([100]) }).points).toBe(9);
    const t = playerTotals(d, 10, { eventIds: new Set([999]) });
    expect(t.points).toBe(0);
    expect(t.minutes).toBe(0);
  });
});

describe("mismatchInfo", () => {
  const threeApps = (d) => {
    for (const ev of [101, 102]) {
      d.matches[ev] = { ...d.matches["100"], eventId: ev };
      d.appearances[`${ev}:10`] = { ...d.appearances["100:10"], eventId: ev };
    }
    return d;
  };
  it("favourable: game DEF, really a FWD — positive delta", () => {
    let d = threeApps(setPlayerField(importedFixture(), 10, "gamePosition", "DEF"));
    const mi = mismatchInfo(d, 10);
    expect(mi.realPosition).toBe("FWD");
    expect(mi.delta).toBeGreaterThan(0); // DEF goals (6) + clean sheets beat FWD scoring
  });
  it("unfavourable: game FWD, really a DEF — negative delta", () => {
    let d = threeApps(setPlayerField(importedFixture(), 10, "gamePosition", "FWD"));
    d = setPlayerField(d, 10, "realPosition", "DEF");
    expect(mismatchInfo(d, 10).delta).toBeLessThan(0);
  });
  it("null when no mismatch or too few observations", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(mismatchInfo(d, 10)).toBeNull(); // only 1 appearance, no manual realPosition
    d = setPlayerField(d, 10, "realPosition", "FWD");
    expect(mismatchInfo(d, 10)).toBeNull(); // positions agree
  });
});

describe("review fixes 2", () => {
  it("markOut while already out is a no-op returning the same object", () => {
    const d = markOut(importedFixture(), 10, "first", NOW);
    const d2 = markOut(d, 10, "second", NOW + 1);
    expect(d2).toBe(d); // identity — no clone, no wasted Drive save
  });
  it("appearancesByPlayer indexes once and matches playerAppearances", () => {
    const d = importedFixture();
    const idx = appearancesByPlayer(d);
    expect(idx.get(10)).toEqual(playerAppearances(d, 10));
    expect(idx.get(11)).toHaveLength(1);
  });
  it("playerTotals and mismatchInfo accept a precomputed apps array", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "DEF");
    d = setPlayerField(d, 10, "realPosition", "FWD");
    const apps = appearancesByPlayer(d).get(10);
    expect(playerTotals(d, 10, { apps }).points).toBe(playerTotals(d, 10).points);
    expect(mismatchInfo(d, 10, apps)).toEqual(mismatchInfo(d, 10));
  });
});

describe("postponed hygiene", () => {
  const withShell = () => {
    let d = importedFixture();
    d.matches["200"] = { eventId: 200, round: 1, kickoff: 1764800000000, status: "postponed", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    return d;
  };
  it("isSupersededPostponed: postponed twin of a real same-pairing same-round match", () => {
    const d = withShell();
    expect(isSupersededPostponed(d, d.matches["200"])).toBe(true);
    expect(isSupersededPostponed(d, d.matches["100"])).toBe(false); // the real one
  });
  it("a lone postponed match is not superseded", () => {
    let d = withShell();
    d.matches["200"].awayTeamId = 99; // different pairing
    expect(isSupersededPostponed(d, d.matches["200"])).toBe(false);
  });
  it("staleInfo counts played-but-missing matches, ignoring postponed/superseded", () => {
    let d = withShell();
    const now = 1765000000000;
    d.matches["300"] = { eventId: 300, round: 2, kickoff: now - 4 * 3600 * 1000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0 }; // finished, unimported
    d.matches["301"] = { eventId: 301, round: 2, kickoff: now - 4 * 3600 * 1000, status: "notstarted", homeTeamId: 2, awayTeamId: 1, homeScore: null, awayScore: null }; // stale stub
    d.matches["302"] = { eventId: 302, round: 3, kickoff: now + 4 * 3600 * 1000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null }; // future
    expect(staleInfo(d, now).count).toBe(2); // 300 + 301; shell 200 excluded, 302 future, 100 imported
  });
});
