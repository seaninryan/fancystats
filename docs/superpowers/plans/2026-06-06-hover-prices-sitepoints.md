# Hover + Prices/Site-Points Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Row hover on all tables; parse the site's two-column paste (price + total points); store sitePoints and flag Players-tab discrepancies. Spec: `docs/superpowers/specs/2026-06-06-hover-prices-sitepoints-design.md`.

## ⚠️ Environment

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

---

### Task 1: Parser — two-column format

**Files:**
- Modify: `src/lib/pasteImport.js`
- Modify: `test/pasteImport.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/pasteImport.test.js` (check its existing imports include `parsePaste` and `matchPlayers` — they do):

```js
describe("two-column site format (price + total points)", () => {
  it("attaches furniture-line numbers to the name above (tabs)", () => {
    expect(parsePaste("Arlo Doherty\nClub Picture\t4.0\t25\nBrian Maher\nClub Picture\t5.9\t5")).toEqual([
      { name: "Arlo Doherty", value: 25, price: 4 },
      { name: "Brian Maher", value: 5, price: 5.9 },
    ]);
  });
  it("multi-space separators work too", () => {
    expect(parsePaste("Conor Kearns\nClub Picture    4.8    25")).toEqual([
      { name: "Conor Kearns", value: 25, price: 4.8 },
    ]);
  });
  it("a leading integer rank is never taken as a price", () => {
    expect(parsePaste("1\tJohn Smith\t10")).toEqual([{ name: "John Smith", value: 10 }]);
  });
  it("vertical decimal variant: price line then points line", () => {
    expect(parsePaste("Wessel Speel\n5.5\n96")).toEqual([
      { name: "Wessel Speel", value: 96, price: 5.5 },
    ]);
  });
  it("matchPlayers carries the price through", () => {
    const players = { 7: { name: "Arlo Doherty" } };
    const { matched } = matchPlayers([{ name: "Arlo Doherty", value: 25, price: 4 }], players);
    expect(matched).toEqual([{ playerId: "7", name: "Arlo Doherty", value: 25, price: 4 }]);
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/pasteImport.test.js`** — new tests FAIL (furniture line clobbers the pending name; no price field).

- [ ] **Step 3: Implement** — in `src/lib/pasteImport.js`:

**(a)** Replace the whole `parsePaste` function (keep its comment block, extended) with:

```js
// -> [{ name, value, price? }]
// Handles: "Name\t10", "Name\tTeam\t10", "1\tName\t10", vertical copies
// ("Name" / "10" on separate lines, possibly with a rank column between), and
// the two-column site format ("Name" then "Club Picture\t4.0\t25") where the
// decimal first number is the price and the last number the site's total.
// Values are NOT range-validated here: the same parser serves price pastes and
// position pastes whose statistic column varies; the preview UI shows values.
export function parsePaste(text) {
  const rows = [];
  let pendingName = null;
  let pendingNums = [];
  const rowFrom = (name, nums) => {
    const row = { name, value: parseFloat(nums[nums.length - 1]) };
    // price column: only a decimal-formatted leading number (a rank never is)
    if (nums.length >= 2 && /^\d+\.\d+$/.test(nums[0])) row.price = parseFloat(nums[0]);
    return row;
  };
  const commit = () => {
    if (pendingName && pendingNums.length) rows.push(rowFrom(pendingName, pendingNums));
    pendingName = null;
    pendingNums = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { commit(); continue; }
    const fields = line.includes("\t") ? line.split(/\t+/) : line.split(/ {2,}/);
    if (fields.length >= 2) {
      const nameField = fields.find((f) => NAME_RE.test(f) && !isStopword(f));
      const nums = fields.map((f) => f.trim()).filter((f) => NUM_RE.test(f));
      if (nameField && nums.length) {
        commit();
        rows.push(rowFrom(nameField.trim(), nums));
        continue;
      }
      // furniture row ("Club Picture  4.0  25"): all word fields are
      // stopwords — its numbers belong to the pending name above
      if (!nameField && nums.length && pendingName) {
        pendingNums.push(...nums);
        commit();
        continue;
      }
    }
    if (NUM_RE.test(line)) {
      // numbers accumulate; rowFrom takes the last as the value, so a rank
      // line can't pose as the value (same effect as the old last-wins rule)
      if (pendingName) pendingNums.push(line);
    } else if (NAME_RE.test(line) && !isStopword(line)) {
      commit();
      pendingName = line;
    }
  }
  commit();
  return rows;
}
```

**(b)** In `matchPlayers`, change `matched.push({ playerId: id, name: row.name, value: row.value });` to:

```js
if (id) matched.push({ playerId: id, ...row });
```

- [ ] **Step 4: Run `npx vitest run test/pasteImport.test.js`** — ALL pass (17 existing + 5 new = 22). The existing 17 prove back-compat; if any fails, report BLOCKED — do not adjust existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pasteImport.js test/pasteImport.test.js
git commit -m "feat: parse two-column site paste (price + total points)"
```

---

### Task 2: Store — sitePoints + enriched applies

**Files:**
- Modify: `src/lib/store.js`
- Modify: `test/store.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/store.test.js` (all names used are already imported):

```js
describe("applyPasteResults two-column rows", () => {
  it("price paste sets price and sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "price", NOW);
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
  it("old single-number price paste still works and stores no sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 10.5 }], "price", NOW);
    expect(d.players["10"].price).toBe(10.5);
    expect(d.players["10"].sitePoints ?? null).toBeNull();
  });
  it("position paste with a price enriches position, price and sitePoints", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "GK", NOW);
    expect(d.players["10"].gamePosition).toBe("GK");
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
  it("manual position survives an enriched position paste; price still applies", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    d = applyPasteResults(d, [{ playerId: 10, name: "A Keena", value: 25, price: 4.0 }], "GK", NOW);
    expect(d.players["10"].gamePosition).toBe("FWD");
    expect(d.players["10"].price).toBe(4.0);
    expect(d.players["10"].sitePoints).toBe(25);
  });
});
```

- [ ] **Step 2: Run `npx vitest run test/store.test.js`** — new tests FAIL (sitePoints undefined / position-paste price ignored).

- [ ] **Step 3: Implement** — in `src/lib/store.js`:

**(a)** In `defaultPlayer`, after `price: null, priceUpdatedAt: null,` add:

```js
    sitePoints: null,
