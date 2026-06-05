import { useMemo, useState } from "react";
import { playerTotals, playerAppearances, positionMismatch } from "../lib/store.js";
import PlayerDetail from "./PlayerDetail.jsx";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const COLS = [
  ["name", "Player"], ["pos", "Pos"], ["price", "€"], ["points", "Pts"],
  ["goals", "G"], ["assists", "A"], ["minutes", "Min"], ["starts", "St"], ["subApps", "Sub"],
];

export default function PlayersTab({ data, update }) {
  const [filters, setFilters] = useState({ team: "all", pos: "all", starred: false, inSquad: false, q: "" });
  const [sort, setSort] = useState({ key: "points", dir: -1 });
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    return Object.entries(data.players).map(([id, p]) => {
      const totals = playerTotals(data, id);
      const apps = playerAppearances(data, id);
      return {
        id, name: p.name, teamId: p.teamId, pos: p.gamePosition || "—",
        price: p.price, starred: p.starred, inSquad: p.inSquad,
        mismatch: positionMismatch(p, apps), ...totals,
      };
    });
  }, [data]);

  const shown = rows
    .filter((r) =>
      (filters.team === "all" || String(r.teamId) === filters.team) &&
      (filters.pos === "all" || r.pos === filters.pos) &&
      (!filters.starred || r.starred) &&
      (!filters.inSquad || r.inSquad) &&
      (!filters.q || r.name.toLowerCase().includes(filters.q.toLowerCase())))
    .sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      // deliberate: null prices/points always sink to the bottom, regardless of sort direction
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });

  if (openId) {
    return <PlayerDetail data={data} update={update} playerId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })}>
          <option value="all">All teams</option>
          {Object.entries(data.teams).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select>
        <select value={filters.pos} onChange={(e) => setFilters({ ...filters, pos: e.target.value })}>
          <option value="all">All pos</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className={filters.starred ? "primary" : ""} onClick={() => setFilters({ ...filters, starred: !filters.starred })}>⭐</button>
        <button className={filters.inSquad ? "primary" : ""} onClick={() => setFilters({ ...filters, inSquad: !filters.inSquad })}>My squad</button>
        <input placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} style={{ flex: 1, minWidth: 100 }} />
      </div>
      <div className="scroll-x">
        <table>
          <thead><tr>
            {COLS.map(([key, label]) => (
              <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
                {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: "pointer" }}>
                <td>{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.name}</td>
                <td>{r.pos}{r.mismatch ? " ⚠" : ""}</td>
                <td>{r.price ?? "—"}</td>
                <td>{r.points ?? "—"}</td>
                <td>{r.goals}</td><td>{r.assists}</td><td>{r.minutes}</td><td>{r.starts}</td><td>{r.subApps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="dim">No players match — import some matches first.</p>}
    </div>
  );
}
