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
  teamWindowEventIds, leagueTable, leagueOrder,
  hotEventIds,
  playerClimb,
  teamSitePoints,
  applyFantasyRows,
  fantasyOnlyId, addFantasyOnlyPlayers, reconcileFantasyOnly, removeFantasyOnlyPlayer,
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

describe("leagueTable", () => {
  const withSecondMatch = () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    d.matches[101] = {
      ...d.matches["100"], eventId: 101, kickoff: d.matches["100"].kickoff + 1000,
      homeTeamId: 2, awayTeamId: 1, homeScore: 2, awayScore: 2, goalTimes: { home: [10, 20], away: [30, 40] },
    };
    d.appearances["101:10"] = {
      ...d.appearances["100:10"], eventId: 101, goals: 2, penScored: 1, yellow: 1, assists: 1,
    };
    return d;
  };
  it("computes league rows with goals, results and points", () => {
    const t = leagueTable(withSecondMatch(), null);
    const t1 = t.find((r) => r.teamId === 1);
    const t2 = t.find((r) => r.teamId === 2);
    expect(t1).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, gf: 3, ga: 2, points: 4 });
    expect(t2).toMatchObject({ played: 2, won: 0, drawn: 1, lost: 1, gf: 2, ga: 3, points: 1 });
    expect(t[0].teamId).toBe(1); // league order: points desc
  });
  it("sums fantasy points, cards, pens and assists per team", () => {
    const t1 = leagueTable(withSecondMatch(), null).find((r) => r.teamId === 1);
    // match 100: full match 3 + win 2 + goal 4 = 9; match 101: full match 3 + draw 1 + 2 goals 8 + assist 3 − yellow 1 = 14
    expect(t1.fantasy).toBe(23);
    expect(t1).toMatchObject({ yellows: 1, reds: 0, pensScored: 1, pensMissed: 0, assists: 2 });
  });
  it("respects the window (team's last N imported matches)", () => {
    const t1 = leagueTable(withSecondMatch(), 1).find((r) => r.teamId === 1);
    expect(t1).toMatchObject({ played: 1, gf: 2, ga: 2, points: 1 }); // only match 101
  });
  // Two clubs level on points but split by goal difference, imported in the
  // order a points-only sort would leave them in — so the table's row order can
  // only come out right if it really is `leagueOrder` doing the sorting.
  const tiebreakFixture = () => {
    let d = emptyData();
    for (const [eventId, home, away, hs, as] of [[200, 3, 4, 1, 0], [201, 5, 6, 3, 0]]) {
      d = applyImport(d, {
        match: {
          eventId, round: 1, kickoff: 1764900000000 + eventId, status: "finished",
          homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as,
          goalTimes: { home: [], away: [] }, partial: false,
        },
        teams: [3, 4, 5, 6].map((id) => ({ id, name: `C${id}`, shortName: `C${id}` })),
        players: [], appearances: [],
      }, NOW);
    }
    return d;
  };
  it("sorts by leagueOrder, which is therefore the only place levelness is defined", () => {
    const rows = leagueTable(tiebreakFixture(), null);
    // C5 (3 pts, +3) ahead of C3 (3 pts, +1); C4 (-1) ahead of C6 (-3).
    expect(rows.map((r) => r.teamId)).toEqual([5, 3, 4, 6]);
    for (let i = 1; i < rows.length; i++) expect(leagueOrder(rows[i - 1], rows[i])).toBeLessThan(0);
    expect([...rows].reverse().sort(leagueOrder)).toEqual(rows);
  });
});

