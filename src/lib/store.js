// src/lib/store.js
// Pure operations on the fancystats.json data object. Every mutator returns a new object.
import { scoreAppearance } from "./scoring.js";

export const POS_MAP = { G: "GK", D: "DEF", M: "MID", F: "FWD" };

export function emptyData() {
  return {
    version: 1,
    meta: { tournamentId: 192, seasonId: 87682, lastEventSync: null },
    teams: {}, matches: {}, players: {}, appearances: {}, adjustments: {},
  };
}

function defaultPlayer(p) {
  return {
    name: p.name, teamId: p.teamId,
    gamePosition: null, gamePositionSource: null, realPosition: null,
    price: null, priceUpdatedAt: null,
    starred: false, inSquad: false, pasteAlias: null,
  };
}

// normalized: { match, teams, players, appearances } from sofascore.normalize()
export function applyImport(data, normalized, now) {
  const next = structuredClone(data);
  const { match, teams, players, appearances } = normalized;
  for (const t of teams) next.teams[t.id] = { name: t.name, shortName: t.shortName };
  for (const k of Object.keys(next.appearances)) {
    if (k.startsWith(match.eventId + ":")) delete next.appearances[k];
  }
  next.matches[match.eventId] = { ...match, importedAt: now };
  for (const a of appearances) next.appearances[`${a.eventId}:${a.playerId}`] = { ...a };
  for (const p of players) {
    const existing = next.players[p.id];
    if (existing) { existing.name = p.name; existing.teamId = p.teamId; }
    else next.players[p.id] = defaultPlayer(p);
  }
  return next;
}

// stubs: [{eventId, round, kickoff, status, homeTeamId, awayTeamId, homeScore, awayScore}]
export function upsertMatchStubs(data, stubs, teams) {
  const next = structuredClone(data);
  for (const t of teams) next.teams[t.id] = { name: t.name, shortName: t.shortName };
  for (const s of stubs) {
    const prev = next.matches[s.eventId] || {};
    next.matches[s.eventId] = { ...prev, ...s }; // preserves importedAt/goalTimes/partial when present
  }
  return next;
}

export function setPlayerField(data, playerId, field, value) {
  const next = structuredClone(data);
  const p = next.players[playerId];
  if (!p) return data;
  p[field] = value;
  if (field === "gamePosition") p.gamePositionSource = "manual";
  return next;
}

export function setAdjustment(data, key, adj) {
  const next = structuredClone(data);
  // booleans count as deltas even when false (e.g. clearing an erroneous red card)
  const hasDeltas = adj && Object.entries(adj).some(
    ([k, v]) => k !== "note" && (typeof v === "boolean" || (typeof v === "number" && v !== 0)),
  );
  if (hasDeltas) next.adjustments[key] = adj;
  else delete next.adjustments[key];
  return next;
}

export function playerAppearances(data, playerId) {
  return Object.values(data.appearances)
    .filter((a) => a.playerId === Number(playerId) || a.playerId === playerId)
    .sort((a, b) => (data.matches[a.eventId]?.kickoff || 0) - (data.matches[b.eventId]?.kickoff || 0));
}

export function deriveRealPosition(apps) {
  const counts = {};
  for (const a of apps) {
    if (!a.positionPlayed) continue;
    counts[a.positionPlayed] = (counts[a.positionPlayed] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return { position: POS_MAP[entries[0][0]], count: entries[0][1], total };
}

// Mismatch when game position disagrees with where they actually play.
// Manual realPosition override beats derivation; require >=3 observations to flag.
export function positionMismatch(player, apps) {
  if (!player.gamePosition) return false;
  if (player.realPosition) return player.realPosition !== player.gamePosition;
  const derived = deriveRealPosition(apps);
  if (!derived || derived.total < 3) return false;
  return derived.position !== player.gamePosition;
}

export function playerTotals(data, playerId) {
  const player = data.players[playerId];
  const apps = playerAppearances(data, playerId);
  const t = { minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: player?.gamePosition ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists;
    a.started ? t.starts++ : t.subApps++;
    if (t.points !== null) {
      const match = data.matches[a.eventId];
      if (match?.goalTimes) t.points += scoreAppearance(a, match, player.gamePosition, adj).total;
    }
  }
  return t;
}

// kind: "price" | "GK" | "DEF" | "MID" | "FWD"
export function applyPasteResults(data, matched, kind, now) {
  const next = structuredClone(data);
  for (const m of matched) {
    const p = next.players[m.playerId];
    if (!p) continue;
    if (kind === "price") {
      p.price = m.value;
      p.priceUpdatedAt = now;
    } else if (p.gamePositionSource !== "manual") {
      p.gamePosition = kind;
      p.gamePositionSource = "paste";
    }
    if (m.alias) p.pasteAlias = m.alias;
  }
  return next;
}
