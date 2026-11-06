// src/components/SettingsTab.jsx
import { useState } from "react";
import { parsePaste, matchPlayers } from "../lib/pasteImport.js";
import { applyPasteResults, startNewSeason } from "../lib/store.js";
import UnmatchedLinks from "./UnmatchedLinks.jsx";
import FantasyImport from "./FantasyImport.jsx";
import ConsoleImport from "./ConsoleImport.jsx";
import Flash from "./Flash.jsx";
import { seasonList } from "../lib/seasons.js";

const KINDS = [
  ["price", "Prices (Statistic = Value, Position = All)", "prices"],
  ["GK", "Positions — Goalkeepers", "goalkeeper positions"],
  ["DEF", "Positions — Defenders", "defender positions"],
  ["MID", "Positions — Midfielders", "midfielder positions"],
  ["FWD", "Positions — Forwards", "forward positions"],
];

// Five near-identical imports share this card, so the confirmation has to say which
// one landed. "Applied", not "Updated": applyPasteResults skips a player whose
// gamePositionSource is "manual", so rows submitted is not rows changed.
export function appliedMessage(count, kind) {
  const short = (KINDS.find(([k]) => k === kind) || [])[2] || kind;
  return `Applied ${count} players — ${short}`;
}

export function backupFileName(date) {
  return `fancystats-backup-${date.toISOString().slice(0, 10)}.json`;
}

function downloadBackup(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = backupFileName(new Date());
  a.click();
  URL.revokeObjectURL(url);
}

function NewSeasonCard({ data, update }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(null);
  const cur = seasonList(data).find((s) => s.current);
  const start = () => {
    const n = Number(id);
    if (!n || n === Number(data.meta.seasonId) || data.seasons?.[n]) { setErr(`Season ${id} already exists`); return; }
    update((d) => startNewSeason(d, { seasonId: n, label: label.trim() || id }));
    setOpen(false); setId(""); setLabel(""); setErr(null);
  };
  return (
    <div className="card">
      <h3>Season</h3>
      <p className="dim">
        Current: {cur?.label ?? data.meta.seasonId} (tournament {data.meta.tournamentId} · season {data.meta.seasonId}).
        Find a new season id via api.sofascore.com/api/v1/unique-tournament/{data.meta.tournamentId}/seasons (open in a browser tab).
      </p>
      <div className="row">
        <button onClick={() => downloadBackup(data)}>⬇ Download backup</button>
        {!open && <button onClick={() => setOpen(true)}>Start new season…</button>}
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            <label>Season id <input value={id} onChange={(e) => setId(e.target.value)} style={{ width: 110 }} /></label>
            <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027" style={{ width: 80 }} /></label>
          </div>
          <p className="dim">
            {cur?.label ?? "This season"} stays viewable from the season picker. Each player's price, site points,
            fantasy position and squad tick are saved with it, then cleared for the new season. Names, stars,
            team colours and club mappings carry over. Nothing is deleted — download a backup first anyway.
          </p>
          <div className="row">
            <button className="primary" disabled={!Number(id)} onClick={start}>Start new season</button>
            <button onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
          </div>
          {err && <p className="err">{err}</p>}
        </div>
      )}
    </div>
  );
}

export default function SettingsTab({ data, update }) {
  const [kind, setKind] = useState("price");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null); // { matched, unmatched, links: {idx: playerId} }
  const [flash, setFlash] = useState(null);

  const parse = () => {
    const rows = parsePaste(text);
    const { matched, unmatched } = matchPlayers(rows, data.players);
    setPreview({ matched, unmatched, links: {} });
    setFlash(null);
  };

  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const now = Date.now();
    update((d) => applyPasteResults(d, [...preview.matched, ...linked], kind, now));
    // counted before the preview is cleared — it's the only source for this number
    setFlash(appliedMessage(preview.matched.length + linked.length, kind));
    setPreview(null); setText("");
  };

  const signOut = () => { sessionStorage.clear(); window.location.reload(); };

  return (
    <div>
      <ConsoleImport data={data} update={update} />
      <FantasyImport data={data} update={update} />
      <details className="card fold">
        <summary><h3>Import from the fantasy game (paste)</h3></summary>
        <p className="dim">
          Fallback for when the snippet above can&rsquo;t run. Open the fantasy game&rsquo;s
          Stats → Player Stats page, set the dropdowns to match your selection below,
          select the whole results table, copy, and paste here.
        </p>
        <div className="row">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setFlash(null); }}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <textarea rows={6} style={{ width: "100%", marginTop: 8 }} value={text}
          placeholder="Padraig Amond	10&#10;Michael Duffy	10&#10;…"
          onChange={(e) => { setText(e.target.value); setPreview(null); setFlash(null); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={parse} disabled={!text.trim()}>Parse</button>
          {preview && (
            <button className="primary" onClick={apply}>
              Apply {preview.matched.length + Object.values(preview.links).filter(Boolean).length} players
            </button>
          )}
        </div>
        <Flash message={flash} onDone={() => setFlash(null)} />
        {preview && (
          <div style={{ marginTop: 8 }}>
            <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
            <UnmatchedLinks
              data={data}
              unmatched={preview.unmatched}
              links={preview.links}
              onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
              columns={[
                { label: "Value", width: "5rem", value: (u) => (u.value != null ? String(u.value) : "") },
                { label: "Price", width: "5rem", value: (u) => (u.price != null ? `€${u.price}` : "") },
              ]}
            />
          </div>
        )}
      </details>
      <NewSeasonCard data={data} update={update} />
      <div className="card row">
        <button onClick={() => window.location.reload()}>⟳ Resync from Drive</button>
        <button onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
