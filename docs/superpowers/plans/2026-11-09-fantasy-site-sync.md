# Fantasy Site Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the fantasy site's per-gameweek points and the user's own team, make site points the fantasy points everywhere, and add a My Team tab.

**Architecture:** A console snippet downloads one JSON file; `parseSyncBlob` + `applySiteSync` store raw site facts per season (`data.site[seasonId]`) and link players by `player.siteId`. At render time `src/lib/sitePoints.js` maps site gameweeks onto our matches (`siteIndex`) and `appearancePoints` becomes the single source of per-appearance points (site wins, our scoring fills gaps). `src/lib/myTeam.js` derives the My Team tab.

**Tech Stack:** React 18, Vite, Vitest (node env, no jsdom), recharts.

**Spec:** `docs/superpowers/specs/2026-11-09-fantasy-site-sync-design.md`. Read it first.

## Ground rules for every task

- Node: prefix every npm/npx command with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" &&` (system Node 14 silently breaks Vitest).
- Pure logic in `src/lib/` with tests; components stay thin. Mutators `structuredClone` and return new data, never mutate input.
- Nothing derived is stored. Site history is stored raw; mapping it to matches happens at render.
- Gameweek = `matchRound(m)`, never `m.round`. Record fields `playerId`/`teamId` are numbers, object keys are strings.
- Lib tests build fixtures through real store operations (`applyImport`, `setPlayerField`, `applySiteSync`…). Component tests are SSR smoke tests with `renderToStaticMarkup`.
- `siteIndex` / `appearancePoints` read `view.site`, which only a **season view** (`seasonView(data, seasonId)`) has. Tests that exercise site points must call derivations on `seasonView(d, d.meta.seasonId)`, not on raw `d`.
- Commit after each task with the message given, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Change |
|---|---|
| `src/lib/fantasyImport.js` | add `parseSyncBlob`, `buildSyncSnippet`; remove `buildFantasySnippet` |
| `src/lib/store.js` | `emptyData().site`, `applyFantasyRows` sets `siteId`, new `applySiteSync`; derivations call `appearancePoints` |
| `src/lib/seasons.js` | `seasonView` projects `site` |
| `src/lib/sitePoints.js` | **new**: `siteIndex`, `appearancePoints`, `diffComponents`, `unresolvedSummary` |
| `src/lib/series.js` | fantasy stat via `appearancePoints` |
| `src/lib/myTeam.js` | **new**: `myTeamGameweeks`, `myTeamGameweek`, `myTeamSeries` |
| `src/components/FantasyImport.jsx` | becomes the Fantasy sync card |
| `src/components/SettingsTab.jsx` | pass `fullData` to the card |
| `src/components/Pills.jsx`, `src/styles.css` | `PtsPill est` italics |
| `src/components/TeamsTab.jsx`, `src/components/PlayerDetail.jsx` | per-match points via `appearancePoints` + marker |
| `src/components/GameweekChart.jsx` | `onClear` optional |
| `src/components/MyTeamTab.jsx` | **new** tab |
| `src/App.jsx` | register the tab |
| tests | `test/fantasyImport.test.js`, `test/store.test.js`, `test/sitePoints.test.js` (new), `test/myTeam.test.js` (new), `test/fantasyImport.test.jsx`, `test/siteUi.test.jsx` (new) |

---

### Task 1: Sync blob parsing and storage

**Files:**
- Modify: `src/lib/fantasyImport.js`, `src/lib/store.js`, `src/lib/seasons.js`
- Test: `test/fantasyImport.test.js`, `test/store.test.js`

- [ ] **Step 1: Write failing tests for `parseSyncBlob`**

Add `parseSyncBlob` to the import line at the top of `test/fantasyImport.test.js`, then append:

```js
describe("parseSyncBlob", () => {
  const blob = (over = {}) => JSON.stringify({
    meta: { source: "fantasyloi-sync", version: 1, capturedAt: 1765000000000, siteTeamId: 7378,
      clubs: [{ id: "14420", name: "Bohemians" }] },
    players: [{ name: " Colm Whelan ", clubId: 14420, position: "FWD", price: "6.5", sitePoints: 137, siteId: "501" }],
    history: { "501": [[1, "14420", "55388", 9, [["Appearance", "Full Game", 3]]]] },
    myTeam: { "1": { lines: [[501], [], [], []], bench: [], captain: 501, shown: { "501": 18 }, names: { "501": "Colm Whelan" }, total: 18 } },
    ...over,
  });

  it("normalizes players like the price import and keeps siteId as a number", () => {
    const r = parseSyncBlob(blob());
    expect(r.players).toEqual([{ name: "Colm Whelan", clubId: "14420", gamePosition: "FWD", price: 6.5, sitePoints: 137, siteId: 501 }]);
  });
  it("carries meta, history and myTeam through", () => {
    const r = parseSyncBlob(blob());
    expect(r.capturedAt).toBe(1765000000000);
    expect(r.siteTeamId).toBe(7378);
    expect(r.clubs).toEqual([{ id: "14420", name: "Bohemians" }]);
    expect(r.history["501"][0][3]).toBe(9);
    expect(r.myTeam["1"].captain).toBe(501);
  });
  it("defaults missing history and myTeam to empty objects", () => {
    const r = parseSyncBlob(blob({ history: undefined, myTeam: undefined }));
    expect(r.history).toEqual({});
    expect(r.myTeam).toEqual({});
  });
  it("rejects bad JSON, the wrong source, an unknown version and an empty capture", () => {
    expect(() => parseSyncBlob("{nope")).toThrow(/Couldn't read/);
    expect(() => parseSyncBlob(JSON.stringify({ meta: { source: "fantasyloi" }, players: [] }))).toThrow(/not a Fantasy sync file/);
    expect(() => parseSyncBlob(blob({ meta: { source: "fantasyloi-sync", version: 2 } }))).toThrow(/version 2/);
    expect(() => parseSyncBlob(blob({ players: [] }))).toThrow(/No players/);
  });
});
```

- [ ] **Step 2: Write failing tests for storage**

In `test/store.test.js` add `applySiteSync` to the big import from `../src/lib/store.js`, then append:

```js
describe("applySiteSync", () => {
  const parsed = (over = {}) => ({
    capturedAt: NOW, siteTeamId: 7378,
    clubs: [{ id: "c1", name: "Shamrock Rovers" }, { id: "c2", name: "Bohemians" }],
    players: [],
    history: { "501": [[1, "c1", "c2", 12, [["Appearance", "Full Game", 3]]]] },
    myTeam: {
      "1": { lines: [[502], [], [], []], bench: [], captain: 502, shown: {}, names: {}, total: 1 },
      "2": { lines: [[501], [], [], []], bench: [503], captain: 501, shown: { "501": 24 }, names: { "501": "A Keena", "503": "Someone Else" }, total: 30 },
    },
    ...over,
  });
  const rows = [{ playerId: "10", siteId: 501, price: 7.5, sitePoints: 120, gamePosition: "FWD" }];

  it("stores the site season raw under the current season id and links siteId", () => {
    const d = applySiteSync(importedFixture(), parsed(), rows, NOW);
    expect(d.site[d.meta.seasonId]).toEqual({
      capturedAt: NOW, siteTeamId: 7378, clubs: parsed().clubs, history: parsed().history, myTeam: parsed().myTeam,
    });
    expect(d.players["10"].siteId).toBe(501);
    expect(d.players["10"].price).toBe(7.5);
  });
  it("syncs inSquad to the latest captured gameweek (lines + bench)", () => {
    let d = importedFixture();
    d = setPlayerField(d, 11, "inSquad", true);
    d = applySiteSync(d, parsed(), rows, NOW);
    expect(d.players["10"].inSquad).toBe(true);  // 501 is in GW2's lines
    expect(d.players["11"].inSquad).toBe(false); // no site id
  });
  it("leaves inSquad alone when no team was captured", () => {
    let d = setPlayerField(importedFixture(), 11, "inSquad", true);
    d = applySiteSync(d, parsed({ myTeam: {} }), rows, NOW);
    expect(d.players["11"].inSquad).toBe(true);
  });
  it("moves a site id that is re-linked to another player", () => {
    let d = applySiteSync(importedFixture(), parsed(), rows, NOW);
    d = applySiteSync(d, parsed(), [{ playerId: "11", siteId: 501 }], NOW);
    expect(d.players["11"].siteId).toBe(501);
    expect(d.players["10"].siteId).toBe(null);
  });
  it("keeps user-owned fields and does not mutate its input", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "MID");
    d = { ...d, players: { ...d.players, "10": { ...d.players["10"], gamePositionSource: "manual", starred: true } } };
    d = setAdjustment(d, "100:10", { assists: 1, note: "x" });
    const before = structuredClone(d);
    const next = applySiteSync(d, parsed(), rows, NOW);
    expect(d).toEqual(before);
    expect(next.players["10"].gamePosition).toBe("MID");
    expect(next.players["10"].starred).toBe(true);
    expect(next.adjustments["100:10"].assists).toBe(1);
  });
  it("emptyData has an empty site map", () => {
    expect(emptyData().site).toEqual({});
  });
  it("seasonView projects only the viewed season's site data", () => {
    const d = applySiteSync(importedFixture(), parsed(), rows, NOW);
    expect(seasonView(d, d.meta.seasonId).site.siteTeamId).toBe(7378);
    expect(seasonView(d, 99999).site).toBe(null);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/fantasyImport.test.js test/store.test.js`
