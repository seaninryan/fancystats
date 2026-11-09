// src/components/FantasyImport.jsx — the Fantasy sync card (Settings).
import { useMemo, useState } from "react";
import { buildSyncSnippet, parseSyncBlob, mapClubs, withTeamIds, shouldCreateRow } from "../lib/fantasyImport.js";
import { matchPlayers } from "../lib/pasteImport.js";
import { applySiteSync } from "../lib/store.js";
import { seasonView } from "../lib/seasons.js";
import { unresolvedSummary } from "../lib/sitePoints.js";
import UnmatchedLinks, { NEW_PLAYER } from "./UnmatchedLinks.jsx";
import CopyButton from "./CopyButton.jsx";
import Flash from "./Flash.jsx";

// Pre-select creation for the rows shouldCreateRow accepts; everything else keeps
// the link-or-skip default. The rule itself lives in lib and is unit-tested there.
export function defaultLinks(unmatched, players) {
  const links = {};
  unmatched.forEach((u, i) => {
    if (shouldCreateRow(u, players)) links[i] = NEW_PLAYER;
  });
  return links;
}

// Mirrors the Apply button's own wording, so the confirmation reads as the same
// sentence the button promised.
export function appliedMessage(players, newCount) {
  return `Applied ${players} players${newCount ? ` + ${newCount} new` : ""}`;
}

const REASON_TEXT = {
  "no-match": "no match in that round for their team — check the round of a postponed or rearranged match",
  "no-appearance": "played on the site but SofaScore has no appearance (not counted)",
};

export default function FantasyImport({ data, fullData, update }) {
  const [teamInput, setTeamInput] = useState(data.meta.siteTeamId ?? "");
  const [preview, setPreview] = useState(null); // { parsed, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const teamId = Number(data.meta.siteTeamId);
  const snippet = useMemo(() => (teamId > 0 ? buildSyncSnippet({ siteTeamId: teamId }) : ""), [teamId]);

  const saveTeam = () => {
    const n = Number(teamInput);
    if (Number.isInteger(n) && n > 0 && n !== data.meta.siteTeamId) {
      update((d) => ({ ...d, meta: { ...d.meta, siteTeamId: n } }));
    }
  };

  const buildPreview = (parsed, overrides) => {
    const clubMap = mapClubs(parsed.clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(parsed.players, clubMap), data.players);
    return { parsed, clubMap, matched, unmatched, links: defaultLinks(unmatched, data.players) };
  };

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-loading the same file
    if (!file) return;
    setError(null); setFlash(null);
    try {
      setPreview(buildPreview(parseSyncBlob(await file.text()), data.meta.fantasyClubMap));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    }
  };

  const setClub = (clubId, tid) => {
    const overrides = { ...(data.meta.fantasyClubMap || {}), [clubId]: tid };
    update((d) => ({ ...d, meta: { ...d.meta, fantasyClubMap: overrides } }));
    if (preview) setPreview(buildPreview(preview.parsed, overrides));
  };

  const picks = preview ? preview.unmatched.map((u, i) => ({ u, pid: preview.links[i] })) : [];
  const linked = picks.filter((x) => x.pid && x.pid !== NEW_PLAYER).map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
  const created = picks.filter((x) => x.pid === NEW_PLAYER).map((x) => x.u);

  // What the site data will look like once applied: a trial sync, projected like the app does.
  const attention = useMemo(() => {
    if (!preview) return [];
    const trial = applySiteSync(fullData, preview.parsed, [...preview.matched, ...linked], 0, created);
    return unresolvedSummary(seasonView(trial, trial.meta.seasonId));
  }, [preview, fullData]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const now = Date.now(); // updaters stay pure
    const rows = [...preview.matched, ...linked];
    update((d) => applySiteSync(d, preview.parsed, rows, now, created));
    const gws = Object.keys(preview.parsed.myTeam).length;
    setFlash(`${appliedMessage(rows.length, created.length)} · ${gws} gameweek${gws === 1 ? "" : "s"} of your team`);
    setPreview(null);
  };

  const unresolvedClubs = preview ? preview.parsed.clubs.filter((c) => !preview.clubMap[String(c.id)]) : [];
  const clubName = new Map((preview?.parsed.clubs || []).map((c) => [String(c.id), c.name]));
  const historyCount = preview ? Object.keys(preview.parsed.history).length : 0;
  const teamGws = preview ? Object.keys(preview.parsed.myTeam).length : 0;
  const linkCount = linked.length;
  const newCount = created.length;

  return (
    <div className="card">
      <h3>Fantasy sync</h3>
      <p className="dim">
        Brings in prices, positions, the site&rsquo;s points for every player and gameweek, and your
        own team. Run the snippet in a logged-in <code>fantasyloi.leagueofireland.ie</code> tab&rsquo;s
        DevTools console (type <code>allow pasting</code> if prompted). It takes about 2½ minutes and
        downloads a file; load that file below.
      </p>
      <div className="row">
        <label>Your fantasy team id{" "}
          <input value={teamInput} style={{ width: 90 }} inputMode="numeric"
            onChange={(e) => setTeamInput(e.target.value)} onBlur={saveTeam} />
        </label>
        <span className="dim">the number in your Results page link (…teamId=<b>7378</b>)</span>
      </div>
      <div className="row">
        {snippet
          ? <CopyButton text={snippet}>Copy snippet</CopyButton>
          : <button disabled title="Enter your fantasy team id first">Copy snippet</button>}
        <a className="ext" href="https://fantasyloi.leagueofireland.ie/" target="_blank" rel="noreferrer">Open the fantasy site ↗</a>
      </div>
      {snippet && (
        <div className="row">
          <label>Load the downloaded file <input type="file" accept=".json,application/json" onChange={loadFile} /></label>
        </div>
      )}
      <Flash message={flash} onDone={() => setFlash(null)} />
      {error && <div className="banner err">{error}</div>}
      {preview && (
        <div style={{ marginTop: 8 }}>
          <p>
            ✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched
            {newCount ? ` · ${newCount} to add as new` : ""} · {historyCount} player histories · {teamGws} gameweeks of your team
          </p>
          {attention.length > 0 && (
            <div className="banner warn">
              <strong>Site gameweeks needing attention</strong>
              {attention.map((a) => (
                <div key={`${a.gw}|${a.reason}`}>
                  GW{a.gw}: {a.count} player-gameweek{a.count === 1 ? "" : "s"} — {REASON_TEXT[a.reason]}
                  <span className="dim"> ({a.names.slice(0, 5).join(", ")}{a.names.length > 5 ? "…" : ""})</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <button className="primary" onClick={apply}>
              Apply {preview.matched.length + linkCount} players{newCount ? ` + ${newCount} new` : ""}
            </button>
          </div>
          {unresolvedClubs.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p className="dim">Unrecognised clubs — bind them once and it&rsquo;s remembered:</p>
              {unresolvedClubs.map((c) => (
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
            allowNew
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
