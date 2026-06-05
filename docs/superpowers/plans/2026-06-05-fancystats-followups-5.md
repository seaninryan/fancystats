# fancystats Follow-ups 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Teams grid scrolls both ways without leaving the viewport and auto-centres on the current gameweek; colour-ramped points pills; 🔥 hot-player marker + filter; out-planner picks weeks from a select with OK; Matches shows full team names + per-team fantasy points per game; tab clicks scroll to top.

**Env:** prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task 1: Library (TDD)

**Files:** Modify `src/lib/store.js`; tests in `test/store.test.js`.

- [ ] **Step 1: failing tests — append to test/store.test.js** (add `isHot, allMatchTeamPoints` to its store imports):

```js
describe("hot players", () => {
  // helper: clone match 100 into new events with given goals for player 10
  const withForm = (goalsPerMatch) => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    goalsPerMatch.forEach((g, i) => {
      const ev = 500 + i;
      d.matches[ev] = { ...d.matches["100"], eventId: ev, kickoff: d.matches["100"].kickoff + (i + 1) * 1000 };
      d.appearances[`${ev}:10`] = { ...d.appearances["100:10"], eventId: ev, goals: g };
    });
    return d;
  };
  // base appearance scores: fullMatch 3 + win 2 + goals*4 (FWD) => 0 goals = 5, 1 goal = 9
  it("hot when 2 of the last 3 score ≥8", () => {
    const d = withForm([1, 0, 1]); // last 3 = 9, 5, 9
    expect(isHot(d, 10)).toBe(true);
  });
  it("not hot when only 1 of the last 3 scores ≥8", () => {
    const d = withForm([1, 0, 0]); // earlier 9 is pushed out of... last 3 = 9,5,5 → only 1 good
    expect(isHot(d, 10)).toBe(false);
  });
  it("old form does not count — only the last 3 appearances", () => {
    const d = withForm([1, 1, 0, 0, 0]); // last 3 = 5,5,5
    expect(isHot(d, 10)).toBe(false);
  });
  it("needs a game position and at least 2 recent appearances", () => {
    expect(isHot(importedFixture(), 10)).toBe(false); // no position
    const d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(isHot(d, 10)).toBe(false); // single appearance (scored 9, but 1 < 2 needed)
  });
});

describe("allMatchTeamPoints", () => {
  it("sums per-team fantasy points for each imported match", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD"); // 3+2+4 = 9
    d = setPlayerField(d, 11, "gamePosition", "MID");                     // sub 1 + win 2 + assist 3 = 6
    const pts = allMatchTeamPoints(d);
    expect(pts.get(100)).toEqual({ home: 15, away: 0 });
  });
  it("skips positionless players and unimported matches", () => {
    const d = importedFixture(); // nobody has a position
    expect(allMatchTeamPoints(d).get(100)).toEqual({ home: 0, away: 0 });
  });
});
```

- [ ] **Step 2: run, confirm failures (missing exports).**

- [ ] **Step 3: implement — append to src/lib/store.js:**

```js
// 🔥 form: at least HOT_NEEDED of the player's last HOT_WINDOW appearances
// scored ≥ HOT_THRESHOLD fantasy points.
const HOT_THRESHOLD = 8;
const HOT_WINDOW = 3;
const HOT_NEEDED = 2;

export function isHot(data, playerId, appsArg = null) {
  const player = data.players[playerId];
  if (!player?.gamePosition) return false;
  const apps = appsArg ?? playerAppearances(data, playerId);
  const recent = apps.slice(-HOT_WINDOW);
  if (recent.length < HOT_NEEDED) return false;
  let good = 0;
  for (const a of recent) {
    const m = data.matches[a.eventId];
    if (!m?.goalTimes) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    if (scoreAppearance(a, m, player.gamePosition, adj).total >= HOT_THRESHOLD) good++;
  }
  return good >= HOT_NEEDED;
}

// One pass over all appearances: eventId -> { home, away } fantasy-point sums.
// Positionless players contribute nothing (they have no computable points).
export function allMatchTeamPoints(data) {
  const out = new Map();
  for (const a of Object.values(data.appearances)) {
    const m = data.matches[a.eventId];
    if (!m?.goalTimes) continue;
    const p = data.players[a.playerId];
    if (!p?.gamePosition) {
      if (!out.has(a.eventId)) out.set(a.eventId, { home: 0, away: 0 });
      continue;
    }
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const side = a.teamId === m.homeTeamId ? "home" : "away";
    const t = out.get(a.eventId) || { home: 0, away: 0 };
    t[side] += scoreAppearance(a, m, p.gamePosition, adj).total;
    out.set(a.eventId, t);
  }
  return out;
}
```

- [ ] **Step 4:** `npx vitest run` — 117 + 6 = 123 green. Commit:

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: hot-player detection and per-match team points"
```

---

### Task 2: Pills + Teams (scroll container, centring, pts pills, 🔥, weeks select)

**Files:** Modify `src/components/Pills.jsx`, `src/styles.css`, `src/components/TeamsTab.jsx`, `src/App.jsx`.

- [ ] **Step 1: Pills.jsx — append:**

```jsx
// Points pill: red at 0, yellow around 1, deepening green toward 10+.
export function ptsColor(pts) {
  const hue = pts <= 0 ? 0 : 50 + ((Math.min(pts, 10) - 1) * 80) / 9;
  return `hsl(${hue} 68% 36%)`;
}

