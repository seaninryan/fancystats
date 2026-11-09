// src/components/LeaguesTab.jsx — private fantasy mini-leagues (from Fantasy sync).
import { useState } from "react";
import { privateLeagues, leagueStandings, leagueRace, opponentTeam, squadComparison } from "../lib/leagues.js";
import GameweekChart from "./GameweekChart.jsx";
import TeamLines from "./TeamLines.jsx";

const COLORS = ["#0e7a3c", "#c8102e", "#1f5fbf", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#57534e", "#b45309"];
const moveText = (m) => (m > 0 ? `▲${m}` : m < 0 ? `▼${-m}` : "–");

export default function LeaguesTab({ data, openPlayer }) {
  const leagues = privateLeagues(data);
  const [picked, setPicked] = useState(null);
  const [rival, setRival] = useState(null);
  const [cumulative, setCumulative] = useState(true);
  if (!leagues.length) {
    return (data.site?.yourLeagues || []).length
      ? <p className="dim">No private leagues in your last Fantasy sync — join or create one on the fantasy site, then sync again.</p>
      : <p className="dim">No league data yet — run the Fantasy sync on the ⚙ Settings tab.</p>;
  }
  const code = leagues.some((l) => l.code === picked) ? picked : leagues[0].code;
  const rows = leagueStandings(data, code);
  const gw = rows[0]?.gw;
  const series = leagueRace(data, code).map((s, i) => ({
    key: String(s.teamId), label: s.manager, color: COLORS[i % COLORS.length], points: s.points,
  }));
  const opp = rival != null ? opponentTeam(data, rival) : null;
  const cmp = rival != null ? squadComparison(data, rival) : null;
  return (
    <div>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {leagues.map((l) => (
          <button key={l.code} className={l.code === code ? "primary" : ""} onClick={() => { setPicked(l.code); setRival(null); }}>
            {l.name} <span className="dim">({l.myRank ?? "?"}/{l.size})</span>
          </button>
        ))}
      </div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>#</th><th title="places moved since the previous gameweek">±</th><th>Manager</th>
            <th>{gw != null ? `GW ${gw}` : "GW"}</th><th>Total</th><th title="points behind (−) or ahead of you">Gap</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className={r.isMe ? "row-me" : "cell-click"} style={r.isMe ? { fontWeight: 600 } : undefined}
                onClick={() => !r.isMe && setRival(r.teamId === rival ? null : r.teamId)}>
                <td>{r.rank}</td><td className="dim">{moveText(r.move)}</td><td>{r.manager}{r.isMe ? " (you)" : ""}</td>
                <td>{r.gwPoints ?? "—"}</td><td>{r.total}</td><td>{r.gap == null || r.isMe ? "" : r.gap > 0 ? `+${r.gap}` : r.gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim" style={{ margin: "6px 0 0" }}>Click a manager to compare their team with yours.</p>
      </div>
      {rival != null && !opp && (
        <p className="dim">{rows.find((r) => r.teamId === rival)?.manager ?? "This manager"}&rsquo;s team wasn&rsquo;t captured — run the Fantasy sync again.</p>
      )}
      {opp && (
        <div>
          <h3>{opp.manager}{opp.details["Team Name"] ? ` — ${opp.details["Team Name"]}` : ""} <span className="dim">GW {opp.gw}: {opp.total ?? "—"} pts</span></h3>
          <p className="dim">
            {["Triple Captain Used", "Full Squad Counts Used", "Unlimited Transfers Used"]
              .filter((k) => opp.details[k] != null).map((k) => `${k.replace(" Used", "")}: ${opp.details[k]}`).join(" · ")}
          </p>
          <TeamLines team={opp} openPlayer={openPlayer}
            badge={cmp && ((e) => (cmp.shared.has(e.siteId) ? <span title="you have him too">🔵</span> : <span title="differential — you don't have him">◆</span>))} />
          {cmp && cmp.mineOnly.length > 0 && (
            <p><strong>You have, they don&rsquo;t:</strong> {cmp.mineOnly.map((e) => e.name).join(", ")}</p>
          )}
        </div>
      )}
      <GameweekChart series={series} cumulative={cumulative} onToggleCumulative={() => setCumulative(!cumulative)} />
    </div>
  );
}
