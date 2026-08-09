# Fantasy LOI Console-Snippet Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual fantasy-site copy/paste with a console snippet that captures every player's position, price and site points in one run — no dropdown toggling, and including the user's own squad.

**Architecture:** A generated snippet runs in a logged-in `fantasyloi.leagueofireland.ie` tab, replays the site's own `POST /Stats/PlayerStats` form 14 times (10 clubs × `Statistic=Value`, then 4 positions × `Statistic=Total Score`), parses the returned HTML in-page, and emits a structured JSON blob. The app validates that blob, maps fantasy clubs to SofaScore teams, matches names with a club constraint, and folds the result in through a new pure store mutator. All HTML parsing lives in the snippet because Vitest runs in a **node** environment with no jsdom.

**Tech Stack:** React 18, Vite, Vitest (node env, no jsdom), plain ES modules. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-09-fantasy-console-import-design.md` — read it before starting.

---

## Environment

The system Node is v14 and silently breaks Vite/Vitest. **Prefix every npm/npx command in this plan:**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/fantasyImport.js` | **Create.** Snippet generation, blob validation, club→team mapping. Pure; no DOM. |
| `src/lib/pasteImport.js` | **Modify.** `matchPlayers` honours an optional per-row `teamId`; `suggestLinks` takes an optional teamId to rank same-club players first. |
| `src/lib/store.js` | **Modify.** Add `fantasyClubMap` to `emptyData().meta`; add `applyFantasyRows` mutator. |
| `src/components/UnmatchedLinks.jsx` | **Create.** The unmatched-row linking list, extracted from `SettingsTab.jsx` so both import cards share it. |
| `src/components/FantasyImport.jsx` | **Create.** The new import card: copy snippet → paste → parse → preview → apply, plus club-mapping selects. |
| `src/components/SettingsTab.jsx` | **Modify.** Render `FantasyImport` above the legacy paste card; use `UnmatchedLinks` instead of the inline JSX. |
| `test/fantasyImport.test.js` | **Create.** Unit tests for the new lib. |
| `test/fantasyImport.test.jsx` | **Create.** SSR smoke test for the new components. |
| `test/pasteImport.test.js` | **Modify.** Team-constrained matching cases. |
| `test/store.test.js` | **Modify.** `applyFantasyRows` cases. |

The legacy paste card stays as a fallback — do not delete it.

---

### Task 1: `parseFantasyBlob` — validate the pasted capture

**Files:**
- Create: `src/lib/fantasyImport.js`
- Test: `test/fantasyImport.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/fantasyImport.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseFantasyBlob } from "../src/lib/fantasyImport.js";

const goodBlob = () => ({
  meta: { source: "fantasyloi", capturedAt: 1770000000000, clubs: [{ id: "14420", name: "Bohemians" }] },
  players: [
    { name: "Colm Whelan", clubId: "14420", position: "FWD", price: 8.3, sitePoints: 137 },
    { name: "Sam Todd", clubId: "14420", position: "DEF", price: 5.5, sitePoints: 61 },
  ],
});

describe("parseFantasyBlob", () => {
  it("accepts a JSON string and normalizes rows", () => {
    const { clubs, players } = parseFantasyBlob(JSON.stringify(goodBlob()));
    expect(clubs).toEqual([{ id: "14420", name: "Bohemians" }]);
    expect(players[0]).toEqual({
      name: "Colm Whelan", clubId: "14420", gamePosition: "FWD", price: 8.3, sitePoints: 137,
    });
  });
  it("accepts an already-parsed object", () => {
    expect(parseFantasyBlob(goodBlob()).players).toHaveLength(2);
  });
  it("coerces a numeric clubId to a string and nulls an unknown position", () => {
    const blob = goodBlob();
    blob.players = [{ name: "X Y", clubId: 14420, position: "Sweeper", price: null, sitePoints: 0 }];
    expect(parseFantasyBlob(blob).players[0]).toEqual({
      name: "X Y", clubId: "14420", gamePosition: null, price: null, sitePoints: 0,
    });
  });
  it("drops rows with no name", () => {
    const blob = goodBlob();
    blob.players.push({ name: "  ", price: 1 });
    expect(parseFantasyBlob(blob).players).toHaveLength(2);
  });
  it("rejects unparseable text", () => {
    expect(() => parseFantasyBlob("not json")).toThrow(/Couldn't parse/);
  });
  it("rejects a blob from somewhere else", () => {
    expect(() => parseFantasyBlob({ meta: { source: "sofascore" }, players: [{ name: "A" }] }))
      .toThrow(/not a Fantasy LOI capture/);
  });
  it("rejects an empty capture", () => {
    expect(() => parseFantasyBlob({ meta: { source: "fantasyloi" }, players: [] }))
      .toThrow(/No players/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.js
```

