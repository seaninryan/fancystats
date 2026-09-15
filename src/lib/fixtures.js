import { leagueTable, leagueOrder, teamGoalClocks, MATCH_MINUTES } from "./store.js";

// Fixture comparison: how two clubs stack up right now on league position,
// league points, 3- and 5-game form position, and team fantasy points.
// Pure and derived — nothing here is ever stored (see CLAUDE.md).

const FORM_SHORT = 3;
const FORM_LONG = 5;

const perGame = (total, played) => (played ? total / played : 0);

// Two rankings over the same table, two jobs:
//
//   display — the dense index, exactly what TableTab renders, so the Matches
//             chip can never contradict the Table tab;
//   scored  — clubs `leagueOrder` cannot separate share a rank, so a fixture
//             between genuinely level clubs reads as a zero gap rather than an
//             arbitrary one place.
//
// Both keyed by teamId as a string (record fields are numbers, keys strings).
function rankings(rows) {
  const display = new Map();
  const scored = new Map();
  let shared = 0;
  rows.forEach((r, i) => {
    if (i === 0 || leagueOrder(rows[i - 1], r) !== 0) shared = i + 1;
    display.set(String(r.teamId), i + 1);
    scored.set(String(r.teamId), shared);
  });
  return { display, scored };
}

function spread(rows, fn) {
  if (!rows.length) return 0;
  const vals = rows.map(fn);
  return Math.max(...vals) - Math.min(...vals);
}

// Built once per render and shared by every fixture on the page: three league
// tables is the expensive part, so never call leagueTable per match.
export function fixtureContext(data) {
  const all = leagueTable(data);
  const short = leagueTable(data, FORM_SHORT);
  const long = leagueTable(data, FORM_LONG);
  return {
    rows: new Map(all.map((r) => [String(r.teamId), r])),
    table: rankings(all),
    form3: rankings(short),
    form5: rankings(long),
    teamCount: all.length,
    count3: short.length,
    count5: long.length,
    ppgSpread: spread(all, (r) => perGame(r.points, r.played)),
    fpgSpread: spread(all, (r) => perGame(r.fantasy, r.played)),
    // Built once for the whole page, like the three league tables above.
    clocks: teamGoalClocks(data, FORM_LONG),
  };
}

// Weights sum to 1. Position carries less than its per-game twin because it
// ranks on *total* points, so a club with games in hand sits artificially low
// (see the spec).
const WEIGHTS = { pos: 0.18, ppg: 0.27, form: 0.27, fpg: 0.18, goals: 0.10 };

// Grades on |score|, strongest first. No home-advantage term — we have no data
// to calibrate one (see the spec).
const GRADES = [
  [0.45, "mismatch", "🎯🎯🎯"],
  [0.28, "strong", "🎯🎯"],
  [0.14, "slight", "🎯"],
];

// The goal clocks are a KNOWN scale — 0 to a full window — so they normalise
// against a fixed cap, not against the league's own spread the way ppg and fpg
// do. Spread-normalising a clock would rescale the opening weeks' noise, when
// every club's clocks are small and close together, into a full-strength
// signal. Derived from FORM_LONG so the window and the denominator cannot
// drift apart.
const CAP = FORM_LONG * MATCH_MINUTES;
// Two matches apart on either half. The ONLY definition of the threshold — the
// component reads which halves are drastic, never the number.
const DRASTIC = 2 * MATCH_MINUTES;

// Guards the ±1 contract the GRADES table depends on. Neither call site can
// exceed it today — both clubs in a fixture are rows of the table the spread and
// the rank denominators are taken from, so |gap| <= denom, and the weights sum
// to 1 — so this is a bound, not a live path, and no test can reach it. The
// clocks are bounded for a different reason: a clock cannot run past its own
// window and CAP *is* that window, so a goals half tops out at exactly 1 (a
// fixture does reach it) without the clamp ever doing the work.
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// +1 / -1 / 0, never -0 (Object.is(-0, 0) is false, and callers compare to 0).
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
// A gap normalised against its denominator — the league's own spread for the
// per-game metrics, a fixed cap for the clocks. Zero denominator -> no signal.
const norm = (gap, denom) => (denom > 0 ? clamp1(gap / denom) : 0);

// Rank gap from the first club's perspective (a lower position is better). A
// club can be absent from a form window, and an absent rank is not a number to
// subtract: no rank on either side means no signal, same rule as a zero spread.
const rankGap = (mine, theirs) => (mine == null || theirs == null ? null : theirs - mine);

