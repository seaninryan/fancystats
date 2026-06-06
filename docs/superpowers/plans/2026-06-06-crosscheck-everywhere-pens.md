# Cross-Check Everywhere + Pens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Directional cross-check triangles on Players/Teams/Table, Pen column on Players, re-import-all on Matches. Spec: `docs/superpowers/specs/2026-06-06-crosscheck-everywhere-pens-design.md`.

## ⚠️ Environment

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

### Task 1: Store — `pens` in playerTotals + `teamSitePoints`

**Files:**
- Modify: `src/lib/store.js`
- Modify: `test/store.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/store.test.js`, and add `teamSitePoints` to the big store.js import (`playerTotals`, `applyPasteResults`, `setAdjustment` are already imported):

```js
describe("pens + site totals", () => {
  it("playerTotals aggregates penalties scored, adjustment-aware", () => {
    let d = importedFixture();
    d.appearances["100:10"].penScored = 1;
    expect(playerTotals(d, 10).pens).toBe(1);
    d = setAdjustment(d, "100:10", { penScored: 1 });
    expect(playerTotals(d, 10).pens).toBe(2);
  });
  it("playerTotals pens is 0 when nothing scored", () => {
    expect(playerTotals(importedFixture(), 10).pens).toBe(0);
  });
  it("teamSitePoints sums per team and counts coverage", () => {
    let d = importedFixture(); // players 10 and 11, both team 1
    d = applyPasteResults(d, [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "price", NOW);
    expect(teamSitePoints(d).get(1)).toEqual({ site: 25, withData: 1, missing: 1 });
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/store.test.js`** — FAIL (`pens` undefined; `teamSitePoints` not exported).

- [ ] **Step 3: Implement** — in `src/lib/store.js`:

**(a)** In `playerTotals`, replace:

```js
  const t = { minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: position ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists;
```

with:

```js
  const t = { minutes: 0, goals: 0, assists: 0, pens: 0, starts: 0, subApps: 0, points: position ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) {
      for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
      // pre-penScored appearances lack the field — clamp like leagueTable does
      if (typeof adj.penScored === "number") eff.penScored = Math.max(0, (eff.penScored || 0) + adj.penScored);
    }
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists; t.pens += eff.penScored || 0;
```

**(b)** Directly below `teamWindowEventIds` (above `playerClimb`), ADD:

```js
// teamId -> { site, withData, missing }: sum of the team's players' official
// fantasy-site totals plus paste coverage, for the Table tab's FPts cross-check.
export function teamSitePoints(data) {
  const out = new Map();
  for (const p of Object.values(data.players)) {
    const t = out.get(p.teamId) || { site: 0, withData: 0, missing: 0 };
    if (p.sitePoints != null) { t.site += p.sitePoints; t.withData++; }
    else t.missing++;
    out.set(p.teamId, t);
  }
  return out;
}
```

- [ ] **Step 4: Run `npx vitest run test/store.test.js`** — 80 pass (77 + 3). Full suite: 189.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: penalties in playerTotals; teamSitePoints coverage sums"
```

---

### Task 2: UI — triangles everywhere, Pen column, re-import all

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/PlayersTab.jsx`
- Modify: `src/components/TeamsTab.jsx`
- Modify: `src/components/TableTab.jsx`
- Modify: `src/components/MatchesTab.jsx`

- [ ] **Step 1: CSS** — replace the existing block:

```css
/* site-points cross-check marker (Players Pts cell) */
.pts-diff { position: relative; }
.pts-diff::after { content: ""; position: absolute; top: 0; right: 0;
  border-top: 6px solid var(--warn); border-left: 6px solid transparent; }
```

with:

```css
/* site-points cross-check marker: green = site total higher than ours, red = lower */
.pts-diff { position: relative; }
.pts-diff::after { content: ""; position: absolute; top: 0; right: 0;
  border-left: 6px solid transparent; }
.pts-diff.site-up::after { border-top: 6px solid var(--accent); }
.pts-diff.site-down::after { border-top: 6px solid var(--err); }
```

- [ ] **Step 2: PlayersTab** — three edits:

(a) COLS: insert the Pen entry after assists:

```js
  ["goals", "G", "goals"], ["assists", "A", "assists"], ["pens", "Pen", "penalties scored"], ["minutes", "Min", "minutes played"],
```

(replacing the line that currently reads `["goals", "G", "goals"], ["assists", "A", "assists"], ["minutes", "Min", "minutes played"],`).

(b) Body cells: replace `<td>{r.goals}</td><td>{r.assists}</td><td>{r.minutes}</td>` with `<td>{r.goals}</td><td>{r.assists}</td><td>{r.pens}</td><td>{r.minutes}</td>` (the `pens` field arrives via the existing `...t` spread).

(c) Pts cell direction class — in the Pts `<td>`, replace the className expression:

```js
`${r.err ? "err-cell" : ""}${r.siteDelta ? " pts-diff" : ""}`
```

with:

```js
`${r.err ? "err-cell" : ""}${r.siteDelta ? ` pts-diff ${r.siteDelta < 0 ? "site-up" : "site-down"}` : ""}`
```

- [ ] **Step 3: TeamsTab** — two edits:

(a) Season points in the totals loop. Replace:

