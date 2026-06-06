# Players Climbers (± Column) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sortable ± (form vs baseline) column on the Players tab while a Last 3/5 window is active.

**Architecture:** One pure function `playerClimb` in `src/lib/store.js` (reuses `teamImportedMatches` + `playerTotals`); PlayersTab splices a `climb` column in when windowed. Spec: `docs/superpowers/specs/2026-06-06-players-climbers-design.md`.

---

## ⚠️ Environment

System Node is v14. Prefix every npm/npx command:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

### Task 1: `playerClimb`

**Files:**
- Modify: `src/lib/store.js`
- Modify: `test/store.test.js`

- [ ] **Step 1: Write the failing tests**

Add `playerClimb` and `teamWindowEventIds` (already imported? check — `teamWindowEventIds` IS already in the import list; add only `playerClimb`) to the big import in `test/store.test.js`, then APPEND this describe block at the end of the file.

Score cheat-sheet (rules in src/lib/scoring.js): p60 (FWD): M401 full+loss = 3; M402 full+loss = 3; M403 full+win+goal = 9; M404 full+win+2 goals = 13. p61 (MID): M401 full+loss+assist = 6; M402 full+loss = 3; M403/404 absent. With win=3 the window is {402,403,404} (3 team matches), prior {401} (1 match):
- p60: (3+9+13)/3 − 3/1 = 8.333 − 3 = **+5.333**
- p61: (3+0+0)/3 − 6/1 = 1 − 6 = **−5.0**

```js
describe("playerClimb", () => {
  const appC = (eventId, playerId, over = {}) => ({
    eventId, playerId, teamId: 11, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...over,
  });
  const matchC = (eventId, round, kickoff, homeScore, awayScore, goalTimes) => ({
    eventId, round, kickoff, status: "finished", homeTeamId: 11, awayTeamId: 12,
    homeScore, awayScore, goalTimes, partial: false,
  });
  function climbFixture() {
    let d = emptyData();
    const imports = [
      { match: matchC(401, 1, NOW + 1000, 0, 1, { home: [], away: [50] }),
        appearances: [appC(401, 60), appC(401, 61, { positionPlayed: "M", assists: 1 })] },
      { match: matchC(402, 2, NOW + 2000, 0, 2, { home: [], away: [20, 70] }),
        appearances: [appC(402, 60), appC(402, 61, { positionPlayed: "M" })] },
      { match: matchC(403, 3, NOW + 3000, 2, 0, { home: [10, 20], away: [] }),
        appearances: [appC(403, 60, { goals: 1 })] },
      { match: matchC(404, 4, NOW + 4000, 3, 0, { home: [5, 15, 25], away: [] }),
        appearances: [appC(404, 60, { goals: 2 })] },
    ];
    for (const imp of imports) {
      d = applyImport(d, {
        ...imp,
        teams: [{ id: 11, name: "Climb FC", shortName: "CLI" }, { id: 12, name: "Sink FC", shortName: "SNK" }],
        players: [{ id: 60, name: "U Pward", teamId: 11 }, { id: 61, name: "D Ownward", teamId: 11 }],
      }, NOW);
    }
    d = setPlayerField(d, 60, "gamePosition", "FWD");
    d = setPlayerField(d, 61, "gamePosition", "MID");
    return d;
  }
  const win3 = (d) => teamWindowEventIds(d, 3).get(11);
  it("positive for an improving player (per team-match, window vs prior)", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: win3(d) })).toBeCloseTo(16 / 3, 5);
  });
  it("negative for a declining player; absences drag the window down", () => {
    const d = climbFixture();
    expect(playerClimb(d, 61, { windowIds: win3(d) })).toBeCloseTo(-5, 5);
  });
  it("null when the window spans all imported matches (no baseline)", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: teamWindowEventIds(d, 5).get(11) })).toBeNull();
  });
  it("null without a fantasy position", () => {
    const d = setPlayerField(climbFixture(), 60, "gamePosition", null);
    expect(playerClimb(d, 60, { windowIds: win3(d) })).toBeNull();
  });
  it("null for an empty or missing window", () => {
    const d = climbFixture();
    expect(playerClimb(d, 60, { windowIds: new Set() })).toBeNull();
    expect(playerClimb(d, 60, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/store.test.js`** — expect FAIL: `playerClimb` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/store.js`, directly below `teamWindowEventIds`, ADD:

```js
// Form vs baseline: fantasy points per TEAM match in the window minus the same
// over all earlier imported matches. Per team-match (not per appearance) so
// sitting out drags form down, consistent with the hot rule. null without a
// position, an empty window, or no baseline games (can't climb vs nothing).
export function playerClimb(data, playerId, { apps = null, windowIds } = {}) {
  const player = data.players[playerId];
  if (!player?.gamePosition || !windowIds?.size) return null;
  const prior = teamImportedMatches(data, player.teamId)
    .filter((m) => !windowIds.has(m.eventId));
  if (!prior.length) return null;
  const priorIds = new Set(prior.map((m) => m.eventId));
  const w = playerTotals(data, playerId, { apps, eventIds: windowIds }).points ?? 0;
  const p = playerTotals(data, playerId, { apps, eventIds: priorIds }).points ?? 0;
  return w / windowIds.size - p / priorIds.size;
}
```

(`teamImportedMatches` already exists just above `hotEventIds`.)

- [ ] **Step 4: Run `npx vitest run test/store.test.js`** — 73 pass (68 existing + 5 new). Then `npx vitest run` — full suite, 177.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: playerClimb — form vs baseline per team match"
```

