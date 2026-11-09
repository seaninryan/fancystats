// src/components/MyTeamTab.jsx — your fantasy team per gameweek (from Fantasy sync).
import { useState } from "react";
import { myTeamGameweeks, myTeamGameweek, myTeamSeries } from "../lib/myTeam.js";
import { PtsPill } from "./Pills.jsx";
import GameweekChart from "./GameweekChart.jsx";

function Entry({ e, openPlayer }) {
  const name = e.playerId
    ? <span className="cell-click" style={{ textDecoration: "underline dotted" }} onClick={() => openPlayer(e.playerId)}>{e.name}</span>
    : <span title="not linked to a SofaScore player">{e.name}</span>;
  return (
    <span className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {name}{e.captain ? <strong> (c)</strong> : null}<PtsPill pts={e.points} />
    </span>
  );
}

export default function MyTeamTab({ data, openPlayer }) {
  const gws = myTeamGameweeks(data);
  const [picked, setPicked] = useState(null);
  const [cumulative, setCumulative] = useState(false);
  if (!gws.length) {
    return <p className="dim">No team captured yet — run the Fantasy sync on the ⚙ Settings tab.</p>;
  }
  const gw = picked != null && gws.includes(picked) ? picked : gws[gws.length - 1];
  const t = myTeamGameweek(data, gw);
  const series = [{
    key: "me", label: "My team", color: "#0e7a3c",
    points: myTeamSeries(data).map((x) => ({ round: x.gw, value: x.total })),
  }];
  return (
    <div>
      <div className="card row">
        <label>Gameweek{" "}
          <select value={gw} onChange={(e) => setPicked(Number(e.target.value))}>
            {gws.map((g) => <option key={g} value={g}>{`GW ${g}`}</option>)}
          </select>
        </label>
        <strong style={{ marginLeft: "auto" }}>{`${t.total ?? "—"} pts`}</strong>
      </div>
      <div className="card">
        {t.lines.map((l, i) => (
          <div key={i} className="row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <span className="dim" style={{ width: "3rem" }}>{l.label}</span>
            {l.players.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} />)}
          </div>
        ))}
        <div className="row" style={{ flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span className="dim" style={{ width: "3rem" }}>Bench</span>
          {t.bench.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} />)}
        </div>
      </div>
      <GameweekChart series={series} cumulative={cumulative} onToggleCumulative={() => setCumulative(!cumulative)} />
    </div>
  );
}
