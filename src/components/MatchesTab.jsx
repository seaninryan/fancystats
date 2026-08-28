import { useEffect, useMemo, useRef } from "react";
import { matchRound, setMatchRound, isSupersededPostponed, roundSuspects, allMatchTeamPoints } from "../lib/store.js";
import { fixtureContext, compareFixture } from "../lib/fixtures.js";
import { TeamPill, PtsPill } from "./Pills.jsx";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

// long name on desktop, short code on phones (CSS picks one)
const teamLabel = (t) => (
  <>
    <span className="gt-sm">{t?.name ?? "?"}</span>
    <span className="lt-sm">{t?.shortName ?? "?"}</span>
  </>
);

const ORD = ["th", "st", "nd", "rd"];
const ord = (n) => {
  if (n == null) return "—";
  const v = n % 100;
  return `${n}${ORD[(v - 20) % 10] || ORD[v] || ORD[0]}`;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const signed = (n, digits = 0) => (n >= 0 ? "+" : "") + n.toFixed(digits);

// Green when this side leads the metric, dimmed when it trails, plain when level.
const cmpCls = (mine, theirs, lowerIsBetter = false) => {
  if (mine === theirs) return "";
  const better = lowerIsBetter ? mine < theirs : mine > theirs;
  return better ? " cmp-up" : " cmp-down";
};

const gapWords = (mine, theirs, oppName) => {
  const d = theirs - mine; // positions: lower is better
  if (d === 0) return `level with ${oppName}`;
  return `${plural(Math.abs(d), "place")} ${d > 0 ? "better" : "worse"} than ${oppName}`;
};

// Level clubs read as "level with X" rather than a bare "+0".
const deltaWords = (mine, theirs, oppName, digits = 0) =>
  mine === theirs ? `level with ${oppName}` : `${signed(mine - theirs, digits)} vs ${oppName}`;

// Team pill that navigates to the club on the Teams tab.
function TeamLink({ team, teamId, openTeam }) {
  return (
    <a role="link" tabIndex={0} title={`${team?.name ?? "team"} — open on the Teams tab`}
      style={{ cursor: "pointer", textDecoration: "underline dotted" }}
      onClick={() => openTeam?.(String(teamId))}
      onKeyDown={(e) => e.key === "Enter" && openTeam?.(String(teamId))}>
      <TeamPill team={team} label={teamLabel(team)} />
    </a>
  );
}

// One side's four chips, plus the 🎯 tag when this is the favoured club.
function SideChips({ side, opp, oppName, tag, tagTitle }) {
  return (
    <span className="cmp-chips">
      {tag && <span className="chip cmp-tag" title={tagTitle}>{tag}</span>}
      <span className={`chip${cmpCls(side.pos, opp.pos, true)}`}
        title={`league position ${ord(side.pos)} of ${side.teamCount} — ${gapWords(side.pos, opp.pos, oppName)}`}>
        {ord(side.pos)}
      </span>
      <span className={`chip${cmpCls(side.points, opp.points)}`}
        title={`${plural(side.points, "pt")} from ${plural(side.played, "game")} (${side.ppg.toFixed(2)}/game) — ${deltaWords(side.points, opp.points, oppName)}`}>
        {side.points}
      </span>
      <span className={`chip${cmpCls((side.form3 + side.form5) / 2, (opp.form3 + opp.form5) / 2, true)}`}
        title={`form: ${ord(side.form3)} over last 3, ${ord(side.form5)} over last 5 (${oppName} ${ord(opp.form3)} / ${ord(opp.form5)})`}>
        F {side.form3}/{side.form5}
      </span>
      <span className={`chip${cmpCls(side.fantasy, opp.fantasy)}`}
        title={`${side.fantasy} fantasy pts (${side.fpg.toFixed(1)}/game) — ${deltaWords(side.fantasy, opp.fantasy, oppName)}`}>
        {side.fantasy}F
      </span>
    </span>
  );
}

export default function MatchesTab({ data, update, openTeam }) {
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
  const ctx = useMemo(() => fixtureContext(data), [data]);
  // Comparison is for fixtures still to be played; a result speaks for itself.
  const cmpFor = (m) => (!gone(m) && m.status !== "finished" ? compareFixture(ctx, m) : null);

  return (
    <div>
      {matches.length === 0 && <p className="dim">No matches yet — run the console import on the ⚙ Settings tab.</p>}
      {rounds.map(({ round, items }) => (
        <section
          key={round ?? "none"}
          ref={round === currentRound ? currentRef : null}
          style={{ scrollMarginTop: 56 }}
        >
          <h3>Round {round ?? "?"} <span className="dim">— {fmtDate(items[0].kickoff)}</span></h3>
          {items.map((m) => {
            const cmp = cmpFor(m);
            const homeName = data.teams[m.homeTeamId]?.shortName ?? "?";
            const awayName = data.teams[m.awayTeamId]?.shortName ?? "?";
            const tagTitle = cmp?.favoured
              ? `favourable for ${data.teams[cmp.favoured.teamId]?.shortName ?? "?"} (${cmp.favoured.grade}): ${cmp.favoured.reasons.join(", ")}`
              : "";
            const favHome = cmp?.favoured && cmp.favoured.teamId === cmp.home.teamId;
            const favAway = cmp?.favoured && cmp.favoured.teamId === cmp.away.teamId;
            return (
            <div key={m.eventId} className="card row">
              <span style={{ flex: 1 }}>
                <TeamLink team={data.teams[m.homeTeamId]} teamId={m.homeTeamId} openTeam={openTeam} />
                {teamPts.has(m.eventId) && <> <PtsPill pts={teamPts.get(m.eventId).home} /></>}
                {cmp && <> <SideChips side={cmp.home} opp={cmp.away} oppName={awayName}
                  tag={favHome ? cmp.favoured.tag : null} tagTitle={tagTitle} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {cmp && <><SideChips side={cmp.away} opp={cmp.home} oppName={homeName}
                  tag={favAway ? cmp.favoured.tag : null} tagTitle={tagTitle} /> </>}
                {teamPts.has(m.eventId) && <><PtsPill pts={teamPts.get(m.eventId).away} /> </>}
                <TeamLink team={data.teams[m.awayTeamId]} teamId={m.awayTeamId} openTeam={openTeam} />
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
          );})}
        </section>
      ))}
      {hiddenShells > 0 && (
        <p className="dim">{hiddenShells} postponed duplicate{hiddenShells > 1 ? "s" : ""} hidden (rescheduled by SofaScore).</p>
      )}
    </div>
  );
}
