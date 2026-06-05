// test/store.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, upsertMatchStubs, setPlayerField,
  setAdjustment, deriveRealPosition, playerTotals, positionMismatch,
  applyPasteResults, matchRound, setMatchRound, playerAppearances, appearancesByPlayer,
  markOut, clearOut, activeFlag, mismatchInfo, isSupersededPostponed, staleInfo,
  playerName, missingFantasyData, setTeamColor, roundSuspects,
  isHot, allMatchTeamPoints,
  setAbsence, getAbsence, playerOutNow,
  teamWindowEventIds,
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

describe("identity & data errors", () => {
  it("playerName prefers customName and survives re-import", () => {
    let d = setPlayerField(importedFixture(), 10, "customName", "Aidan Keena ✪");
    expect(playerName(d.players["10"])).toBe("Aidan Keena ✪");
    expect(playerName(d.players["11"])).toBe("B Burke");
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [{ id: 10, name: "A. Keena", teamId: 1 }], appearances: [],
    }, NOW + 1);
    expect(playerName(d.players["10"])).toBe("Aidan Keena ✪");
    expect(d.players["10"].name).toBe("A. Keena");
  });
  it("missingFantasyData flags players with appearances but no game position", () => {
    const d = importedFixture();
    const apps = playerAppearances(d, 10);
    expect(missingFantasyData(d.players["10"], apps)).toBe(true);
    const d2 = setPlayerField(d, 10, "gamePosition", "FWD");
    expect(missingFantasyData(d2.players["10"], apps)).toBe(false);
    expect(missingFantasyData(d.players["10"], [])).toBe(false); // no appearances, nothing to flag
  });
});

describe("team customization", () => {
  it("setTeamColor sets and clears a user colour that survives sync and import", () => {
    let d = setTeamColor(importedFixture(), 1, "#123456");
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = upsertMatchStubs(d, [], [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }]);
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = applyImport(d, {
      match: { eventId: 101, round: 2, kickoff: 1, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0, goalTimes: { home: [], away: [] }, partial: false },
      teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }], players: [], appearances: [],
    }, NOW);
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = setTeamColor(d, 1, null);
    expect(d.teams["1"].colorBg).toBeUndefined();
  });
});

describe("timed availability", () => {
  it("markOut with until expires automatically; expired flags are history", () => {
    const until = NOW + 14 * 86400000; // two weeks
    let d = markOut(importedFixture(), 10, "hamstring", NOW, until);
    expect(activeFlag(d.players["10"], NOW)).toMatchObject({ note: "hamstring", until });
    expect(activeFlag(d.players["10"], until + 1)).toBeNull(); // lapsed
    // lapsed flag doesn't block a new one
    d = markOut(d, 10, "suspended", until + 2);
    expect(activeFlag(d.players["10"], until + 2).note).toBe("suspended");
    expect(d.players["10"].flags).toHaveLength(2);
  });
  it("activeFlag without until stays active regardless of time (back-compat)", () => {
    const d = markOut(importedFixture(), 10, "long-term", NOW);
    expect(activeFlag(d.players["10"], NOW + 999 * 86400000)).toMatchObject({ note: "long-term" });
  });
  it("clearOut clears the ACTIVE flag, not an older lapsed one", () => {
    const until = NOW + 14 * 86400000;
    let d = markOut(importedFixture(), 10, "hamstring", NOW, until);   // lapses later
    d = markOut(d, 10, "suspended", until + 2);                        // new active flag
    d = clearOut(d, 10, until + 3);
    expect(activeFlag(d.players["10"], until + 3)).toBeNull();         // actually available now
    const flags = d.players["10"].flags;
    expect(flags.find((f) => f.note === "suspended").clearedAt).toBe(until + 3);
    expect(flags.find((f) => f.note === "hamstring").clearedAt).toBeNull(); // lapsed naturally, untouched
  });
});

describe("roundSuspects", () => {
  const DAY = 86400000;
  const mk = (eventId, round, day, extra = {}) => ({
    eventId, round, kickoff: NOW + day * DAY, status: "finished",
    homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0, ...extra,
  });
  it("flags a match dated with another round's cluster and suggests it", () => {
    const d = emptyData();
    [[100, 1, 0], [101, 1, 0], [102, 1, 1], [103, 1, 1]].forEach(([id, r, day]) => { d.matches[id] = mk(id, r, day); });
    [[200, 3, 14], [201, 3, 14], [202, 3, 15]].forEach(([id, r, day]) => { d.matches[id] = mk(id, r, day); });
    d.matches[999] = mk(999, 1, 14); // labelled R1, played with the R3 cluster
    const sus = roundSuspects(d);
    expect(sus.get(999)).toBe(3);
    expect(sus.has(100)).toBe(false);
  });
  it("ignores postponed shells and respects roundOverride", () => {
    const d = emptyData();
    d.matches[1] = mk(1, 1, 0);
    d.matches[2] = mk(2, 1, 0);
    d.matches[3] = mk(3, 3, 14);
    d.matches[4] = mk(4, 3, 14);
    d.matches[5] = { ...mk(5, 1, 14), roundOverride: 3 }; // user already fixed it
    d.matches[6] = mk(6, 1, 14, { status: "postponed" });  // shell, ignored
    const sus = roundSuspects(d);
    expect(sus.has(5)).toBe(false);
    expect(sus.has(6)).toBe(false);
  });
});

