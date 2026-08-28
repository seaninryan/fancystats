// test/fixtures.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport } from "../src/lib/store.js";
import { fixtureContext, compareFixture } from "../src/lib/fixtures.js";

const NOW = 1765000000000;
const DAY = 86400000;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
  { id: 3, name: "Derry City", shortName: "DER" },
  { id: 4, name: "Sligo Rovers", shortName: "SLI" },
];

// One appearance per scorer so the fantasy column has something in it.
function app(eventId, playerId, teamId, goals = 0) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// results: [{ eventId, round, kickoff, home, away, hs, as }]
// Each club gets one player, id = 10 + teamId, position FWD via `players` +
// setPlayerField in the caller when fantasy points matter.
function seed(results) {
  let d = emptyData();
  for (const r of results) {
    d = applyImport(d, {
      match: {
        eventId: r.eventId, round: r.round, kickoff: r.kickoff, status: "finished",
        homeTeamId: r.home, awayTeamId: r.away, homeScore: r.hs, awayScore: r.as,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [
        { id: 10 + r.home, name: `P${r.home}`, teamId: r.home },
        { id: 10 + r.away, name: `P${r.away}`, teamId: r.away },
      ],
      appearances: [
        app(r.eventId, 10 + r.home, r.home, r.hs),
        app(r.eventId, 10 + r.away, r.away, r.as),
      ],
    }, NOW);
  }
  return d;
}

// SHE win everything, BOH lose everything, DER/SLI split.
function fourTeamSeason() {
  return seed([
    { eventId: 101, round: 1, kickoff: NOW - 5 * DAY, home: 1, away: 2, hs: 3, as: 0 },
    { eventId: 102, round: 1, kickoff: NOW - 5 * DAY, home: 3, away: 4, hs: 1, as: 1 },
    { eventId: 103, round: 2, kickoff: NOW - 4 * DAY, home: 1, away: 3, hs: 2, as: 0 },
    { eventId: 104, round: 2, kickoff: NOW - 4 * DAY, home: 4, away: 2, hs: 2, as: 0 },
    { eventId: 105, round: 3, kickoff: NOW - 3 * DAY, home: 1, away: 4, hs: 1, as: 0 },
    { eventId: 106, round: 3, kickoff: NOW - 3 * DAY, home: 2, away: 3, hs: 0, as: 2 },
  ]);
}

describe("fixtureContext", () => {
  it("ranks every club in the all-time and both form tables", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(ctx.teamCount).toBe(4);
    expect(ctx.pos.get("1")).toBe(1);   // SHE won all three
    expect(ctx.pos.get("2")).toBe(4);   // BOH lost all three
    for (const id of ["1", "2", "3", "4"]) {
      expect(ctx.pos3.get(id)).toBeGreaterThan(0);
      expect(ctx.pos5.get(id)).toBeGreaterThan(0);
    }
  });

  it("exposes per-game rates and non-negative league spreads", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const she = ctx.rows.get("1");
    expect(she.played).toBe(3);
    expect(she.points).toBe(9);
    expect(ctx.ppgSpread).toBeGreaterThan(0);
    expect(ctx.fpgSpread).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty context with no imported matches", () => {
    const ctx = fixtureContext(emptyData());
    expect(ctx.teamCount).toBe(0);
    expect(ctx.ppgSpread).toBe(0);
  });
});
