// test/series.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, setPlayerField, setAdjustment, setMatchRound, upsertMatchStubs,
} from "../src/lib/store.js";
// NOTE: import only what exists so far — Tasks 3-5 each add their function here.
import { importedRounds, accumulate } from "../src/lib/series.js";

const NOW = 1765000000000;

const app = (over) => ({
  started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F",
  goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false,
  penMissed: 0, penSaved: 0, ...over,
});

// Rounds 1, 2 and 4 imported; round 3 deliberately empty -> a gap for everyone.
function fixture() {
  let d = emptyData();
  d = applyImport(d, {
    match: { eventId: 100, round: 1, kickoff: 1764000000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }, { id: 20, name: "C Smith", teamId: 2 }],
    appearances: [
      app({ eventId: 100, playerId: 10, teamId: 1, goals: 1 }),
      app({ eventId: 100, playerId: 20, teamId: 2, positionPlayed: "M" }),
    ],
  }, NOW);
  d = applyImport(d, {
    match: { eventId: 101, round: 2, kickoff: 1764600000000, status: "finished", homeTeamId: 2, awayTeamId: 1, homeScore: 2, awayScore: 2, goalTimes: { home: [10, 50], away: [30, 70] }, partial: false },
    teams: [], players: [],
    appearances: [
      app({ eventId: 101, playerId: 10, teamId: 1, subOffMin: 60, minutes: 60 }),
      app({ eventId: 101, playerId: 20, teamId: 2, positionPlayed: "M", assists: 1, yellow: 1 }),
    ],
  }, NOW);
  d = applyImport(d, {
    match: { eventId: 102, round: 4, kickoff: 1765800000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 3, awayScore: 0, goalTimes: { home: [10, 20, 30], away: [] }, partial: false },
    teams: [], players: [],
    appearances: [
      app({ eventId: 102, playerId: 20, teamId: 2, positionPlayed: "M", yellow: 1, secondYellow: true, subOffMin: 80, minutes: 80 }),
    ],
  }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  d = setPlayerField(d, 20, "gamePosition", "MID");
  return d;
}

const values = (series) => series.map((p) => p.value);
const rounds = (series) => series.map((p) => p.round);

describe("importedRounds", () => {
  it("is empty with no imported matches", () => {
    expect(importedRounds(emptyData())).toEqual([]);
  });
  it("spans min..max imported round inclusive, keeping empty rounds on the axis", () => {
    expect(importedRounds(fixture())).toEqual([1, 2, 3, 4]);
  });
  it("ignores un-imported stubs", () => {
    const d = upsertMatchStubs(fixture(), [
      { eventId: 200, round: 8, kickoff: 1766000000000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null },
    ], []);
    expect(importedRounds(d)).toEqual([1, 2, 3, 4]);
  });
  it("respects roundOverride", () => {
    const d = setMatchRound(fixture(), 102, 3);
    expect(importedRounds(d)).toEqual([1, 2, 3]);
  });
});

describe("accumulate", () => {
  it("keeps running total across gaps without breaking the sum", () => {
    expect(accumulate([
      { round: 1, value: 2 }, { round: 2, value: null }, { round: 3, value: 5 },
    ])).toEqual([
      { round: 1, value: 2 }, { round: 2, value: null }, { round: 3, value: 7 },
    ]);
  });
  it("handles empty input", () => {
    expect(accumulate([])).toEqual([]);
  });
});
