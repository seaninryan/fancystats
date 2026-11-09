// src/lib/seasons.js
// Season projection: the app renders one season at a time by handing every tab
// seasonView(data, id) instead of raw data, so no derivation needs a season filter.
import { ARCHIVED_FIELDS, playerTotals, playerAppearances } from "./store.js";

const eventOf = (key) => key.split(":")[0];
const pick = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keep(k)));

export function seasonView(data, seasonId) {
  const sid = Number(seasonId);
  const matches = pick(data.matches, (k) => Number(data.matches[k].seasonId) === sid);
  const inSeason = (k) => eventOf(k) in matches;
  let players = data.players;
  if (sid !== Number(data.meta.seasonId)) {
    const archive = data.seasons?.[sid]?.players || {};
    players = Object.fromEntries(Object.entries(data.players).map(([pid, p]) => {
      const a = archive[pid] || {};
      const restored = Object.fromEntries(ARCHIVED_FIELDS.map((f) => [f, a[f] ?? (f === "inSquad" ? false : null)]));
      return [pid, { ...p, ...restored }];
    }));
  }
  return {
    ...data,
    matches,
    players,
    appearances: pick(data.appearances, inSeason),
    adjustments: pick(data.adjustments, inSeason),
    absences: pick(data.absences, inSeason),
    site: data.site?.[sid] ?? null,
  };
}

export function seasonList(data) {
  const cur = Number(data.meta.seasonId);
  return Object.entries(data.seasons || {})
    .map(([id, s]) => ({ seasonId: Number(id), label: s.label, current: Number(id) === cur }))
    .sort((a, b) => (b.current - a.current) || (b.seasonId - a.seasonId));
}

export function previousSeasonId(data) {
  return seasonList(data).find((s) => !s.current)?.seasonId ?? null;
}

// { seasonId, label, apps, minutes, goals, assists, points } for the player's
// previous season, or null when there is none or they didn't play in it.
// `points` is itself null when the player had no fantasy position that season.
export function previousSeasonTotals(data, playerId) {
  const prev = previousSeasonId(data);
  if (prev == null) return null;
  const view = seasonView(data, prev);
  const apps = playerAppearances(view, playerId);
  if (!apps.length) return null;
  const t = playerTotals(view, playerId, { apps });
  return { seasonId: prev, label: data.seasons[prev].label, apps: apps.length, minutes: t.minutes, goals: t.goals, assists: t.assists, points: t.points };
}