describe("hot players", () => {
  // helper: clone match 100 into new events with given goals for player 10
  const withForm = (goalsPerMatch) => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    goalsPerMatch.forEach((g, i) => {
      const ev = 500 + i;
      d.matches[ev] = { ...d.matches["100"], eventId: ev, kickoff: d.matches["100"].kickoff + (i + 1) * 1000 };
      d.appearances[`${ev}:10`] = { ...d.appearances["100:10"], eventId: ev, goals: g };
    });
    return d;
  };
  // base appearance scores: fullMatch 3 + win 2 + goals*4 (FWD) => 0 goals = 5, 1 goal = 9
  it("hot when 2 of the last 3 score ≥8", () => {
    const d = withForm([1, 0, 1]); // last 3 = 9, 5, 9
    expect(isHot(d, 10)).toBe(true);
  });
  it("not hot when only 1 of the last 3 scores ≥8", () => {
    const d = withForm([1, 0, 0]); // earlier 9 is pushed out of... last 3 = 9,5,5 → only 1 good
    expect(isHot(d, 10)).toBe(false);
  });
  it("old form does not count — only the last 3 appearances", () => {
    const d = withForm([1, 1, 0, 0, 0]); // last 3 = 5,5,5
    expect(isHot(d, 10)).toBe(false);
  });
  it("needs a game position and at least 2 recent appearances", () => {
    expect(isHot(importedFixture(), 10)).toBe(false); // no position
    const d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(isHot(d, 10)).toBe(false); // single appearance (scored 9, but 1 < 2 needed)
  });
  it("missed team games cool a player off (window = team's last 3 games)", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    // the team plays 4 more matches; the player appears (scoring 9) only in the first
    for (let i = 0; i < 4; i++) {
      const ev = 600 + i;
      d.matches[ev] = { ...d.matches["100"], eventId: ev, kickoff: d.matches["100"].kickoff + (i + 1) * 1000 };
    }
    d.appearances["600:10"] = { ...d.appearances["100:10"], eventId: 600 }; // 9 pts
    // last 3 APPEARANCES are two 9-pointers — but the team's last 3 games (601-603) include none of them
    expect(isHot(d, 10)).toBe(false);
  });
});

describe("allMatchTeamPoints", () => {
  it("sums per-team fantasy points for each imported match", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD"); // 3+2+4 = 9
    d = setPlayerField(d, 11, "gamePosition", "MID");                     // sub 1 + win 2 + assist 3 = 6
    const pts = allMatchTeamPoints(d);
    expect(pts.get(100)).toEqual({ home: 15, away: 0 });
  });
  it("skips positionless players and unimported matches", () => {
    const d = importedFixture(); // nobody has a position
    expect(allMatchTeamPoints(d).get(100)).toEqual({ home: 0, away: 0 });
  });
});

describe("absences", () => {
  it("set, read, overwrite and clear a per-match absence", () => {
    let d = setAbsence(importedFixture(), 100, 10, "ankle knock", NOW);
    expect(getAbsence(d, 100, 10)).toMatchObject({ note: "ankle knock", setAt: NOW });
    d = setAbsence(d, 100, 10, "ankle (4-6 wks)", NOW + 1);
    expect(getAbsence(d, 100, 10).note).toBe("ankle (4-6 wks)");
    d = setAbsence(d, 100, 10, null, NOW + 2);
    expect(getAbsence(d, 100, 10)).toBeNull();
  });
  it("absences survive re-import", () => {
    let d = setAbsence(importedFixture(), 100, 10, "suspended", NOW);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [], appearances: [],
    }, NOW + 5);
    expect(getAbsence(d, 100, 10).note).toBe("suspended");
  });
  it("playerOutNow reports the next upcoming absence, ignoring past ones", () => {
    let d = importedFixture();
    d.matches[700] = { eventId: 700, round: 9, kickoff: NOW + 7 * 86400000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    d.matches[701] = { eventId: 701, round: 10, kickoff: NOW + 14 * 86400000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    expect(playerOutNow(d, 10, NOW)).toBeNull();
    d = setAbsence(d, 100, 10, "was injured", NOW);      // past match — history only
    expect(playerOutNow(d, 10, NOW)).toBeNull();
    d = setAbsence(d, 701, 10, "World Cup", NOW);
    d = setAbsence(d, 700, 10, "World Cup", NOW);
    expect(playerOutNow(d, 10, NOW)).toMatchObject({ note: "World Cup", eventId: 700 }); // soonest upcoming
  });
  it("emptyData includes the absences map", () => {
    expect(emptyData().absences).toEqual({});
  });
});

describe("teamWindowEventIds", () => {
  it("maps each team to its last N imported matches", () => {
    let d = importedFixture();
    for (let i = 0; i < 4; i++) {
      d.matches[800 + i] = { ...d.matches["100"], eventId: 800 + i, kickoff: d.matches["100"].kickoff + (i + 1) * 1000 };
    }
    d.matches[900] = { eventId: 900, round: 9, kickoff: d.matches["100"].kickoff + 9000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null }; // unimported — excluded
    const w = teamWindowEventIds(d, 3);
    expect([...w.get(1)].sort()).toEqual([801, 802, 803]);
    expect([...w.get(2)].sort()).toEqual([801, 802, 803]); // both clubs played the same fixtures here
  });
});