describe("leagueOrder", () => {
  const row = (points, gf, ga) => ({ points, gf, ga });
  it("ranks on points, then goal difference, then goals scored", () => {
    expect(leagueOrder(row(9, 5, 5), row(8, 9, 0))).toBeLessThan(0);    // points first
    expect(leagueOrder(row(8, 9, 0), row(8, 4, 0))).toBeLessThan(0);    // then difference
    expect(leagueOrder(row(8, 6, 2), row(8, 5, 1))).toBeLessThan(0);    // then goals scored
    expect(leagueOrder(row(8, 5, 1), row(8, 6, 2))).toBeGreaterThan(0);
  });
  it("returns 0 only for clubs it cannot separate", () => {
    expect(leagueOrder(row(8, 5, 1), row(8, 5, 1))).toBe(0);
    expect(leagueOrder(row(8, 5, 1), row(8, 6, 2))).not.toBe(0); // same difference, more goals
  });
});

describe("hotEventIds", () => {
  const appOf = (eventId, over = {}) => ({
    eventId, playerId: 50, teamId: 7, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...over,
  });
  const matchOf = (eventId, round, kickoff, homeScore, awayScore, goalTimes) => ({
    eventId, round, kickoff, status: "finished", homeTeamId: 7, awayTeamId: 8,
    homeScore, awayScore, goalTimes, partial: false,
  });
  function hotFixture() {
    let d = emptyData();
    const imports = [
      { match: matchOf(301, 1, NOW + 1000, 2, 0, { home: [10, 20], away: [] }),
        appearances: [appOf(301, { goals: 1 })] },
      { match: matchOf(302, 2, NOW + 2000, 1, 1, { home: [30], away: [60] }),
        appearances: [appOf(302, { goals: 1 })] },
      { match: matchOf(303, 3, NOW + 3000, 0, 1, { home: [], away: [70] }),
        appearances: [appOf(303)] },
      { match: matchOf(304, 4, NOW + 4000, 0, 0, { home: [], away: [] }),
        appearances: [] },
    ];
    for (const imp of imports) {
      d = applyImport(d, {
        ...imp,
        teams: [{ id: 7, name: "Hot FC", shortName: "HOT" }, { id: 8, name: "Cold FC", shortName: "COL" }],
        players: [{ id: 50, name: "S Treak", teamId: 7 }],
      }, NOW);
    }
    return setPlayerField(d, 50, "gamePosition", "FWD");
  }
  it("flags matches after which the trailing window satisfies the hot rule", () => {
    expect([...hotEventIds(hotFixture(), 50)].sort()).toEqual([302, 303]);
  });
  it("exactly 8 points counts (>= threshold)", () => {
    // M302 scores exactly 8 and is one of the two qualifying games for both flames
    expect(hotEventIds(hotFixture(), 50).has(302)).toBe(true);
  });
  it("sitting out consumes a window slot", () => {
    // after M304 the window is [8, 3, absent] -> only one qualifying game
    expect(hotEventIds(hotFixture(), 50).has(304)).toBe(false);
  });
  it("needs at least two team matches in the window", () => {
    expect(hotEventIds(hotFixture(), 50).has(301)).toBe(false);
  });
  it("is empty for positionless players", () => {
    const d = setPlayerField(hotFixture(), 50, "gamePosition", null);
    expect(hotEventIds(d, 50).size).toBe(0);
  });
  it("agrees with isHot on the latest match", () => {
    const d = hotFixture();
    expect(isHot(d, 50)).toBe(hotEventIds(d, 50).has(304));
  });
  it("adjustments can flip a flame", () => {
    // +2 goals on M303 lifts it 3 -> 11: the window after M304 becomes [8, 11, absent]
    const d = setAdjustment(hotFixture(), "303:50", { goals: 2 });
    expect(hotEventIds(d, 50).has(304)).toBe(true);
    expect(isHot(d, 50)).toBe(true); // and the row flame agrees
  });
});

