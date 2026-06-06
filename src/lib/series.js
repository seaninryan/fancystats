// src/lib/series.js
// Per-gameweek chart series, derived at render time from matches/appearances —
// nothing pre-computed, consistent with the rest of the data model.
import { scoreAppearance } from "./scoring.js";
import { matchRound } from "./store.js";

const imported = (m) => m.importedAt && m.goalTimes;

// X-axis domain: every round from the first imported round to the last,
// inclusive — rounds with no imported match stay on the axis as gaps.
export function importedRounds(data) {
  let min = Infinity, max = -Infinity;
  for (const m of Object.values(data.matches)) {
    if (!imported(m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  if (min === Infinity) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

// Running total for the cumulative toggle. Gaps (null) stay gaps in the line
// but don't reset the sum.
export function accumulate(points) {
  let sum = 0;
  return points.map(({ round, value }) =>
    ({ round, value: value == null ? null : (sum += value) }));
}
