# Gameweek Graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selectable per-gameweek line graphs — fantasy points per player on the Players tab; league points/fantasy/yellows/reds/assists per team (with cumulative toggle) on the Table tab.

**Architecture:** New pure derivation module `src/lib/series.js` turns `matches` + `appearances` + `adjustments` into `[{ round, value }]` series at render time (nothing pre-computed, consistent with the existing data model). A shared `GameweekChart` component wraps a Recharts `LineChart`. Both tabs hold a session-only `Set` of selected row ids; clicking a row toggles its line.

**Tech Stack:** React 18, Recharts (new dependency), Vite 5, Vitest. Spec: `docs/superpowers/specs/2026-06-06-gameweek-graphs-design.md`.

---

## ⚠️ Environment: Node version trap

The system Node is **v14** — Vite 5, Vitest 2 and Recharts need Node ≥18. nvm has v20.20.2 installed. **Prefix every `npm`/`npx` command in this plan with:**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

Verify once before starting: `node --version` must print `v20.20.2` (after the export).

## File structure

| File | Responsibility |
|---|---|
| `src/lib/series.js` (create) | Pure per-gameweek series derivation: `importedRounds`, `accumulate`, `playerWeeklySeries`, `teamWeeklySeries`, `chartRows`, `TEAM_STATS` |
| `test/series.test.js` (create) | Unit tests for everything in series.js |
| `src/components/GameweekChart.jsx` (create) | Shared Recharts line-chart card: cumulative toggle, clear button, stat-selector slot (children) |
| `test/gameweekChart.test.jsx` (create) | SSR smoke test for GameweekChart |
| `src/components/PlayersTab.jsx` (modify) | Row-click selection, name-click opens detail, chart on top |
| `src/components/TableTab.jsx` (modify) | Row-click selection, chart + stat buttons on top |
| `src/styles.css` (modify) | `tr.selected` highlight rules |
| `package.json` (modify) | Add recharts |

## Domain conventions you must know

- **Gameweek = effective round**: always `matchRound(m)` (`roundOverride ?? round`) from `src/lib/store.js:58`, never `m.round` directly.
- **"Imported" match** = `m.importedAt && m.goalTimes`. Anything else (stubs, postponed) is invisible to stats.
- **Adjustments** are user-entered deltas keyed `"<eventId>:<playerId>"` in `data.adjustments`; `scoreAppearance(app, match, position, adj)` (`src/lib/scoring.js:41`) applies them itself when passed.
- **Object keys are strings, record fields are numbers**: `data.players` keys are `"10"` but `appearance.playerId` is `10`. Compare with `String(...)`/`Number(...)` coercion, as existing code does (`src/lib/store.js:102`).
- **Gaps vs zeros** (from the spec): a round where the team has no imported match → `null` (line gap); team played but player didn't appear / scored nothing → `0`; player with no `gamePosition` → all `null` (no computable points, matching the ❗ Pts column).

---

### Task 1: Install Recharts

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /home/sean/workspace/fancystats
npm install recharts
```

Expected: exits 0; `package.json` gains `"recharts": "^3..."` (or ^2) under dependencies.

- [ ] **Step 2: Verify existing tests still pass**

```bash
npm test
```

Expected: all existing suites PASS (6 test files).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add recharts for gameweek graphs"
```

---

### Task 2: `series.js` — `importedRounds` + `accumulate`

**Files:**
- Create: `src/lib/series.js`
- Create: `test/series.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/series.test.js` exactly as below. The `fixture()` helper builds a 2-team, 3-match dataset (rounds 1, 2, 4 — round 3 deliberately empty so every series shows a gap) and is reused by Tasks 3–4.

Score cheat-sheet for the expected values (rules in `src/lib/scoring.js`):
- Player 10 (FWD, team 1): R1 full match 3 + win 2 + goal 4 = **9**; R2 started-subbed-off 2 + draw 1 = **3**; R4 team played, no appearance = **0**.
- Player 20 (MID, team 2): R1 full match 3 + loss 0 = **3**; R2 full 3 + draw 1 + assist 3 + yellow −1 = **6**; R4 started-subbed-off 2 + yellow −1 + second yellow −2 = **−1**.

