// src/components/FantasyImport.jsx
import { useState } from "react";
import { buildFantasySnippet, parseFantasyBlob, mapClubs, withTeamIds } from "../lib/fantasyImport.js";
import { matchPlayers } from "../lib/pasteImport.js";
import { applyFantasyRows } from "../lib/store.js";
import UnmatchedLinks from "./UnmatchedLinks.jsx";

const SNIPPET = buildFantasySnippet(); // no app state goes into it — build once

export default function FantasyImport({ data, update }) {
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState(null); // { players, clubs, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);

  const buildPreview = (players, clubs, overrides) => {
    const clubMap = mapClubs(clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(players, clubMap), data.players);
    return { players, clubs, clubMap, matched, unmatched, links: {} };
  };

  const parse = () => {
    setError(null);
    try {
      const { clubs, players } = parseFantasyBlob(paste);
      setPreview(buildPreview(players, clubs, data.meta.fantasyClubMap));
    } catch (e) {
      setError(e.message);
      setPreview(null);
    }
  };

  // Binding a club re-runs matching immediately, so the unmatched list shrinks as
  // you map. The map itself is user-owned and persists in the save.
  const setClub = (clubId, teamId) => {
    const overrides = { ...(data.meta.fantasyClubMap || {}), [clubId]: teamId };
    update((d) => ({ ...d, meta: { ...d.meta, fantasyClubMap: overrides } }));
    if (preview) setPreview(buildPreview(preview.players, preview.clubs, overrides));
  };

  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const now = Date.now(); // updaters stay pure — same convention as the paste card
    update((d) => applyFantasyRows(d, [...preview.matched, ...linked], now));
    setPreview(null);
    setPaste("");
  };

  const unresolved = preview ? preview.clubs.filter((c) => !preview.clubMap[String(c.id)]) : [];
  const clubName = new Map((preview?.clubs || []).map((c) => [String(c.id), c.name]));
  const linkCount = preview ? Object.values(preview.links).filter(Boolean).length : 0;

  return (
    <div className="card">
      <h3>Import from Fantasy LOI</h3>
      <p className="dim">
        Run this in a logged-in <code>fantasyloi.leagueofireland.ie</code> tab&rsquo;s DevTools console
        (type <code>allow pasting</code> if prompted), then paste the result below. It captures every
        player&rsquo;s position, price and site points in one go — no dropdowns to set, and your own
        squad is included.
      </p>
      <div className="row">
        <button onClick={() => navigator.clipboard?.writeText(SNIPPET)}>Copy snippet</button>
      </div>
      <textarea readOnly value={SNIPPET} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }} />
      <textarea placeholder="Paste the snippet output here" value={paste} rows={4}
        style={{ width: "100%", fontFamily: "monospace" }}
        onChange={(e) => { setPaste(e.target.value); setPreview(null); }} />
      <div className="row">
        <button onClick={parse} disabled={!paste.trim()}>Parse</button>
        {preview && (
          <button className="primary" onClick={apply}>
            Apply {preview.matched.length + linkCount} players
          </button>
        )}
      </div>
      {error && <div className="banner err">{error}</div>}
      {preview && (
        <div style={{ marginTop: 8 }}>
          <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
          {unresolved.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p className="dim">Unrecognised clubs — bind them once and it&rsquo;s remembered:</p>
              {unresolved.map((c) => (
                <div className="link-row" key={c.id}>
                  <span className="link-name">{c.name}</span>
                  <select className="link-pick" value=""
                    onChange={(e) => e.target.value && setClub(String(c.id), e.target.value)}>
                    <option value="">choose team…</option>
                    {Object.entries(data.teams)
                      .sort((a, b) => a[1].name.localeCompare(b[1].name))
                      .map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <UnmatchedLinks
            data={data}
            unmatched={preview.unmatched}
            links={preview.links}
            onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
            columns={[
              { label: "Pos", width: "3.5rem", value: (u) => u.gamePosition },
              { label: "Price", width: "4.5rem", value: (u) => (u.price != null ? `€${u.price}` : "") },
              // pts is the triage signal: 0 means they've never played, so there's
              // no SofaScore record to link them to and skipping is correct
              { label: "Pts", width: "3.5rem", value: (u) => (u.sitePoints != null ? String(u.sitePoints) : "") },
              { label: "Club", width: "9.5rem", value: (u) => clubName.get(String(u.clubId)) || "" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
