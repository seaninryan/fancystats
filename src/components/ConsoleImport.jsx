// src/components/ConsoleImport.jsx
import { useState } from "react";
import { buildImportSnippet, decodeBlob, applyDecoded } from "../lib/consoleImport.js";

export default function ConsoleImport({ data, update }) {
  const [token, setToken] = useState(data.meta.sofascoreToken || "");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [refetchAll, setRefetchAll] = useState(false);

  const known = refetchAll ? [] : Object.values(data.matches)
    .filter((m) => m.importedAt && m.goalTimes && !m.partial)
    .map((m) => m.eventId);

  const snippet = buildImportSnippet({
    tournamentId: data.meta.tournamentId,
    seasonId: data.meta.seasonId,
    token,
    knownEventIds: known,
  });

  const saveToken = (v) => {
    setToken(v);
    update((d) => ({ ...d, meta: { ...d.meta, sofascoreToken: v } }));
  };

  const doImport = async () => {
    setError(null); setStatus(null);
    let blob;
    try { blob = JSON.parse(paste); }
    catch { setError("Couldn't parse — copy the snippet output again."); return; }
    if (blob?.meta?.seasonId != null && String(blob.meta.seasonId) !== String(data.meta.seasonId)) {
      setError(`Blob is for season ${blob.meta.seasonId}, app is on ${data.meta.seasonId}.`);
      return;
    }
    setBusy(true); setStatus("Importing…");
    try {
      const decoded = await decodeBlob(blob);
      const now = Date.now();
      update((d) => applyDecoded(d, decoded, now));
      setPaste("");
      setStatus(`Imported ${decoded.results.length} match(es)${decoded.failed.length ? `, ${decoded.failed.length} failed` : ""}.`);
      if (decoded.failed.length) setError(decoded.failed.map((f) => `${f.id}: ${f.error}`).join("; "));
    } catch (e) {
      setError(e.message); setStatus(null);
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Import via console</h3>
      <p className="dim">SofaScore blocks direct API access. Run this in a <code>sofascore.com</code> tab's DevTools console (type <code>allow pasting</code> if prompted), then paste the result below.</p>
      <div className="row">
        <label>x-requested-with token{" "}
          <input value={token} onChange={(e) => saveToken(e.target.value)} placeholder="e.g. 2421c3" />
        </label>
        <label><input type="checkbox" checked={refetchAll} onChange={(e) => setRefetchAll(e.target.checked)} /> Re-fetch all (backfill)</label>
        <button onClick={() => navigator.clipboard?.writeText(snippet)} disabled={!token}>Copy snippet</button>
        {/* rel=noreferrer matters here: a github.io Referer is blocked by SofaScore */}
        <a className="ext" href="https://www.sofascore.com/" target="_blank" rel="noreferrer">Open SofaScore ↗</a>
      </div>
      <textarea readOnly value={snippet} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }} />
      <textarea placeholder="Paste the snippet output here" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} style={{ width: "100%", fontFamily: "monospace" }} />
      <div className="row">
        <button className="primary" onClick={doImport} disabled={busy || !paste.trim()}>Import</button>
        {status && <span className="dim">{status}</span>}
        {data.meta.lastEventSync && <span className="dim">last sync {new Date(data.meta.lastEventSync).toLocaleDateString("en-IE")}</span>}
      </div>
      {error && <div className="banner err">{error}</div>}
    </div>
  );
}