export function PtsPill({ pts }) {
  if (pts == null) return <span className="dim">·</span>;
  return <span className="chip" style={{ background: ptsColor(pts), color: "#fff" }}>{pts}</span>;
}
```

- [ ] **Step 2: styles.css — append:**

```css
/* both-axis scroll container that keeps its scrollbars on screen */
.scroll-xy { overflow: auto; max-height: calc(100vh - 200px); }
.sticky-col th:first-child { z-index: 3; } /* corner above sticky header AND column */
```

- [ ] **Step 3: TeamsTab.**

a) Import `PtsPill` (extend the Pills import). Add refs + centring effect:

```js
  const wrapRef = useRef(null);
  const firstUpRef = useRef(null);
  useEffect(() => {
    const w = wrapRef.current, t = firstUpRef.current;
    if (w && t) w.scrollLeft = Math.max(0, t.offsetLeft - w.clientWidth / 2);
  }, [selected]);
```

(add `useRef, useEffect` to the react import.)

b) The table wrapper changes from `<div className="scroll-x">` to `<div className="scroll-x scroll-xy" ref={wrapRef}>`.

c) The first upcoming `<th>` gets the ref — in the upcoming-headers map: `<th ref={i === 0 ? firstUpRef : null} ...>` (change the map callback to `(m, i) =>`).

d) Played cell points become pills — the cell content `{sym}{a ? <span className="dim"> {pts ?? "·"}</span> : ""}` becomes:

```jsx
                          {sym}{a ? <> <PtsPill pts={pts} /></> : ""}
```

e) 🔥 marker — import `isHot` (extend the store import). In the row map where `out`/`err` are computed: `const hot = isHot(data, pid, apps.filter((x) => x.playerId === pid));` and render `{hot ? "🔥 " : ""}` immediately before the player-name `<a>`.

f) OutEditor weeks select + OK — replace the number input and Save button with:

```jsx
          <select value={weeks} onChange={(e) => setWeeks(e.target.value)} title="how long are they out?">
            <option value="">indefinite</option>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((w) => <option key={w} value={w}>{w} week{w > 1 ? "s" : ""}</option>)}
          </select>
          <button className="primary" onClick={() => onMark(note, Number(weeks) || 0)}>OK</button>
```

- [ ] **Step 4: App.jsx — tab clicks scroll to top.** The tab button onClick becomes:

```jsx
onClick={() => { setTab(key); setOpenPlayerId(null); window.scrollTo({ top: 0 }); }}
```

- [ ] **Step 5:** `npm test && npm run build` (123 green). Commit:

```bash
git add src/components/Pills.jsx src/styles.css src/components/TeamsTab.jsx src/App.jsx
git commit -m "feat: teams dual-scroll container with gameweek centring, points pills, hot markers, weeks select"
```

---

### Task 3: Players 🔥 filter + Matches full names & team points

**Files:** Modify `src/components/PlayersTab.jsx`, `src/components/MatchesTab.jsx`.

- [ ] **Step 1: PlayersTab.** Extend the store import with `isHot`. Rows memo adds `hot: isHot(data, id, apps),`. Filters state gains `hot: false`; filter chain adds `(!filters.hot || r.hot) &&`. Add a filter chip after the ▲▼ button:

```jsx
        <button className={filters.hot ? "primary" : ""} title="in form: 8+ pts in 2 of the last 3"
          onClick={() => setFilters({ ...filters, hot: !filters.hot })}>🔥</button>
```

Name cell prepends the marker: `{r.hot ? "🔥 " : ""}` before the existing starred/squad/out markers.

- [ ] **Step 2: MatchesTab.** Extend the store import with `allMatchTeamPoints`; import `PtsPill` from `./Pills.jsx`. Before the return: `const teamPts = allMatchTeamPoints(data);`. The row label becomes full names + points:

```jsx
              <span style={{ flex: 1 }}>
                <TeamPill team={data.teams[m.homeTeamId]} label={data.teams[m.homeTeamId]?.name} />
                {teamPts.has(m.eventId) && <> <PtsPill pts={teamPts.get(m.eventId).home} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {teamPts.has(m.eventId) && <><PtsPill pts={teamPts.get(m.eventId).away} /> </>}
                <TeamPill team={data.teams[m.awayTeamId]} label={data.teams[m.awayTeamId]?.name} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}> ⚠R{suspects.get(m.eventId)}?</span>
                )}
              </span>
```

(This replaces the existing label span INCLUDING the suspect span — don't render the suspect warning twice.)

- [ ] **Step 3:** `npm test && npm run build` (123 green). Commit:

```bash
git add src/components/PlayersTab.jsx src/components/MatchesTab.jsx
git commit -m "feat: hot filter, full team names and per-team match points"
```

---

### Task 4: Deploy

- [ ] Bump package.json to 0.5.0, commit `chore: v0.5.0`, push, watch Actions, site 200.
- [ ] User verifies: Teams scrolls both ways without leaving the page and opens centred on the current gameweek; per-game points are colour pills; 🔥 on in-form players (+ Players filter); out-planner uses the weeks dropdown + OK; Matches shows full names with two coloured per-team point pills per played game; tab tap scrolls to top.
