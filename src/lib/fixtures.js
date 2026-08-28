import { leagueTable } from "./store.js";

// Fixture comparison: how two clubs stack up right now on league position,
// league points, 3- and 5-game form position, and team fantasy points.
// Pure and derived — nothing here is ever stored (see CLAUDE.md).

const FORM_SHORT = 3;
const FORM_LONG = 5;

const perGame = (total, played) => (played ? total / played : 0);

// Two clubs leagueTable's own ordering (points, then goal difference, then goals
// for) cannot separate.
const levelWith = (a, b) => a.points === b.points && a.gf === b.gf && a.ga === b.ga;

// teamId (as a string key) -> 1-based league position. Level clubs share a
// position, so a fixture between genuinely level clubs reads as a zero gap
// rather than an arbitrary one place.
function rankMap(rows) {
  const m = new Map();
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || !levelWith(r, rows[i - 1])) rank = i + 1;
    m.set(String(r.teamId), rank);
  });
  return m;
}

function spread(rows, fn) {
  const vals = rows.map(fn).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
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
    pos: rankMap(all),
    pos3: rankMap(short),
    pos5: rankMap(long),
    teamCount: all.length,
    count3: short.length,
    count5: long.length,
    ppgSpread: spread(all, (r) => perGame(r.points, r.played)),
    fpgSpread: spread(all, (r) => perGame(r.fantasy, r.played)),
  };
}

// Weights sum to 1. Position and form (the two rank-based views) carry 0.6
// between them; the two per-game rates carry 0.4.
const WEIGHTS = { pos: 0.30, ppg: 0.20, form: 0.30, fpg: 0.20 };

// Grades on |score|, strongest first. No home-advantage term — we have no data
// to calibrate one (see the spec).
const GRADES = [
  [0.45, "mismatch", "🎯🎯🎯"],
  [0.28, "strong", "🎯🎯"],
  [0.14, "slight", "🎯"],
];

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// A gap normalised against the league's own spread. Zero spread -> no signal.
const norm = (gap, denom) => (denom > 0 ? clamp1(gap / denom) : 0);
const signed = (n, digits = 0) => (n >= 0 ? "+" : "") + n.toFixed(digits);

function sideOf(ctx, teamId) {
  const row = ctx.rows.get(teamId);
  if (!row) return null; // no imported matches -> nothing to compare
  return {
    teamId,
    pos: ctx.pos.get(teamId),
    teamCount: ctx.teamCount,
    played: row.played,
    points: row.points,
    ppg: perGame(row.points, row.played),
    form3: ctx.pos3.get(teamId),
    form5: ctx.pos5.get(teamId),
    fantasy: row.fantasy,
    fpg: perGame(row.fantasy, row.played),
  };
}

// Comparison for one fixture. `score` runs from the HOME side's perspective:
// positive = home favoured. Returns null when either club has no imported
// matches yet. Callers show this on upcoming fixtures only.
export function compareFixture(ctx, match) {
  const home = sideOf(ctx, String(match.homeTeamId));
  const away = sideOf(ctx, String(match.awayTeamId));
  if (!home || !away) return null;

  const gaps = {
    pos: away.pos - home.pos,            // lower position number is better
    ppg: home.ppg - away.ppg,
    form3: away.form3 - home.form3,
    form5: away.form5 - home.form5,
    fpg: home.fpg - away.fpg,
  };
  const parts = {
    pos: norm(gaps.pos, ctx.teamCount - 1),
    ppg: norm(gaps.ppg, ctx.ppgSpread),
    form: (norm(gaps.form3, ctx.count3 - 1) + norm(gaps.form5, ctx.count5 - 1)) / 2,
    fpg: norm(gaps.fpg, ctx.fpgSpread),
  };
  const score = clamp1(
    WEIGHTS.pos * parts.pos + WEIGHTS.ppg * parts.ppg +
    WEIGHTS.form * parts.form + WEIGHTS.fpg * parts.fpg,
  );

  const hit = GRADES.find(([min]) => Math.abs(score) >= min);
  let favoured = null;
  if (hit) {
    const [, grade, tag] = hit;
    const dir = score > 0 ? 1 : -1; // reasons read from the favoured club's side
    favoured = {
      teamId: dir > 0 ? home.teamId : away.teamId,
      score, grade, tag,
      reasons: [
        `position ${signed(dir * gaps.pos)}`,
        `points ${signed(dir * gaps.ppg, 2)}/game`,
        `form ${signed(dir * (gaps.form3 + gaps.form5) / 2, 1)}`,
        `fantasy ${signed(dir * gaps.fpg, 1)}/game`,
      ],
    };
  }
  return { home, away, score, parts, favoured };
}
