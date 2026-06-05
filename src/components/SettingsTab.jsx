// src/components/SettingsTab.jsx
import { useState } from "react";
import { parsePaste, matchPlayers } from "../lib/pasteImport.js";
import { applyPasteResults } from "../lib/store.js";

const KINDS = [
  ["price", "Prices (Statistic = Value, Position = All)"],
  ["GK", "Positions — Goalkeepers"], ["DEF", "Positions — Defenders"],
  ["MID", "Positions — Midfielders"], ["FWD", "Positions — Forwards"],
];

export default function SettingsTab({ data, update }) {
  const [kind, setKind] = useState("price");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null); // { matched, unmatched, links: {idx: playerId} }

  const parse = () => {
    const rows = parsePaste(text);
    const { matched, unmatched } = matchPlayers(rows, data.players);
    setPreview({ matched, unmatched, links: {} });
  };

  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ playerId: pid, name: u.name, value: u.value, alias: u.name }));
    const now = Date.now();
    update((d) => applyPasteResults(d, [...preview.matched, ...linked], kind, now));
    setPreview(null); setText("");
  };

  const signOut = () => { sessionStorage.clear(); window.location.reload(); };

  return (
    <div>
      <div className="card">
        <h3>Import from Fantasy LOI</h3>
        <p className="dim">
          Open fantasyloi.leagueofireland.ie → Stats → Player Stats, set the dropdowns to match
          your selection below, select the whole results table, copy, and paste here.
        </p>
        <div className="row">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <textarea rows={6} style={{ width: "100%", marginTop: 8 }} value={text}
          placeholder="Padraig Amond	10&#10;Michael Duffy	10&#10;…"
          onChange={(e) => { setText(e.target.value); setPreview(null); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={parse} disabled={!text.trim()}>Parse</button>
          {preview && (
            <button className="primary" onClick={apply}>
              Apply {preview.matched.length + Object.values(preview.links).filter(Boolean).length} players
            </button>
          )}
        </div>
        {preview && (
          <div style={{ marginTop: 8 }}>
            <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
            {preview.unmatched.map((u, i) => (
              <div className="row" key={i}>
                <span style={{ flex: 1 }}>“{u.name}” ({u.value})</span>
                <select value={preview.links[i] || ""}
                  onChange={(e) => setPreview({ ...preview, links: { ...preview.links, [i]: e.target.value || undefined } })}>
                  <option value="">skip</option>
                  {Object.entries(data.players)
                    .sort((a, b) => a[1].name.localeCompare(b[1].name))
                    .map(([id, p]) => <option key={id} value={id}>{p.name} ({data.teams[p.teamId]?.shortName})</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Season</h3>
        <p className="dim">
          Tournament {data.meta.tournamentId} · season {data.meta.seasonId}.
          New season? Find the id via api.sofascore.com/api/v1/unique-tournament/192/seasons
          (open in a browser tab) and update below.
        </p>
        <div className="row">
          <label>Season id <input defaultValue={data.meta.seasonId} style={{ width: 110 }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v && v !== data.meta.seasonId) update((d) => ({ ...d, meta: { ...d.meta, seasonId: v } }));
            }} /></label>
        </div>
      </div>
      <div className="card row">
        <button onClick={() => window.location.reload()}>⟳ Resync from Drive</button>
        <button onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
