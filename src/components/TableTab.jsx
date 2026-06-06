import { useMemo, useState } from "react";
import { leagueTable } from "../lib/store.js";
import { teamWeeklySeries, TEAM_STATS } from "../lib/series.js";
import { teamColor } from "../lib/teamColors.js";
import GameweekChart from "./GameweekChart.jsx";
import { TeamPill } from "./Pills.jsx";

const COLS = [
  ["played", "P"], ["won", "W"], ["drawn", "D"], ["lost", "L"],
  ["gf", "GF"], ["ga", "GA"], ["gd", "GD"], ["points", "Pts"],
  ["fantasy", "FPts"], ["yellows", "🟨"], ["reds", "🟥"], ["pensScored", "Pen"], ["assists", "👟"],
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
              <th onClick={() => setSort(null)}>#&nbsp;&nbsp;Team</th>
              {COLS.map(([key, label]) => (
                <th key={key} onClick={() => setSort((s) => ({ key, dir: s?.key === key ? -s.dir : -1 }))}
                  title={key === "pensScored" ? "penalties scored (missed shown in row tooltip)" : ""}>
                  {label}{sort?.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.teamId} onClick={() => toggleSelected(r.teamId)}
                  className={selected.has(r.teamId) ? "selected" : ""} style={{ cursor: "pointer" }}>
                  <td>{i + 1} <TeamPill team={data.teams[r.teamId]} /></td>
                  {COLS.map(([key]) => (
                    <td key={key} title={key === "pensScored" && r.pensMissed ? `${r.pensMissed} missed` : ""}>
                      {r[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
