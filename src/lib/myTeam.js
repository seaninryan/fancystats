// src/lib/myTeam.js
// The user's own fantasy team per gameweek, from the season's site data
// (view.site.myTeam, stored raw by applySiteSync). Season views only.
import { playerName } from "./store.js";

export const LINE_LABELS = ["GK", "DEF", "MID", "FWD"];

function bySiteId(players) {
  const m = new Map();
  for (const [pid, p] of Object.entries(players || {})) if (p.siteId != null) m.set(Number(p.siteId), pid);
  return m;
}

export function myTeamGameweeks(view) {
  return Object.keys(view.site?.myTeam || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

// -> { gw, total, lines: [{label, players}], bench } | null; entries are
// { siteId, playerId|null, name, points, captain }. Lines are the site's own pitch rows.
export function myTeamGameweek(view, gw) {
  const g = view.site?.myTeam?.[gw];
  if (!g) return null;
  const ids = bySiteId(view.players);
  const entry = (sid) => {
    const playerId = ids.get(Number(sid)) ?? null;
    return {
      siteId: Number(sid),
      playerId,
      name: playerId ? playerName(view.players[playerId]) : g.names?.[sid] ?? `#${sid}`,
      points: g.shown?.[sid] ?? null,
      captain: g.captain != null && Number(sid) === Number(g.captain),
    };
  };
  const lines = g.lines || [];
  return {
    gw: Number(gw),
    total: g.total ?? null,
    lines: lines.map((l, i) => ({ label: lines.length === LINE_LABELS.length ? LINE_LABELS[i] : "XI", players: l.map(entry) })),
    bench: (g.bench || []).map(entry),
  };
}

export function myTeamSeries(view) {
  return myTeamGameweeks(view).map((gw) => ({ gw, total: view.site.myTeam[gw].total ?? null }));
}
