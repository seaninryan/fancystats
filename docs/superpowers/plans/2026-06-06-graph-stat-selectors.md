# Graph Stat Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stat selector on the Players tab graph (`FPts | G | Ast | Yel | Red`) and six more team stats on the Table tab graph (`P | W | D | L | GF | GA` ahead of the existing five).

**Architecture:** Generalize the two series functions in `src/lib/series.js`; extract a shared per-appearance stat helper so player- and team-level count stats use identical (leagueTable) conventions. Players tab gets the same stat-button children the Table tab already uses; Table tab needs no component change. Spec: `docs/superpowers/specs/2026-06-06-graph-stat-selectors-design.md`.

**Tech Stack:** unchanged (React 18, recharts, Vitest).

---

## ⚠️ Environment

System Node is v14. Prefix every npm/npx command:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## Fixture expectations cheat-sheet

The existing `fixture()` in `test/series.test.js`: M100 R1 t1 1-0 t2 (p10/t1/FWD scores 1; p20/t2/MID plays); M101 R2 t2 2-2 t1 (p10 subbed off; p20: 1 assist, 1 yellow); M102 R4 t1 3-0 t2 (only p20 plays: yellow + second yellow). Round 3 empty.

---

### Task 1: Generalize `playerWeeklySeries` + `PLAYER_STATS` + shared `appearanceStat`

**Files:**
- Modify: `src/lib/series.js`
- Modify: `test/series.test.js`

- [ ] **Step 1: Write the failing tests**

Append this new describe block at the end of `test/series.test.js` (no import changes needed — `playerWeeklySeries` is already imported):

```js
describe("playerWeeklySeries stats", () => {
  it("goals", () => {
    expect(values(playerWeeklySeries(fixture(), 10, "goals"))).toEqual([1, 0, null, 0]);
  });
  it("assists", () => {
    expect(values(playerWeeklySeries(fixture(), 20, "assists"))).toEqual([0, 1, null, 0]);
  });
  it("yellows count the second yellow as a yellow too", () => {
    expect(values(playerWeeklySeries(fixture(), 20, "yellows"))).toEqual([0, 1, null, 2]);
  });
  it("reds count dismissals", () => {
    expect(values(playerWeeklySeries(fixture(), 20, "reds"))).toEqual([0, 0, null, 1]);
  });
  it("goal adjustments apply", () => {
    const d = setAdjustment(fixture(), "100:10", { goals: 1 });
    expect(values(playerWeeklySeries(d, 10, "goals"))).toEqual([2, 0, null, 0]);
  });
  it("count stats work for positionless players (only fantasy needs a position)", () => {
    const d = setPlayerField(fixture(), 10, "gamePosition", null);
    expect(values(playerWeeklySeries(d, 10, "goals"))).toEqual([1, 0, null, 0]);
    expect(values(playerWeeklySeries(d, 10))).toEqual([null, null, null, null]);
  });
  it("defaults to fantasy", () => {
    expect(values(playerWeeklySeries(fixture(), 10))).toEqual([9, 3, null, 0]);
  });
});
```

(No import change needed for this block; `PLAYER_STATS` is consumed by the component, not the tests.)

- [ ] **Step 2: Run `npx vitest run test/series.test.js`** — expect the new block to FAIL (stat argument ignored; goals test gets fantasy values [9,3,null,0]).

- [ ] **Step 3: Implement**

In `src/lib/series.js`:

**(a)** Insert ABOVE `playerWeeklySeries`:

```js
// Stat selector for the Players tab graph: [key, button label].
export const PLAYER_STATS = [
  ["fantasy", "FPts"], ["goals", "G"], ["assists", "Ast"], ["yellows", "Yel"], ["reds", "Red"],
];

// One appearance's contribution to a stat. Count-stat conventions mirror
// leagueTable so graphs agree with the table columns at both levels.
function appearanceStat(a, m, position, adj, stat) {
  if (stat === "fantasy") return scoreAppearance(a, m, position, adj).total;
  const eff = { ...a };
  if (adj) {
    for (const f of ["goals", "assists"]) {
      if (typeof adj[f] === "number") eff[f] = Math.max(0, (eff[f] || 0) + adj[f]);
    }
    if (typeof adj.secondYellow === "boolean") eff.secondYellow = adj.secondYellow;
    if (typeof adj.red === "boolean") eff.red = adj.red;
  }
  if (stat === "goals") return eff.goals || 0;
  if (stat === "assists") return eff.assists || 0;
  if (stat === "yellows") return (eff.yellow || 0) + (eff.secondYellow ? 1 : 0); // the second yellow is a yellow too
  return (eff.red ? 1 : 0) + (eff.secondYellow ? 1 : 0); // reds: dismissals
}
```

