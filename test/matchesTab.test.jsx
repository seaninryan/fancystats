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
const FIVE = [...WITH_DERRY,
  { id: 4, name: "Sligo Rovers", shortName: "SLI" },
  { id: 5, name: "Galway United", shortName: "GAL" }];

function app(eventId, playerId, teamId, goals) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// Built through real store operations, per project convention. Each club gets one
// player, id = 10 + teamId. hs/as null models an imported-but-unplayed event,
// exactly what sofascore normalize() produces — leagueTable skips it, so a club
// whose recent imports are all null-scored drops out of the form tables while
// staying in the all-time one.
function seed(results, teams = TEAMS) {
  let d = emptyData();
  for (const r of results) {
    d = applyImport(d, {
      match: {
        eventId: r.eventId, round: r.round, kickoff: r.kickoff, status: "finished",
        homeTeamId: r.home, awayTeamId: r.away, homeScore: r.hs, awayScore: r.as,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams,
      players: [
        { id: 10 + r.home, name: `P${r.home}`, teamId: r.home },
        { id: 10 + r.away, name: `P${r.away}`, teamId: r.away },
      ],
      appearances: [
        app(r.eventId, 10 + r.home, r.home, r.hs ?? 0),
        app(r.eventId, 10 + r.away, r.away, r.as ?? 0),
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

// SHE take 6 points from 2 games, BOH 8 from 4: the TOTAL favours BOH while the
// per-game rate — which is what lib scores and tints on — favours SHE.
const unequalGames = () => fixture(seed([
  { eventId: 801, round: 1, kickoff: ago(8), home: 1, away: 3, hs: 2, as: 0 },
  { eventId: 802, round: 2, kickoff: ago(7), home: 1, away: 3, hs: 2, as: 0 },
  { eventId: 803, round: 3, kickoff: ago(6), home: 2, away: 3, hs: 2, as: 0 },
  { eventId: 804, round: 4, kickoff: ago(5), home: 2, away: 3, hs: 2, as: 0 },
  { eventId: 805, round: 5, kickoff: ago(4), home: 2, away: 3, hs: 1, as: 1 },
  { eventId: 806, round: 6, kickoff: ago(3), home: 2, away: 3, hs: 1, as: 1 },
], WITH_DERRY), { round: 7 }, WITH_DERRY);

// SHE and BOH each beat DER 2-0: level on points, goal difference and goals for,
// so they share a *scored* rank while still showing dense 1st and 2nd. BOH v DER
// is then the wording trap — the scored gap is two ranks, the visible gap one
// place — and a chip quoting the scored gap claims two places between a 2nd and
// a 3rd, arithmetic the user can see is wrong.
const tieGroup = () => fixture(seed([
  { eventId: 701, round: 1, kickoff: ago(4), home: 1, away: 3, hs: 2, as: 0 },
  { eventId: 702, round: 2, kickoff: ago(3), home: 2, away: 3, hs: 2, as: 0 },
], WITH_DERRY), { homeTeamId: 2, awayTeamId: 3 }, WITH_DERRY);

// SHE's only scored match is their oldest, so they drop out of the last-3 table
// but stay in the last-5 one: the two form windows then rank BOH and GAL in
// opposite orders (2nd/1st against 1st/2nd), so the plain mean of the rank gaps
// is 0 while the score — which weights each window against its own table's size
// — makes BOH the trailing side.
const oppositeFormWindows = () => fixture(seed([
  { eventId: 701, round: 1, kickoff: ago(20), home: 1, away: 5, hs: 1, as: 0 },
  { eventId: 702, round: 2, kickoff: ago(18), home: 2, away: 3, hs: 2, as: 0 },
  { eventId: 703, round: 2, kickoff: ago(18), home: 4, away: 5, hs: 1, as: 1 },
  { eventId: 704, round: 3, kickoff: ago(16), home: 2, away: 4, hs: 1, as: 0 },
  { eventId: 705, round: 3, kickoff: ago(16), home: 3, away: 5, hs: 0, as: 2 },
  { eventId: 706, round: 4, kickoff: ago(14), home: 2, away: 5, hs: 1, as: 1 },
  { eventId: 707, round: 4, kickoff: ago(14), home: 3, away: 4, hs: 2, as: 1 },
  { eventId: 708, round: 5, kickoff: ago(3), home: 1, away: 2, hs: null, as: null },
  { eventId: 709, round: 5, kickoff: ago(2), home: 3, away: 1, hs: null, as: null },
  { eventId: 710, round: 6, kickoff: ago(1), home: 4, away: 1, hs: null, as: null },
], FIVE), { round: 7, homeTeamId: 2, awayTeamId: 5 }, FIVE);

// Only SHE's scorer has a position, so SHE have a real fantasy total and BOH read
// 0 — a data gap. lib suppresses the metric for the whole fixture, so neither
// chip shows a delta, but SHE's tooltip must not be labelled as missing data.
const oneSquadPositioned = () => fixture(setPlayerField(seed([
  { eventId: 101, round: 1, kickoff: ago(3), home: 1, away: 2, hs: 3, as: 0 },
  { eventId: 102, round: 2, kickoff: ago(2), home: 2, away: 1, hs: 0, as: 2 },
]), 11, "gamePosition", "FWD"));

const render = (d) =>
  renderToStaticMarkup(<MatchesTab data={d} update={() => {}} openTeam={() => {}} />);

// One fixture row's inner markup. Rows contain no nested <div>, so the lazy match
// is exact; rounds render newest first, so rows[0] is the upcoming fixture.
const rows = (html) => [...html.matchAll(/<div class="card fixture">([\s\S]*?)<\/div>/g)].map((m) => m[1]);

// The chips of each side, home group first. Chip spans never nest, so this pairs
// each group with its own closing tag rather than the row's.
const CHIP_GROUP = /<span class="cmp-chips">((?:<span[^>]*>[^<]*<\/span>)+)<\/span>/g;
const chipGroups = (rowHtml) => [...rowHtml.matchAll(CHIP_GROUP)].map((m) => m[1]);
const chipCount = (group) => group.match(/<span /g).length;
// The visible face of each metric chip: { pos: "+1", pts: "-6", ... }.
const faces = (group) => Object.fromEntries(
  [...group.matchAll(/>(pos|pts|form|fpts) ([^<]*)</g)].map((m) => [m[1], m[2]]));

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
    expect(Object.keys(faces(home))).toEqual(["pos", "pts", "form", "fpts"]);
    expect(Object.keys(faces(away))).toEqual(["pos", "pts", "form", "fpts"]);
    // Each group's tooltips name the *other* club, which is what identifies it.
    expect(home).toContain("v BOH 2nd of 2 — 1 place better");
    expect(away).toContain("v SHE 1st of 2 — 1 place worse");
  });

  it("mirrors every delta between the two sides", () => {
    for (const d of [seeded(), withFantasy(), unequalGames(), tieGroup()]) {
      const { home, away } = upcoming(d);
      const [h, a] = [faces(home), faces(away)];
      let signedPairs = 0;
      for (const k of ["pos", "pts", "form", "fpts"]) {
        if (h[k] === "—" || h[k] === "0") {
          expect(a[k]).toBe(h[k]); // no data, or level: no sign either side
        } else {
          expect(a[k]).toBe(h[k].startsWith("+") ? h[k].replace("+", "-") : h[k].replace("-", "+"));
          signedPairs++;
        }
      }
      expect(signedPairs).toBeGreaterThan(1); // not a vacuous pass
    }
  });

  it("tints the leading side and dims the trailing side, per metric", () => {
    const { home, away } = upcoming(seeded());
    expect(home).toContain('<span class="chip cmp-up" title="position: 1st of 2 v BOH 2nd of 2 — 1 place better">pos +1</span>');
    expect(home).toContain('<span class="chip cmp-up" title="league points: 6 from 2 games (3.00/game) v BOH 0 from 2 games (0.00/game) — +6 total, +3.00/game">pts +6</span>');
    expect(home).toContain('<span class="chip cmp-up" title="form: 1st over last 3, 1st over last 5 v BOH 2nd / 2nd — 1 place better on average">form +1</span>');

    expect(away).toContain('<span class="chip cmp-down" title="position: 2nd of 2 v SHE 1st of 2 — 1 place worse">pos -1</span>');
    expect(away).toContain('<span class="chip cmp-down" title="league points: 0 from 2 games (0.00/game) v SHE 6 from 2 games (3.00/game) — -6 total, -3.00/game">pts -6</span>');
    expect(away).toContain('<span class="chip cmp-down" title="form: 2nd over last 3, 2nd over last 5 v SHE 1st / 1st — 1 place worse on average">form -1</span>');
  });

  it("tags the favoured club, beside its own name, and only that club", () => {
    const { home, away } = upcoming(seeded());
    const TAG = '<span class="chip cmp-tag" title="favourable for SHE (mismatch): position +1, points +3.00/game, form +1.0, fantasy —">🎯🎯🎯</span>';
    expect(home).toContain(TAG);
    // Home group sits right of its club name, so the tag leads; the away group
    // sits left of its name, so on that side it would have to trail.
    expect(home.startsWith(TAG)).toBe(true);
    expect(away).not.toContain("🎯");
    expect(away).not.toContain("cmp-tag");
  });

  it("puts the away side's tag last, next to the away club's name", () => {
    // BOH host: the favoured club is the away side here.
    const { home, away } = upcoming(fixture(seed([
      { eventId: 101, round: 1, kickoff: ago(3), home: 1, away: 2, hs: 3, as: 0 },
      { eventId: 102, round: 2, kickoff: ago(2), home: 2, away: 1, hs: 0, as: 2 },
    ]), { homeTeamId: 2, awayTeamId: 1 }));
    expect(home).not.toContain("🎯");
    expect(away).toContain("favourable for SHE (mismatch)");
    expect(away).toMatch(/cmp-tag[^>]*>🎯🎯🎯<\/span>$/);
  });

  it("neither tints nor tags two clubs the table cannot separate", () => {
    const { row, home, away } = upcoming(levelPair());
    // Dense positions differ, so a bare "level" would look like a bug: say why.
    // React escapes the apostrophe in the SSR output.
    expect(home).toContain('<span class="chip" title="position: 1st of 2 v BOH 2nd of 2 — level on the table&#x27;s tiebreakers">pos 0</span>');
    expect(away).toContain('<span class="chip" title="position: 2nd of 2 v SHE 1st of 2 — level on the table&#x27;s tiebreakers">pos 0</span>');
    expect(home).toContain('<span class="chip" title="league points: 2 from 2 games (1.00/game) v BOH 2 from 2 games (1.00/game) — level">pts 0</span>');
    expect(home).toContain('— level on average">form 0</span>');
    expect(row).not.toContain("cmp-up");
    expect(row).not.toContain("cmp-down");
    expect(row).not.toContain("🎯");
  });

  it("renders an absent form rank as — and says the data is missing", () => {
    const { home, away } = upcoming(noFormRanks());
    expect(home).toContain('<span class="chip" title="form: no ranked matches in the last 3 or 5 v BOH — / —">form —</span>');
    expect(away).toContain('<span class="chip" title="form: no ranked matches in the last 3 or 5 v SHE — / —">form —</span>');
    expect(home).not.toContain("form 0");
    expect(home).not.toContain("null");
    expect(home).not.toContain("NaN");
  });

  it("calls a zero fantasy total missing data, not a value", () => {
    const { home, away } = upcoming(seeded());
    expect(home).toContain('<span class="chip" title="no fantasy points recorded yet (needs positions set)">fpts —</span>');
    expect(away).toContain('<span class="chip" title="no fantasy points recorded yet (needs positions set)">fpts —</span>');
  });

  it("compares fantasy totals once both clubs have points", () => {
    const { home, away } = upcoming(withFantasy());
    expect(home).toContain('<span class="chip cmp-up" title="fantasy points: 30 (15.0/game) v BOH 6 (3.0/game) — +24 total, +12.0/game">fpts +24</span>');
    expect(away).toContain('<span class="chip cmp-down" title="fantasy points: 6 (3.0/game) v SHE 30 (15.0/game) — -24 total, -12.0/game">fpts -24</span>');
    // The tag's own fantasy reason agrees with the tint.
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
    expect(played).toContain('<span class="fx-score">0–2</span>');
    expect(chipGroups(played)).toHaveLength(0);
    expect(played).not.toContain("cmp-chips");
  });

  it("renders both team names as links", () => {
    const { row } = upcoming(seeded());
    expect(row.match(/role="link"/g)).toHaveLength(2);
    expect(row).toContain('title="Shelbourne — open on the Teams tab"');
    expect(row).toContain('title="Bohemians — open on the Teams tab"');
  });

  it("lays the row out as home | score | away | controls", () => {
    const { row } = upcoming(seeded());
    const order = [...row.matchAll(/class="(fx-side fx-home|fx-score|fx-side fx-away|fx-meta)"/g)].map((m) => m[1]);
    expect(order).toEqual(["fx-side fx-home", "fx-score", "fx-side fx-away", "fx-meta"]);
    // The date, the round selector and the status all live in the meta column.
    const meta = row.slice(row.indexOf('class="fx-meta"'));
    expect(meta).toContain("Sun, 7 Dec");
    expect(meta).toContain('<select title="Move to another round"');
    expect(meta).toContain("upcoming");
  });

  it("survives an empty save", () => {
    expect(render(emptyData())).toContain("No matches yet");
  });
});

describe("MatchesTab chips never contradict their own tint", () => {
  it("measures the position gap in the displayed places, not the scored ranks", () => {
    const { home, away, row } = upcoming(tieGroup());
    // The two clubs on this row are 2nd and 3rd: one place apart, and both chips
    // must say one — the scored gap of two ranks is not on screen.
    expect(home).toContain('title="position: 2nd of 3 v DER 3rd of 3 — 1 place better">pos +1</span>');
    expect(away).toContain('title="position: 3rd of 3 v BOH 2nd of 3 — 1 place worse">pos -1</span>');
    expect(row).not.toContain("2 places");
    expect(row).not.toContain("pos +2");
    // The tag's breakdown quotes the same visible gap.
    expect(row).toContain("position +1");
  });

  it("still calls a shared scored rank level, whatever the displayed positions", () => {
    const { home, away } = upcoming(levelPair());
    expect(home).toContain("— level on the table&#x27;s tiebreakers");
    expect(faces(home).pos).toBe("0");
    expect(faces(away).pos).toBe("0");
    // Dense positions differ, so this is not the trivial case.
    expect(home).toContain("position: 1st of 2 v BOH 2nd of 2");
    expect(away).toContain("position: 2nd of 2 v SHE 1st of 2");
  });

  it("owns a total that points the other way from the per-game tint", () => {
    const { home, away } = upcoming(unequalGames());
    // SHE lead on rate and are tinted for it, but their points TOTAL is lower.
    expect(home).toContain('<span class="chip cmp-up" title="league points: 6 from 2 games (3.00/game) v BOH 8 from 4 games (2.00/game) — -2 total but +1.00/game; BOH have played 2 games more">pts -2</span>');
    expect(away).toContain('<span class="chip cmp-down" title="league points: 8 from 4 games (2.00/game) v SHE 6 from 2 games (3.00/game) — +2 total but -1.00/game; SHE have played 2 games fewer">pts +2</span>');
  });

  it("owns a form mean that points the other way from the weighted tint", () => {
    const { home, away } = upcoming(oppositeFormWindows());
    // BOH are 2nd of 4 over the last 3 and 1st of 5 over the last 5, GAL the
    // reverse: the plain mean is 0, but the shorter window carries more weight,
    // so lib tints BOH as trailing. The chip must not argue with the colour.
    expect(faces(home).form).toBe("0");
    expect(faces(away).form).toBe("0");
    expect(home).toContain('<span class="chip cmp-down" title="form: 2nd over last 3, 1st over last 5 v GAL 1st / 2nd — level on average, but the two windows disagree and each is weighted against its own table\'s size">form 0</span>'.replace("table'", "table&#x27;"));
    expect(away).toContain('<span class="chip cmp-up" title="form: 1st over last 3, 2nd over last 5 v BOH 2nd / 1st — level on average, but the two windows disagree');
  });

  it("blames the club that is actually missing fantasy data", () => {
    const { home, away } = upcoming(oneSquadPositioned());
    const MISSING = "no fantasy points recorded yet (needs positions set)";
    // BOH have nothing recorded: their own chip says so.
    expect(away).toContain(`<span class="chip" title="${MISSING}">fpts —</span>`);
    // SHE have a real total. Naming it missing would contradict the tooltip.
    const she = home.match(/<span class="chip([^"]*)" title="fantasy points: (\d+) \(([\d.]+)\/game\) — ([^"]*)">fpts —<\/span>/);
    expect(Number(she[2])).toBeGreaterThan(0);
    expect(she[4]).toBe(`not compared: BOH have ${MISSING}`);
    // Suppressed means neutral on both sides, not a win for SHE.
    expect(she[1]).toBe("");
  });
});
