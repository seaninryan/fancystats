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

// Stat selector for the Table tab graph: [key, button label].
export const TEAM_STATS = [
  ["points", "Pts"], ["fantasy", "FPts"], ["yellows", "Yel"], ["reds", "Red"], ["assists", "Ast"],
];

// One team's per-gameweek value. stat: "points" (league 3/1/0) | "fantasy" |
// "yellows" | "reds" | "assists". Accounting mirrors leagueTable so the graph
// always agrees with the table columns.
export function teamWeeklySeries(data, teamId, stat) {
  const rounds = importedRounds(data);
  const tid = Number(teamId);
  const byRound = new Map();
  for (const m of Object.values(data.matches)) {
    if (!imported(m) || (m.homeTeamId !== tid && m.awayTeamId !== tid)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    let v = byRound.get(r) || 0;
    if (stat === "points" && m.homeScore != null && m.awayScore != null) {
      const gf = m.homeTeamId === tid ? m.homeScore : m.awayScore;
      const ga = m.homeTeamId === tid ? m.awayScore : m.homeScore;
      v += gf > ga ? 3 : gf === ga ? 1 : 0;
    }
    byRound.set(r, v);
  }
  if (stat !== "points") {
    for (const a of Object.values(data.appearances)) {
      if (a.teamId !== tid) continue;
      const m = data.matches[a.eventId];
      if (!m || !imported(m)) continue;
      const r = matchRound(m);
      if (r == null) continue;
      const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
      const eff = { ...a };
      if (adj) {
        if (typeof adj.assists === "number") eff.assists = Math.max(0, (eff.assists || 0) + adj.assists);
        if (typeof adj.secondYellow === "boolean") eff.secondYellow = adj.secondYellow;
        if (typeof adj.red === "boolean") eff.red = adj.red;
      }
      let v = 0;
      if (stat === "assists") v = eff.assists || 0;
      else if (stat === "yellows") v = (eff.yellow || 0) + (eff.secondYellow ? 1 : 0); // the second yellow is a yellow too
      else if (stat === "reds") v = (eff.red ? 1 : 0) + (eff.secondYellow ? 1 : 0);    // dismissals
      else if (stat === "fantasy") {
        const p = data.players[a.playerId];
        if (p?.gamePosition) v = scoreAppearance(a, m, p.gamePosition, adj).total;
      }
      byRound.set(r, (byRound.get(r) || 0) + v);
    }
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}