```js
  for (const a of apps) {
    if (!totals.has(a.playerId)) totals.set(a.playerId, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null });
    const t = totals.get(a.playerId);
    t.apps++; // all-time, used for default row order
    if (!windowIds.has(a.eventId)) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const g = (a.goals || 0) + (typeof adj?.goals === "number" ? adj.goals : 0);
    const as = (a.assists || 0) + (typeof adj?.assists === "number" ? adj.assists : 0);
    t.minutes += (a.minutes || 0) + (typeof adj?.minutes === "number" ? adj.minutes : 0);
    t.goals += Math.max(0, g);
    t.assists += Math.max(0, as);
    const p = data.players[a.playerId];
    const m = data.matches[a.eventId];
    if (p?.gamePosition && m?.goalTimes) {
      t.points = (t.points ?? 0) + scoreAppearance(a, m, p.gamePosition, adj).total;
    }
  }
```

with:

```js
  for (const a of apps) {
    if (!totals.has(a.playerId)) totals.set(a.playerId, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null, seasonPoints: null });
    const t = totals.get(a.playerId);
    t.apps++; // all-time, used for default row order
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const pp = data.players[a.playerId];
    const m = data.matches[a.eventId];
    const pts = pp?.gamePosition && m?.goalTimes ? scoreAppearance(a, m, pp.gamePosition, adj).total : null;
    if (pts != null) t.seasonPoints = (t.seasonPoints ?? 0) + pts; // site cross-check is season-wide
    if (!windowIds.has(a.eventId)) continue;
    const g = (a.goals || 0) + (typeof adj?.goals === "number" ? adj.goals : 0);
    const as = (a.assists || 0) + (typeof adj?.assists === "number" ? adj.assists : 0);
    t.minutes += (a.minutes || 0) + (typeof adj?.minutes === "number" ? adj.minutes : 0);
    t.goals += Math.max(0, g);
    t.assists += Math.max(0, as);
    if (pts != null) t.points = (t.points ?? 0) + pts;
  }
```

(b) Pts total cell. In the row body (where `const hotEvents = ...` etc. live), add after the `hot`/`hotEvents` lines:

```js
const siteDelta = p?.sitePoints != null && t.seasonPoints != null ? t.seasonPoints - p.sitePoints : null;
```

and replace the Pts `<td>`:

```jsx
<td className={err ? "err-cell" : ""} title={err ? "No fantasy data — set a position or add their fantasy alias in the player view" : ""}>{err ? "❗" : t.points ?? "—"}</td>
```

with:

```jsx
<td className={`${err ? "err-cell" : ""}${siteDelta ? ` pts-diff ${siteDelta < 0 ? "site-up" : "site-down"}` : ""}`}
  title={err ? "No fantasy data — set a position or add their fantasy alias in the player view"
    : siteDelta ? `${siteDelta > 0 ? "+" : ""}${siteDelta} vs official site (ours ${t.seasonPoints} · site ${p.sitePoints})` : ""}>
  {err ? "❗" : t.points ?? "—"}</td>
```

- [ ] **Step 4: TableTab** — three edits:

(a) Imports: add `teamSitePoints` to the store.js import (alongside `leagueTable`).

(b) After the `chartSeries` memo, add:

```js
const siteTotals = useMemo(() => teamSitePoints(data), [data]);
// cross-check is season-vs-site even when the table is windowed
const seasonFantasy = useMemo(() => {
  const m = new Map();
  for (const r of leagueTable(data, null)) m.set(r.teamId, r.fantasy);
  return m;
}, [data]);
```

(c) Body cells — replace:

```jsx
{COLS.map(([key]) => (
  <td key={key} title={key === "pensScored" && r.pensMissed ? `${r.pensMissed} missed` : ""}>
    {r[key]}
  </td>
))}
```

with:

```jsx
{COLS.map(([key]) => {
  if (key === "fantasy") {
    const st = siteTotals.get(r.teamId);
    const ours = seasonFantasy.get(r.teamId) ?? 0;
    const delta = st?.withData ? ours - st.site : null;
    return (
      <td key={key} className={delta ? `pts-diff ${delta < 0 ? "site-up" : "site-down"}` : ""}
        title={delta ? `${delta > 0 ? "+" : ""}${delta} vs official site (ours ${ours} · site ${st.site}${st.missing ? ` · ${st.missing} players missing site data` : ""})` : ""}>
        {r[key]}
      </td>
    );
  }
  return (
    <td key={key} title={key === "pensScored" && r.pensMissed ? `${r.pensMissed} missed` : ""}>
      {r[key]}
    </td>
  );
})}
```

- [ ] **Step 5: MatchesTab** — after the existing "Import all missing" button block, add:

```jsx
{matches.some((m) => m.importedAt) && (
  <button disabled={!!busy}
    title="refresh every imported match with the current importer — stats added since import day (e.g. penalties) get backfilled"
    onClick={() => runImport(matches.filter((m) => m.importedAt).map((m) => m.eventId))}>
    ↻ Re-import all ({matches.filter((m) => m.importedAt).length})
  </button>
)}
```

- [ ] **Step 6: Verify** — `npx vitest run && npm run build`: 189 tests, build OK.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css src/components/PlayersTab.jsx src/components/TeamsTab.jsx src/components/TableTab.jsx src/components/MatchesTab.jsx
git commit -m "feat: directional cross-check triangles on all tabs; Pen column; re-import all"
```

### Task 3: Final verification

- [ ] Full suite + build; manual after deploy: Matches → ↻ Re-import all (takes ~a minute per ~100 matches, progress shown) → Table Pen column populates; Players Pen column shows scorers; triangles green where the site credits more, red where less, on all three tabs; Table FPts tooltip reports missing-player coverage.
