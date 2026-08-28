import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setPlayerField, setAdjustment } from "../src/lib/store.js";
import { fixtureContext, compareFixture } from "../src/lib/fixtures.js";

const NOW = 1765000000000;
const DAY = 86400000;
const ago = (days) => NOW - days * DAY;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
  { id: 3, name: "Derry City", shortName: "DER" },
  { id: 4, name: "Sligo Rovers", shortName: "SLI" },
  { id: 5, name: "Galway United", shortName: "GAL" },
];

function app(eventId, playerId, teamId, goals = 0) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// results: [{ eventId, kickoff, home, away, hs, as }] — hs/as null models an
// imported-but-unplayed event, exactly what sofascore normalize() produces.
// Each club gets one player, id = 10 + teamId; give it a gamePosition in the
// caller when fantasy points matter.
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
        app(r.eventId, 10 + r.home, r.home, r.hs ?? 0),
        app(r.eventId, 10 + r.away, r.away, r.as ?? 0),
      ],
    }, NOW);
  }
  return d;
}

// Six rounds, four clubs, six matches each — so the all-time, last-3 and last-5
// tables genuinely differ. SHE front-load their wins, BOH back-load theirs, so
// the two finish level on points while their recent form is opposite. DER and
// SLI mirror each other exactly.
const sixRoundSeason = () => seed([
  { eventId: 101, round: 1, kickoff: ago(19), home: 1, away: 2, hs: 2, as: 0 },
  { eventId: 102, round: 1, kickoff: ago(19), home: 3, away: 4, hs: 1, as: 1 },
  { eventId: 103, round: 2, kickoff: ago(18), home: 1, away: 3, hs: 2, as: 0 },
  { eventId: 104, round: 2, kickoff: ago(18), home: 4, away: 2, hs: 2, as: 0 },
  { eventId: 105, round: 3, kickoff: ago(17), home: 1, away: 4, hs: 2, as: 0 },
  { eventId: 106, round: 3, kickoff: ago(17), home: 2, away: 3, hs: 0, as: 2 },
  { eventId: 107, round: 4, kickoff: ago(16), home: 2, away: 1, hs: 2, as: 0 },
  { eventId: 108, round: 4, kickoff: ago(16), home: 4, away: 3, hs: 1, as: 1 },
  { eventId: 109, round: 5, kickoff: ago(15), home: 3, away: 1, hs: 2, as: 0 },
  { eventId: 110, round: 5, kickoff: ago(15), home: 2, away: 4, hs: 2, as: 0 },
  { eventId: 111, round: 6, kickoff: ago(14), home: 4, away: 1, hs: 2, as: 0 },
  { eventId: 112, round: 6, kickoff: ago(14), home: 3, away: 2, hs: 0, as: 2 },
]);

// SHE's only scored match is its oldest; everything since is an imported event
// with no score, so SHE drops out of the form tables while staying in the
// all-time one. The other clubs keep a scored match inside their last 3.
const staleImports = (extra = []) => seed([
  { eventId: 701, round: 1, kickoff: ago(20), home: 1, away: 5, hs: 1, as: 0 },
  { eventId: 702, round: 2, kickoff: ago(18), home: 2, away: 3, hs: 2, as: 0 },
  { eventId: 703, round: 2, kickoff: ago(18), home: 4, away: 5, hs: 1, as: 1 },
  { eventId: 704, round: 3, kickoff: ago(16), home: 2, away: 4, hs: 1, as: 0 },
  { eventId: 705, round: 3, kickoff: ago(16), home: 3, away: 5, hs: 0, as: 2 },
  { eventId: 706, round: 4, kickoff: ago(14), home: 2, away: 5, hs: 1, as: 1 },
  { eventId: 707, round: 4, kickoff: ago(14), home: 3, away: 4, hs: 2, as: 1 },
  { eventId: 708, round: 5, kickoff: ago(3), home: 1, away: 2, hs: null, as: null },
  { eventId: 709, round: 5, kickoff: ago(2), home: 3, away: 1, hs: null, as: null },
  { eventId: 710, round: 6, kickoff: ago(1), home: 4, away: 1, hs: null, as: null },
  ...extra,
]);

