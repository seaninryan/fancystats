// test/matchesTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MatchesTab from "../src/components/MatchesTab.jsx";
import { emptyData, applyImport, upsertMatchStubs, setPlayerField } from "../src/lib/store.js";

const NOW = 1765000000000;
const DAY = 86400000;
const ago = (days) => NOW - days * DAY;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
];
const WITH_DERRY = [...TEAMS, { id: 3, name: "Derry City", shortName: "DER" }];

function app(eventId, playerId, teamId, goals) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// Built through real store operations, per project convention. hs/as null models
// an imported-but-unplayed event, exactly what sofascore normalize() produces —
// leagueTable skips it, so a club whose recent imports are all null-scored drops
// out of the form tables while staying in the all-time one.
function seed(results) {
  let d = emptyData();
  for (const r of results) {
    d = applyImport(d, {
      match: {
        eventId: r.eventId, round: r.round, kickoff: r.kickoff, status: "finished",
        homeTeamId: r.home, awayTeamId: r.away, homeScore: r.hs, awayScore: r.as,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [{ id: 11, name: "P1", teamId: 1 }, { id: 12, name: "P2", teamId: 2 }],
      appearances: [
        app(r.eventId, 11, 1, (r.home === 1 ? r.hs : r.as) ?? 0),
        app(r.eventId, 12, 2, (r.home === 2 ? r.hs : r.as) ?? 0),
      ],
    }, NOW);
  }
  return d;
}

const fixture = (d, stub, teams = TEAMS) => upsertMatchStubs(d, [{
  eventId: 900, round: 3, kickoff: NOW + DAY, status: "notstarted",
  homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null, ...stub,
}], teams);

// SHE beat BOH twice: 1st v 2nd, 6 points v 0, top of both form windows. Nobody
// has a gamePosition, so both fantasy totals are 0 and that metric is suppressed.
// score = 0.20 + 0.30 + 0.30 = 0.80 -> mismatch.
const seeded = () => fixture(seed([
  { eventId: 101, round: 1, kickoff: ago(3), home: 1, away: 2, hs: 3, as: 0 },
  { eventId: 102, round: 2, kickoff: ago(2), home: 2, away: 1, hs: 0, as: 2 },
]));

// Two 1-1 draws: dead level on every metric the table can measure, so every
// chip is neutral and there is no tag — but the dense display positions still
// differ (1st and 2nd), which is the wording trap.
const levelPair = () => fixture(seed([
  { eventId: 401, round: 1, kickoff: ago(2), home: 1, away: 2, hs: 1, as: 1 },
  { eventId: 402, round: 2, kickoff: ago(1), home: 2, away: 1, hs: 1, as: 1 },
]));

// One scored match then five imported-but-unplayed events: both clubs are in the
// all-time table and in neither form table, so both form ranks are null.
const noFormRanks = () => fixture(seed([
  { eventId: 601, round: 1, kickoff: ago(9), home: 1, away: 2, hs: 1, as: 0 },
  { eventId: 602, round: 2, kickoff: ago(8), home: 1, away: 2, hs: null, as: null },
  { eventId: 603, round: 3, kickoff: ago(7), home: 1, away: 2, hs: null, as: null },
  { eventId: 604, round: 4, kickoff: ago(6), home: 1, away: 2, hs: null, as: null },
  { eventId: 605, round: 5, kickoff: ago(5), home: 1, away: 2, hs: null, as: null },
  { eventId: 606, round: 6, kickoff: ago(4), home: 1, away: 2, hs: null, as: null },
]), { round: 7 });

// Both clubs' scorers have a position, so both fantasy totals are non-zero and
// the fantasy metric is live.
const withFantasy = () => {
  let d = seed([
    { eventId: 101, round: 1, kickoff: ago(3), home: 1, away: 2, hs: 3, as: 0 },
    { eventId: 102, round: 2, kickoff: ago(2), home: 2, away: 1, hs: 0, as: 2 },
  ]);
  d = setPlayerField(d, 11, "gamePosition", "FWD");
  d = setPlayerField(d, 12, "gamePosition", "FWD");
  return fixture(d);
};

const render = (d) =>
  renderToStaticMarkup(<MatchesTab data={d} update={() => {}} openTeam={() => {}} />);

// One fixture row's inner markup. Rows contain no nested <div>, so the lazy match
// is exact; rounds render newest first, so rows[0] is the upcoming fixture.
const rows = (html) => [...html.matchAll(/<div class="card row">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

// The chips of each side, home group first. Chip spans never nest, so this pairs
// each group with its own closing tag rather than the row's.
const CHIP_GROUP = /<span class="cmp-chips">((?:<span[^>]*>[^<]*<\/span>)+)<\/span>/g;
const chipGroups = (rowHtml) => [...rowHtml.matchAll(CHIP_GROUP)].map((m) => m[1]);
const chipCount = (group) => group.match(/<span /g).length;

const upcoming = (d) => {
  const row = rows(render(d))[0];
  const [home, away] = chipGroups(row);
  return { row, home, away };
};

describe("MatchesTab fixture comparison", () => {
  it("gives each side its own group of four chips", () => {
    const { home, away } = upcoming(seeded());
    expect(chipCount(home)).toBe(5); // four chips plus the 🎯 tag
    expect(chipCount(away)).toBe(4);
    // Each group's tooltips name the *other* club, which is what identifies it.
    expect(home).toContain(">1st</span>");
    expect(home).toContain("1 place better than BOH");
    expect(away).toContain(">2nd</span>");
    expect(away).toContain("1 place worse than SHE");
  });

  it("tints the leading side and dims the trailing side, per metric", () => {
    const { home, away } = upcoming(seeded());
    expect(home).toContain('<span class="chip cmp-up" title="league position 1st of 2 — 1 place better than BOH">1st</span>');
    expect(home).toContain('<span class="chip cmp-up" title="3.00 pts/game — +3.00/game vs BOH; 6 pts from 2 games">6</span>');
    expect(home).toContain('<span class="chip cmp-up" title="form: 1st over last 3, 1st over last 5 (BOH 2nd / 2nd)">F 1/1</span>');

    expect(away).toContain('<span class="chip cmp-down" title="league position 2nd of 2 — 1 place worse than SHE">2nd</span>');
    expect(away).toContain('<span class="chip cmp-down" title="0.00 pts/game — -3.00/game vs SHE; 0 pts from 2 games">0</span>');
    expect(away).toContain('<span class="chip cmp-down" title="form: 2nd over last 3, 2nd over last 5 (SHE 1st / 1st)">F 2/2</span>');
  });

  it("tags the favoured club, and only that club, with its graded tooltip", () => {
    const { home, away } = upcoming(seeded());
    expect(home).toContain('<span class="chip cmp-tag" title="favourable for SHE (mismatch): position +1, points +3.00/game, form +1.0, fantasy —">🎯🎯🎯</span>');
    expect(away).not.toContain("🎯");
    expect(away).not.toContain("cmp-tag");
  });

  it("neither tints nor tags two clubs the table cannot separate", () => {
    const { row, home, away } = upcoming(levelPair());
    // Dense positions differ, so the wording has to say *why* they are level.
    // React escapes the apostrophe in the SSR output.
    expect(home).toContain('<span class="chip" title="league position 1st of 2 — level with BOH on the table&#x27;s tiebreakers">1st</span>');
    expect(away).toContain('<span class="chip" title="league position 2nd of 2 — level with SHE on the table&#x27;s tiebreakers">2nd</span>');
    expect(home).toContain('<span class="chip" title="1.00 pts/game — level with BOH; 2 pts from 2 games">2</span>');
    expect(row).not.toContain("cmp-up");
    expect(row).not.toContain("cmp-down");
    expect(row).not.toContain("🎯");
  });

  it("renders an absent form rank as — and says the data is missing", () => {
    const { home, away } = upcoming(noFormRanks());
    expect(home).toContain('title="form: no ranked matches in the last 3 or 5 (BOH — / —)">F —/—</span>');
    expect(away).toContain('title="form: no ranked matches in the last 3 or 5 (SHE — / —)">F —/—</span>');
    expect(home).not.toContain("F /");
    expect(home).not.toContain("null");
    // No rank on either side is no signal, so neither form chip is tinted.
    expect(home).toContain('<span class="chip" title="form: no ranked');
    expect(away).toContain('<span class="chip" title="form: no ranked');
  });

  it("calls a zero fantasy total missing data, not a value", () => {
    const { home, away } = upcoming(seeded());
    expect(home).toContain('<span class="chip" title="no fantasy points recorded yet (needs positions set)">0F</span>');
    expect(away).toContain('<span class="chip" title="no fantasy points recorded yet (needs positions set)">0F</span>');
  });

  it("compares fantasy per game once both clubs have points", () => {
    const { home, away } = upcoming(withFantasy());
    expect(home).toContain('<span class="chip cmp-up" title="30 fantasy pts (15.0/game) — +12.0/game vs BOH">30F</span>');
    expect(away).toContain('<span class="chip cmp-down" title="6 fantasy pts (3.0/game) — -12.0/game vs SHE">6F</span>');
    // The tag's own fantasy reason agrees with the chips.
    expect(home).toContain("fantasy +12.0/game");
  });

  it("omits the whole comparison when a club has no imported matches", () => {
    const d = upsertMatchStubs(seeded(), [{
      eventId: 901, round: 3, kickoff: NOW + 2 * DAY, status: "notstarted",
      homeTeamId: 1, awayTeamId: 3, homeScore: null, awayScore: null,
    }], WITH_DERRY);
    const [she_boh, she_der] = rows(render(d));
    expect(chipGroups(she_boh)).toHaveLength(2);
    expect(she_der).toContain("Derry City");
    expect(chipGroups(she_der)).toHaveLength(0);
    expect(she_der).not.toContain("cmp-chips");
    expect(she_der).not.toContain("🎯");
  });

  it("shows nothing on a postponed fixture", () => {
    const d = upsertMatchStubs(seeded(), [{
      eventId: 902, round: 4, kickoff: NOW + 3 * DAY, status: "postponed",
      homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null,
    }], TEAMS);
    const [off] = rows(render(d)); // round 4 sorts first
    expect(off).toContain("postponed");
    expect(chipGroups(off)).toHaveLength(0);
    expect(off).not.toContain("cmp-chips");
    expect(off).not.toContain("🎯");
  });

  it("shows nothing on a played fixture", () => {
    const played = rows(render(seeded()))[1]; // round 2, SHE won 2-0 away
    expect(played).toContain("0–2");
    expect(chipGroups(played)).toHaveLength(0);
    expect(played).not.toContain("cmp-chips");
  });

  it("renders both team names as links", () => {
    const { row } = upcoming(seeded());
    expect(row.match(/role="link"/g)).toHaveLength(2);
    expect(row).toContain('title="Shelbourne — open on the Teams tab"');
    expect(row).toContain('title="Bohemians — open on the Teams tab"');
  });

  it("survives an empty save", () => {
    expect(render(emptyData())).toContain("No matches yet");
  });
});

// SHE and BOH each beat DER 2-0: level on points, goal difference and goals for,
// so they share a *scored* rank while still showing dense 1st and 2nd. BOH v DER
// is then the wording trap — the scored gap is two ranks, the visible gap one
// place — and a tooltip quoting the scored gap claims two places between a 2nd
// and a 3rd, arithmetic the user can see is wrong.
const tieGroup = () => {
  let d = emptyData();
  for (const [eventId, round, days, winner] of [[701, 1, 4, 1], [702, 2, 3, 2]]) {
    d = applyImport(d, {
      match: {
        eventId, round, kickoff: ago(days), status: "finished",
        homeTeamId: winner, awayTeamId: 3, homeScore: 2, awayScore: 0,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: WITH_DERRY,
      players: [{ id: 10 + winner, name: `P${winner}`, teamId: winner }, { id: 13, name: "P3", teamId: 3 }],
      appearances: [app(eventId, 10 + winner, winner, 2), app(eventId, 13, 3, 0)],
    }, NOW);
  }
  return upsertMatchStubs(d, [{
    eventId: 900, round: 3, kickoff: NOW + DAY, status: "notstarted",
    homeTeamId: 2, awayTeamId: 3, homeScore: null, awayScore: null,
  }], WITH_DERRY);
};

// Only SHE's scorer has a position, so SHE have a real fantasy total and BOH read
// 0 — a data gap. lib suppresses the metric for the whole fixture, but SHE's chip
// still shows their real number, so it must not be labelled as missing data.
const oneSquadPositioned = () => fixture(setPlayerField(seed([
  { eventId: 101, round: 1, kickoff: ago(3), home: 1, away: 2, hs: 3, as: 0 },
  { eventId: 102, round: 2, kickoff: ago(2), home: 2, away: 1, hs: 0, as: 2 },
]), 11, "gamePosition", "FWD"));

describe("MatchesTab tooltips never contradict their own chip", () => {
  it("measures the position gap in the displayed places, not the scored ranks", () => {
    const { home, away, row } = upcoming(tieGroup());
    // The two chips on this row are 2nd and 3rd: one place apart, and both
    // tooltips must say one — the scored gap of two ranks is not on screen.
    expect(home).toContain('title="league position 2nd of 3 — 1 place better than DER">2nd</span>');
    expect(away).toContain('title="league position 3rd of 3 — 1 place worse than BOH">3rd</span>');
    expect(row).not.toContain("2 places");
    // The tag's breakdown quotes the same visible gap.
    expect(row).toContain("position +1");
    expect(row).not.toContain("position +2");
  });

  it("still calls a shared scored rank level, whatever the displayed positions", () => {
    const { home, away } = upcoming(levelPair());
    expect(home).toContain("level with BOH on the table&#x27;s tiebreakers");
    expect(away).toContain("level with SHE on the table&#x27;s tiebreakers");
    // Dense positions differ, so this is not the trivial case.
    expect(home).toContain(">1st</span>");
    expect(away).toContain(">2nd</span>");
  });

  it("blames the club that is actually missing fantasy data", () => {
    const { home, away } = upcoming(oneSquadPositioned());
    const MISSING = "no fantasy points recorded yet (needs positions set)";
    // BOH have nothing recorded: their own chip says so, and reads 0F.
    expect(away).toContain(`<span class="chip" title="${MISSING}">0F</span>`);
    // SHE have a real total. Naming it missing would contradict the chip.
    const she = home.match(/<span class="chip([^"]*)" title="([^"]*)">(\d+)F<\/span>/);
    expect(Number(she[3])).toBeGreaterThan(0);
    expect(she[2]).toBe(`${she[3]} fantasy pts (${(Number(she[3]) / 2).toFixed(1)}/game) — not compared: BOH have ${MISSING}`);
    // Suppressed means neutral on both sides, not a win for SHE.
    expect(she[1]).toBe("");
  });
});