Expected: FAIL — `Failed to resolve import "../src/lib/fantasyImport.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/fantasyImport.js`:

```js
// src/lib/fantasyImport.js
// Import from the Fantasy LOI site (fantasyloi.leagueofireland.ie). It is a
// server-rendered ASP.NET Core MVC app: Player Stats is a form POST whose third
// table column IS the selected statistic, so price and score need separate
// requests. See docs/superpowers/specs/2026-08-09-fantasy-console-import-design.md.
import { normalizeName } from "./pasteImport.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

const numOrNull = (v) => (Number.isFinite(v) ? v : null);

// Pure: validate + normalize a pasted capture. Throws user-facing messages.
export function parseFantasyBlob(text) {
  let blob;
  try {
    blob = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("Couldn't parse — run the snippet again and copy all of its output.");
  }
  if (blob?.meta?.source !== "fantasyloi") throw new Error("That's not a Fantasy LOI capture.");
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      clubId: p.clubId != null ? String(p.clubId) : null,
      gamePosition: POSITIONS.includes(p.position) ? p.position : null,
      price: numOrNull(p.price),
      sitePoints: numOrNull(p.sitePoints),
    }));
  if (!players.length) throw new Error("No players in the capture — are you logged in on the fantasy site?");
  return { clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [], players };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/fantasyImport.test.js
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fantasyImport.js test/fantasyImport.test.js
git commit -m "feat: parseFantasyBlob — validate fantasy-site captures"
```

---

### Task 2: `mapClubs` + `withTeamIds` — fantasy club → SofaScore team

**Files:**
- Modify: `src/lib/fantasyImport.js`
- Test: `test/fantasyImport.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/fantasyImport.test.js`:

```js
import { mapClubs, withTeamIds } from "../src/lib/fantasyImport.js";

describe("mapClubs", () => {
  const teams = {
    1: { name: "Bohemians", shortName: "BOH" },
    2: { name: "St. Patrick's Athletic", shortName: "STP" },
    3: { name: "Shamrock Rovers", shortName: "SRO" },
  };
  const clubs = [
    { id: "14420", name: "Bohemians" },
    { id: "55386", name: "St Patricks Athletic" },
    { id: "99999", name: "Cork City" },
  ];
  it("auto-resolves across punctuation drift", () => {
    const m = mapClubs(clubs, teams);
    expect(m["14420"]).toBe("1");
    expect(m["55386"]).toBe("2"); // "St Patricks Athletic" vs "St. Patrick's Athletic"
  });
  it("leaves an unknown club unresolved rather than guessing", () => {
    expect(mapClubs(clubs, teams)["99999"]).toBe(null);
  });
  it("a stored override wins over auto-resolution", () => {
    expect(mapClubs(clubs, teams, { 14420: "3" })["14420"]).toBe("3");
  });
  it("handles missing clubs/teams without throwing", () => {
    expect(mapClubs(undefined, undefined)).toEqual({});
  });
});

describe("withTeamIds", () => {
  it("attaches the resolved teamId, null when unresolved", () => {
    const players = [
      { name: "A", clubId: "14420" },
      { name: "B", clubId: "99999" },
      { name: "C", clubId: null },
    ];
    const rows = withTeamIds(players, { 14420: "1", 99999: null });
    expect(rows.map((r) => r.teamId)).toEqual(["1", null, null]);
    expect(rows[0].name).toBe("A"); // other fields survive
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/fantasyImport.test.js
```

Expected: FAIL — `mapClubs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/fantasyImport.js`:

```js
// Pure: fantasy club id -> our SofaScore team id. Auto-resolves by normalized name,
// which absorbs the site's punctuation drift ("St Patricks Athletic" vs SofaScore's
// "St. Patrick's Athletic"). A stored user override always wins. Unknown -> null,
// never a guess: a wrong club would gate name matching to the wrong squad.
export function mapClubs(clubs, teams, overrides = {}) {
  const byName = new Map();
  for (const [id, t] of Object.entries(teams || {})) {
    if (t?.name) byName.set(normalizeName(t.name), id);
  }
  const out = {};
  for (const c of clubs || []) {
    const id = String(c.id);
    const override = (overrides || {})[id];
    out[id] = override ? String(override) : byName.get(normalizeName(c.name || "")) ?? null;
  }
  return out;
}

// Pure: stamp each capture row with the team it belongs to (null when unresolved,
// which makes matchPlayers fall back to name-only matching for that row).
export function withTeamIds(players, clubMap) {
  return (players || []).map((p) => ({ ...p, teamId: (p.clubId && clubMap?.[p.clubId]) || null }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/fantasyImport.test.js
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fantasyImport.js test/fantasyImport.test.js
git commit -m "feat: mapClubs/withTeamIds — bind fantasy clubs to SofaScore teams"
```

