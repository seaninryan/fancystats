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

// Fantasy points per gameweek for one player. null = the player's team had no
// imported match that round (gap); 0 = team played but the player didn't score
// (or didn't appear). No gamePosition -> no computable points -> all null,
// matching the Pts column's ❗.
export function playerWeeklySeries(data, playerId) {
  const rounds = importedRounds(data);
  const player = data.players[playerId];
  const position = player?.gamePosition;
  if (!position) return rounds.map((round) => ({ round, value: null }));
  const byRound = new Map();
  for (const m of Object.values(data.matches)) {
    if (!imported(m) || (m.homeTeamId !== player.teamId && m.awayTeamId !== player.teamId)) continue;
    const r = matchRound(m);
    if (r != null && !byRound.has(r)) byRound.set(r, 0);
  }
  for (const a of Object.values(data.appearances)) {
    if (String(a.playerId) !== String(playerId)) continue;
    const m = data.matches[a.eventId];
    if (!m || !imported(m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    byRound.set(r, (byRound.get(r) || 0) + scoreAppearance(a, m, position, adj).total);
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}
