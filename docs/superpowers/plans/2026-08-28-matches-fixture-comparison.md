# Matches Fixture Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Matches tab, link team names through to the Teams tab and show, on upcoming fixtures only, per-side stat chips (table position, league points, 3/5-game form position, team fantasy points) plus a graded 🎯 "favourable fixture" tag.

**Architecture:** All derivation goes in a new pure module `src/lib/fixtures.js` (`fixtureContext(data)` builds the three league tables once; `compareFixture(ctx, match)` returns both sides plus the favoured side). `MatchesTab` memoizes the context and renders chips — no maths in the component beyond formatting. Team linking uses a `focusTeam = {teamId, nonce}` state in `App.jsx`, passed down to `MatchesTab` (as `openTeam`) and `TeamsTab` (as `focusTeam`). Nothing is stored; everything recomputes from `matches` + `appearances` + `adjustments`.

**Tech Stack:** React 18, Vite, Vitest (node environment, `renderToStaticMarkup` for component smoke tests), plain CSS in `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-08-28-matches-fixture-comparison-design.md`

**Environment — every npm/npx command MUST be prefixed:**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

System Node is v14 and silently breaks Vite/Vitest.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/fixtures.js` (create) | Pure derivation: league/form/fantasy context + per-fixture comparison and favourability score. |
| `test/fixtures.test.js` (create) | Unit tests for the above, fixtures built through `applyImport`. |
| `src/components/MatchesTab.jsx` (modify) | Renders the chips + tag on upcoming fixtures; team pills become links. |
| `test/matchesTab.test.jsx` (create) | SSR smoke test: chips on upcoming, none on played, links present. |
| `src/App.jsx` (modify) | `focusTeam` state; wires `openTeam` into MatchesTab and `focusTeam` into TeamsTab. |
| `src/components/TeamsTab.jsx` (modify) | Adopts `focusTeam` in an effect keyed on the nonce. |
| `src/styles.css` (modify) | `.cmp`, `.cmp-up`, `.cmp-down`, `.cmp-tag`. |
| `package.json` (modify) | Version bump to 0.24.0 (footer cache tell). |

---

## Task 1: `fixtureContext` — the shared derivation context

**Files:**
- Create: `src/lib/fixtures.js`
- Test: `test/fixtures.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/fixtures.test.js`. The `seed` helper below is reused by every later task in this plan — build fixtures through real store operations (`applyImport`), never hand-rolled objects.

```js
// test/fixtures.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport } from "../src/lib/store.js";
import { fixtureContext, compareFixture } from "../src/lib/fixtures.js";

const NOW = 1765000000000;
const DAY = 86400000;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
  { id: 3, name: "Derry City", shortName: "DER" },
  { id: 4, name: "Sligo Rovers", shortName: "SLI" },
];

// One appearance per scorer so the fantasy column has something in it.
function app(eventId, playerId, teamId, goals = 0) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// results: [{ eventId, round, kickoff, home, away, hs, as }]
// Each club gets one player, id = 10 + teamId, position FWD via `players` +
// setPlayerField in the caller when fantasy points matter.
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
      players: [
        { id: 10 + r.home, name: `P${r.home}`, teamId: r.home },
        { id: 10 + r.away, name: `P${r.away}`, teamId: r.away },
      ],
      appearances: [
        app(r.eventId, 10 + r.home, r.home, r.hs),
        app(r.eventId, 10 + r.away, r.away, r.as),
      ],
    }, NOW);
  }
  return d;
}

// SHE win everything, BOH lose everything, DER/SLI split.
function fourTeamSeason() {
  return seed([
    { eventId: 101, round: 1, kickoff: NOW - 5 * DAY, home: 1, away: 2, hs: 3, as: 0 },
    { eventId: 102, round: 1, kickoff: NOW - 5 * DAY, home: 3, away: 4, hs: 1, as: 1 },
    { eventId: 103, round: 2, kickoff: NOW - 4 * DAY, home: 1, away: 3, hs: 2, as: 0 },
    { eventId: 104, round: 2, kickoff: NOW - 4 * DAY, home: 4, away: 2, hs: 2, as: 0 },
    { eventId: 105, round: 3, kickoff: NOW - 3 * DAY, home: 1, away: 4, hs: 1, as: 0 },
    { eventId: 106, round: 3, kickoff: NOW - 3 * DAY, home: 2, away: 3, hs: 0, as: 2 },
  ]);
}

