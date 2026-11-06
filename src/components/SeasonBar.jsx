// src/components/SeasonBar.jsx
import { seasonList } from "../lib/seasons.js";

function pick(data, viewSeason) {
  const seasons = seasonList(data);
  const current = seasons.find((s) => s.current);
  const viewing = seasons.find((s) => s.seasonId === Number(viewSeason)) || current;
  return { seasons, current, viewing };
}

// Header season picker (lives in the nav); only appears once a second season exists.
export default function SeasonBar({ data, viewSeason, onChange }) {
  const { seasons, viewing } = pick(data, viewSeason);
  if (seasons.length < 2) return null;
  return (
    <select value={viewing.seasonId} onChange={(e) => onChange(Number(e.target.value))}
      title="season" style={{ alignSelf: "center" }}>
      {seasons.map((s) => <option key={s.seasonId} value={s.seasonId}>{s.label}</option>)}
    </select>
  );
}

// Read-only notice rendered below the nav, next to the other banners.
export function SeasonBanner({ data, viewSeason, onChange }) {
  const { seasons, current, viewing } = pick(data, viewSeason);
  if (seasons.length < 2 || viewing.current) return null;
  return (
    <div className="banner warn row" role="status">
      Viewing {viewing.label} (read-only) ·{" "}
      <button onClick={() => onChange(current.seasonId)}>Back to {current.label}</button>
    </div>
  );
}
