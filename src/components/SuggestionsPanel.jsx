// src/components/SuggestionsPanel.jsx — sell / buy / fixture suggestions under My Team.
import { useMemo, useState } from "react";
import { suggestionContext, sellCandidates, buyTargets, fixtureRuns, mySquad } from "../lib/suggestions.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const signed = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const one = (n) => n.toFixed(1);

function Next({ fixtures, teams }) {
  if (!fixtures.length) return <span className="dim">—</span>;
  return fixtures.map((f) => (
    <span key={f.eventId} title={`ease ${signed(f.ease)}`} style={{ marginRight: 6, whiteSpace: "nowrap" }}>
      {teams[f.opponentId]?.shortName ?? `#${f.opponentId}`}({f.home ? "h" : "a"}){f.tag ?? ""}
    </span>
  ));
}

const why = (o) => `form ${one(o.form)}/game (${o.points} pts in ${o.games}) · fixtures ${signed(o.ease)} → outlook ${one(o.score)}`;

export default function SuggestionsPanel({ data, openPlayer }) {
  const [pos, setPos] = useState(null);
  const sctx = useMemo(() => suggestionContext(data, Date.now()), [data]);
  if (!mySquad(data).length) return null;
  const sell = sellCandidates(sctx);
  const buy = buyTargets(sctx, { position: pos });
  const runs = fixtureRuns(sctx);
  const name = (playerId, label) => (
    <span className="cell-click" onClick={() => openPlayer(playerId)}>{label}</span>
  );
  return (
    <div>
      <h3>Suggestions</h3>
      {!sctx.anyUpcoming && <p className="dim">No upcoming fixtures — outlook is form only.</p>}
      <div className="card scroll-x">
        <strong>Weakest in your squad</strong>
        <table>
          <thead><tr><th>Player</th><th>Pos</th><th>Price</th><th title={`points per team match, last 5`}>Form</th><th>Next</th><th>Outlook</th></tr></thead>
          <tbody>
            {sell.map(({ entry, outlook: o }, i) => (
              <tr key={entry.siteId} className={i < 3 && o ? "weak" : undefined}>
                <td>{entry.playerId ? name(entry.playerId, entry.name) : entry.name}{o?.out ? " ⛔" : ""}</td>
                <td>{o?.position ?? ""}</td><td>{o?.price ?? ""}</td>
                <td>{o ? one(o.form) : "—"}</td>
                <td>{o ? <Next fixtures={o.fixtures} teams={data.teams} /> : ""}</td>
                <td title={o ? why(o) : "not linked to a player with a position"}>{o ? one(o.score) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll-x">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <strong>Buy targets</strong>
          {[null, ...POSITIONS].map((p) => (
            <button key={p ?? "all"} className={pos === p ? "primary" : ""} onClick={() => setPos(p)}>{p ?? "All"}</button>
          ))}
        </div>
        <table>
          <thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Price</th><th>Form</th><th>Next</th><th>Outlook</th></tr></thead>
          <tbody>
            {buy.map((o) => (
              <tr key={o.playerId}>
                <td>{name(o.playerId, o.name)}{o.hot ? " 🔥" : ""}</td>
                <td>{data.teams[o.teamId]?.shortName ?? ""}</td><td>{o.position}</td><td>{o.price ?? ""}</td>
                <td>{one(o.form)}</td><td><Next fixtures={o.fixtures} teams={data.teams} /></td>
                <td title={why(o)}>{one(o.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sctx.anyUpcoming && (
        <div className="card scroll-x">
          <strong>Best fixture runs</strong>
          <table>
            <thead><tr><th>Club</th><th>Next</th><th title="mean ease, −1 hard … +1 easy">Ease</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.teamId}><td>{r.name}</td><td><Next fixtures={r.fixtures} teams={data.teams} /></td><td>{signed(r.ease)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
