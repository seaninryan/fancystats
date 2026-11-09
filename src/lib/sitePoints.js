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

// -> { byKey: Map<"eventId:playerId", {total, rows}>, unresolved: [{playerId, siteId, gw, total, reason}] }
// reason: "no-match" (no single match that round for the player's team) |
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

  for (const [siteKey, blocks] of Object.entries(site.history)) {
    const pid = bySite.get(Number(siteKey));
    if (!pid) continue; // not linked to any of our players
    const apps = appsOf.get(pid) || new Map();
    // His team that week: the clubs he has appeared for this season, plus his current one.
    // Never the block's crests — their order isn't home/away and one can be his current club.
    const teams = new Set([...apps.values()].map((a) => Number(a.teamId)));
    if (view.players[pid].teamId != null) teams.add(Number(view.players[pid].teamId));
    for (const [gw, clubA, clubB, total, rows] of blocks) {
      const played = playedIn(rows);
      const flag = (reason) => {
        if (played) out.unresolved.push({ playerId: pid, siteId: Number(siteKey), gw: Number(gw), total: Number(total), reason });
      };
      let cands = (byRound.get(Number(gw)) || []).filter((m) => teams.has(m.homeTeamId) || teams.has(m.awayTeamId));
      const withApp = cands.filter((m) => apps.has(Number(m.eventId)));
      if (withApp.length) cands = withApp;
      if (cands.length > 1) { // double gameweek: the block's two clubs pick the match
        const clubs = new Set([teamOfClub(clubA), teamOfClub(clubB)]);
        cands = cands.filter((m) => clubs.has(m.homeTeamId) && clubs.has(m.awayTeamId));
      }
      if (cands.length !== 1) { flag("no-match"); continue; }
      const m = cands[0];
      if (apps.has(Number(m.eventId))) out.byKey.set(`${m.eventId}:${pid}`, { total: Number(total), rows });
      else flag("no-appearance");
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