// Three unscored imports leave SHE out of the last-3 table but still inside the
// last-5 one, so count3 < count5 < teamCount.
const unevenFormTables = () => staleImports();

// Two more unscored imports and SHE is out of both form tables.
const noRecentResults = () => staleImports([
  { eventId: 711, round: 6, kickoff: ago(1) + 3600000, home: 5, away: 1, hs: null, as: null },
  { eventId: 712, round: 7, kickoff: ago(1) + 7200000, home: 1, away: 2, hs: null, as: null },
]);

// SHE take 6 points from 2 games; BOH 8 from 4. Total points favour BOH, points
// per game favour SHE.
const unequalGames = () => seed([
  { eventId: 801, round: 1, kickoff: ago(10), home: 1, away: 3, hs: 2, as: 0 },
  { eventId: 802, round: 2, kickoff: ago(9), home: 1, away: 4, hs: 2, as: 0 },
  { eventId: 803, round: 3, kickoff: ago(8), home: 2, away: 3, hs: 2, as: 0 },
  { eventId: 804, round: 4, kickoff: ago(7), home: 2, away: 4, hs: 2, as: 0 },
  { eventId: 805, round: 5, kickoff: ago(6), home: 2, away: 3, hs: 1, as: 1 },
  { eventId: 806, round: 6, kickoff: ago(5), home: 2, away: 4, hs: 1, as: 1 },
]);

// Two clubs, two 1-1 draws: dead level on every league metric, so anything that
// moves the score has to have come from the fantasy column.
const levelPair = () => seed([
  { eventId: 401, round: 1, kickoff: ago(2), home: 1, away: 2, hs: 1, as: 1 },
  { eventId: 402, round: 2, kickoff: ago(1), home: 2, away: 1, hs: 1, as: 1 },
]);

const upcoming = (home, away) => ({
  eventId: 900, round: 9, kickoff: NOW + DAY, status: "notstarted",
  homeTeamId: home, awayTeamId: away, homeScore: null, awayScore: null,
});

describe("fixtureContext", () => {
  it("ranks for display densely and for scoring by levelness", () => {
    const ctx = fixtureContext(sixRoundSeason());
    expect(ctx.teamCount).toBe(4);
    // SHE and BOH finish level on 9; DER and SLI level on 8.
    expect([...ctx.table.display]).toEqual([["1", 1], ["2", 2], ["3", 3], ["4", 4]]);
    expect([...ctx.table.scored]).toEqual([["1", 1], ["2", 1], ["3", 3], ["4", 3]]);
  });

  it("gives the all-time, last-3 and last-5 tables genuinely different orders", () => {
    const ctx = fixtureContext(sixRoundSeason());
    // SHE top of the league, bottom of both form tables; BOH the reverse.
    expect(ctx.table.display.get("1")).toBe(1);
    expect(ctx.form3.display.get("1")).toBe(4);
    expect(ctx.form5.display.get("1")).toBe(4);
    expect(ctx.table.display.get("2")).toBe(2);
    expect(ctx.form3.display.get("2")).toBe(1);
    expect(ctx.form5.display.get("2")).toBe(1);
    // DER and SLI swap places between the two windows.
    expect(ctx.form3.display.get("3")).toBe(3);
    expect(ctx.form5.display.get("3")).toBe(2);
    expect(ctx.form3.display.get("4")).toBe(2);
    expect(ctx.form5.display.get("4")).toBe(3);
  });

  it("pins the rows and the normalisation spreads", () => {
    const ctx = fixtureContext(sixRoundSeason());
    expect(ctx.rows.get("1")).toMatchObject({ played: 6, points: 9, gf: 6, ga: 6, fantasy: 0 });
    expect(ctx.rows.get("3")).toMatchObject({ played: 6, points: 8, gf: 6, ga: 6, fantasy: 0 });
    expect(ctx.count3).toBe(4);
    expect(ctx.count5).toBe(4);
    expect(ctx.ppgSpread).toBeCloseTo(9 / 6 - 8 / 6, 12); // 1.5 - 1.333…
    expect(ctx.fpgSpread).toBe(0);                        // nobody has a gamePosition
  });

  it("returns an empty context with no imported matches", () => {
    const ctx = fixtureContext(emptyData());
    expect(ctx.teamCount).toBe(0);
    expect(ctx.count3).toBe(0);
    expect(ctx.count5).toBe(0);
    expect(ctx.rows.size).toBe(0);
    expect(ctx.table.display.size).toBe(0);
    expect(ctx.ppgSpread).toBe(0);
    expect(ctx.fpgSpread).toBe(0);
  });

  it("drops a club from a form table when its recent imports have no score", () => {
    const ctx = fixtureContext(unevenFormTables());
    expect(ctx.teamCount).toBe(5);
    expect(ctx.table.display.get("1")).toBe(3);       // still in the all-time table
    expect(ctx.form3.display.get("1")).toBeUndefined(); // last 3 are all unscored
    expect(ctx.form5.display.get("1")).toBe(3);        // last 5 reach the scored one
    expect(ctx.count3).toBe(4);
    expect(ctx.count5).toBe(5);

    const both = fixtureContext(noRecentResults());
    expect(both.table.display.get("1")).toBe(3);
    expect(both.form3.display.get("1")).toBeUndefined();
    expect(both.form5.display.get("1")).toBeUndefined();
    expect(both.count3).toBe(4);
    expect(both.count5).toBe(4);
  });
});

