# Teams Grid Hot + Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-week 🔥 in Teams-grid match cells (hot-after-that-match, same rules as the Players-tab filter) and frozen Player/Pos/Min/G/A/Pts columns on desktop.

**Architecture:** New pure `hotEventIds()` in `src/lib/store.js` becomes the single source of the hot rule; `isHot` delegates to it. TeamsTab consumes the set per row. Freezing is pure CSS (sticky + fixed widths/offsets) behind a `.freeze-stats` class, with a `.player-cell` flex wrapper so name length can't break the offsets. Spec: `docs/superpowers/specs/2026-06-06-teams-grid-hot-freeze-design.md`.

---

## ⚠️ Environment

System Node is v14. Prefix every npm/npx command:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

### Task 1: `hotEventIds` + `isHot` delegation

**Files:**
- Modify: `src/lib/store.js`
- Modify: `test/store.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/store.test.js`, add `hotEventIds` to the big import from `../src/lib/store.js`, then APPEND this describe block at the end of the file.

Score cheat-sheet (FWD, rules in src/lib/scoring.js): M301 full match 3 + win 2 + goal 4 = **9**; M302 full 3 + draw 1 + goal 4 = **8** (pins the ≥8 boundary); M303 full 3 + loss 0 = **3**; M304 no appearance = **slot consumed, no score**. Windows (≥2 matches required): after M301 → too few; after M302 → [9,8] = hot; after M303 → [9,8,3] = hot; after M304 → [8,3,—] = not hot.

```js
describe("hotEventIds", () => {
  const appOf = (eventId, over = {}) => ({
    eventId, playerId: 50, teamId: 7, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...over,
  });
  const matchOf = (eventId, round, kickoff, homeScore, awayScore, goalTimes) => ({
    eventId, round, kickoff, status: "finished", homeTeamId: 7, awayTeamId: 8,
    homeScore, awayScore, goalTimes, partial: false,
  });
  function hotFixture() {
    let d = emptyData();
    const imports = [
      { match: matchOf(301, 1, NOW + 1000, 2, 0, { home: [10, 20], away: [] }),
        appearances: [appOf(301, { goals: 1 })] },
      { match: matchOf(302, 2, NOW + 2000, 1, 1, { home: [30], away: [60] }),
        appearances: [appOf(302, { goals: 1 })] },
      { match: matchOf(303, 3, NOW + 3000, 0, 1, { home: [], away: [70] }),
        appearances: [appOf(303)] },
      { match: matchOf(304, 4, NOW + 4000, 0, 0, { home: [], away: [] }),
        appearances: [] },
    ];
    for (const imp of imports) {
      d = applyImport(d, {
        ...imp,
        teams: [{ id: 7, name: "Hot FC", shortName: "HOT" }, { id: 8, name: "Cold FC", shortName: "COL" }],
        players: [{ id: 50, name: "S Treak", teamId: 7 }],
      }, NOW);
    }
    return setPlayerField(d, 50, "gamePosition", "FWD");
  }
  it("flags matches after which the trailing window satisfies the hot rule", () => {
    expect([...hotEventIds(hotFixture(), 50)].sort()).toEqual([302, 303]);
  });
  it("exactly 8 points counts (>= threshold)", () => {
    // M302 scores exactly 8 and is one of the two qualifying games for both flames
    expect(hotEventIds(hotFixture(), 50).has(302)).toBe(true);
  });
  it("sitting out consumes a window slot", () => {
    // after M304 the window is [8, 3, absent] -> only one qualifying game
    expect(hotEventIds(hotFixture(), 50).has(304)).toBe(false);
  });
  it("needs at least two team matches in the window", () => {
    expect(hotEventIds(hotFixture(), 50).has(301)).toBe(false);
  });
  it("is empty for positionless players", () => {
    const d = setPlayerField(hotFixture(), 50, "gamePosition", null);
    expect(hotEventIds(d, 50).size).toBe(0);
  });
  it("agrees with isHot on the latest match", () => {
    const d = hotFixture();
    expect(isHot(d, 50)).toBe(hotEventIds(d, 50).has(304));
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/store.test.js`** — expect FAIL: `hotEventIds` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/store.js`, directly below the `HOT_NEEDED` constant, ADD:

```js
// Imported team matches in kickoff order — the spine of the hot windows.
function teamImportedMatches(data, teamId) {
  return Object.values(data.matches)
    .filter((m) => m.importedAt && m.goalTimes && (m.homeTeamId === teamId || m.awayTeamId === teamId))
    .sort((a, b) => a.kickoff - b.kickoff);
}

