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
    customName: null,
    gamePosition: null, gamePositionSource: null, realPosition: null,
    price: null, priceUpdatedAt: null,
    starred: false, inSquad: false, pasteAlias: null, flags: [],
  };
}

// normalized: { match, teams, players, appearances } from sofascore.normalize()
export function applyImport(data, normalized, now) {
  const next = structuredClone(data);
  const { match, teams, players, appearances } = normalized;
  for (const t of teams) next.teams[t.id] = { ...next.teams[t.id], name: t.name, shortName: t.shortName };
  for (const k of Object.keys(next.appearances)) {
    if (k.startsWith(match.eventId + ":")) delete next.appearances[k];
  }
  const prevMatch = next.matches[match.eventId];
  next.matches[match.eventId] = { ...match, importedAt: now };
  // user-owned match field survives re-import, like player edits do
  if (prevMatch?.roundOverride != null) next.matches[match.eventId].roundOverride = prevMatch.roundOverride;
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
  for (const t of teams) next.teams[t.id] = { ...next.teams[t.id], name: t.name, shortName: t.shortName };
  for (const s of stubs) {
    const prev = next.matches[s.eventId] || {};
    next.matches[s.eventId] = { ...prev, ...s }; // preserves importedAt/goalTimes/partial when present
  }
  return next;
}

// Effective gameweek: the user's override wins (matches get moved, double weeks happen).
export function matchRound(m) {
  return m.roundOverride ?? m.round;
}