Expected: FAIL (`parseSyncBlob` / `applySiteSync` not exported).

- [ ] **Step 4: Implement `parseSyncBlob`**

In `src/lib/fantasyImport.js`, replace the `.map((p) => ({ ... }))` body inside `parseFantasyBlob` with a shared helper, and add `parseSyncBlob` after `parseFantasyBlob`:

```js
// One capture row -> the shape every import path uses.
function normalizePlayerRow(p) {
  return {
    name: String(p.name).trim(),
    clubId: p.clubId != null ? String(p.clubId) : null,
    gamePosition: POSITIONS.includes(p.position) ? p.position : null,
    price: numOrNull(p.price),
    sitePoints: numOrNull(p.sitePoints),
  };
}
```

`parseFantasyBlob`'s players line becomes:

```js
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map(normalizePlayerRow);
```

```js
// Pure: validate + normalize a Fantasy sync file (buildSyncSnippet's download).
// history/myTeam are raw site facts and pass through untouched; mapping them onto
// our matches happens at render time (sitePoints.js).
export function parseSyncBlob(text) {
  let blob;
  try {
    blob = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("Couldn't read that file — load the fancystats-sync JSON the snippet downloaded.");
  }
  if (blob?.meta?.source !== "fantasyloi-sync") throw new Error("That's not a Fantasy sync file.");
  if (blob.meta.version !== 1) {
    throw new Error(`Unsupported sync file version ${blob.meta.version} — copy the snippet again and re-run it.`);
  }
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map((p) => ({ ...normalizePlayerRow(p), siteId: numOrNull(p.siteId) }));
  if (!players.length) throw new Error("No players in the file — are you logged in on the fantasy site?");
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    capturedAt: numOrNull(blob.meta.capturedAt),
    siteTeamId: numOrNull(blob.meta.siteTeamId),
    clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [],
    players,
    history: obj(blob.history),
    myTeam: obj(blob.myTeam),
  };
}
```

- [ ] **Step 5: Implement storage in `store.js` and `seasons.js`**

In `emptyData()` add `site: {}` after `seasons: {}`:

```js
    teams: {}, matches: {}, players: {}, appearances: {}, adjustments: {}, absences: {}, seasons: {}, site: {},
```

In `applyFantasyRows`, inside the loop after `if (r.alias) p.pasteAlias = r.alias;` add:

```js
    if (r.siteId != null) p.siteId = Number(r.siteId);
```

Add after `applyFantasyRows`:

```js
// Fold a Fantasy sync (parseSyncBlob output) into the save. rows: matched capture
// rows [{playerId, siteId, gamePosition, price, sitePoints, alias?}]. The site's
// history and your team are raw facts stored per season and replaced wholesale;
// mapping them onto matches happens at render time (sitePoints.js), so a round fix
// re-points them retroactively. 🔵 inSquad follows the latest captured gameweek.
export function applySiteSync(data, parsed, rows, now) {
  const next = applyFantasyRows(data, rows, now); // already a clone
  // a site id belongs to one player: re-linking moves it
  const claimed = new Map(rows.filter((r) => r.siteId != null).map((r) => [Number(r.siteId), String(r.playerId)]));
  for (const [pid, p] of Object.entries(next.players)) {
    if (p.siteId != null && claimed.has(Number(p.siteId)) && claimed.get(Number(p.siteId)) !== pid) p.siteId = null;
  }
  next.site = {
    ...(next.site || {}),
    [next.meta.seasonId]: {
      capturedAt: parsed.capturedAt, siteTeamId: parsed.siteTeamId,
      clubs: parsed.clubs, history: parsed.history, myTeam: parsed.myTeam,
    },
  };
  const gws = Object.keys(parsed.myTeam || {}).map(Number).filter(Number.isFinite);
  if (gws.length) {
    const latest = parsed.myTeam[Math.max(...gws)];
    const squad = new Set([...(latest.lines || []).flat(), ...(latest.bench || [])].map(Number));
    for (const p of Object.values(next.players)) p.inSquad = p.siteId != null && squad.has(Number(p.siteId));
  }
  return next;
}
```

In `src/lib/seasons.js` `seasonView`, add to the returned object after `absences: …`:

```js
    site: data.site?.[sid] ?? null,
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fantasyImport.js src/lib/store.js src/lib/seasons.js test/fantasyImport.test.js test/store.test.js
git commit -m "feat: parse and store Fantasy sync files (site history, my team, siteId)"
```

---

### Task 2: `sitePoints.js` — map site gameweeks onto matches

**Files:**
- Create: `src/lib/sitePoints.js`
- Test: `test/sitePoints.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/sitePoints.test.js`:

```js
// test/sitePoints.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, setPlayerField, setMatchRound, setAdjustment, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { siteIndex, appearancePoints, diffComponents, unresolvedSummary } from "../src/lib/sitePoints.js";

const NOW = 1765000000000;
const TEAMS = [
  { id: 1, name: "Shamrock Rovers", shortName: "SRO" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
  { id: 3, name: "Derry City", shortName: "DER" },
];
const CLUBS = [{ id: "c1", name: "Shamrock Rovers" }, { id: "c2", name: "Bohemians" }, { id: "c3", name: "Derry City" }];
export const app = (eventId, playerId, teamId, extra = {}) => ({
  eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F",
  goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0, ...extra,
});
const match = (eventId, round, home, away, hs, as) => ({
  eventId, round, kickoff: NOW - 1e7 + eventId, status: "finished", homeTeamId: home, awayTeamId: away,
  homeScore: hs, awayScore: as, goalTimes: { home: Array(hs).fill(10), away: Array(as).fill(20) }, partial: false,
});
const imp = (d, m, apps, players = [{ id: 10, name: "A Keena", teamId: 1 }, { id: 11, name: "B Burke", teamId: 1 }]) =>
  applyImport(d, { match: m, teams: TEAMS, players, appearances: apps }, NOW);

// R1: SRO 1-0 BOH (Keena scores). R2: DER 0-0 SRO. R3: SRO 2-1 BOH (only Burke plays).
function base() {
  let d = emptyData();
  d = imp(d, match(100, 1, 1, 2, 1, 0), [app(100, 10, 1, { goals: 1 })]);
  d = imp(d, match(101, 2, 3, 1, 0, 0), [app(101, 10, 1)]);
  d = imp(d, match(103, 3, 1, 2, 2, 1), [app(103, 11, 1)]);
  return setPlayerField(d, 10, "gamePosition", "FWD");
}
const FT_WIN_GOAL_ASSIST = [["Appearance", "Full Game", 3], ["Team Result", "Win", 2], ["Goals", "1", 4], ["Assists", "1", 3]];
const sync = (d, history) =>
  applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: CLUBS, players: [], history, myTeam: {} },
    [{ playerId: "10", siteId: 501 }], NOW);
const view = (d) => seasonView(d, d.meta.seasonId);

describe("siteIndex + appearancePoints", () => {
  it("site total wins over our scoring", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    const r = appearancePoints(v, v.appearances["100:10"]);
    expect(r).toMatchObject({ total: 12, source: "site" });
    expect(r.ours.total).toBe(9); // FWD: full game 3 + win 2 + goal 4
  });
  it("falls back to our scoring where the site has nothing", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    expect(appearancePoints(v, v.appearances["101:10"])).toMatchObject({ total: 4, source: "ours", site: null });
  });
  it("ignores crest order and a repeated current-club crest", () => {
    const v = view(sync(base(), { "501": [[2, "c1", "c1", 7, [["Appearance", "Full Game", 3]]]] }));
    expect(appearancePoints(v, v.appearances["101:10"]).total).toBe(7);
  });
  it("splits a double gameweek by the clubs in each block", () => {
    let d = imp(base(), match(102, 1, 1, 3, 0, 0), [app(102, 10, 1)]);
    d = sync(d, { "501": [[1, "c2", "c1", 12, FT_WIN_GOAL_ASSIST], [1, "c3", "c1", 5, [["Appearance", "Full Game", 3]]]] });
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"]).total).toBe(12);
    expect(appearancePoints(v, v.appearances["102:10"]).total).toBe(5);
  });
  it("a round override re-points a site gameweek", () => {
    let d = sync(base(), { "501": [[5, "c3", "c1", 7, [["Appearance", "Full Game", 3]]]] });
    expect(siteIndex(view(d)).unresolved).toEqual([{ playerId: "10", siteId: 501, gw: 5, total: 7, reason: "no-match" }]);
    d = setMatchRound(d, 101, 5);
    const v = view(d);
    expect(siteIndex(v).unresolved).toEqual([]);
    expect(appearancePoints(v, v.appearances["101:10"]).total).toBe(7);
  });
  it("lists a site appearance SofaScore doesn't have", () => {
    const v = view(sync(base(), { "501": [[3, "c1", "c2", 3, [["Appearance", "Sub", 1], ["Team Result", "Win", 2]]]] }));
    expect(siteIndex(v).unresolved).toEqual([{ playerId: "10", siteId: 501, gw: 3, total: 3, reason: "no-appearance" }]);
  });
  it("a Didn't Play block zeroes an appearance we have, and is otherwise ignored", () => {
    const dnp = [["Appearance", "Didn't Play", 0], ["Team Result", "N/A", 0]];
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 0, dnp], [3, "c1", "c2", 0, dnp], [9, "c1", "c2", 0, dnp]] }));
    expect(appearancePoints(v, v.appearances["100:10"])).toMatchObject({ total: 0, source: "site" });
    expect(siteIndex(v).unresolved).toEqual([]);
  });
  it("site points apply without a game position", () => {
    let d = sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    d = setPlayerField(d, 10, "gamePosition", null);
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"])).toMatchObject({ total: 12, source: "site", ours: null });
    expect(appearancePoints(v, v.appearances["101:10"])).toMatchObject({ total: null, source: null });
  });
  it("an explicit position (what-if) always uses our scoring", () => {
    const v = view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
    expect(appearancePoints(v, v.appearances["100:10"], { position: "MID" })).toMatchObject({ total: 10, source: "ours" });
  });
  it("a user adjustment does not override the site", () => {
    let d = setAdjustment(base(), "100:10", { assists: 1, note: "won pen" });
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    const v = view(d);
    expect(appearancePoints(v, v.appearances["100:10"]).total).toBe(12);
  });
  it("raw (non-view) data never uses site points", () => {
    const d = sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    expect(appearancePoints(d, d.appearances["100:10"])).toMatchObject({ total: 9, source: "ours" });
  });
});

describe("diffComponents", () => {
  it("names the components that differ", () => {
    expect(diffComponents(FT_WIN_GOAL_ASSIST, [["fullMatch", 3], ["win", 2], ["goals", 4]])).toEqual(["assists"]);
    expect(diffComponents([["Appearance", "Started", 2], ["Clean Sheet", "No", 0]], [["startedSubbedOff", 2], ["cleanSheet", 2]]))
      .toEqual(["clean sheet"]);
    expect(diffComponents([["Yellow Cards", "2", -3]], [["yellow", -1], ["secondYellow", -2]])).toEqual([]);
  });
});

describe("unresolvedSummary", () => {
  it("groups unresolved blocks by gameweek and reason with player names", () => {
    let d = imp(base(), match(104, 4, 2, 3, 0, 0), [], []); // a round the player's team didn't play
    d = sync(d, { "501": [[5, "c3", "c1", 7, [["Appearance", "Full Game", 3]]], [3, "c1", "c2", 3, [["Appearance", "Sub", 1]]]] });
    expect(unresolvedSummary(view(d))).toEqual([
      { gw: 3, reason: "no-appearance", count: 1, names: ["A Keena"] },
      { gw: 5, reason: "no-match", count: 1, names: ["A Keena"] },
    ]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/sitePoints.test.js`
