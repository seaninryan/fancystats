// src/components/SeasonBar.jsx
import { seasonList } from "../lib/seasons.js";

// Header season picker; only appears once a second season exists.
export default function SeasonBar({ data, viewSeason, onChange }) {
  const seasons = seasonList(data);
  if (seasons.length < 2) return null;
  const current = seasons.find((s) => s.current);
  const viewing = seasons.find((s) => s.seasonId === Number(viewSeason)) || current;
  return (
    <>
      <select value={viewing.seasonId} onChange={(e) => onChange(Number(e.target.value))}
        title="season" style={{ alignSelf: "center" }}>
        {seasons.map((s) => <option key={s.seasonId} value={s.seasonId}>{s.label}</option>)}
      </select>
      {!viewing.current && (
        <div className="banner warn row" role="status" style={{ flexBasis: "100%" }}>
          Viewing {viewing.label} (read-only) ·{" "}
          <button onClick={() => onChange(current.seasonId)}>Back to {current.label}</button>
        </div>
      )}
    </>
  );
}
