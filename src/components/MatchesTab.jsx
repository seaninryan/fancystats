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

const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const places = (n) => `${num(Math.abs(n))} place${Math.abs(n) === 1 ? "" : "s"}`;
// Rounds before taking the sign so a delta of -0.004 reads "+0.00", not "-0.00".
const signed = (n, digits = 0) => {
  const r = Number(n.toFixed(digits)) + 0;
  return (r >= 0 ? "+" : "") + r.toFixed(digits);
};

// The chip face: a signed delta from this side's own point of view, so the two
// sides of a fixture mirror each other. Never "+0" — level is level — and never
// "+5.0" where "+5" is the truth.
const deltaLabel = (d) => {
  if (d == null) return "—";
  const r = Number(d.toFixed(1)) + 0;
  return r === 0 ? "0" : (r > 0 ? "+" : "-") + num(Math.abs(r));
};

// Tint straight from lib's verdict on who leads the metric: +1 leads, -1 trails,
// 0 level or no data. Never re-derive a direction here — a locally computed
// polarity can disagree with the score the 🎯 tag was graded from.
const leadCls = (lead) => (lead > 0 ? " cmp-up" : lead < 0 ? " cmp-down" : "");

const rankWords = (d, levelWords) => (d === 0 ? levelWords : `${places(d)} ${d > 0 ? "better" : "worse"}`);

// Level-or-not comes from the *scored* ranks, so "level" means what the colour
// means; the size of the gap comes from the *displayed* ranks, so the arithmetic
// matches the two positions in the tooltip. (Clubs the table cannot separate
// share a scored rank while still showing distinct dense positions — quoting the
// scored gap there would claim two places between a 2nd and a 3rd.) Order agrees
// whenever the scored gap is non-zero, so this delta never fights the tint.
const posDelta = (side, opp) => (side.scored.pos === opp.scored.pos ? 0 : opp.pos - side.pos);

const posTitle = (side, opp, oppName, d) =>
  `position: ${ord(side.pos)} of ${side.teamCount} v ${oppName} ${ord(opp.pos)} of ${opp.teamCount}`
  + ` — ${rankWords(d, "level on the table's tiebreakers")}`;

const gamesClause = (side, opp, oppName) => {
  const d = opp.played - side.played;
  return d === 0
    ? `both have played ${plural(side.played, "game")}`
    : `${oppName} have played ${plural(Math.abs(d), "game")} ${d > 0 ? "more" : "fewer"}`;
};

// The points and fantasy chips show a TOTAL while their tint follows lib's
// per-game verdict, and with unequal games played those two genuinely point
// opposite ways. State both, and when they disagree say why: a dimmed "+2" is
// honest only if the tooltip owns the dimming.
const bothWays = (tot, pg, pgDigits, lead, side, opp, oppName) => {
  if (tot === 0 && pg === 0) return "level";
  const t = tot === 0 ? "level on the total" : `${signed(tot)} total`;
  const p = pg === 0 ? "level per game" : `${signed(pg, pgDigits)}/game`;
  return Math.sign(tot) === lead
    ? `${t}, ${p}`
    : `${t} but ${p}; ${gamesClause(side, opp, oppName)}`;
};

const pointsTitle = (side, opp, oppName) =>
  `league points: ${side.points} from ${plural(side.played, "game")} (${side.ppg.toFixed(2)}/game)`
  + ` v ${oppName} ${opp.points} from ${plural(opp.played, "game")} (${opp.ppg.toFixed(2)}/game)`
  + ` — ${bothWays(side.points - opp.points, Number((side.ppg - opp.ppg).toFixed(2)), 2,
      side.lead.points, side, opp, oppName)}`;

const formPhrase = (n, window) =>
  n == null ? `unranked over last ${window}` : `${ord(n)} over last ${window}`;

// Mean of the two window gaps, in displayed places for the same reason position
// is. A window where the clubs share a scored rank, or where either club is
// unranked, contributes no gap — exactly what the score did with it. Null (both
// windows unusable) is mirrored on both sides, so neither chip claims a gap the
// other cannot see.
const formDelta = (side, opp) => {
  const gap = (mine, theirs, sMine, sTheirs) =>
    mine == null || theirs == null ? null : sMine === sTheirs ? 0 : theirs - mine;
  const g3 = gap(side.form3, opp.form3, side.scored.form3, opp.scored.form3);
  const g5 = gap(side.form5, opp.form5, side.scored.form5, opp.scored.form5);
  return g3 == null && g5 == null ? null : ((g3 ?? 0) + (g5 ?? 0)) / 2;
};