```js
// test/series.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, setPlayerField, setAdjustment, setMatchRound, upsertMatchStubs,
} from "../src/lib/store.js";
// NOTE: import only what exists so far — Tasks 3-5 each add their function here.
import { importedRounds, accumulate } from "../src/lib/series.js";

const NOW = 1765000000000;

const app = (over) => ({
  started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F",
  goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false,
  penMissed: 0, penSaved: 0, ...over,
});

// Rounds 1, 2 and 4 imported; round 3 deliberately empty -> a gap for everyone.
function fixture() {
  let d = emptyData();
  d = applyImport(d, {
    match: { eventId: 100, round: 1, kickoff: 1764000000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }, { id: 20, name: "C Smith", teamId: 2 }],
    appearances: [
      app({ eventId: 100, playerId: 10, teamId: 1, goals: 1 }),
      app({ eventId: 100, playerId: 20, teamId: 2, positionPlayed: "M" }),
    ],
  }, NOW);
  d = applyImport(d, {
    match: { eventId: 101, round: 2, kickoff: 1764600000000, status: "finished", homeTeamId: 2, awayTeamId: 1, homeScore: 2, awayScore: 2, goalTimes: { home: [10, 50], away: [30, 70] }, partial: false },
    teams: [], players: [],
    appearances: [
      app({ eventId: 101, playerId: 10, teamId: 1, subOffMin: 60, minutes: 60 }),
      app({ eventId: 101, playerId: 20, teamId: 2, positionPlayed: "M", assists: 1, yellow: 1 }),
    ],
  }, NOW);
  d = applyImport(d, {
    match: { eventId: 102, round: 4, kickoff: 1765800000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 3, awayScore: 0, goalTimes: { home: [10, 20, 30], away: [] }, partial: false },
    teams: [], players: [],
    appearances: [
      app({ eventId: 102, playerId: 20, teamId: 2, positionPlayed: "M", yellow: 1, secondYellow: true, subOffMin: 80, minutes: 80 }),
    ],
  }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  d = setPlayerField(d, 20, "gamePosition", "MID");
  return d;
}

const values = (series) => series.map((p) => p.value);
const rounds = (series) => series.map((p) => p.round);

describe("importedRounds", () => {
  it("is empty with no imported matches", () => {
    expect(importedRounds(emptyData())).toEqual([]);
  });
  it("spans min..max imported round inclusive, keeping empty rounds on the axis", () => {
    expect(importedRounds(fixture())).toEqual([1, 2, 3, 4]);
  });
  it("ignores un-imported stubs", () => {
    const d = upsertMatchStubs(fixture(), [
      { eventId: 200, round: 8, kickoff: 1766000000000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null },
    ], []);
    expect(importedRounds(d)).toEqual([1, 2, 3, 4]);
  });
  it("respects roundOverride", () => {
    const d = setMatchRound(fixture(), 102, 3);
    expect(importedRounds(d)).toEqual([1, 2, 3]);
  });
});

describe("accumulate", () => {
  it("keeps running total across gaps without breaking the sum", () => {
    expect(accumulate([
      { round: 1, value: 2 }, { round: 2, value: null }, { round: 3, value: 5 },
    ])).toEqual([
      { round: 1, value: 2 }, { round: 2, value: null }, { round: 3, value: 7 },
    ]);
  });
  it("handles empty input", () => {
    expect(accumulate([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /home/sean/workspace/fancystats
npx vitest run test/series.test.js
```