describe("fixtureContext", () => {
  it("ranks every club in the all-time and both form tables", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(ctx.teamCount).toBe(4);
    expect(ctx.pos.get("1")).toBe(1);   // SHE won all three
    expect(ctx.pos.get("2")).toBe(4);   // BOH lost all three
    for (const id of ["1", "2", "3", "4"]) {
      expect(ctx.pos3.get(id)).toBeGreaterThan(0);
      expect(ctx.pos5.get(id)).toBeGreaterThan(0);
    }
  });

  it("exposes per-game rates and non-negative league spreads", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const she = ctx.rows.get("1");
    expect(she.played).toBe(3);
    expect(she.points).toBe(9);
    expect(ctx.ppgSpread).toBeGreaterThan(0);
    expect(ctx.fpgSpread).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty context with no imported matches", () => {
    const ctx = fixtureContext(emptyData());
    expect(ctx.teamCount).toBe(0);
    expect(ctx.ppgSpread).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fixtures.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/fixtures.js"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/fixtures.js`:

```js
import { leagueTable } from "./store.js";

// Fixture comparison: how two clubs stack up right now on league position,
// league points, 3- and 5-game form position, and team fantasy points.
// Pure and derived — nothing here is ever stored (see CLAUDE.md).

const FORM_SHORT = 3;
const FORM_LONG = 5;

const perGame = (total, played) => (played ? total / played : 0);

// teamId (as a string key) -> 1-based league position
function rankMap(rows) {
  const m = new Map();
  rows.forEach((r, i) => m.set(String(r.teamId), i + 1));
  return m;
}

function spread(rows, fn) {
  const vals = rows.map(fn).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

// Built once per render and shared by every fixture on the page: three league
// tables is the expensive part, so never call leagueTable per match.
export function fixtureContext(data) {
  const all = leagueTable(data);
  const short = leagueTable(data, FORM_SHORT);
  const long = leagueTable(data, FORM_LONG);
  return {
    rows: new Map(all.map((r) => [String(r.teamId), r])),
    pos: rankMap(all),
    pos3: rankMap(short),
    pos5: rankMap(long),
    teamCount: all.length,
    count3: short.length,
    count5: long.length,
    ppgSpread: spread(all, (r) => perGame(r.points, r.played)),
    fpgSpread: spread(all, (r) => perGame(r.fantasy, r.played)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fixtures.test.js
```

Expected: the three `fixtureContext` tests PASS. (The file also imports
`compareFixture`, which does not exist yet — that import is fine because it is
unused until Task 2; if the runner complains about the unused import, leave the
import in place and add the stub `export function compareFixture() { return null; }`
to `src/lib/fixtures.js`, which Task 2 replaces.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/fixtures.js test/fixtures.test.js
git commit -m "feat: fixtureContext — shared league/form/fantasy context for fixture comparison"
```

---

## Task 2: `compareFixture` — sides, weighted score, grade

**Files:**
- Modify: `src/lib/fixtures.js`
- Test: `test/fixtures.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/fixtures.test.js`:

```js
describe("compareFixture", () => {
  const upcoming = (home, away) => ({
    eventId: 900, round: 4, kickoff: NOW + DAY, status: "notstarted",
    homeTeamId: home, awayTeamId: away, homeScore: null, awayScore: null,
  });

  it("returns both sides with position, points, form and fantasy", () => {
    const d = fourTeamSeason();
    const cmp = compareFixture(fixtureContext(d), upcoming(1, 2));
    expect(cmp.home.teamId).toBe("1");
    expect(cmp.away.teamId).toBe("2");
    expect(cmp.home.pos).toBe(1);
    expect(cmp.away.pos).toBe(4);
    expect(cmp.home.points).toBe(9);
    expect(cmp.away.points).toBe(0);
    expect(cmp.home.played).toBe(3);
    expect(cmp.home.form3).toBeGreaterThan(0);
    expect(cmp.home.form5).toBeGreaterThan(0);
    expect(cmp.home.teamCount).toBe(4);
    expect(typeof cmp.home.fantasy).toBe("number");
  });

  it("scores the stronger side positive from the home perspective", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(compareFixture(ctx, upcoming(1, 2)).score).toBeGreaterThan(0);
    expect(compareFixture(ctx, upcoming(2, 1)).score).toBeLessThan(0);
  });

  it("mirrors: swapping the sides negates the score and keeps the favoured club", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const a = compareFixture(ctx, upcoming(1, 2));
    const b = compareFixture(ctx, upcoming(2, 1));
    expect(a.score).toBeCloseTo(-b.score, 10);
    expect(a.favoured.teamId).toBe("1");
    expect(b.favoured.teamId).toBe("1");
  });

  it("grades by magnitude and names the reasons", () => {
    const ctx = fixtureContext(fourTeamSeason());
    const cmp = compareFixture(ctx, upcoming(1, 2)); // 1st v 4th, biggest gap available
    expect(["slight", "strong", "mismatch"]).toContain(cmp.favoured.grade);
    expect(cmp.favoured.tag).toMatch(/^🎯+$/);
    expect(cmp.favoured.reasons.join(" ")).toMatch(/position \+3/);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("points +"))).toBe(true);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("form "))).toBe(true);
    expect(cmp.favoured.reasons.some((r) => r.startsWith("fantasy "))).toBe(true);
  });

  it("leaves evenly matched clubs untagged", () => {
    // DER and SLI drew with each other and each beat/lost to the same clubs once.
    const d = seed([
      { eventId: 201, round: 1, kickoff: NOW - 3 * DAY, home: 3, away: 4, hs: 1, as: 1 },
      { eventId: 202, round: 2, kickoff: NOW - 2 * DAY, home: 4, away: 3, hs: 2, as: 2 },
    ]);
    const cmp = compareFixture(fixtureContext(d), upcoming(3, 4));
    expect(cmp.score).toBeCloseTo(0, 10);
    expect(cmp.favoured).toBeNull();
  });

  it("returns null when either club has no imported matches", () => {
    const ctx = fixtureContext(fourTeamSeason());
    expect(compareFixture(ctx, upcoming(1, 99))).toBeNull();
    expect(compareFixture(ctx, upcoming(99, 1))).toBeNull();
    expect(compareFixture(fixtureContext(emptyData()), upcoming(1, 2))).toBeNull();
  });

  it("never yields NaN when a league metric has zero spread", () => {
    // Two clubs, one draw: identical on every metric, so every spread is 0.
    const d = seed([{ eventId: 301, round: 1, kickoff: NOW - DAY, home: 1, away: 2, hs: 0, as: 0 }]);
    const cmp = compareFixture(fixtureContext(d), upcoming(1, 2));
    expect(Number.isNaN(cmp.score)).toBe(false);
    expect(cmp.score).toBeCloseTo(0, 10);
  });

  it("keeps the score inside [-1, 1]", () => {
    const ctx = fixtureContext(fourTeamSeason());
    for (const m of [upcoming(1, 2), upcoming(2, 1), upcoming(3, 4)]) {
      const s = compareFixture(ctx, m).score;
      expect(s).toBeGreaterThanOrEqual(-1);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fixtures.test.js
```

Expected: FAIL — `compareFixture is not a function` (or the stub returning `null` fails the first assertion).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/fixtures.js` (and delete the Task 1 stub if you added one):

```js
// Weights sum to 1. Position and form (the two rank-based views) carry 0.6
// between them; the two per-game rates carry 0.4.
const WEIGHTS = { pos: 0.30, ppg: 0.20, form: 0.30, fpg: 0.20 };

// Grades on |score|, strongest first. No home-advantage term — we have no data
// to calibrate one (see the spec).
const GRADES = [
  [0.45, "mismatch", "🎯🎯🎯"],
  [0.28, "strong", "🎯🎯"],
  [0.14, "slight", "🎯"],
];

const clamp1 = (v) => Math.max(-1, Math.min(1, v));
// A gap normalised against the league's own spread. Zero spread -> no signal.
const norm = (gap, denom) => (denom > 0 ? clamp1(gap / denom) : 0);
const signed = (n, digits = 0) => (n >= 0 ? "+" : "") + n.toFixed(digits);

function sideOf(ctx, teamId) {
  const row = ctx.rows.get(teamId);
  if (!row) return null; // no imported matches -> nothing to compare
  return {
    teamId,
    pos: ctx.pos.get(teamId),
    teamCount: ctx.teamCount,
    played: row.played,
    points: row.points,
    ppg: perGame(row.points, row.played),
    form3: ctx.pos3.get(teamId),
    form5: ctx.pos5.get(teamId),
    fantasy: row.fantasy,
    fpg: perGame(row.fantasy, row.played),
  };
}

// Comparison for one fixture. `score` runs from the HOME side's perspective:
// positive = home favoured. Returns null when either club has no imported
// matches yet. Callers show this on upcoming fixtures only.
export function compareFixture(ctx, match) {
  const home = sideOf(ctx, String(match.homeTeamId));
  const away = sideOf(ctx, String(match.awayTeamId));
  if (!home || !away) return null;

  const gaps = {
    pos: away.pos - home.pos,            // lower position number is better
    ppg: home.ppg - away.ppg,
    form3: away.form3 - home.form3,
    form5: away.form5 - home.form5,
    fpg: home.fpg - away.fpg,
  };
  const parts = {
    pos: norm(gaps.pos, ctx.teamCount - 1),
    ppg: norm(gaps.ppg, ctx.ppgSpread),
    form: (norm(gaps.form3, ctx.count3 - 1) + norm(gaps.form5, ctx.count5 - 1)) / 2,
    fpg: norm(gaps.fpg, ctx.fpgSpread),
  };
  const score = clamp1(
    WEIGHTS.pos * parts.pos + WEIGHTS.ppg * parts.ppg +
    WEIGHTS.form * parts.form + WEIGHTS.fpg * parts.fpg,
  );

  const hit = GRADES.find(([min]) => Math.abs(score) >= min);
  let favoured = null;
  if (hit) {
    const [, grade, tag] = hit;
    const dir = score > 0 ? 1 : -1; // reasons read from the favoured club's side
    favoured = {
      teamId: dir > 0 ? home.teamId : away.teamId,
      score, grade, tag,
      reasons: [
        `position ${signed(dir * gaps.pos)}`,
        `points ${signed(dir * gaps.ppg, 2)}/game`,
        `form ${signed(dir * (gaps.form3 + gaps.form5) / 2, 1)}`,
        `fantasy ${signed(dir * gaps.fpg, 1)}/game`,
      ],
    };
  }
  return { home, away, score, parts, favoured };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fixtures.test.js
```

Expected: PASS, all tests in the file.

If "grades by magnitude" fails because a 1st-v-4th fixture in a 4-club fixture
set scores below 0.14, **do not change the thresholds** — the spec fixes them.
Strengthen the fixture instead (add another round where SHE win and BOH lose)
until the gap is real, and leave the assertion as a membership check.

- [ ] **Step 5: Run the whole suite (nothing else should move)**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test
```

Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fixtures.js test/fixtures.test.js
git commit -m "feat: compareFixture — weighted, graded favourable-fixture scoring"
```

---

## Task 3: Chips and tag on upcoming fixtures

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/MatchesTab.jsx`
- Test: `test/matchesTab.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `test/matchesTab.test.jsx`. This is an SSR smoke test — the project has no
jsdom, so assert on the rendered HTML string (see `test/teamsTab.test.jsx` for the
established pattern).

```jsx
// test/matchesTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MatchesTab from "../src/components/MatchesTab.jsx";
import { emptyData, applyImport, upsertMatchStubs } from "../src/lib/store.js";

const NOW = 1765000000000;
const DAY = 86400000;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
];

function app(eventId, playerId, teamId, goals) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// Two played rounds (SHE beat BOH twice) plus one upcoming stub.
function seeded() {
  let d = emptyData();
  for (const [eventId, round, home, away, hs, as] of [
    [101, 1, 1, 2, 3, 0],
    [102, 2, 2, 1, 0, 2],
  ]) {
    d = applyImport(d, {
      match: {
        eventId, round, kickoff: NOW - (4 - round) * DAY, status: "finished",
        homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [{ id: 11, name: "P1", teamId: 1 }, { id: 12, name: "P2", teamId: 2 }],
      appearances: [app(eventId, 11, 1, home === 1 ? hs : as), app(eventId, 12, 2, home === 2 ? hs : as)],
    }, NOW);
  }
  d = upsertMatchStubs(d, [{
    eventId: 900, round: 3, kickoff: NOW + DAY, status: "notstarted",
    homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null,
  }], TEAMS);
  return d;
}

const render = (d) =>
  renderToStaticMarkup(<MatchesTab data={d} update={() => {}} openTeam={() => {}} />);

describe("MatchesTab fixture comparison", () => {
  it("renders comparison chips on the upcoming fixture", () => {
    const html = render(seeded());
    expect(html).toContain("cmp-chips");           // the chip group is present
    expect(html).toMatch(/league position/);       // chip tooltips wired
    expect(html).toMatch(/1st|2nd/);               // ordinal position rendered
  });

  it("tags the favoured side", () => {
    const html = render(seeded());
    expect(html).toContain("🎯");
    expect(html).toMatch(/favourable for/);
  });

  it("shows no chips when there is nothing upcoming", () => {
    let d = emptyData();
    d = applyImport(d, {
      match: {
        eventId: 101, round: 1, kickoff: NOW - DAY, status: "finished",
        homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [{ id: 11, name: "P1", teamId: 1 }],
      appearances: [app(101, 11, 1, 1)],
    }, NOW);
    const html = render(d);
    expect(html).not.toContain("cmp-chips");
  });

  it("renders team names as links", () => {
    const html = render(seeded());
    expect(html).toContain('role="link"');
    expect(html).toContain("Shelbourne");
  });

  it("survives an empty save", () => {
    expect(render(emptyData())).toContain("No matches yet");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/matchesTab.test.jsx
```

Expected: FAIL — the markup contains no `cmp-chips`.

- [ ] **Step 3: Add the CSS**

Append to `src/styles.css`, next to the other chip/cell rules:

```css
/* fixture comparison chips (Matches tab, upcoming fixtures) */
.cmp-chips { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.cmp-chips .chip { background: var(--bg); color: var(--dim); border: 1px solid var(--line); }
.cmp-chips .chip.cmp-up { background: var(--accent); border-color: var(--accent); color: #fff; }
.cmp-chips .chip.cmp-down { opacity: .55; }
.cmp-tag { background: var(--warn); border-color: var(--warn); color: #fff; cursor: help; }
```

- [ ] **Step 4: Render the chips in MatchesTab**

In `src/components/MatchesTab.jsx`:

4a. Extend the imports at the top of the file:

```jsx
import { useEffect, useMemo, useRef } from "react";
import { matchRound, setMatchRound, isSupersededPostponed, roundSuspects, allMatchTeamPoints } from "../lib/store.js";
import { fixtureContext, compareFixture } from "../lib/fixtures.js";
import { TeamPill, PtsPill } from "./Pills.jsx";
```

4b. Add these helpers just below the existing `teamLabel` definition:

```jsx
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
        title={`${plural(side.points, "pt")} from ${plural(side.played, "game")} (${side.ppg.toFixed(2)}/game) — ${signed(side.points - opp.points)} vs ${oppName}`}>
        {side.points}
      </span>
      <span className={`chip${cmpCls((side.form3 + side.form5) / 2, (opp.form3 + opp.form5) / 2, true)}`}
        title={`form: ${ord(side.form3)} over last 3, ${ord(side.form5)} over last 5 (${oppName} ${ord(opp.form3)} / ${ord(opp.form5)})`}>
        F {side.form3}/{side.form5}
      </span>
      <span className={`chip${cmpCls(side.fantasy, opp.fantasy)}`}
        title={`${side.fantasy} fantasy pts (${side.fpg.toFixed(1)}/game) — ${signed(side.fantasy - opp.fantasy)} vs ${oppName}`}>
        {side.fantasy}F
      </span>
    </span>
  );
}
```

4c. Inside the component, next to the existing `teamPts` memo, add the context
and an "is this fixture still to come" test:

```jsx
  const suspects = roundSuspects(data);
  const teamPts = useMemo(() => allMatchTeamPoints(data), [data]);
  const ctx = useMemo(() => fixtureContext(data), [data]);
  // Comparison is for fixtures still to be played; a result speaks for itself.
  const cmpFor = (m) => (!gone(m) && m.status !== "finished" ? compareFixture(ctx, m) : null);
```

4d. Replace the fixture row's inner `<span style={{ flex: 1 }}>…</span>` block
with this version. The only changes are the two `SideChips` insertions and the
`cmp` lookup — everything else is unchanged:

```jsx
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
                <TeamPill team={data.teams[m.homeTeamId]} label={teamLabel(data.teams[m.homeTeamId])} />
                {teamPts.has(m.eventId) && <> <PtsPill pts={teamPts.get(m.eventId).home} /></>}
                {cmp && <> <SideChips side={cmp.home} opp={cmp.away} oppName={awayName}
                  tag={favHome ? cmp.favoured.tag : null} tagTitle={tagTitle} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {cmp && <><SideChips side={cmp.away} opp={cmp.home} oppName={homeName}
                  tag={favAway ? cmp.favoured.tag : null} tagTitle={tagTitle} /> </>}
                {teamPts.has(m.eventId) && <><PtsPill pts={teamPts.get(m.eventId).away} /> </>}
                <TeamPill team={data.teams[m.awayTeamId]} label={teamLabel(data.teams[m.awayTeamId])} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}> ⚠R{suspects.get(m.eventId)}?</span>
                )}
              </span>
```

**Important:** `items.map((m) => (` becomes `items.map((m) => {` … `return (` … `);})`.
Close the map callback correctly at the end of the row block: the existing
`))}` after the status `<span>` chain becomes `);})}`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/matchesTab.test.jsx
```

Expected: the three chip/tag/empty tests PASS. The "renders team names as links"
test still FAILS (that is Task 4) — leave it failing and note it; do not commit
a red suite. Instead, temporarily mark it `it.skip(` for this task's commit and
re-enable it in Task 4 Step 1.

- [ ] **Step 6: Build (catches JSX errors tests cannot)**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run build
```

Expected: `built in …` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css src/components/MatchesTab.jsx test/matchesTab.test.jsx
git commit -m "feat: per-side stat chips and graded favourable-fixture tag on upcoming fixtures"
```

---

## Task 4: Team names link through to the Teams tab

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/MatchesTab.jsx`
- Modify: `src/components/TeamsTab.jsx`
- Test: `test/matchesTab.test.jsx`, `test/teamsTab.test.jsx`

- [ ] **Step 1: Re-enable the link test and add the TeamsTab focus test**

In `test/matchesTab.test.jsx`, change `it.skip("renders team names as links"` back
to `it("renders team names as links"`.

Append to `test/teamsTab.test.jsx`. That file already has a `dataForTeam()`
helper: two clubs where **Bohemians (id 1)** sorts first alphabetically — so it is
the club TeamsTab picks by default — and **Shamrock Rovers (id 2)** whose only
squad member is the never-played ghost "Daniel Mandroiu". Focusing club 2 must
therefore show Mandroiu and not Bohemians' "Graham Burke":

```jsx
describe("TeamsTab focusTeam", () => {
  it("renders the focused club rather than the first alphabetically", () => {
    const html = renderToStaticMarkup(
      <TeamsTab data={dataForTeam()} update={() => {}} openPlayer={() => {}}
        focusTeam={{ teamId: "2", nonce: 1 }} />,
    );
    expect(html).toContain("Daniel Mandroiu");   // Shamrock Rovers' squad
    expect(html).not.toContain("Graham Burke");  // Bohemians' — not selected
  });

  it("still defaults to the first club when no focusTeam is given", () => {
    const html = renderToStaticMarkup(
      <TeamsTab data={dataForTeam()} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain("Graham Burke");
  });

  it("ignores a focusTeam for a club that is not in the save", () => {
    const html = renderToStaticMarkup(
      <TeamsTab data={dataForTeam()} update={() => {}} openPlayer={() => {}}
        focusTeam={{ teamId: "999", nonce: 1 }} />);
    expect(html).toContain("Graham Burke");      // falls back to the default club
  });
});
```

Do not assert on `value="2"` — React's SSR puts the selection on the matching
`<option selected>`, and every club's `<option value="…">` is in the markup
regardless of which one is chosen.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/matchesTab.test.jsx test/teamsTab.test.jsx
```

Expected: FAIL — no `role="link"` in the Matches markup; TeamsTab ignores `focusTeam`.

- [ ] **Step 3: Make the team pills clickable in MatchesTab**

Add this helper below `teamLabel` in `src/components/MatchesTab.jsx`:

```jsx
// Team pill that navigates to the club on the Teams tab.
function TeamLink({ team, teamId, openTeam }) {
  return (
    <a role="link" tabIndex={0} title={`${team?.name ?? "team"} — open on the Teams tab`}
      style={{ cursor: "pointer" }}
      onClick={() => openTeam?.(String(teamId))}
      onKeyDown={(e) => e.key === "Enter" && openTeam?.(String(teamId))}>
      <TeamPill team={team} label={teamLabel(team)} />
    </a>
  );
}
```

Change the component signature to accept the prop:

```jsx
export default function MatchesTab({ data, update, openTeam }) {
```

Replace both `<TeamPill … label={teamLabel(…)} />` usages in the fixture row with:

```jsx
                <TeamLink team={data.teams[m.homeTeamId]} teamId={m.homeTeamId} openTeam={openTeam} />
```

and

```jsx
                <TeamLink team={data.teams[m.awayTeamId]} teamId={m.awayTeamId} openTeam={openTeam} />
```

- [ ] **Step 4: Adopt `focusTeam` in TeamsTab**

In `src/components/TeamsTab.jsx`, change the signature and add one effect
immediately after the existing `const [teamId, setTeamId] = useState(teamIds[0] || null);`
line — placed before `selected` is computed:

```jsx
export default function TeamsTab({ data, update, openPlayer, focusTeam }) {
```

```jsx
  // Arriving from a team link elsewhere in the app. Keyed on the nonce so
  // clicking the same club twice still re-focuses, and so the user's own
  // dropdown choice is never fought over on unrelated re-renders.
  useEffect(() => {
    if (focusTeam?.teamId && data.teams[focusTeam.teamId]) setTeamId(String(focusTeam.teamId));
  }, [focusTeam?.nonce]);
```

`useState`, `useRef` and `useEffect` are already imported in this file.

For the SSR test to pass without effects running, seed the initial state from
`focusTeam` as well — replace the `useState` line with:

```jsx
  const [teamId, setTeamId] = useState(
    (focusTeam?.teamId && data.teams[focusTeam.teamId] ? String(focusTeam.teamId) : null) || teamIds[0] || null,
  );
```

- [ ] **Step 5: Wire it up in App.jsx**

In `src/App.jsx`, add the state next to the other `useState` calls:

```jsx
  const [focusTeam, setFocusTeam] = useState(null); // { teamId, nonce } — set by team links
```

Add the handler above the `return`, next to `handleSignIn`:

```jsx
  const openTeam = useCallback((teamId) => {
    setFocusTeam((f) => ({ teamId: String(teamId), nonce: (f?.nonce ?? 0) + 1 }));
    setOpenPlayerId(null);
    setTab("teams");
    window.scrollTo({ top: 0 });
  }, []);
```

Pass both props to the active tab (extra props on tabs that ignore them are harmless):

```jsx
          <Active data={data} update={update} openPlayer={setOpenPlayerId} openTeam={openTeam} focusTeam={focusTeam} />
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/matchesTab.test.jsx test/teamsTab.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Run the whole suite and build**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test && npm run build
```

Expected: all suites PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/components/MatchesTab.jsx src/components/TeamsTab.jsx test/matchesTab.test.jsx test/teamsTab.test.jsx
git commit -m "feat: team names on Matches link through to the Teams tab"
```

---

## Task 5: Version bump and deploy

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Bump the version**

Edit `package.json`: `"version": "0.24.0"`.

- [ ] **Step 2: Sync the lockfile**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm install --package-lock-only
```

- [ ] **Step 3: Final verification**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test && npm run build
```

Expected: all suites PASS, build succeeds. Paste the real output — do not claim
success without it.

- [ ] **Step 4: Commit and push**

```bash
git add package.json package-lock.json
git commit -m "feat: Matches tab fixture comparison + team links (v0.24.0)"
git push
```

GitHub Actions deploys to https://seaninryan.github.io/fancystats/. The footer
should read `v0.24.0` once it lands.

---

## Manual verification (after deploy)

1. Matches tab: click a team name on any fixture → lands on Teams with that club selected. Click a different club on another fixture → follows.
2. Click the *same* club twice from Matches (changing the Teams dropdown in between) → still re-focuses.
3. Upcoming fixtures show four chips per side; hovering each gives the tooltip with the delta.
4. The stronger side's chips are green, the weaker side's dimmed; level metrics are plain.
5. Played fixtures are unchanged — no chips, no tag, team-points pills still there.
6. A fixture where one club has no imported matches shows no chips at all.
7. On a phone width, the chip groups wrap without breaking the row.