describe("compareFixture", () => {
  it("returns both sides with position, points, form and fantasy pinned", () => {
    const cmp = compareFixture(fixtureContext(sixRoundSeason()), upcoming(1, 3));
    expect(cmp.home).toMatchObject({
      teamId: "1", pos: 1, teamCount: 4, played: 6, points: 9, ppg: 1.5,
      form3: 4, form5: 4, fantasy: 0, fpg: 0,
      scored: { pos: 1, form3: 4, form5: 4 },
    });
    expect(cmp.away).toMatchObject({
      teamId: "3", pos: 3, teamCount: 4, played: 6, points: 8,
      form3: 3, form5: 2, fantasy: 0, fpg: 0,
      scored: { pos: 3, form3: 2, form5: 2 },
    });
    expect(cmp.away.ppg).toBeCloseTo(8 / 6, 12);
  });

  it("mirrors: swapping the sides negates the score and keeps the favoured club", () => {
    const ctx = fixtureContext(sixRoundSeason());
    const a = compareFixture(ctx, upcoming(1, 2));
    const b = compareFixture(ctx, upcoming(2, 1));
    expect(a.score).toBeCloseTo(-b.score, 12);
    expect(a.favoured.teamId).toBe("2");
    expect(b.favoured.teamId).toBe("2");
    expect(a.home.lead).toEqual(b.away.lead);
    expect(a.away.lead).toEqual(b.home.lead);
  });

  it("scores form alone when the clubs are level on everything else", () => {
    // SHE and BOH: same points, same goals, same games — only recent form differs.
    const cmp = compareFixture(fixtureContext(sixRoundSeason()), upcoming(1, 2));
    expect(cmp.parts).toEqual({ pos: 0, ppg: 0, form: -1, fpg: 0 });
    expect(cmp.score).toBeCloseTo(-0.3, 12); // the form weight, on its own
    expect(cmp.favoured).toMatchObject({ teamId: "2", grade: "strong", tag: "🎯🎯" });
  });

  it("weighs position and points per game apart from one another", () => {
    // parts.pos (2/3), parts.ppg (1) and parts.form (-2/3) are all different, so
    // the total pins each weight individually: .20/.30/.30/.20.
    const cmp = compareFixture(fixtureContext(sixRoundSeason()), upcoming(1, 3));
    expect(cmp.parts.pos).toBeCloseTo(2 / 3, 12);
    expect(cmp.parts.ppg).toBeCloseTo(1, 12);
    expect(cmp.parts.form).toBeCloseTo(-2 / 3, 12);
    expect(cmp.parts.fpg).toBe(0);
    expect(cmp.score).toBeCloseTo(0.2 * (2 / 3) + 0.3 * 1 + 0.3 * (-2 / 3), 12);
    expect(cmp.score).toBeCloseTo(7 / 30, 12);
  });

  it("scores the stronger side positive whichever end they are at", () => {
    const ctx = fixtureContext(sixRoundSeason());
    expect(compareFixture(ctx, upcoming(2, 4)).score).toBeGreaterThan(0);
    expect(compareFixture(ctx, upcoming(4, 2)).score).toBeLessThan(0);
  });

  it("grades on magnitude with the exact tag at each tier", () => {
    const six = fixtureContext(sixRoundSeason());
    const uneven = fixtureContext(unevenFormTables());
    const stale = fixtureContext(noRecentResults());

    const mismatch = compareFixture(uneven, upcoming(2, 3));
    expect(mismatch.score).toBeCloseTo(0.4625, 12);            // just over 0.45
    expect(mismatch.favoured).toMatchObject({ grade: "mismatch", tag: "🎯🎯🎯" });

    const strong = compareFixture(six, upcoming(2, 1));
    expect(strong.score).toBeCloseTo(0.3, 12);
    expect(strong.favoured).toMatchObject({ grade: "strong", tag: "🎯🎯" });

    const slight = compareFixture(stale, upcoming(1, 5));
    expect(slight.score).toBeCloseTo(0.146875, 12);            // just over 0.14
    expect(slight.favoured).toMatchObject({ grade: "slight", tag: "🎯" });

    const under = compareFixture(uneven, upcoming(1, 2));
    expect(under.score).toBeCloseTo(-0.1, 12);                 // real edge, under 0.14
    expect(under.favoured).toBeNull();
  });

  it("names every reason in full from the favoured club's side", () => {
    const cmp = compareFixture(fixtureContext(sixRoundSeason()), upcoming(1, 3));
    expect(cmp.favoured.teamId).toBe("1");
    expect(cmp.favoured.reasons).toEqual([
      "position +2", "points +0.17/game", "form -2.0", "fantasy —",
    ]);

    // Read from the away club when they are the favoured one — and a zero gap
    // reads "+0.00", never a negative zero.
    const away = compareFixture(fixtureContext(sixRoundSeason()), upcoming(1, 2));
    expect(away.favoured.teamId).toBe("2");
    expect(away.favoured.reasons).toEqual([
      "position +0", "points +0.00/game", "form +3.0", "fantasy —",
    ]);
  });

  it("shows level clubs distinct positions but scores them as a zero gap", () => {
    const cmp = compareFixture(fixtureContext(sixRoundSeason()), upcoming(3, 4));
    expect(cmp.home.pos).toBe(3);   // what the Table tab renders
    expect(cmp.away.pos).toBe(4);
    expect(cmp.home.scored.pos).toBe(3);
    expect(cmp.away.scored.pos).toBe(3); // level: DER and SLI cannot be separated
    expect(cmp.parts.pos).toBe(0);
    expect(cmp.parts).toEqual({ pos: 0, ppg: 0, form: 0, fpg: 0 });
    expect(cmp.score).toBe(0);
    expect(cmp.favoured).toBeNull();
    expect(cmp.home.lead).toEqual({ pos: 0, points: 0, form: 0, fantasy: 0 });
    expect(cmp.away.lead).toEqual({ pos: 0, points: 0, form: 0, fantasy: 0 });
  });

  it("returns null when either club has no imported matches", () => {
    const ctx = fixtureContext(sixRoundSeason());
    expect(compareFixture(ctx, upcoming(1, 99))).toBeNull();
    expect(compareFixture(ctx, upcoming(99, 1))).toBeNull();
    expect(compareFixture(fixtureContext(emptyData()), upcoming(1, 2))).toBeNull();
  });

  it("treats an absent form rank as no signal, never as a number to subtract", () => {
    const ctx = fixtureContext(noRecentResults());
    const cmp = compareFixture(ctx, upcoming(1, 5));
    expect(cmp.home.form3).toBeNull();
    expect(cmp.home.form5).toBeNull();
    expect(cmp.home.scored.form3).toBeNull();
    expect(cmp.away.form3).toBe(1);            // GAL is ranked in both windows
    expect(cmp.parts.form).toBe(0);            // no rank on one side -> no signal
    expect(Number.isFinite(cmp.score)).toBe(true);
    expect(cmp.score).toBeCloseTo(0.146875, 12);
    expect(cmp.home.lead.form).toBe(0);
    expect(cmp.away.lead.form).toBe(0);
    expect(cmp.favoured.reasons).toContain("form —");
    // The tag survives: this is exactly the fixture where NaN used to erase it.
    expect(cmp.favoured).toMatchObject({ teamId: "1", grade: "slight", tag: "🎯" });
  });

  it("scores each form window against its own table's size", () => {
    // count3 (4) and count5 (5) differ here, so a shared denominator would move
    // the composite: (-1/3 + 1/4) / 2, not (-1/4 + 1/4) / 2 or (-1/3 + 1/3) / 2.
    const ctx = fixtureContext(unevenFormTables());
    expect(ctx.count3).toBe(4);
    expect(ctx.count5).toBe(5);
    const cmp = compareFixture(ctx, upcoming(2, 5));
    expect(cmp.home.scored).toMatchObject({ form3: 2, form5: 1 });
    expect(cmp.away.scored).toMatchObject({ form3: 1, form5: 2 });
    expect(cmp.parts.form).toBeCloseTo((-1 / 3 + 1 / 4) / 2, 12);

    // And again where the last-5 table is the short one: count5 (4) is below
    // teamCount (5), so borrowing teamCount for either window shifts the mean.
    const stale = fixtureContext(noRecentResults());
    expect(stale.count3).toBe(4);
    expect(stale.count5).toBe(4);
    expect(stale.teamCount).toBe(5);
    const c2 = compareFixture(stale, upcoming(2, 3));
    expect(c2.home.scored).toMatchObject({ form3: 3, form5: 1 });
    expect(c2.away.scored).toMatchObject({ form3: 2, form5: 3 });
    expect(c2.parts.form).toBeCloseTo((-1 / 3 + 2 / 3) / 2, 12);
  });

  it("favours the better per-game side when games played are unequal", () => {
    // SHE 6 points from 2, BOH 8 from 4: BOH lead the table, SHE are stronger.
    const ctx = fixtureContext(unequalGames());
    const cmp = compareFixture(ctx, upcoming(1, 2));
    expect(cmp.home).toMatchObject({ played: 2, points: 6, ppg: 3, pos: 2 });
    expect(cmp.away).toMatchObject({ played: 4, points: 8, ppg: 2, pos: 1 });
    expect(cmp.parts.pos).toBeCloseTo(-1 / 3, 12); // position says BOH
    expect(cmp.parts.ppg).toBeCloseTo(0.375, 12);  // per game says SHE
    expect(cmp.score).toBeGreaterThan(0);          // and per game wins the argument
    expect(cmp.score).toBeCloseTo(0.2 * (-1 / 3) + 0.3 * 0.375, 12);
    // Under the old 0.30/0.20 split the same fixture scored the stronger club
    // negative; the parts are weight-free, so this is that exact regression.
    expect(0.3 * cmp.parts.pos + 0.2 * cmp.parts.ppg).toBeLessThan(0);
  });

  it("ignores the fantasy column when either club has no fantasy points", () => {
    // Only SHE's forward has a position, so BOH read 0 — a data gap, not form.
    const d = setPlayerField(levelPair(), 11, "gamePosition", "FWD");
    const ctx = fixtureContext(d);
    expect(ctx.rows.get("1").fantasy).toBeGreaterThan(0);
    expect(ctx.rows.get("2").fantasy).toBe(0);
    expect(ctx.fpgSpread).toBeGreaterThan(0);      // the table really is split
    const cmp = compareFixture(ctx, upcoming(1, 2));
    expect(cmp.parts.fpg).toBe(0);                 // but it is not a signal
    expect(cmp.score).toBe(0);
    expect(cmp.favoured).toBeNull();
    expect(cmp.home.lead.fantasy).toBe(0);
    expect(cmp.away.lead.fantasy).toBe(0);
  });

  it("counts team fantasy points — including an adjustment — in the score", () => {
    let d = levelPair();
    d = setPlayerField(d, 11, "gamePosition", "FWD");
    d = setPlayerField(d, 12, "gamePosition", "FWD");

    const level = fixtureContext(d);
    expect(level.rows.get("1").fantasy).toBe(level.rows.get("2").fantasy);
    expect(level.rows.get("1").fantasy).toBeGreaterThan(0);
    expect(level.fpgSpread).toBe(0);
    expect(compareFixture(level, upcoming(1, 2)).score).toBe(0);

    // A user correction on SHE's forward is now the only difference between them:
    // the whole score is the fantasy component at full strength.
    const adjusted = fixtureContext(setAdjustment(d, "401:11", { assists: 1 }));
    expect(adjusted.rows.get("1").fantasy).toBeGreaterThan(adjusted.rows.get("2").fantasy);
    const cmp = compareFixture(adjusted, upcoming(1, 2));
    expect(cmp.parts).toEqual({ pos: 0, ppg: 0, form: 0, fpg: 1 });
    expect(cmp.score).toBeCloseTo(0.2, 12);
    expect(cmp.favoured).toMatchObject({ teamId: "1", grade: "slight", tag: "🎯" });
    expect(cmp.favoured.reasons).toContain("fantasy +1.5/game");
    expect(cmp.home.lead).toEqual({ pos: 0, points: 0, form: 0, fantasy: 1 });
    expect(cmp.away.lead).toEqual({ pos: 0, points: 0, form: 0, fantasy: -1 });
  });

  it("is the exact weighted sum of its parts, with no clamping in range", () => {
    const cases = [
      [fixtureContext(sixRoundSeason()), upcoming(1, 3)],
      [fixtureContext(unevenFormTables()), upcoming(2, 4)],
      [fixtureContext(unequalGames()), upcoming(1, 3)],
      [fixtureContext(noRecentResults()), upcoming(2, 3)],
    ];
    for (const [ctx, m] of cases) {
      const c = compareFixture(ctx, m);
      const sum = 0.2 * c.parts.pos + 0.3 * c.parts.ppg + 0.3 * c.parts.form + 0.2 * c.parts.fpg;
      expect(c.score).toBeCloseTo(sum, 12);
      for (const p of Object.values(c.parts)) {
        expect(p).toBeGreaterThanOrEqual(-1);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("compareFixture lead", () => {
  it("marks the leader of each metric, mirrored between the sides", () => {
    const cmp = compareFixture(fixtureContext(unevenFormTables()), upcoming(2, 3));
    expect(cmp.home.lead).toEqual({ pos: 1, points: 1, form: 1, fantasy: 0 });
    expect(cmp.away.lead).toEqual({ pos: -1, points: -1, form: -1, fantasy: 0 });
    // Summed rather than negated: -0 is not 0 under Object.is, and `sign` is
    // careful never to hand out a negative zero.
    for (const k of ["pos", "points", "form", "fantasy"]) {
      expect(cmp.home.lead[k] + cmp.away.lead[k]).toBe(0);
      expect(Object.is(cmp.home.lead[k], -0)).toBe(false);
      expect(Object.is(cmp.away.lead[k], -0)).toBe(false);
    }
  });

  it("follows points per game, not total points", () => {
    const cmp = compareFixture(fixtureContext(unequalGames()), upcoming(1, 2));
    expect(cmp.home.points).toBeLessThan(cmp.away.points); // 6 < 8 on totals
    expect(cmp.home.ppg).toBeGreaterThan(cmp.away.ppg);    // 3 > 2 per game
    expect(cmp.home.lead.points).toBe(1);                  // per game wins
    expect(cmp.away.lead.points).toBe(-1);
    expect(cmp.home.lead.pos).toBe(-1);                    // and position disagrees
  });

  it("follows the normalised form composite, not the raw rank average", () => {
    // BOH are 2nd/1st over the two windows, GAL 1st/2nd — identical raw averages,
    // so averaging the ranks says "level" while the composite says BOH trail.
    const cmp = compareFixture(fixtureContext(unevenFormTables()), upcoming(2, 5));
    expect((cmp.home.form3 + cmp.home.form5) / 2).toBe((cmp.away.form3 + cmp.away.form5) / 2);
    expect(cmp.parts.form).toBeLessThan(0);
    expect(cmp.home.lead.form).toBe(-1);
    expect(cmp.away.lead.form).toBe(1);
  });

  it("is 0 on a metric with no data rather than a direction", () => {
    const cmp = compareFixture(fixtureContext(noRecentResults()), upcoming(1, 5));
    expect(cmp.home.form3).toBeNull();
    expect(cmp.home.lead.form).toBe(0);   // no rank, not a deficit
    expect(cmp.home.lead.fantasy).toBe(0); // no fantasy coverage either
    expect(cmp.home.lead.points).toBe(1);  // the metrics that do have data still speak
  });
});
