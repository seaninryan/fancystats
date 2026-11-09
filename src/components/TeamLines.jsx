// src/components/TeamLines.jsx — a fantasy team's XI rows + bench (My Team, Leagues).
import { PtsPill } from "./Pills.jsx";

function Entry({ e, openPlayer, badge }) {
  const name = e.playerId
    ? <span className="cell-click" style={{ textDecoration: "underline dotted" }} onClick={() => openPlayer(e.playerId)}>{e.name}</span>
    : <span title="not linked to a SofaScore player">{e.name}</span>;
  return (
    <span className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {badge ? badge(e) : null}{name}{e.captain ? <strong> (c)</strong> : null}<PtsPill pts={e.points} />
    </span>
  );
}

// team: { lines: [{label, players}], bench } from teamLines(); badge(entry) -> optional node
export default function TeamLines({ team, openPlayer, badge = null }) {
  return (
    <div className="card">
      {team.lines.map((l, i) => (
        <div key={i} className="row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
          <span className="dim" style={{ width: "3rem" }}>{l.label}</span>
          {l.players.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} badge={badge} />)}
        </div>
      ))}
      <div className="row" style={{ flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
        <span className="dim" style={{ width: "3rem" }}>Bench</span>
        {team.bench.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} badge={badge} />)}
      </div>
    </div>
  );
}
