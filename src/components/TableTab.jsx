import { useMemo, useState } from "react";
import { leagueTable } from "../lib/store.js";
import { TeamPill } from "./Pills.jsx";

const COLS = [
  ["played", "P"], ["won", "W"], ["drawn", "D"], ["lost", "L"],
  ["gf", "GF"], ["ga", "GA"], ["gd", "GD"], ["points", "Pts"],
  ["fantasy", "FPts"], ["yellows", "🟨"], ["reds", "🟥"], ["pensScored", "Pen"], ["assists", "👟"],
];

export default function TableTab({ data }) {
  const [win, setWin] = useState("all");
  const [sort, setSort] = useState(null); // null = league order from leagueTable

  const rows = useMemo(() => {
    const t = leagueTable(data, win === "all" ? null : win).map((r) => ({ ...r, gd: r.gf - r.ga }));
    if (sort) t.sort((a, b) => (a[sort.key] - b[sort.key]) * sort.dir);
    return t;
  }, [data, win, sort]);

  return (
    <div>
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
                <tr key={r.teamId}>
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
