import { useEffect, useMemo, useRef } from "react";
import { upsertMatchStubs, applyImport, matchRound, setMatchRound, isSupersededPostponed, roundSuspects, allMatchTeamPoints } from "../lib/store.js";
import { TeamPill, PtsPill } from "./Pills.jsx";
import ConsoleImport from "./ConsoleImport.jsx";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

// long name on desktop, short code on phones (CSS picks one)
const teamLabel = (t) => (
  <>
    <span className="gt-sm">{t?.name ?? "?"}</span>
    <span className="lt-sm">{t?.shortName ?? "?"}</span>
  </>
);

export default function MatchesTab({ data, update }) {
  const currentRef = useRef(null);

  const all = Object.values(data.matches);
  const hiddenShells = all.filter((m) => isSupersededPostponed(data, m)).length;
  const matches = all.filter((m) => !isSupersededPostponed(data, m));
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

  const suspects = roundSuspects(data);
  const teamPts = useMemo(() => allMatchTeamPoints(data), [data]);

  return (
    <div>
      <ConsoleImport data={data} update={update} />
      {matches.length === 0 && <p className="dim">No matches yet — run the console import above.</p>}
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
                <TeamPill team={data.teams[m.homeTeamId]} label={teamLabel(data.teams[m.homeTeamId])} />
                {teamPts.has(m.eventId) && <> <PtsPill pts={teamPts.get(m.eventId).home} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {teamPts.has(m.eventId) && <><PtsPill pts={teamPts.get(m.eventId).away} /> </>}
                <TeamPill team={data.teams[m.awayTeamId]} label={teamLabel(data.teams[m.awayTeamId])} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}> ⚠R{suspects.get(m.eventId)}?</span>
                )}
              </span>
              <select
                title="Move to another round"
                value={m.roundOverride ?? ""}
                onChange={(e) => moveMatch(m.eventId, e.target.value)}
              >
                <option value="">R{m.round ?? "?"}</option>
                {allRounds.filter((r) => r !== m.round).map((r) => (
                  <option key={r} value={r}>→ R{r}</option>
                ))}
              </select>
              {gone(m) ? <span className="dim">postponed</span>
                : m.status !== "finished" ? <span className="dim">upcoming</span>
                : m.importedAt && m.partial ? <span className="banner warn" style={{ margin: 0 }}>no lineups — re-run import</span>
                : m.importedAt ? <span style={{ color: "var(--accent)" }}>✓</span>
                : <span className="dim">not imported</span>}
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
