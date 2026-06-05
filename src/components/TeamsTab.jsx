import { useState } from "react";
import { matchRound, setPlayerField, activeFlag, playerName, missingFantasyData, markOut, clearOut, setTeamColor } from "../lib/store.js";
import { scoreAppearance } from "../lib/scoring.js";
import { teamColor } from "../lib/teamColors.js";
import { TeamPill, PosPill } from "./Pills.jsx";

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

const TOTAL_COLS = [["minutes", "Min"], ["goals", "G"], ["assists", "A"], ["points", "Pts"]];

function OutEditor({ out, onClose, onMark, onClear }) {
  const [note, setNote] = useState(out?.note || "");
  const [weeks, setWeeks] = useState("");
  return (
    <div className="row" style={{ marginTop: 4 }}>
      {out ? (
        <>
          <span className="dim">{out.note || "out"}{out.until ? ` (until ${new Date(out.until).toLocaleDateString("en-IE")})` : ""}</span>
          <button onClick={onClear}>Back available</button>
        </>
      ) : (
        <>
          <input placeholder="injured / suspended / away…" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 150 }} />
          <input type="number" min="1" max="40" placeholder="wks" title="weeks out (blank = indefinite)"
            value={weeks} onChange={(e) => setWeeks(e.target.value)} style={{ width: 55 }} />
          <button className="primary" onClick={() => onMark(note, Number(weeks) || 0)}>Save</button>
        </>
      )}
      <button onClick={onClose}>✕</button>
    </div>
  );
}

export default function TeamsTab({ data, update, openPlayer }) {
  const teamIds = Object.keys(data.teams)
    .sort((a, b) => data.teams[a].name.localeCompare(data.teams[b].name));
  const [teamId, setTeamId] = useState(teamIds[0] || null);
  const [win, setWin] = useState("all"); // "all" | 3 | 5
  const [sort, setSort] = useState({ key: "apps", dir: -1 });
  const [outEdit, setOutEdit] = useState(null); // pid being edited
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;

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
    if (!totals.has(a.playerId)) totals.set(a.playerId, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null });
    const t = totals.get(a.playerId);
    t.apps++; // all-time, used for default row order
    if (!windowIds.has(a.eventId)) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const g = (a.goals || 0) + (typeof adj?.goals === "number" ? adj.goals : 0);
    const as = (a.assists || 0) + (typeof adj?.assists === "number" ? adj.assists : 0);
    t.minutes += (a.minutes || 0) + (typeof adj?.minutes === "number" ? adj.minutes : 0);
    t.goals += Math.max(0, g);
    t.assists += Math.max(0, as);
    const p = data.players[a.playerId];
    const m = data.matches[a.eventId];
    if (p?.gamePosition && m?.goalTimes) {
      t.points = (t.points ?? 0) + scoreAppearance(a, m, p.gamePosition, adj).total;
    }
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
          key={selected}
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
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table className="sticky-col">
            <thead><tr>
              <th onClick={() => setSort({ key: "apps", dir: -1 })}>Player</th>
              <th>Pos</th>
              {TOTAL_COLS.map(([key, label]) => (
                <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
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
              {upcoming.map((m) => {
                const home = String(m.homeTeamId) === selected;
                return (
                  <th key={m.eventId} className="upcoming-col" title={fmtD(m.kickoff)}>
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
                const out = activeFlag(p, now);
                const err = missingFantasyData(p, apps.filter((x) => x.playerId === pid));
                return (
                  <tr key={pid}>
                    <td>
                      <button className={`mini-toggle ${p?.starred ? "" : "off"}`} aria-pressed={!!p?.starred} title="watchlist"
                        onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
                      <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} aria-pressed={!!p?.inSquad} title="in my squad"
                        onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
                      <button className={`mini-toggle ${out ? "" : "off"}`} aria-pressed={!!out}
                        title={out ? `out: ${out.note}` : "mark out"}
                        onClick={() => setOutEdit(outEdit === pid ? null : pid)}>🚫</button>
                      {" "}<a role="link" tabIndex={0} style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                        onClick={() => openPlayer(String(pid))}
                        onKeyDown={(e) => e.key === "Enter" && openPlayer(String(pid))}>
                        {playerName(p) || pid}
                      </a>
                      {outEdit === pid && (
                        <OutEditor out={out} onClose={() => setOutEdit(null)}
                          onMark={(note, weeks) => {
                            const now = Date.now();
                            const until = weeks ? now + weeks * 7 * 86400000 : null;
                            update((d) => markOut(d, pid, note, now, until));
                            setOutEdit(null);
                          }}
                          onClear={() => {
                            const now = Date.now();
                            update((d) => clearOut(d, pid, now));
                            setOutEdit(null);
                          }} />
                      )}
                    </td>
                    <td><PosPill pos={p?.gamePosition} /></td>
                    <td>{t.minutes}</td><td>{t.goals}</td><td>{t.assists}</td>
                    <td className={err ? "err-cell" : ""} title={err ? "No fantasy data — set a position or add their fantasyloi alias in the player view" : ""}>{err ? "❗" : t.points ?? "—"}</td>
                    {matches.map((m) => {
                      const key = `${m.eventId}:${pid}`;
                      const a = byPlayerMatch.get(key);
                      const adj = data.adjustments[key];
                      const { sym, cls, title } = cellFor(a, adj);
                      const pts = a && data.players[pid]?.gamePosition && m.goalTimes
                        ? scoreAppearance(a, m, data.players[pid].gamePosition, adj).total : null;
                      return (
                        <td key={m.eventId}
                          className={`${cls}${windowIds.has(m.eventId) && win !== "all" ? " win-col" : ""}`}
                          title={title}>
                          {sym}{a ? <span className="dim"> {pts ?? "·"}</span> : ""}
                        </td>
                      );
                    })}
                    {upcoming.map((m) => (
                      <td key={m.eventId} className="upcoming-col"
                        title={out && (out.until == null || m.kickoff < out.until) ? out.note || "out" : ""}>
                        {out && (out.until == null || m.kickoff < out.until) ? "🚫" : "·"}
                      </td>
                    ))}
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
