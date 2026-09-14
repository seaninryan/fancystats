# Goal Clocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth mirrored comparison chip to upcoming fixtures on the Matches tab showing how long each club has gone without scoring and without conceding, highlighted when the two clubs diverge drastically, and weighted at 0.10 in the 🎯 favourable-fixture score.

**Architecture:** A new pure derivation `teamGoalClocks` in `src/lib/store.js` walks each club's last five imported-and-scored matches backwards, accumulating 90 minutes per match until it finds a goal. `src/lib/fixtures.js` consumes it once per render inside `fixtureContext`, turns the two clocks into two normalised gaps, folds them into `parts.goals` at weight 0.10 (the other four weights scale by 0.9), and exposes a `drastic` flag orthogonal to the tint. `MatchesTab.jsx` renders one extra chip per side. Nothing is stored.

**Tech Stack:** React 18, Vite, Vitest (node environment, no jsdom). Pure logic in `src/lib/`, thin components in `src/components/`.

**Spec:** `docs/superpowers/specs/2026-09-14-goal-clocks-design.md` — read it before starting. It explains *why* several of the rules below look odd; do not simplify them away.

---

## Environment — do this first, every shell

The system Node is v14 and silently breaks Vite/Vitest. Prefix every npm/npx command in every new shell:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

Verify: `node -v` must print `v20.20.2`. If it prints `v14.x`, nothing below will work and the failures will be misleading.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/store.js` | Modify — add `teamGoalClocks` after `teamWindowEventIds` (currently ends line 462) | Walk match history, produce per-club clocks. Knows about matches and goal times; knows nothing about fixtures or chips. |
| `src/lib/fixtures.js` | Modify — `fixtureContext`, `sideOf`, `compareFixture`, `WEIGHTS` | Turn two clocks into two gaps, a weighted component, a `lead` and a `drastic` flag. Knows nothing about React. |
| `src/components/MatchesTab.jsx` | Modify — `SideChips` plus new tooltip helpers | Render the chip. Contains no derivation logic. |
| `src/styles.css` | Modify — add two rules beside the existing `.cmp-*` block (lines 174–179) | The `cmp-hot` highlight. |
| `test/store.test.js` | Modify — new `describe("teamGoalClocks")` | Unit-test the clock walk. |
| `test/fixtures.test.js` | Modify — new fixtures and a new `describe` | Unit-test the gaps, the weights, and `drastic`. |
| `test/matchesTab.test.jsx` | Modify — update existing assertions, add new ones | SSR smoke-test the chip. |
| `package.json` / `package-lock.json` | Modify — version bump | The version renders in the app footer and is the user's cache tell. |

---

## Task 1: `teamGoalClocks` — the clock walk

**Files:**
- Modify: `src/lib/store.js` (add after `teamWindowEventIds`, which ends at line 462)
- Test: `test/store.test.js`

### Background you need

`data.matches` is an object keyed by eventId. Each match record carries:

```js
{
  eventId, round, kickoff, status,
  homeTeamId, awayTeamId, homeScore, awayScore,
  goalTimes: { home: [40, 88], away: [] },   // minute of each goal, sorted
  importedAt, partial,
}
```

`goalTimes.home` is the list of goals credited **to** the home club — own goals already land on the benefiting side inside `sofascore.js` `normalize()`. So a club's *scored* list is its own side and its *conceded* list is the opponent's side. Do not re-attribute own goals.

Stoppage-time goals are stored as `time + addedTime`, so 90+4 is `94`.

An imported-but-unplayed event has `homeScore: null`, `awayScore: null` and an empty `goalTimes`. It must be excluded entirely — it neither contributes minutes nor occupies a window slot.

- [ ] **Step 1: Write the failing tests**

Add this import to the existing import block at the top of `test/store.test.js` — put `teamGoalClocks,` on the line that already has `teamWindowEventIds, leagueTable, leagueOrder,`:

```js
  teamWindowEventIds, leagueTable, leagueOrder, teamGoalClocks,
```

Then append this to the end of `test/store.test.js`:

```js
// Goal-clock fixtures. `hg`/`ag` are goal minutes; hs/as default to their
// length, and null scores model an imported-but-unplayed event.
function clockSeed(results) {
  let d = emptyData();
  for (const r of results) {
    d = applyImport(d, {
      match: {
        eventId: r.eventId, round: r.round ?? 1, kickoff: r.kickoff, status: "finished",
        homeTeamId: r.home, awayTeamId: r.away,
        homeScore: "hs" in r ? r.hs : (r.hg ?? []).length,
        awayScore: "as" in r ? r.as : (r.ag ?? []).length,
        goalTimes: { home: r.hg ?? [], away: r.ag ?? [] },
        partial: false,
      },
      teams: [
        { id: 1, name: "Shelbourne", shortName: "SHE" },
        { id: 2, name: "Bohemians", shortName: "BOH" },
        { id: 3, name: "Derry City", shortName: "DER" },
      ].filter((t) => t.id === r.home || t.id === r.away),
      players: [], appearances: [],
    }, NOW);
  }
  return d;
}

const DAY = 86400000;
const day = (n) => NOW - n * DAY;