Expected: FAIL (module `../src/lib/sitePoints.js` not found).

- [ ] **Step 3: Implement `src/lib/sitePoints.js`**

```js
// src/lib/sitePoints.js
// The fantasy site's own per-gameweek points, mapped onto our matches at render
// time. Site points win wherever they exist; our scoring (scoring.js) fills gaps.
// Works on a SEASON VIEW only (seasonView puts the season's site data on view.site);
// raw data has no view.site, so site points never apply to it.
// See docs/superpowers/specs/2026-11-09-fantasy-site-sync-design.md.
import { scoreAppearance } from "./scoring.js";
import { matchRound, playerName } from "./store.js";
import { mapClubs } from "./fantasyImport.js";

const DIDNT_PLAY = "Didn't Play";
const cache = new WeakMap(); // view -> index; views are immutable (mutators return new data)

const playedIn = (rows) => (rows || []).find((r) => r[0] === "Appearance")?.[1] !== DIDNT_PLAY;

// -> { byKey: Map<"eventId:playerId", {total, rows}>, unresolved: [{playerId, siteId, gw, total, reason}] }
// reason: "no-match" (no single match that round for the player's team) |
//         "no-appearance" (the match exists, the site says he played, SofaScore has no appearance)
export function siteIndex(view) {
  if (cache.has(view)) return cache.get(view);
  const out = { byKey: new Map(), unresolved: [] };
  cache.set(view, out);
  const site = view.site;
  if (!site?.history) return out;

  const clubMap = mapClubs(site.clubs || [], view.teams, view.meta?.fantasyClubMap);
  const teamOfClub = (c) => (c != null && clubMap[String(c)] != null ? Number(clubMap[String(c)]) : null);
  const byRound = new Map();
  for (const m of Object.values(view.matches)) {
    if (!m.importedAt || !m.goalTimes) continue;
    const r = matchRound(m);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const appsOf = new Map(); // playerId -> Map(eventId -> appearance)
  for (const a of Object.values(view.appearances)) {
    const k = String(a.playerId);
    if (!appsOf.has(k)) appsOf.set(k, new Map());
    appsOf.get(k).set(Number(a.eventId), a);
  }
  const bySite = new Map();
  for (const [pid, p] of Object.entries(view.players)) if (p.siteId != null) bySite.set(Number(p.siteId), pid);

  for (const [siteKey, blocks] of Object.entries(site.history)) {
    const pid = bySite.get(Number(siteKey));
    if (!pid) continue; // not linked to any of our players
    const apps = appsOf.get(pid) || new Map();
    // His team that week: the clubs he has appeared for this season, plus his current one.
    // Never the block's crests — their order isn't home/away and one can be his current club.
    const teams = new Set([...apps.values()].map((a) => Number(a.teamId)));
    if (view.players[pid].teamId != null) teams.add(Number(view.players[pid].teamId));
    for (const [gw, clubA, clubB, total, rows] of blocks) {
      const played = playedIn(rows);
      const flag = (reason) => {
        if (played) out.unresolved.push({ playerId: pid, siteId: Number(siteKey), gw: Number(gw), total: Number(total), reason });
      };
      let cands = (byRound.get(Number(gw)) || []).filter((m) => teams.has(m.homeTeamId) || teams.has(m.awayTeamId));
      const withApp = cands.filter((m) => apps.has(Number(m.eventId)));
      if (withApp.length) cands = withApp;
      if (cands.length > 1) { // double gameweek: the block's two clubs pick the match
        const clubs = new Set([teamOfClub(clubA), teamOfClub(clubB)]);
        cands = cands.filter((m) => clubs.has(m.homeTeamId) && clubs.has(m.awayTeamId));
      }
      if (cands.length !== 1) { flag("no-match"); continue; }
      const m = cands[0];
      if (apps.has(Number(m.eventId))) out.byKey.set(`${m.eventId}:${pid}`, { total: Number(total), rows });
      else flag("no-appearance");
    }
  }
  return out;
}

// The single rule for an appearance's fantasy points.
// -> { total: number|null, source: "site"|"ours"|null, site: {total, rows}|null, ours: scoreAppearance()|null }
// opts.position (mismatch what-ifs) forces our scoring: the site has no "what if".
export function appearancePoints(view, app, { position = null } = {}) {
  const key = `${app.eventId}:${app.playerId}`;
  const m = view.matches[app.eventId];
  const pos = position ?? view.players[app.playerId]?.gamePosition;
  const adj = view.adjustments[key] || null;
  const ours = pos && m?.goalTimes ? scoreAppearance(app, m, pos, adj) : null;
  const site = position == null ? siteIndex(view).byKey.get(key) ?? null : null;
  if (site) return { total: site.total, source: "site", site, ours };
  return { total: ours ? ours.total : null, source: ours ? "ours" : null, site: null, ours };
}

const SITE_COMPONENT = {
  Appearance: "appearance", "Team Result": "result", "Clean Sheet": "clean sheet", Goals: "goals", Assists: "assists",
  "Yellow Cards": "cards", "Red Cards": "cards", "Own Goals": "own goal", "Penalty Misses": "pen miss", "Penalty Saves": "pen save",
};
const OUR_COMPONENT = {
  sub: "appearance", startedSubbedOff: "appearance", fullMatch: "appearance", win: "result", draw: "result",
  cleanSheet: "clean sheet", goals: "goals", assists: "assists", yellow: "cards", secondYellow: "cards",
  straightRed: "cards", ownGoal: "own goal", penMiss: "pen miss", penSave: "pen save",
};

// Which scoring components differ between a site block's rows ([stat, value, points])
// and our breakdown ([reason, points]) — the "(assists)" in "site 8 · ours 5 (assists)".
export function diffComponents(siteRows, ourBreakdown) {
  const sum = (pairs, names) => {
    const o = {};
    for (const [k, v] of pairs) { const c = names[k] || k; o[c] = (o[c] || 0) + Number(v); }
    return o;
  };
  const s = sum((siteRows || []).map((r) => [r[0], r[2]]), SITE_COMPONENT);
  const o = sum(ourBreakdown || [], OUR_COMPONENT);
  return [...new Set([...Object.keys(s), ...Object.keys(o)])].filter((k) => (s[k] || 0) !== (o[k] || 0));
}

// Sync-preview grouping of siteIndex(view).unresolved: [{gw, reason, count, names}], by gw then reason.
export function unresolvedSummary(view) {
  const groups = new Map();
  for (const u of siteIndex(view).unresolved) {
    const k = `${u.gw}|${u.reason}`;
    if (!groups.has(k)) groups.set(k, { gw: u.gw, reason: u.reason, count: 0, names: [] });
    const g = groups.get(k);
    g.count++;
    g.names.push(playerName(view.players[u.playerId]));
  }
  return [...groups.values()].sort((a, b) => a.gw - b.gw || a.reason.localeCompare(b.reason));
}
```

