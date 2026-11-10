// src/components/SuggestionsPanel.jsx — sell / buy / fixture suggestions under My Team.
import { useMemo, useState } from "react";
import { suggestionContext, sellCandidates, buyTargets, fixtureRuns, mySquad, swapPairs } from "../lib/suggestions.js";
import { setFantasyBank } from "../lib/store.js";

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

export default function SuggestionsPanel({ data, openPlayer, update = () => {}, readOnly = false }) {
  const [pos, setPos] = useState(null);
  const sctx = useMemo(() => suggestionContext(data, Date.now()), [data]);
  if (!mySquad(data).length) return null;
  const sell = sellCandidates(sctx);
  const buy = buyTargets(sctx, { position: pos });
  const runs = fixtureRuns(sctx);
  const bank = data.meta?.fantasyBank ?? 0;
  const swaps = swapPairs(sctx, { bank });
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
        <div className="row">
          <strong>Swaps</strong>
          <label style={{ marginLeft: "auto" }}>Bank €
            <input key={bank} type="number" step="0.1" style={{ width: "5em" }} defaultValue={bank} disabled={readOnly}
              onBlur={(e) => update((d) => setFantasyBank(d, parseFloat(e.target.value)))} />m
          </label>
        </div>
        {swaps.length === 0 ? <p className="dim">No improving swap within budget.</p> : (
          <table>
            <thead><tr><th>Sell</th><th></th><th>Buy</th><th>Gain</th><th title="bank after this swap">Bank</th></tr></thead>
            <tbody>
              {swaps.map(({ sell, buy, gain, bankAfter }) => (
                <tr key={sell.playerId}>
                  <td>{name(sell.playerId, sell.name)} <span className="dim">{sell.position} €{sell.price} · {one(sell.score)}</span></td>
                  <td>→</td>
                  <td>{name(buy.playerId, buy.name)}{buy.hot ? " 🔥" : ""} <span className="dim">{data.teams[buy.teamId]?.shortName ?? ""} €{buy.price} · {one(buy.score)}</span></td>
                  <td title={`${why(sell)}\n${why(buy)}`}>+{one(gain)}</td>
                  <td>€{bankAfter.toFixed(1)}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
