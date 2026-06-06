import { useMemo, useState } from "react";
import { playerTotals, appearancesByPlayer, mismatchInfo, playerOutNow, playerName, missingFantasyData, isHot, teamWindowEventIds, playerClimb } from "../lib/store.js";
import { teamColor } from "../lib/teamColors.js";
import { PosPill } from "./Pills.jsx";
import { playerWeeklySeries, PLAYER_STATS } from "../lib/series.js";
import GameweekChart from "./GameweekChart.jsx";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const COLS = [
  ["name", "Player", "click name for details · row or 📈 adds to the graph"],
  ["teamName", "Team", "club"],
  ["pos", "Pos", "fantasy game position (▲▼ = differs from where they really play)"],
  ["price", "€", "price on the fantasy site"],
  ["points", "Pts", "fantasy points in the selected window"],
  ["goals", "G", "goals"], ["assists", "A", "assists"], ["minutes", "Min", "minutes played"],
  ["starts", "St", "matches started"], ["subApps", "Sub", "appearances as a substitute"],
];

function MismatchMark({ mi }) {
  if (!mi) return null;
  const up = mi.delta >= 0;
  return (
    <span className={up ? "gain" : "loss"}
      title={`really plays ${mi.realPosition}: game position pays ${up ? "+" : ""}${mi.delta} pts vs real`}>
      {up ? "▲" : "▼"}
    </span>
  );
}

export default function PlayersTab({ data, update, openPlayer }) {
  const [filters, setFilters] = useState({ team: "all", pos: "all", starred: false, inSquad: false, mismatch: false, hot: false, q: "" });
  const [win, setWin] = useState("all"); // "all" | 3 | 5
  const [sort, setSort] = useState({ key: "points", dir: -1 });
  const [selected, setSelected] = useState(() => new Set()); // player ids for the graph
  const [cumulative, setCumulative] = useState(false);
  const [stat, setStat] = useState("fantasy");
  const toggleSelected = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const rows = useMemo(() => {
    const index = appearancesByPlayer(data); // one pass instead of N full scans
    const windows = win === "all" ? null : teamWindowEventIds(data, win);
    return Object.entries(data.players).map(([id, p]) => {
      const team = data.teams[p.teamId];
      const apps = index.get(Number(id)) || [];
      return {
        id, name: playerName(p), teamId: p.teamId, team,
        teamName: team?.shortName || "?",
        pos: p.gamePosition || "—",
        posRaw: p.gamePosition,
        err: missingFantasyData(p, apps),
        price: p.price, starred: p.starred, inSquad: p.inSquad,
        mi: mismatchInfo(data, id, apps), out: playerOutNow(data, id),
        hot: isHot(data, id, apps),
        climb: windows ? playerClimb(data, id, { apps, windowIds: windows.get(p.teamId) || new Set() }) : null,
        ...playerTotals(data, id, { apps, eventIds: windows ? windows.get(p.teamId) || new Set() : undefined }),
      };
    });
  }, [data, win]);

  const chartSeries = useMemo(() => [...selected].flatMap((id) => {
    const p = data.players[id];
    if (!p) return [];
    return [{
      key: String(id), label: playerName(p),
      color: teamColor(data.teams[p.teamId]).bg,
      points: playerWeeklySeries(data, id, stat),
    }];
  }), [data, selected, stat]);

  // ± only means something relative to a window
  const cols = win === "all" ? COLS : [...COLS.slice(0, 5), ["climb", "±", "form vs baseline: points per team match in the window minus before it"], ...COLS.slice(5)];

  const shown = rows
    .filter((r) =>
      (filters.team === "all" || String(r.teamId) === filters.team) &&
      (filters.pos === "all" || r.pos === filters.pos) &&
      (!filters.starred || r.starred) &&
      (!filters.inSquad || r.inSquad) &&
      (!filters.mismatch || r.mi) &&
      (!filters.hot || r.hot) &&
      (!filters.q || r.name.toLowerCase().includes(filters.q.toLowerCase())))
    .sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      // deliberate: null prices/points always sink to the bottom, regardless of sort direction
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });

  return (
    <div>
      <GameweekChart series={chartSeries} cumulative={cumulative}
        onToggleCumulative={() => setCumulative((c) => !c)}
        onClear={() => setSelected(new Set())}>
        {PLAYER_STATS.map(([key, label]) => (
          <button key={key} className={stat === key ? "primary" : ""} onClick={() => setStat(key)}>{label}</button>
        ))}
      </GameweekChart>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })}>
          <option value="all">All teams</option>
          {Object.entries(data.teams)
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select>
        <select value={filters.pos} onChange={(e) => setFilters({ ...filters, pos: e.target.value })}>
          <option value="all">All pos</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className={filters.starred ? "primary" : ""} onClick={() => setFilters({ ...filters, starred: !filters.starred })}>⭐</button>
        <button className={filters.inSquad ? "primary" : ""} onClick={() => setFilters({ ...filters, inSquad: !filters.inSquad })}>My squad</button>
        <button className={filters.mismatch ? "primary" : ""} title="position mismatches only"
          onClick={() => setFilters({ ...filters, mismatch: !filters.mismatch })}>▲▼</button>
        <button className={filters.hot ? "primary" : ""} title="in form: 8+ pts in 2 of the last 3"
          onClick={() => setFilters({ ...filters, hot: !filters.hot })}>🔥</button>
        {["all", 3, 5].map((w) => (
          <button key={w} className={win === w ? "primary" : ""}
            onClick={() => { setWin(w); if (w === "all" && sort.key === "climb") setSort({ key: "points", dir: -1 }); }}>
            {w === "all" ? "All" : `Last ${w}`}
          </button>
        ))}
        <input placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} style={{ flex: 1, minWidth: 100 }} />
      </div>
      <div className="scroll-x">
        <table className="sticky-col">
          <thead><tr>
            {cols.map(([key, label, tip]) => (
              <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
                {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => toggleSelected(r.id)}
                className={selected.has(r.id) ? "selected" : ""} style={{ cursor: "pointer" }}>
                <td className="cell-click" title="open player details"
                  onClick={(e) => { e.stopPropagation(); openPlayer(r.id); }}>
                  <button className={`mini-toggle ${selected.has(r.id) ? "" : "off"}`} aria-pressed={selected.has(r.id)}
                    title="add to graph" onClick={(e) => { e.stopPropagation(); toggleSelected(r.id); }}>📈</button>
                  {" "}{r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}<span style={{ textDecoration: "underline dotted" }}>{r.name}</span></td>
                <td><span className="chip" style={{ background: teamColor(r.team).bg, color: teamColor(r.team).fg }}>{r.teamName}</span></td>
                <td><PosPill pos={r.posRaw} /> <MismatchMark mi={r.mi} /></td>
                <td>{r.price ?? "—"}</td>
                <td className={r.err ? "err-cell" : ""} title={r.err ? "No fantasy data — set a position or add their fantasy alias in the player view" : ""}>{r.err ? "❗" : r.points ?? "—"}</td>
                {win !== "all" && (
                  <td>{r.climb == null ? "—" : <span className={r.climb >= 0 ? "gain" : "loss"}>{(r.climb >= 0 ? "+" : "") + r.climb.toFixed(1)}</span>}</td>
                )}
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
