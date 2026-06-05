import { useState } from "react";
import { setPlayerField, setAdjustment, playerAppearances, deriveRealPosition } from "../lib/store.js";
import { scoreAppearance } from "../lib/scoring.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

function AdjustForm({ adj, onSave, onCancel }) {
  const [goals, setGoals] = useState(adj?.goals ?? 0);
  const [assists, setAssists] = useState(adj?.assists ?? 0);
  const [note, setNote] = useState(adj?.note ?? "");
  return (
    <div className="card">
      <div className="row">
        <label>Δ goals <input type="number" value={goals} style={{ width: 60 }} onChange={(e) => setGoals(Number(e.target.value))} /></label>
        <label>Δ assists <input type="number" value={assists} style={{ width: 60 }} onChange={(e) => setAssists(Number(e.target.value))} /></label>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input placeholder="note (e.g. won pen)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => {
          const g = Number.isFinite(goals) ? goals : 0;
          const a = Number.isFinite(assists) ? assists : 0;
          onSave(g || a ? { goals: g, assists: a, note } : null);
        }}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function PlayerDetail({ data, update, playerId, onBack }) {
  const [adjustKey, setAdjustKey] = useState(null);
  const p = data.players[playerId];
  if (!p) return <div className="card dim">Player not found. <button onClick={onBack}>←</button></div>;
  const apps = playerAppearances(data, playerId);
  const derived = deriveRealPosition(apps);
  const team = (id) => data.teams[id]?.shortName || id;

  const setField = (field, value) => update((d) => setPlayerField(d, playerId, field, value));

  return (
    <div>
      <div className="row"><button onClick={onBack}>←</button><h3 style={{ margin: 0 }}>{p.name} · {data.teams[p.teamId]?.name}</h3></div>
      <div className="card row">
        <button className={p.starred ? "primary" : ""} onClick={() => setField("starred", !p.starred)}>⭐ watch</button>
        <button className={p.inSquad ? "primary" : ""} onClick={() => setField("inSquad", !p.inSquad)}>🔵 in squad</button>
        <span className="dim">€{p.price ?? "?"}</span>
      </div>
      <div className="card">
        <div className="row">
          <label>Game pos:
            <select value={p.gamePosition || ""} onChange={(e) => setField("gamePosition", e.target.value || null)}>
              <option value="">—</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>Real pos:
            <select value={p.realPosition || ""} onChange={(e) => setField("realPosition", e.target.value || null)}>
              <option value="">auto{derived ? `: ${derived.position} (${derived.count}/${derived.total})` : ""}</option>
              {POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Match</th><th>Min</th><th>G</th><th>A</th><th>Pos</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            {[...apps].reverse().map((a) => {
              const m = data.matches[a.eventId];
              const key = `${a.eventId}:${a.playerId}`;
              const adj = data.adjustments[key];
              const score = p.gamePosition && m?.goalTimes ? scoreAppearance(a, m, p.gamePosition, adj) : null;
              const opp = a.teamId === m?.homeTeamId ? `v ${team(m?.awayTeamId)}` : `@ ${team(m?.homeTeamId)}`;
              return (
                <tr key={key}>
                  <td>R{m?.round} {opp}</td>
                  <td>{a.minutes + (adj?.minutes || 0)}</td>
                  <td>{a.goals + (adj?.goals || 0)}{adj?.goals ? "✏" : ""}</td>
                  <td>{a.assists + (adj?.assists || 0)}{adj?.assists ? "✏" : ""}</td>
                  <td>{a.positionPlayed}</td>
                  <td title={score ? score.breakdown.map(([r, v]) => `${r} ${v > 0 ? "+" : ""}${v}`).join(", ") : ""}>
                    {score ? score.total : "—"}
                  </td>
                  <td><button onClick={() => setAdjustKey(key)}>✏</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adjustKey && (
        <AdjustForm
          adj={data.adjustments[adjustKey]}
          onSave={(adj) => { update((d) => setAdjustment(d, adjustKey, adj)); setAdjustKey(null); }}
          onCancel={() => setAdjustKey(null)}
        />
      )}
      {apps.length === 0 && <p className="dim">No appearances imported yet.</p>}
    </div>
  );
}
