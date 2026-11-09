// src/lib/seasons.js
// Season projection: the app renders one season at a time by handing every tab
// seasonView(data, id) instead of raw data, so no derivation needs a season filter.
import { ARCHIVED_FIELDS, playerTotals, playerAppearances } from "./store.js";

const eventOf = (key) => key.split(":")[0];
const pick = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keep(k)));

// Clubs that only visit the season's event list: SofaScore files the end-of-season
// promotion/relegation playoffs (First Division clubs, not part of the fantasy game)
// under the Premier Division season. A guest club has under GUEST_SHARE of the busiest
// club's matches; judged only once the busiest club has GUEST_MIN_MATCHES, so the
// opening rounds (everyone on 1-2 matches) never trip it.
const GUEST_SHARE = 0.25;
const GUEST_MIN_MATCHES = 8;
export function guestTeams(matches) {
  const n = new Map();
  for (const m of Object.values(matches)) for (const t of [m.homeTeamId, m.awayTeamId]) n.set(Number(t), (n.get(Number(t)) || 0) + 1);
  const max = Math.max(0, ...n.values());
  if (max < GUEST_MIN_MATCHES) return new Set();
  return new Set([...n].filter(([, c]) => c < max * GUEST_SHARE).map(([t]) => t));
}

export function seasonView(data, seasonId) {
  const sid = Number(seasonId);
  const all = pick(data.matches, (k) => Number(data.matches[k].seasonId) === sid);
  // Playoff matches against guest clubs are left out of everything (data untouched).
  const guests = guestTeams(all);
  const matches = pick(all, (k) => !guests.has(Number(all[k].homeTeamId)) && !guests.has(Number(all[k].awayTeamId)));
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
  const appearances = pick(data.appearances, inSeason);
  if (guests.size) {
    // A guest club's players go too — unless they also played for a league club this season.
    const playedHere = new Set(Object.values(appearances).map((a) => String(a.playerId)));
    players = pick(players, (pid) => !guests.has(Number(players[pid].teamId)) || playedHere.has(pid));
  }
  return {
    ...data,
    teams: guests.size ? pick(data.teams, (t) => !guests.has(Number(t))) : data.teams,
    matches,
    players,
    appearances,
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