Note: `store.js` will import from this module in Task 3 while this module imports `matchRound`/`playerName` from `store.js`. That cycle is safe: both are hoisted `export function`/`export const` used only at call time. If `playerName` (an `export const` arrow) causes a TDZ error at import time, it won't — it's only read inside `unresolvedSummary`.

- [ ] **Step 4: Run and confirm pass**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/sitePoints.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sitePoints.js test/sitePoints.test.js
git commit -m "feat: sitePoints — map site gameweeks onto matches, site-first appearance points"
```

---

### Task 3: Route every points derivation through `appearancePoints`

**Files:**
- Modify: `src/lib/store.js` (`playerTotals`, `mismatchInfo`, `hotEventIds`, `leagueTable`, `allMatchTeamPoints`), `src/lib/series.js`
- Test: `test/sitePoints.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/sitePoints.test.js` (add `playerTotals, leagueTable, allMatchTeamPoints, hotEventIds, mismatchInfo` to the `store.js` import, and `import { playerWeeklySeries, teamWeeklySeries } from "../src/lib/series.js";`):

```js
describe("derivations use site points", () => {
  const synced = () => view(sync(base(), { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] }));
  it("playerTotals: site 12 for R1 + ours 4 for R2", () => {
    expect(playerTotals(synced(), "10").points).toBe(16);
  });
  it("leagueTable fantasy and allMatchTeamPoints", () => {
    const v = synced();
    expect(leagueTable(v).find((r) => r.teamId === 1).fantasy).toBe(16); // Burke has no position -> nothing
    expect(allMatchTeamPoints(v).get(100)).toEqual({ home: 12, away: 0 });
  });
  it("series: player and team fantasy per gameweek", () => {
    const v = synced();
    expect(playerWeeklySeries(v, "10", "fantasy").find((p) => p.round === 1).value).toBe(12);
    expect(teamWeeklySeries(v, 1, "fantasy").find((p) => p.round === 1).value).toBe(12);
  });
  it("hotEventIds scores with site points", () => {
    // three 12s via site in R1..R3 would be hot; here only R1 is a site 12, so check the scores feed through:
    let d = imp(base(), match(103, 3, 1, 2, 2, 1), [app(103, 10, 1), app(103, 11, 1)]);
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST], [2, "c3", "c1", 12, FT_WIN_GOAL_ASSIST], [3, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    expect(hotEventIds(view(d), "10").size).toBeGreaterThan(0);
  });
  it("mismatchInfo compares our scoring on both sides", () => {
    let d = setPlayerField(base(), 10, "realPosition", "MID");
    d = sync(d, { "501": [[1, "c1", "c2", 12, FT_WIN_GOAL_ASSIST]] });
    // ours FWD (9 + 4) vs ours MID (10 + 4): delta -1, the site's 12 plays no part
    expect(mismatchInfo(view(d), "10")).toEqual({ realPosition: "MID", delta: -1 });
  });
});
```

Before writing this test, check the hot rule constants (`HOT_WINDOW`, `HOT_NEEDED`, `HOT_THRESHOLD` near `hotEventIds` in `store.js`). If three 12-point games in three team matches isn't hot under them, change the assertion to the correct expectation for those constants. The point of the test is that site totals feed the hot rule.

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/sitePoints.test.js`
Expected: the new "derivations use site points" tests FAIL (they get our 9, not the site's 12).

- [ ] **Step 3: Implement in `store.js`**

Add the import at the top (keep `scoreAppearance` only if still used elsewhere in the file; remove it if not):

```js
import { appearancePoints } from "./sitePoints.js";
```

`playerTotals` — replace the points block at the end of the loop:

```js
    if (t.points !== null) {
      const match = data.matches[a.eventId];
      if (match?.goalTimes) t.points += scoreAppearance(a, match, position, adj).total;
    }
```

with:

```js
    // site points win (sitePoints.js); an explicit opts.position is a what-if -> ours only
    const pts = appearancePoints(data, a, { position: opts.position ?? null }).total;
    if (pts != null) t.points = (t.points ?? 0) + pts;
```

(`points` still starts at `position ? 0 : null`, so a positioned player with no appearances keeps 0, and a positionless player with site points now gets them.)

`mismatchInfo` — make both sides ours:

```js
  const gamePts = playerTotals(data, playerId, { position: player.gamePosition, apps: theirApps }).points ?? 0;
```

`hotEventIds` — replace the two lines

```js
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    return scoreAppearance(a, m, player.gamePosition, adj).total;
```

with

```js
    return appearancePoints(data, a).total;
```

`leagueTable` — replace

```js
    const p = data.players[a.playerId];
    if (p?.gamePosition) r.fantasy += scoreAppearance(a, m, p.gamePosition, adj).total;
```

with

```js
    const pts = appearancePoints(data, a).total;
    if (pts != null) r.fantasy += pts;
```

`allMatchTeamPoints` — replace the loop body with:

```js
  for (const a of Object.values(data.appearances)) {
    const m = data.matches[a.eventId];
    if (!m?.goalTimes) continue;
    const t = out.get(a.eventId) || { home: 0, away: 0 };
    out.set(a.eventId, t);
    const pts = appearancePoints(data, a).total;
    if (pts == null) continue; // no computable points (no position, no site value)
    t[a.teamId === m.homeTeamId ? "home" : "away"] += pts;
  }
```

Update the comment above it: "Players with no points (no position and no site value) contribute nothing."

- [ ] **Step 4: Implement in `series.js`**

Replace `import { scoreAppearance } from "./scoring.js";` with `import { appearancePoints } from "./sitePoints.js";`.

`appearanceStat` gains `data` as its first parameter; its fantasy line becomes:

```js
function appearanceStat(data, a, m, position, adj, stat) {
  if (stat === "fantasy") return appearancePoints(data, a).total ?? 0;
```

In `playerWeeklySeries`, the call becomes `appearanceStat(data, a, m, position, adj, stat)`.

In `teamWeeklySeries`, replace

```js
      if (stat === "fantasy" && !p?.gamePosition) continue; // no computable points
      byRound.set(r, (byRound.get(r) || 0) + appearanceStat(a, m, p?.gamePosition, adj, stat));
```

with

```js
      if (stat === "fantasy") {
        const pts = appearancePoints(data, a).total;
        if (pts != null) byRound.set(r, (byRound.get(r) || 0) + pts); // null: no computable points
        continue;
      }
      byRound.set(r, (byRound.get(r) || 0) + appearanceStat(data, a, m, p?.gamePosition, adj, stat));
```

- [ ] **Step 5: Run the whole suite**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test`
Expected: all pass. With no site data every existing test must behave exactly as before; if one fails, the routing changed behaviour — fix the code, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.js src/lib/series.js test/sitePoints.test.js
git commit -m "feat: totals, table, hot, team points and series use site points when present"
```

---

### Task 4: The sync snippet

**Files:**
- Modify: `src/lib/fantasyImport.js` (add `buildSyncSnippet`, delete `buildFantasySnippet`)
- Test: `test/fantasyImport.test.js` (replace the `buildFantasySnippet` describe block)

The snippet runs in the user's browser on the fantasy site, so it can't be unit-tested beyond its text. Tests check that it interpolates and that it is valid JavaScript. Markup facts it relies on are in the spec's Background table; do not "improve" selectors without real HTML to check against.

- [ ] **Step 1: Write the failing tests**

In `test/fantasyImport.test.js`, change the import to use `buildSyncSnippet` instead of `buildFantasySnippet`, delete the whole `describe("buildFantasySnippet", …)` block, and add:

```js
describe("buildSyncSnippet", () => {
  const snip = buildSyncSnippet({ siteTeamId: 7378 });
  it("is valid JavaScript", () => {
    expect(() => new Function(snip)).not.toThrow();
  });
  it("embeds the team id and reads the four site pages", () => {
    expect(snip).toContain("TEAM = 7378");
    for (const p of ["/Stats/PlayerStats", "/Team/Transfers", "/Results?teamId=", "/ViewPlayer/ViewPlayer?playerId="]) {
      expect(snip).toContain(p);
    }
  });
  it("produces a version-1 sync file as a download", () => {
    expect(snip).toContain('source: "fantasyloi-sync", version: 1');
    expect(snip).toContain("fancystats-sync-");
    expect(snip).toContain(".download");
  });
  it("refuses to build without a team id", () => {
    expect(() => buildSyncSnippet({})).toThrow(/team id/);
    expect(() => buildSyncSnippet({ siteTeamId: "abc" })).toThrow(/team id/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/fantasyImport.test.js`
Expected: FAIL (`buildSyncSnippet` is not exported).

- [ ] **Step 3: Implement**

In `src/lib/fantasyImport.js`, delete `buildFantasySnippet` and its comment block, and add:

```js
// Returns the Fantasy sync console snippet. The user pastes it into a logged-in
// fantasyloi.leagueofireland.ie tab (any page). ~340 read-only requests, 300ms
// apart, one retry each (the site throws the odd HTTP 500), all-or-nothing:
//   1. Player Stats (token + 14 POSTs): price, position, total for every player
//   2. /Team/Transfers: site ids for players you don't own
//   3. /Results for every gameweek: your XI rows, bench, captain, points (+ squad site ids)
//   4. /ViewPlayer for every site id: each gameweek's points breakdown
// It downloads fancystats-sync-YYYY-MM-DD.json for Settings → Fantasy sync.
export function buildSyncSnippet({ siteTeamId } = {}) {
  const team = Number(siteTeamId);
  if (!Number.isInteger(team) || team <= 0) throw new Error("Set your fantasy team id first.");
  return `// fancystats fantasy sync — run on a logged-in fantasyloi.leagueofireland.ie tab (any page).
(async () => {
  const HOST = "fantasyloi.leagueofireland.ie", TEAM = ${team};
  const POS = [["Goalkeeper", "GK"], ["Defender", "DEF"], ["Midfielder", "MID"], ["Forward", "FWD"]];
  const say = (m, c) => console.log("%cfancystats: " + m, "color:" + (c || "gray") + ";font-weight:bold");
  if (!location.hostname.endsWith(HOST)) return say("run this on a " + HOST + " tab.", "red");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (e) => (e ? e.textContent : "").replace(/\\s+/g, " ").trim();
  const num = (s) => { const m = String(s == null ? "" : s).match(/-?\\d+(?:\\.\\d+)?/); return m ? parseFloat(m[0]) : null; };
  const path = (src) => { try { return new URL(src, location.href).pathname; } catch (e) { return src || ""; } };
  const load = async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, Object.assign({ credentials: "include" }, init));
      if (r.ok) {
        const doc = new DOMParser().parseFromString(await r.text(), "text/html");
        await sleep(300);
        return doc;
      }
      if (attempt >= 1) throw new Error("HTTP " + r.status + " on " + url);
      await sleep(1500);
    }
  };
  try {
    // 1. prices, positions, totals: the Player Stats form, read from a fetched copy so any page works
    const statsPage = await load("/Stats/PlayerStats");
    const tokenEl = statsPage.querySelector("input[name=__RequestVerificationToken]");
    const clubSel = statsPage.querySelector("select#Club");
    if (!tokenEl || !clubSel) throw new Error("couldn't read the Player Stats form — log in on the fantasy site, then re-run");
    const token = tokenEl.value;
    const clubs = [...clubSel.options].filter((o) => o.value !== "All").map((o) => ({ id: o.value, name: o.text.trim() }));
    const post = async (Statistic, Club, Position) => {
      const doc = await load("/Stats/PlayerStats", { method: "POST", body: new URLSearchParams({ Statistic, Club, Position, __RequestVerificationToken: token }) });
      if (!doc.querySelector("select#Club")) throw new Error("session expired — log in again, then re-run");
      return [...doc.querySelectorAll("table.table tbody tr")].map((tr) => {
        const img = tr.querySelector("img");
        return { name: txt(tr.cells[1]), value: num(tr.cells[2] ? tr.cells[2].textContent : null), crest: img ? path(img.getAttribute("src")) : "" };
      }).filter((x) => x.name);
    };
    const rows = new Map(), crestToClub = new Map();
    const key = (n, c) => n + "|" + c;
    for (const c of clubs) {
      const list = await post("Value", c.id, "All");
      for (const x of list) {
        if (x.crest) crestToClub.set(x.crest, c.id);
        const k = key(x.name, c.id);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: c.id, price: x.value }));
      }
      say("prices — " + c.name + ": " + list.length);
    }
    for (const pair of POS) {
      const list = await post("Total Score", "All", pair[0]);
      for (const x of list) {
        const clubId = crestToClub.get(x.crest) || null;
        const k = key(x.name, clubId);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: clubId, position: pair[1], sitePoints: x.value }));
      }
      say("points — " + pair[1] + ": " + list.length);
    }
    const club = (img) => (img ? crestToClub.get(path(img.getAttribute("src"))) || null : null);
    const byName = new Map();
    for (const row of rows.values()) byName.set(row.name, byName.has(row.name) ? null : row); // null = ambiguous
    // 2. site ids: Transfers lists every player you don't own
    const tr = await load("/Team/Transfers");
    const body = tr.querySelector("#boday");
    if (!body) throw new Error("couldn't read the Transfers page — log in on the fantasy site, then re-run");
    const ids = new Set();
    for (const r of body.querySelectorAll("tr")) {
      const id = num(txt(r.cells[7]));
      if (!id) continue;
      ids.add(id);
      const img = r.cells[2] ? r.cells[2].querySelector("img") : null;
      if (img) { // its title names the club: teach the crest map this crest path too
        const c = clubs.find((x) => x.name === img.getAttribute("title"));
        if (c) crestToClub.set(path(img.getAttribute("src")), c.id);
      }
      const name = txt(r.cells[1]);
      const row = rows.get(key(name, club(img))) || byName.get(name);
      if (row) row.siteId = id;
    }
    say("site ids: " + ids.size);
    // 3. your team, every gameweek
    const first = await load("/Results?teamId=" + TEAM + "&gameweek=1");
    const gws = [...new Set([...first.querySelectorAll("select option")].map((o) => Number(o.value))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 100))].sort((a, b) => a - b);
    if (!gws.length) throw new Error("couldn't read your Results page — check your team id (" + TEAM + ") and that you're logged in");
    const card = (el) => {
      const m = (el.getAttribute("onclick") || "").match(/playerScore\\('(\\d+)',\\s*'(.*)',\\s*'(-?\\d+)'\\)/);
      return m && { id: Number(m[1]), name: m[2], pts: Number(m[3]), captain: el.textContent.includes("(c)") };
    };
    const myTeam = {}, squadIds = new Map();
    for (const gw of gws) {
      const doc = gw === 1 ? first : await load("/Results?teamId=" + TEAM + "&gameweek=" + gw);
      const pitch = doc.querySelector(".pitch");
      if (!pitch) continue;
      const lines = [...pitch.children].map((row) => [...row.querySelectorAll("[onclick^=playerScore]")].map(card).filter(Boolean)).filter((l) => l.length);
      const bench = [...doc.querySelectorAll("[onclick^=playerScore]")].filter((el) => !pitch.contains(el)).map(card).filter(Boolean);
      const all = lines.flat().concat(bench);
      if (!all.length) continue;
      const h = [...doc.querySelectorAll("h2")].find((x) => /Points/.test(x.textContent));
      const g = { lines: lines.map((l) => l.map((x) => x.id)), bench: bench.map((x) => x.id),
        captain: (all.find((x) => x.captain) || {}).id || null, shown: {}, names: {}, total: h ? num(h.textContent) : null };
      for (const x of all) { g.shown[x.id] = x.pts; g.names[x.id] = x.name; ids.add(x.id); squadIds.set(x.name, x.id); }
      myTeam[gw] = g;
      say("your team — GW " + gw + ": " + (g.total == null ? "?" : g.total) + " pts");
    }
    // squad players aren't on Transfers: join them to their Player Stats row by name
    for (const row of rows.values()) if (row.siteId == null && squadIds.has(row.name)) row.siteId = squadIds.get(row.name);
    // 4. every player's season, gameweek by gameweek
    const history = {};
    let n = 0;
    for (const id of ids) {
      const doc = await load("/ViewPlayer/ViewPlayer?playerId=" + id);
      history[id] = [...doc.querySelectorAll('[id$="+MatchDetails"]')].map((b) => {
        const imgs = b.querySelectorAll(".card-body img");
        const stats = [...b.querySelectorAll("table tbody tr")].map((r) => [...r.cells].map(txt))
          .filter((r) => r.length === 3 && r[0] !== "Stat").map((r) => [r[0], r[1], num(r[2])]);
        return [num(txt(b.querySelector(".card-header label"))), club(imgs[0]), club(imgs[1]), num(txt(b.querySelector(".card-body p"))), stats];
      });
      if (++n % 25 === 0) say("history: " + n + "/" + ids.size);
    }
    const blob = { meta: { source: "fantasyloi-sync", version: 1, capturedAt: Date.now(), siteTeamId: TEAM, clubs: clubs },
      players: [...rows.values()], history: history, myTeam: myTeam };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: "application/json" }));
    a.download = "fancystats-sync-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    say("done — " + blob.players.length + " players, " + ids.size + " histories, " + Object.keys(myTeam).length +
      " gameweeks of your team. Load the downloaded file in fancystats → ⚙ → Fantasy sync.", "lime");
  } catch (e) {
    say(e.message + " — nothing captured, re-run from the start.", "red");
  }
})();`;
}
```

