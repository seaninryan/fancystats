// src/lib/store.js
// Pure operations on the fancystats.json data object. Every mutator returns a new object.
import { scoreAppearance } from "./scoring.js";

export const POS_MAP = { G: "GK", D: "DEF", M: "MID", F: "FWD" };

export function emptyData() {
  return {
    version: 1,
    meta: { tournamentId: 192, seasonId: 87682, lastEventSync: null },
    teams: {}, matches: {}, players: {}, appearances: {}, adjustments: {}, absences: {},
  };
}

function defaultPlayer(p) {
  return {
    name: p.name, teamId: p.teamId,
    customName: null,
    gamePosition: null, gamePositionSource: null, realPosition: null,
    price: null, priceUpdatedAt: null,
    sitePoints: null,
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
  const t = { minutes: 0, goals: 0, assists: 0, pens: 0, starts: 0, subApps: 0, points: position ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) {
      for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
      // pre-penScored appearances lack the field — clamp like leagueTable does
      if (typeof adj.penScored === "number") eff.penScored = Math.max(0, (eff.penScored || 0) + adj.penScored);
    }
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists; t.pens += eff.penScored || 0;
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
      p.price = m.price ?? m.value; // old pastes carry the price as the only number
      p.priceUpdatedAt = now;
    } else if (p.gamePositionSource !== "manual") {
      p.gamePosition = kind;
      p.gamePositionSource = "paste";
    }
    // two-column site rows (price + total) enrich any paste kind
    if (m.price != null) {
      p.price = m.price;
      p.priceUpdatedAt = now;
      p.sitePoints = m.value;
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

// ---- per-match absences (user-owned; imports never touch them) ----
// Marked directly on grid cells: why a player misses/missed a given match.

export function setAbsence(data, eventId, playerId, note, now) {
  const next = structuredClone(data);
  next.absences = next.absences || {}; // pre-absences stored data
  const key = `${eventId}:${playerId}`;
  if (note) next.absences[key] = { note, setAt: now };
  else delete next.absences[key];
  return next;
}

export function getAbsence(data, eventId, playerId) {
  return data.absences?.[`${eventId}:${playerId}`] || null;
}

// "Out now" = has an absence on an upcoming (unplayed) match; returns the
// soonest one so lists can show the current reason.
export function playerOutNow(data, playerId, now = Date.now()) {
  let best = null;
  for (const [key, a] of Object.entries(data.absences || {})) {
    const [eventId, pid] = key.split(":");
    if (pid !== String(playerId)) continue;
    const m = data.matches[eventId];
    if (!m || m.kickoff <= now || m.status === "finished") continue;
    if (!best || m.kickoff < data.matches[best.eventId].kickoff) {
      best = { ...a, eventId: Number(eventId) };
    }
  }
  return best;
}

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
// don't always match the fantasy site's, and re-imports must not clobber the fix).
export const playerName = (p) => p?.customName || p?.name || "?";

// A player who appears in matches but has no game position earns no points in
// our model — almost always an unlinked fantasy-site identity. Surface it loudly.
export function missingFantasyData(player, apps) {
  return apps.length > 0 && !player?.gamePosition;
}

// 🔥 form: at least HOT_NEEDED of the player's TEAM's last HOT_WINDOW matches
// scored ≥ HOT_THRESHOLD fantasy points.
const HOT_THRESHOLD = 8;
const HOT_WINDOW = 3;
const HOT_NEEDED = 2;

// Imported team matches in kickoff order — the spine of the hot windows.
function teamImportedMatches(data, teamId) {
  return Object.values(data.matches)
    .filter((m) => m.importedAt && m.goalTimes && (m.homeTeamId === teamId || m.awayTeamId === teamId))
    .sort((a, b) => a.kickoff - b.kickoff);
}

// EventIds of team matches AFTER which the player was hot: the trailing
// HOT_WINDOW team matches (ending at that match) include >= HOT_NEEDED games
// of >= HOT_THRESHOLD points. Missing a game consumes a slot. Single source
// of the hot rule — isHot is "hot after the latest match".
export function hotEventIds(data, playerId, appsArg = null) {
  const out = new Set();
  const player = data.players[playerId];
  if (!player?.gamePosition) return out;
  const teamMatches = teamImportedMatches(data, player.teamId);
  const apps = appsArg ?? playerAppearances(data, playerId);
  const byEvent = new Map(apps.map((a) => [a.eventId, a]));
  const scores = teamMatches.map((m) => {
    const a = byEvent.get(m.eventId);
    if (!a) return null; // didn't play that one — consumes a slot
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    return scoreAppearance(a, m, player.gamePosition, adj).total;
  });
  for (let i = 0; i < teamMatches.length; i++) {
    const from = Math.max(0, i - HOT_WINDOW + 1);
    if (i - from + 1 < HOT_NEEDED) continue; // not enough matches yet
    let good = 0;
    for (let j = from; j <= i; j++) if (scores[j] != null && scores[j] >= HOT_THRESHOLD) good++;
    if (good >= HOT_NEEDED) out.add(teamMatches[i].eventId);
  }
  return out;
}

export function isHot(data, playerId, appsArg = null) {
  const player = data.players[playerId];
  if (!player?.gamePosition) return false;
  const teamMatches = teamImportedMatches(data, player.teamId);
  if (!teamMatches.length) return false;
  return hotEventIds(data, playerId, appsArg).has(teamMatches[teamMatches.length - 1].eventId);
}

// teamId -> Set of the team's last N imported match eventIds (the same window
// the Teams page and isHot use). Feeds windowed totals on cross-team screens.
export function teamWindowEventIds(data, n) {
  const byTeam = new Map();
  for (const m of Object.values(data.matches)) {
    if (!m.importedAt || !m.goalTimes) continue;
    for (const tid of [m.homeTeamId, m.awayTeamId]) {
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid).push(m);
    }
  }
  const out = new Map();
  for (const [tid, ms] of byTeam) {
    ms.sort((a, b) => a.kickoff - b.kickoff);
    out.set(tid, new Set(ms.slice(-n).map((m) => m.eventId)));
  }
  return out;
}

// teamId -> { site, withData, missing }: sum of the team's players' official
// fantasy-site totals plus paste coverage, for the Table tab's FPts cross-check.
export function teamSitePoints(data) {
  const out = new Map();
  for (const p of Object.values(data.players)) {
    const t = out.get(p.teamId) || { site: 0, withData: 0, missing: 0 };
    if (p.sitePoints != null) { t.site += p.sitePoints; t.withData++; }
    else t.missing++;
    out.set(p.teamId, t);
  }
  return out;
}

// Form vs baseline: fantasy points per TEAM match in the window minus the same
// over all earlier imported matches. Per team-match (not per appearance) so
// sitting out drags form down, consistent with the hot rule. null without a
// position, an empty window, or no baseline games (can't climb vs nothing).
export function playerClimb(data, playerId, { apps = null, windowIds } = {}) {
  const player = data.players[playerId];
  if (!player?.gamePosition || !windowIds?.size) return null;
  const prior = teamImportedMatches(data, player.teamId)
    .filter((m) => !windowIds.has(m.eventId));
  if (!prior.length) return null;
  const priorIds = new Set(prior.map((m) => m.eventId));
  const w = playerTotals(data, playerId, { apps, eventIds: windowIds }).points ?? 0;
  const p = playerTotals(data, playerId, { apps, eventIds: priorIds }).points ?? 0;
  return w / windowIds.size - p / priorIds.size;
}

// League table over imported matches. win = null (all) or N (each club's last
// N imported games, same window the rest of the app uses). League order:
// points, then goal difference, then goals scored.
export function leagueTable(data, win = null) {
  const windows = win ? teamWindowEventIds(data, win) : null;
  const rows = new Map();
  const row = (tid) => {
    if (!rows.has(tid)) {
      rows.set(tid, {
        teamId: tid, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0,
        fantasy: 0, yellows: 0, reds: 0, pensScored: 0, pensMissed: 0, assists: 0,
      });
    }
    return rows.get(tid);
  };
  for (const m of Object.values(data.matches)) {
    if (!m.importedAt || !m.goalTimes || m.homeScore == null || m.awayScore == null) continue;
    for (const side of ["home", "away"]) {
      const tid = side === "home" ? m.homeTeamId : m.awayTeamId;
      if (windows && !windows.get(tid)?.has(m.eventId)) continue;
      const r = row(tid);
      const gf = side === "home" ? m.homeScore : m.awayScore;
      const ga = side === "home" ? m.awayScore : m.homeScore;
      r.played++; r.gf += gf; r.ga += ga;
      if (gf > ga) { r.won++; r.points += 3; }
      else if (gf === ga) { r.drawn++; r.points += 1; }
      else r.lost++;
    }
  }
  for (const a of Object.values(data.appearances)) {
    const m = data.matches[a.eventId];
    if (!m?.importedAt || !m.goalTimes) continue;
    if (windows && !windows.get(a.teamId)?.has(a.eventId)) continue;
    const r = rows.get(a.teamId);
    if (!r) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const eff = { ...a };
    if (adj) {
      for (const f of ["goals", "assists", "penScored", "penMissed"]) {
        if (typeof adj[f] === "number") eff[f] = Math.max(0, (eff[f] || 0) + adj[f]);
      }
      if (typeof adj.secondYellow === "boolean") eff.secondYellow = adj.secondYellow;
      if (typeof adj.red === "boolean") eff.red = adj.red;
    }
    r.assists += eff.assists || 0;
    r.yellows += (eff.yellow || 0) + (eff.secondYellow ? 1 : 0); // the second yellow is a yellow too
    r.reds += (eff.red ? 1 : 0) + (eff.secondYellow ? 1 : 0);    // dismissals
    r.pensScored += eff.penScored || 0;
    r.pensMissed += eff.penMissed || 0;
    const p = data.players[a.playerId];
    if (p?.gamePosition) r.fantasy += scoreAppearance(a, m, p.gamePosition, adj).total;
  }
  return [...rows.values()].sort(
    (x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf,
  );
}

// One pass over all appearances: eventId -> { home, away } fantasy-point sums.
// Positionless players contribute nothing (they have no computable points).
export function allMatchTeamPoints(data) {
  const out = new Map();
  for (const a of Object.values(data.appearances)) {
    const m = data.matches[a.eventId];
    if (!m?.goalTimes) continue;
    const p = data.players[a.playerId];
    if (!p?.gamePosition) {
      if (!out.has(a.eventId)) out.set(a.eventId, { home: 0, away: 0 });
      continue;
    }
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const side = a.teamId === m.homeTeamId ? "home" : "away";
    const t = out.get(a.eventId) || { home: 0, away: 0 };
    t[side] += scoreAppearance(a, m, p.gamePosition, adj).total;
    out.set(a.eventId, t);
  }
  return out;
}
