// src/lib/sofascore.js
// SofaScore payloads -> normalized records. Pure; fetch functions live alongside (Task 5).

export function normalize(eventPayload, lineupsPayload, incidentsPayload) {
  const e = eventPayload.event;
  const match = {
    eventId: e.id,
    round: e.roundInfo?.round ?? null,
    kickoff: (e.startTimestamp || 0) * 1000,
    status: e.status?.type || "unknown",
    homeTeamId: e.homeTeam.id,
    awayTeamId: e.awayTeam.id,
    homeScore: e.homeScore?.current ?? null,
    awayScore: e.awayScore?.current ?? null,
    goalTimes: { home: [], away: [] },
    partial: !lineupsPayload,
  };
  const team = (t) => ({ id: t.id, name: t.name, shortName: t.nameCode || t.shortName || t.name });
  const teams = [team(e.homeTeam), team(e.awayTeam)];

  const apps = new Map();
  const addSide = (side, teamId) => {
    for (const entry of side?.players || []) {
      apps.set(entry.player.id, {
        eventId: e.id, playerId: entry.player.id, teamId,
        name: entry.player.name,
        started: !entry.substitute,
        subOnMin: null, subOffMin: null,
        minutes: entry.statistics?.minutesPlayed ?? null,
        positionPlayed: entry.position || entry.player.position || null,
        goals: 0, assists: 0, ownGoals: 0,
        yellow: 0, secondYellow: false, red: false,
        penMissed: 0, penSaved: 0,
      });
    }
  };
  if (lineupsPayload) {
    addSide(lineupsPayload.home, e.homeTeam.id);
    addSide(lineupsPayload.away, e.awayTeam.id);
  }

  const stat = (id, fn) => { const a = id != null ? apps.get(id) : null; if (a) fn(a); };
  for (const inc of incidentsPayload?.incidents || []) {
    if (inc.incidentType === "goal") {
      (inc.isHome ? match.goalTimes.home : match.goalTimes.away).push(inc.time);
      if (inc.incidentClass === "ownGoal") {
        stat(inc.player?.id, (a) => a.ownGoals++);
      } else {
        stat(inc.player?.id, (a) => a.goals++);
        stat(inc.assist1?.id, (a) => a.assists++);
      }
    } else if (inc.incidentType === "substitution") {
      stat(inc.playerIn?.id, (a) => { a.subOnMin = inc.time; });
      stat(inc.playerOut?.id, (a) => { a.subOffMin = inc.time; });
    } else if (inc.incidentType === "card") {
      if (inc.incidentClass === "yellow") stat(inc.player?.id, (a) => a.yellow++);
      else if (inc.incidentClass === "yellowRed") stat(inc.player?.id, (a) => { a.secondYellow = true; });
      else if (inc.incidentClass === "red") stat(inc.player?.id, (a) => { a.red = true; });
    } else if (inc.incidentType === "inGamePenalty" && inc.incidentClass === "missed") {
      // penSaved is NOT derived here: SofaScore doesn't reliably attribute the save.
      // Record keeper pen-saves via the adjustments overlay.
      stat(inc.player?.id, (a) => a.penMissed++);
    }
  }
  match.goalTimes.home.sort((a, b) => a - b);
  match.goalTimes.away.sort((a, b) => a - b);

  const appearances = [];
  const players = [];
  for (const a of apps.values()) {
    if (a.minutes == null) {
      a.minutes = a.started ? a.subOffMin ?? 90 : a.subOnMin != null ? 90 - a.subOnMin : 0;
    }
    if (!a.started && a.subOnMin == null && a.minutes <= 0) continue; // unused bench
    const { name, ...record } = a;
    appearances.push(record);
    players.push({ id: a.playerId, name, teamId: a.teamId });
  }
  return { match, teams, players, appearances };
}