describe("applyPasteResults two-column rows", () => {
  it("price paste sets price and sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "price", NOW);
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
  it("old single-number price paste still works and stores no sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 10.5 }], "price", NOW);
    expect(d.players["10"].price).toBe(10.5);
    expect(d.players["10"].sitePoints ?? null).toBeNull();
  });
  it("position paste with a price enriches position, price and sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "GK", NOW);
    expect(d.players["10"].gamePosition).toBe("GK");
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
  it("manual position survives an enriched position paste; price still applies", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    d = applyPasteResults(d, [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "GK", NOW);
    expect(d.players["10"].gamePosition).toBe("FWD");
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
});

describe("playerClimb", () => {
  const appC = (eventId, playerId, over = {}) => ({
    eventId, playerId, teamId: 11, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...over,
  });
  const matchC = (eventId, round, kickoff, homeScore, awayScore, goalTimes) => ({
    eventId, round, kickoff, status: "finished", homeTeamId: 11, awayTeamId: 12,
    homeScore, awayScore, goalTimes, partial: false,
  });
  function climbFixture() {
    let d = emptyData();
    const imports = [
      { match: matchC(401, 1, NOW + 1000, 0, 1, { home: [], away: [50] }),
        appearances: [appC(401, 60), appC(401, 61, { positionPlayed: "M", assists: 1 })] },
      { match: matchC(402, 2, NOW + 2000, 0, 2, { home: [], away: [20, 70] }),
        appearances: [appC(402, 60), appC(402, 61, { positionPlayed: "M" })] },
      { match: matchC(403, 3, NOW + 3000, 2, 0, { home: [10, 20], away: [] }),
        appearances: [appC(403, 60, { goals: 1 })] },
      { match: matchC(404, 4, NOW + 4000, 3, 0, { home: [5, 15, 25], away: [] }),
        appearances: [appC(404, 60, { goals: 2 })] },
    ];
    for (const imp of imports) {
      d = applyImport(d, {
        ...imp,
        teams: [{ id: 11, name: "Climb FC", shortName: "CLI" }, { id: 12, name: "Sink FC", shortName: "SNK" }],
        players: [{ id: 60, name: "U Pward", teamId: 11 }, { id: 61, name: "D Ownward", teamId: 11 }],
      }, NOW);
    }
    d = setPlayerField(d, 60, "gamePosition", "FWD");
    d = setPlayerField(d, 61, "gamePosition", "MID");
    return d;
  }
  const win3 = (d) => teamWindowEventIds(d, 3).get(11);
  it("positive for an improving player (per team-match, window vs prior)", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: win3(d) })).toBeCloseTo(16 / 3, 5);
  });
  it("negative for a declining player; absences drag the window down", () => {
    const d = climbFixture();
    expect(playerClimb(d, 61, { windowIds: win3(d) })).toBeCloseTo(-5, 5);
  });
  it("null when the window spans all imported matches (no baseline)", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: teamWindowEventIds(d, 5).get(11) })).toBeNull();
  });
  it("null without a fantasy position", () => {
    const d = setPlayerField(climbFixture(), 60, "gamePosition", null);
    expect(playerClimb(d, 60, { windowIds: win3(d) })).toBeNull();
  });
  it("null for an empty or missing window", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: new Set() })).toBeNull();
    expect(playerClimb(d, 60, {})).toBeNull();
  });
});

