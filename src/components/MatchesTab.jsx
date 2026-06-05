import { useEffect, useRef, useState } from "react";
import { fetchSeasonEvents, importMatch, sleep } from "../lib/sofascore.js";
import { upsertMatchStubs, applyImport, matchRound, setMatchRound, isSupersededPostponed } from "../lib/store.js";
import { TeamPill } from "./Pills.jsx";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

export default function MatchesTab({ data, update }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const currentRef = useRef(null);

  const sync = async () => {
    setBusy("Checking for matches…"); setError(null);
    try {
      const { stubs, teams } = await fetchSeasonEvents(data.meta);
      const now = Date.now();
      update((d) => {
        const next = upsertMatchStubs(d, stubs, teams);
        next.meta = { ...next.meta, lastEventSync: now };
        return next;
      });
    } catch (e) { setError(`Sync failed: ${e.message}`); }
    setBusy(null);
  };

  const runImport = async (eventIds) => {
    setError(null);
    const results = [];
    for (let i = 0; i < eventIds.length; i++) {
      setBusy(`Importing ${i + 1}/${eventIds.length}…`);
      try { results.push(await importMatch(eventIds[i])); }
      catch (e) { setError(`Stopped at match ${eventIds[i]}: ${e.message}. Imported ${results.length} before failing.`); break; }
      if (i < eventIds.length - 1) await sleep(300);
    }
    if (results.length) {
      const now = Date.now();
      update((d) => results.reduce((acc, r) => applyImport(acc, r, now), d));
    }
    setBusy(null);
  };

  const all = Object.values(data.matches);
  const hiddenShells = all.filter((m) => isSupersededPostponed(data, m)).length;
  const matches = all.filter((m) => !isSupersededPostponed(data, m));
  const missing = matches.filter((m) => m.status === "finished" && !m.importedAt);
  const gone = (m) => m.status === "postponed" || m.status === "canceled";
  const todo = (m) => !gone(m) && ((m.status === "finished" && !m.importedAt) || m.status === "notstarted");

  // True group-by-round (overrides included), newest round first, kickoff order within.
  const byRound = new Map();
  for (const m of matches) {
    const r = matchRound(m);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const rounds = [...byRound.entries()]
    .map(([round, items]) => ({ round, items: items.sort((a, b) => a.kickoff - b.kickoff) }))
    .sort((a, b) => (b.round ?? -1) - (a.round ?? -1));
  const allRounds = rounds.map((r) => r.round).filter((r) => r != null).sort((a, b) => a - b);
  // Current gameweek = earliest round that still has something to do.
  const currentRound = rounds.length
    ? Math.min(...rounds.filter((r) => r.items.some(todo)).map((r) => r.round ?? Infinity))
    : null;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, []); // on mount only — jump to the current gameweek

  const moveMatch = (eventId, value) =>
    update((d) => setMatchRound(d, eventId, value === "" ? null : Number(value)));

  return (
    <div>
      <div className="card row">
        <button onClick={sync} disabled={!!busy}>⟳ Check for new matches</button>
        {missing.length > 0 && (
          <button className="primary" disabled={!!busy} onClick={() => runImport(missing.map((m) => m.eventId))}>
            Import all missing ({missing.length})
          </button>
        )}
        {busy && <span className="dim">{busy}</span>}
        {data.meta.lastEventSync && !busy && (
          <span className="dim">synced {fmtDate(data.meta.lastEventSync)}</span>
        )}
      </div>
      {error && <div className="banner err">{error}</div>}
      {matches.length === 0 && <p className="dim">No matches yet — tap "Check for new matches".</p>}
      {rounds.map(({ round, items }) => (
        <section
          key={round ?? "none"}
          ref={round === currentRound ? currentRef : null}
          style={{ scrollMarginTop: 56 }}
        >
          <h3>Round {round ?? "?"} <span className="dim">— {fmtDate(items[0].kickoff)}</span></h3>
          {items.map((m) => (
            <div key={m.eventId} className="card row">
              <span style={{ flex: 1 }}>
                <TeamPill team={data.teams[m.homeTeamId]} /> {m.homeScore ?? ""}–{m.awayScore ?? ""} <TeamPill team={data.teams[m.awayTeamId]} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
              </span>
              <select
                title="Move to another round"
                value={m.roundOverride ?? ""}
                onChange={(e) => moveMatch(m.eventId, e.target.value)}
                disabled={!!busy}
              >
                <option value="">R{m.round ?? "?"}</option>
                {allRounds.filter((r) => r !== m.round).map((r) => (
                  <option key={r} value={r}>→ R{r}</option>
                ))}
              </select>
              {gone(m) ? <span className="dim">postponed</span>
                : m.status !== "finished" ? <span className="dim">upcoming</span>
                : m.importedAt && m.partial ? (
                  <span className="row">
                    <span className="banner warn" style={{ margin: 0 }}>no lineups</span>
                    <button disabled={!!busy} onClick={() => runImport([m.eventId])}>Retry</button>
                  </span>
                )
                : m.importedAt ? <span style={{ color: "var(--accent)" }}>✓</span>
                : <button className="primary" disabled={!!busy} onClick={() => runImport([m.eventId])}>Import</button>}
            </div>
          ))}
        </section>
      ))}
      {hiddenShells > 0 && (
        <p className="dim">{hiddenShells} postponed duplicate{hiddenShells > 1 ? "s" : ""} hidden (rescheduled by SofaScore).</p>
      )}
    </div>
  );
}