// EventIds of team matches AFTER which the player was hot: the trailing
// HOT_WINDOW team matches (ending at that match) include >= HOT_NEEDED games
// of >= HOT_THRESHOLD points. Missing a game consumes a slot. Single source
// of the hot rule — isHot is "hot after the latest match".
export function hotEventIds(data, playerId, appsArg = null) {
  const out = new Set();
  const player = data.players[playerId];
  if (!player?.gamePosition) return out;
  const teamMatches = teamImportedMatches(data, player.teamId);
  const apps = appsArg ?? playerAppearances(data, playerId);
  const byEvent = new Map(apps.map((a) => [a.eventId, a]));
  const scores = teamMatches.map((m) => {
    const a = byEvent.get(m.eventId);
    if (!a) return null; // didn't play that one — consumes a slot
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    return scoreAppearance(a, m, player.gamePosition, adj).total;
  });
  for (let i = 0; i < teamMatches.length; i++) {
    const from = Math.max(0, i - HOT_WINDOW + 1);
    if (i - from + 1 < HOT_NEEDED) continue; // not enough matches yet
    let good = 0;
    for (let j = from; j <= i; j++) if (scores[j] != null && scores[j] >= HOT_THRESHOLD) good++;
    if (good >= HOT_NEEDED) out.add(teamMatches[i].eventId);
  }
  return out;
}
```

Then REPLACE the whole existing `isHot` function (keep its 🔥 comment block above the constants — only the function body changes) with:

```js
export function isHot(data, playerId, appsArg = null) {
  const player = data.players[playerId];
  if (!player?.gamePosition) return false;
  const teamMatches = teamImportedMatches(data, player.teamId);
  if (!teamMatches.length) return false;
  return hotEventIds(data, playerId, appsArg).has(teamMatches[teamMatches.length - 1].eventId);
}
```

- [ ] **Step 4: Run `npx vitest run test/store.test.js`** — ALL tests pass (61 existing + 6 new = 67), proving the isHot refactor preserved behavior. Then `npx vitest run` — full suite (171).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: hotEventIds — per-match hot windows; isHot delegates"
```

---

### Task 2: Cell flames in TeamsTab

**Files:**
- Modify: `src/components/TeamsTab.jsx`

- [ ] **Step 1: Wire it in**

**(a)** Add `hotEventIds` to the store.js import list (line 2).

**(b)** In the `playerIds.map((pid) => {...})` row body, the apps are currently filtered twice. Replace:

```js
const err = missingFantasyData(p, apps.filter((x) => x.playerId === pid));
// window = the player's current team's last games (same on every page)
const hot = isHot(data, pid, apps.filter((x) => x.playerId === pid));
```

with:

```js
const playerApps = apps.filter((x) => x.playerId === pid);
const err = missingFantasyData(p, playerApps);
// window = the player's current team's last games (same on every page)
const hot = isHot(data, pid, playerApps);
const hotEvents = hotEventIds(data, pid, playerApps);
```

**(c)** In the played-cell return (the one rendering `cell-wrap`), replace:

```jsx
<td key={m.eventId} className={`${cls}${winCls}`} title={title}>
  <span className="cell-wrap"><span>{sym}</span><PtsPill pts={pts} /></span>
</td>
```

with:

```jsx
<td key={m.eventId} className={`${cls}${winCls}`} title={hotEvents.has(m.eventId) ? `${title} — in form` : title}>
  <span className="cell-wrap"><span>{hotEvents.has(m.eventId) ? "🔥" : ""}{sym}</span><PtsPill pts={pts} /></span>
</td>
```

Make NO other changes in this task.

- [ ] **Step 2: Run `npx vitest run && npm run build`** — 171 tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/TeamsTab.jsx
git commit -m "feat: per-week 🔥 in Teams grid match cells"
```

---

### Task 3: Frozen stat columns

**Files:**
- Modify: `src/components/TeamsTab.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add the CSS** — append to `src/styles.css`:

