import { useState, useRef, useEffect } from "react";
import { matchRound, setPlayerField, playerName, missingFantasyData, setAbsence, getAbsence, playerOutNow, setTeamColor, isHot, hotEventIds } from "../lib/store.js";
import { scoreAppearance } from "../lib/scoring.js";
import { teamColor } from "../lib/teamColors.js";
import { TeamPill, PosPill, PtsPill } from "./Pills.jsx";

// Colour = how they appeared; emoji = what they did.
function cellFor(app0, adj) {
  if (!app0) return { sym: "—", cls: "cell-out", title: "did not play" };
  // Merge user adjustments so the grid agrees with PlayerDetail (e.g. pen saves
  // only exist as adjustments — without this 🧤 could never appear).
  let app = app0;
  if (adj) {
    app = { ...app0 };
    for (const f of ["goals", "assists", "penMissed", "penSaved"]) {
      if (typeof adj[f] === "number") app[f] = Math.max(0, (app[f] || 0) + adj[f]);
    }
    if (typeof adj.secondYellow === "boolean") app.secondYellow = adj.secondYellow;
    if (typeof adj.red === "boolean") app.red = adj.red;
  }
  const goals = app.goals || 0;
  const pens = Math.min(app.penScored || 0, goals);
  const deco =
    "⚽".repeat(goals - pens) + "⚽🥅".repeat(pens) +
    "👟".repeat(app.assists || 0) +
    (app.secondYellow ? "🟨🟨" : app.yellow ? "🟨" : "") +
    (app.red ? "🟥" : "") +
    "❌".repeat(app.penMissed || 0) +
    "🧤".repeat(app.penSaved || 0);
  const words = [
    goals && `${goals} goal${goals > 1 ? "s" : ""}${pens ? ` (${pens} pen)` : ""}`,
    app.assists && `${app.assists} assist${app.assists > 1 ? "s" : ""}`,
    app.secondYellow ? "second yellow" : app.yellow ? "yellow card" : null,
    app.red && "straight red",
    app.penMissed && "missed penalty",
    app.penSaved && "penalty saved",
  ].filter(Boolean).join(", ");
  if (!app.started) return { sym: `○${app.subOnMin ?? ""}'${deco}`, cls: "cell-on", title: `sub on ${app.subOnMin}'${words ? " — " + words : ""}` };
  if (app.subOffMin != null) return { sym: `◐${app.subOffMin}'${deco}`, cls: "cell-off", title: `subbed off ${app.subOffMin}'${words ? " — " + words : ""}` };
  return { sym: `●${deco}`, cls: "cell-start", title: `full match${words ? " — " + words : ""}` };
}

const fmtD = (ts) => new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

const TOTAL_COLS = [
  ["minutes", "Min", "minutes in the selected window"], ["goals", "G", "goals in the selected window"],
  ["assists", "A", "assists in the selected window"], ["points", "Pts", "fantasy points in the selected window"],
];

function AbsenceBar({ ctx, existing, defaultNote, onSave, onClear, onClose }) {
  const [note, setNote] = useState(existing?.note ?? defaultNote);
  return (
    <form className="card row absence-bar" onSubmit={(e) => { e.preventDefault(); onSave(note); }}>
      <span>{ctx}</span>
      <input autoFocus placeholder="why are they out?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <button className="primary" type="submit">OK</button>
      {existing && <button type="button" onClick={onClear}>Clear</button>}
      <button type="button" onClick={onClose}>✕</button>
    </form>
  );
}