describe("pens + site totals", () => {
  it("playerTotals aggregates penalties scored, adjustment-aware", () => {
    let d = importedFixture();
    d.appearances["100:10"].penScored = 1;
    expect(playerTotals(d, 10).pens).toBe(1);
    d = setAdjustment(d, "100:10", { penScored: 1 });
    expect(playerTotals(d, 10).pens).toBe(2);
  });
  it("playerTotals pens is 0 when nothing scored", () => {
    expect(playerTotals(importedFixture(), 10).pens).toBe(0);
  });
  it("teamSitePoints sums per team and counts coverage", () => {
    let d = importedFixture(); // players 10 and 11, both team 1
    d = applyPasteResults(d, [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "price", NOW);
    expect(teamSitePoints(d).get(1)).toEqual({ site: 25, withData: 1, missing: 1 });
  });
});

describe("emptyData meta", () => {
  it("includes a null sofascoreToken slot", () => {
    expect(emptyData().meta.sofascoreToken).toBe(null);
  });
});

describe("applyFantasyRows", () => {
  const row = (over) => ({ playerId: "10", name: "A Keena", clubId: "1", teamId: "1",
    gamePosition: "FWD", price: 8.3, sitePoints: 137, ...over });

  it("writes price, timestamp, site points and position", () => {
    const d = applyFantasyRows(importedFixture(), [row()], NOW);
    expect(d.players["10"]).toMatchObject({
      price: 8.3, priceUpdatedAt: NOW, sitePoints: 137,
      gamePosition: "FWD", gamePositionSource: "fantasy",
    });
  });
  it("never clobbers a manually set position", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    d = applyFantasyRows(d, [row()], NOW);
    expect(d.players["10"]).toMatchObject({ gamePosition: "MID", gamePositionSource: "manual" });
    expect(d.players["10"].price).toBe(8.3); // the rest of the row still applies
  });
  it("a null field leaves the stored value alone", () => {
    let d = applyFantasyRows(importedFixture(), [row()], NOW);
    d = applyFantasyRows(d, [row({ price: null, sitePoints: null, gamePosition: null })], NOW + 1);
    expect(d.players["10"]).toMatchObject({ price: 8.3, priceUpdatedAt: NOW, sitePoints: 137, gamePosition: "FWD" });
  });
  it("remembers a manual-link alias", () => {
    const d = applyFantasyRows(importedFixture(), [row({ alias: "A. Keena (FLOI)" })], NOW);
    expect(d.players["10"].pasteAlias).toBe("A. Keena (FLOI)");
  });
  it("ignores rows for unknown players and does not mutate the input", () => {
    const before = importedFixture();
    const snapshot = JSON.stringify(before);
    const d = applyFantasyRows(before, [row({ playerId: "999" })], NOW);
    expect(d.players["999"]).toBeUndefined();
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it("emptyData carries an empty fantasyClubMap", () => {
    expect(emptyData().meta.fantasyClubMap).toEqual({});
  });
});

describe("fantasyOnlyId", () => {
  it("is deterministic, colon-free and non-numeric", () => {
    const id = fantasyOnlyId("Danny Mandroiu", 2334);
    expect(id).toBe("fx-danny-mandroiu-2334");
    expect(id).toBe(fantasyOnlyId("Danny Mandroiu", "2334"));
    expect(id).not.toContain(":");
    expect(Number.isNaN(Number(id))).toBe(true);
  });
  it("absorbs punctuation and case the way name matching does", () => {
    expect(fantasyOnlyId("Se\u00e1n O'Connor", 1)).toBe(fantasyOnlyId("Sean OConnor", 1));
  });
  it("refuses a row with no club or no usable name", () => {
    expect(fantasyOnlyId("Danny Mandroiu", null)).toBe(null);
    expect(fantasyOnlyId("   ", 1)).toBe(null);
  });
});

const GHOST_ROW = { name: "Danny Mandroiu", teamId: 1, gamePosition: "MID", price: 6.5, sitePoints: 0 };

describe("addFantasyOnlyPlayers", () => {
  it("creates a flagged record with the captured fields and default user fields", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    const p = d.players["fx-danny-mandroiu-1"];
    expect(p).toMatchObject({
      name: "Danny Mandroiu", teamId: 1, fantasyOnly: true,
      gamePosition: "MID", gamePositionSource: "fantasy",
      price: 6.5, priceUpdatedAt: NOW, sitePoints: 0,
      starred: false, inSquad: false, customName: null,
    });
  });
  it("skips a row whose club never resolved", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [{ ...GHOST_ROW, teamId: null }], NOW);
    expect(Object.keys(d.players).filter((k) => k.startsWith("fx-"))).toEqual([]);
  });
  it("refreshes captured fields on re-import without touching user-owned ones", () => {
    let d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "starred", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "gamePosition", "FWD"); // manual
    d = addFantasyOnlyPlayers(d, [{ ...GHOST_ROW, price: 6.1, sitePoints: 3 }], NOW + 1);
    const p = d.players["fx-danny-mandroiu-1"];
    expect(p.price).toBe(6.1);
    expect(p.priceUpdatedAt).toBe(NOW + 1);
    expect(p.sitePoints).toBe(3);
    expect(p.starred).toBe(true);
    expect(p.gamePosition).toBe("FWD");
    expect(p.gamePositionSource).toBe("manual");
    expect(Object.keys(d.players).filter((k) => k.startsWith("fx-"))).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const before = importedFixture();
    const snapshot = JSON.stringify(before);
    addFantasyOnlyPlayers(before, [GHOST_ROW], NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// A ghost on team 1, plus the real SofaScore record arriving later.
function withGhost(name = "Danny Mandroiu") {
  return addFantasyOnlyPlayers(importedFixture(), [{ ...GHOST_ROW, name }], NOW);
}
function playedMatch(eventId, kickoff, id, name, teamId = 1) {
  return {
    match: {
      eventId, round: 2, kickoff, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0,
      goalTimes: { home: [], away: [] }, partial: false,
    },
    teams: [],
    players: [{ id, name, teamId }],
    appearances: [{ eventId, playerId: id, teamId, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "M", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
  };
}
function debut(d, id, name) {
  return applyImport(d, playedMatch(101, 1765000000000, id, name), NOW);
}

describe("reconcileFantasyOnly", () => {
  it("merges on an exact name match and deletes the ghost", () => {
    const d = reconcileFantasyOnly(debut(withGhost(), 99, "Danny Mandroiu"));
    expect(d.players["fx-danny-mandroiu-1"]).toBeUndefined();
    expect(d.players["99"].name).toBe("Danny Mandroiu");
  });
  it("merges on a surname+initial match (D. Mandroiu vs Danny Mandroiu)", () => {
    const d = reconcileFantasyOnly(debut(withGhost(), 99, "D. Mandroiu"));
    expect(d.players["fx-danny-mandroiu-1"]).toBeUndefined();
    expect(d.players["99"].price).toBe(6.5);
  });
  it("carries user-owned fields and fills only empty captured fields", () => {
    let d = withGhost();
    d = setPlayerField(d, "fx-danny-mandroiu-1", "starred", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "inSquad", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "customName", "Mandroiu");
    d = markOut(d, "fx-danny-mandroiu-1", "hamstring", NOW);
    d = reconcileFantasyOnly(debut(d, 99, "Danny Mandroiu"));
    const p = d.players["99"];
    expect(p.starred).toBe(true);
    expect(p.inSquad).toBe(true);
    expect(p.customName).toBe("Mandroiu");
    expect(activeFlag(p, NOW).note).toBe("hamstring");
    expect(p.price).toBe(6.5);
    expect(p.sitePoints).toBe(0);
  });
  it("rekeys absences from the ghost id to the real id", () => {
    let d = setAbsence(withGhost(), 100, "fx-danny-mandroiu-1", "suspended", NOW);
    d = reconcileFantasyOnly(debut(d, 99, "Danny Mandroiu"));
    expect(getAbsence(d, 100, "fx-danny-mandroiu-1")).toBe(null);
    expect(getAbsence(d, 100, 99).note).toBe("suspended");
  });
  it("refuses to guess when two real team-mates match", () => {
    let d = debut(withGhost(), 99, "Danny Mandroiu");
    d = applyImport(d, playedMatch(102, 1765100000000, 98, "D. Mandroiu"), NOW);
    expect(reconcileFantasyOnly(d).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
  it("leaves the ghost alone while nobody matches, and returns data unchanged", () => {
    const d = withGhost();
    expect(reconcileFantasyOnly(d)).toBe(d);
    const other = debut(withGhost(), 99, "Someone Else");
    expect(reconcileFantasyOnly(other).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
  it("does not match a same-named player at a different club", () => {
    const away = applyImport(withGhost(), playedMatch(103, 1765200000000, 97, "Danny Mandroiu", 2), NOW);
    expect(reconcileFantasyOnly(away).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
});

describe("playerClimb with no appearances", () => {
  it("is null rather than a negative for a player who has never played", () => {
    // TWO imported team matches, window of 1: the baseline set must be non-empty or
    // playerClimb short-circuits to null on its own and the test proves nothing.
    const d = addFantasyOnlyPlayers(debut(importedFixture(), 99, "Someone Else"), [GHOST_ROW], NOW);
    const windowIds = teamWindowEventIds(d, 1).get(1);
    expect(windowIds.size).toBe(1);
    expect(playerClimb(d, "fx-danny-mandroiu-1", { windowIds })).toBe(null);
  });
});

describe("fantasy-only players are invisible to derived stats", () => {
  it("leaves leagueTable, hotEventIds and allMatchTeamPoints untouched", () => {
    const base = importedFixture();
    const withG = addFantasyOnlyPlayers(base, [GHOST_ROW], NOW);
    expect(leagueTable(withG)).toEqual(leagueTable(base));
    expect(allMatchTeamPoints(withG)).toEqual(allMatchTeamPoints(base));
    expect([...hotEventIds(withG, "fx-danny-mandroiu-1")]).toEqual([]);
    expect(isHot(withG, "fx-danny-mandroiu-1")).toBe(false);
  });
  it("reports zeroed totals and no appearances", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    expect(playerAppearances(d, "fx-danny-mandroiu-1")).toEqual([]);
    expect(playerTotals(d, "fx-danny-mandroiu-1")).toMatchObject({
      minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: 0,
    });
    expect(missingFantasyData(d.players["fx-danny-mandroiu-1"], [])).toBe(false);
    expect(mismatchInfo(d, "fx-danny-mandroiu-1")).toBe(null);
  });
  it("counts their site points in teamSitePoints, like the official table does", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    expect(teamSitePoints(d).get(1).withData).toBe(1);
  });
});

describe("reconcileFantasyOnly position carry-over", () => {
  it("gives the real record the ghost's captured position when it has none", () => {
    // Regression: found against a real capture. The ghost's position is sourced
    // "fantasy", not "manual", so the manual-only branch skipped it and a freshly
    // debuted player showed ❗ "no fantasy data" until the next price capture.
    const d = reconcileFantasyOnly(debut(withGhost(), 99, "Danny Mandroiu"));
    expect(d.players["99"].gamePosition).toBe("MID");
    expect(d.players["99"].gamePositionSource).toBe("fantasy");
  });
  it("never overwrites a position the real record already has", () => {
    let d = withGhost();
    d = applyImport(d, playedMatch(101, 1765000000000, 99, "Danny Mandroiu"), NOW);
    d = setPlayerField(d, 99, "gamePosition", "FWD"); // manual, on the real record
    d = reconcileFantasyOnly(d);
    expect(d.players["99"].gamePosition).toBe("FWD");
    expect(d.players["99"].gamePositionSource).toBe("manual");
  });
});

describe("removeFantasyOnlyPlayer", () => {
  it("deletes a ghost and its absences", () => {
    let d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    d = setAbsence(d, 100, "fx-danny-mandroiu-1", "injured", NOW);
    d = removeFantasyOnlyPlayer(d, "fx-danny-mandroiu-1");
    expect(d.players["fx-danny-mandroiu-1"]).toBeUndefined();
    expect(getAbsence(d, 100, "fx-danny-mandroiu-1")).toBe(null);
  });
  it("refuses a real SofaScore player", () => {
    const d = importedFixture();
    expect(removeFantasyOnlyPlayer(d, 10)).toBe(d);
    expect(removeFantasyOnlyPlayer(d, 10).players["10"]).toBeDefined();
  });
  it("refuses a ghost that somehow has appearances", () => {
    let d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    d.appearances["100:fx-danny-mandroiu-1"] = { eventId: 100, playerId: "fx-danny-mandroiu-1", teamId: 1, started: true, minutes: 90, goals: 0, assists: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 };
    expect(removeFantasyOnlyPlayer(d, "fx-danny-mandroiu-1")).toBe(d);
  });
});