---

### Task 3: Team-constrained name matching

Extend the existing matcher rather than forking it (CLAUDE.md: single sources of truth). The constraint travels **on the row** as `row.teamId`, so callers that don't set it (the legacy paste path) behave exactly as before.

**Files:**
- Modify: `src/lib/pasteImport.js:90-118` (`matchPlayers`), `src/lib/pasteImport.js:122-138` (`suggestLinks`)
- Test: `test/pasteImport.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/pasteImport.test.js`:

```js
describe("matchPlayers with a per-row teamId", () => {
  const players = {
    21: { name: "John Murphy", teamId: 1, pasteAlias: null },
    22: { name: "John Murphy", teamId: 2, pasteAlias: null },
    23: { name: "Colm Whelan", teamId: 1, pasteAlias: null },
  };
  it("resolves same-named players using the row's club", () => {
    const { matched } = matchPlayers([{ name: "John Murphy", teamId: 1, price: 5 }], players);
    expect(matched[0].playerId).toBe("21");
  });
  it("teamId is compared loosely (string row id vs number player id)", () => {
    const { matched } = matchPlayers([{ name: "John Murphy", teamId: "2" }], players);
    expect(matched[0].playerId).toBe("22");
  });
  it("a name on the wrong club stays unmatched instead of matching by name", () => {
    const { matched, unmatched } = matchPlayers([{ name: "Colm Whelan", teamId: 2 }], players);
    expect(matched).toEqual([]);
    expect(unmatched[0].name).toBe("Colm Whelan");
  });
  it("no teamId on the row keeps the old name-only behaviour", () => {
    const { matched, unmatched } = matchPlayers([{ name: "John Murphy" }], players);
    expect(matched).toEqual([]);            // ambiguous, as before
    expect(unmatched[0].name).toBe("John Murphy");
  });
  it("surname+initial matching is club-constrained too", () => {
    const { matched } = matchPlayers([{ name: "J. Murphy", teamId: 2 }], players);
    expect(matched[0].playerId).toBe("22");
  });
});

describe("suggestLinks with a teamId", () => {
  const players = {
    31: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    32: { name: "Graham Burke", teamId: 2, pasteAlias: null },
  };
  it("ranks the same-club candidate first", () => {
    expect(suggestLinks("Graham Burke", players, 2)[0]).toBe("32");
  });
  it("without a teamId the order is unchanged", () => {
    expect(suggestLinks("Graham Burke", players)).toEqual(["31", "32"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/pasteImport.test.js
```

Expected: FAIL — "resolves same-named players using the row's club" gets `undefined` (both John Murphys are ambiguous today).

- [ ] **Step 3: Write minimal implementation**

In `src/lib/pasteImport.js`, replace the body of `matchPlayers`'s row loop. The full function becomes:

```js
// rows from parsePaste (or a fantasy capture); players: data.players ({id: {name, pasteAlias, ...}})
// A row may carry `teamId` (fantasy captures know the club): candidates are then
// restricted to that team, which resolves same-named players across clubs. Rows
// without `teamId` behave exactly as before.
// -> { matched: [{playerId, name, value}], unmatched: [{name, value}] }
export function matchPlayers(rows, players) {
  const byFull = new Map();
  const byAlias = new Map();
  const byInitial = new Map(); // key -> [playerId]; ambiguous keys stay unmatched
  for (const [id, p] of Object.entries(players)) {
    const norm = normalizeName(p.name);
    byFull.set(norm, [...(byFull.get(norm) || []), id]);
    if (p.customName) byFull.set(normalizeName(p.customName), [...(byFull.get(normalizeName(p.customName)) || []), id]);
    if (p.pasteAlias) byAlias.set(normalizeName(p.pasteAlias), id);
    const key = surnameInitialKey(p.name);
    if (key) byInitial.set(key, [...(byInitial.get(key) || []), id]);
  }
  // ids are object keys (strings) but teamId is a number on the record — compare loosely
  const onTeam = (id, teamId) => String(players[id]?.teamId) === String(teamId);
  const pick = (ids, row) => {
    const cands = row.teamId != null ? ids.filter((id) => onTeam(id, row.teamId)) : ids;
    return cands.length === 1 ? cands[0] : null;
  };
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const norm = normalizeName(row.name);
    // duplicate full names (two John Murphys) stay unmatched unless the club splits them
    let id = pick(byFull.get(norm) || [], row) || byAlias.get(norm);
    if (!id) {
      const key = surnameInitialKey(row.name);
      id = pick(key ? byInitial.get(key) || [] : [], row);
    }
    if (id) matched.push({ playerId: id, ...row });
    else unmatched.push(row);
  }
  return { matched, unmatched };
}
```