Also remove the now-dead `SNIPPET`/`buildFantasySnippet` import from `src/components/FantasyImport.jsx` **only if** Task 6 hasn't run yet and the build breaks. Simplest: in this task, change that file's import line to drop `buildFantasySnippet` and replace `const SNIPPET = buildFantasySnippet();` with `const SNIPPET = "";` so the build stays green; Task 6 rewrites the card.

- [ ] **Step 4: Run tests and build**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
Expected: tests pass except possibly the `FantasyImport SSR` test in `test/fantasyImport.test.jsx` that expects `/Stats/PlayerStats` in the markup — if it fails, delete that one `it(...)` block (Task 6 replaces it). Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fantasyImport.js src/components/FantasyImport.jsx test/fantasyImport.test.js test/fantasyImport.test.jsx
git commit -m "feat: Fantasy sync snippet (prices, site ids, my team, per-gameweek history)"
```

---

### Task 5: My Team derivations

**Files:**
- Create: `src/lib/myTeam.js`
- Test: `test/myTeam.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/myTeam.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { myTeamGameweeks, myTeamGameweek, myTeamSeries } from "../src/lib/myTeam.js";

const NOW = 1765000000000;
function synced(myTeam) {
  const d = applyImport(emptyData(), {
    match: { eventId: 100, round: 1, kickoff: NOW - 1e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
      homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }],
    appearances: [],
  }, NOW);
  const s = applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {}, myTeam },
    [{ playerId: "10", siteId: 501 }], NOW);
  return seasonView(s, s.meta.seasonId);
}
const GW = (total, captain) => ({
  lines: [[601], [602, 603], [604], [501]], bench: [605], captain,
  shown: { "501": 16, "601": 3, "602": 2, "603": 1, "604": 5, "605": 0 },
  names: { "501": "Aidan Keena", "601": "Ed McGinty", "602": "Joe Redmond", "603": "Lee Grace", "604": "Jack Byrne", "605": "Hugo Cunha" },
  total,
});