// Says the data is missing rather than implying a rank the club does not have.
const formTitle = (side, opp, oppName, d) => {
  const mine = side.form3 == null && side.form5 == null
    ? "form: no ranked matches in the last 3 or 5"
    : `form: ${formPhrase(side.form3, 3)}, ${formPhrase(side.form5, 5)}`;
  const head = `${mine} v ${oppName} ${ord(opp.form3)} / ${ord(opp.form5)}`;
  if (d == null) return head;
  const tail = `${rankWords(d, "level")} on average`;
  // Each window is scored against its own table's size, so a shorter last-3
  // table can outweigh the last-5 gap and tint against the plain mean.
  return Math.sign(d) === side.lead.form
    ? `${head} — ${tail}`
    : `${head} — ${tail}, but the two windows disagree and each is weighted against its own table's size`;
};

// leagueTable only accrues fantasy points for players with a gamePosition, so a
// zero total is a data gap, not a weakness: lib suppresses the metric for the
// whole fixture and both chips go neutral. Name WHOSE gap it is — the other club
// may have a real total of its own on screen, and telling its owner "nothing
// recorded yet" beside a chip reading 612 is nonsense.
const NO_FANTASY = "no fantasy points recorded yet (needs positions set)";
const fantasyTitle = (side, opp, oppName, covered) => {
  const mine = `fantasy points: ${side.fantasy} (${side.fpg.toFixed(1)}/game)`;
  if (!covered) {
    return side.fantasy === 0 ? NO_FANTASY : `${mine} — not compared: ${oppName} have ${NO_FANTASY}`;
  }
  return `${mine} v ${oppName} ${opp.fantasy} (${opp.fpg.toFixed(1)}/game)`
    + ` — ${bothWays(side.fantasy - opp.fantasy, Number((side.fpg - opp.fpg).toFixed(1)), 1,
        side.lead.fantasy, side, opp, oppName)}`;
};

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

// One side's four chips, plus the 🎯 tag when this is the favoured club — first
// on the home side, last on the away side, so it always sits beside its own club
// name. Every chip is a signed delta from this side's view, so the two groups
// mirror; the tint is always lib's `lead`, never the sign on the chip face.
function SideChips({ side, opp, oppName, covered, tag, tagTitle, tagFirst }) {
  const pos = posDelta(side, opp);
  const form = formDelta(side, opp);
  const fantasy = covered ? side.fantasy - opp.fantasy : null;
  const tagEl = tag ? <span className="chip cmp-tag" title={tagTitle}>{tag}</span> : null;
  return (
    <span className="cmp-chips">
      {tagFirst && tagEl}
      <span className={`chip${leadCls(side.lead.pos)}`} title={posTitle(side, opp, oppName, pos)}>
        pos {deltaLabel(pos)}
      </span>
      <span className={`chip${leadCls(side.lead.points)}`} title={pointsTitle(side, opp, oppName)}>
        pts {deltaLabel(side.points - opp.points)}
      </span>
      <span className={`chip${leadCls(side.lead.form)}`} title={formTitle(side, opp, oppName, form)}>
        form {deltaLabel(form)}
      </span>
      <span className={`chip${leadCls(side.lead.fantasy)}`} title={fantasyTitle(side, opp, oppName, covered)}>
        fpts {deltaLabel(fantasy)}
      </span>
      {!tagFirst && tagEl}
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
            <div key={m.eventId} className="card fixture">
              <span className="fx-side fx-home">
                <TeamLink team={data.teams[m.homeTeamId]} teamId={m.homeTeamId} openTeam={openTeam} />
                {teamPts.has(m.eventId) && <PtsPill pts={teamPts.get(m.eventId).home} />}
                {cmp && <SideChips side={cmp.home} opp={cmp.away} oppName={awayName} covered={cmp.fantasyCovered}
                  tag={favHome ? cmp.favoured.tag : null} tagTitle={tagTitle} tagFirst />}
              </span>
              <span className="fx-score">{m.homeScore ?? ""}–{m.awayScore ?? ""}</span>
              <span className="fx-side fx-away">
                {cmp && <SideChips side={cmp.away} opp={cmp.home} oppName={homeName} covered={cmp.fantasyCovered}
                  tag={favAway ? cmp.favoured.tag : null} tagTitle={tagTitle} />}
                {teamPts.has(m.eventId) && <PtsPill pts={teamPts.get(m.eventId).away} />}
                <TeamLink team={data.teams[m.awayTeamId]} teamId={m.awayTeamId} openTeam={openTeam} />
              </span>
              <span className="fx-meta">
                <span className="dim">{fmtDate(m.kickoff)}</span>
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}>⚠R{suspects.get(m.eventId)}?</span>
                )}
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
                <span className="fx-status">
                  {gone(m) ? <span className="dim">postponed</span>
                    : m.status !== "finished" ? <span className="dim">upcoming</span>
                    : m.importedAt && m.partial ? <span className="banner warn" style={{ margin: 0 }}>no lineups — re-run import</span>
                    : m.importedAt ? <span style={{ color: "var(--accent)" }}>✓</span>
                    : <span className="dim">not imported</span>}
                </span>
              </span>
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
