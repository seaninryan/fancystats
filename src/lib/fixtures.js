import { leagueTable, leagueOrder } from "./store.js";

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
  };
}

// Weights sum to 1. Position carries less than its per-game twin because it
// ranks on *total* points, so a club with games in hand sits artificially low
// (see the spec).
const WEIGHTS = { pos: 0.20, ppg: 0.30, form: 0.30, fpg: 0.20 };

// Grades on |score|, strongest first. No home-advantage term — we have no data
// to calibrate one (see the spec).
const GRADES = [
  [0.45, "mismatch", "🎯🎯🎯"],
  [0.28, "strong", "🎯🎯"],
  [0.14, "slight", "🎯"],
];

// Guards the ±1 contract the GRADES table depends on. Neither call site can
// exceed it today — both clubs in a fixture are rows of the table the spread and
// the rank denominators are taken from, so |gap| <= denom, and the weights sum
// to 1 — so this is a bound, not a live path, and no test can reach it.
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// +1 / -1 / 0, never -0 (Object.is(-0, 0) is false, and callers compare to 0).
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
// A gap normalised against the league's own spread. Zero spread -> no signal.
const norm = (gap, denom) => (denom > 0 ? clamp1(gap / denom) : 0);

// Rank gap from the first club's perspective (a lower position is better). A
// club can be absent from a form window, and an absent rank is not a number to
// subtract: no rank on either side means no signal, same rule as a zero spread.
const rankGap = (mine, theirs) => (mine == null || theirs == null ? null : theirs - mine);

// "+3", "-1.5". Rounds before taking the sign so a gap of -0.004 reads "+0.00"
// rather than "-0.00".
const signed = (n, digits = 0) => {
  const r = Number(n.toFixed(digits)) + 0;
  return (r >= 0 ? "+" : "") + r.toFixed(digits);
};

// One reason line for the tag's tooltip. An absent gap reads "—", never "NaN".
const reason = (label, gap, digits, suffix = "") =>
  gap == null ? `${label} —` : `${label} ${signed(gap, digits)}${suffix}`;

function sideOf(ctx, teamId) {
  const row = ctx.rows.get(teamId);
  if (!row) return null; // no imported matches -> nothing to compare
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
  // a 0.20-weight metric. A missing total is a data gap, not form.
  const fantasyCovered = home.fantasy !== 0 && away.fantasy !== 0;

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
  };
  // Which side leads each metric. Derived from the same parts the score uses, so
  // a chip's tint can never point the other way from the tag.
  const lead = (dir) => ({
    pos: sign(dir * parts.pos),
    points: sign(dir * parts.ppg),
    form: sign(dir * parts.form),
    fantasy: sign(dir * parts.fpg),
  });

  const score = clamp1(
    WEIGHTS.pos * parts.pos + WEIGHTS.ppg * parts.ppg +
    WEIGHTS.form * parts.form + WEIGHTS.fpg * parts.fpg,
  );

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
      ],
    };
  }
  // Exposed so the UI can word a suppressed fantasy chip as missing data rather
  // than as a genuine tie — lead.fantasy is 0 for both cases.
  return {
    home: { ...home, lead: lead(1) }, away: { ...away, lead: lead(-1) },
    score, parts, fantasyCovered, favoured,
  };
}