// The clock analogue of rankGap, and it exists for the same reason: an open
// clock is a LOWER BOUND, not a value, so it is not a number to subtract. Two
// open clocks differ only by how many matches of evidence each club has —
// subtracting 180'+ from 450'+ manufactures a gap out of games played, and
// lands often enough on DRASTIC to manufacture a highlight too. Same rule
// fantasyCovered applies: a data gap is not a signal. One open against one
// closed IS still compared — a documented, accepted limitation; do not widen
// this. Takes the two halves whole rather than four loose numbers so a silent
// transposition (which no test would catch) cannot be written.
// An unknown clock (`ago: null`) is not a number to subtract either, and unlike
// an open clock it has no lower bound at all — see NO_CLOCK.
const clockGap = (mine, theirs) =>
  mine.ago == null || theirs.ago == null || (mine.open && theirs.open)
    ? null
    : mine.ago - theirs.ago;

// A club whose matches all failed teamGoalClocks' goal-time count check has no
// clock at all — not a clock of zero. Shaped so the existing suppression does
// the work: both halves read as open with a null `ago`, so every gap is null,
// parts.goals is 0 and drastic is false, exactly as fantasyCovered does for a
// missing fantasy total. `known` is for the tooltip, which must say the data is
// missing rather than quote a number nobody recorded.
const NO_CLOCK = {
  scored: { ago: null, open: true },
  conceded: { ago: null, open: true },
  matches: 0, known: false,
};

// "+3", "-1.5". Rounds before taking the sign so a gap of -0.004 reads "+0.00"
// rather than "-0.00".
const signed = (n, digits = 0) => {
  const r = Number(n.toFixed(digits)) + 0;
  return (r >= 0 ? "+" : "") + r.toFixed(digits);
};

// One reason line for the tag's tooltip. An absent gap reads "—", never "NaN".
const reason = (label, gap, digits, suffix = "") =>
  gap == null ? `${label} —` : `${label} ${signed(gap, digits)}${suffix}`;

// "goals +395'/+360'" — scored gap then conceded gap, from the favoured club's
// view, matching the chip face. Two values, so it does not go through the
// single-gap `reason()` helper. A suppressed half reads "—", never "NaN".
const clockReason = (dir, scoredGap, concededGap) => {
  const half = (g) => (g == null ? "—" : `${signed(dir * g, 0)}'`);
  return `goals ${half(scoredGap)}/${half(concededGap)}`;
};

function sideOf(ctx, teamId) {
  const row = ctx.rows.get(teamId);
  if (!row) return null; // no imported matches -> nothing to compare
  // ctx.clocks is keyed by teamId as a NUMBER; teamId here is a string (record
  // fields are numbers, object keys are strings — see CLAUDE.md). A club in the
  // league table can genuinely have no clock: leagueTable counts a match whose
  // score is real, while teamGoalClocks additionally needs the goal times to
  // account for that score, and an incidents-404 import has the one without the
  // other.
  const c = ctx.clocks.get(Number(teamId));
  return {
    teamId,
    // What the user sees, and what the Table tab agrees with.
    pos: ctx.table.display.get(teamId),
    form3: ctx.form3.display.get(teamId) ?? null,
    form5: ctx.form5.display.get(teamId) ?? null,
    teamCount: ctx.teamCount,
    played: row.played,
    points: row.points,
    ppg: perGame(row.points, row.played),
    fantasy: row.fantasy,
    fpg: perGame(row.fantasy, row.played),
    // Goal clocks, nested: `scored` at this level is the tie-aware rank block
    // below and has been since the fixture comparison shipped, so the minutes
    // cannot live beside it without the word meaning two things at one depth.
    clock: c
      ? {
        scored: { ago: c.scored, open: c.scoredOpen },
        conceded: { ago: c.conceded, open: c.concededOpen },
        matches: c.matches, known: true,
      }
      : NO_CLOCK,
    // What the score is computed from: level clubs share a rank.
    scored: {
      pos: ctx.table.scored.get(teamId),
      form3: ctx.form3.scored.get(teamId) ?? null,
      form5: ctx.form5.scored.get(teamId) ?? null,
    },
  };
}

