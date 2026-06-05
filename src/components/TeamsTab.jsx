import { useState } from "react";
import { matchRound, setPlayerField } from "../lib/store.js";

// Colour = how they appeared; emoji = what they did.
function cellFor(app0, adj) {
  if (!app0) return { sym: "—", cls: "cell-out", title: "did not play" };
  // Merge user adjustments so the grid agrees with PlayerDetail (e.g. pen saves
  // only exist as adjustments — without this 🧤 could never appear).
  let app = app0;
  if (adj) {
    app = { ...app0 };
    for (const f of ["goals", "assists", "penMissed", "penSaved"]) {
      if (typeof adj[f] === "number") app[f] = Math.max(0, (app[f] || 0) + adj[f]);
    }
    if (typeof adj.secondYellow === "boolean") app.secondYellow = adj.secondYellow;
    if (typeof adj.red === "boolean") app.red = adj.red;
  }
  const goals = app.goals || 0;
  const pens = Math.min(app.penScored || 0, goals);
  const deco =
    "⚽".repeat(goals - pens) + "⚽🥅".repeat(pens) +
    "👟".repeat(app.assists || 0) +
    (app.secondYellow ? "🟨🟨" : app.yellow ? "🟨" : "") +
    (app.red ? "🟥" : "") +
    "❌".repeat(app.penMissed || 0) +
    "🧤".repeat(app.penSaved || 0);
  const words = [
    goals && `${goals} goal${goals > 1 ? "s" : ""}${pens ? ` (${pens} pen)` : ""}`,
    app.assists && `${app.assists} assist${app.assists > 1 ? "s" : ""}`,
    app.secondYellow ? "second yellow" : app.yellow ? "yellow card" : null,
    app.red && "straight red",
    app.penMissed && "missed penalty",
    app.penSaved && "penalty saved",
  ].filter(Boolean).join(", ");
  if (!app.started) return { sym: `○${app.subOnMin ?? ""}'${deco}`, cls: "cell-on", title: `sub on ${app.subOnMin}'${words ? " — " + words : ""}` };
  if (app.subOffMin != null) return { sym: `◐${app.subOffMin}'${deco}`, cls: "cell-off", title: `subbed off ${app.subOffMin}'${words ? " — " + words : ""}` };
  return { sym: `●${deco}`, cls: "cell-start", title: `full match${words ? " — " + words : ""}` };
}

export default function TeamsTab({ data, update }) {
  const teamIds = Object.keys(data.teams);
  const [teamId, setTeamId] = useState(teamIds[0] || null);
  // Recover if teams arrived after mount (or the stored selection vanished).
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;

  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected))
    .sort((a, b) => a.kickoff - b.kickoff);

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === selected);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  const counts = new Map();
  for (const a of apps) counts.set(a.playerId, (counts.get(a.playerId) || 0) + 1);
  const playerIds = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  const toggle = (pid, field, value) => update((d) => setPlayerField(d, pid, field, value));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={selected || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        <span className="dim">● start · ◐ off · ○ on · ⚽ goal · 🥅 pen · 👟 assist</span>
      </div>
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr>
              <th>Player</th>
              {matches.map((m) => {
                const home = String(m.homeTeamId) === selected;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                return <th key={m.eventId} title={`${home ? "v" : "@"} ${opp}`}>R{matchRound(m)}</th>;
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => {
                const p = data.players[pid];
                return (
                  <tr key={pid}>
                    <td>
                      <button className={`mini-toggle ${p?.starred ? "" : "off"}`} title="watchlist" aria-pressed={!!p?.starred}
                        onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
                      <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} title="in my squad" aria-pressed={!!p?.inSquad}
                        onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
                      {" "}{p?.name || pid}
                    </td>
                    {matches.map((m) => {
                      const key = `${m.eventId}:${pid}`;
                      const { sym, cls, title } = cellFor(byPlayerMatch.get(key), data.adjustments[key]);
                      return <td key={m.eventId} className={cls} title={title}>{sym}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
