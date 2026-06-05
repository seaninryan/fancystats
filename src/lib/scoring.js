// src/lib/scoring.js
// Fantasy LOI scoring rules — values from fantasyloi.leagueofireland.ie/Rules/Rules
// (re-verified during Task 13 against a real gameweek).
export const RULES = {
  appearance: { sub: 1, startedSubbedOff: 2, fullMatch: 3 },
  teamResult: { win: 2, draw: 1 }, // requires an appearance
  goal: { GK: 10, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  cleanSheet: { positions: ["GK", "DEF"], fullMatch: 4, startedPartial: 2, sub: 1 },
  ownGoal: -2,
  penMiss: -3,
  penSave: 5, // GK only
  yellow: -1,
  secondYellow: -2, // in addition to the yellow
  straightRed: -4,
};

const STAT_FIELDS = ["goals", "assists", "ownGoals", "yellow", "penMissed", "penSaved", "minutes"];

function applyAdjustment(app, adj) {
  const out = { ...app };
  for (const f of STAT_FIELDS) if (typeof adj[f] === "number") out[f] = (out[f] || 0) + adj[f];
  if (typeof adj.secondYellow === "boolean") out.secondYellow = adj.secondYellow;
  if (typeof adj.red === "boolean") out.red = adj.red;
  return out;
}

// Opposition goals scored while this player was on the pitch.
// Boundary: a goal at exactly subOnMin/subOffMin counts as conceded while on.
export function concededWhileOn(app, match) {
  const oppGoals = app.teamId === match.homeTeamId ? match.goalTimes.away : match.goalTimes.home;
  const from = app.started ? 0 : app.subOnMin ?? Infinity;
  const to = app.subOffMin ?? Infinity;
  return oppGoals.filter((m) => m >= from && m <= to).length;
}

// app: appearance record; match: needs homeTeamId/awayTeamId/homeScore/awayScore/goalTimes
// position: "GK"|"DEF"|"MID"|"FWD" (caller chooses gamePosition or realPosition)
// adjustment: optional delta object from data.adjustments
export function scoreAppearance(app0, match, position, adjustment = null) {
  const app = adjustment ? applyAdjustment(app0, adjustment) : app0;
  const br = [];

  const tier = !app.started ? "sub" : app.subOffMin != null ? "startedSubbedOff" : "fullMatch";
  br.push([tier, RULES.appearance[tier]]);

  const ours = app.teamId === match.homeTeamId ? match.homeScore : match.awayScore;
  const theirs = app.teamId === match.homeTeamId ? match.awayScore : match.homeScore;
  if (ours > theirs) br.push(["win", RULES.teamResult.win]);
  else if (ours === theirs) br.push(["draw", RULES.teamResult.draw]);

  if (app.goals) br.push(["goals", app.goals * RULES.goal[position]]);
  if (app.assists) br.push(["assists", app.assists * RULES.assist]);

  if (RULES.cleanSheet.positions.includes(position) && concededWhileOn(app, match) === 0) {
    const key = tier === "fullMatch" ? "fullMatch" : tier === "startedSubbedOff" ? "startedPartial" : "sub";
    br.push(["cleanSheet", RULES.cleanSheet[key]]);
  }

  if (app.ownGoals) br.push(["ownGoal", app.ownGoals * RULES.ownGoal]);
  if (app.penMissed) br.push(["penMiss", app.penMissed * RULES.penMiss]);
  if (app.penSaved && position === "GK") br.push(["penSave", app.penSaved * RULES.penSave]);

  if (app.yellow) br.push(["yellow", app.yellow * RULES.yellow]);
  if (app.secondYellow) br.push(["secondYellow", RULES.secondYellow]);
  if (app.red) br.push(["straightRed", RULES.straightRed]);

  return {
    total: br.reduce((s, [, p]) => s + p, 0),
    breakdown: br,
    adjusted: !!adjustment,
  };
}
