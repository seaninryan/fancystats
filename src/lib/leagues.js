// src/lib/leagues.js
// Private fantasy mini-leagues, from the season's site data (view.site, stored raw by
// applySiteSync from the Fantasy sync). Season views only. Standings rows from the site are
// [rank, teamId, manager, points], per period ("Overall" or a gameweek number).
import { teamLines, myTeamGameweeks } from "./myTeam.js";

const siteOf = (view) => view.site || {};

export function ordinal(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
  return `${n}${suffix}`;
}

export function leaguePositions(view) {
  return (siteOf(view).yourLeagues || []).filter((l) => l.position != null)
    .map((l) => ({ code: l.code, name: l.name, position: l.position, private: !!l.private }));
}

export function privateLeagues(view) {
  const leagues = siteOf(view).leagues || {};
  return (siteOf(view).yourLeagues || []).filter((l) => l.private && leagues[l.code])
    .map((l) => ({ code: l.code, name: leagues[l.code].name || l.name, myRank: l.position,
      size: (leagues[l.code].periods?.Overall || []).length }));
}

const gameweeksOf = (lg) => Object.keys(lg?.periods || {}).filter((p) => p !== "Overall")
  .map(Number).filter(Number.isFinite).sort((a, b) => a - b);

// Rows by rank: { rank, move, teamId, manager, gwPoints, total, gap, isMe, gw }.
// move = previous rank - rank, previous rank = competition rank by total before the latest gameweek.
export function leagueStandings(view, code) {
  const lg = siteOf(view).leagues?.[code];
  const overall = lg?.periods?.Overall;
  if (!overall?.length) return [];
  const played = gameweeksOf(lg).filter((g) => (lg.periods[g] || []).length);
  const gw = played.length ? played[played.length - 1] : null;
  const gwPts = new Map((gw != null ? lg.periods[gw] : []).map(([, id, , pts]) => [id, pts]));
  const me = Number(siteOf(view).siteTeamId);
  const rows = overall.map(([rank, teamId, manager, total]) => ({
    rank, teamId, manager, total, gwPoints: gwPts.get(teamId) ?? null, isMe: teamId === me,
  }));
  const before = (r) => r.total - (r.gwPoints ?? 0);
  const myTotal = rows.find((r) => r.isMe)?.total ?? null;
  return rows
    .map((r) => ({
      ...r,
      gw,
      move: gw == null ? 0 : 1 + rows.filter((o) => before(o) > before(r)).length - r.rank,
      gap: myTotal == null ? null : r.total - myTotal,
    }))
    .sort((a, b) => a.rank - b.rank);
}

// One series per manager in the Overall table: per-gameweek points (null when absent).
export function leagueRace(view, code) {
  const lg = siteOf(view).leagues?.[code];
  if (!lg?.periods?.Overall) return [];
  const gws = gameweeksOf(lg);
  const byGw = gws.map((g) => new Map((lg.periods[g] || []).map(([, id, , pts]) => [id, pts])));
  return lg.periods.Overall.map(([, teamId, manager]) => ({
    teamId, manager, points: gws.map((g, i) => ({ round: g, value: byGw[i].get(teamId) ?? null })),
  }));
}

export function opponentTeam(view, teamId) {
  const o = siteOf(view).opponents?.[teamId];
  if (!o?.team) return null;
  return { manager: o.manager, gw: o.gw, details: o.details || {}, ...teamLines(view, o.team) };
}

const squadIds = (t) => new Set([...(t.lines || []).flat(), ...(t.bench || [])].map(Number));

// Their latest team vs my latest captured gameweek (lines + bench).
export function squadComparison(view, teamId) {
  const theirs = siteOf(view).opponents?.[teamId]?.team;
  const gws = myTeamGameweeks(view);
  const mine = gws.length ? siteOf(view).myTeam[gws[gws.length - 1]] : null;
  if (!theirs || !mine) return null;
  const a = squadIds(mine), b = squadIds(theirs);
  const mineLines = teamLines(view, mine);
  return {
    shared: new Set([...b].filter((x) => a.has(x))),
    theirsOnly: new Set([...b].filter((x) => !a.has(x))),
    mineOnly: [...mineLines.lines.flatMap((l) => l.players), ...mineLines.bench].filter((e) => !b.has(e.siteId)),
    myCaptain: mine.captain ?? null,
    theirCaptain: theirs.captain ?? null,
  };
}
