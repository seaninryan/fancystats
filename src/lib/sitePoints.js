// src/lib/sitePoints.js
// The fantasy site's own per-gameweek points, mapped onto our matches at render
// time. Site points win wherever they exist; our scoring (scoring.js) fills gaps.
// Works on a SEASON VIEW only (seasonView puts the season's site data on view.site);
// raw data has no view.site, so site points never apply to it.
// See docs/superpowers/specs/2026-11-09-fantasy-site-sync-design.md.
import { scoreAppearance } from "./scoring.js";
import { matchRound, playerName } from "./store.js";
import { mapClubs } from "./fantasyImport.js";

const DIDNT_PLAY = "Didn't Play";
const cache = new WeakMap(); // view -> index; views are immutable (mutators return new data)

const playedIn = (rows) => (rows || []).find((r) => r[0] === "Appearance")?.[1] !== DIDNT_PLAY;

// -> { byKey: Map<"eventId:playerId", {total, rows, notInGame?}>, unresolved: [{playerId, siteId, gw, total, reason}] }
// A block maps to the match whose OPPONENT is one of the block's two crests (crest order isn't
// home/away, and his own crest may be his current club). A played block beats "Didn't Play", and
// the first played block wins. Weeks he has no block for (up to the capture's latest gameweek)
// become { total: 0, rows: [], notInGame: true }: he wasn't in the fantasy game yet.
// reason: "no-match" (no single match that round against that opponent for the player's team) |
//         "no-appearance" (the match exists, the site says he played, SofaScore has no appearance)
export function siteIndex(view) {
  if (cache.has(view)) return cache.get(view);
  const out = { byKey: new Map(), unresolved: [] };
  cache.set(view, out);
  const site = view.site;
  if (!site?.history) return out;

  const clubMap = mapClubs(site.clubs || [], view.teams, view.meta?.fantasyClubMap);
  const teamOfClub = (c) => (c != null && clubMap[String(c)] != null ? Number(clubMap[String(c)]) : null);
  const byRound = new Map();
  for (const m of Object.values(view.matches)) {
    if (!m.importedAt || !m.goalTimes) continue;
    const r = matchRound(m);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const appsOf = new Map(); // playerId -> Map(eventId -> appearance)
  for (const a of Object.values(view.appearances)) {
    const k = String(a.playerId);
    if (!appsOf.has(k)) appsOf.set(k, new Map());
    appsOf.get(k).set(Number(a.eventId), a);
  }
  const bySite = new Map();
  for (const [pid, p] of Object.entries(view.players)) if (p.siteId != null) bySite.set(Number(p.siteId), pid);

  // Latest gameweek the capture covers: weeks after it simply haven't been scored yet.
  let latestGw = 0;
  for (const blocks of Object.values(site.history)) for (const b of blocks) if (Number(b[0]) > latestGw) latestGw = Number(b[0]);

  for (const [siteKey, blocks] of Object.entries(site.history)) {
    const pid = bySite.get(Number(siteKey));
    if (!pid) continue; // not linked to any of our players
    const apps = appsOf.get(pid) || new Map();
    // His team that week: the clubs he has appeared for this season, plus his current one.
    // Never the block's crests — their order isn't home/away and one can be his current club.
    const teams = new Set([...apps.values()].map((a) => Number(a.teamId)));
    if (view.players[pid].teamId != null) teams.add(Number(view.players[pid].teamId));
    const taken = new Map(); // key -> whether the block stored there was a played one
    for (const [gw, clubA, clubB, total, rows] of blocks) {
      // A "Didn't Play" week can still cost points (booked on the bench): it counts like a played one.
      const played = playedIn(rows) || Number(total) !== 0;
      const flag = (reason) => {
        if (played) out.unresolved.push({ playerId: pid, siteId: Number(siteKey), gw: Number(gw), total: Number(total), reason });
      };
      // The block's opponent must be the match's opponent. Crest order isn't home/away and his own
      // crest can be his CURRENT club after a transfer, but the opponent crest is reliable.
      const ta = teamOfClub(clubA), tb = teamOfClub(clubB);
      const fits = (m) => {
        if (ta == null || tb == null) return true; // a crest we can't map: can't check
        const mine = Number(apps.get(Number(m.eventId))?.teamId ?? (teams.has(m.homeTeamId) ? m.homeTeamId : m.awayTeamId));
        const opp = mine === m.homeTeamId ? m.awayTeamId : m.homeTeamId;
        return opp === ta || opp === tb;
      };
      let cands = (byRound.get(Number(gw)) || [])
        .filter((m) => (teams.has(m.homeTeamId) || teams.has(m.awayTeamId)) && fits(m));
      const withApp = cands.filter((m) => apps.has(Number(m.eventId)));
      if (withApp.length) cands = withApp;
      if (cands.length !== 1) { flag("no-match"); continue; }
      const m = cands[0];
      if (!apps.has(Number(m.eventId))) { flag("no-appearance"); continue; }
      const key = `${m.eventId}:${pid}`;
      if (taken.get(key) === true || (taken.has(key) && !played)) continue; // played beats "Didn't Play"; first played wins
      taken.set(key, played);
      out.byKey.set(key, { total: Number(total), rows });
    }
    // Weeks the site has no block for at all: he wasn't in the fantasy game that week
    // (e.g. registered later), so the site scored him 0 — up to the latest captured gameweek.
    const siteGws = new Set(blocks.map((b) => Number(b[0])));
    for (const a of apps.values()) {
      const m = view.matches[a.eventId];
      if (!m?.importedAt || !m.goalTimes) continue;
      const r = matchRound(m);
      const key = `${a.eventId}:${pid}`;
      if (r != null && r <= latestGw && !siteGws.has(Number(r)) && !out.byKey.has(key)) {
        out.byKey.set(key, { total: 0, rows: [], notInGame: true });
      }
    }
  }
  return out;
}

// The single rule for an appearance's fantasy points.
// -> { total: number|null, source: "site"|"ours"|null, site: {total, rows}|null, ours: scoreAppearance()|null }
// opts.position (mismatch what-ifs) forces our scoring: the site has no "what if".
export function appearancePoints(view, app, { position = null } = {}) {
  const key = `${app.eventId}:${app.playerId}`;
  const m = view.matches[app.eventId];
  const pos = position ?? view.players[app.playerId]?.gamePosition;
  const adj = view.adjustments[key] || null;
  const ours = pos && m?.goalTimes ? scoreAppearance(app, m, pos, adj) : null;
  const site = position == null ? siteIndex(view).byKey.get(key) ?? null : null;
  if (site) return { total: site.total, source: "site", site, ours };
  return { total: ours ? ours.total : null, source: ours ? "ours" : null, site: null, ours };
}

const SITE_COMPONENT = {
  Appearance: "appearance", "Team Result": "result", "Clean Sheet": "clean sheet", Goals: "goals", Assists: "assists",
  "Yellow Cards": "cards", "Red Cards": "cards", "Own Goals": "own goal", "Penalty Misses": "pen miss", "Penalty Saves": "pen save",
};
const OUR_COMPONENT = {
  sub: "appearance", startedSubbedOff: "appearance", fullMatch: "appearance", win: "result", draw: "result",
  cleanSheet: "clean sheet", goals: "goals", assists: "assists", yellow: "cards", secondYellow: "cards",
  straightRed: "cards", ownGoal: "own goal", penMiss: "pen miss", penSave: "pen save",
};

// Which scoring components differ between a site block's rows ([stat, value, points])
// and our breakdown ([reason, points]) — the "(assists)" in "site 8 · ours 5 (assists)".
export function diffComponents(siteRows, ourBreakdown) {
  const sum = (pairs, names) => {
    const o = {};
    for (const [k, v] of pairs) { const c = names[k] || k; o[c] = (o[c] || 0) + Number(v); }
    return o;
  };
  const s = sum((siteRows || []).map((r) => [r[0], r[2]]), SITE_COMPONENT);
  const o = sum(ourBreakdown || [], OUR_COMPONENT);
  return [...new Set([...Object.keys(s), ...Object.keys(o)])].filter((k) => (s[k] || 0) !== (o[k] || 0));
}

// Sync-preview grouping of siteIndex(view).unresolved: [{gw, reason, count, names}], by gw then reason.
export function unresolvedSummary(view) {
  const groups = new Map();
  for (const u of siteIndex(view).unresolved) {
    const k = `${u.gw}|${u.reason}`;
    if (!groups.has(k)) groups.set(k, { gw: u.gw, reason: u.reason, count: 0, names: [] });
    const g = groups.get(k);
    g.count++;
    g.names.push(playerName(view.players[u.playerId]));
  }
  return [...groups.values()].sort((a, b) => a.gw - b.gw || a.reason.localeCompare(b.reason));
}