Then change `suggestLinks` to take an optional `teamId` and boost same-club candidates:

```js
// Candidate player ids for an unmatched row, best first. Shared words (surnames,
// nicknames) score highest; containment breaks ties; a known club floats its own
// players to the top.
export function suggestLinks(rowName, players, teamId = null) {
  const norm = normalizeName(rowName);
  const words = norm.split(" ").filter(Boolean);
  return Object.entries(players)
    .map(([id, p]) => {
      const pn = normalizeName(p.customName || p.name);
      const clubBonus = teamId != null && String(p.teamId) === String(teamId) ? 20 : 0;
      if (!pn) return { id, score: 0 };
      if (pn === norm) return { id, score: 100 + clubBonus };
      const pWords = pn.split(" ").filter(Boolean);
      let score = words.filter((w) => pWords.includes(w)).length * 10;
      if (score && (norm.includes(pn) || pn.includes(norm))) score += 5;
      return { id, score: score ? score + clubBonus : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}
```

- [ ] **Step 4: Run the whole suite to verify nothing regressed**

```bash
npx vitest run
```

Expected: PASS — all suites, including the pre-existing `matchPlayers` and `suggestLinks` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pasteImport.js test/pasteImport.test.js
git commit -m "feat: club-constrained name matching in matchPlayers/suggestLinks"
```

---

### Task 4: `applyFantasyRows` store mutator

**Files:**
- Modify: `src/lib/store.js:10` (`emptyData` meta), and append after `applyPasteResults` (`src/lib/store.js:195`)
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Add `applyFantasyRows` to the import list at the top of `test/store.test.js`, then append:

```js
describe("applyFantasyRows", () => {
  const row = (over) => ({ playerId: "10", name: "A Keena", clubId: "1", teamId: "1",
    gamePosition: "FWD", price: 8.3, sitePoints: 137, ...over });

  it("writes price, timestamp, site points and position", () => {
    const d = applyFantasyRows(importedFixture(), [row()], NOW);
    expect(d.players["10"]).toMatchObject({
      price: 8.3, priceUpdatedAt: NOW, sitePoints: 137,
      gamePosition: "FWD", gamePositionSource: "fantasy",
    });
  });
  it("never clobbers a manually set position", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    d = applyFantasyRows(d, [row()], NOW);
    expect(d.players["10"]).toMatchObject({ gamePosition: "MID", gamePositionSource: "manual" });
    expect(d.players["10"].price).toBe(8.3); // the rest of the row still applies
  });
  it("a null field leaves the stored value alone", () => {
    let d = applyFantasyRows(importedFixture(), [row()], NOW);
    d = applyFantasyRows(d, [row({ price: null, sitePoints: null, gamePosition: null })], NOW + 1);
    expect(d.players["10"]).toMatchObject({ price: 8.3, priceUpdatedAt: NOW, sitePoints: 137, gamePosition: "FWD" });
  });
  it("remembers a manual-link alias", () => {
    const d = applyFantasyRows(importedFixture(), [row({ alias: "A. Keena (FLOI)" })], NOW);
    expect(d.players["10"].pasteAlias).toBe("A. Keena (FLOI)");
  });
  it("ignores rows for unknown players and does not mutate the input", () => {
    const before = importedFixture();
    const snapshot = JSON.stringify(before);
    const d = applyFantasyRows(before, [row({ playerId: "999" })], NOW);
    expect(d.players["999"]).toBeUndefined();
    expect(JSON.stringify(before)).toBe(snapshot);
  });
  it("emptyData carries an empty fantasyClubMap", () => {
    expect(emptyData().meta.fantasyClubMap).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/store.test.js
```

Expected: FAIL — `applyFantasyRows is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/store.js`, change the `emptyData` meta line to include the new user-owned map:

```js
    meta: { tournamentId: 192, seasonId: 87682, lastEventSync: null, sofascoreToken: null, fantasyClubMap: {} },
```

Then append after `applyPasteResults`:

```js
// Fold a fantasy-site capture into the data object. Each row is
// {playerId, gamePosition, price, sitePoints, alias?}; a null field means "the
// capture didn't carry this", never "clear it". User-owned fields (a manually set
// gamePosition, stars, flags, inSquad) are never touched — same split as re-imports.
export function applyFantasyRows(data, rows, now) {
  const next = structuredClone(data);
  for (const r of rows) {
    const p = next.players[r.playerId];
    if (!p) continue;
    if (r.price != null) {
      p.price = r.price;
      p.priceUpdatedAt = now;
    }
    if (r.sitePoints != null) p.sitePoints = r.sitePoints;
    if (r.gamePosition && p.gamePositionSource !== "manual") {
      p.gamePosition = r.gamePosition;
      p.gamePositionSource = "fantasy";
    }
    if (r.alias) p.pasteAlias = r.alias;
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/store.test.js
```

Expected: PASS — including the 6 new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: applyFantasyRows store mutator + fantasyClubMap meta field"
```

---

### Task 5: `buildFantasySnippet` — the console snippet

The snippet is standalone JS that never imports app code. It reads the antiforgery token and club list out of the live page, so it takes no parameters.

**Files:**
- Modify: `src/lib/fantasyImport.js`
- Test: `test/fantasyImport.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/fantasyImport.test.js`:

```js
import { buildFantasySnippet } from "../src/lib/fantasyImport.js";

describe("buildFantasySnippet", () => {
  const snip = buildFantasySnippet();
  it("posts the site's own search form", () => {
    expect(snip).toContain("/Stats/PlayerStats");
    expect(snip).toContain("__RequestVerificationToken");
    expect(snip).toContain('method: "POST"');
    expect(snip).toContain('credentials: "include"');
  });
  it("runs both statistic passes and every position", () => {
    expect(snip).toContain('"Value"');
    expect(snip).toContain('"Total Score"');
    for (const p of ["Goalkeeper", "Defender", "Midfielder", "Forward"]) expect(snip).toContain(p);
  });
  it("guards the host and the logged-out case", () => {
    expect(snip).toContain("fantasyloi.leagueofireland.ie");
    expect(snip).toContain("logged in");
  });
  it("stashes the blob for copying, with a runnable fallback", () => {
    expect(snip).toContain("fancystatsFantasyBlob");
    expect(snip).toContain("navigator.clipboard.writeText");
    expect(snip).toContain("copy(fancystatsFantasyBlob)");
    expect(snip).toContain('"fantasyloi"'); // meta.source the app validates
  });
  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(snip)).not.toThrow();
  });
});
```

The last case is the important one: the snippet is a string, so nothing else would catch a typo in it.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/fantasyImport.test.js
```

Expected: FAIL — `buildFantasySnippet is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/fantasyImport.js`. Note the escaping: this is a template literal producing JS source, so regex backslashes are doubled (`\\d`) and no `${}` interpolation is used inside — the snippet builds strings by concatenation.

```js
// Returns the console snippet source. The user pastes it into a logged-in
// fantasyloi.leagueofireland.ie tab's DevTools console. It replays the site's own
// form POST 14 times: 10 clubs x Statistic=Value (price, club exact from the query,
// and a crest -> club map as a side effect), then 4 positions x Statistic=Total
// Score (points, position exact from the query, club via the crest map). The third
// table column IS the statistic, so price and score can't come from one request.
export function buildFantasySnippet() {
  return `// fancystats fantasy import — run on a logged-in fantasyloi.leagueofireland.ie tab.
(async () => {
  const HOST = "fantasyloi.leagueofireland.ie";
  const POS = [["Goalkeeper", "GK"], ["Defender", "DEF"], ["Midfielder", "MID"], ["Forward", "FWD"]];
  const say = (m, c) => console.log("%cfancystats: " + m, "color:" + c + ";font-weight:bold");
  if (!location.hostname.endsWith(HOST)) return say("run this on a " + HOST + " tab.", "red");
  const token = document.querySelector("input[name=__RequestVerificationToken]")?.value;
  const clubSel = document.querySelector("select#Club");
  if (!token || !clubSel) return say("couldn't find the search form — make sure you're logged in, open Stats > Player Stats, then re-run.", "red");
  const clubs = [...clubSel.options].filter((o) => o.value !== "All").map((o) => ({ id: o.value, name: o.text.trim() }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => { const m = String(s == null ? "" : s).match(/-?\\d+(?:\\.\\d+)?/); return m ? parseFloat(m[0]) : null; };
  const post = async (Statistic, Club, Position) => {
    const body = new URLSearchParams({ Statistic, Club, Position, __RequestVerificationToken: token });
    const r = await fetch("/Stats/PlayerStats", { method: "POST", body, credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status + " on " + Statistic + "/" + Club + "/" + Position);
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    if (!doc.querySelector("select#Club")) throw new Error("session expired — log in again, then re-run");
    return [...doc.querySelectorAll("table tbody tr")].map((tr) => {
      const img = tr.querySelector("img");
      return {
        name: (tr.cells[1] ? tr.cells[1].textContent : "").trim(),
        value: num(tr.cells[2] ? tr.cells[2].textContent : null),
        crest: img ? img.getAttribute("src") : "",
      };
    }).filter((x) => x.name);
  };
  try {
    const rows = new Map();          // "name|clubId" -> merged row
    const crestToClub = new Map();
    const key = (n, c) => n + "|" + c;
    for (const c of clubs) {                                   // pass A — price, club exact
      const list = await post("Value", c.id, "All");
      for (const x of list) {
        if (x.crest) crestToClub.set(x.crest, c.id);
        const k = key(x.name, c.id);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: c.id, price: x.value }));
      }
      say("club " + c.name + ": " + list.length, "gray");
      await sleep(300);
    }
    for (const pair of POS) {                                  // pass B — points, position exact
      const list = await post("Total Score", "All", pair[0]);
      for (const x of list) {
        const clubId = crestToClub.get(x.crest) || null;       // unknown crest -> null, never a guess
        const k = key(x.name, clubId);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: clubId, position: pair[1], sitePoints: x.value }));
      }
      say(pair[1] + ": " + list.length, "gray");
      await sleep(300);
    }
    const blob = { meta: { source: "fantasyloi", capturedAt: Date.now(), clubs: clubs }, players: [...rows.values()] };
    const json = JSON.stringify(blob);
    // copy() (the DevTools Command Line API) is out of scope inside an async IIFE
    // after an await, and navigator.clipboard rejects while focus is in DevTools —
    // so stash on window and offer the manual copy as the fallback.
    window.fancystatsFantasyBlob = json;
    try { await navigator.clipboard.writeText(json); } catch (err) { /* not focused — use the fallback */ }
    say("captured " + blob.players.length + " players. If your clipboard is empty, run  copy(fancystatsFantasyBlob)  then paste into the app.", "lime");
  } catch (e) {
    say(e.message, "red");
  }
})();`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/fantasyImport.test.js
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fantasyImport.js test/fantasyImport.test.js
git commit -m "feat: buildFantasySnippet — 14-POST capture of positions, prices and points"
```

---

### Task 6: Extract `UnmatchedLinks`

Pure refactor — the legacy paste card must behave identically afterwards.

**Files:**
- Create: `src/components/UnmatchedLinks.jsx`
- Modify: `src/components/SettingsTab.jsx:59-90`
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `test/fantasyImport.test.jsx`:

```jsx
// test/fantasyImport.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import UnmatchedLinks from "../src/components/UnmatchedLinks.jsx";

const dataWithPlayers = () => ({
  ...emptyData(),
  teams: { 1: { name: "Bohemians", shortName: "BOH" }, 2: { name: "Dundalk", shortName: "DUN" } },
  players: {
    10: { name: "Colm Whelan", teamId: 1 },
    11: { name: "Sam Todd", teamId: 1 },
    12: { name: "Colm Whelan", teamId: 2 },
  },
});

describe("UnmatchedLinks SSR", () => {
  it("renders a select per unmatched row with suggestions and all players", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan", teamId: "1" }]}
        links={{}} onChange={() => {}} />);
    expect(html).toContain("C. Whelan");
    expect(html).toContain("Suggested");
    expect(html).toContain("All players");
    expect(html).toContain("skip");
    expect(html).toContain("(BOH)");
  });
  it("renders the optional description", () => {
    const html = renderToStaticMarkup(
      <UnmatchedLinks data={dataWithPlayers()} unmatched={[{ name: "C. Whelan", price: 8.3 }]}
        links={{}} onChange={() => {}} describe={(u) => `€${u.price}`} />);
    expect(html).toContain("8.3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/fantasyImport.test.jsx
```

Expected: FAIL — `Failed to resolve import "../src/components/UnmatchedLinks.jsx"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/UnmatchedLinks.jsx`:

```jsx
// src/components/UnmatchedLinks.jsx
// Shared by both import cards: one row per unmatched capture/paste row, with a
// select for binding it to a SofaScore player. `describe` renders the optional
// parenthetical after the name; a row's `teamId` (fantasy captures) floats that
// club's players to the top of the suggestions.
import { suggestLinks } from "../lib/pasteImport.js";

export default function UnmatchedLinks({ data, unmatched, links, onChange, describe }) {
  const label = (p) => `${p.customName || p.name} (${data.teams[p.teamId]?.shortName})`;
  return (
    <>
      {unmatched.map((u, i) => {
        const sugg = suggestLinks(u.name, data.players, u.teamId ?? null);
        const all = Object.entries(data.players)
          .filter(([id]) => !sugg.includes(id))
          .sort((a, b) => (a[1].customName || a[1].name).localeCompare(b[1].customName || b[1].name));
        return (
          <div className="row" key={i}>
            <span style={{ flex: 1 }}>
              &ldquo;{u.name}&rdquo;{describe ? ` (${describe(u)})` : ""}
            </span>
            <select value={links[i] || ""} onChange={(e) => onChange(i, e.target.value || undefined)}>
              <option value="">skip</option>
              {sugg.length > 0 && (
                <optgroup label="Suggested">
                  {sugg.map((id) => <option key={id} value={id}>{label(data.players[id])}</option>)}
                </optgroup>
              )}
              <optgroup label="All players">
                {all.map(([id, p]) => <option key={id} value={id}>{label(p)}</option>)}
              </optgroup>
            </select>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Use it in `SettingsTab.jsx`**

Add the import next to the others at the top of `src/components/SettingsTab.jsx`:

```jsx
import UnmatchedLinks from "./UnmatchedLinks.jsx";
```

Drop `suggestLinks` from the `pasteImport.js` import on line 3 (it moved into the shared component):

```jsx
import { parsePaste, matchPlayers } from "../lib/pasteImport.js";
```

Replace the whole `{preview.unmatched.map((u, i) => (...))}` block (lines 62-88) with:

```jsx
            <UnmatchedLinks
              data={data}
              unmatched={preview.unmatched}
              links={preview.links}
              onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
              describe={(u) => `${u.value}${u.price != null ? ` · €${u.price}` : ""}`}
            />
```

- [ ] **Step 5: Run the full suite and a build**

```bash
npx vitest run && npm run build
```

Expected: all tests PASS and the build succeeds (the build is what catches JSX errors tests can't).

- [ ] **Step 6: Commit**

```bash
git add src/components/UnmatchedLinks.jsx src/components/SettingsTab.jsx test/fantasyImport.test.jsx
git commit -m "refactor: extract UnmatchedLinks so both import cards share it"
```

---

### Task 7: `FantasyImport` panel

**Files:**
- Create: `src/components/FantasyImport.jsx`
- Modify: `src/components/SettingsTab.jsx` (render it above the legacy paste card)
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `test/fantasyImport.test.jsx`:

```jsx
import FantasyImport from "../src/components/FantasyImport.jsx";

describe("FantasyImport SSR", () => {
  it("renders the snippet and the paste box", () => {
    const html = renderToStaticMarkup(<FantasyImport data={dataWithPlayers()} update={() => {}} />);
    expect(html).toContain("Import from Fantasy LOI");
    expect(html).toContain("/Stats/PlayerStats");
    expect(html).toContain("Copy snippet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/fantasyImport.test.jsx
```

Expected: FAIL — `Failed to resolve import "../src/components/FantasyImport.jsx"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/FantasyImport.jsx`:

```jsx
// src/components/FantasyImport.jsx
import { useState } from "react";
import { buildFantasySnippet, parseFantasyBlob, mapClubs, withTeamIds } from "../lib/fantasyImport.js";
import { matchPlayers } from "../lib/pasteImport.js";
import { applyFantasyRows } from "../lib/store.js";
import UnmatchedLinks from "./UnmatchedLinks.jsx";

const SNIPPET = buildFantasySnippet(); // no app state goes into it — build once

export default function FantasyImport({ data, update }) {
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState(null); // { players, clubs, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);

  const buildPreview = (players, clubs, overrides) => {
    const clubMap = mapClubs(clubs, data.teams, overrides);
    const { matched, unmatched } = matchPlayers(withTeamIds(players, clubMap), data.players);
    return { players, clubs, clubMap, matched, unmatched, links: {} };
  };

  const parse = () => {
    setError(null);
    try {
      const { clubs, players } = parseFantasyBlob(paste);
      setPreview(buildPreview(players, clubs, data.meta.fantasyClubMap));
    } catch (e) {
      setError(e.message);
      setPreview(null);
    }
  };

  // Binding a club re-runs matching immediately, so the unmatched list shrinks as
  // you map. The map itself is user-owned and persists in the save.
  const setClub = (clubId, teamId) => {
    const overrides = { ...(data.meta.fantasyClubMap || {}), [clubId]: teamId };
    update((d) => ({ ...d, meta: { ...d.meta, fantasyClubMap: overrides } }));
    if (preview) setPreview(buildPreview(preview.players, preview.clubs, overrides));
  };

  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    update((d) => applyFantasyRows(d, [...preview.matched, ...linked], Date.now()));
    setPreview(null);
    setPaste("");
  };

  const unresolved = preview ? preview.clubs.filter((c) => !preview.clubMap[String(c.id)]) : [];
  const linkCount = preview ? Object.values(preview.links).filter(Boolean).length : 0;

  return (
    <div className="card">
      <h3>Import from Fantasy LOI</h3>
      <p className="dim">
        Run this in a logged-in <code>fantasyloi.leagueofireland.ie</code> tab&rsquo;s DevTools console
        (type <code>allow pasting</code> if prompted), then paste the result below. It captures every
        player&rsquo;s position, price and site points in one go — no dropdowns to set, and your own
        squad is included.
      </p>
      <div className="row">
        <button onClick={() => navigator.clipboard?.writeText(SNIPPET)}>Copy snippet</button>
      </div>
      <textarea readOnly value={SNIPPET} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }} />
      <textarea placeholder="Paste the snippet output here" value={paste} rows={4}
        style={{ width: "100%", fontFamily: "monospace" }}
        onChange={(e) => { setPaste(e.target.value); setPreview(null); }} />
      <div className="row">
        <button onClick={parse} disabled={!paste.trim()}>Parse</button>
        {preview && (
          <button className="primary" onClick={apply}>
            Apply {preview.matched.length + linkCount} players
          </button>
        )}
      </div>
      {error && <div className="banner err">{error}</div>}
      {preview && (
        <div style={{ marginTop: 8 }}>
          <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
          {unresolved.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p className="dim">Unrecognised clubs — bind them once and it&rsquo;s remembered:</p>
              {unresolved.map((c) => (
                <div className="row" key={c.id}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <select value="" onChange={(e) => e.target.value && setClub(String(c.id), e.target.value)}>
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
            onChange={(i, pid) => setPreview({ ...preview, links: { ...preview.links, [i]: pid } })}
            describe={(u) => [u.gamePosition, u.price != null ? `€${u.price}` : null, u.sitePoints != null ? `${u.sitePoints} pts` : null].filter(Boolean).join(" · ")}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render it in `SettingsTab.jsx`**

Add the import at the top:

```jsx
import FantasyImport from "./FantasyImport.jsx";
```

Insert it as the first child of the outer `<div>` in the returned JSX, immediately before `<div className="card">` that holds `<h3>Import from the fantasy game</h3>`:

```jsx
      <FantasyImport data={data} update={update} />
```

Then retitle the legacy card so the two are distinguishable — change its `<h3>` and intro:

```jsx
        <h3>Import from the fantasy game (paste)</h3>
        <p className="dim">
          Fallback for when the snippet above can&rsquo;t run. Open the fantasy game&rsquo;s
          Stats → Player Stats page, set the dropdowns to match your selection below,
          select the whole results table, copy, and paste here.
        </p>
```

- [ ] **Step 5: Run the full suite and a build**

```bash
npx vitest run && npm run build
```

Expected: all tests PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/FantasyImport.jsx src/components/SettingsTab.jsx test/fantasyImport.test.jsx
git commit -m "feat: FantasyImport panel — snippet + paste-back with club mapping"
```

---

### Task 8: Version bump and deploy

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Bump the version**

Edit `package.json`, changing `"version": "0.17.1"` to `"version": "0.18.0"` (new feature). The version renders in the app footer and is the user's cache tell.

- [ ] **Step 2: Sync the lockfile**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm install --package-lock-only
```

- [ ] **Step 3: Final verification**

```bash
npx vitest run && npm run build
```

Expected: all suites PASS, build succeeds. Do not proceed if either fails.

- [ ] **Step 4: Commit and push**

```bash
git add package.json package-lock.json
git commit -m "chore: v0.18.0 — fantasy-site console-snippet import"
git push origin main
```

Push to `main` triggers GitHub Actions → Pages (https://seaninryan.github.io/fancystats/).

- [ ] **Step 5: Manual verification after deploy**

Interaction coverage is manual in this project (no jsdom). Confirm, in order:

1. Settings shows **Import from Fantasy LOI** above the legacy paste card.
2. **Copy snippet** → paste into a logged-in fantasy tab's console → it logs per-club and per-position counts, then `captured N players` in green. N should be roughly the league's full player count (~240).
3. If the clipboard was empty, `copy(fancystatsFantasyBlob)` works as the fallback.
4. Paste into the app → **Parse** → matched count is high, unmatched is a short list, no unrecognised clubs (all ten should auto-resolve).
5. **Apply** → spot-check in the Players tab: three prices match the site, positions look right, and a player from **your own squad** now has a price and position (this is the bug being fixed — previously they had to be typed in).
6. Confirm a player whose position you had set manually still shows your value.
7. Reload to confirm the save round-tripped through Drive.

---

## Notes for the implementer

- **Never mutate.** Every store mutator does `structuredClone` and returns a new object. Components call `update(updater)`; never call drive functions from a component.
- **Nothing derived is stored.** `applyFantasyRows` writes only raw captured fields. Totals, tables and charts stay computed at render time.
- **Object keys are strings, record fields are numbers.** Compare with `String()`/`Number()` — this is why `onTeam` in Task 3 stringifies both sides.
- **No jsdom.** Don't reach for `document` in lib code or write interaction tests; component tests are SSR smoke tests via `renderToStaticMarkup`.
- **The snippet is a string.** Its only automated safety net is the `new Function(snip)` syntax check in Task 5. Re-run that test after any edit to it.
