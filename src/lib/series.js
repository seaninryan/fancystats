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

// Stat selector for the Players tab graph: [key, button label].
export const PLAYER_STATS = [
  ["fantasy", "FPts"], ["goals", "G"], ["assists", "Ast"], ["yellows", "Yel"], ["reds", "Red"],
];

// One appearance's contribution to a stat. Count-stat conventions mirror
// leagueTable so graphs agree with the table columns at both levels.
function appearanceStat(a, m, position, adj, stat) {
  if (stat === "fantasy") return scoreAppearance(a, m, position, adj).total;
  const eff = { ...a };
  if (adj) {
    for (const f of ["goals", "assists"]) {
      if (typeof adj[f] === "number") eff[f] = Math.max(0, (eff[f] || 0) + adj[f]);
    }
    if (typeof adj.secondYellow === "boolean") eff.secondYellow = adj.secondYellow;
    if (typeof adj.red === "boolean") eff.red = adj.red;
  }
  if (stat === "goals") return eff.goals || 0;
  if (stat === "assists") return eff.assists || 0;
  if (stat === "yellows") return (eff.yellow || 0) + (eff.secondYellow ? 1 : 0); // the second yellow is a yellow too
  return (eff.red ? 1 : 0) + (eff.secondYellow ? 1 : 0); // reds: dismissals
}

// One player's per-gameweek value. stat: "fantasy" | "goals" | "assists" |
// "yellows" | "reds". null = the player's team had no imported match that
// round (gap); 0 = team played but the player contributed nothing (or didn't
// appear). Fantasy needs a gamePosition to score (matching the Pts column's
// ❗); the count stats don't.
export function playerWeeklySeries(data, playerId, stat = "fantasy") {
  const rounds = importedRounds(data);
  const player = data.players[playerId];
  const position = player?.gamePosition;
  if (!player || (stat === "fantasy" && !position)) {
    return rounds.map((round) => ({ round, value: null }));
  }
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
    byRound.set(r, (byRound.get(r) || 0) + appearanceStat(a, m, position, adj, stat));
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}

// Stat selector for the Table tab graph: [key, button label].
export const TEAM_STATS = [
  ["played", "P"], ["won", "W"], ["drawn", "D"], ["lost", "L"], ["gf", "GF"], ["ga", "GA"],
  ["points", "Pts"], ["fantasy", "FPts"], ["yellows", "Yel"], ["reds", "Red"], ["assists", "Ast"],
];

// Stats computed from the match result (vs from appearances).
const RESULT_STATS = new Set(["points", "played", "won", "drawn", "lost", "gf", "ga"]);

// One team's per-gameweek value. stat: "points" (league 3/1/0) | "played" |
// "won" | "drawn" | "lost" | "gf" | "ga" | "fantasy" | "yellows" | "reds" |
// "assists". Accounting mirrors leagueTable so the graph always agrees with
// the table columns.
export function teamWeeklySeries(data, teamId, stat) {
  const rounds = importedRounds(data);
  const tid = Number(teamId);
  const byRound = new Map();
  for (const m of Object.values(data.matches)) {
    if (!imported(m) || (m.homeTeamId !== tid && m.awayTeamId !== tid)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    let v = byRound.get(r) || 0;
    if (RESULT_STATS.has(stat) && m.homeScore != null && m.awayScore != null) {
      const gf = m.homeTeamId === tid ? m.homeScore : m.awayScore;
      const ga = m.homeTeamId === tid ? m.awayScore : m.homeScore;
      v += stat === "points" ? (gf > ga ? 3 : gf === ga ? 1 : 0)
        : stat === "played" ? 1
        : stat === "won" ? (gf > ga ? 1 : 0)
        : stat === "drawn" ? (gf === ga ? 1 : 0)
        : stat === "lost" ? (gf < ga ? 1 : 0)
        : stat === "gf" ? gf
        : ga;
    }
    byRound.set(r, v);
  }
  if (!RESULT_STATS.has(stat)) {
    for (const a of Object.values(data.appearances)) {
      if (a.teamId !== tid) continue;
      const m = data.matches[a.eventId];
      if (!m || !imported(m)) continue;
      const r = matchRound(m);
      if (r == null) continue;
      const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
      const p = data.players[a.playerId];
      if (stat === "fantasy" && !p?.gamePosition) continue; // no computable points
      byRound.set(r, (byRound.get(r) || 0) + appearanceStat(a, m, p?.gamePosition, adj, stat));
    }
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}

// Pivot series into recharts rows: [{ round, [series.key]: value }]. All series
// share the importedRounds() x-domain, so index i is the same round everywhere.
export function chartRows(series) {
  if (!series.length) return [];
  return series[0].points.map((p, i) => {
    const row = { round: p.round };
    for (const s of series) row[s.key] = s.points[i].value;
    return row;
  });
}