describe("myTeam", () => {
  it("lists captured gameweeks in order", () => {
    expect(myTeamGameweeks(synced({ "10": GW(50, 501), "2": GW(40, 501) }))).toEqual([2, 10]);
    expect(myTeamGameweeks(seasonView(emptyData(), 87682))).toEqual([]);
  });
  it("builds a gameweek: labelled lines, bench, captain, linked players", () => {
    const t = myTeamGameweek(synced({ "3": GW(83, 501) }), 3);
    expect(t.gw).toBe(3);
    expect(t.total).toBe(83);
    expect(t.lines.map((l) => l.label)).toEqual(["GK", "DEF", "MID", "FWD"]);
    expect(t.lines[3].players[0]).toEqual({ siteId: 501, playerId: "10", name: "A Keena", points: 16, captain: true });
    expect(t.lines[0].players[0]).toEqual({ siteId: 601, playerId: null, name: "Ed McGinty", points: 3, captain: false });
    expect(t.bench.map((e) => e.name)).toEqual(["Hugo Cunha"]);
  });
  it("labels lines XI when the site's rows aren't the usual four", () => {
    const t = myTeamGameweek(synced({ "1": { ...GW(10, null), lines: [[601, 602, 603, 604, 501]] } }), 1);
    expect(t.lines.map((l) => l.label)).toEqual(["XI"]);
  });
  it("returns null for a gameweek that wasn't captured", () => {
    expect(myTeamGameweek(synced({ "1": GW(10, 501) }), 7)).toBe(null);
  });
  it("season series of totals", () => {
    expect(myTeamSeries(synced({ "2": GW(40, 501), "1": GW(55, 501) }))).toEqual([{ gw: 1, total: 55 }, { gw: 2, total: 40 }]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/myTeam.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/myTeam.js`**

```js
// src/lib/myTeam.js
// The user's own fantasy team per gameweek, from the season's site data
// (view.site.myTeam, stored raw by applySiteSync). Season views only.
import { playerName } from "./store.js";

export const LINE_LABELS = ["GK", "DEF", "MID", "FWD"];

function bySiteId(players) {
  const m = new Map();
  for (const [pid, p] of Object.entries(players || {})) if (p.siteId != null) m.set(Number(p.siteId), pid);
  return m;
}

export function myTeamGameweeks(view) {
  return Object.keys(view.site?.myTeam || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

// -> { gw, total, lines: [{label, players}], bench } | null; entries are
// { siteId, playerId|null, name, points, captain }. Lines are the site's own pitch rows.
export function myTeamGameweek(view, gw) {
  const g = view.site?.myTeam?.[gw];
  if (!g) return null;
  const ids = bySiteId(view.players);
  const entry = (sid) => {
    const playerId = ids.get(Number(sid)) ?? null;
    return {
      siteId: Number(sid),
      playerId,
      name: playerId ? playerName(view.players[playerId]) : g.names?.[sid] ?? `#${sid}`,
      points: g.shown?.[sid] ?? null,
      captain: g.captain != null && Number(sid) === Number(g.captain),
    };
  };
  const lines = g.lines || [];
  return {
    gw: Number(gw),
    total: g.total ?? null,
    lines: lines.map((l, i) => ({ label: lines.length === LINE_LABELS.length ? LINE_LABELS[i] : "XI", players: l.map(entry) })),
    bench: (g.bench || []).map(entry),
  };
}

export function myTeamSeries(view) {
  return myTeamGameweeks(view).map((gw) => ({ gw, total: view.site.myTeam[gw].total ?? null }));
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/myTeam.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/myTeam.js test/myTeam.test.js
git commit -m "feat: myTeam derivations (gameweek lines, bench, captain, season series)"
```

---

### Task 6: Settings — the Fantasy sync card

**Files:**
- Modify: `src/components/FantasyImport.jsx` (rewrite as the sync card; keep the `defaultLinks` and `appliedMessage` exports unchanged), `src/components/SettingsTab.jsx`
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing SSR test**

In `test/fantasyImport.test.jsx`, replace the whole `describe("FantasyImport SSR", …)` block with:

```js
describe("FantasyImport (Fantasy sync) SSR", () => {
  it("asks for the team id before offering the snippet", () => {
    const d = dataWithPlayers();
    const html = renderToStaticMarkup(<FantasyImport data={d} fullData={d} update={() => {}} />);
    expect(html).toContain("Fantasy sync");
    expect(html).toContain("team id");
    expect(html).toContain("disabled");
  });
  it("offers the snippet and the file input once the team id is set", () => {
    const d = { ...dataWithPlayers(), meta: { ...dataWithPlayers().meta, siteTeamId: 7378 } };
    const html = renderToStaticMarkup(<FantasyImport data={d} fullData={d} update={() => {}} />);
    expect(html).toContain("Copy snippet");
    expect(html).toContain('type="file"');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/fantasyImport.test.jsx`
Expected: FAIL ("Fantasy sync" not found).

- [ ] **Step 3: Rewrite `src/components/FantasyImport.jsx`**

Keep the file's existing `defaultLinks` and `appliedMessage` functions exactly as they are. Replace everything else with:

```jsx
// src/components/FantasyImport.jsx — the Fantasy sync card (Settings).
import { useMemo, useState } from "react";
import { buildSyncSnippet, parseSyncBlob, mapClubs, withTeamIds, shouldCreateRow } from "../lib/fantasyImport.js";
import { matchPlayers } from "../lib/pasteImport.js";
import { applySiteSync, addFantasyOnlyPlayers } from "../lib/store.js";
import { seasonView } from "../lib/seasons.js";
import { unresolvedSummary } from "../lib/sitePoints.js";
import UnmatchedLinks, { NEW_PLAYER } from "./UnmatchedLinks.jsx";
import CopyButton from "./CopyButton.jsx";
import Flash from "./Flash.jsx";

// (defaultLinks and appliedMessage stay here, unchanged)

const REASON_TEXT = {
  "no-match": "no match in that round for their team — check the round of a postponed or rearranged match",
  "no-appearance": "played on the site but SofaScore has no appearance (not counted)",
};

export default function FantasyImport({ data, fullData, update }) {
  const [teamInput, setTeamInput] = useState(data.meta.siteTeamId ?? "");
  const [preview, setPreview] = useState(null); // { parsed, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const teamId = Number(data.meta.siteTeamId);
  const snippet = useMemo(() => (teamId > 0 ? buildSyncSnippet({ siteTeamId: teamId }) : ""), [teamId]);

  const saveTeam = () => {
    const n = Number(teamInput);
    if (Number.isInteger(n) && n > 0 && n !== data.meta.siteTeamId) {
      update((d) => ({ ...d, meta: { ...d.meta, siteTeamId: n } }));
    }
  };

  const buildPreview = (parsed, overrides) => {
    const clubMap = mapClubs(parsed.clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(parsed.players, clubMap), data.players);
    return { parsed, clubMap, matched, unmatched, links: defaultLinks(unmatched, data.players) };
  };

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-loading the same file
    if (!file) return;
    setError(null); setFlash(null);
    try {
      setPreview(buildPreview(parseSyncBlob(await file.text()), data.meta.fantasyClubMap));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    }
  };

  const setClub = (clubId, tid) => {
    const overrides = { ...(data.meta.fantasyClubMap || {}), [clubId]: tid };
    update((d) => ({ ...d, meta: { ...d.meta, fantasyClubMap: overrides } }));
    if (preview) setPreview(buildPreview(preview.parsed, overrides));
  };

  const picks = preview ? preview.unmatched.map((u, i) => ({ u, pid: preview.links[i] })) : [];
  const linked = picks.filter((x) => x.pid && x.pid !== NEW_PLAYER).map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
  const created = picks.filter((x) => x.pid === NEW_PLAYER).map((x) => x.u);

  // What the site data will look like once applied: a trial sync, projected like the app does.
  const attention = useMemo(() => {
    if (!preview) return [];
    const trial = applySiteSync(fullData, preview.parsed, [...preview.matched, ...linked], 0);
    return unresolvedSummary(seasonView(trial, trial.meta.seasonId));
  }, [preview, fullData]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const now = Date.now(); // updaters stay pure
    const rows = [...preview.matched, ...linked];
    update((d) => {
      const next = applySiteSync(d, preview.parsed, rows, now);
      return created.length ? addFantasyOnlyPlayers(next, created, now) : next;
    });
    const gws = Object.keys(preview.parsed.myTeam).length;
    setFlash(`${appliedMessage(rows.length, created.length)} · ${gws} gameweek${gws === 1 ? "" : "s"} of your team`);
    setPreview(null);
  };

  const unresolvedClubs = preview ? preview.parsed.clubs.filter((c) => !preview.clubMap[String(c.id)]) : [];
  const clubName = new Map((preview?.parsed.clubs || []).map((c) => [String(c.id), c.name]));
  const historyCount = preview ? Object.keys(preview.parsed.history).length : 0;
  const teamGws = preview ? Object.keys(preview.parsed.myTeam).length : 0;
  const linkCount = linked.length;
  const newCount = created.length;

  return (
    <div className="card">
      <h3>Fantasy sync</h3>
      <p className="dim">
        Brings in prices, positions, the site&rsquo;s points for every player and gameweek, and your
        own team. Run the snippet in a logged-in <code>fantasyloi.leagueofireland.ie</code> tab&rsquo;s
        DevTools console (type <code>allow pasting</code> if prompted). It takes about 2½ minutes and
        downloads a file; load that file below.
      </p>
      <div className="row">
        <label>Your fantasy team id{" "}
          <input value={teamInput} style={{ width: 90 }} inputMode="numeric"
            onChange={(e) => setTeamInput(e.target.value)} onBlur={saveTeam} />
        </label>
        <span className="dim">the number in your Results page link (…teamId=<b>7378</b>)</span>
      </div>
      <div className="row">
        {snippet
          ? <CopyButton text={snippet}>Copy snippet</CopyButton>
          : <button disabled title="Enter your fantasy team id first">Copy snippet</button>}
        <a className="ext" href="https://fantasyloi.leagueofireland.ie/" target="_blank" rel="noreferrer">Open the fantasy site ↗</a>
      </div>
      {snippet && (
        <div className="row">
          <label>Load the downloaded file <input type="file" accept=".json,application/json" onChange={loadFile} /></label>
        </div>
      )}
      <Flash message={flash} onDone={() => setFlash(null)} />
      {error && <div className="banner err">{error}</div>}
      {preview && (
        <div style={{ marginTop: 8 }}>
          <p>
            ✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched
            {newCount ? ` · ${newCount} to add as new` : ""} · {historyCount} player histories · {teamGws} gameweeks of your team
          </p>
          {attention.length > 0 && (
            <div className="banner warn">
              <strong>Site gameweeks needing attention</strong>
              {attention.map((a) => (
                <div key={`${a.gw}|${a.reason}`}>
                  GW{a.gw}: {a.count} player-gameweek{a.count === 1 ? "" : "s"} — {REASON_TEXT[a.reason]}
                  <span className="dim"> ({a.names.slice(0, 5).join(", ")}{a.names.length > 5 ? "…" : ""})</span>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <button className="primary" onClick={apply}>
              Apply {preview.matched.length + linkCount} players{newCount ? ` + ${newCount} new` : ""}
            </button>
          </div>
          {unresolvedClubs.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p className="dim">Unrecognised clubs — bind them once and it&rsquo;s remembered:</p>
              {unresolvedClubs.map((c) => (
                <div className="link-row" key={c.id}>
                  <span className="link-name">{c.name}</span>
                  <select className="link-pick" value=""
                    onChange={(e) => e.target.value && setClub(String(c.id), e.target.value)}>
                    <option value="">choose team…</option>
                    {Object.entries(data.teams)
                      .sort((a, b) => a[1].name.localeCompare(b[1].name))
                      .map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <UnmatchedLinks
            data={data}
            unmatched={preview.unmatched}
            links={preview.links}
            allowNew
            onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
            columns={[
              { label: "Pos", width: "3.5rem", value: (u) => u.gamePosition },
              { label: "Price", width: "4.5rem", value: (u) => (u.price != null ? `€${u.price}` : "") },
              // pts is the triage signal: 0 means they've never played, so there's
              // no SofaScore record to link them to and skipping is correct
              { label: "Pts", width: "3.5rem", value: (u) => (u.sitePoints != null ? String(u.sitePoints) : "") },
              { label: "Club", width: "9.5rem", value: (u) => clubName.get(String(u.clubId)) || "" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
```

Note the `attention` memo depends on `linked`, which is rebuilt every render; listing `preview` (whose `links` change creates a new object) is enough. Keep the eslint comment.

In `src/components/SettingsTab.jsx`, change `<FantasyImport data={data} update={update} />` to:

```jsx
      <FantasyImport data={data} fullData={fullData} update={update} />
```

and update the paste card's fallback sentence "Fallback for when the snippet above can&rsquo;t run." — leave it as is (still true).

- [ ] **Step 4: Run tests and build**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/FantasyImport.jsx src/components/SettingsTab.jsx test/fantasyImport.test.jsx
git commit -m "feat: Fantasy sync card — team id, snippet, file load, attention list, apply"
```

---

### Task 7: Points source on screen (TeamsTab, PlayerDetail)

**Files:**
- Modify: `src/components/Pills.jsx`, `src/styles.css`, `src/components/TeamsTab.jsx`, `src/components/PlayerDetail.jsx`
- Test: `test/siteUi.test.jsx` (new)

- [ ] **Step 1: Write the failing SSR test**

```jsx
// test/siteUi.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, applyImport, setPlayerField, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import PlayerDetail from "../src/components/PlayerDetail.jsx";
import { PtsPill } from "../src/components/Pills.jsx";

const NOW = 1765000000000;
const app = (eventId, extra = {}) => ({ eventId, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null,
  minutes: 90, positionPlayed: "F", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false,
  penMissed: 0, penSaved: 0, ...extra });
function fixture() {
  let d = emptyData();
  const teams = [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }];
  const players = [{ id: 10, name: "A Keena", teamId: 1 }];
  d = applyImport(d, { match: { eventId: 100, round: 1, kickoff: NOW - 2e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
    homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false }, teams, players, appearances: [app(100, { goals: 1 })] }, NOW);
  d = applyImport(d, { match: { eventId: 101, round: 2, kickoff: NOW - 1e6, status: "finished", homeTeamId: 2, awayTeamId: 1,
    homeScore: 0, awayScore: 0, goalTimes: { home: [], away: [] }, partial: false }, teams, players, appearances: [app(101)] }, NOW);
  d = setPlayerField(d, 10, "gamePosition", "FWD");
  return applySiteSync(d, { capturedAt: NOW, siteTeamId: 7378, clubs: [{ id: "c1", name: "Shamrock Rovers" }, { id: "c2", name: "Bohemians" }],
    players: [], myTeam: {},
    history: { "501": [[1, "c1", "c2", 12, [["Appearance", "Full Game", 3], ["Team Result", "Win", 2], ["Goals", "1", 4], ["Assists", "1", 3]]]] } },
    [{ playerId: "10", siteId: 501 }], NOW);
}

describe("points source in the UI", () => {
  it("PtsPill marks our estimates", () => {
    expect(renderToStaticMarkup(<PtsPill pts={4} est />)).toContain("est");
    expect(renderToStaticMarkup(<PtsPill pts={4} />)).not.toContain("est");
  });
  it("PlayerDetail shows the site total, the disagreement, and italic estimates", () => {
    const d = fixture();
    const v = seasonView(d, d.meta.seasonId);
    const html = renderToStaticMarkup(
      <PlayerDetail data={v} fullData={d} update={() => {}} readOnly={false} playerId="10" onBack={() => {}} />,
    );
    expect(html).toContain("12");                  // site total for R1
    expect(html).toContain("ours 9 (assists)");    // the disagreement
    expect(html).toContain("our estimate");        // R2 is ours only
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/siteUi.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/components/Pills.jsx` — `PtsPill` becomes:

```jsx
// est: our own scoring, not the site's (shown once the season has site data)
export function PtsPill({ pts, est = false }) {
  if (pts == null) return <span className="dim">·</span>;
  return (
    <span className={`chip${est ? " est" : ""}`} style={{ background: ptsColor(pts), color: "#fff" }}
      title={est ? "our estimate (site not captured yet)" : undefined}>{pts}</span>
  );
}
```

`src/styles.css` — append:

```css
/* points from our scoring where the fantasy site has no value yet */
.chip.est, .est { font-style: italic; opacity: 0.85; }
```

`src/components/TeamsTab.jsx`:
- Replace `import { scoreAppearance } from "../lib/scoring.js";` with `import { appearancePoints } from "../lib/sitePoints.js";`.
- In the totals loop (~line 120) replace
  `const pts = pp?.gamePosition && m?.goalTimes ? scoreAppearance(a, m, pp.gamePosition, adj).total : null;`
  with `const pts = appearancePoints(data, a).total;` (remove `pp`/`m` locals only if now unused).
- In the per-match cell (~line 282) replace the `pts` computation with:

```jsx
                      const res = a ? appearancePoints(data, a) : null;
                      const pts = res?.total ?? null;
                      const est = !!data.site && res?.source === "ours";
```

  and render `<PtsPill pts={pts} est={est} />` in that cell.

`src/components/PlayerDetail.jsx`:
- Replace `import { scoreAppearance } from "../lib/scoring.js";` with `import { appearancePoints, diffComponents } from "../lib/sitePoints.js";`.
- In the appearance table row, replace the `score` line and the Pts `<td>` with:

```jsx
              const res = appearancePoints(data, a);
              const diff = res.site && res.ours && res.site.total !== res.ours.total
                ? diffComponents(res.site.rows, res.ours.breakdown) : null;
              const est = !!data.site && res.source === "ours";
              const tip = res.site
                ? res.site.rows.map(([s, v, p]) => `${s} ${v}: ${p > 0 ? "+" : ""}${p}`).join(", ") +
                  (adj ? " · the site's value overrides your adjustment" : "")
                : res.ours ? res.ours.breakdown.map(([r, v]) => `${r} ${v > 0 ? "+" : ""}${v}`).join(", ") : "";
```

```jsx
                  <td title={est ? `our estimate (site not captured yet): ${tip}` : tip} className={est ? "est" : undefined}>
                    {res.total ?? "—"}
                    {diff && <span className="dim"> · ours {res.ours.total} ({diff.join(", ")})</span>}
                  </td>
```

- [ ] **Step 4: Run tests and build**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Pills.jsx src/styles.css src/components/TeamsTab.jsx src/components/PlayerDetail.jsx test/siteUi.test.jsx
git commit -m "feat: show where points come from — site totals, our estimates in italics, disagreements"
```

---

### Task 8: My Team tab

**Files:**
- Create: `src/components/MyTeamTab.jsx`
- Modify: `src/components/GameweekChart.jsx`, `src/App.jsx`
- Test: `test/myTeamTab.test.jsx` (new)

- [ ] **Step 1: Write the failing SSR test**

```jsx
// test/myTeamTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import MyTeamTab from "../src/components/MyTeamTab.jsx";

const NOW = 1765000000000;
const gw = (total) => ({
  lines: [[601], [602], [603], [604]], bench: [605], captain: 604,
  shown: { "601": 3, "602": 2, "603": 5, "604": 16, "605": 0 },
  names: { "601": "Ed McGinty", "602": "Joe Redmond", "603": "Jack Byrne", "604": "Tommy Lonergan", "605": "Hugo Cunha" },
  total,
});

describe("MyTeamTab SSR", () => {
  it("points to Settings when nothing is captured", () => {
    const d = emptyData();
    const html = renderToStaticMarkup(<MyTeamTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />);
    expect(html).toContain("Fantasy sync");
  });
  it("shows the latest gameweek with lines, captain, bench and total", () => {
    const d = applySiteSync(emptyData(), { capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {},
      myTeam: { "34": gw(40), "35": gw(83) } }, [], NOW);
    const html = renderToStaticMarkup(<MyTeamTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />);
    expect(html).toContain("83 pts");
    expect(html).toContain("Tommy Lonergan");
    expect(html).toContain("(c)");
    expect(html).toContain("Bench");
    expect(html).toContain("GW 35");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/myTeamTab.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Make `onClear` optional in `GameweekChart.jsx`**

Replace

```jsx
        <button onClick={onClear} style={{ marginLeft: "auto" }}>Clear</button>
```

with

```jsx
        {onClear && <button onClick={onClear} style={{ marginLeft: "auto" }}>Clear</button>}
```

- [ ] **Step 4: Create `src/components/MyTeamTab.jsx`**

```jsx
// src/components/MyTeamTab.jsx — your fantasy team per gameweek (from Fantasy sync).
import { useState } from "react";
import { myTeamGameweeks, myTeamGameweek, myTeamSeries } from "../lib/myTeam.js";
import { PtsPill } from "./Pills.jsx";
import GameweekChart from "./GameweekChart.jsx";

function Entry({ e, openPlayer }) {
  const name = e.playerId
    ? <span className="cell-click" style={{ textDecoration: "underline dotted" }} onClick={() => openPlayer(e.playerId)}>{e.name}</span>
    : <span title="not linked to a SofaScore player">{e.name}</span>;
  return (
    <span className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {name}{e.captain ? <strong> (c)</strong> : null}<PtsPill pts={e.points} />
    </span>
  );
}

export default function MyTeamTab({ data, openPlayer }) {
  const gws = myTeamGameweeks(data);
  const [picked, setPicked] = useState(null);
  const [cumulative, setCumulative] = useState(false);
  if (!gws.length) {
    return <p className="dim">No team captured yet — run the Fantasy sync on the ⚙ Settings tab.</p>;
  }
  const gw = picked != null && gws.includes(picked) ? picked : gws[gws.length - 1];
  const t = myTeamGameweek(data, gw);
  const series = [{
    key: "me", label: "My team", color: "#0e7a3c",
    points: myTeamSeries(data).map((x) => ({ round: x.gw, value: x.total })),
  }];
  return (
    <div>
      <div className="card row">
        <label>Gameweek{" "}
          <select value={gw} onChange={(e) => setPicked(Number(e.target.value))}>
            {gws.map((g) => <option key={g} value={g}>GW {g}</option>)}
          </select>
        </label>
        <strong style={{ marginLeft: "auto" }}>{t.total ?? "—"} pts</strong>
      </div>
      <div className="card">
        {t.lines.map((l, i) => (
          <div key={i} className="row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <span className="dim" style={{ width: "3rem" }}>{l.label}</span>
            {l.players.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} />)}
          </div>
        ))}
        <div className="row" style={{ flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span className="dim" style={{ width: "3rem" }}>Bench</span>
          {t.bench.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} />)}
        </div>
      </div>
      <GameweekChart series={series} cumulative={cumulative} onToggleCumulative={() => setCumulative(!cumulative)} />
    </div>
  );
}
```

- [ ] **Step 5: Register the tab in `src/App.jsx`**

Add `import MyTeamTab from "./components/MyTeamTab.jsx";` with the other tab imports, and insert into `TABS` after the Players entry:

```js
  ["myteam", "My Team", MyTeamTab],
```

- [ ] **Step 6: Run tests and build**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/MyTeamTab.jsx src/components/GameweekChart.jsx src/App.jsx test/myTeamTab.test.jsx
git commit -m "feat: My Team tab — gameweek picker, XI rows, captain, bench, season chart"
```

---

### Task 9: Release (controller does this, not a subagent)

- [ ] Full suite and build: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
- [ ] `npm version 0.30.0 --no-git-tag-version && npm install --package-lock-only`
- [ ] Commit `chore: v0.30.0`, push to `main`, watch the Pages deploy succeed.
- [ ] Manual check after the user's first real sync: season totals equal site totals except listed `no-appearance` cases; GW35 on My Team shows 83 with Lonergan (c) 16.
