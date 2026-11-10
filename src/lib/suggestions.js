// src/lib/suggestions.js
// Transfer suggestions for the My Team panel: the weakest players in the user's squad,
// players worth bringing in, and the clubs with the easiest next fixtures — all ranked by
// one outlook score (recent form adjusted by fixture ease). Season views only; nothing stored.
// See docs/superpowers/specs/2026-11-09-fantasy-suggestions-design.md.
import { teamWindowEventIds, playerTotals, appearancesByPlayer, isHot, activeFlag, playerOutNow, playerName, matchRound } from "./store.js";
import { fixtureContext, compareFixture } from "./fixtures.js";
import { myTeamGameweeks, teamLines } from "./myTeam.js";

export const FORM_WINDOW = 5;     // team matches, same window as the Teams page
export const FIXTURE_COUNT = 3;   // upcoming fixtures that count
export const FIXTURE_WEIGHT = 0.5; // a perfectly easy run lifts form by half

const STALE_MS = 3 * 3600 * 1000; // same 3h grace as staleInfo
const gone = (m) => m.status === "postponed" || m.status === "canceled";
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function suggestionContext(view, now = Date.now()) {
  const ctx = fixtureContext(view);
  const upcoming = new Map(); // teamId (number) -> fixtures, soonest first
  const future = Object.values(view.matches)
    // A kickoff more than STALE_MS ago is a result we haven't imported, not a fixture.
    .filter((m) => !m.importedAt && m.status !== "finished" && !gone(m) && (m.kickoff ?? Infinity) > now - STALE_MS)
    .sort((a, b) => (a.kickoff || 0) - (b.kickoff || 0));
  for (const m of future) {
    const cmp = compareFixture(ctx, m);
    for (const home of [true, false]) {
      const teamId = Number(home ? m.homeTeamId : m.awayTeamId);
      const list = upcoming.get(teamId) || [];
      if (list.length >= FIXTURE_COUNT) continue;
      list.push({
        eventId: m.eventId, round: matchRound(m), kickoff: m.kickoff,
        opponentId: Number(home ? m.awayTeamId : m.homeTeamId), home,
        ease: cmp ? (home ? cmp.score : -cmp.score) : 0,
        tag: cmp?.favoured && Number(cmp.favoured.teamId) === teamId ? cmp.favoured.tag : null,
      });
      upcoming.set(teamId, list);
    }
  }
  return {
    view, now, upcoming, anyUpcoming: upcoming.size > 0,
    windows: teamWindowEventIds(view, FORM_WINDOW),
    apps: appearancesByPlayer(view),
    outlooks: new Map(), // playerId -> outlook, filled on demand (filters re-rank, never recompute)
  };
}

export function playerOutlook(sctx, playerId) {
  const key = String(playerId);
  if (!sctx.outlooks.has(key)) sctx.outlooks.set(key, computeOutlook(sctx, playerId));
  return sctx.outlooks.get(key);
}

function computeOutlook(sctx, playerId) {
  const { view, now } = sctx;
  const p = view.players[playerId];
  if (!p?.gamePosition || p.teamId == null) return null;
  const apps = sctx.apps.get(Number(playerId)) || [];
  const win = sctx.windows.get(Number(p.teamId));
  const games = win?.size ?? 0;
  const points = games ? playerTotals(view, playerId, { apps, eventIds: win }).points ?? 0 : 0;
  const form = games ? points / games : 0;
  const fixtures = sctx.upcoming.get(Number(p.teamId)) || [];
  const ease = mean(fixtures.map((f) => f.ease));
  return {
    playerId: String(playerId), name: playerName(p), position: p.gamePosition, teamId: Number(p.teamId),
    price: p.price ?? null, form, games, points, fixtures, ease,
    score: form + Math.abs(form) * FIXTURE_WEIGHT * ease,
    hot: isHot(view, playerId, apps),
    out: activeFlag(p, now) || playerOutNow(view, playerId, now),
  };
}

export function mySquad(view) {
  const gws = myTeamGameweeks(view);
  if (!gws.length) return [];
  const t = teamLines(view, view.site.myTeam[gws[gws.length - 1]]);
  return [...t.lines.flatMap((l) => l.players), ...t.bench];
}

export function sellCandidates(sctx) {
  const rows = mySquad(sctx.view).map((entry) => ({
    entry, outlook: entry.playerId ? playerOutlook(sctx, entry.playerId) : null,
  }));
  const rank = (r) => (r.outlook == null ? 2 : r.outlook.out ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.outlook && b.outlook ? a.outlook.score - b.outlook.score : 0));
}

export function buyTargets(sctx, { position = null, limit = 5 } = {}) {
  const owned = new Set(mySquad(sctx.view).map((e) => e.playerId).filter(Boolean));
  return Object.keys(sctx.view.players)
    .filter((pid) => !owned.has(pid))
    .map((pid) => playerOutlook(sctx, pid))
    .filter((o) => o && o.games > 0 && !o.out && (!position || o.position === position))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function fixtureRuns(sctx) {
  return [...sctx.upcoming.entries()]
    .map(([teamId, fixtures]) => ({
      teamId, name: sctx.view.teams[teamId]?.name ?? `#${teamId}`, fixtures, ease: mean(fixtures.map((f) => f.ease)),
    }))
    .sort((a, b) => b.ease - a.ease);
}

export const CLUB_LIMIT = 3; // most squad players from one club (site rule, user-confirmed)

// For the weakest sellable players, the best same-position replacement within budget
// (sale price + bank) that keeps every club at CLUB_LIMIT or fewer. Selling frees a slot.
export function swapPairs(sctx, { bank = 0, sellCount = 5 } = {}) {
  const { view } = sctx;
  const squad = mySquad(view);
  const owned = new Set(squad.map((e) => e.playerId).filter(Boolean));
  const perClub = new Map();
  for (const e of squad) {
    const t = e.playerId != null ? view.players[e.playerId]?.teamId : null;
    if (t != null) perClub.set(Number(t), (perClub.get(Number(t)) || 0) + 1);
  }
  const pool = Object.keys(view.players).filter((pid) => !owned.has(pid))
    .map((pid) => playerOutlook(sctx, pid))
    .filter((o) => o && o.games > 0 && !o.out && o.price != null);
  const rows = [];
  for (const { outlook: sell } of sellCandidates(sctx).filter((r) => r.outlook && r.outlook.price != null).slice(0, sellCount)) {
    const budget = sell.price + bank;
    let best = null;
    for (const o of pool) {
      if (o.position !== sell.position || o.price > budget + 1e-9) continue;
      const after = (perClub.get(o.teamId) || 0) - (o.teamId === sell.teamId ? 1 : 0) + 1;
      if (after > CLUB_LIMIT) continue;
      if (!best || o.score > best.score) best = o;
    }
    if (best && best.score > sell.score) {
      rows.push({ sell, buy: best, gain: best.score - sell.score, bankAfter: budget - best.price });
    }
  }
  return rows.sort((a, b) => b.gain - a.gain);
}
