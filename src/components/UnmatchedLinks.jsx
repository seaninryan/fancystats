// src/components/UnmatchedLinks.jsx
// Shared by both import cards: a column-aligned list of unmatched rows, each with a
// select for binding it to a SofaScore player. Callers supply `columns` —
// [{label, width, value(row)}] — because the two cards carry different fields
// (the fantasy capture knows position/price/club; a paste only knows its numbers).
// A row's `teamId` (fantasy captures) floats that club's players to the top of the
// suggestions.
import { suggestLinks } from "../lib/pasteImport.js";

// Sentinel select value meaning "materialize this row as a fantasy-only player".
// Not a player id, and no real id can collide with it.
export const NEW_PLAYER = "__new__";

export default function UnmatchedLinks({ data, unmatched, links, onChange, columns = [], allowNew = false }) {
  const label = (p) => `${p.customName || p.name} (${data.teams[p.teamId]?.shortName})`;
  if (!unmatched.length) return null;
  return (
    <div className="link-rows">
      <div className="link-head">
        <span className="link-name">Name on the fantasy site</span>
        {columns.map((c) => <span key={c.label} className="link-cell" style={{ width: c.width }}>{c.label}</span>)}
        <span className="link-pick">Link to</span>
      </div>
      {unmatched.map((u, i) => {
        const sugg = suggestLinks(u.name, data.players, u.teamId ?? null);
        const all = Object.entries(data.players)
          .filter(([id]) => !sugg.includes(id))
          .sort((a, b) => (a[1].customName || a[1].name).localeCompare(b[1].customName || b[1].name));
        return (
          <div className={`link-row${links[i] ? " link-done" : ""}`} key={i}>
            <span className="link-name">{u.name}</span>
            {columns.map((c) => (
              <span key={c.label} className="link-cell" style={{ width: c.width }}>{c.value(u) ?? ""}</span>
            ))}
            <select className="link-pick" value={links[i] || ""}
              onChange={(e) => onChange(i, e.target.value || undefined)}>
              <option value="">skip</option>
              {allowNew && u.teamId != null && (
                <option value={NEW_PLAYER}>➕ add as new player</option>
              )}
              {sugg.length > 0 && (
                <optgroup label="Suggested">
                  {sugg.map((id) => <option key={id} value={id}>{label(data.players[id])}</option>)}
                </optgroup>
              )}
              <optgroup label="All players">
                {all.map(([id, p]) => <option key={id} value={id}>{label(p)}</option>)}
              </optgroup>
            </select>
          </div>
        );
      })}
    </div>
  );
}