```css
/* Teams grid: freeze the totals block (Player, Pos, Min, G, A, Pts) on desktop.
   Fixed widths + cumulative left offsets — sticky columns need both. */
.freeze-stats th:nth-child(-n+6), .freeze-stats td:nth-child(-n+6) {
  position: sticky; background: var(--bg); z-index: 2;
}
.freeze-stats th:nth-child(-n+6) { z-index: 3; } /* header cells sit above body cells */
.freeze-stats th:nth-child(1), .freeze-stats td:nth-child(1) { left: 0; width: 210px; }
.freeze-stats th:nth-child(2), .freeze-stats td:nth-child(2) { left: 210px; width: 52px; }
.freeze-stats th:nth-child(3), .freeze-stats td:nth-child(3) { left: 262px; width: 56px; }
.freeze-stats th:nth-child(4), .freeze-stats td:nth-child(4) { left: 318px; width: 40px; }
.freeze-stats th:nth-child(5), .freeze-stats td:nth-child(5) { left: 358px; width: 40px; }
.freeze-stats th:nth-child(6), .freeze-stats td:nth-child(6) { left: 398px; width: 56px; }
/* fixed-width name cell so long names ellipsize instead of breaking the offsets */
.player-cell { display: flex; align-items: center; gap: 4px; width: 194px; }
.player-cell a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
@media (max-width: 640px) {
  /* not enough real estate — only the Player column stays frozen */
  .freeze-stats th:nth-child(n+2):nth-child(-n+6),
  .freeze-stats td:nth-child(n+2):nth-child(-n+6) { position: static; width: auto; }
  .player-cell { width: auto; }
}
```

(Why 194px: 210px cell minus 2×8px horizontal padding, `box-sizing: border-box` is global. The existing `.sticky-col` rules still cover column 1's stickiness; these rules extend the same treatment to 2–6.)

- [ ] **Step 2: Edit `src/components/TeamsTab.jsx`**

**(a)** Change the table opening tag from `<table className="sticky-col">` to `<table className="sticky-col freeze-stats">`.

**(b)** Wrap the Player td's content in the flex wrapper and give the name link a full-name tooltip. Replace:

```jsx
<td>
  <button className={`mini-toggle ${p?.starred ? "" : "off"}`} aria-pressed={!!p?.starred} title="watchlist"
    onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
  <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} aria-pressed={!!p?.inSquad} title="in my squad"
    onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
  {" "}{out ? <span title={out.note}>🚫 </span> : ""}{hot ? "🔥 " : ""}<a role="link" tabIndex={0} style={{ cursor: "pointer", textDecoration: "underline dotted" }}
    onClick={() => openPlayer(String(pid))}
    onKeyDown={(e) => e.key === "Enter" && openPlayer(String(pid))}>
    {playerName(p) || pid}
  </a>
</td>
```

with:

```jsx
<td>
  <span className="player-cell">
    <button className={`mini-toggle ${p?.starred ? "" : "off"}`} aria-pressed={!!p?.starred} title="watchlist"
      onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
    <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} aria-pressed={!!p?.inSquad} title="in my squad"
      onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
    {out ? <span title={out.note}>🚫</span> : ""}{hot ? "🔥" : ""}<a role="link" tabIndex={0} title={playerName(p)}
      style={{ cursor: "pointer", textDecoration: "underline dotted" }}
      onClick={() => openPlayer(String(pid))}
      onKeyDown={(e) => e.key === "Enter" && openPlayer(String(pid))}>
      {playerName(p) || pid}
    </a>
  </span>
</td>
```

(`.player-cell` is a flex row with its own `gap`, so the manual `{" "}` spacers go away; `span` not `div` to stay valid-ish inline content, flex works on span via the class.)

Make NO other changes.

- [ ] **Step 3: Run `npx vitest run && npm run build`** — 171 tests, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/TeamsTab.jsx src/styles.css
git commit -m "feat: freeze Player/Pos/Min/G/A/Pts columns on the Teams grid"
```

---

### Task 4: Final verification

- [ ] Full suite + build.
- [ ] Manual after deploy: Teams grid — flames appear mid-season in cells, rightmost cell flame always matches the row flame; horizontal scroll keeps the 6 stat columns pinned with no gaps/overlap between them; long player names ellipsize (full name in tooltip); on a narrow window (<640px) only Player stays pinned; absence-click and ⭐/🔵 toggles still work inside the wrapped cell.
