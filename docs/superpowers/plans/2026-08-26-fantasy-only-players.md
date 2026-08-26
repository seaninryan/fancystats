# Fantasy-only players Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Fantasy LOI import create records for registered players SofaScore has never seen, so a player who has not played (e.g. Danny Mandroiu) is visible, priced and trackable — and merges into the real record the moment he debuts.

**Architecture:** A "ghost" is an ordinary entry in `data.players` carrying `fantasyOnly: true` and a deterministic non-numeric id (`fx-<slug>-<teamId>`). It is created only from an unmatched fantasy capture row the user opted in for (pre-selected when the row has 0 site points). `reconcileFantasyOnly(data)` runs at the end of `applyDecoded`, promoting a ghost into the real SofaScore record — carrying user-owned fields and rekeying absences — as soon as exactly one real team-mate matches by name.

**Tech Stack:** React 18, Vite 5, Vitest 2 (node environment, no jsdom). Pure logic in `src/lib/`, thin components in `src/components/`.

**Spec:** `docs/superpowers/specs/2026-08-26-fantasy-only-players-design.md`

**Environment — read this first.** The system Node is v14 and silently breaks Vite/Vitest. Prefix every npm/npx command in this plan with:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/pasteImport.js` | name normalization + matching helpers | Modify — export `surnameInitialKey` |
| `src/lib/store.js` | the data model + derivations | Modify — `fantasyOnlyId`, `addFantasyOnlyPlayers`, `reconcileFantasyOnly`, `playerClimb` fix |
| `src/lib/consoleImport.js` | SofaScore batch fold | Modify — reconcile at the end of `applyDecoded` |
| `src/components/UnmatchedLinks.jsx` | per-row link picker | Modify — "add as new player" option |
| `src/components/FantasyImport.jsx` | fantasy capture card | Modify — default selection, apply path |
| `src/components/PlayersTab.jsx` | the players table | Modify — ghost row marker |
| `src/styles.css` | all styling | Modify — `.ghost-row` |
| `test/store.test.js` | store unit tests | Modify — new describes |
| `test/consoleImport.test.js` | import fold tests | Modify — reconcile-on-import test |
| `test/fantasyImport.test.jsx` | SSR smoke tests | Modify — "add as new" option |
| `test/playersTab.test.jsx` | SSR smoke test | Create — ghost row renders |

---

### Task 1: Export `surnameInitialKey` and add the ghost id scheme

`reconcileFantasyOnly` needs the surname+initial key so that "D. Mandroiu" and "Danny
Mandroiu" reconcile. That helper already exists but is module-private. The id scheme
belongs to the data model, so it lives in `store.js`, which gains an import from
`pasteImport.js` (no cycle — `pasteImport.js` imports nothing).

**Files:**
- Modify: `src/lib/pasteImport.js:98`
- Modify: `src/lib/store.js:3` (imports) and end of file
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.js`:

```js
describe("fantasyOnlyId", () => {
  it("is deterministic, colon-free and non-numeric", () => {
    const id = fantasyOnlyId("Danny Mandroiu", 2334);
    expect(id).toBe("fx-danny-mandroiu-2334");
    expect(id).toBe(fantasyOnlyId("Danny Mandroiu", "2334"));
    expect(id).not.toContain(":");
    expect(Number.isNaN(Number(id))).toBe(true);
  });
  it("absorbs punctuation and case the way name matching does", () => {
    expect(fantasyOnlyId("Seán O'Connor", 1)).toBe(fantasyOnlyId("Sean OConnor", 1));
  });
  it("refuses a row with no club or no usable name", () => {
    expect(fantasyOnlyId("Danny Mandroiu", null)).toBe(null);
    expect(fantasyOnlyId("   ", 1)).toBe(null);
  });
});
```