// Comparison for one fixture. `score` runs from the HOME side's perspective:
// positive = home favoured. Returns null when either club has no imported
// matches yet. Callers show this on upcoming fixtures only.
export function compareFixture(ctx, match) {
  const home = sideOf(ctx, String(match.homeTeamId));
  const away = sideOf(ctx, String(match.awayTeamId));
  if (!home || !away) return null;

  // leagueTable only accrues fantasy points for players with a gamePosition, so
  // a club whose squad has no positions yet would read as the league's worst on
  // a 0.18-weight metric. A missing total is a data gap, not form.
  const fantasyCovered = home.fantasy !== 0 && away.fantasy !== 0;

  // Both signed so that positive favours HOME: home scoring more recently is
  // good for home, home conceding more recently is not.
  const scoredGap = clockGap(away.clock.scored, home.clock.scored);
  const concededGap = clockGap(home.clock.conceded, away.clock.conceded);

  const gaps = {
    pos: rankGap(home.scored.pos, away.scored.pos),
    ppg: home.ppg - away.ppg,
    form3: rankGap(home.scored.form3, away.scored.form3),
    form5: rankGap(home.scored.form5, away.scored.form5),
    fpg: fantasyCovered ? home.fpg - away.fpg : null,
  };
  const part = (gap, denom) => (gap == null ? 0 : norm(gap, denom));
  const parts = {
    pos: part(gaps.pos, ctx.teamCount - 1),
    ppg: part(gaps.ppg, ctx.ppgSpread),
    // Each window normalised by its own table's size; an unranked window
    // contributes 0 to the mean rather than dropping out of it.
    form: (part(gaps.form3, ctx.count3 - 1) + part(gaps.form5, ctx.count5 - 1)) / 2,
    fpg: part(gaps.fpg, ctx.fpgSpread),
    // Each half against the same fixed cap; a suppressed half contributes 0 to
    // the mean rather than dropping out of it, exactly as an unranked form
    // window does above.
    goals: (part(scoredGap, CAP) + part(concededGap, CAP)) / 2,
  };
  // Which side leads each metric. Derived from the same parts the score uses, so
  // a chip's tint can never point the other way from the tag.
  const lead = (dir) => ({
    pos: sign(dir * parts.pos),
    points: sign(dir * parts.ppg),
    form: sign(dir * parts.form),
    fantasy: sign(dir * parts.fpg),
    goals: sign(dir * parts.goals),
  });

  const score = clamp1(
    WEIGHTS.pos * parts.pos + WEIGHTS.ppg * parts.ppg +
    WEIGHTS.form * parts.form + WEIGHTS.fpg * parts.fpg +
    WEIGHTS.goals * parts.goals,
  );

  // Deliberately NOT folded into the tint. A fixture can read +405 scored and
  // -405 conceded: the halves are drastically apart while the combined lead is
  // level, and there would be no tint to make bold. Keeping the two orthogonal
  // means the highlight can never contradict the 🎯 tag. A suppressed (null)
  // half cannot be drastic. Reported per half so the tooltip can name which —
  // the threshold itself never leaves this file. `matches` is that threshold in
  // the unit the tooltip quotes it in ("two matches apart"): the component
  // renders this count rather than spelling the number out, so raising DRASTIC
  // cannot leave the wording behind saying something the code no longer does.
  const big = (g) => g != null && Math.abs(g) >= DRASTIC;
  const drastic = { scored: big(scoredGap), conceded: big(concededGap) };
  drastic.any = drastic.scored || drastic.conceded;
  drastic.matches = DRASTIC / MATCH_MINUTES;

  const hit = GRADES.find(([min]) => Math.abs(score) >= min);
  let favoured = null;
  if (hit) {
    const [, grade, tag] = hit;
    const dir = score > 0 ? 1 : -1; // reasons read from the favoured club's side
    // The form line reports what the score used: an unranked window counts as no
    // gap, and only a club unranked in both windows reads as unknown.
    const formGap = gaps.form3 == null && gaps.form5 == null
      ? null
      : ((gaps.form3 ?? 0) + (gaps.form5 ?? 0)) / 2;
    favoured = {
      teamId: dir > 0 ? home.teamId : away.teamId,
      score, grade, tag,
      reasons: [
        // Quote the gap between the DISPLAYED positions: the tooltip sits beside
        // two visible chips, and a reader can check the subtraction. Level clubs
        // (a zero scored gap) still read "+0" whatever their dense positions —
        // that is the gap the score actually used.
        reason("position", gaps.pos == null ? null : dir * (gaps.pos === 0 ? 0 : away.pos - home.pos), 0),
        reason("points", dir * gaps.ppg, 2, "/game"),
        reason("form", formGap == null ? null : dir * formGap, 1),
        reason("fantasy", gaps.fpg == null ? null : dir * gaps.fpg, 1, "/game"),
        clockReason(dir, scoredGap, concededGap),
      ],
    };
  }
  // Exposed so the UI can word a suppressed fantasy chip as missing data rather
  // than as a genuine tie — lead.fantasy is 0 for both cases.
  return {
    home: { ...home, lead: lead(1) }, away: { ...away, lead: lead(-1) },
    score, parts, fantasyCovered, scoredGap, concededGap, drastic, favoured,
  };
}
