// Shared per-gameweek line chart card (Players + Table tabs). Children render
// into the control row — the Table tab puts its stat-selector buttons there.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { accumulate, chartRows } from "../lib/series.js";

// Same-club selections share a colour; dash patterns keep the lines apart.
const DASHES = [undefined, "5 3", "2 2", "8 3 2 3"];

export default function GameweekChart({ series, cumulative, onToggleCumulative, onClear, children }) {
  if (!series.length) return null;
  const shown = cumulative ? series.map((s) => ({ ...s, points: accumulate(s.points) })) : series;
  const rows = chartRows(shown);
  if (!rows.length) return null;
  const seenColor = new Map();
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 4 }}>
        {children}
        <button className={cumulative ? "primary" : ""} onClick={onToggleCumulative}>Cumulative</button>
        <button onClick={onClear} style={{ marginLeft: "auto" }}>Clear</button>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="round" stroke="var(--dim)" fontSize={12} />
          <YAxis stroke="var(--dim)" fontSize={12} allowDecimals={false} width={36} />
          <Tooltip labelFormatter={(r) => `Gameweek ${r}`}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8 }} />
          <Legend />
          {shown.map((s) => {
            const n = seenColor.get(s.color) || 0;
            seenColor.set(s.color, n + 1);
            return (
              <Line key={s.key} dataKey={s.key} name={s.label} type="monotone"
                stroke={s.color} strokeWidth={2} strokeDasharray={DASHES[n % DASHES.length]}
                dot={{ r: 2, fill: s.color }} connectNulls={false} isAnimationActive={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