Add `fantasyOnlyId` to the existing import block at the top of `test/store.test.js`.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "fantasyOnlyId"
```

Expected: FAIL — `fantasyOnlyId is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/pasteImport.js`, change the declaration on line 98 from:

```js
function surnameInitialKey(name) {
```

to:

```js
export function surnameInitialKey(name) {
```

In `src/lib/store.js`, add to the imports at the top:

```js
import { normalizeName, surnameInitialKey } from "./pasteImport.js";
```

Add at the end of `src/lib/store.js`:

```js
// ---- fantasy-only players ----
// Registered players SofaScore has never seen (never played a minute, so they
// appear in no lineups payload). Only the fantasy capture knows they exist.

// Deterministic id: stable across re-imports so user-owned fields stick;
// colon-free because absence keys are `${eventId}:${playerId}` and playerOutNow
// splits on ":"; non-numeric so Number(id) is NaN and appearance lookups find
// nothing. No club -> no id: without a teamId we could never reconcile on debut.
export function fantasyOnlyId(name, teamId) {
  if (teamId == null) return null;
  const slug = normalizeName(name || "").replace(/\s+/g, "-");
  return slug ? `fx-${slug}-${teamId}` : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js test/pasteImport.test.js
```

Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js src/lib/pasteImport.js test/store.test.js
git commit -m "feat: deterministic id scheme for fantasy-only players"
```

---

### Task 2: `addFantasyOnlyPlayers` store mutator

Creates ghost records from capture rows. Re-running with the same row refreshes the
captured fields (price, site points, non-manual position) and leaves user-owned fields
alone — the same import-owned / user-owned split every other mutator honours.

**Files:**
- Modify: `src/lib/store.js` (end of file, after `fantasyOnlyId`)
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.js`:

```js
const GHOST_ROW = { name: "Danny Mandroiu", teamId: 1, gamePosition: "MID", price: 6.5, sitePoints: 0 };

describe("addFantasyOnlyPlayers", () => {
  it("creates a flagged record with the captured fields and default user fields", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    const p = d.players["fx-danny-mandroiu-1"];
    expect(p).toMatchObject({
      name: "Danny Mandroiu", teamId: 1, fantasyOnly: true,
      gamePosition: "MID", gamePositionSource: "fantasy",
      price: 6.5, priceUpdatedAt: NOW, sitePoints: 0,
      starred: false, inSquad: false, customName: null,
    });
  });
  it("skips a row whose club never resolved", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [{ ...GHOST_ROW, teamId: null }], NOW);
    expect(Object.keys(d.players).filter((k) => k.startsWith("fx-"))).toEqual([]);
  });
  it("refreshes captured fields on re-import without touching user-owned ones", () => {
    let d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "starred", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "gamePosition", "FWD"); // manual
    d = addFantasyOnlyPlayers(d, [{ ...GHOST_ROW, price: 6.1, sitePoints: 3 }], NOW + 1);
    const p = d.players["fx-danny-mandroiu-1"];
    expect(p.price).toBe(6.1);
    expect(p.priceUpdatedAt).toBe(NOW + 1);
    expect(p.sitePoints).toBe(3);
    expect(p.starred).toBe(true);
    expect(p.gamePosition).toBe("FWD");          // manual position survives
    expect(p.gamePositionSource).toBe("manual");
    expect(Object.keys(d.players).filter((k) => k.startsWith("fx-"))).toHaveLength(1);
  });
  it("does not mutate the input", () => {
    const before = importedFixture();
    const snapshot = JSON.stringify(before);
    addFantasyOnlyPlayers(before, [GHOST_ROW], NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
```

Add `addFantasyOnlyPlayers` to the import block at the top of `test/store.test.js`.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "addFantasyOnlyPlayers"
```

Expected: FAIL — `addFantasyOnlyPlayers is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/store.js`:

```js
// rows: [{name, teamId, gamePosition, price, sitePoints}] — unmatched capture rows
// the user chose to materialize. Rows without a resolved club are skipped.
export function addFantasyOnlyPlayers(data, rows, now) {
  const next = structuredClone(data);
  for (const r of rows) {
    const id = fantasyOnlyId(r.name, r.teamId);
    if (!id) continue;
    const p = next.players[id] || (next.players[id] = {
      ...defaultPlayer({ name: r.name, teamId: Number(r.teamId) }),
      fantasyOnly: true,
    });
    if (r.price != null) { p.price = r.price; p.priceUpdatedAt = now; }
    if (r.sitePoints != null) p.sitePoints = r.sitePoints;
    if (r.gamePosition && p.gamePositionSource !== "manual") {
      p.gamePosition = r.gamePosition;
      p.gamePositionSource = "fantasy";
    }
  }
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: addFantasyOnlyPlayers creates records for never-played players"
```

---

### Task 3: `reconcileFantasyOnly` — promote a ghost on debut

**Files:**
- Modify: `src/lib/store.js` (end of file, after `addFantasyOnlyPlayers`)
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.js`:

```js
// A ghost on team 1, plus the real SofaScore record arriving later.
function withGhost(name = "Danny Mandroiu") {
  return addFantasyOnlyPlayers(importedFixture(), [{ ...GHOST_ROW, name }], NOW);
}
function debut(d, id, name) {
  return applyImport(d, {
    match: {
      eventId: 101, round: 2, kickoff: 1765000000000, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0,
      goalTimes: { home: [], away: [] }, partial: false,
    },
    teams: [],
    players: [{ id, name, teamId: 1 }],
    appearances: [{ eventId: 101, playerId: id, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "M", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
  }, NOW);
}

describe("reconcileFantasyOnly", () => {
  it("merges on an exact name match and deletes the ghost", () => {
    const d = reconcileFantasyOnly(debut(withGhost(), 99, "Danny Mandroiu"));
    expect(d.players["fx-danny-mandroiu-1"]).toBeUndefined();
    expect(d.players["99"].name).toBe("Danny Mandroiu");
  });
  it("merges on a surname+initial match (D. Mandroiu vs Danny Mandroiu)", () => {
    const d = reconcileFantasyOnly(debut(withGhost(), 99, "D. Mandroiu"));
    expect(d.players["fx-danny-mandroiu-1"]).toBeUndefined();
    expect(d.players["99"].price).toBe(6.5);
  });
  it("carries user-owned fields and fills only empty captured fields", () => {
    let d = withGhost();
    d = setPlayerField(d, "fx-danny-mandroiu-1", "starred", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "inSquad", true);
    d = setPlayerField(d, "fx-danny-mandroiu-1", "customName", "Mandroiu");
    d = markOut(d, "fx-danny-mandroiu-1", "hamstring", NOW);
    d = reconcileFantasyOnly(debut(d, 99, "Danny Mandroiu"));
    const p = d.players["99"];
    expect(p.starred).toBe(true);
    expect(p.inSquad).toBe(true);
    expect(p.customName).toBe("Mandroiu");
    expect(activeFlag(p, NOW).note).toBe("hamstring");
    expect(p.price).toBe(6.5);
    expect(p.sitePoints).toBe(0);
  });
  it("rekeys absences from the ghost id to the real id", () => {
    let d = setAbsence(withGhost(), 100, "fx-danny-mandroiu-1", "suspended", NOW);
    d = reconcileFantasyOnly(debut(d, 99, "Danny Mandroiu"));
    expect(getAbsence(d, 100, "fx-danny-mandroiu-1")).toBe(null);
    expect(getAbsence(d, 100, 99).note).toBe("suspended");
  });
  it("refuses to guess when two real team-mates match", () => {
    let d = debut(withGhost(), 99, "Danny Mandroiu");
    d = applyImport(d, {
      match: {
        eventId: 102, round: 3, kickoff: 1765100000000, status: "finished",
        homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: [],
      players: [{ id: 98, name: "D. Mandroiu", teamId: 1 }],
      appearances: [{ eventId: 102, playerId: 98, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "M", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
    }, NOW);
    expect(reconcileFantasyOnly(d).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
  it("leaves the ghost alone while nobody matches, and returns data unchanged", () => {
    const d = withGhost();
    expect(reconcileFantasyOnly(d)).toBe(d);
    const other = debut(withGhost(), 99, "Someone Else");
    expect(reconcileFantasyOnly(other).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
  it("does not match a same-named player at a different club", () => {
    const d = withGhost();
    const away = applyImport(d, {
      match: {
        eventId: 103, round: 4, kickoff: 1765200000000, status: "finished",
        homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: [],
      players: [{ id: 97, name: "Danny Mandroiu", teamId: 2 }],
      appearances: [{ eventId: 103, playerId: 97, teamId: 2, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "M", goals: 0, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
    }, NOW);
    expect(reconcileFantasyOnly(away).players["fx-danny-mandroiu-1"]).toBeDefined();
  });
});
```

Add `reconcileFantasyOnly` to the import block at the top of `test/store.test.js`.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "reconcileFantasyOnly"
```

Expected: FAIL — `reconcileFantasyOnly is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/store.js`:

```js
// Copy a ghost's user-owned fields onto the real record, move its absences over,
// then drop it. Captured fields only fill gaps — a fresher real value wins.
function mergeGhost(next, ghostId, realId) {
  const g = next.players[ghostId];
  const r = next.players[realId];
  if (g.customName) r.customName = g.customName;
  if (g.pasteAlias) r.pasteAlias = g.pasteAlias;
  if (g.realPosition) r.realPosition = g.realPosition;
  if (g.starred) r.starred = true;
  if (g.inSquad) r.inSquad = true;
  if (g.flags?.length) r.flags = [...(r.flags || []), ...g.flags];
  if (g.gamePositionSource === "manual") {
    r.gamePosition = g.gamePosition;
    r.gamePositionSource = "manual";
  }
  if (r.price == null && g.price != null) { r.price = g.price; r.priceUpdatedAt = g.priceUpdatedAt; }
  if (r.sitePoints == null && g.sitePoints != null) r.sitePoints = g.sitePoints;
  for (const [k, a] of Object.entries(next.absences || {})) {
    const i = k.indexOf(":");
    if (k.slice(i + 1) !== ghostId) continue;
    delete next.absences[k];
    next.absences[`${k.slice(0, i)}:${realId}`] = a;
  }
  delete next.players[ghostId];
}

// Promote ghosts whose real SofaScore record now exists: exactly one real team-mate
// matching by exact name or by surname+initial ("D. Mandroiu" and "Danny Mandroiu"
// share a key). Two candidates -> leave it; the capture row lands in the manual link
// list instead. Never guess. Returns `data` untouched when nothing merged.
export function reconcileFantasyOnly(data) {
  const entries = Object.entries(data.players);
  const ghosts = entries.filter(([, p]) => p.fantasyOnly);
  if (!ghosts.length) return data;
  const real = entries.filter(([, p]) => !p.fantasyOnly);
  let next = null;
  for (const [gid, g] of ghosts) {
    const norm = normalizeName(g.name);
    const key = surnameInitialKey(g.name);
    const cands = real.filter(([, p]) =>
      String(p.teamId) === String(g.teamId) &&
      (normalizeName(p.name) === norm || (key && surnameInitialKey(p.name) === key)));
    if (cands.length !== 1) continue;
    next = next || structuredClone(data);
    mergeGhost(next, gid, cands[0][0]);
  }
  return next || data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: reconcileFantasyOnly promotes a ghost when the real player debuts"
```

---

### Task 4: Reconcile at the end of `applyDecoded`

A SofaScore batch is the moment real player records first appear, so retiring the
ghost in the same update means a duplicate row is never visible.

**Files:**
- Modify: `src/lib/consoleImport.js:39-45`
- Test: `test/consoleImport.test.js`

- [ ] **Step 1: Write the failing test**

Append to the `decodeBlob + applyDecoded` describe in `test/consoleImport.test.js`:

```js
  it("retires a fantasy-only ghost when the imported match provides the real player", async () => {
    const decoded = await decodeBlob(blobFor555());
    const realId = decoded.results[0].players[0].id;
    const realName = decoded.results[0].players[0].name;
    const realTeam = decoded.results[0].players[0].teamId;
    const seeded = addFantasyOnlyPlayers(emptyData(), [
      { name: realName, teamId: realTeam, gamePosition: "MID", price: 7.2, sitePoints: 0 },
    ], 900);
    const ghostId = fantasyOnlyId(realName, realTeam);
    expect(seeded.players[ghostId]).toBeDefined();

    const data = applyDecoded(seeded, decoded, 1000);
    expect(data.players[ghostId]).toBeUndefined();
    expect(data.players[realId].price).toBe(7.2);
  });
```

Add to the imports at the top of `test/consoleImport.test.js`:

```js
import { emptyData, addFantasyOnlyPlayers, fantasyOnlyId } from "../src/lib/store.js";
```

(replacing the existing `import { emptyData } from "../src/lib/store.js";` line)

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/consoleImport.test.js -t "retires a fantasy-only ghost"
```

Expected: FAIL — the ghost is still defined after `applyDecoded`.

- [ ] **Step 3: Implement**

In `src/lib/consoleImport.js`, change the import on line 7 from:

```js
import { upsertMatchStubs, applyImport } from "./store.js";
```

to:

```js
import { upsertMatchStubs, applyImport, reconcileFantasyOnly } from "./store.js";
```

Then change `applyDecoded` (lines 39-45) from:

```js
export function applyDecoded(data, decoded, now) {
  let next = upsertMatchStubs(data, decoded.stubs, decoded.teams);
  next.meta = { ...next.meta, lastEventSync: now };
  for (const r of decoded.results) next = applyImport(next, r, now);
  return next;
}
```

to:

```js
export function applyDecoded(data, decoded, now) {
  let next = upsertMatchStubs(data, decoded.stubs, decoded.teams);
  next.meta = { ...next.meta, lastEventSync: now };
  for (const r of decoded.results) next = applyImport(next, r, now);
  // A batch is where real player records first appear, so a fantasy-only ghost is
  // retired in the same update that creates its replacement — never a duplicate row.
  return reconcileFantasyOnly(next);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/consoleImport.test.js
```

Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/consoleImport.js test/consoleImport.test.js
git commit -m "feat: retire fantasy-only ghosts as their real records arrive"
```

---

### Task 5: `playerClimb` returns null without appearances

A `±` of `−2.3` on a player who has never played reads as a decline. He simply is not
there — that is `null`, the same value the column already renders as `—`.

**Files:**
- Modify: `src/lib/store.js` (`playerClimb`)
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.js`:

```js
describe("playerClimb with no appearances", () => {
  it("is null rather than a negative for a player who has never played", () => {
    // TWO imported team matches, window of 1: the baseline set must be non-empty or
    // playerClimb short-circuits to null on its own and the test proves nothing.
    const d = addFantasyOnlyPlayers(debut(importedFixture(), 99, "Someone Else"), [GHOST_ROW], NOW);
    const windowIds = teamWindowEventIds(d, 1).get(1);
    expect(windowIds.size).toBe(1);
    expect(playerClimb(d, "fx-danny-mandroiu-1", { windowIds })).toBe(null);
  });
});
```

`debut` is the helper defined in Task 3; it adds a second imported match for team 1.

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "playerClimb with no appearances"
```

Expected: FAIL — `expected 0 to be null`. If it already passes, the fixture has only
one imported team match and the assertion is vacuous — fix the fixture, not the test.

- [ ] **Step 3: Implement**

In `src/lib/store.js`, change `playerClimb` from:

```js
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

to:

```js
export function playerClimb(data, playerId, { apps = null, windowIds } = {}) {
  const player = data.players[playerId];
  if (!player?.gamePosition || !windowIds?.size) return null;
  // Never played: a negative ± would read as a decline rather than an absence.
  const theirApps = apps ?? playerAppearances(data, playerId);
  if (!theirApps.length) return null;
  const prior = teamImportedMatches(data, player.teamId)
    .filter((m) => !windowIds.has(m.eventId));
  if (!prior.length) return null;
  const priorIds = new Set(prior.map((m) => m.eventId));
  const w = playerTotals(data, playerId, { apps: theirApps, eventIds: windowIds }).points ?? 0;
  const p = playerTotals(data, playerId, { apps: theirApps, eventIds: priorIds }).points ?? 0;
  return w / windowIds.size - p / priorIds.size;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js
```

Expected: PASS, including the pre-existing `playerClimb` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "fix: playerClimb is null for a player with no appearances"
```

---

### Task 6: Ghosts cannot move any derived stat

Regression guard for the invariant in the spec: `leagueTable`, `hotEventIds` and
`allMatchTeamPoints` all iterate appearances or imported matches, so a ghost — which
has neither — must be invisible to them.

**Files:**
- Test: `test/store.test.js`

- [ ] **Step 1: Write the test**

Append to `test/store.test.js`:

```js
describe("fantasy-only players are invisible to derived stats", () => {
  it("leaves leagueTable, hotEventIds and allMatchTeamPoints untouched", () => {
    const base = importedFixture();
    const withG = addFantasyOnlyPlayers(base, [GHOST_ROW], NOW);
    expect(leagueTable(withG)).toEqual(leagueTable(base));
    expect(allMatchTeamPoints(withG)).toEqual(allMatchTeamPoints(base));
    expect([...hotEventIds(withG, "fx-danny-mandroiu-1")]).toEqual([]);
    expect(isHot(withG, "fx-danny-mandroiu-1")).toBe(false);
  });
  it("reports zeroed totals and no appearances", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    expect(playerAppearances(d, "fx-danny-mandroiu-1")).toEqual([]);
    expect(playerTotals(d, "fx-danny-mandroiu-1")).toMatchObject({
      minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: 0,
    });
    expect(missingFantasyData(d.players["fx-danny-mandroiu-1"], [])).toBe(false);
    expect(mismatchInfo(d, "fx-danny-mandroiu-1")).toBe(null);
  });
  it("counts their site points in teamSitePoints, like the official table does", () => {
    const d = addFantasyOnlyPlayers(importedFixture(), [GHOST_ROW], NOW);
    expect(teamSitePoints(d).get(1).withData).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/store.test.js -t "invisible to derived stats"
```

Expected: PASS immediately — these assert existing behaviour holds. If any fail, the
ghost record is leaking into a derivation; fix the derivation, not the test.

- [ ] **Step 3: Commit**

```bash
git add test/store.test.js
git commit -m "test: fantasy-only players cannot move derived stats"
```

---

### Task 7: "Add as new player" option in `UnmatchedLinks`

**Files:**
- Modify: `src/components/UnmatchedLinks.jsx`
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to the `UnmatchedLinks SSR` describe in `test/fantasyImport.test.jsx`:

```js
  it("offers 'add as new player' when the row's club resolved", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "Danny Mandroiu", teamId: "1" }]}
        links={{}} onChange={() => {}} allowNew />);
    expect(html).toContain("add as new player");
  });
  it("hides the option for a row whose club never resolved", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "Danny Mandroiu", teamId: null }]}
        links={{}} onChange={() => {}} allowNew />);
    expect(html).not.toContain("add as new player");
  });
  it("does not offer it at all without allowNew (the paste card)", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "Danny Mandroiu", teamId: "1" }]}
        links={{}} onChange={() => {}} />);
    expect(html).not.toContain("add as new player");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx -t "add as new player"
```

Expected: FAIL — the string is absent.

- [ ] **Step 3: Implement**

In `src/components/UnmatchedLinks.jsx`, add the exported sentinel above the component:

```js
// Sentinel select value meaning "materialize this row as a fantasy-only player".
// Not a player id, and no real id can collide with it.
export const NEW_PLAYER = "__new__";
```

Change the component signature from:

```js
export default function UnmatchedLinks({ data, unmatched, links, onChange, columns = [] }) {
```

to:

```js
export default function UnmatchedLinks({ data, unmatched, links, onChange, columns = [], allowNew = false }) {
```

Inside the `.map`, add the option immediately after the `skip` option:

```jsx
            <select className="link-pick" value={links[i] || ""}
              onChange={(e) => onChange(i, e.target.value || undefined)}>
              <option value="">skip</option>
              {allowNew && u.teamId != null && (
                <option value={NEW_PLAYER}>➕ add as new player</option>
              )}
```

Also extend the `link-done` class so a row marked "add as new" reads as resolved — it
already keys off `links[i]` being truthy, so no change is needed there.

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx
```

Expected: PASS, including the pre-existing `UnmatchedLinks` and `FantasyImport` tests
(`allowNew` defaults to false, so the paste card is untouched).

- [ ] **Step 5: Commit**

```bash
git add src/components/UnmatchedLinks.jsx test/fantasyImport.test.jsx
git commit -m "feat: 'add as new player' option on unmatched fantasy rows"
```

---

### Task 8: Wire creation into the fantasy import card

Rows with 0 (or absent) site points and a resolved club are pre-selected for creation,
so the first run is one click on Apply. Rows that scored keep today's link-or-skip
default — "unmatched but scoring" means name drift on a player who *has* played, and
inventing a ghost there would duplicate a real record.

**Files:**
- Modify: `src/components/FantasyImport.jsx:14-19` (`buildPreview`), `:40-49` (`apply`), `:53` (`linkCount`), `:76-79` (Apply button), `:106-119` (`UnmatchedLinks` props)
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing test**

Append a new describe to `test/fantasyImport.test.jsx`:

```js
describe("FantasyImport default creation selection", () => {
  it("renders the card with the fantasy-only affordance available", () => {
    const html = renderToStaticMarkup(<FantasyImport data={dataWithPlayers()} update={() => {}} />);
    expect(html).toContain("Import from Fantasy LOI");
  });
});

describe("defaultLinks", () => {
  it("pre-selects creation for scoreless rows with a resolved club", () => {
    expect(defaultLinks([
      { name: "Danny Mandroiu", teamId: "1", sitePoints: 0 },
      { name: "No Club", teamId: null, sitePoints: 0 },
      { name: "Has Scored", teamId: "1", sitePoints: 42 },
      { name: "No Points Field", teamId: "1", sitePoints: null },
    ])).toEqual({ 0: NEW_PLAYER, 3: NEW_PLAYER });
  });
  it("is empty when every row scored", () => {
    expect(defaultLinks([{ name: "A", teamId: "1", sitePoints: 5 }])).toEqual({});
  });
});
```

Add to the imports at the top of `test/fantasyImport.test.jsx`:

```js
import UnmatchedLinks, { NEW_PLAYER } from "../src/components/UnmatchedLinks.jsx";
import FantasyImport, { defaultLinks } from "../src/components/FantasyImport.jsx";
```

(replacing the two existing default-import lines for those files)

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx -t "defaultLinks"
```

Expected: FAIL — `defaultLinks is not a function`.

- [ ] **Step 3: Implement**

In `src/components/FantasyImport.jsx`, change the imports at the top from:

```js
import { applyFantasyRows } from "../lib/store.js";
import UnmatchedLinks from "./UnmatchedLinks.jsx";
```

to:

```js
import { applyFantasyRows, addFantasyOnlyPlayers } from "../lib/store.js";
import UnmatchedLinks, { NEW_PLAYER } from "./UnmatchedLinks.jsx";
```

Add above the component:

```js
// Rows the site shows with no points have never played, so there is no SofaScore
// record to link them to: pre-select creation. A row that HAS scored is name drift
// on a player we already hold — creating a ghost there would duplicate a real record,
// so it keeps the link-or-skip default. A row with no club can't be created at all.
export function defaultLinks(unmatched) {
  const links = {};
  unmatched.forEach((u, i) => {
    if (u.teamId != null && !u.sitePoints) links[i] = NEW_PLAYER;
  });
  return links;
}
```

Change `buildPreview` from:

```js
  const buildPreview = (players, clubs, overrides) => {
    const clubMap = mapClubs(clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(players, clubMap), data.players);
    return { players, clubs, clubMap, matched, unmatched, links: {} };
  };
```

to:

```js
  const buildPreview = (players, clubs, overrides) => {
    const clubMap = mapClubs(clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(players, clubMap), data.players);
    return { players, clubs, clubMap, matched, unmatched, links: defaultLinks(unmatched) };
  };
```

Change `apply` from:

```js
  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const now = Date.now(); // updaters stay pure — same convention as the paste card
    update((d) => applyFantasyRows(d, [...preview.matched, ...linked], now));
    setPreview(null);
    setPaste("");
  };
```

to:

```js
  const apply = () => {
    const picks = preview.unmatched.map((u, i) => ({ u, pid: preview.links[i] }));
    const linked = picks
      .filter((x) => x.pid && x.pid !== NEW_PLAYER)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const created = picks.filter((x) => x.pid === NEW_PLAYER).map((x) => x.u);
    const now = Date.now(); // updaters stay pure — same convention as the paste card
    update((d) => {
      const next = applyFantasyRows(d, [...preview.matched, ...linked], now);
      return created.length ? addFantasyOnlyPlayers(next, created, now) : next;
    });
    setPreview(null);
    setPaste("");
  };
```

Change the `linkCount` line from:

```js
  const linkCount = preview ? Object.values(preview.links).filter(Boolean).length : 0;
```

to:

```js
  const picked = preview ? Object.values(preview.links).filter(Boolean) : [];
  const linkCount = picked.filter((v) => v !== NEW_PLAYER).length;
  const newCount = picked.filter((v) => v === NEW_PLAYER).length;
```

Change the Apply button from:

```jsx
          <button className="primary" onClick={apply}>
            Apply {preview.matched.length + linkCount} players
          </button>
```

to:

```jsx
          <button className="primary" onClick={apply}
            title={newCount ? `${newCount} player(s) the site lists but SofaScore has never seen will be added` : ""}>
            Apply {preview.matched.length + linkCount} players{newCount ? ` + ${newCount} new` : ""}
          </button>
```

Change the summary line from:

```jsx
          <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
```

to:

```jsx
          <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched{newCount ? ` · ${newCount} to add as new` : ""}</p>
```

Finally add `allowNew` to the `UnmatchedLinks` element:

```jsx
          <UnmatchedLinks
            data={data}
            unmatched={preview.unmatched}
            links={preview.links}
            allowNew
            onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx test/fantasyImport.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FantasyImport.jsx test/fantasyImport.test.jsx
git commit -m "feat: fantasy import creates records for never-played players"
```

---

### Task 9: Show ghosts in the Players tab

**Files:**
- Modify: `src/components/PlayersTab.jsx` (row build + `<tr>` render)
- Modify: `src/styles.css`
- Test: `test/playersTab.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `test/playersTab.test.jsx`:

```jsx
// test/playersTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData, addFantasyOnlyPlayers } from "../src/lib/store.js";
import PlayersTab from "../src/components/PlayersTab.jsx";
import PlayerDetail from "../src/components/PlayerDetail.jsx";

const dataWithGhost = () => addFantasyOnlyPlayers({
  ...emptyData(),
  teams: { 1: { name: "Shamrock Rovers", shortName: "SRO" } },
}, [{ name: "Danny Mandroiu", teamId: 1, gamePosition: "MID", price: 6.5, sitePoints: 0 }], 1000);

describe("PlayersTab SSR", () => {
  it("renders a never-played player as a marked ghost row", () => {
    const html = renderToStaticMarkup(
      <PlayersTab data={dataWithGhost()} update={() => {}} openPlayer={() => {}} />);
    expect(html).toContain("Danny Mandroiu");
    expect(html).toContain("ghost-row");
    expect(html).toContain("hasn&#x27;t played yet");
  });
  it("renders an ordinary empty table without ghost markup", () => {
    const html = renderToStaticMarkup(
      <PlayersTab data={emptyData()} update={() => {}} openPlayer={() => {}} />);
    expect(html).not.toContain("ghost-row");
  });
});

// The spec claims PlayerDetail needs no change because it already handles zero
// appearances and its absence filter is `k.endsWith(':' + playerId)`. That only holds
// for a colon-free string id — prove it rather than assume it.
describe("PlayerDetail with a fantasy-only player", () => {
  it("opens a never-played player without crashing", () => {
    const html = renderToStaticMarkup(
      <PlayerDetail data={dataWithGhost()} update={() => {}}
        playerId="fx-danny-mandroiu-1" onBack={() => {}} />);
    expect(html).toContain("Danny Mandroiu");
    expect(html).toContain("watch");
    expect(html).toContain("6.5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/playersTab.test.jsx
```

Expected: FAIL — `ghost-row` is absent from the markup.

- [ ] **Step 3: Implement**

In `src/components/PlayersTab.jsx`, inside the `rows` `useMemo` `.map`, add `ghost` to
the returned object — put it directly after the `err:` line:

```js
        err: missingFantasyData(p, apps),
        ghost: !!p.fantasyOnly,
```

Then change the `<tr>` from:

```jsx
              <tr key={r.id} onClick={() => toggleSelected(r.id)}
                className={selected.has(r.id) ? "selected" : ""} style={{ cursor: "pointer" }}>
```

to:

```jsx
              <tr key={r.id} onClick={() => toggleSelected(r.id)}
                className={`${selected.has(r.id) ? "selected" : ""}${r.ghost ? " ghost-row" : ""}`.trim()}
                style={{ cursor: "pointer" }}>
```

And in the name cell, add the marker immediately before the `r.hot` expression:

```jsx
                  {" "}{r.ghost ? <span title="hasn't played yet">💤 </span> : ""}{r.hot ? "🔥 " : ""}{r.starred ? "⭐ " : ""}
```

(the existing `{" "}{r.hot ? …` becomes the above — everything after `r.starred` is unchanged)

In `src/styles.css`, add next to the other row-state rules (after the `.cell-out` line):

```css
.ghost-row td { opacity: .55; }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/playersTab.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PlayersTab.jsx src/styles.css test/playersTab.test.jsx
git commit -m "feat: mark never-played players in the Players table"
```

---

### Task 10: Full verification, version bump, deploy

**Files:**
- Modify: `package.json` (version), `package-lock.json`

- [ ] **Step 1: Run the whole suite**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test
```

Expected: all suites PASS. Do not proceed with failures.

- [ ] **Step 2: Build (catches JSX errors the tests cannot)**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run build
```

Expected: `✓ built in …`, no errors.

- [ ] **Step 3: Bump the version and sync the lockfile**

The version renders in the app footer and is the user's cache tell. This is a feature
batch, so bump the minor: `0.20.0` → `0.21.0`.

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm version 0.21.0 --no-git-tag-version
npm install --package-lock-only
```

- [ ] **Step 4: Verify the bump landed in both files**

```bash
grep -m1 '"version"' package.json
grep -m2 '"version"' package-lock.json
```

Expected: `0.21.0` in `package.json` and in the lockfile's root package entry.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: fantasy-only players — see registered players who haven't played (v0.21.0)"
```

---

## Manual verification after deploy

Interaction coverage is manual in this repo (no jsdom). After the deploy reaches
Pages, check:

1. Settings → run the Fantasy LOI snippet, paste, **Parse**. The summary should read
   `N matched · M unmatched · K to add as new`, and the scoreless rows should already
   show *➕ add as new player* selected.
2. **Apply**. Players tab → search `mandroiu` → he appears as a dimmed 💤 row with his
   position and price, `—` for value, zeros across the stat columns.
3. Star him and add him to your squad; re-run the fantasy import and confirm both stick
   and his price refreshes.
4. When he eventually plays and you run the SofaScore import, confirm the 💤 row is gone
   and a single normal row carries the star, the squad marker and his stats.