**(b)** Replace the whole `playerWeeklySeries` function (keep its comment block, updating it) with:

```js
// One player's per-gameweek value. stat: "fantasy" | "goals" | "assists" |
// "yellows" | "reds". null = the player's team had no imported match that
// round (gap); 0 = team played but the player contributed nothing (or didn't
// appear). Fantasy needs a gamePosition to score (matching the Pts column's
// ❗); the count stats don't.
export function playerWeeklySeries(data, playerId, stat = "fantasy") {
  const rounds = importedRounds(data);
  const player = data.players[playerId];
  const position = player?.gamePosition;
  if (!player || (stat === "fantasy" && !position)) {
    return rounds.map((round) => ({ round, value: null }));
  }
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
    byRound.set(r, (byRound.get(r) || 0) + appearanceStat(a, m, position, adj, stat));
  }
  return rounds.map((round) => ({ round, value: byRound.has(round) ? byRound.get(round) : null }));
}
```

- [ ] **Step 4: Run `npx vitest run test/series.test.js`** — all 28 tests PASS (21 existing + 7 new; the existing fantasy tests pin the default-arg behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: per-stat playerWeeklySeries (goals/assists/cards)"
```

---

### Task 2: Team result stats + `TEAM_STATS` reorder

**Files:**
- Modify: `src/lib/series.js`
- Modify: `test/series.test.js`

- [ ] **Step 1: Write the failing tests** — APPEND at the end of `test/series.test.js`:

```js
describe("teamWeeklySeries result stats", () => {
  const d = fixture();
  it("played", () => {
    expect(values(teamWeeklySeries(d, 1, "played"))).toEqual([1, 1, null, 1]);
    expect(values(teamWeeklySeries(d, 2, "played"))).toEqual([1, 1, null, 1]);
  });
  it("won / drawn / lost", () => {
    expect(values(teamWeeklySeries(d, 1, "won"))).toEqual([1, 0, null, 1]);
    expect(values(teamWeeklySeries(d, 1, "drawn"))).toEqual([0, 1, null, 0]);
    expect(values(teamWeeklySeries(d, 2, "lost"))).toEqual([1, 0, null, 1]);
  });
  it("goals for / against", () => {
    expect(values(teamWeeklySeries(d, 1, "gf"))).toEqual([1, 2, null, 3]);
    expect(values(teamWeeklySeries(d, 1, "ga"))).toEqual([0, 2, null, 0]);
    expect(values(teamWeeklySeries(d, 2, "gf"))).toEqual([0, 2, null, 0]);
    expect(values(teamWeeklySeries(d, 2, "ga"))).toEqual([1, 2, null, 3]);
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/series.test.js`** — expect the new block to FAIL (e.g. "played" returns [0, 0, null, 0] because the current code only adds for stat === "points").

- [ ] **Step 3: Implement**

In `src/lib/series.js`:

**(a)** Replace the `TEAM_STATS` constant with (table-column order):

```js
// Stat selector for the Table tab graph: [key, button label].
export const TEAM_STATS = [
  ["played", "P"], ["won", "W"], ["drawn", "D"], ["lost", "L"], ["gf", "GF"], ["ga", "GA"],
  ["points", "Pts"], ["fantasy", "FPts"], ["yellows", "Yel"], ["reds", "Red"], ["assists", "Ast"],
];

// Stats computed from the match result (vs from appearances).
const RESULT_STATS = new Set(["points", "played", "won", "drawn", "lost", "gf", "ga"]);
```

**(b)** In `teamWeeklySeries`, update the function comment's stat list to `"points" (league 3/1/0) | "played" | "won" | "drawn" | "lost" | "gf" | "ga" | "fantasy" | "yellows" | "reds" | "assists"`, and replace the match-loop scoring block:

```js
    let v = byRound.get(r) || 0;
    if (stat === "points" && m.homeScore != null && m.awayScore != null) {
      const gf = m.homeTeamId === tid ? m.homeScore : m.awayScore;
      const ga = m.homeTeamId === tid ? m.awayScore : m.homeScore;
      v += gf > ga ? 3 : gf === ga ? 1 : 0;
    }
    byRound.set(r, v);
```

with:

```js
    let v = byRound.get(r) || 0;
    if (RESULT_STATS.has(stat) && m.homeScore != null && m.awayScore != null) {
      const gf = m.homeTeamId === tid ? m.homeScore : m.awayScore;
      const ga = m.homeTeamId === tid ? m.awayScore : m.homeScore;
      v += stat === "points" ? (gf > ga ? 3 : gf === ga ? 1 : 0)
        : stat === "played" ? 1
        : stat === "won" ? (gf > ga ? 1 : 0)
        : stat === "drawn" ? (gf === ga ? 1 : 0)
        : stat === "lost" ? (gf < ga ? 1 : 0)
        : stat === "gf" ? gf
        : ga;
    }
    byRound.set(r, v);
```

**(c)** Replace the appearance-loop guard `if (stat !== "points") {` with `if (!RESULT_STATS.has(stat)) {`, and replace the loop's per-appearance body (the `eff` adjustment block and the `let v = 0; if (stat === "assists") ... else if (stat === "fantasy") {...}` chain) with the shared helper:

```js
      const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
      const p = data.players[a.playerId];
      if (stat === "fantasy" && !p?.gamePosition) continue; // no computable points
      byRound.set(r, (byRound.get(r) || 0) + appearanceStat(a, m, p?.gamePosition, adj, stat));
```

(This removes the duplicated `eff`/adjustment code — `appearanceStat` from Task 1 has identical conventions, including the `Math.max(0, ...)` assists clamp.)

- [ ] **Step 4: Run `npx vitest run test/series.test.js`** — all 31 tests PASS (the 7 existing teamWeeklySeries tests prove the refactor preserved fantasy/yellows/reds/assists/points behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/series.js test/series.test.js
git commit -m "feat: team result stats (P/W/D/L/GF/GA) in teamWeeklySeries"
```

---

### Task 3: Players tab stat buttons

**Files:**
- Modify: `src/components/PlayersTab.jsx`

- [ ] **Step 1: Wire the stat selector**

**(a)** Change the series.js import to include `PLAYER_STATS`:

```js
import { playerWeeklySeries, PLAYER_STATS } from "../lib/series.js";
```

**(b)** Add after the `cumulative` useState:

```js
const [stat, setStat] = useState("fantasy");
```

**(c)** In the `chartSeries` memo: change the call to `points: playerWeeklySeries(data, id, stat),` and the deps to `[data, selected, stat]`.

**(d)** Give GameweekChart the stat buttons as children — replace the self-closing usage:

```jsx
<GameweekChart series={chartSeries} cumulative={cumulative}
  onToggleCumulative={() => setCumulative((c) => !c)}
  onClear={() => setSelected(new Set())} />
```

with:

```jsx
<GameweekChart series={chartSeries} cumulative={cumulative}
  onToggleCumulative={() => setCumulative((c) => !c)}
  onClear={() => setSelected(new Set())}>
  {PLAYER_STATS.map(([key, label]) => (
    <button key={key} className={stat === key ? "primary" : ""} onClick={() => setStat(key)}>{label}</button>
  ))}
</GameweekChart>
```

No TableTab change — its buttons already render from `TEAM_STATS`.

- [ ] **Step 2: Run `npx vitest run && npm run build`** — 8 files / 165 tests pass (31 in series suite), build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlayersTab.jsx
git commit -m "feat: stat selector on the Players tab graph"
```

---

### Task 4: Final verification

- [ ] Full suite + build (already done in Task 3 Step 2 — re-run if anything changed since).
- [ ] Manual check after deploy: Players tab → select players → flip `FPts/G/Ast/Yel/Red` (positionless ❗ players now chart on everything except FPts); Table tab → 11 buttons in table-column order, climbing P/W/GF curves with cumulative on.
