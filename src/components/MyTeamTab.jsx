// src/components/MyTeamTab.jsx — your fantasy team per gameweek (from Fantasy sync).
import { useState } from "react";
import { myTeamGameweeks, myTeamGameweek, myTeamSeries } from "../lib/myTeam.js";
import { ordinal, leaguePositions } from "../lib/leagues.js";
import TeamLines from "./TeamLines.jsx";
import GameweekChart from "./GameweekChart.jsx";
import SuggestionsPanel from "./SuggestionsPanel.jsx";

export default function MyTeamTab({ data, openPlayer, update, readOnly }) {
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
  const positions = leaguePositions(data);
  return (
    <div>
      {positions.length > 0 && (
        <p className="dim">{positions.map((p) => `${ordinal(p.position)} ${p.code === "Overall" ? "overall" : p.name}`).join(" · ")}</p>
      )}
      <div className="card row">
        <label>Gameweek{" "}
          <select value={gw} onChange={(e) => setPicked(Number(e.target.value))}>
            {gws.map((g) => <option key={g} value={g}>{`GW ${g}`}</option>)}
          </select>
        </label>
        <strong style={{ marginLeft: "auto" }}>{`${t.total ?? "—"} pts`}</strong>
      </div>
      <TeamLines team={t} openPlayer={openPlayer} />
      <GameweekChart series={series} cumulative={cumulative} onToggleCumulative={() => setCumulative(!cumulative)} />
      <SuggestionsPanel data={data} openPlayer={openPlayer} update={update} readOnly={readOnly} />
    </div>
  );
}