Expected: FAIL — `Failed to load ../src/lib/series.js` (module doesn't exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/series.js`:

```js
// src/lib/series.js
// Per-gameweek chart series, derived at render time from matches/appearances —
// nothing pre-computed, consistent with the rest of the data model.
import { scoreAppearance } from "./scoring.js";
import { matchRound } from "./store.js";

const imported = (m) => m.importedAt && m.goalTimes;

// X-axis domain: every round from the first imported round to the last,
// inclusive — rounds with no imported match stay on the axis as gaps.
export function importedRounds(data) {
  let min = Infinity, max = -Infinity;
  for (const m of Object.values(data.matches)) {
    if (!imported(m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    if (r < min) min = r;
    if (r > max) max = r;
  }
  if (min === Infinity) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

// Running total for the cumulative toggle. Gaps (null) stay gaps in the line
// but don't reset the sum.
export function accumulate(points) {
  let sum = 0;
  return points.map(({ round, value }) =>
    ({ round, value: value == null ? null : (sum += value) }));
}
```

- [ ] **Step 4: Run tests to verify the new ones pass**

```bash
npx vitest run test/series.test.js
```

Expected: PASS — `importedRounds` (4 tests) and `accumulate` (2 tests) all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: gameweek series foundations (importedRounds, accumulate)"
```

---

### Task 3: `playerWeeklySeries`

**Files:**
- Modify: `src/lib/series.js`
- Modify: `test/series.test.js`

- [ ] **Step 1: Write the failing tests**

Add `playerWeeklySeries` to the import from `../src/lib/series.js`, then append to `test/series.test.js`:

```js
describe("playerWeeklySeries", () => {
  it("scores per round: gap when team did not play, 0 when player sat out", () => {
    const s = playerWeeklySeries(fixture(), 10);
    expect(rounds(s)).toEqual([1, 2, 3, 4]);
    expect(values(s)).toEqual([9, 3, null, 0]); // R4: team played, no appearance
  });
  it("works for the away-team player too", () => {
    expect(values(playerWeeklySeries(fixture(), 20))).toEqual([3, 6, null, -1]);
  });
  it("accepts string player ids (object-key form)", () => {
    expect(values(playerWeeklySeries(fixture(), "10"))).toEqual([9, 3, null, 0]);
  });
  it("includes adjustments", () => {
    const d = setAdjustment(fixture(), "100:10", { goals: 1 });
    expect(values(playerWeeklySeries(d, 10))).toEqual([13, 3, null, 0]); // +1 FWD goal = +4
  });
  it("respects roundOverride", () => {
    const d = setMatchRound(fixture(), 102, 3);
    expect(values(playerWeeklySeries(d, 10))).toEqual([9, 3, 0]);
  });
  it("is all null for a player with no game position", () => {
    const d = setPlayerField(fixture(), 10, "gamePosition", null);
    expect(values(playerWeeklySeries(d, 10))).toEqual([null, null, null, null]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/series.test.js
```

Expected: FAIL — `playerWeeklySeries` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/series.js`:

```js
// Fantasy points per gameweek for one player. null = the player's team had no
// imported match that round (gap); 0 = team played but the player didn't score
// (or didn't appear). No gamePosition -> no computable points -> all null,
// matching the Pts column's ❗.
export function playerWeeklySeries(data, playerId) {
  const rounds = importedRounds(data);
  const player = data.players[playerId];
  const position = player?.gamePosition;
  if (!position) return rounds.map((round) => ({ round, value: null }));
  const byRound = new Map();
  for (const m of Object.values(data.matches)) {
    if (!imported(m) || (m.homeTeamId !== player.teamId && m.awayTeamId !== player.teamId)) continue;
    const r = matchRound(m);
    if (r != null && !byRound.has(r)) byRound.set(r, 0);
  }
  for (const a of Object.values(data.appearances)) {
    if (String(a.playerId) !== String(playerId)) continue;
    const m = data.matches[a.eventId];
    if (!m || !imported(m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    byRound.set(r, (byRound.get(r) || 0) + scoreAppearance(a, m, position, adj).total);
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/series.test.js
```

Expected: PASS (all describe blocks so far).

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: playerWeeklySeries — fantasy points per gameweek"
```

---

### Task 4: `teamWeeklySeries` + `TEAM_STATS`

**Files:**
- Modify: `src/lib/series.js`
- Modify: `test/series.test.js`

- [ ] **Step 1: Write the failing tests**

Add `teamWeeklySeries` to the test file's series.js import, then append:

```js
describe("teamWeeklySeries", () => {
  const d = fixture();
  it("league points per round (W=3 D=1 L=0), gap when not playing", () => {
    expect(values(teamWeeklySeries(d, 1, "points"))).toEqual([3, 1, null, 3]);
    expect(values(teamWeeklySeries(d, 2, "points"))).toEqual([0, 1, null, 0]);
  });
  it("fantasy points sum the team's players", () => {
    expect(values(teamWeeklySeries(d, 1, "fantasy"))).toEqual([9, 3, null, 0]);
    expect(values(teamWeeklySeries(d, 2, "fantasy"))).toEqual([3, 6, null, -1]);
  });
  it("yellows count the second yellow as a yellow too (leagueTable convention)", () => {
    expect(values(teamWeeklySeries(d, 2, "yellows"))).toEqual([0, 1, null, 2]);
  });
  it("reds count dismissals (straight red or second yellow)", () => {
    expect(values(teamWeeklySeries(d, 2, "reds"))).toEqual([0, 0, null, 1]);
  });
  it("assists", () => {
    expect(values(teamWeeklySeries(d, 2, "assists"))).toEqual([0, 1, null, 0]);
  });
  it("applies adjustments like leagueTable does", () => {
    const adj = setAdjustment(d, "101:20", { assists: 1 });
    expect(values(teamWeeklySeries(adj, 2, "assists"))).toEqual([0, 2, null, 0]);
  });
  it("respects roundOverride", () => {
    const moved = setMatchRound(d, 102, 3);
    expect(values(teamWeeklySeries(moved, 1, "points"))).toEqual([3, 1, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/series.test.js
```

Expected: FAIL — `teamWeeklySeries` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/series.js`. The card/assist/fantasy accounting deliberately mirrors `leagueTable` (`src/lib/store.js:408-430`) so the graph always agrees with the table columns:

```js
// Stat selector for the Table tab graph: [key, button label].
export const TEAM_STATS = [
  ["points", "Pts"], ["fantasy", "FPts"], ["yellows", "Yel"], ["reds", "Red"], ["assists", "Ast"],
];

// One team's per-gameweek value. stat: "points" (league 3/1/0) | "fantasy" |
// "yellows" | "reds" | "assists". Accounting mirrors leagueTable so the graph
// always agrees with the table columns.
export function teamWeeklySeries(data, teamId, stat) {
  const rounds = importedRounds(data);
  const tid = Number(teamId);
  const byRound = new Map();
  for (const m of Object.values(data.matches)) {
    if (!imported(m) || (m.homeTeamId !== tid && m.awayTeamId !== tid)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    let v = byRound.get(r) || 0;
    if (stat === "points" && m.homeScore != null && m.awayScore != null) {
      const gf = m.homeTeamId === tid ? m.homeScore : m.awayScore;
      const ga = m.homeTeamId === tid ? m.awayScore : m.homeScore;
      v += gf > ga ? 3 : gf === ga ? 1 : 0;
    }
    byRound.set(r, v);
  }
  if (stat !== "points") {
    for (const a of Object.values(data.appearances)) {
      if (a.teamId !== tid) continue;
      const m = data.matches[a.eventId];
      if (!m || !imported(m)) continue;
      const r = matchRound(m);
      if (r == null) continue;
      const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
      const eff = { ...a };
      if (adj) {
        if (typeof adj.assists === "number") eff.assists = Math.max(0, (eff.assists || 0) + adj.assists);
        if (typeof adj.secondYellow === "boolean") eff.secondYellow = adj.secondYellow;
        if (typeof adj.red === "boolean") eff.red = adj.red;
      }
      let v = 0;
      if (stat === "assists") v = eff.assists || 0;
      else if (stat === "yellows") v = (eff.yellow || 0) + (eff.secondYellow ? 1 : 0); // the second yellow is a yellow too
      else if (stat === "reds") v = (eff.red ? 1 : 0) + (eff.secondYellow ? 1 : 0);    // dismissals
      else if (stat === "fantasy") {
        const p = data.players[a.playerId];
        if (p?.gamePosition) v = scoreAppearance(a, m, p.gamePosition, adj).total;
      }
      byRound.set(r, (byRound.get(r) || 0) + v);
    }
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/series.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: teamWeeklySeries — per-gameweek team stats"
```

---

### Task 5: `chartRows` pivot helper

**Files:**
- Modify: `src/lib/series.js`
- Modify: `test/series.test.js`

- [ ] **Step 1: Write the failing tests**

Add `chartRows` to the test file's series.js import, then append:

```js
describe("chartRows", () => {
  it("pivots series into one row per round keyed by series key", () => {
    expect(chartRows([
      { key: "a", label: "A", color: "#fff", points: [{ round: 1, value: 2 }, { round: 2, value: null }] },
      { key: "b", label: "B", color: "#000", points: [{ round: 1, value: 0 }, { round: 2, value: 4 }] },
    ])).toEqual([
      { round: 1, a: 2, b: 0 },
      { round: 2, a: null, b: 4 },
    ]);
  });
  it("is empty for no series", () => {
    expect(chartRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/series.test.js
```

Expected: FAIL — `chartRows` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/series.js`:

```js
// Pivot series into recharts rows: [{ round, [series.key]: value }]. All series
// share the importedRounds() x-domain, so index i is the same round everywhere.
export function chartRows(series) {
  if (!series.length) return [];
  return series[0].points.map((p, i) => {
    const row = { round: p.round };
    for (const s of series) row[s.key] = s.points[i].value;
    return row;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/series.test.js
```

Expected: PASS — full series suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: chartRows pivot for recharts"
```

---

### Task 6: `GameweekChart` component

**Files:**
- Create: `src/components/GameweekChart.jsx`
- Create: `test/gameweekChart.test.jsx`

- [ ] **Step 1: Write the failing smoke test**

Create `test/gameweekChart.test.jsx` (SSR render — no jsdom needed; the controls render outside `ResponsiveContainer`, which is what we assert on):

```jsx
// test/gameweekChart.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GameweekChart from "../src/components/GameweekChart.jsx";

const series = [
  { key: "10", label: "A Keena", color: "#0e7a3c", points: [{ round: 1, value: 9 }, { round: 2, value: null }, { round: 3, value: 3 }] },
  { key: "20", label: "C Smith", color: "#c8102e", points: [{ round: 1, value: 3 }, { round: 2, value: 6 }, { round: 3, value: -1 }] },
];

describe("GameweekChart", () => {
  it("renders nothing with no series", () => {
    expect(renderToStaticMarkup(
      <GameweekChart series={[]} cumulative={false} onToggleCumulative={() => {}} onClear={() => {}} />,
    )).toBe("");
  });
  it("renders controls and children without crashing", () => {
    const html = renderToStaticMarkup(
      <GameweekChart series={series} cumulative onToggleCumulative={() => {}} onClear={() => {}}>
        <button>Pts</button>
      </GameweekChart>,
    );
    expect(html).toContain("Cumulative");
    expect(html).toContain("Clear");
    expect(html).toContain("Pts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/gameweekChart.test.jsx
```

Expected: FAIL — cannot resolve `../src/components/GameweekChart.jsx`.

- [ ] **Step 3: Write the component**

Create `src/components/GameweekChart.jsx`:

```jsx
// Shared per-gameweek line chart card (Players + Table tabs). Children render
// into the control row — the Table tab puts its stat-selector buttons there.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { accumulate, chartRows } from "../lib/series.js";

// Same-club selections share a colour; dash patterns keep the lines apart.
const DASHES = [undefined, "5 3", "2 2", "8 3 2 3"];

export default function GameweekChart({ series, cumulative, onToggleCumulative, onClear, children }) {
  if (!series.length) return null;
  const shown = cumulative ? series.map((s) => ({ ...s, points: accumulate(s.points) })) : series;
  const rows = chartRows(shown);
  if (!rows.length) return null;
  const seenColor = new Map();
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 4 }}>
        {children}
        <button className={cumulative ? "primary" : ""} onClick={onToggleCumulative}>Cumulative</button>
        <button onClick={onClear} style={{ marginLeft: "auto" }}>Clear</button>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis dataKey="round" stroke="var(--dim)" fontSize={12} />
          <YAxis stroke="var(--dim)" fontSize={12} allowDecimals={false} width={36} />
          <Tooltip labelFormatter={(r) => `Gameweek ${r}`}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8 }} />
          <Legend />
          {shown.map((s) => {
            const n = seenColor.get(s.color) || 0;
            seenColor.set(s.color, n + 1);
            return (
              <Line key={s.key} dataKey={s.key} name={s.label} type="monotone"
                stroke={s.color} strokeWidth={2} strokeDasharray={DASHES[n % DASHES.length]}
                dot={{ r: 2, fill: s.color }} connectNulls={false} isAnimationActive={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/gameweekChart.test.jsx
```

Expected: PASS. (If recharts SSR throws on `ResponsiveContainer`, the fallback is to assert only that the empty-series case returns `""` and that rendering the full case doesn't throw — but recharts v2+ supports SSR, so expect a clean pass.)

- [ ] **Step 5: Commit**

```bash
git add src/components/GameweekChart.jsx test/gameweekChart.test.jsx
git commit -m "feat: shared GameweekChart component"
```

---

### Task 7: Players tab — selection + chart

**Files:**
- Modify: `src/components/PlayersTab.jsx`
- Modify: `src/styles.css`

Behavior change (from the spec): row click now **toggles chart selection** (it used to open PlayerDetail); clicking the **player name cell** opens PlayerDetail. The Last 3/5/All window buttons do NOT affect the graph — it always shows the full season.

- [ ] **Step 1: Add the selection highlight CSS**

Append to `src/styles.css`:

```css
/* gameweek-graph row selection */
tr.selected td { background: #e9f3ee; }
.sticky-col tr.selected td:first-child { background: #e9f3ee; } /* beat the sticky-col bg override */
```

(The second rule is required: `.sticky-col td:first-child` at `src/styles.css:34` sets `background: var(--bg)` with higher specificity than `tr.selected td`.)

- [ ] **Step 2: Wire selection state and chart into PlayersTab**

In `src/components/PlayersTab.jsx`:

**(a)** Add imports after the existing ones (lines 1–4):

```js
import { playerWeeklySeries } from "../lib/series.js";
import GameweekChart from "./GameweekChart.jsx";
```

**(b)** Add state after the existing `useState` calls (after line 26):

```js
const [selected, setSelected] = useState(() => new Set()); // player ids for the graph
const [cumulative, setCumulative] = useState(false);
const toggleSelected = (id) => setSelected((prev) => {
  const next = new Set(prev);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
});
```

**(c)** Add the chart series memo after the `rows` memo (after line 46). Selection is independent of filters — a filtered-out player stays charted:

```js
const chartSeries = useMemo(() => [...selected].flatMap((id) => {
  const p = data.players[id];
  if (!p) return [];
  return [{
    key: String(id), label: playerName(p),
    color: teamColor(data.teams[p.teamId]).bg,
    points: playerWeeklySeries(data, id),
  }];
}), [data, selected]);
```

**(d)** Render the chart at the top of the returned div — insert directly after `<div>` (line 66), before the filter row:

```jsx
<GameweekChart series={chartSeries} cumulative={cumulative}
  onToggleCumulative={() => setCumulative((c) => !c)}
  onClear={() => setSelected(new Set())} />
```

**(e)** Change the row rendering (lines 102–103). Replace:

```jsx
<tr key={r.id} onClick={() => openPlayer(r.id)} style={{ cursor: "pointer" }}>
  <td>{r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}{r.name}</td>
```

with:

```jsx
<tr key={r.id} onClick={() => toggleSelected(r.id)}
  className={selected.has(r.id) ? "selected" : ""} style={{ cursor: "pointer" }}>
  <td className="cell-click" title="open player details"
    onClick={(e) => { e.stopPropagation(); openPlayer(r.id); }}>
    {r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}{r.name}</td>
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: all suites PASS (no component tests cover PlayersTab; this catches import/syntax breakage via the build graph of other tests).

- [ ] **Step 4: Build to catch JSX errors**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayersTab.jsx src/styles.css
git commit -m "feat: player selection + points-per-gameweek graph on Players tab"
```

---

### Task 8: Table tab — selection + chart + stat selector

**Files:**
- Modify: `src/components/TableTab.jsx`

- [ ] **Step 1: Wire selection, stat and chart into TableTab**

In `src/components/TableTab.jsx`:

**(a)** Replace the imports (lines 1–3) with:

```js
import { useMemo, useState } from "react";
import { leagueTable } from "../lib/store.js";
import { teamWeeklySeries, TEAM_STATS } from "../lib/series.js";
import { teamColor } from "../lib/teamColors.js";
import GameweekChart from "./GameweekChart.jsx";
import { TeamPill } from "./Pills.jsx";
```

**(b)** Add state after the existing `useState` calls (after line 13):

```js
const [selected, setSelected] = useState(() => new Set()); // team ids for the graph
const [stat, setStat] = useState("points");
const [cumulative, setCumulative] = useState(true); // season progress by default
const toggleSelected = (id) => setSelected((prev) => {
  const next = new Set(prev);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
});
```

**(c)** Add the chart series memo after the `rows` memo (after line 19):

```js
const chartSeries = useMemo(() => [...selected].flatMap((tid) => {
  const team = data.teams[tid];
  if (!team) return [];
  return [{
    key: String(tid), label: team.shortName || team.name,
    color: teamColor(team).bg,
    points: teamWeeklySeries(data, tid, stat),
  }];
}), [data, selected, stat]);
```

**(d)** Render the chart at the top of the returned div — insert directly after `<div>` (line 22), before the window-buttons row. The stat-selector buttons go in as children:

```jsx
<GameweekChart series={chartSeries} cumulative={cumulative}
  onToggleCumulative={() => setCumulative((c) => !c)}
  onClear={() => setSelected(new Set())}>
  {TEAM_STATS.map(([key, label]) => (
    <button key={key} className={stat === key ? "primary" : ""} onClick={() => setStat(key)}>{label}</button>
  ))}
</GameweekChart>
```

**(e)** Change the row rendering (line 45). Replace:

```jsx
<tr key={r.teamId}>
```

with:

```jsx
<tr key={r.teamId} onClick={() => toggleSelected(r.teamId)}
  className={selected.has(r.teamId) ? "selected" : ""} style={{ cursor: "pointer" }}>
```

- [ ] **Step 2: Run the full test suite and build**

```bash
npx vitest run && npm run build
```

Expected: all PASS, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/TableTab.jsx
git commit -m "feat: team selection + gameweek stat graph on Table tab"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full suite**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd /home/sean/workspace/fancystats
npx vitest run
```

Expected: 8 test files, all PASS.

- [ ] **Step 2: Manual verification in the browser**

```bash
npm run dev
```

Open the printed URL (the app loads data from Google Drive after sign-in, or use Settings → paste import; an empty dataset shows no chart, which is correct). Verify:

1. **Players tab:** click 2–3 player rows → rows highlight, chart card appears at top with one line per player in team colors, legend shows names, X-axis = gameweeks. Rounds the team didn't play show line gaps; weeks the player sat out show 0.
2. Click a player's **name** → PlayerDetail opens (row selection unchanged when you go back).
3. **Cumulative** button → lines become running totals. **Clear** → chart disappears, highlights gone.
4. Window buttons (Last 3/5) change the table but NOT the chart.
5. **Table tab:** click 2 team rows → chart appears with stat buttons `Pts FPts Yel Red Ast`, cumulative ON by default (climbing league-points lines). Switch stats → lines update. Toggle cumulative off → per-week values.
6. Two players/teams from the same club → second line gets a dashed pattern.

- [ ] **Step 3: Done — hand back for review**

No scheduled follow-ups; selection is session-only by design.