---

### Task 2: ± column on the Players tab

**Files:**
- Modify: `src/components/PlayersTab.jsx`

- [ ] **Step 1: Wire it in**

**(a)** Add `playerClimb` to the store.js import list (line 2).

**(b)** In the `rows` useMemo, add a `climb` field to the returned row object (after the `hot:` line, before the `...playerTotals(...)` spread):

```js
climb: windows ? playerClimb(data, id, { apps, windowIds: windows.get(p.teamId) || new Set() }) : null,
```

**(c)** Make the column list dynamic. After the `rows` useMemo (before `shown`), add:

```js
// ± only means something relative to a window
const cols = win === "all" ? COLS : [...COLS.slice(0, 5), ["climb", "±"], ...COLS.slice(5)];
```

and change the header render loop from `{COLS.map(([key, label]) => (` to `{cols.map(([key, label]) => (`.

**(d)** In the body row, insert the climb cell between the points `<td>` (the one with `err-cell`) and `<td>{r.goals}</td>`:

```jsx
{win !== "all" && (
  <td>{r.climb == null ? "—" : <span className={r.climb >= 0 ? "gain" : "loss"}>{(r.climb >= 0 ? "+" : "") + r.climb.toFixed(1)}</span>}</td>
)}
```

**(e)** Window buttons: switching to "All" while sorted by ± must fall back to Pts. Change the window-button onClick from:

```jsx
<button key={w} className={win === w ? "primary" : ""} onClick={() => setWin(w)}>
```

to:

```jsx
<button key={w} className={win === w ? "primary" : ""}
  onClick={() => { setWin(w); if (w === "all" && sort.key === "climb") setSort({ key: "points", dir: -1 }); }}>
```

Make NO other changes. (The existing sort comparator already sinks nulls, so "—" rows go to the bottom in either direction.)

- [ ] **Step 2: Run `npx vitest run && npm run build`** — 177 tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/PlayersTab.jsx
git commit -m "feat: ± climbers column on the Players tab"
```

---

### Task 3: Final verification

- [ ] Full suite + build.
- [ ] Manual after deploy: Players tab → Last 3 → ± column appears with green/red one-decimal values; sort desc = climbers, asc = fallers, "—" rows sink; newcomers and positionless players show "—"; switch to All → column gone, sort sane; filters (⭐, team, position) compose with the column.
