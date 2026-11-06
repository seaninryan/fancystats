# Season Rollover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start a new season in the same save while keeping past seasons browsable (whole app, read-only) and showing a player's last-season line.

**Architecture:** Every match gets a `seasonId`. A pure projection `seasonView(data, seasonId)` (new `src/lib/seasons.js`) returns a data object containing only one season, with archived fantasy fields restored for past seasons. App.jsx hands that view to every tab, so no existing derivation changes. `startNewSeason` archives per-player fantasy fields into `data.seasons[oldId].players` and resets them live.

**Tech Stack:** React 18, Vite, Vitest (node env, SSR smoke tests via `renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-11-06-season-rollover-design.md`

**Env (every npm/npx command):** `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"` — system Node 14 silently breaks Vitest.

---

## File map

- Modify `src/lib/store.js` — `emptyData` gets `seasons`; `applyImport`/`upsertMatchStubs` stamp `seasonId`; new `migrateSeasons`, `startNewSeason`, `ARCHIVED_FIELDS`.
- Create `src/lib/seasons.js` — `seasonView`, `seasonList`, `previousSeasonId`, `previousSeasonTotals`.
- Create `src/components/SeasonBar.jsx` — header season picker + read-only banner.
- Modify `src/App.jsx` — migrate on load, `viewSeason` state, pass `view`/`fullData`/`readOnly`, hide ⚙ in past view.
- Modify `src/components/PlayerDetail.jsx` — last-season line.
- Modify `src/components/PlayersTab.jsx` — "Last" column.
- Modify `src/components/SettingsTab.jsx` — replace raw season-id input with backup + Start new season.
- Tests: `test/store.test.js`, new `test/seasons.test.js`, new `test/seasonBar.test.jsx`, `test/playersTab.test.jsx`, `test/settingsTab.test.jsx`.

---

### Task 1: Tag matches with a season + migration

**Files:**
- Modify: `src/lib/store.js` (emptyData ~L8-14, applyImport ~L28-46, upsertMatchStubs ~L49-57; add migrateSeasons after upsertMatchStubs)
- Test: `test/store.test.js`

- [ ] **Step 1: Write failing tests** — append to `test/store.test.js` and add `migrateSeasons` to the import list at the top:

```js
describe("season tagging", () => {
  it("emptyData has an empty seasons map", () => {
    expect(emptyData().seasons).toEqual({});
  });
  it("applyImport stamps new matches with the current meta.seasonId", () => {
    expect(importedFixture().matches["100"].seasonId).toBe(87682);
  });
  it("re-import never moves a match to another season", () => {
    let d = importedFixture();
    d = { ...d, meta: { ...d.meta, seasonId: 99999 } };
    const re = applyImport(d, { match: { ...d.matches["100"], seasonId: undefined }, teams: [], players: [], appearances: [] }, NOW + 1);
    expect(re.matches["100"].seasonId).toBe(87682);
  });
  it("upsertMatchStubs stamps new stubs and keeps existing tags", () => {
    let d = importedFixture();
    d = { ...d, meta: { ...d.meta, seasonId: 99999 } };
    d = upsertMatchStubs(d, [
      { eventId: 100, round: 1, kickoff: 1, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 },
      { eventId: 300, round: 1, kickoff: 2, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null },
    ], []);
    expect(d.matches["100"].seasonId).toBe(87682);
    expect(d.matches["300"].seasonId).toBe(99999);
  });
});

describe("migrateSeasons", () => {
  const untagged = () => {
    const d = importedFixture();
    delete d.matches["100"].seasonId;
    delete d.seasons;
    return d;
  };
  it("stamps untagged matches with meta.seasonId and seeds the 2026 label", () => {
    const d = migrateSeasons(untagged());
    expect(d.matches["100"].seasonId).toBe(87682);
    expect(d.seasons).toEqual({ 87682: { label: "2026" } });
  });
  it("labels an unknown current season by its id", () => {
    const u = untagged();
    u.meta.seasonId = 12345;
    expect(migrateSeasons(u).seasons).toEqual({ 12345: { label: "12345" } });
  });
  it("leaves tagged matches and existing season entries alone, and is idempotent", () => {
    let d = importedFixture();
    d.matches["100"].seasonId = 11111;
    d.seasons = { 87682: { label: "My 2026", players: { 10: { price: 5 } } } };
    const once = migrateSeasons(d);
    expect(once.matches["100"].seasonId).toBe(11111);
    expect(once.seasons["87682"].label).toBe("My 2026");
    expect(migrateSeasons(once)).toEqual(once);
  });
  it("does not mutate its input", () => {
    const u = untagged();
    migrateSeasons(u);
    expect(u.matches["100"].seasonId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/store.test.js -t "season"`
Expected: FAIL (`migrateSeasons` not exported / seasonId undefined).

- [ ] **Step 3: Implement** in `src/lib/store.js`:

`emptyData` — add `seasons: {}` alongside the other maps:

```js
    teams: {}, matches: {}, players: {}, appearances: {}, adjustments: {}, absences: {}, seasons: {},
```

`applyImport` — replace the `next.matches[match.eventId] = { ...match, importedAt: now };` line with:

```js
  // a match's season is fixed at first sight; re-imports never move it
  next.matches[match.eventId] = { ...match, importedAt: now, seasonId: prevMatch?.seasonId ?? next.meta.seasonId };
```

`upsertMatchStubs` — replace the loop body line with:

```js
    next.matches[s.eventId] = { ...prev, ...s, seasonId: prev.seasonId ?? next.meta.seasonId }; // preserves importedAt/goalTimes/partial when present
```

Add after `upsertMatchStubs`:

```js
// Load-time migration. Before season tagging existed every match belonged to the
// current season, so untagged matches get meta.seasonId. Idempotent.
const KNOWN_SEASON_LABELS = { 87682: "2026" };
export function migrateSeasons(data) {
  const next = structuredClone(data);
  next.seasons ??= {};
  const cur = next.meta.seasonId;
  for (const m of Object.values(next.matches)) if (m.seasonId == null) m.seasonId = cur;
  next.seasons[cur] ??= { label: KNOWN_SEASON_LABELS[cur] ?? String(cur) };
  return next;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/store.test.js`
Expected: PASS (all, including pre-existing). If a pre-existing `toEqual` on a whole match object now fails because of the added `seasonId`, update that expectation to include `seasonId: 87682` — it is a real new field.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: tag matches with their season + load migration"
```

---

### Task 2: startNewSeason mutator

**Files:**
- Modify: `src/lib/store.js` (add after migrateSeasons)
- Test: `test/store.test.js`

- [ ] **Step 1: Write failing tests** — add `startNewSeason` to the imports and append:

```js
describe("startNewSeason", () => {
  const ready = () => {
    let d = migrateSeasons(importedFixture());
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    d = setPlayerField(d, 10, "price", 7.5);
    d = setPlayerField(d, 10, "sitePoints", 120);
    d = setPlayerField(d, 10, "inSquad", true);
    d = setPlayerField(d, 10, "starred", true);
    d = setPlayerField(d, 10, "customName", "Keena");
    return d;
  };
  it("archives fantasy fields under the old season", () => {
    const d = startNewSeason(ready(), { seasonId: 99999, label: "2027" });
    expect(d.seasons["87682"].players["10"]).toEqual({
      price: 7.5, sitePoints: 120, gamePosition: "FWD", gamePositionSource: "manual", inSquad: true,
    });
  });
  it("skips players with nothing to archive", () => {
    const d = startNewSeason(ready(), { seasonId: 99999, label: "2027" });
    expect(d.seasons["87682"].players["11"]).toBeUndefined();
  });
  it("resets live fantasy fields but keeps user identity fields", () => {
    const p = startNewSeason(ready(), { seasonId: 99999, label: "2027" }).players["10"];
    expect(p).toMatchObject({ price: null, priceUpdatedAt: null, sitePoints: null, gamePosition: null, gamePositionSource: null, inSquad: false });
    expect(p).toMatchObject({ starred: true, customName: "Keena", name: "A Keena" });
  });
  it("switches meta to the new season and registers it", () => {
    const d = startNewSeason(ready(), { seasonId: 99999, label: "2027" });
    expect(d.meta.seasonId).toBe(99999);
    expect(d.meta.lastEventSync).toBeNull();
    expect(d.seasons["99999"]).toEqual({ label: "2027" });
  });
  it("deletes nothing", () => {
    const before = ready();
    const d = startNewSeason(before, { seasonId: 99999, label: "2027" });
    expect(Object.keys(d.matches)).toEqual(Object.keys(before.matches));
    expect(Object.keys(d.appearances)).toEqual(Object.keys(before.appearances));
    expect(d.matches["100"].seasonId).toBe(87682);
  });
  it("rejects the current or an existing season id", () => {
    expect(() => startNewSeason(ready(), { seasonId: 87682, label: "x" })).toThrow();
    const d = startNewSeason(ready(), { seasonId: 99999, label: "2027" });
    expect(() => startNewSeason(d, { seasonId: 87682, label: "x" })).toThrow();
  });
});
```

Check what `setPlayerField(d, id, "gamePosition", …)` sets for `gamePositionSource` by reading `setPlayerField` (store.js ~L103). If it does not set `"manual"`, change that expectation to whatever it actually sets (the test pins the archive copying the field, not a particular value).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/store.test.js -t "startNewSeason"`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement** — add after `migrateSeasons` in `src/lib/store.js`:

```js
// Per-season fantasy-site fields: archived at rollover, reset on the live player.
export const ARCHIVED_FIELDS = ["price", "sitePoints", "gamePosition", "gamePositionSource", "inSquad"];

export function startNewSeason(data, { seasonId, label }) {
  const id = Number(seasonId);
  const old = data.meta.seasonId;
  if (!id || id === old || data.seasons?.[id]) throw new Error(`season ${seasonId} already exists`);
  const next = migrateSeasons(data);
  const archive = {};
  for (const [pid, p] of Object.entries(next.players)) {
    const rec = Object.fromEntries(ARCHIVED_FIELDS.map((f) => [f, p[f] ?? (f === "inSquad" ? false : null)]));
    if (ARCHIVED_FIELDS.some((f) => rec[f] != null && rec[f] !== false)) archive[pid] = rec;
    p.price = null; p.priceUpdatedAt = null; p.sitePoints = null;
    p.gamePosition = null; p.gamePositionSource = null; p.inSquad = false;
  }
  next.seasons[old] = { ...next.seasons[old], players: archive };
  next.seasons[id] = { label: String(label || id) };
  next.meta = { ...next.meta, seasonId: id, lastEventSync: null };
  return next;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: startNewSeason archives fantasy fields and resets live players"
```

---

### Task 3: seasonView projection + helpers

**Files:**
- Create: `src/lib/seasons.js`
- Test: `test/seasons.test.js`

- [ ] **Step 1: Write failing tests** — create `test/seasons.test.js`:

```js
// test/seasons.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setAdjustment, setAbsence, setPlayerField, migrateSeasons, startNewSeason, playerTotals, leagueTable } from "../src/lib/store.js";
import { seasonView, seasonList, previousSeasonId, previousSeasonTotals } from "../src/lib/seasons.js";

const NOW = 1765000000000;
const TEAMS = [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }];
const app = (eventId, playerId, goals) => ({ eventId, playerId, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 });
const match = (eventId, round, homeScore) => ({ eventId, round, kickoff: NOW - 1e9 + eventId, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore, awayScore: 0, goalTimes: { home: Array(homeScore).fill(10), away: [] }, partial: false });

// 2026: event 100 (Keena 2 goals). Rollover. 2027: event 200 (Keena 1 goal).
function twoSeasons() {
  let d = migrateSeasons(emptyData());
  d = applyImport(d, { match: match(100, 1, 2), teams: TEAMS, players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app(100, 10, 2)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  d = setPlayerField(d, 10, "price", 7.5);
  d = setAdjustment(d, "100:10", { goals: 0, assists: 1, note: "x" });
  d = setAbsence(d, 100, 10, "old knock", NOW);
  d = startNewSeason(d, { seasonId: 99999, label: "2027" });
  d = applyImport(d, { match: match(200, 1, 1), teams: TEAMS, players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app(200, 10, 1)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "MID");
  return d;
}

describe("seasonView", () => {
  it("keeps only the requested season's matches, appearances, adjustments, absences", () => {
    const d = twoSeasons();
    const old = seasonView(d, 87682);
    expect(Object.keys(old.matches)).toEqual(["100"]);
    expect(Object.keys(old.appearances)).toEqual(["100:10"]);
    expect(Object.keys(old.adjustments)).toEqual(["100:10"]);
    expect(Object.keys(old.absences)).toEqual(["100:10"]);
    const cur = seasonView(d, 99999);
    expect(Object.keys(cur.matches)).toEqual(["200"]);
    expect(Object.keys(cur.adjustments)).toEqual([]);
  });
  it("restores archived fantasy fields for a past season, live ones for the current", () => {
    const d = twoSeasons();
    expect(seasonView(d, 87682).players["10"]).toMatchObject({ gamePosition: "FWD", price: 7.5 });
    expect(seasonView(d, 99999).players["10"]).toMatchObject({ gamePosition: "MID", price: null });
  });
  it("nulls fantasy fields of players with no archive entry in a past season", () => {
    const d = twoSeasons();
    d.players["77"] = { ...d.players["10"], name: "New Guy", gamePosition: "DEF", price: 5 };
    expect(seasonView(d, 87682).players["77"]).toMatchObject({ gamePosition: null, price: null, inSquad: false });
  });
  it("derivations on a view only see that season", () => {
    const d = twoSeasons();
    expect(playerTotals(seasonView(d, 87682), 10).goals).toBe(2);
    expect(playerTotals(seasonView(d, 99999), 10).goals).toBe(1);
    const rovers = leagueTable(seasonView(d, 99999)).find((r) => String(r.teamId) === "1");
    expect(rovers.played).toBe(1);
  });
  it("does not mutate its input", () => {
    const d = twoSeasons();
    const snap = structuredClone(d);
    seasonView(d, 87682);
    expect(d).toEqual(snap);
  });
});

describe("seasonList / previousSeasonId", () => {
  it("lists seasons newest first with the current flagged", () => {
    expect(seasonList(twoSeasons())).toEqual([
      { seasonId: 99999, label: "2027", current: true },
      { seasonId: 87682, label: "2026", current: false },
    ]);
  });
  it("previousSeasonId is the newest non-current season, else null", () => {
    expect(previousSeasonId(twoSeasons())).toBe(87682);
    expect(previousSeasonId(migrateSeasons(emptyData()))).toBeNull();
  });
});

describe("previousSeasonTotals", () => {
  it("returns last season's label and totals scored at last season's position", () => {
    const t = previousSeasonTotals(twoSeasons(), 10);
    expect(t).toMatchObject({ seasonId: 87682, label: "2026", apps: 1, goals: 2, assists: 1, minutes: 90 });
    expect(t.points).toBeGreaterThan(0);
  });
  it("null without a previous season or without appearances in it", () => {
    expect(previousSeasonTotals(migrateSeasons(emptyData()), 10)).toBeNull();
    const d = twoSeasons();
    d.players["77"] = { ...d.players["10"], name: "New Guy" };
    expect(previousSeasonTotals(d, 77)).toBeNull();
  });
});
```

Before running: check `leagueTable`'s row shape (store.js ~L589) for the played-count and team-id field names; adjust `r.teamId` / `played` in the test to match the real names.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/seasons.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/lib/seasons.js`:

```js
// src/lib/seasons.js
// Season projection: the app renders one season at a time by handing every tab
// seasonView(data, id) instead of raw data, so no derivation needs a season filter.
import { ARCHIVED_FIELDS, playerTotals, playerAppearances } from "./store.js";

const eventOf = (key) => key.split(":")[0];
const pick = (obj, keep) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => keep(k)));

export function seasonView(data, seasonId) {
  const sid = Number(seasonId);
  const matches = pick(data.matches, (k) => Number(data.matches[k].seasonId) === sid);
  const inSeason = (k) => eventOf(k) in matches;
  let players = data.players;
  if (sid !== Number(data.meta.seasonId)) {
    const archive = data.seasons?.[sid]?.players || {};
    players = Object.fromEntries(Object.entries(data.players).map(([pid, p]) => {
      const a = archive[pid] || {};
      const restored = Object.fromEntries(ARCHIVED_FIELDS.map((f) => [f, a[f] ?? (f === "inSquad" ? false : null)]));
      return [pid, { ...p, ...restored }];
    }));
  }
  return {
    ...data,
    matches,
    players,
    appearances: pick(data.appearances, inSeason),
    adjustments: pick(data.adjustments, inSeason),
    absences: pick(data.absences, inSeason),
  };
}

export function seasonList(data) {
  const cur = Number(data.meta.seasonId);
  return Object.entries(data.seasons || {})
    .map(([id, s]) => ({ seasonId: Number(id), label: s.label, current: Number(id) === cur }))
    .sort((a, b) => (b.current - a.current) || (b.seasonId - a.seasonId));
}

export function previousSeasonId(data) {
  return seasonList(data).find((s) => !s.current)?.seasonId ?? null;
}

// { seasonId, label, apps, minutes, goals, assists, points } for the player's
// previous season, or null when there is none or they didn't play in it.
export function previousSeasonTotals(data, playerId) {
  const prev = previousSeasonId(data);
  if (prev == null) return null;
  const view = seasonView(data, prev);
  const apps = playerAppearances(view, playerId);
  if (!apps.length) return null;
  const t = playerTotals(view, playerId, { apps });
  return { seasonId: prev, label: data.seasons[prev].label, apps: apps.length, minutes: t.minutes, goals: t.goals, assists: t.assists, points: t.points };
}
```

Note on `seasonList` sort: season ids are SofaScore ids that increase over time, so `b.seasonId - a.seasonId` is newest first; the current season is forced to the top regardless.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/seasons.test.js test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/seasons.js test/seasons.test.js
git commit -m "feat: seasonView projection and previous-season helpers"
```

---

### Task 4: SeasonBar component + App wiring

**Files:**
- Create: `src/components/SeasonBar.jsx`
- Modify: `src/App.jsx`
- Test: `test/seasonBar.test.jsx`

- [ ] **Step 1: Write failing test** — create `test/seasonBar.test.jsx`:

```jsx
// test/seasonBar.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, migrateSeasons, startNewSeason } from "../src/lib/store.js";
import SeasonBar from "../src/components/SeasonBar.jsx";

const two = () => startNewSeason(migrateSeasons(emptyData()), { seasonId: 99999, label: "2027" });

describe("SeasonBar SSR", () => {
  it("renders nothing with a single season", () => {
    expect(renderToStaticMarkup(<SeasonBar data={migrateSeasons(emptyData())} viewSeason={87682} onChange={() => {}} />)).toBe("");
  });
  it("offers a picker and no banner when viewing the current season", () => {
    const html = renderToStaticMarkup(<SeasonBar data={two()} viewSeason={99999} onChange={() => {}} />);
    expect(html).toContain("<select");
    expect(html).toContain("2026");
    expect(html).not.toContain("read-only");
  });
  it("shows a read-only banner with a way back when viewing a past season", () => {
    const html = renderToStaticMarkup(<SeasonBar data={two()} viewSeason={87682} onChange={() => {}} />);
    expect(html).toContain("Viewing 2026 (read-only)");
    expect(html).toContain("Back to 2027");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/seasonBar.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/components/SeasonBar.jsx`:

```jsx
// src/components/SeasonBar.jsx
import { seasonList } from "../lib/seasons.js";

// Header season picker; only appears once a second season exists.
export default function SeasonBar({ data, viewSeason, onChange }) {
  const seasons = seasonList(data);
  if (seasons.length < 2) return null;
  const current = seasons.find((s) => s.current);
  const viewing = seasons.find((s) => s.seasonId === Number(viewSeason)) || current;
  return (
    <>
      <select value={viewing.seasonId} onChange={(e) => onChange(Number(e.target.value))}
        title="season" style={{ alignSelf: "center" }}>
        {seasons.map((s) => <option key={s.seasonId} value={s.seasonId}>{s.label}</option>)}
      </select>
      {!viewing.current && (
        <div className="banner warn row" role="status" style={{ flexBasis: "100%" }}>
          Viewing {viewing.label} (read-only) ·{" "}
          <button onClick={() => onChange(current.seasonId)}>Back to {current.label}</button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run test/seasonBar.test.jsx`
Expected: PASS.

- [ ] **Step 5: Wire into App.jsx.** Edits:

Imports:

```js
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { emptyData, staleInfo, migrateSeasons } from "./lib/store.js";
import { seasonView } from "./lib/seasons.js";
import SeasonBar from "./components/SeasonBar.jsx";
```

Load (replace the `.then` in the driveLoad effect):

```js
      .then((loaded) => { setData(migrateSeasons(loaded ? { ...emptyData(), ...loaded } : emptyData())); setPhase("ready"); })
      .catch(() => { setData(migrateSeasons(emptyData())); setPhase("ready"); });
```

(Migration runs in memory only; it reaches Drive on the next real edit — no forced save.)

State, after `focusTeam`:

```js
  const [viewSeason, setViewSeason] = useState(null); // null = current season
```

After the `openTeam` callback (hooks must stay above the early returns):

```js
  const curSeason = data?.meta.seasonId;
  const shownSeason = viewSeason ?? curSeason;
  const readOnly = data != null && Number(shownSeason) !== Number(curSeason);
  const view = useMemo(() => (data ? seasonView(data, shownSeason) : null), [data, shownSeason]);
  const noop = useCallback(() => {}, []);
  const changeSeason = useCallback((id) => {
    setViewSeason(id);
    setOpenPlayerId(null);
    setTab((t) => (t === "settings" ? "matches" : t));
  }, []);
```

Render changes (after the early returns):
- Filter tabs: `const tabs = readOnly ? TABS.filter(([k]) => k !== "settings") : TABS;` and use `tabs` in both the `Active` lookup and the nav `.map`.
- In `<nav className="tabs">`, right before the version `<span>`: `<SeasonBar data={data} viewSeason={shownSeason} onChange={changeSeason} />`. Add `style={{ flexWrap: "wrap" }}` to the nav so the banner wraps to its own line.
- Stale banner: `staleInfo(view, Date.now())` and only when `!readOnly`.
- PlayerDetail: `data={view} fullData={data} update={readOnly ? noop : update} readOnly={readOnly}`; the guard `data.players[openPlayerId]` → `view.players[openPlayerId]` (both places).
- Active tab: `data={view} fullData={data} update={readOnly ? noop : update} readOnly={readOnly}`.

- [ ] **Step 6: Run full suite + build**

Run: `npm test && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/SeasonBar.jsx src/App.jsx test/seasonBar.test.jsx
git commit -m "feat: season picker; tabs render a read-only past-season view"
```

---

### Task 5: Last-season line on PlayerDetail + "Last" column on Players

**Files:**
- Modify: `src/components/PlayerDetail.jsx`, `src/components/PlayersTab.jsx`
- Test: `test/playersTab.test.jsx`

- [ ] **Step 1: Write failing tests** — append to `test/playersTab.test.jsx` (add the needed imports at the top: `applyImport, setPlayerField, migrateSeasons, startNewSeason` from store, `seasonView` from `../src/lib/seasons.js`):

```jsx
describe("last season", () => {
  const NOW = 1765000000000;
  const app = { eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 2, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 };
  const rolled = () => {
    let d = migrateSeasons(emptyData());
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: NOW - 1e9, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0, goalTimes: { home: [10, 20], away: [] }, partial: false },
      teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
      players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [app],
    }, NOW);
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    return startNewSeason(d, { seasonId: 99999, label: "2027" });
  };
  it("PlayerDetail shows the previous-season line", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayerDetail data={seasonView(d, 99999)} fullData={d} update={() => {}} playerId="10" onBack={() => {}} />);
    expect(html).toContain("2026:");
    expect(html).toContain("1 apps");
    expect(html).toContain("2G 0A");
  });
  it("PlayerDetail hides the line when viewing a past season", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayerDetail data={seasonView(d, 87682)} fullData={d} readOnly update={() => {}} playerId="10" onBack={() => {}} />);
    expect(html).not.toContain("2026:");
  });
  it("PlayersTab adds a Last column once a previous season exists", () => {
    const d = rolled();
    const html = renderToStaticMarkup(
      <PlayersTab data={seasonView(d, 99999)} fullData={d} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain(">Last<");
  });
  it("PlayersTab has no Last column with a single season or when read-only", () => {
    expect(renderToStaticMarkup(<PlayersTab data={emptyData()} update={() => {}} openPlayer={() => {}} />)).not.toContain(">Last<");
    const d = rolled();
    expect(renderToStaticMarkup(
      <PlayersTab data={seasonView(d, 87682)} fullData={d} readOnly update={() => {}} openPlayer={() => {}} />)).not.toContain(">Last<");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/playersTab.test.jsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement PlayerDetail.** Signature becomes
`export default function PlayerDetail({ data, fullData, readOnly, update, playerId, onBack })`. Import `previousSeasonTotals` from `../lib/seasons.js`. After `const derived = …`:

```js
  const last = !readOnly && fullData ? previousSeasonTotals(fullData, playerId) : null;
```

Directly after the header `<div className="row">…</div>` (the one with `←` and the `<h3>`):

```jsx
      {last && (
        <p className="dim" style={{ margin: "4px 0" }} title={`${last.label} season, scored at that season's fantasy position`}>
          {last.label}: {last.apps} apps · {last.minutes.toLocaleString("en-IE")}′ · {last.goals}G {last.assists}A
          {last.points != null && ` · ${last.points} pts (${(last.points / last.apps).toFixed(1)}/g)`}
        </p>
      )}
```

- [ ] **Step 4: Implement PlayersTab.** Signature becomes
`export default function PlayersTab({ data, fullData, readOnly, update, openPlayer })`. Import `previousSeasonId, seasonView` from `../lib/seasons.js`. Before `rows`:

```js
  // previous season's points per player, for the "Last" column (current-season view only)
  const lastPts = useMemo(() => {
    const prev = !readOnly && fullData ? previousSeasonId(fullData) : null;
    if (prev == null) return null;
    const pv = seasonView(fullData, prev);
    const index = appearancesByPlayer(pv);
    const out = new Map();
    for (const [pid, apps] of index) out.set(String(pid), playerTotals(pv, pid, { apps }).points);
    return out;
  }, [fullData, readOnly]);
```

In the `rows` map object add `last: lastPts?.get(String(id)) ?? null,` and add `lastPts` to the `rows` useMemo deps (`[data, win, lastPts]`).

Change the `cols` line so "Last" sits right after "Pts" (index 5 in COLS, before Val):

```js
  const LAST_COL = ["last", "Last", "fantasy points last season (at last season's position)"];
  const base = lastPts ? [...COLS.slice(0, 5), LAST_COL, ...COLS.slice(5)] : COLS;
  // ± only means something relative to a window
  const cols = win === "all" ? base : [...base.slice(0, 5), ["climb", "±", "form vs baseline: points per team match in the window minus before it"], ...base.slice(5)];
```

In the row JSX, the cells must follow the same order (Pts, ±?, Last?, Val). Insert after the `{win !== "all" && (…climb td…)}` block:

```jsx
                {lastPts && <td className="dim">{r.last ?? "—"}</td>}
```

Column order check: with a window, `cols` = Player, Team, Pos, €, Pts, ±, Last, Val… and cells = Pts, ±, Last, Val. Without: Pts, Last, Val. Matches.

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run test/playersTab.test.jsx && npm test && npm run build`
Expected: PASS, build OK.

- [ ] **Step 6: Commit**

```bash
git add src/components/PlayerDetail.jsx src/components/PlayersTab.jsx test/playersTab.test.jsx
git commit -m "feat: last-season line on player detail and Last column on Players"
```

---

### Task 6: Settings — backup + Start new season

**Files:**
- Modify: `src/components/SettingsTab.jsx` (the "Season" card ~L97-112)
- Test: `test/settingsTab.test.jsx`

- [ ] **Step 1: Write failing tests** — append inside `describe("SettingsTab SSR", …)` in `test/settingsTab.test.jsx`, and export `backupFileName` in the import line (`import SettingsTab, { appliedMessage, backupFileName } from …`):

```jsx
  it("offers a backup download and a new-season flow instead of a raw season-id box", () => {
    const html = renderToStaticMarkup(<SettingsTab data={data()} update={() => {}} />);
    expect(html).toContain("Download backup");
    expect(html).toContain("Start new season");
    expect(html).not.toContain("Season id <input");
  });
```

And a new describe at the bottom:

```jsx
describe("backupFileName", () => {
  it("dates the file", () => {
    expect(backupFileName(new Date("2026-11-06T10:00:00Z"))).toBe("fancystats-backup-2026-11-06.json");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/settingsTab.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/components/SettingsTab.jsx`, import `startNewSeason` from `../lib/store.js` and `seasonList` from `../lib/seasons.js`. Add above the component:

```js
export function backupFileName(date) {
  return `fancystats-backup-${date.toISOString().slice(0, 10)}.json`;
}

function downloadBackup(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = backupFileName(new Date());
  a.click();
  URL.revokeObjectURL(url);
}

function NewSeasonCard({ data, update }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(null);
  const cur = seasonList(data).find((s) => s.current);
  const start = () => {
    try {
      update((d) => startNewSeason(d, { seasonId: Number(id), label: label.trim() || id }));
      setOpen(false); setId(""); setLabel(""); setErr(null);
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card">
      <h3>Season</h3>
      <p className="dim">
        Current: {cur?.label ?? data.meta.seasonId} (tournament {data.meta.tournamentId} · season {data.meta.seasonId}).
        Find a new season id via api.sofascore.com/api/v1/unique-tournament/{data.meta.tournamentId}/seasons (open in a browser tab).
      </p>
      <div className="row">
        <button onClick={() => downloadBackup(data)}>⬇ Download backup</button>
        {!open && <button onClick={() => setOpen(true)}>Start new season…</button>}
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="row">
            <label>Season id <input value={id} onChange={(e) => setId(e.target.value)} style={{ width: 110 }} /></label>
            <label>Label <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="2027" style={{ width: 80 }} /></label>
          </div>
          <p className="dim">
            {cur?.label ?? "This season"} stays viewable from the season picker. Each player's price, site points,
            fantasy position and squad tick are saved with it, then cleared for the new season. Names, stars,
            team colours and club mappings carry over. Nothing is deleted — download a backup first anyway.
          </p>
          <div className="row">
            <button className="primary" disabled={!Number(id)} onClick={start}>Start new season</button>
            <button onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
          </div>
          {err && <p className="err">{err}</p>}
        </div>
      )}
    </div>
  );
}
```

Note: `startNewSeason` throws inside the updater, i.e. inside React's `setData`. To surface the error synchronously instead, validate before calling `update`:

```js
  const start = () => {
    const n = Number(id);
    if (!n || n === Number(data.meta.seasonId) || data.seasons?.[n]) { setErr(`Season ${id} already exists`); return; }
    update((d) => startNewSeason(d, { seasonId: n, label: label.trim() || id }));
    setOpen(false); setId(""); setLabel(""); setErr(null);
  };
```

Use this second version of `start` (drop the try/catch one).

Replace the whole existing `<div className="card"><h3>Season</h3>…</div>` block (the one containing the raw "Season id" input with `onBlur`) with `<NewSeasonCard data={data} update={update} />`.

Note: the "Start new season…" button text contains "Start new season"; the test checks for that substring, fine.

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run test/settingsTab.test.jsx && npm test && npm run build`
Expected: PASS, build OK.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsTab.jsx test/settingsTab.test.jsx
git commit -m "feat: Settings backup download and Start new season flow"
```

---

### Task 7: Version bump + deploy

- [ ] **Step 1:** In `package.json` set `"version": "0.29.0"`, then `npm install --package-lock-only`.
- [ ] **Step 2:** `npm test && npm run build` — all green.
- [ ] **Step 3:** Commit and push:

```bash
git add package.json package-lock.json
git commit -m "chore: v0.29.0"
git push origin main
```

- [ ] **Step 4:** `gh run watch` (or `gh run list -L 1`) until the Pages deploy succeeds.
