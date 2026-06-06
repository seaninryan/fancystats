# Header Tooltips + Select Affordance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tooltips on every column header (Players/Table/Teams) and a 📈 selection toggle on Players + Table rows. Spec: `docs/superpowers/specs/2026-06-06-header-tooltips-select-affordance-design.md`.

**Architecture:** UI-only. COLS arrays become `[key, label, tip]` triples; 📈 uses the existing `.mini-toggle`/`.off` pattern INSIDE the first cell (a new column would break sticky-col/climb-splice indices). No lib/CSS/test changes.

## ⚠️ Environment

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

### Task 1: All three components

**Files:**
- Modify: `src/components/PlayersTab.jsx`
- Modify: `src/components/TableTab.jsx`
- Modify: `src/components/TeamsTab.jsx`

- [ ] **Step 1: PlayersTab**

**(a)** Replace the COLS constant with:

```js
const COLS = [
  ["name", "Player", "click name for details · row or 📈 adds to the graph"],
  ["teamName", "Team", "club"],
  ["pos", "Pos", "fantasy game position (▲▼ = differs from where they really play)"],
  ["price", "€", "price on the fantasy site"],
  ["points", "Pts", "fantasy points in the selected window"],
  ["goals", "G", "goals"], ["assists", "A", "assists"], ["minutes", "Min", "minutes played"],
  ["starts", "St", "matches started"], ["subApps", "Sub", "appearances as a substitute"],
];
```

**(b)** In the dynamic `cols` line, the spliced climb entry becomes a triple:

```js
const cols = win === "all" ? COLS : [...COLS.slice(0, 5), ["climb", "±", "form vs baseline: points per team match in the window minus before it"], ...COLS.slice(5)];
```

**(c)** Header loop: destructure the tip and set it as the title. Replace `{cols.map(([key, label]) => (` and the `<th key={key} onClick=...>` with:

```jsx
{cols.map(([key, label, tip]) => (
  <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
    {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
  </th>
))}
```

**(d)** Name cell: 📈 toggle at the start (stopPropagation — the cell opens detail, the row toggles), name text dotted-underlined. Replace:

```jsx
<td className="cell-click" title="open player details"
  onClick={(e) => { e.stopPropagation(); openPlayer(r.id); }}>
  {r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}{r.name}</td>
```

with:

```jsx
<td className="cell-click" title="open player details"
  onClick={(e) => { e.stopPropagation(); openPlayer(r.id); }}>
  <button className={`mini-toggle ${selected.has(r.id) ? "" : "off"}`} aria-pressed={selected.has(r.id)}
    title="add to graph" onClick={(e) => { e.stopPropagation(); toggleSelected(r.id); }}>📈</button>
  {" "}{r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}<span style={{ textDecoration: "underline dotted" }}>{r.name}</span></td>
```

- [ ] **Step 2: TableTab**

**(a)** Replace the COLS constant with:

```js
const COLS = [
  ["played", "P", "played"], ["won", "W", "won"], ["drawn", "D", "drawn"], ["lost", "L", "lost"],
  ["gf", "GF", "goals for"], ["ga", "GA", "goals against"], ["gd", "GD", "goal difference"],
  ["points", "Pts", "league points"],
  ["fantasy", "FPts", "fantasy points scored by the team's players"],
  ["yellows", "🟨", "yellow cards (a second yellow counts too)"],
  ["reds", "🟥", "dismissals (straight red or second yellow)"],
  ["pensScored", "Pen", "penalties scored (missed shown in row tooltip)"],
  ["assists", "👟", "assists"],
];
```

**(b)** Header: give the `#  Team` th a title, and replace the COLS map's old pensScored title ternary with the tip. Replace:

```jsx
<th onClick={() => setSort(null)}>#&nbsp;&nbsp;Team</th>
{COLS.map(([key, label]) => (
  <th key={key} onClick={() => setSort((s) => ({ key, dir: s?.key === key ? -s.dir : -1 }))}
    title={key === "pensScored" ? "penalties scored (missed shown in row tooltip)" : ""}>
    {label}{sort?.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
  </th>
))}
```

with:

```jsx
<th onClick={() => setSort(null)} title="click to restore league order · row or 📈 adds to the graph">#&nbsp;&nbsp;Team</th>
{COLS.map(([key, label, tip]) => (
  <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s?.key === key ? -s.dir : -1 }))}>
    {label}{sort?.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
  </th>
))}
```

NOTE: the body cells map over COLS too (`{COLS.map(([key]) => (...))}`) — destructuring only `[key]` from a triple still works; leave the body loop alone.

**(c)** Rank cell: 📈 toggle (stopPropagation — the row also toggles; without it a click would toggle twice and no-op). Replace:

```jsx
<td>{i + 1} <TeamPill team={data.teams[r.teamId]} /></td>
```

with:

```jsx
<td>
  <button className={`mini-toggle ${selected.has(r.teamId) ? "" : "off"}`} aria-pressed={selected.has(r.teamId)}
    title="add to graph" onClick={(e) => { e.stopPropagation(); toggleSelected(r.teamId); }}>📈</button>
  {" "}{i + 1} <TeamPill team={data.teams[r.teamId]} />
</td>
```

- [ ] **Step 3: TeamsTab**

**(a)** Replace the TOTAL_COLS constant with:

```js
const TOTAL_COLS = [
  ["minutes", "Min", "minutes in the selected window"], ["goals", "G", "goals in the selected window"],
  ["assists", "A", "assists in the selected window"], ["points", "Pts", "fantasy points in the selected window"],
];
```

**(b)** Header: add titles to Player/Pos and the tip to the loop. Replace:

```jsx
<th onClick={() => setSort({ key: "apps", dir: -1 })}>Player</th>
<th>Pos</th>
{TOTAL_COLS.map(([key, label]) => (
  <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
    {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
  </th>
))}
```

with:

```jsx
<th onClick={() => setSort({ key: "apps", dir: -1 })} title="click to sort by appearances">Player</th>
<th title="fantasy game position">Pos</th>
{TOTAL_COLS.map(([key, label, tip]) => (
  <th key={key} title={tip} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
    {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
  </th>
))}
```

Match-column headers keep their existing date/result titles — untouched.

- [ ] **Step 4: Verify** — `npx vitest run && npm run build`: 177 tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayersTab.jsx src/components/TableTab.jsx src/components/TeamsTab.jsx
git commit -m "feat: column-header tooltips everywhere; 📈 selection toggle on Players/Table rows"
```

### Task 2: Final verification

- [ ] Manual after deploy: hover every header on all three tabs; 📈 toggles selection on Players/Table (dim ↔ coloured) without opening PlayerDetail; row-click still toggles; name click (now dotted-underlined) still opens detail.
