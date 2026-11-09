import { useState } from "react";
import { setPlayerField, setAdjustment, playerAppearances, deriveRealPosition, matchRound, playerOutNow, mismatchInfo, playerName, removeFantasyOnlyPlayer } from "../lib/store.js";
import { teamColor } from "../lib/teamColors.js";
import { appearancePoints, diffComponents } from "../lib/sitePoints.js";
import { TeamPill, PosPill } from "./Pills.jsx";
import { previousSeasonTotals } from "../lib/seasons.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

function AdjustForm({ adj, onSave, onCancel }) {
  const [goals, setGoals] = useState(adj?.goals ?? 0);
  const [assists, setAssists] = useState(adj?.assists ?? 0);
  const [note, setNote] = useState(adj?.note ?? "");
  return (
    <div className="card">
      <div className="row">
        <label>Δ goals <input type="number" value={goals} style={{ width: 60 }} onChange={(e) => setGoals(Number(e.target.value))} /></label>
        <label>Δ assists <input type="number" value={assists} style={{ width: 60 }} onChange={(e) => setAssists(Number(e.target.value))} /></label>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input placeholder="note (e.g. won pen)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => {
          const g = Number.isFinite(goals) ? goals : 0;
          const a = Number.isFinite(assists) ? assists : 0;
          onSave(g || a ? { goals: g, assists: a, note } : null);
        }}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function PlayerDetail({ data, fullData, readOnly, update, playerId, onBack }) {
  const [adjustKey, setAdjustKey] = useState(null);
  const p = data.players[playerId];
  const last = !readOnly && fullData ? previousSeasonTotals(fullData, playerId) : null;
  if (!p) return <div className="card dim">Player not found. <button onClick={onBack}>←</button></div>;
  const apps = playerAppearances(data, playerId);
  const derived = deriveRealPosition(apps);

  const now = Date.now();
  const out = playerOutNow(data, playerId, now);
  const mi = mismatchInfo(data, playerId);
  const absences = Object.entries(data.absences || {})
    .filter(([k]) => k.endsWith(`:${playerId}`) || k.endsWith(`:${Number(playerId)}`))
    .map(([k, a]) => ({ ...a, eventId: Number(k.split(":")[0]) }))
    .sort((a, b) => (data.matches[a.eventId]?.kickoff || 0) - (data.matches[b.eventId]?.kickoff || 0));
  const legacyFlags = (p.flags || []);
  const upcoming = Object.values(data.matches)
    .filter((m) => (m.homeTeamId === p.teamId || m.awayTeamId === p.teamId)
      && m.kickoff > now && m.status !== "postponed" && m.status !== "canceled")
    .sort((a, b) => a.kickoff - b.kickoff)
    .slice(0, 2);
  const fmtD = (ts) => new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

  const setField = (field, value) => update((d) => setPlayerField(d, playerId, field, value));

  return (
    <div>
      <div className="row"><button onClick={onBack}>←</button>
        <h3 style={{ margin: 0 }}>
          {out ? <span title={out.note}>🚫 </span> : ""}{playerName(p)}{" "}
          <TeamPill team={data.teams[p.teamId]} label={data.teams[p.teamId]?.name} />
        </h3>
      </div>
      {last && (
        <p className="dim" style={{ margin: "4px 0" }} title={`${last.label} season, scored at that season's fantasy position`}>
          {last.label}: {last.apps} apps · {last.minutes.toLocaleString("en-IE")}′ · {last.goals}G {last.assists}A
          {last.points != null && ` · ${last.points} pts (${(last.points / last.apps).toFixed(1)}/g)`}
        </p>
      )}
      <div className="card row">
        <button className={p.starred ? "primary" : ""} onClick={() => setField("starred", !p.starred)}>⭐ watch</button>
        <button className={p.inSquad ? "primary" : ""} onClick={() => setField("inSquad", !p.inSquad)}>🔵 in squad</button>
        <span className="dim">€{p.price ?? "?"}</span>
        {p.fantasyOnly && (
          <>
            <span className="chip" title="from the fantasy site only — no SofaScore appearances yet">💤 not played</span>
            <button style={{ marginLeft: "auto" }}
              title="remove this fantasy-only record (use it if the capture created a duplicate of someone we already have)"
              onClick={() => {
                update((d) => removeFantasyOnlyPlayer(d, playerId));
                onBack();
              }}>Remove</button>
          </>
        )}
      </div>
      <div className="card row">
        <label>Display name{" "}
          <input defaultValue={playerName(p)} style={{ width: 150 }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setField("customName", v && v !== p.name ? v : null);
            }} />
        </label>
        <label>fantasy alias{" "}
          <input defaultValue={p.pasteAlias || ""} placeholder="name used on the fantasy site" style={{ width: 170 }}
            onBlur={(e) => setField("pasteAlias", e.target.value.trim() || null)} />
        </label>
      </div>
      <div className="card">
        <div className="row">
          <label>Game pos:
            <select value={p.gamePosition || ""} onChange={(e) => setField("gamePosition", e.target.value || null)}>
              <option value="">—</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <PosPill pos={p.gamePosition} />
          <label>Real pos:
            <select value={p.realPosition || ""} onChange={(e) => setField("realPosition", e.target.value || null)}>
              <option value="">auto{derived ? `: ${derived.position} (${derived.count}/${derived.total})` : ""}</option>
              {POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <PosPill pos={p.realPosition || derived?.position} />
          {mi && (
            <span className={mi.delta >= 0 ? "gain" : "loss"}>
              {mi.delta >= 0 ? "▲" : "▼"} game position pays {mi.delta >= 0 ? "+" : ""}{mi.delta} pts vs {mi.realPosition}
            </span>
          )}
        </div>
      </div>
      {(absences.length > 0 || legacyFlags.length > 0) && (
        <div className="card">
          {absences.map((a) => {
            const m = data.matches[a.eventId];
            const future = m && m.kickoff > now && m.status !== "finished";
            return (
              <div key={a.eventId} className={future ? "" : "dim"}>
                🚫 R{m ? matchRound(m) : "?"} {fmtD(m?.kickoff)} — {a.note} <span className="dim">(mark/clear on the Teams page)</span>
              </div>
            );
          })}
          {legacyFlags.map((f, i) => (
            <div key={`f${i}`} className="dim">↳ {f.note || "out"} · {fmtD(f.setAt)} → {f.clearedAt ? fmtD(f.clearedAt) : f.until ? fmtD(f.until) : "…"} (legacy)</div>
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="card dim">
          Upcoming: {upcoming.map((m) => {
            const home = m.homeTeamId === p.teamId;
            const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
            return `${home ? "v" : "@"} ${opp} ${fmtD(m.kickoff)}`;
          }).join(" · ")}
        </div>
      )}
      <div className="scroll-x">
        <table className="sticky-col">
          <thead><tr><th>Match</th><th>Min</th><th>G</th><th>A</th><th>Pos</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            {[...apps].reverse().map((a) => {
              const m = data.matches[a.eventId];
              const key = `${a.eventId}:${a.playerId}`;
              const adj = data.adjustments[key];
              const res = appearancePoints(data, a);
              const diff = res.site && res.ours && res.site.total !== res.ours.total && !res.site.notInGame
                ? diffComponents(res.site.rows, res.ours.breakdown) : null;
              const est = !!data.site && res.source === "ours";
              const tip = res.site?.notInGame
                ? "not in the fantasy game that week (the site scored 0)"
                : res.site
                  ? res.site.rows.map(([s, v, p]) => `${s} ${v}: ${p > 0 ? "+" : ""}${p}`).join(", ") +
                    (adj ? " · the site's value overrides your adjustment" : "")
                  : res.ours ? res.ours.breakdown.map(([r, v]) => `${r} ${v > 0 ? "+" : ""}${v}`).join(", ") : "";
              return (
                <tr key={key}>
                  <td>R{m ? matchRound(m) : "?"} {a.teamId === m?.homeTeamId ? "v" : "@"} <TeamPill team={data.teams[a.teamId === m?.homeTeamId ? m?.awayTeamId : m?.homeTeamId]} /></td>
                  <td>{a.minutes + (adj?.minutes || 0)}</td>
                  <td>{a.goals + (adj?.goals || 0)}{adj?.goals ? "✏" : ""}</td>
                  <td>{a.assists + (adj?.assists || 0)}{adj?.assists ? "✏" : ""}</td>
                  <td>{a.positionPlayed}</td>
                  <td title={est ? `our estimate (site not captured yet): ${tip}` : tip} className={est ? "est" : undefined}>
                    {res.total ?? "—"}
                    {diff && <span className="dim"> · ours {res.ours.total} ({diff.join(", ")})</span>}
                    {res.site?.notInGame && <span className="dim"> · not in the fantasy game that week</span>}
                  </td>
                  <td><button onClick={() => setAdjustKey(key)}>✏</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adjustKey && (
        <AdjustForm
          adj={data.adjustments[adjustKey]}
          onSave={(adj) => { update((d) => setAdjustment(d, adjustKey, adj)); setAdjustKey(null); }}
          onCancel={() => setAdjustKey(null)}
        />
      )}
      {apps.length === 0 && <p className="dim">No appearances imported yet.</p>}
    </div>
  );
}
