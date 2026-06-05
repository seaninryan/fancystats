import { useState } from "react";

// ● started full · ◐ subbed off · ○ came on as sub · — no appearance
function cellFor(app) {
  if (!app) return { sym: "—", title: "did not play" };
  if (!app.started) return { sym: `○${app.subOnMin ?? ""}'`, title: `sub on ${app.subOnMin}'` };
  if (app.subOffMin != null) return { sym: `◐${app.subOffMin}'`, title: `subbed off ${app.subOffMin}'` };
  return { sym: "●", title: "full match" };
}

export default function TeamsTab({ data }) {
  const teamIds = Object.keys(data.teams);
  const [teamId, setTeamId] = useState(teamIds[0] || null);
  // Recover if teams arrived after mount (or the stored selection vanished).
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;

  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected))
    .sort((a, b) => a.kickoff - b.kickoff);

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === selected);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  // Order rows by appearance count (regulars first).
  const counts = new Map();
  for (const a of apps) counts.set(a.playerId, (counts.get(a.playerId) || 0) + 1);
  const playerIds = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={selected || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        <span className="dim">● start · ◐ off · ○ on · — out</span>
      </div>
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr>
              <th>Player</th>
              {matches.map((m) => {
                const home = String(m.homeTeamId) === selected;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                return <th key={m.eventId} title={`${home ? "v" : "@"} ${opp}`}>R{m.round}</th>;
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => (
                <tr key={pid}>
                  <td>{data.players[pid]?.name || pid}</td>
                  {matches.map((m) => {
                    const { sym, title } = cellFor(byPlayerMatch.get(`${m.eventId}:${pid}`));
                    return <td key={m.eventId} title={title}>{sym}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