```

**(b)** Replace the body of `applyPasteResults` (keep the `// kind:` comment above it) with:

```js
export function applyPasteResults(data, matched, kind, now) {
  const next = structuredClone(data);
  for (const m of matched) {
    const p = next.players[m.playerId];
    if (!p) continue;
    if (kind === "price") {
      p.price = m.price ?? m.value; // old pastes carry the price as the only number
      p.priceUpdatedAt = now;
    } else if (p.gamePositionSource !== "manual") {
      p.gamePosition = kind;
      p.gamePositionSource = "paste";
    }
    // two-column site rows (price + total) enrich any paste kind
    if (m.price != null) {
      p.price = m.price;
      p.priceUpdatedAt = now;
      p.sitePoints = m.value;
    }
    if (m.alias) p.pasteAlias = m.alias;
  }
  return next;
}
```

- [ ] **Step 4: Run `npx vitest run test/store.test.js`** — ALL pass (77 = 73 + 4). Existing applyPasteResults tests prove back-compat. Then full suite: 186 (177 + 5 + 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: sitePoints field; pastes enrich price/sitePoints"
```

---

### Task 3: UI — hover CSS, triangle, Players tooltip, Settings preview

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/PlayersTab.jsx`
- Modify: `src/components/SettingsTab.jsx`

- [ ] **Step 1: CSS** — append to `src/styles.css`:

```css
/* subtle row emphasis on hover */
tbody tr:hover td { background: #eaf0f4; }
tbody tr.selected:hover td { background: #ddeee5; }
tbody tr:hover td.err-cell { background: #fbdcd7; }
.sticky-col tbody tr:hover td:first-child { background: #eaf0f4; }
.sticky-col tbody tr.selected:hover td:first-child { background: #ddeee5; }
.freeze-stats tbody tr:hover td:nth-child(-n+6) { background: #eaf0f4; }

/* site-points cross-check marker (Players Pts cell) */
.pts-diff { position: relative; }
.pts-diff::after { content: ""; position: absolute; top: 0; right: 0;
  border-top: 6px solid var(--warn); border-left: 6px solid transparent; }
```

- [ ] **Step 2: PlayersTab rows memo** — the row builder currently ends with `...playerTotals(data, id, { apps, eventIds: windows ? windows.get(p.teamId) || new Set() : undefined }),`. Restructure that return to compute season totals once:

Replace:

```js
    return {
      id, name: playerName(p), teamId: p.teamId, team,
```

with:

```js
    const t = playerTotals(data, id, { apps, eventIds: windows ? windows.get(p.teamId) || new Set() : undefined });
    const seasonPts = windows ? playerTotals(data, id, { apps }).points : t.points;
    return {
      id, name: playerName(p), teamId: p.teamId, team,
```

then replace the spread line

```js
      ...playerTotals(data, id, { apps, eventIds: windows ? windows.get(p.teamId) || new Set() : undefined }),
```

with:

```js
      sitePoints: p.sitePoints ?? null,
      seasonPts,
      // cross-check is season-vs-site even when a window narrows the Pts column
      siteDelta: p.sitePoints != null && seasonPts != null ? seasonPts - p.sitePoints : null,
      ...t,
    };
```

(keep the `climb:` line where it is).

- [ ] **Step 3: PlayersTab Pts cell** — replace:

```jsx
<td className={r.err ? "err-cell" : ""} title={r.err ? "No fantasy data — set a position or add their fantasy alias in the player view" : ""}>{r.err ? "❗" : r.points ?? "—"}</td>
```

with:

```jsx
<td className={`${r.err ? "err-cell" : ""}${r.siteDelta ? " pts-diff" : ""}`}
  title={r.err ? "No fantasy data — set a position or add their fantasy alias in the player view"
    : r.siteDelta ? `${r.siteDelta > 0 ? "+" : ""}${r.siteDelta} vs official site (ours ${r.seasonPts} · site ${r.sitePoints})` : ""}>
  {r.err ? "❗" : r.points ?? "—"}</td>
```

- [ ] **Step 4: SettingsTab** — two small edits:

(a) unmatched preview shows the price. Replace:

```jsx
<span style={{ flex: 1 }}>“{u.name}” ({u.value})</span>
```

with:

```jsx
<span style={{ flex: 1 }}>“{u.name}” ({u.value}{u.price != null ? ` · €${u.price}` : ""})</span>
```

(b) manually-linked rows must keep their price. Replace:

```js
.map(({ u, pid }) => ({ playerId: pid, name: u.name, value: u.value, alias: u.name }));
```

with:

```js
.map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
```

- [ ] **Step 5: Verify** — `npx vitest run && npm run build`: 186 tests, build OK.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/components/PlayersTab.jsx src/components/SettingsTab.jsx
git commit -m "feat: row hover emphasis; site-points cross-check triangle on Pts"
```

### Task 4: Final verification

- [ ] Full suite + build; manual after deploy: hover rows on all tabs (selected rows stay green-ish, ❗ stays red, frozen Teams cells tint); paste the GK page with kind=Goalkeepers → positions+prices+sitePoints land; Players Pts cells show amber corner triangles with sensible tooltips; € column now real prices.