export default function TeamsTab({ data, update, openPlayer, focusTeam }) {
  const teamIds = Object.keys(data.teams)
    .sort((a, b) => data.teams[a].name.localeCompare(data.teams[b].name));
  const [teamId, setTeamId] = useState(
    (focusTeam?.teamId && data.teams[focusTeam.teamId] ? String(focusTeam.teamId) : null) || teamIds[0] || null,
  );
  // Arriving from a team link elsewhere in the app. Keyed on the nonce so
  // clicking the same club twice still re-focuses, and so the user's own
  // dropdown choice is never fought over on unrelated re-renders.
  useEffect(() => {
    if (focusTeam?.teamId && data.teams[focusTeam.teamId]) setTeamId(String(focusTeam.teamId));
  }, [focusTeam?.nonce]);
  const [win, setWin] = useState("all"); // "all" | 3 | 5
  const [sort, setSort] = useState({ key: "apps", dir: -1 });
  const [absEdit, setAbsEdit] = useState(null); // { eventId, pid }
  const lastNoteFor = (pid) => {
    const mine = Object.entries(data.absences || {})
      .filter(([k]) => k.endsWith(`:${pid}`))
      .map(([, a]) => a)
      .sort((a, b) => b.setAt - a.setAt);
    return mine[0]?.note || "";
  };
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;
  const wrapRef = useRef(null);
  const firstUpRef = useRef(null);
  useEffect(() => {
    const w = wrapRef.current, t = firstUpRef.current;
    if (w && t) w.scrollLeft = Math.max(0, t.offsetLeft - w.clientWidth / 2);
  }, [selected]);

  const gone = (m) => m.status === "postponed" || m.status === "canceled";
  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected))
    .sort((a, b) => a.kickoff - b.kickoff);

  const now = Date.now();

  const windowMatches = win === "all" ? matches : matches.slice(-win);
  const windowIds = new Set(windowMatches.map((m) => m.eventId));
  const upcoming = Object.values(data.matches)
    .filter((m) => (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected)
      && m.kickoff > now && !gone(m))
    .sort((a, b) => a.kickoff - b.kickoff);
  const nextMatch = upcoming[0];

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === selected);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  // Windowed running totals per player (adjustment-aware, like PlayerDetail).
  const totals = new Map(); // pid -> {apps, minutes, goals, assists, points|null}
  for (const a of apps) {
    if (!totals.has(a.playerId)) totals.set(a.playerId, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null, seasonPoints: null });
    const t = totals.get(a.playerId);
    t.apps++; // all-time, used for default row order
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const pp = data.players[a.playerId];
    const m = data.matches[a.eventId];
    const pts = pp?.gamePosition && m?.goalTimes ? scoreAppearance(a, m, pp.gamePosition, adj).total : null;
    if (pts != null) t.seasonPoints = (t.seasonPoints ?? 0) + pts; // site cross-check is season-wide
    if (!windowIds.has(a.eventId)) continue;
    const g = (a.goals || 0) + (typeof adj?.goals === "number" ? adj.goals : 0);
    const as = (a.assists || 0) + (typeof adj?.assists === "number" ? adj.assists : 0);
    t.minutes += (a.minutes || 0) + (typeof adj?.minutes === "number" ? adj.minutes : 0);
    t.goals += Math.max(0, g);
    t.assists += Math.max(0, as);
    if (pts != null) t.points = (t.points ?? 0) + pts;
  }

  // Registered players with no appearances at all (fantasy capture only). Seeded
  // AFTER the loop above so they can never overwrite a real player's totals, and
  // with points null so the existing null-sinks rule sorts them the same way it
  // sorts any other pointless row.
  for (const [pid, p] of Object.entries(data.players)) {
    if (!p.fantasyOnly || String(p.teamId) !== selected || totals.has(pid)) continue;
    totals.set(pid, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null, seasonPoints: null });
  }

  const playerIds = [...totals.keys()].sort((a, b) => {
    const ta = totals.get(a), tb = totals.get(b);
    const key = sort.key;
    const av = ta[key], bv = tb[key];
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sort.dir;
  });

  const RESULT_TIP = "team result points: win +2 · draw +1 · loss 0 (every appearing player gets them)";
  const resultPts = (m) => {
    const ours = String(m.homeTeamId) === selected ? m.homeScore : m.awayScore;
    const theirs = String(m.homeTeamId) === selected ? m.awayScore : m.homeScore;
    if (ours == null || theirs == null) return null;
    return ours > theirs ? { txt: "+2", cls: "res-w" } : ours === theirs ? { txt: "+1", cls: "res-d" } : { txt: "0", cls: "res-l" };
  };

  const toggle = (pid, field, value) => update((d) => setPlayerField(d, pid, field, value));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={selected || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        <input type="color" title="team colour (saves when you close the picker)"
          defaultValue={teamColor(data.teams[selected]).bg.startsWith("#") ? teamColor(data.teams[selected]).bg : "#888888"}
          key={`${selected}:${data.teams[selected]?.colorBg || "def"}`}
          onBlur={(e) => update((d) => setTeamColor(d, selected, e.target.value))} />
        <button className="mini-toggle" title="reset to default colour"
          onClick={() => update((d) => setTeamColor(d, selected, null))}>↺</button>
        {["all", 3, 5].map((w) => (
          <button key={w} className={win === w ? "primary" : ""} onClick={() => setWin(w)}>
            {w === "all" ? "All" : `Last ${w}`}
          </button>
        ))}
        {nextMatch && (
          <span className="dim">
            Next: {String(nextMatch.homeTeamId) === selected ? "v" : "@"}{" "}
            <TeamPill team={data.teams[String(nextMatch.homeTeamId) === selected ? nextMatch.awayTeamId : nextMatch.homeTeamId]} />
            {" "}· {fmtD(nextMatch.kickoff)}
          </span>
        )}
      </div>
      <p className="dim">● start · ◐ off · ○ on · ⚽ goal · 🥅 pen · 👟 assist · number = fantasy pts</p>
      {absEdit && (() => {
        const m = data.matches[absEdit.eventId];
        const home = String(m.homeTeamId) === selected;
        const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
        const ctx = `${playerName(data.players[absEdit.pid])} · R${matchRound(m)} ${home ? "v" : "@"} ${opp}`;
        return (
          <AbsenceBar key={`${absEdit.eventId}:${absEdit.pid}`} ctx={ctx}
            existing={getAbsence(data, absEdit.eventId, absEdit.pid)}
            defaultNote={lastNoteFor(absEdit.pid)}
            onSave={(note) => {
              const now = Date.now();
              update((d) => setAbsence(d, absEdit.eventId, absEdit.pid, note.trim() || null, now));
              setAbsEdit(null);
            }}
            onClear={() => {
              const now = Date.now();
              update((d) => setAbsence(d, absEdit.eventId, absEdit.pid, null, now));
              setAbsEdit(null);
            }}
            onClose={() => setAbsEdit(null)} />
        );
      })()}
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x scroll-xy" ref={wrapRef}>
          <table className="sticky-col freeze-stats">
            <thead><tr>
              <th onClick={() => setSort({ key: "apps", dir: -1 })} title="click to sort by appearances">Player</th>
              <th title="fantasy game position">Pos</th>
              {TOTAL_COLS.map(([key, label, tip]) => (
                <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
                  {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                </th>
              ))}
              {matches.map((m) => {
                const home = String(m.homeTeamId) === selected;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                const rp = resultPts(m);
                return (
                  <th key={m.eventId} className={windowIds.has(m.eventId) && win !== "all" ? "win-col" : ""}
                    title={`${fmtD(m.kickoff)} — ${RESULT_TIP}`}>
                    R{matchRound(m)}
                    <span className="sub">{home ? "v" : "@"}{opp} {rp && <span className={rp.cls}>{rp.txt}</span>}</span>
                  </th>
                );
              })}
              {upcoming.map((m, i) => {
                const home = String(m.homeTeamId) === selected;
                return (
                  <th ref={i === 0 ? firstUpRef : null} key={m.eventId} className="upcoming-col" title={fmtD(m.kickoff)}>
                    R{matchRound(m)}
                    <span className="sub">{home ? "v" : "@"}{data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName}</span>
                  </th>
                );
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => {
                const p = data.players[pid];
                const t = totals.get(pid);
                const out = playerOutNow(data, pid, now);
                const playerApps = apps.filter((x) => x.playerId === pid);
                const err = missingFantasyData(p, playerApps);
                // window = the player's current team's last games (same on every page)
                const hot = isHot(data, pid, playerApps);
                const hotEvents = hotEventIds(data, pid, playerApps);
                const siteDelta = p?.sitePoints != null && t.seasonPoints != null ? t.seasonPoints - p.sitePoints : null;
                const ghost = !!p?.fantasyOnly;
                return (
                  <tr key={pid} className={ghost ? "ghost-row" : ""}>
                    <td>
                      <span className="player-cell">
                        <button className={`mini-toggle ${p?.starred ? "" : "off"}`} aria-pressed={!!p?.starred} title="watchlist"
                          onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
                        <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} aria-pressed={!!p?.inSquad} title="in my squad"
                          onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
                        {ghost ? <span title="hasn't played yet">💤</span> : ""}{out ? <span title={out.note}>🚫</span> : ""}{hot ? "🔥" : ""}<a role="link" tabIndex={0} title={playerName(p)}
                          style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                          onClick={() => openPlayer(String(pid))}
                          onKeyDown={(e) => e.key === "Enter" && openPlayer(String(pid))}>
                          {playerName(p) || pid}
                        </a>
                      </span>
                    </td>
                    <td><PosPill pos={p?.gamePosition} /></td>
                    <td>{t.minutes}</td><td>{t.goals}</td><td>{t.assists}</td>
                    <td className={`${err ? "err-cell" : ""}${siteDelta ? ` pts-diff ${siteDelta < 0 ? "site-up" : "site-down"}` : ""}`}
                      title={err ? "No fantasy data — set a position or add their fantasy alias in the player view"
                        : siteDelta ? `${siteDelta > 0 ? "+" : ""}${siteDelta} vs official site (ours ${t.seasonPoints} · site ${p.sitePoints})` : ""}>
                      {err ? "❗" : t.points ?? "—"}</td>
                    {matches.map((m) => {
                      const key = `${m.eventId}:${pid}`;
                      const a = byPlayerMatch.get(key);
                      const adj = data.adjustments[key];
                      const absence = getAbsence(data, m.eventId, pid);
                      const { sym, cls, title } = cellFor(a, adj);
                      const pts = a && data.players[pid]?.gamePosition && m.goalTimes
                        ? scoreAppearance(a, m, data.players[pid].gamePosition, adj).total : null;
                      const winCls = windowIds.has(m.eventId) && win !== "all" ? " win-col" : "";
                      if (!a) {
                        return (
                          <td key={m.eventId} className={`cell-out cell-click${winCls}`}
                            title={absence ? absence.note : "didn't play — click to note why"}
                            onClick={() => setAbsEdit({ eventId: m.eventId, pid })}>
                            {absence ? "🚫" : "—"}
                          </td>
                        );
                      }
                      return (
                        <td key={m.eventId} className={`${cls}${winCls}`} title={hotEvents.has(m.eventId) ? `${title} — in form` : title}>
                          <span className="cell-wrap"><span>{hotEvents.has(m.eventId) ? "🔥" : ""}{sym}</span><PtsPill pts={pts} /></span>
                        </td>
                      );
                    })}
                    {upcoming.map((m) => {
                      const absence = getAbsence(data, m.eventId, pid);
                      return (
                        <td key={m.eventId} className="upcoming-col cell-click"
                          title={absence ? absence.note : "click to mark out"}
                          onClick={() => setAbsEdit({ eventId: m.eventId, pid })}>
                          {absence ? "🚫" : "·"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
