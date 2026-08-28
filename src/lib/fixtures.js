import { leagueTable } from "./store.js";

// Fixture comparison: how two clubs stack up right now on league position,
// league points, 3- and 5-game form position, and team fantasy points.
// Pure and derived — nothing here is ever stored (see CLAUDE.md).

const FORM_SHORT = 3;
const FORM_LONG = 5;

const perGame = (total, played) => (played ? total / played : 0);

// teamId (as a string key) -> 1-based league position
function rankMap(rows) {
  const m = new Map();
  rows.forEach((r, i) => m.set(String(r.teamId), i + 1));
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

export function compareFixture() { return null; } // replaced in Task 2
