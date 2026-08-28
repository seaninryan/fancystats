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
// A rank can be absent — a club drops out of a form table when its recent
// imported matches all have null scores — and "—" is the spec's rendering.
const ord = (n) => {
  if (n == null) return "—";
  const v = n % 100;
  return `${n}${ORD[(v - 20) % 10] || ORD[v] || ORD[0]}`;
};

const rankLabel = (n) => (n == null ? "—" : n);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Rounds before taking the sign so a delta of -0.004 reads "+0.00", not "-0.00".
const signed = (n, digits = 0) => {
  const r = Number(n.toFixed(digits)) + 0;
  return (r >= 0 ? "+" : "") + r.toFixed(digits);
};

// Tint straight from lib's verdict on who leads the metric: +1 leads, -1 trails,
// 0 level or no data. Never re-derive a direction here — a locally computed
// polarity can disagree with the score the 🎯 tag was graded from.
const leadCls = (lead) => (lead > 0 ? " cmp-up" : lead < 0 ? " cmp-down" : "");

// Position wording reads off the *scored* ranks, which is what the tint came
// from: two clubs the table cannot separate share a scored rank while their
// displayed positions differ, and "level" has to mean what the colour means.
const posWords = (side, opp, oppName) => {
  const d = opp.scored.pos - side.scored.pos; // a lower position is better
  if (d === 0) return `level with ${oppName} on the table's tiebreakers`;
  return `${plural(Math.abs(d), "place")} ${d > 0 ? "better" : "worse"} than ${oppName}`;
};

// "+0" is never the truth about two level clubs.
const deltaWords = (mine, theirs, oppName, digits = 0, suffix = "") => {
  const d = Number((mine - theirs).toFixed(digits));
  return d === 0 ? `level with ${oppName}` : `${signed(d, digits)}${suffix} vs ${oppName}`;
};

const formPhrase = (n, window) =>
  n == null ? `unranked over last ${window}` : `${ord(n)} over last ${window}`;

// Says the data is missing rather than implying a rank the club does not have.
const formTitle = (side, opp, oppName) => {
  const mine = side.form3 == null && side.form5 == null
    ? "form: no ranked matches in the last 3 or 5"
    : `form: ${formPhrase(side.form3, 3)}, ${formPhrase(side.form5, 5)}`;
  return `${mine} (${oppName} ${ord(opp.form3)} / ${ord(opp.form5)})`;
};

// leagueTable only accrues fantasy points for players with a gamePosition, so a
// zero total is a data gap, not a weakness: lib suppresses the metric and both
// chips go neutral, so the tooltip must not present 0 as a real value.
const fantasyTitle = (side, opp, oppName, covered) =>
  covered
    ? `${side.fantasy} fantasy pts (${side.fpg.toFixed(1)}/game) — ${deltaWords(side.fpg, opp.fpg, oppName, 1, "/game")}`
    : "no fantasy points recorded yet (needs positions set)";

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
// Values are lib's; the only job here is wording and tint.
function SideChips({ side, opp, oppName, covered, tag, tagTitle }) {
  return (
    <span className="cmp-chips">
      {tag && <span className="chip cmp-tag" title={tagTitle}>{tag}</span>}
      <span className={`chip${leadCls(side.lead.pos)}`}
        title={`league position ${ord(side.pos)} of ${side.teamCount} — ${posWords(side, opp, oppName)}`}>
        {ord(side.pos)}
      </span>
      <span className={`chip${leadCls(side.lead.points)}`}
        title={`${side.ppg.toFixed(2)} pts/game — ${deltaWords(side.ppg, opp.ppg, oppName, 2, "/game")}; ${plural(side.points, "pt")} from ${plural(side.played, "game")}`}>
        {side.points}
      </span>
      <span className={`chip${leadCls(side.lead.form)}`} title={formTitle(side, opp, oppName)}>
        F {rankLabel(side.form3)}/{rankLabel(side.form5)}
      </span>
      <span className={`chip${leadCls(side.lead.fantasy)}`} title={fantasyTitle(side, opp, oppName, covered)}>
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
                {cmp && <> <SideChips side={cmp.home} opp={cmp.away} oppName={awayName} covered={cmp.fantasyCovered}
                  tag={favHome ? cmp.favoured.tag : null} tagTitle={tagTitle} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {cmp && <><SideChips side={cmp.away} opp={cmp.home} oppName={homeName} covered={cmp.fantasyCovered}
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