export function setMatchRound(data, eventId, round) {
  const next = structuredClone(data);
  const m = next.matches[eventId];
  if (!m) return data;
  if (round == null || round === m.round) delete m.roundOverride;
  else m.roundOverride = round;
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

export function setTeamColor(data, teamId, colorBg) {
  const next = structuredClone(data);
  const t = next.teams[teamId];
  if (!t) return data;
  if (colorBg) t.colorBg = colorBg;
  else delete t.colorBg;
  return next;
}

export function playerAppearances(data, playerId) {
  return Object.values(data.appearances)
    .filter((a) => a.playerId === Number(playerId) || a.playerId === playerId)
    .sort((a, b) => (data.matches[a.eventId]?.kickoff || 0) - (data.matches[b.eventId]?.kickoff || 0));
}

// One-pass index for screens that need totals/mismatch for every player —
// avoids N full appearance scans (playerAppearances is O(all appearances) per call).
export function appearancesByPlayer(data) {
  const map = new Map();
  for (const a of Object.values(data.appearances)) {
    const arr = map.get(a.playerId);
    if (arr) arr.push(a);
    else map.set(a.playerId, [a]);
  }
  for (const arr of map.values()) {
    arr.sort((x, y) => (data.matches[x.eventId]?.kickoff || 0) - (data.matches[y.eventId]?.kickoff || 0));
  }
  return map;
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

// opts.position: score as if the player had this position (mismatch what-ifs).
// opts.eventIds: Set — only count appearances from these matches (windowed totals).
// opts.apps: precomputed appearances array (avoids redundant O(n) scans).
export function playerTotals(data, playerId, opts = {}) {
  const player = data.players[playerId];
  const position = opts.position ?? player?.gamePosition;
  let apps = opts.apps ?? playerAppearances(data, playerId);
  if (opts.eventIds) apps = apps.filter((a) => opts.eventIds.has(a.eventId));
  const t = { minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: position ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists;
    a.started ? t.starts++ : t.subApps++;
    if (t.points !== null) {
      const match = data.matches[a.eventId];
      if (match?.goalTimes) t.points += scoreAppearance(a, match, position, adj).total;
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

// ---- availability flags (user-owned; imports never touch them) ----

const isFlagActive = (f, now) => !f.clearedAt && (f.until == null || f.until > now);

export function markOut(data, playerId, note, now, until = null) {
  const p0 = data.players[playerId];
  if (!p0) return data;
  if ((p0.flags || []).some((f) => isFlagActive(f, now))) return data; // already out — no change
  const next = structuredClone(data);
  const p = next.players[playerId];
  p.flags = p.flags || [];
  p.flags.push({ setAt: now, clearedAt: null, note: note || "", until });
  return next;
}

export function clearOut(data, playerId, now) {
  const next = structuredClone(data);
  const f = next.players[playerId]?.flags?.find((x) => isFlagActive(x, now));
  if (!f) return data;
  f.clearedAt = now;
  return next;
}

export const activeFlag = (p, now = Date.now()) =>
  p?.flags?.find((f) => isFlagActive(f, now)) || null;

// Matches whose date sits clearly inside another round's date cluster — the
// SofaScore reschedule pattern. Returns Map<eventId, suggestedRound>.
export function roundSuspects(data) {
  const DAY = 86400000;
  const groups = new Map();
  for (const m of Object.values(data.matches)) {
    if (m.status === "postponed" || m.status === "canceled") continue;
    if (isSupersededPostponed(data, m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(m);
  }
  const medians = new Map();
  for (const [r, ms] of groups) {
    const ks = ms.map((m) => m.kickoff).sort((a, b) => a - b);
    medians.set(r, ks[Math.floor(ks.length / 2)]);
  }
  const suspects = new Map();
  for (const [r, ms] of groups) {
    for (const m of ms) {
      let best = r;
      let bestDist = Math.abs(m.kickoff - medians.get(r));
      for (const [r2, med] of medians) {
        if (r2 === r) continue;
        const d2 = Math.abs(m.kickoff - med);
        if (d2 < bestDist - 2 * DAY) { best = r2; bestDist = d2; } // clearly closer
      }
      if (best !== r) suspects.set(m.eventId, best);
    }
  }
  return suspects;
}

// ---- directional position mismatch ----

// null when positions agree (or can't be established). delta > 0 means the game's
// position OVERPAYS vs where they really play — a player to exploit.
export function mismatchInfo(data, playerId, apps = null) {
  const player = data.players[playerId];
  if (!player?.gamePosition) return null;
  const theirApps = apps ?? playerAppearances(data, playerId);
  let real = player.realPosition;
  if (!real) {
    const derived = deriveRealPosition(theirApps);
    if (derived && derived.total >= 3) real = derived.position;
  }
  if (!real || real === player.gamePosition) return null;
  const gamePts = playerTotals(data, playerId, { apps: theirApps }).points ?? 0;
  const realPts = playerTotals(data, playerId, { position: real, apps: theirApps }).points ?? 0;
  return { realPosition: real, delta: gamePts - realPts };
}

// ---- postponed/stale hygiene ----

// A postponed event whose pairing+natural-round has a real sibling event is a dead
// shell left behind by SofaScore rescheduling (they create a new event id).
export function isSupersededPostponed(data, m) {
  if (m.status !== "postponed" && m.status !== "canceled") return false;
  // NOTE: pairing check is home/away order-exact — the observed SofaScore reschedule
  // pattern keeps the venue. A venue-swapped reschedule would not be detected.
  return Object.values(data.matches).some((o) =>
    o.eventId !== m.eventId && o.status !== "postponed" && o.status !== "canceled" &&
    o.homeTeamId === m.homeTeamId && o.awayTeamId === m.awayTeamId && o.round === m.round);
}

// Matches that kicked off (>3h ago) whose stats we don't have yet.
export function staleInfo(data, now) {
  const cutoff = now - 3 * 3600 * 1000;
  const missing = Object.values(data.matches).filter((m) =>
    m.kickoff < cutoff &&
    m.status !== "postponed" && m.status !== "canceled" &&
    !(m.status === "finished" && m.importedAt) &&
    !isSupersededPostponed(data, m));
  return { count: missing.length };
}

// Display name: the user's override wins (SofaScore short names like "Pico"
// don't always match fantasyloi's, and re-imports must not clobber the fix).
export const playerName = (p) => p?.customName || p?.name || "?";

// A player who appears in matches but has no game position earns no points in
// our model — almost always an unlinked fantasyloi identity. Surface it loudly.
export function missingFantasyData(player, apps) {
  return apps.length > 0 && !player?.gamePosition;
}
