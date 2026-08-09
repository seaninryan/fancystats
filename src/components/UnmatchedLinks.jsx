// src/components/UnmatchedLinks.jsx
// Shared by both import cards: one row per unmatched capture/paste row, with a
// select for binding it to a SofaScore player. `describe` renders the optional
// parenthetical after the name; a row's `teamId` (fantasy captures) floats that
// club's players to the top of the suggestions.
import { suggestLinks } from "../lib/pasteImport.js";

export default function UnmatchedLinks({ data, unmatched, links, onChange, describe }) {
  const label = (p) => `${p.customName || p.name} (${data.teams[p.teamId]?.shortName})`;
  return (
    <>
      {unmatched.map((u, i) => {
        const sugg = suggestLinks(u.name, data.players, u.teamId ?? null);
        const all = Object.entries(data.players)
          .filter(([id]) => !sugg.includes(id))
          .sort((a, b) => (a[1].customName || a[1].name).localeCompare(b[1].customName || b[1].name));
        return (
          <div className="row" key={i}>
            <span style={{ flex: 1 }}>
              &ldquo;{u.name}&rdquo;{describe ? ` (${describe(u)})` : ""}
            </span>
            <select value={links[i] || ""} onChange={(e) => onChange(i, e.target.value || undefined)}>
              <option value="">skip</option>
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
    </>
  );
}
