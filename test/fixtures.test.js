// test/fixtures.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setPlayerField, setAdjustment } from "../src/lib/store.js";
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

describe("compareFixture", () => {
  const upcoming = (home, away) => ({
    eventId: 900, round: 4, kickoff: NOW + DAY, status: "notstarted",
    homeTeamId: home, awayTeamId: away, homeScore: null, awayScore: null,
  });

  it("returns both sides with position, points, form and fantasy", () => {
    const d = fourTeamSeason();
    const cmp = compareFixture(fixtureContext(d), upcoming(1, 2));
    expect(cmp.home.teamId).toBe("1");
    expect(cmp.away.teamId).toBe("2");
    expect(cmp.home.pos).toBe(1);
    expect(cmp.away.pos).toBe(4);
    expect(cmp.home.points).toBe(9);
    expect(cmp.away.points).toBe(0);
    expect(cmp.home.played).toBe(3);
    expect(cmp.home.form3).toBeGreaterThan(0);
    expect(cmp.home.form5).toBeGreaterThan(0);
    expect(cmp.home.teamCount).toBe(4);
    expect(typeof cmp.home.fantasy).toBe("number");
  });

  it("scores the stronger side positive from the home perspective", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(compareFixture(ctx, upcoming(1, 2)).score).toBeGreaterThan(0);
    expect(compareFixture(ctx, upcoming(2, 1)).score).toBeLessThan(0);
  });

  it("mirrors: swapping the sides negates the score and keeps the favoured club", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const a = compareFixture(ctx, upcoming(1, 2));
    const b = compareFixture(ctx, upcoming(2, 1));
    expect(a.score).toBeCloseTo(-b.score, 10);
    expect(a.favoured.teamId).toBe("1");
    expect(b.favoured.teamId).toBe("1");
  });

  it("grades by magnitude and names the reasons", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const cmp = compareFixture(ctx, upcoming(1, 2)); // 1st v 4th, biggest gap available
    expect(["slight", "strong", "mismatch"]).toContain(cmp.favoured.grade);
    expect(cmp.favoured.tag).toMatch(/^🎯+$/u); // /u: the emoji is a surrogate pair
    expect(cmp.favoured.reasons.join(" ")).toMatch(/position \+3/);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("points +"))).toBe(true);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("form "))).toBe(true);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("fantasy "))).toBe(true);
  });

  it("leaves evenly matched clubs untagged", () => {
    // DER and SLI drew with each other and each beat/lost to the same clubs once.
    const d = seed([
      { eventId: 201, round: 1, kickoff: NOW - 3 * DAY, home: 3, away: 4, hs: 1, as: 1 },
      { eventId: 202, round: 2, kickoff: NOW - 2 * DAY, home: 4, away: 3, hs: 2, as: 2 },
    ]);
    const cmp = compareFixture(fixtureContext(d), upcoming(3, 4));
    expect(cmp.score).toBeCloseTo(0, 10);
    expect(cmp.favoured).toBeNull();
  });

  it("returns null when either club has no imported matches", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(compareFixture(ctx, upcoming(1, 99))).toBeNull();
    expect(compareFixture(ctx, upcoming(99, 1))).toBeNull();
    expect(compareFixture(fixtureContext(emptyData()), upcoming(1, 2))).toBeNull();
  });

  it("never yields NaN when a league metric has zero spread", () => {
    // Two clubs, one draw: identical on every metric, so every spread is 0.
    const d = seed([{ eventId: 301, round: 1, kickoff: NOW - DAY, home: 1, away: 2, hs: 0, as: 0 }]);
    const cmp = compareFixture(fixtureContext(d), upcoming(1, 2));
    expect(Number.isNaN(cmp.score)).toBe(false);
    expect(cmp.score).toBeCloseTo(0, 10);
  });

  it("counts team fantasy points — including an adjustment — in the score", () => {
    // Two clubs, two 1-1 draws: dead level on position, points and form, so the
    // fantasy component is the only thing that can move the score.
    let d = seed([
      { eventId: 401, round: 1, kickoff: NOW - 2 * DAY, home: 1, away: 2, hs: 1, as: 1 },
      { eventId: 402, round: 2, kickoff: NOW - DAY, home: 2, away: 1, hs: 1, as: 1 },
    ]);
    d = setPlayerField(d, 11, "gamePosition", "FWD");
    d = setPlayerField(d, 12, "gamePosition", "FWD");

    const level = fixtureContext(d);
    expect(level.rows.get("1").fantasy).toBeGreaterThan(0);
    expect(level.rows.get("1").fantasy).toBe(level.rows.get("2").fantasy);
    expect(level.fpgSpread).toBe(0);
    expect(compareFixture(level, upcoming(1, 2)).score).toBeCloseTo(0, 10);

    // A user correction on SHE's forward is now the only difference between them:
    // the whole score is the fantasy component at full strength (weight 0.20).
    const adjusted = fixtureContext(setAdjustment(d, "401:11", { assists: 1 }));
    expect(adjusted.rows.get("1").fantasy).toBeGreaterThan(adjusted.rows.get("2").fantasy);
    expect(adjusted.fpgSpread).toBeGreaterThan(0);
    const cmp = compareFixture(adjusted, upcoming(1, 2));
    expect(cmp.parts.fpg).toBeCloseTo(1, 10);
    expect(cmp.parts.pos).toBe(0);
    expect(cmp.score).toBeCloseTo(0.2, 10);
    expect(cmp.favoured.teamId).toBe("1");
    expect(cmp.favoured.reasons).toContain("fantasy +1.5/game");
  });

  it("keeps the score inside [-1, 1]", () => {
    const ctx = fixtureContext(fourTeamSeason());
    for (const m of [upcoming(1, 2), upcoming(2, 1), upcoming(3, 4)]) {
      const s = compareFixture(ctx, m).score;
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
