import { useMemo, useState } from "react";
import { leagueTable, teamSitePoints } from "../lib/store.js";
import { teamWeeklySeries, TEAM_STATS } from "../lib/series.js";
import { teamColor } from "../lib/teamColors.js";
import GameweekChart from "./GameweekChart.jsx";
import { TeamPill } from "./Pills.jsx";

const COLS = [
  ["played", "P", "played"], ["won", "W", "won"], ["drawn", "D", "drawn"], ["lost", "L", "lost"],
  ["gf", "GF", "goals for"], ["ga", "GA", "goals against"], ["gd", "GD", "goal difference"],
  ["points", "Pts", "league points"],
  ["fantasy", "FPts", "fantasy points scored by the team's players"],
  ["yellows", "🟨", "yellow cards (a second yellow counts too)"],
  ["reds", "🟥", "dismissals (straight red or second yellow)"],
  ["pensScored", "Pen", "penalties scored (missed shown in row tooltip)"],
  ["assists", "👟", "assists"],
];

export default function TableTab({ data }) {
  const [win, setWin] = useState("all");
  const [sort, setSort] = useState(null); // null = league order from leagueTable
  const [selected, setSelected] = useState(() => new Set()); // team ids for the graph
  const [stat, setStat] = useState("points");
  const [cumulative, setCumulative] = useState(true); // season progress by default
  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const rows = useMemo(() => {
    const t = leagueTable(data, win === "all" ? null : win).map((r) => ({ ...r, gd: r.gf - r.ga }));
    if (sort) t.sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
    return t;
  }, [data, win, sort]);

  const chartSeries = useMemo(() => [...selected].flatMap((tid) => {
    const team = data.teams[tid];
    if (!team) return [];
    return [{
      key: String(tid), label: team.shortName || team.name,
      color: teamColor(team).bg,
      points: teamWeeklySeries(data, tid, stat),
    }];
  }), [data, selected, stat]);

  const siteTotals = useMemo(() => teamSitePoints(data), [data]);
  // cross-check is season-vs-site even when the table is windowed
  const seasonFantasy = useMemo(() => {
    const m = new Map();
    for (const r of leagueTable(data, null)) m.set(r.teamId, r.fantasy);
    return m;
  }, [data]);

  return (
    <div>
      <GameweekChart series={chartSeries} cumulative={cumulative}
        onToggleCumulative={() => setCumulative((c) => !c)}
        onClear={() => setSelected(new Set())}>
        {TEAM_STATS.map(([key, label]) => (
          <button key={key} className={stat === key ? "primary" : ""} onClick={() => setStat(key)}>{label}</button>
        ))}
      </GameweekChart>
      <div className="row" style={{ margin: "8px 0" }}>
        {["all", 3, 5].map((w) => (
          <button key={w} className={win === w ? "primary" : ""} onClick={() => setWin(w)}>
            {w === "all" ? "All" : `Last ${w}`}
          </button>
        ))}
        {sort && <button onClick={() => setSort(null)}>↺ league order</button>}
      </div>
      {rows.length === 0 ? <p className="dim">No imported matches yet.</p> : (
        <div className="scroll-x">
          <table className="sticky-col">
            <thead><tr>
              <th onClick={() => setSort(null)} title="click to restore league order · row or 📈 adds to the graph">#&nbsp;&nbsp;Team</th>
              {COLS.map(([key, label, tip]) => (
                <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s?.key === key ? -s.dir : -1 }))}>
                  {label}{sort?.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.teamId} onClick={() => toggleSelected(r.teamId)}
                  className={selected.has(r.teamId) ? "selected" : ""} style={{ cursor: "pointer" }}>
                  <td>
                    <button className={`mini-toggle ${selected.has(r.teamId) ? "" : "off"}`} aria-pressed={selected.has(r.teamId)}
                      title="add to graph" onClick={(e) => { e.stopPropagation(); toggleSelected(r.teamId); }}>📈</button>
                    {" "}{i + 1} <TeamPill team={data.teams[r.teamId]} />
                  </td>
                  {COLS.map(([key]) => {
                    if (key === "fantasy") {
                      const st = siteTotals.get(r.teamId);
                      const ours = seasonFantasy.get(r.teamId) ?? 0;
                      const delta = st?.withData ? ours - st.site : null;
                      return (
                        <td key={key} className={delta ? `pts-diff ${delta < 0 ? "site-up" : "site-down"}` : ""}
                          title={delta ? `${delta > 0 ? "+" : ""}${delta} vs official site (ours ${ours} · site ${st.site}${st.missing ? ` · ${st.missing} players missing site data` : ""})` : ""}>
                          {r[key]}
                        </td>
                      );
                    }
                    return (
                      <td key={key} title={key === "pensScored" && r.pensMissed ? `${r.pensMissed} missed` : ""}>
                        {r[key]}
                      </td>
                    );
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