describe("teamGoalClocks", () => {
  it("measures from the end of the last match, not from now", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [70], ag: [20] },
    ]));
    expect(c.get(1).scored).toBe(20);    // 90 - 70
    expect(c.get(1).conceded).toBe(70);  // 90 - 20
    expect(c.get(1).scoredOpen).toBe(false);
    expect(c.get(1).concededOpen).toBe(false);
  });

  it("adds a full 90 for each goalless match walked back through", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [30], ag: [] },
      { eventId: 2, kickoff: day(8), home: 1, away: 2, hg: [], ag: [] },
    ]));
    expect(c.get(1).scored).toBe(150); // 90 (event 2) + (90 - 30)
  });

  it("clamps a stoppage-time goal to 0, never negative", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [94], ag: [] },
    ]));
    expect(c.get(1).scored).toBe(0);
  });

  it("reads conceded from the opponent's list when the club is away", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [10], ag: [80] },
    ]));
    expect(c.get(2).scored).toBe(10);   // BOH scored on 80'
    expect(c.get(2).conceded).toBe(80); // SHE scored on 10'
  });

  it("takes the last goal, not the first, when a match has several", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [5, 60, 85], ag: [] },
    ]));
    expect(c.get(1).scored).toBe(5); // 90 - 85
  });

  it("reports an open clock as the minutes actually observed, not the ceiling", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 2, kickoff: day(8), home: 1, away: 2, hg: [], ag: [] },
    ]));
    expect(c.get(1).scoredOpen).toBe(true);
    expect(c.get(1).scored).toBe(180); // 2 matches of evidence, NOT 450
    expect(c.get(1).span).toBe(180);
    expect(c.get(1).matches).toBe(2);
  });

  it("excludes a null-scored import: no minutes, and no window slot", () => {
    // Six matches, the most recent unplayed. The window must hold the five
    // scored ones, so the 20' goal in event 1 stays inside it.
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [20], ag: [] },
      { eventId: 2, kickoff: day(8), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 3, kickoff: day(7), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 4, kickoff: day(6), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 5, kickoff: day(5), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 6, kickoff: day(4), home: 1, away: 2, hs: null, as: null },
    ]));
    expect(c.get(1).matches).toBe(5);
    expect(c.get(1).span).toBe(450);
    expect(c.get(1).scored).toBe(430); // 4 * 90 + (90 - 20)
    expect(c.get(1).scoredOpen).toBe(false);
  });

  it("windows to the last n matches and forgets anything older", () => {
    // A goal six matches ago is outside a five-match window.
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [45], ag: [] },
      { eventId: 2, kickoff: day(8), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 3, kickoff: day(7), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 4, kickoff: day(6), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 5, kickoff: day(5), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 6, kickoff: day(4), home: 1, away: 2, hg: [], ag: [] },
    ]));
    expect(c.get(1).matches).toBe(5);
    expect(c.get(1).scoredOpen).toBe(true);
    expect(c.get(1).scored).toBe(450);
  });

  it("honours the n argument", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [45], ag: [] },
      { eventId: 2, kickoff: day(8), home: 1, away: 2, hg: [], ag: [] },
      { eventId: 3, kickoff: day(7), home: 1, away: 2, hg: [], ag: [] },
    ]), 2);
    expect(c.get(1).matches).toBe(2);
    expect(c.get(1).scored).toBe(180);
    expect(c.get(1).scoredOpen).toBe(true);
  });

  it("gives a club with no qualifying matches no entry at all", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hs: null, as: null },
    ]));
    expect(c.has(1)).toBe(false);
    expect(c.has(2)).toBe(false);
  });

  it("keys by teamId as a number, matching the record fields", () => {
    const c = teamGoalClocks(clockSeed([
      { eventId: 1, kickoff: day(9), home: 1, away: 2, hg: [70], ag: [] },
    ]));
    expect(c.has(1)).toBe(true);
    expect(c.has("1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "teamGoalClocks"
```

Expected: every test in the block fails with `teamGoalClocks is not a function` (or an import error naming `teamGoalClocks`).

- [ ] **Step 3: Implement `teamGoalClocks`**

In `src/lib/store.js`, immediately after the closing brace of `teamWindowEventIds` (line 462) and before the `// teamId -> { site, withData, missing }` comment that starts `teamSitePoints`, insert:

```js
// How long since each club last scored, and last conceded, in MATCH minutes.
//
// Each match is a flat 90 minutes and goal minutes clamp to [0, 90]: SofaScore
// records stoppage-time goals as time + addedTime (90+4 -> 94) and never reports
// a reliable match end, so a fixed 90 keeps the ceiling exact at 90n and every
// club on one scale. The clock is anchored to the END OF THE LAST MATCH PLAYED,
// never to wall-clock now — a number that drifts every hour cannot be compared
// between two clubs whose last fixtures were on different days.
//
// A club's scored goals are its own goalTimes side and its conceded goals are
// the opponent's; normalize() already credits an own goal to the benefiting
// side, so both lists are correct as they stand.
//
// The imported-AND-scored filter is applied BEFORE taking the last n, and that
// is deliberate — do not "fix" it into agreement with teamWindowEventIds. That
// helper windows on imported-only and lets leagueTable discard null-scored
// matches afterwards, so leagueTable(data, 5) can cover fewer than five played
// games. The clock wants n matches of actual evidence. The two helpers answer
// different questions.
//
// -> Map<teamId (number), { scored, conceded, scoredOpen, concededOpen, span, matches }>
// An OPEN clock (no such goal anywhere in the window) reports the minutes
// actually observed, not the nominal ceiling: a club with two matches in the
// window has 180 minutes of evidence, and reporting 450 would invent three
// matches that were never played. Callers must treat an open clock as a lower
// bound (see fixtures.js).
export const MATCH_MINUTES = 90;

export function teamGoalClocks(data, n = 5) {
  const byTeam = new Map();
  for (const m of Object.values(data.matches)) {
    if (!m.importedAt || !m.goalTimes || m.homeScore == null || m.awayScore == null) continue;
    for (const tid of [m.homeTeamId, m.awayTeamId]) {
      if (!byTeam.has(tid)) byTeam.set(tid, []);
      byTeam.get(tid).push(m);
    }
  }
  const out = new Map();
  for (const [tid, all] of byTeam) {
    all.sort((a, b) => a.kickoff - b.kickoff);
    const window = all.slice(-n);
    // Minutes back to the last goal in `pick`, walking newest match first.
    const clock = (pick) => {
      let mins = 0;
      for (let i = window.length - 1; i >= 0; i--) {
        const m = window[i];
        const goals = pick(m);
        if (goals.length) {
          const last = Math.min(MATCH_MINUTES, Math.max(0, goals[goals.length - 1]));
          return { value: mins + (MATCH_MINUTES - last), open: false };
        }
        mins += MATCH_MINUTES;
      }
      return { value: mins, open: true };
    };
    const own = (m) => (m.homeTeamId === tid ? m.goalTimes.home : m.goalTimes.away);
    const opp = (m) => (m.homeTeamId === tid ? m.goalTimes.away : m.goalTimes.home);
    const s = clock(own);
    const c = clock(opp);
    out.set(tid, {
      scored: s.value, scoredOpen: s.open,
      conceded: c.value, concededOpen: c.open,
      span: window.length * MATCH_MINUTES,
      matches: window.length,
    });
  }
  return out;
}
```

Note: `goalTimes` arrays are already sorted ascending by `normalize()`, so `goals[goals.length - 1]` is the latest goal. The `Math.max(0, ...)` guard is belt-and-braces against a malformed payload; `Math.min(MATCH_MINUTES, ...)` is the stoppage-time clamp the test pins.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js
```

Expected: PASS, whole file — the new block plus every pre-existing `store.test.js` test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: teamGoalClocks — minutes since a club last scored and conceded"
```

---

## Task 2: Fold the clocks into the fixture comparison

**Files:**
- Modify: `src/lib/fixtures.js`
- Test: `test/fixtures.test.js`

### Background you need

Read `src/lib/fixtures.js` end to end first — it is 195 lines and every helper you need is already there (`clamp1`, `sign`, `norm`, `perGame`, `part`).

The contract you are extending:

- `fixtureContext(data)` builds everything shared across all fixtures on the page. It is memoized on `data` in the component, so anything expensive goes here and is computed **once**.
- `sideOf(ctx, teamId)` builds one club's side object, or `null` if the club has no imported matches.
- `compareFixture(ctx, match)` returns `{ home, away, score, parts, fantasyCovered, favoured }` or `null`.
- `score` runs from the **home** side's perspective: positive means home is favoured.
- `lead` is computed from the same `parts` the score uses, so a chip's tint can never disagree with the 🎯 tag. Never re-derive a direction in the component.

### Three things that are easy to get wrong

**1. `side.scored` is already taken.** It is the nested tie-aware rank block `{ pos, form3, form5 }`, read by `compareFixture`, by `posDelta`/`formDelta` in `MatchesTab.jsx`, and by existing tests. **Do not rename it.** The clock's fields are `scoredAgo` and `concededAgo`.

**2. Two open clocks cannot be compared.** When both clubs' clocks on the same half are open, that half's gap is `null`. An open clock is a lower bound; `180'+` and `360'+` differ only because one club has four matches of evidence and the other has two. Subtracting them manufactures a gap out of games played, and it lands often enough on the drastic threshold to manufacture a highlight too. This is the same rule `fantasyCovered` already applies. One open clock against one closed clock **is** still compared — a documented, accepted limitation. Do not widen the suppression.

**3. The drastic threshold lives in `fixtures.js` only.** `compareFixture` returns *which* halves are drastic, so the component never restates 180. CLAUDE.md: single sources of truth, extend them, don't fork them.

### A constraint on the test fixtures you must understand

In a fixture set where SHE and BOH only ever play **each other**, `SHE.concededAgo` and `BOH.scoredAgo` are computed from the same list of goals — so `scoredGap` and `concededGap` are always identical and the two halves can never be tested independently. Every test below therefore has SHE and BOH each play **Derry** (id 3), never each other, via the `clockRuns` helper.

There is a second constraint that follows from the first: if the two clubs' scorelines are identical (needed to make position, points and form level), their goals fall in the same matches, so their clocks can differ by at most 89 minutes. That is why the isolation test uses a 70-minute gap and the drastic tests do not bother keeping the other metrics level.

- [ ] **Step 1: Let the seed helper carry goal minutes**

In `test/fixtures.test.js`, find this inside `seed()` (around line 33):

```js
        goalTimes: { home: [], away: [] }, partial: false,
```

and change it to:

```js
        goalTimes: { home: r.hg ?? [], away: r.ag ?? [] }, partial: false,
```

Every existing fixture omits `hg`/`ag`, so it keeps the empty arrays it has today and every existing test keeps testing what it was written to test.

- [ ] **Step 2: Write the failing tests**

Append to `test/fixtures.test.js`:

```js
// SHE and BOH each play DERRY five times — never each other, so their scored and
// conceded clocks are independent (see the plan's note on this). Each entry is
// one matchday for that club: { gf: [minutes it scored], ga: [minutes it
// conceded] }. Scorelines follow from the list lengths.
const clockRuns = (she, boh) => seed([
  ...she.map((r, i) => ({
    eventId: 500 + i, round: i + 1, kickoff: ago(20 - i),
    home: 1, away: 3, hs: r.gf.length, as: r.ga.length, hg: r.gf, ag: r.ga,
  })),
  ...boh.map((r, i) => ({
    eventId: 550 + i, round: i + 1, kickoff: ago(20 - i) + 3600000,
    home: 2, away: 3, hs: r.gf.length, as: r.ga.length, hg: r.gf, ag: r.ga,
  })),
]);

const G = (gf, ga) => ({ gf, ga });
const pair = () => upcoming(1, 2);

// Identical scorelines both clubs — a 1-1 then four 1-0 wins — so position,
// points and form are dead level and only the goal MINUTES differ. SHE's last
// goal came on 80', BOH's on 10' of the same matchday.
const levelButSharper = () => clockRuns(
  [G([45], [45]), G([45], []), G([45], []), G([45], []), G([80], [])],
  [G([45], [45]), G([45], []), G([45], []), G([45], []), G([10], [])],
);

// SHE score late and often and have not conceded since matchday 1; BOH have not
// scored since matchday 1 and conceded on 45' of the latest.
const sharpVsBlunt = () => clockRuns(
  [G([45], [45]), G([45], []), G([45], []), G([45], []), G([80], [])],
  [G([45], []), G([], []), G([], []), G([], []), G([], [45])],
);

describe("goal clocks in compareFixture", () => {
  it("reads both clocks onto both sides", () => {
    const cmp = compareFixture(fixtureContext(sharpVsBlunt()), pair());
    expect(cmp.home.scoredAgo).toBe(10);        // 90 - 80
    expect(cmp.home.scoredOpen).toBe(false);
    expect(cmp.away.scoredAgo).toBe(405);       // 4 * 90 + (90 - 45)
    expect(cmp.away.scoredOpen).toBe(false);
    expect(cmp.home.concededAgo).toBe(405);     // last conceded on 45' of md1
    expect(cmp.away.concededAgo).toBe(45);      // conceded on 45' of md5
    expect(cmp.home.matches).toBe(5);
    expect(cmp.away.matches).toBe(5);
  });

  it("signs both gaps from the home side and mirrors the lead", () => {
    const cmp = compareFixture(fixtureContext(sharpVsBlunt()), pair());
    expect(cmp.scoredGap).toBe(395);   // away.scoredAgo - home.scoredAgo
    expect(cmp.concededGap).toBe(360); // home.concededAgo - away.concededAgo
    expect(cmp.home.lead.goals).toBe(1);
    expect(cmp.away.lead.goals).toBe(-1);
  });

  it("moves the score on the clocks alone, with every other metric level", () => {
    const cmp = compareFixture(fixtureContext(levelButSharper()), pair());
    // Identical scorelines: SHE and BOH cannot be separated on the table.
    expect(cmp.parts.pos).toBe(0);
    expect(cmp.parts.ppg).toBe(0);
    expect(cmp.parts.form).toBe(0);
    expect(cmp.parts.fpg).toBe(0);
    // SHE scored 10' ago, BOH 80'; both last conceded on 45' of md1.
    expect(cmp.scoredGap).toBe(70);
    expect(cmp.concededGap).toBe(0);
    expect(cmp.parts.goals).toBeCloseTo(70 / 450 / 2, 10);
    expect(cmp.score).toBeCloseTo(0.10 * (70 / 450 / 2), 10);
    expect(cmp.home.lead.goals).toBe(1);
  });

  it("reaches exactly 1 on a maximal gap, and never exceeds it", () => {
    // SHE score on 90' of the latest match (0' ago); BOH never score at all
    // across a full five-match window (450', open). The widest gap possible.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([], []), G([], []), G([], []), G([], []), G([90], [])],
      [G([], []), G([], []), G([], []), G([], []), G([], [])],
    )), pair());
    expect(cmp.home.scoredAgo).toBe(0);
    expect(cmp.away.scoredAgo).toBe(450);
    expect(cmp.away.scoredOpen).toBe(true);
    expect(cmp.scoredGap).toBe(450);
    // Scored half maxes at 1; conceded half is suppressed (nobody conceded).
    expect(cmp.concededGap).toBe(null);
    expect(cmp.parts.goals).toBe(0.5); // (1 + 0) / 2
  });

  it("suppresses a half when BOTH clocks are open, however far apart", () => {
    // Nobody scores or concedes anywhere. SHE have two matches of evidence,
    // BOH five: a 270' difference in how long we looked, and nothing else.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([], []), G([], [])],
      [G([], []), G([], []), G([], []), G([], []), G([], [])],
    )), pair());
    expect(cmp.home.scoredOpen).toBe(true);
    expect(cmp.away.scoredOpen).toBe(true);
    expect(cmp.home.matches).toBe(2);
    expect(cmp.away.matches).toBe(5);
    expect(cmp.home.scoredAgo).toBe(180);
    expect(cmp.away.scoredAgo).toBe(450);
    expect(cmp.scoredGap).toBe(null);   // NOT 270
    expect(cmp.concededGap).toBe(null);
    expect(cmp.parts.goals).toBe(0);
    expect(cmp.drastic.any).toBe(false);
    expect(cmp.home.lead.goals).toBe(0);
  });

  it("still compares one open clock against one closed clock", () => {
    // The accepted limitation — the suppression must not be over-broad.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([45], []), G([45], []), G([45], []), G([45], []), G([45], [])],
      [G([], []), G([], []), G([], []), G([], []), G([], [])],
    )), pair());
    expect(cmp.home.scoredOpen).toBe(false);
    expect(cmp.away.scoredOpen).toBe(true);
    expect(cmp.scoredGap).toBe(405); // 450 - 45
    expect(cmp.scoredGap).not.toBe(null);
  });

  it("flags drastic on the scoring half alone, at exactly 180 and not 179", () => {
    // SHE score on 90' of the latest match (0' ago). BOH's last goal is one
    // match back at minute m, giving 90 + (90 - m). Both concede on 45' of the
    // latest match, so the clean-sheet half is level and cannot be the trigger.
    const at = (m) => compareFixture(fixtureContext(clockRuns(
      [G([], []), G([], []), G([], []), G([], []), G([90], [45])],
      [G([], []), G([], []), G([], []), G([m], []), G([], [45])],
    )), pair());
    const hit = at(0);
    expect(hit.concededGap).toBe(0);
    expect(hit.scoredGap).toBe(180);
    expect(hit.drastic).toEqual({ scored: true, conceded: false, any: true });
    const miss = at(1);
    expect(miss.scoredGap).toBe(179);
    expect(miss.drastic).toEqual({ scored: false, conceded: false, any: false });
  });

  it("flags drastic on the clean-sheet half alone", () => {
    // Both score on 45' of the latest match, so the scoring half is level.
    // SHE concede on 90' of the latest (0' ago); BOH's last concession is one
    // match back on 0', giving 180'.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([45], [90]), G([], []), G([], []), G([], []), G([45], [90])],
      [G([45], []), G([], []), G([], []), G([], [0]), G([45], [])],
    )), pair());
    expect(cmp.scoredGap).toBe(0);
    expect(cmp.concededGap).toBe(-180); // home concedes far more recently
    expect(cmp.drastic).toEqual({ scored: false, conceded: true, any: true });
  });

  it("flags drastic while the combined lead is level — the orthogonal case", () => {
    // SHE both score and concede on 90' of the latest match; BOH last did
    // either on 45' of matchday 1. The two halves are 405' apart in OPPOSITE
    // directions, so they cancel to a zero component — and the divergence is
    // still real, which is exactly why drastic is not folded into the tint.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([], []), G([], []), G([], []), G([], []), G([90], [90])],
      [G([45], [45]), G([], []), G([], []), G([], []), G([], [])],
    )), pair());
    expect(cmp.scoredGap).toBe(405);
    expect(cmp.concededGap).toBe(-405);
    expect(cmp.parts.goals).toBe(0);
    expect(cmp.home.lead.goals).toBe(0);
    expect(cmp.away.lead.goals).toBe(0);
    expect(cmp.drastic).toEqual({ scored: true, conceded: true, any: true });
  });

  it("keeps the weights summing to exactly 1", () => {
    const cmp = compareFixture(fixtureContext(sharpVsBlunt()), pair());
    const { pos, ppg, form, fpg, goals } = cmp.parts;
    expect(Number.isNaN(goals)).toBe(false);
    // Reconstruct the score from the documented weights.
    expect(cmp.score).toBeCloseTo(
      0.18 * pos + 0.27 * ppg + 0.27 * form + 0.18 * fpg + 0.10 * goals, 10);
  });

  it("adds a goals line to the tag's reasons, from the favoured club's view", () => {
    const cmp = compareFixture(fixtureContext(sharpVsBlunt()), pair());
    expect(cmp.favoured).not.toBe(null);
    expect(cmp.favoured.reasons).toContain("goals +395'/+360'");
  });

  it("writes a suppressed half as — in the reasons, never NaN or +0", () => {
    // Both clubs win every match to nil, so the tag fires while neither club
    // has conceded inside their window.
    const cmp = compareFixture(fixtureContext(clockRuns(
      [G([45], []), G([45], []), G([45], []), G([45], []), G([80], [])],
      [G([], []), G([], []), G([], []), G([], []), G([], [])],
    )), pair());
    expect(cmp.concededGap).toBe(null);
    const line = cmp.favoured.reasons.find((r) => r.startsWith("goals "));
    expect(line).toBe("goals +440'/—");
    expect(line).not.toContain("NaN");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fixtures.test.js -t "goal clocks"
```

Expected: FAIL — `cmp.home.scoredAgo` is `undefined`, `cmp.scoredGap` is `undefined`, `cmp.drastic` is `undefined`.

- [ ] **Step 4: Implement the fixtures.js changes**

Six edits.

**4a.** The import line at the top of `src/lib/fixtures.js`:

```js
import { leagueTable, leagueOrder, teamGoalClocks, MATCH_MINUTES } from "./store.js";
```

**4b.** In `fixtureContext`, inside the returned object, after `fpgSpread: spread(all, (r) => perGame(r.fantasy, r.played)),`:

```js
    // Built once for the whole page, like the three league tables above.
    clocks: teamGoalClocks(data, FORM_LONG),
```

**4c.** New constants, directly after the `GRADES` array:

```js
// The goal clocks are a KNOWN scale — 0 to a full window — so they normalise
// against a fixed cap, not against the league's own spread the way ppg and fpg
// do. Spread-normalising a clock would rescale the opening weeks' noise, when
// every club's clocks are small and close together, into a full-strength
// signal. Derived from FORM_LONG so the window and the denominator cannot
// drift apart.
const CAP = FORM_LONG * MATCH_MINUTES;
// Two matches apart on either half. The ONLY definition of the threshold — the
// component reads which halves are drastic, never the number.
const DRASTIC = 2 * MATCH_MINUTES;
```

**4d.** The clock reader, and the new `clockReason`, next to `reason` near the top:

```js
// "goals +395'/+360'" — scored gap then conceded gap, from the favoured club's
// view, matching the chip face. Two values, so it does not go through the
// single-gap `reason()` helper. A suppressed half reads "—", never "NaN".
const clockReason = (dir, scoredGap, concededGap) => {
  const half = (g) => (g == null ? "—" : `${signed(dir * g, 0)}'`);
  return `goals ${half(scoredGap)}/${half(concededGap)}`;
};
```

**4e.** In `sideOf`, add the clock fields. The whole function becomes:

```js
function sideOf(ctx, teamId) {
  const row = ctx.rows.get(teamId);
  if (!row) return null; // no imported matches -> nothing to compare
  // ctx.clocks is keyed by teamId as a NUMBER; teamId here is a string (record
  // fields are numbers, object keys are strings — see CLAUDE.md). Every club in
  // the league table has a clock, so the fallback is unreachable defence.
  const c = ctx.clocks.get(Number(teamId))
    ?? { scored: 0, scoredOpen: true, conceded: 0, concededOpen: true, span: 0, matches: 0 };
  return {
    teamId,
    // What the user sees, and what the Table tab agrees with.
    pos: ctx.table.display.get(teamId),
    form3: ctx.form3.display.get(teamId) ?? null,
    form5: ctx.form5.display.get(teamId) ?? null,
    teamCount: ctx.teamCount,
    played: row.played,
    points: row.points,
    ppg: perGame(row.points, row.played),
    fantasy: row.fantasy,
    fpg: perGame(row.fantasy, row.played),
    // Goal clocks. Named *Ago because `scored` below is the tie-aware rank block
    // and has been since the fixture comparison shipped.
    scoredAgo: c.scored, scoredOpen: c.scoredOpen,
    concededAgo: c.conceded, concededOpen: c.concededOpen,
    span: c.span, matches: c.matches,
    // What the score is computed from: level clubs share a rank.
    scored: {
      pos: ctx.table.scored.get(teamId),
      form3: ctx.form3.scored.get(teamId) ?? null,
      form5: ctx.form5.scored.get(teamId) ?? null,
    },
  };
}
```

**4f.** `compareFixture`. Change the weights line:

```js
const WEIGHTS = { pos: 0.18, ppg: 0.27, form: 0.27, fpg: 0.18, goals: 0.10 };
```

After the existing `fantasyCovered` line, add the two gaps:

```js
  // An open clock is a LOWER BOUND, not a value. Two open clocks differ only by
  // how many matches of evidence each club has — subtracting 180'+ from 450'+
  // manufactures a gap out of games played, and lands often enough on DRASTIC to
  // manufacture a highlight too. Same rule fantasyCovered applies: a data gap is
  // not a signal. One open against one closed IS still compared — a documented,
  // accepted limitation; do not widen this.
  const clockGap = (a, aOpen, b, bOpen) => (aOpen && bOpen ? null : a - b);
  const scoredGap = clockGap(away.scoredAgo, away.scoredOpen, home.scoredAgo, home.scoredOpen);
  const concededGap = clockGap(home.concededAgo, home.concededOpen, away.concededAgo, away.concededOpen);
```

The clocks do **not** go into the `gaps` object — they never pass through `rankGap`. In the `parts` object, after `fpg:`, add:

```js
    // Each half against the same fixed cap; a suppressed half contributes 0 to
    // the mean rather than dropping out of it, exactly as an unranked form
    // window does above.
    goals: (part(scoredGap, CAP) + part(concededGap, CAP)) / 2,
```

Extend `lead`:

```js
  const lead = (dir) => ({
    pos: sign(dir * parts.pos),
    points: sign(dir * parts.ppg),
    form: sign(dir * parts.form),
    fantasy: sign(dir * parts.fpg),
    goals: sign(dir * parts.goals),
  });
```

Extend the score:

```js
  const score = clamp1(
    WEIGHTS.pos * parts.pos + WEIGHTS.ppg * parts.ppg +
    WEIGHTS.form * parts.form + WEIGHTS.fpg * parts.fpg +
    WEIGHTS.goals * parts.goals,
  );
```

Just before the `GRADES.find` line, compute `drastic`:

```js
  // Deliberately NOT folded into the tint. A fixture can read +405 scored and
  // -405 conceded: the halves are drastically apart while the combined lead is
  // level, and there would be no tint to make bold. Keeping the two orthogonal
  // means the highlight can never contradict the 🎯 tag. A suppressed (null)
  // half cannot be drastic. Reported per half so the tooltip can name which —
  // the threshold itself never leaves this file.
  const big = (g) => g != null && Math.abs(g) >= DRASTIC;
  const drastic = { scored: big(scoredGap), conceded: big(concededGap) };
  drastic.any = drastic.scored || drastic.conceded;
```

In the `reasons` array inside `if (hit)`, after the fantasy line:

```js
        clockReason(dir, scoredGap, concededGap),
```

And the return:

```js
  return {
    home: { ...home, lead: lead(1) }, away: { ...away, lead: lead(-1) },
    score, parts, fantasyCovered, scoredGap, concededGap, drastic, favoured,
  };
```

- [ ] **Step 5: Run the whole suite**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test
```

Expected: `test/store.test.js` and `test/fixtures.test.js` PASS in full. `test/matchesTab.test.jsx` **will fail** — the tag tooltip strings it pins now carry the extra `goals …` reason. That is Task 4's job; do not touch it yet. **Every other file must still pass.** If `test/series.test.js` or `test/teamsTab.test.jsx` break, you changed something you should not have.

If one of the new assertions disagrees on an exact minute, recompute by hand from the clock rule — 90 minutes per match walked back from the most recent, plus `90 - lastGoalMinute` in the match where the goal is found — and fix whichever side is wrong. Do not relax an assertion to make it pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fixtures.js test/fixtures.test.js
git commit -m "feat: goal clocks feed the favourable-fixture score at 0.10"
```

---

## Task 3: The chip and its highlight

**Files:**
- Modify: `src/components/MatchesTab.jsx`
- Modify: `src/styles.css` (after line 179)

### Background you need

`SideChips` renders the **same chip order for both sides**; only the values mirror. The visual asymmetry — `fpts` innermost on the home side, outermost on the away side — comes from `.fx-home { justify-content: flex-end }` / `.fx-away { justify-content: flex-start }` in the CSS. The new chip goes **last in `SideChips`**, after `fpts`, for both sides.

Every chip's tint comes from `leadCls(side.lead.X)` and nothing else. Never re-derive a direction in this file, and never restate the 180-minute threshold — `cmp.drastic` already says which halves crossed it.

- [ ] **Step 1: Add the CSS**

In `src/styles.css`, after line 179 (`.cmp-chips .chip.cmp-tag { ... }`), add:

```css
/* A drastic divergence on either goal clock. Composes with any tint —
   cmp-up cmp-hot, cmp-down cmp-hot, or bare cmp-hot when the halves cancel. */
.cmp-chips .chip.cmp-hot { font-weight: 700; box-shadow: inset 0 0 0 1px var(--warn); }
/* cmp-down fades to .55; a highlight that is simultaneously faded is not a
   highlight, so lift it back to readable. */
.cmp-chips .chip.cmp-down.cmp-hot { opacity: .8; }
```

- [ ] **Step 2: Add the helpers**

In `src/components/MatchesTab.jsx`, after `deltaLabel` (ends line 42), add:

```js
// Mirror a home-signed gap onto the away side. `null` (a suppressed half) stays
// null; 0 stays 0 rather than becoming -0, which formats as "-0".
const flip = (g) => (g == null ? null : g === 0 ? 0 : -g);
```

Then after `fantasyTitle` (ends line 145) and before `function TeamLink`, add:

```js
// An open clock is a lower bound: "450'+", never a bare number implying a goal
// was found inside the window.
const clockLabel = (mins, open) => `${mins}'${open ? "+" : ""}`;

// The chip face. Both halves point the same way — positive is good for the club
// the chip sits beside — so a reader never has to remember that one clock reads
// better high and the other better low.
const clockFace = (scored, conceded) => `⚽${deltaLabel(scored)} 🛡${deltaLabel(conceded)}`;

// A suppressed half is an absence of evidence, not a tie. The fpts chip sets the
// precedent: never word a data gap as "level".
const HALVES = {
  scored: {
    noun: "scoring", none: "neither club has scored inside their window",
    ahead: "more recently", behind: "longer without scoring",
  },
  conceded: {
    noun: "clean sheets", none: "neither club has conceded inside their window",
    ahead: "longer unbeaten at the back", behind: "less time since conceding",
  },
};
const halfPhrase = (gap, key) => {
  const w = HALVES[key];
  if (gap == null) return `${w.noun} not compared: ${w.none}`;
  if (gap === 0) return `level on ${w.noun}`;
  return `${Math.abs(gap)}' ${gap > 0 ? w.ahead : w.behind}`;
};

// Names WHICH halves crossed the threshold — a highlight the reader cannot
// attribute is noise. The threshold itself lives only in fixtures.js.
const drasticClause = (drastic) => {
  const hits = [drastic.scored && "scoring", drastic.conceded && "clean-sheet"].filter(Boolean);
  if (!hits.length) return "";
  return `; ${hits.length === 2 ? "both gaps" : `${hits[0]} gap`} drastic (two matches apart)`;
};

const clockTitle = (side, opp, oppName, scoredGap, concededGap, drastic) => {
  const mine = `goal clock: last scored ${clockLabel(side.scoredAgo, side.scoredOpen)} ago,`
    + ` last conceded ${clockLabel(side.concededAgo, side.concededOpen)} ago`;
  // Say how much evidence each clock rests on when the two clubs differ — the
  // same honesty gamesClause gives the points chip.
  const span = side.matches === opp.matches
    ? ` (last ${side.matches})`
    : ` (last ${side.matches} v ${oppName} ${opp.matches})`;
  const theirs = ` v ${oppName} ${clockLabel(opp.scoredAgo, opp.scoredOpen)}`
    + ` / ${clockLabel(opp.concededAgo, opp.concededOpen)}`;
  const body = `${halfPhrase(scoredGap, "scored")}, ${halfPhrase(concededGap, "conceded")}`;
  return `${mine}${span}${theirs} — ${body}${drasticClause(drastic)}`;
};
```

- [ ] **Step 3: Render the chip**

Change the `SideChips` signature from:

```js
function SideChips({ side, opp, oppName, covered, tag, tagTitle, tagFirst }) {
```

to:

```js
function SideChips({ side, opp, oppName, covered, scoredGap, concededGap, drastic, tag, tagTitle, tagFirst }) {
```

Immediately after the existing `fpts` chip and before `{!tagFirst && tagEl}`, insert:

```js
      <span className={`chip${leadCls(side.lead.goals)}${drastic.any ? " cmp-hot" : ""}`}
        title={clockTitle(side, opp, oppName, scoredGap, concededGap, drastic)}>
        {clockFace(scoredGap, concededGap)}
      </span>
```

**The gaps are signed from the home side**, so the away group gets them flipped. Replace the two `<SideChips>` call sites in the JSX:

```jsx
                {cmp && <SideChips side={cmp.home} opp={cmp.away} oppName={awayName} covered={cmp.fantasyCovered}
                  scoredGap={cmp.scoredGap} concededGap={cmp.concededGap} drastic={cmp.drastic}
                  tag={favHome ? cmp.favoured.tag : null} tagTitle={tagTitle} tagFirst />}
```

```jsx
                {cmp && <SideChips side={cmp.away} opp={cmp.home} oppName={homeName} covered={cmp.fantasyCovered}
                  scoredGap={flip(cmp.scoredGap)} concededGap={flip(cmp.concededGap)} drastic={cmp.drastic}
                  tag={favAway ? cmp.favoured.tag : null} tagTitle={tagTitle} />}
```

- [ ] **Step 4: Verify it compiles**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run build
```

Expected: build succeeds. `npm test` will still show `matchesTab.test.jsx` failures — Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchesTab.jsx src/styles.css
git commit -m "feat: goal-clock chip on upcoming fixtures, bold when drastic"
```

---

## Task 4: Update and extend the MatchesTab SSR tests

**Files:**
- Modify: `test/matchesTab.test.jsx`

### Background you need

This file renders `MatchesTab` through `renderToStaticMarkup` and asserts on exact HTML strings. Adding a fifth chip and a new tag reason **breaks several existing assertions by design**. Update them; do not weaken them into `toContain("pos")`-style shape checks.

The file's `seed()` helper passes an empty `goalTimes` alongside non-zero scores, so **every existing fixture has two open clocks on both clubs** → both halves suppressed → a fully neutral `⚽— 🛡—` chip with no `cmp-hot`. That is why the existing tint and tag assertions survive with only the fifth chip added.

React escapes `'` as `&#x27;` in the SSR output, so a tooltip containing `10'` is asserted as `10&#x27;`. The em dash `—` and the emoji pass through unescaped.

Unlike Task 2's fixtures, these are head-to-head SHE v BOH, so `scoredGap` and `concededGap` are necessarily equal — that is fine for a rendering smoke test, and the independent-halves cases are already covered in `fixtures.test.js`.

- [ ] **Step 1: Let the seed helper carry goal minutes**

In `test/matchesTab.test.jsx`, change **only** the `goalTimes` line inside `seed()`:

```js
        goalTimes: { home: r.hg ?? [], away: r.ag ?? [] }, partial: false,
```

- [ ] **Step 2: Add a face extractor for the new chip**

Directly below the existing `faces` helper, add:

```js
// The goal-clock chip's two halves: { scored: "+400", conceded: "+400" }.
const clock = (group) => {
  const m = group.match(/>⚽([^ ]+) 🛡([^<]+)</);
  return m ? { scored: m[1], conceded: m[2] } : null;
};
```

- [ ] **Step 3: Fix the two broken assertions**

**3a.** Rename `it("gives each side its own group of four chips")` and fix the counts:

```js
  it("gives each side its own group of five chips", () => {
    const { home, away } = upcoming(seeded());
    expect(chipCount(home)).toBe(6); // five chips plus the 🎯 tag
    expect(chipCount(away)).toBe(5);
    expect(Object.keys(faces(home))).toEqual(["pos", "pts", "form", "fpts"]);
    expect(Object.keys(faces(away))).toEqual(["pos", "pts", "form", "fpts"]);
    expect(clock(home)).not.toBe(null);
    expect(clock(away)).not.toBe(null);
    // Each group's tooltips name the *other* club, which is what identifies it.
    expect(home).toContain("v BOH 2nd of 2 — 1 place better");
    expect(away).toContain("v SHE 1st of 2 — 1 place worse");
  });
```

**3b.** In `it("tags the favoured club, beside its own name, and only that club")`, the `TAG` constant gains the goals reason. Both clocks are suppressed in `seeded()`, so both halves read `—`:

```js
    const TAG = '<span class="chip cmp-tag" title="favourable for SHE (mismatch): position +1, points +3.00/game, form +1.0, fantasy —, goals —/—">🎯🎯🎯</span>';
```

`it("puts the away side's tag last, next to the away club's name")` asserts `expect(away).toMatch(/cmp-tag[^>]*>🎯🎯🎯<\/span>$/)`. The tag is still rendered last on the away side (`{!tagFirst && tagEl}` comes after the clock chip), so this assertion is **unchanged** — verify it passes rather than editing it.

- [ ] **Step 4: Add the new tests**

Append to `test/matchesTab.test.jsx`:

```js
// SHE scored on 80' of their latest match (10' ago); BOH's last goal was four
// matches back on 40', giving 4 * 90 + 50 = 410'. The concessions mirror,
// because these two only ever play each other. Both gaps: 400'.
const sharpVsBlunt = () => fixture(seed([
  { eventId: 501, round: 1, kickoff: ago(9), home: 1, away: 2, hs: 1, as: 1, hg: [10], ag: [40] },
  { eventId: 502, round: 2, kickoff: ago(8), home: 1, away: 2, hs: 1, as: 0, hg: [10], ag: [] },
  { eventId: 503, round: 3, kickoff: ago(7), home: 1, away: 2, hs: 1, as: 0, hg: [10], ag: [] },
  { eventId: 504, round: 4, kickoff: ago(6), home: 1, away: 2, hs: 1, as: 0, hg: [10], ag: [] },
  { eventId: 505, round: 5, kickoff: ago(5), home: 1, away: 2, hs: 1, as: 0, hg: [80], ag: [] },
]), { round: 6 });

describe("MatchesTab goal clocks", () => {
  it("shows both clocks as one mirrored chip", () => {
    const { home, away } = upcoming(sharpVsBlunt());
    expect(clock(home)).toEqual({ scored: "+400", conceded: "+400" });
    expect(clock(away)).toEqual({ scored: "-400", conceded: "-400" });
  });

  it("tints the leading side, dims the trailing side, and bolds both", () => {
    const { home, away } = upcoming(sharpVsBlunt());
    expect(home).toMatch(/<span class="chip cmp-up cmp-hot" title="goal clock:[^"]*">⚽\+400 🛡\+400<\/span>/);
    expect(away).toMatch(/<span class="chip cmp-down cmp-hot" title="goal clock:[^"]*">⚽-400 🛡-400<\/span>/);
  });

  it("quotes both clubs' raw clocks and names which halves are drastic", () => {
    const { home } = upcoming(sharpVsBlunt());
    expect(home).toContain("last scored 10&#x27; ago, last conceded 410&#x27; ago (last 5)");
    expect(home).toContain("v BOH 410&#x27; / 10&#x27;");
    expect(home).toContain("both gaps drastic");
    expect(home).not.toContain("NaN");
    expect(home).not.toContain("null");
  });

  it("calls two open clocks not compared, never level", () => {
    // The stock fixtures carry no goal times at all, so every clock is open.
    const { home, away, row } = upcoming(seeded());
    expect(clock(home)).toEqual({ scored: "—", conceded: "—" });
    expect(clock(away)).toEqual({ scored: "—", conceded: "—" });
    expect(home).toContain("not compared: neither club has scored inside their window");
    expect(home).toContain("not compared: neither club has conceded inside their window");
    expect(home).not.toContain("level on scoring");
    expect(row).not.toContain("cmp-hot");
  });

  it("marks an open clock as a lower bound with a trailing +", () => {
    const { home } = upcoming(seeded());
    // SHE have two matches of evidence and no goal times: 180'+, not 180'.
    expect(home).toContain("last scored 180&#x27;+ ago");
  });

  it("leaves a small gap unbolded and says nothing about drastic", () => {
    // BOH's last goal is one match back on 80': a 90' gap, under the threshold.
    const { row, home } = upcoming(fixture(seed([
      { eventId: 511, round: 1, kickoff: ago(9), home: 1, away: 2, hs: 1, as: 1, hg: [10], ag: [80] },
      { eventId: 512, round: 2, kickoff: ago(8), home: 1, away: 2, hs: 1, as: 0, hg: [80], ag: [] },
    ]), { round: 3 }));
    expect(clock(home)).toEqual({ scored: "+90", conceded: "+90" });
    expect(row).not.toContain("cmp-hot");
    expect(home).not.toContain("drastic");
  });

  it("names both clubs' match counts when they differ", () => {
    // SHE 2 matches, BOH 3 — BOH have an extra fixture against Derry.
    const { home } = upcoming(fixture(seed([
      { eventId: 521, round: 1, kickoff: ago(9), home: 1, away: 2, hs: 1, as: 1, hg: [10], ag: [40] },
      { eventId: 522, round: 2, kickoff: ago(8), home: 1, away: 2, hs: 1, as: 0, hg: [10], ag: [] },
      { eventId: 523, round: 3, kickoff: ago(7), home: 2, away: 3, hs: 1, as: 0, hg: [20], ag: [] },
    ], WITH_DERRY), { round: 4 }, WITH_DERRY));
    expect(home).toContain("(last 2 v BOH 3)");
  });

  it("shows no clock chip on a played fixture", () => {
    const played = rows(render(sharpVsBlunt()))[1];
    expect(played).not.toContain("⚽");
    expect(played).not.toContain("🛡");
  });
});
```

- [ ] **Step 5: Run the whole suite**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test
```

Expected: PASS, every file. If an assertion disagrees on an exact minute, recompute by hand from the clock rule rather than relaxing the assertion.

- [ ] **Step 6: Commit**

```bash
git add test/matchesTab.test.jsx
git commit -m "test: SSR coverage for the goal-clock chip"
```

---

## Task 5: Ship it

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Bump the version**

`0.26.0` → `0.27.0` (a feature, not a fix). Edit the `"version"` line in `package.json`, then sync the lockfile:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm install --package-lock-only
```

The version renders in the app footer and is the user's cache tell — never skip it.

- [ ] **Step 2: Full verification**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test && npm run build
```

Expected: all suites pass, build succeeds. Both must be green before committing — `npm run build` catches JSX errors the node-environment tests cannot.

- [ ] **Step 3: Commit and push**

```bash
git add package.json package-lock.json
git commit -m "feat: minutes since last scored and conceded on the Matches tab (v0.27.0)"
git push origin main
```

Pushing to `main` triggers GitHub Actions → Pages at https://seaninryan.github.io/fancystats/.

- [ ] **Step 4: Manual check after deploy**

Interaction coverage is manual in this project (the tests are SSR-only). On the deployed site, Matches tab, an upcoming fixture:

1. The fifth chip renders `⚽±n 🛡±n` beside each club.
2. Hovering shows both clubs' raw clocks and, where it applies, the drastic clause.
3. The two sides' numbers mirror exactly.
4. Where the numbers are big, the chip is visibly bolder than its neighbours — and still readable on the dimmed trailing side.
5. The footer reads `v0.27.0`.

---

## Notes for whoever executes this

- **`npm test` runs every suite.** After each task, the only file allowed to be red is the one the task's own step says will be red. Anything else means you broke something.
- **Do not cache anything derived.** The clocks recompute at render time from `matches`, which is what makes a round override or an adjustment retroactively fix the comparison. See CLAUDE.md.
- **Never test SofaScore endpoints with curl** — the API 403-blocks curl and Node TLS fingerprints. Nothing in this plan needs the network.
- **Object keys are strings, record fields are numbers.** `ctx.clocks` is keyed by number and `sideOf` receives a string; the `Number(teamId)` coercion in Task 2 Step 3c is load-bearing.
