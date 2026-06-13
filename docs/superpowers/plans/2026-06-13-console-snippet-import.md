# Console-Snippet Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore SofaScore imports — blocked by a new anti-bot challenge — by generating a console snippet the user runs inside a sofascore.com tab, then replaying its clipboard output through the existing import pipeline.

**Architecture:** SofaScore now only serves data to requests made from inside a sofascore.com tab carrying an `x-requested-with` header. We can't satisfy that from a cross-origin app, so we move fetching into a snippet. The snippet records every payload into a path-keyed blob; the app replays the blob through the *existing* `fetchSeasonEvents` / `importMatch` / `applyImport` via an injected fetcher — the normalizer, scoring, and persistence are untouched. Stays 100% client-only.

**Tech Stack:** React (no framework router), Vite, Vitest (node env, no jsdom). Pure logic in `src/lib/`, thin components in `src/components/`. Spec: `docs/superpowers/specs/2026-06-13-console-snippet-import-design.md`.

> **Node trap:** prefix every npm/npx command with
> `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`

---

## File Structure

- **Create** `src/lib/consoleImport.js` — `blobToFetcher`, `decodeBlob`, `applyDecoded`, `buildImportSnippet`. All pure/injectable; no DOM, no `fetch`.
- **Create** `test/consoleImport.test.js` — unit + round-trip tests against `test/fixtures/`.
- **Create** `src/components/ConsoleImport.jsx` — the panel (token field, copy-snippet, paste box, import).
- **Create** `test/consoleImport.test.jsx` — SSR smoke render.
- **Modify** `src/lib/store.js` — add `sofascoreToken: null` default to `meta`.
- **Modify** `src/components/MatchesTab.jsx` — replace the now-dead live network controls with `<ConsoleImport>`; per-match buttons become status text.
- **Modify** `package.json` + `package-lock.json` — version bump.

---

### Task 1: `blobToFetcher` — replay adapter

**Files:**
- Create: `src/lib/consoleImport.js`
- Test: `test/consoleImport.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/consoleImport.test.js
import { describe, it, expect } from "vitest";
import { API } from "../src/lib/sofascore.js";
import { blobToFetcher } from "../src/lib/consoleImport.js";

describe("blobToFetcher", () => {
  it("serves a recorded payload by path suffix", async () => {
    const f = blobToFetcher({ payloads: { "/event/555": { event: { id: 555 } } } });
    const res = await f(API + "/event/555");
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ event: { id: 555 } });
  });
  it("returns 404 for a missing key", async () => {
    const f = blobToFetcher({ payloads: {} });
    const res = await f(API + "/event/999");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
  it("returns 404 for a recorded {__status:404} marker", async () => {
    const f = blobToFetcher({ payloads: { "/event/9/lineups": { __status: 404 } } });
    const res = await f(API + "/event/9/lineups");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: FAIL — `blobToFetcher` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/consoleImport.js
// Console-snippet import. SofaScore's anti-bot challenge blocks all direct API
// access (see docs/superpowers/specs/2026-06-13-console-snippet-import-design.md);
// data is only reachable from inside a sofascore.com tab. We generate a snippet the
// user runs there; it copies a path-keyed payload blob to the clipboard; we replay
// that blob through the existing sofascore.js pipeline via an injected fetcher.
import { API, fetchSeasonEvents, importMatch } from "./sofascore.js";
import { upsertMatchStubs, applyImport } from "./store.js";

// A fetcher with the same contract as real fetch / the test stubs, but serving
// responses from a pasted blob. Keys are path suffixes like "/event/555".
// A recorded {__status:404} or a missing key yields a 404 (matches importMatch's
// graceful-degrade and walkEvents' stop-on-404).
export function blobToFetcher(blob) {
  const payloads = blob?.payloads || {};
  return async (url) => {
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const hit = payloads[path];
    if (hit === undefined || (hit && hit.__status === 404)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => hit };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consoleImport.js test/consoleImport.test.js
git commit -m "feat: blobToFetcher — replay pasted SofaScore payloads through the import pipeline"
```

---

### Task 2: `decodeBlob` + `applyDecoded` — replay the whole import

**Files:**
- Modify: `src/lib/consoleImport.js`
- Test: `test/consoleImport.test.js`

The blob is decoded asynchronously (it drives `fetchSeasonEvents`/`importMatch`), then folded into the data object by a **pure** updater so it composes with the app's single `update(d => …)` mutation path. Split keeps the async work out of the updater.

- [ ] **Step 1: Write the failing test**

Add to `test/consoleImport.test.js`:

```js
import { decodeBlob, applyDecoded } from "../src/lib/consoleImport.js";
import { emptyData } from "../src/lib/store.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

const blobFor555 = () => ({
  meta: { tournamentId: 192, seasonId: 87682, builtFor: [555] },
  payloads: {
    "/unique-tournament/192/season/87682/events/last/0": {
      events: [{
        id: 555, startTimestamp: 100, status: { type: "finished" }, roundInfo: { round: 12 },
        homeTeam: { id: 1, name: "Shamrock Rovers", nameCode: "SRO" },
        awayTeam: { id: 2, name: "Bohemians", nameCode: "BOH" },
        homeScore: { current: 2 }, awayScore: { current: 1 },
      }],
      hasNextPage: false,
    },
    "/event/555": event,
    "/event/555/lineups": lineups,
    "/event/555/incidents": incidents,
  },
});

describe("decodeBlob + applyDecoded", () => {
  it("imports the captured match and refreshes the stub", async () => {
    const decoded = await decodeBlob(blobFor555());
    expect(decoded.failed).toEqual([]);
    expect(decoded.results).toHaveLength(1);
    const data = applyDecoded(emptyData(), decoded, 1000);
    expect(data.matches[555].importedAt).toBe(1000);
    expect(data.matches[555].homeTeamId).toBe(1);
    expect(Object.keys(data.appearances).some((k) => k.startsWith("555:"))).toBe(true);
    expect(data.meta.lastEventSync).toBe(1000);
  });
  it("records a per-match failure without aborting the rest", async () => {
    const blob = blobFor555();
    delete blob.payloads["/event/555"]; // event fetch -> 404 -> importMatch throws
    const decoded = await decodeBlob(blob);
    expect(decoded.results).toEqual([]);
    expect(decoded.failed).toHaveLength(1);
    expect(decoded.failed[0].id).toBe(555);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: FAIL — `decodeBlob` / `applyDecoded` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/consoleImport.js`:

```js
// Async: turn a pasted blob into the inputs the store mutators need. No dependency
// on the current data object, so the result can be applied inside a pure updater.
export async function decodeBlob(blob) {
  const fetcher = blobToFetcher(blob);
  const meta = { tournamentId: blob?.meta?.tournamentId, seasonId: blob?.meta?.seasonId };
  const { stubs, teams } = await fetchSeasonEvents(meta, fetcher);
  const results = [], failed = [];
  for (const id of blob?.meta?.builtFor || []) {
    try { results.push(await importMatch(id, fetcher)); }
    catch (e) { failed.push({ id, error: e.message }); }
  }
  return { stubs, teams, results, failed };
}

// Pure: fold decoded pieces into the data object via the existing store mutators.
export function applyDecoded(data, decoded, now) {
  let next = upsertMatchStubs(data, decoded.stubs, decoded.teams);
  next.meta = { ...next.meta, lastEventSync: now };
  for (const r of decoded.results) next = applyImport(next, r, now);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consoleImport.js test/consoleImport.test.js
git commit -m "feat: decodeBlob/applyDecoded — replay a pasted blob through the import pipeline"
```

---

### Task 3: `buildImportSnippet` — the generated console script

**Files:**
- Modify: `src/lib/consoleImport.js`
- Test: `test/consoleImport.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/consoleImport.test.js`:

```js
import { buildImportSnippet } from "../src/lib/consoleImport.js";

describe("buildImportSnippet", () => {
  const snip = buildImportSnippet({ tournamentId: 192, seasonId: 87682, token: "2421c3", knownEventIds: [555, 777] });
  it("uses the same-origin base and the x-requested-with token", () => {
    expect(snip).toContain("https://www.sofascore.com/api/v1");
    expect(snip).toContain('"x-requested-with"');
    expect(snip).toContain('"2421c3"');
  });
  it("bakes in the tournament/season and known ids to skip", () => {
    expect(snip).toContain("192");
    expect(snip).toContain("87682");
    expect(snip).toContain("[555,777]");
  });
  it("copies a blob and detects an expired token", () => {
    expect(snip).toContain("copy(");
    expect(snip).toContain("token expired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: FAIL — `buildImportSnippet` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/consoleImport.js`. The function returns a self-contained IIFE string; inside it, runtime template literals are escaped (`\``, `\${`) so they survive being embedded in this generator's own template literal.

```js
// Returns the console snippet source. The user pastes it into a sofascore.com tab's
// DevTools console; it walks the season, skips KNOWN ids, fetches event+lineups+
// incidents for the rest, and copies a path-keyed blob to the clipboard via copy().
export function buildImportSnippet({ tournamentId, seasonId, token, knownEventIds }) {
  const known = JSON.stringify(knownEventIds || []);
  return `// fancystats import — run on a https://www.sofascore.com tab (DevTools console).
(async () => {
  const BASE = "https://www.sofascore.com/api/v1";
  const TOKEN = ${JSON.stringify(token || "")};
  const T = ${Number(tournamentId)}, S = ${Number(seasonId)};
  const KNOWN = new Set(${known});
  const payloads = {};
  const get = async (path) => {
    const r = await fetch(BASE + path, { headers: { "x-requested-with": TOKEN }, credentials: "include" });
    if (r.status === 403) throw new Error("challenge");
    if (r.status === 404) { payloads[path] = { __status: 404 }; return null; }
    const body = await r.json();
    payloads[path] = body;
    return body;
  };
  const walk = async (dir) => {
    const out = [];
    for (let p = 0; p < 20; p++) {
      const body = await get(\`/unique-tournament/\${T}/season/\${S}/events/\${dir}/\${p}\`);
      if (!body) break;
      out.push(...(body.events || []));
      if (!body.hasNextPage) break;
    }
    return out;
  };
  try {
    const events = [...(await walk("last")), ...(await walk("next"))];
    const todo = events.filter((e) => e.status?.type === "finished" && !KNOWN.has(e.id));
    for (const e of todo) {
      await get(\`/event/\${e.id}\`);
      await get(\`/event/\${e.id}/lineups\`);
      await get(\`/event/\${e.id}/incidents\`);
    }
    const blob = { meta: { tournamentId: T, seasonId: S, builtFor: todo.map((e) => e.id) }, payloads };
    copy(JSON.stringify(blob));
    console.log(\`%cfancystats: captured \${todo.length} match(es) — paste into the app.\`, "color:lime;font-weight:bold");
  } catch (e) {
    if (e.message === "challenge")
      console.log("%cfancystats: token expired — copy a fresh x-requested-with from any Network request and update it in the app.", "color:red;font-weight:bold");
    else console.log("%cfancystats: " + e.message, "color:red");
  }
})();`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consoleImport.js test/consoleImport.test.js
git commit -m "feat: buildImportSnippet — generate the in-page SofaScore collector"
```

---

### Task 4: Token default in the data model

**Files:**
- Modify: `src/lib/store.js:10` (the `meta` object in `emptyData`)
- Test: `test/store.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/store.test.js` (inside the existing top-level `describe`, or a new one):

```js
import { emptyData } from "../src/lib/store.js";

describe("emptyData meta", () => {
  it("includes a null sofascoreToken slot", () => {
    expect(emptyData().meta.sofascoreToken).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run -t "sofascoreToken"`
Expected: FAIL — value is `undefined`, not `null`.

- [ ] **Step 3: Write minimal implementation**

Edit `src/lib/store.js:10`:

```js
    meta: { tournamentId: 192, seasonId: 87682, lastEventSync: null, sofascoreToken: null },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run -t "sofascoreToken"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: persist SofaScore x-requested-with token in the save meta"
```

---

### Task 5: `ConsoleImport` panel

**Files:**
- Create: `src/components/ConsoleImport.jsx`
- Test: `test/consoleImport.test.jsx`

Known ids exclude **partial** imports (`!m.partial`) so a no-lineups match is treated as missing and re-fetched on the next catch-up — this absorbs the old per-match "Retry". A "Re-fetch all" checkbox clears the known set, preserving the old "Re-import all" backfill.

- [ ] **Step 1: Write the failing SSR smoke test**

```jsx
// test/consoleImport.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyData } from "../src/lib/store.js";
import ConsoleImport from "../src/components/ConsoleImport.jsx";

describe("ConsoleImport SSR", () => {
  it("renders the panel with the snippet and token field", () => {
    const data = { ...emptyData(), meta: { ...emptyData().meta, sofascoreToken: "2421c3" } };
    const html = renderToStaticMarkup(<ConsoleImport data={data} update={() => {}} />);
    expect(html).toContain("Import via console");
    expect(html).toContain("https://www.sofascore.com/api/v1");
    expect(html).toContain("2421c3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.jsx`
Expected: FAIL — component module missing.

- [ ] **Step 3: Write the component**

```jsx
// src/components/ConsoleImport.jsx
import { useState } from "react";
import { buildImportSnippet, decodeBlob, applyDecoded } from "../lib/consoleImport.js";

export default function ConsoleImport({ data, update }) {
  const [token, setToken] = useState(data.meta.sofascoreToken || "");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [refetchAll, setRefetchAll] = useState(false);

  const known = refetchAll ? [] : Object.values(data.matches)
    .filter((m) => m.importedAt && m.goalTimes && !m.partial)
    .map((m) => m.eventId);

  const snippet = buildImportSnippet({
    tournamentId: data.meta.tournamentId,
    seasonId: data.meta.seasonId,
    token,
    knownEventIds: known,
  });

  const saveToken = (v) => {
    setToken(v);
    update((d) => ({ ...d, meta: { ...d.meta, sofascoreToken: v } }));
  };

  const doImport = async () => {
    setError(null); setStatus(null);
    let blob;
    try { blob = JSON.parse(paste); }
    catch { setError("Couldn't parse — copy the snippet output again."); return; }
    if (blob?.meta?.seasonId != null && String(blob.meta.seasonId) !== String(data.meta.seasonId)) {
      setError(`Blob is for season ${blob.meta.seasonId}, app is on ${data.meta.seasonId}.`);
      return;
    }
    setBusy(true); setStatus("Importing…");
    try {
      const decoded = await decodeBlob(blob);
      const now = Date.now();
      update((d) => applyDecoded(d, decoded, now));
      setPaste("");
      setStatus(`Imported ${decoded.results.length} match(es)${decoded.failed.length ? `, ${decoded.failed.length} failed` : ""}.`);
      if (decoded.failed.length) setError(decoded.failed.map((f) => `${f.id}: ${f.error}`).join("; "));
    } catch (e) {
      setError(e.message); setStatus(null);
    }
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Import via console</h3>
      <p className="dim">SofaScore blocks direct API access. Run this in a <code>sofascore.com</code> tab's DevTools console (type <code>allow pasting</code> if prompted), then paste the result below.</p>
      <div className="row">
        <label>x-requested-with token{" "}
          <input value={token} onChange={(e) => saveToken(e.target.value)} placeholder="e.g. 2421c3" />
        </label>
        <label><input type="checkbox" checked={refetchAll} onChange={(e) => setRefetchAll(e.target.checked)} /> Re-fetch all (backfill)</label>
        <button onClick={() => navigator.clipboard?.writeText(snippet)} disabled={!token}>Copy snippet</button>
      </div>
      <textarea readOnly value={snippet} rows={6} style={{ width: "100%", fontFamily: "monospace", fontSize: 11 }} />
      <textarea placeholder="Paste the snippet output here" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} style={{ width: "100%", fontFamily: "monospace" }} />
      <div className="row">
        <button className="primary" onClick={doImport} disabled={busy || !paste.trim()}>Import</button>
        {busy && <span className="dim">{status}</span>}
        {!busy && status && <span className="dim">{status}</span>}
        {data.meta.lastEventSync && <span className="dim">last sync {new Date(data.meta.lastEventSync).toLocaleDateString("en-IE")}</span>}
      </div>
      {error && <div className="banner err">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npx vitest run test/consoleImport.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConsoleImport.jsx test/consoleImport.test.jsx
git commit -m "feat: ConsoleImport panel — snippet generator + paste-back import UI"
```

---

### Task 6: Wire `ConsoleImport` into `MatchesTab`, retire the dead network controls

**Files:**
- Modify: `src/components/MatchesTab.jsx` (full replacement below)

The live `sync()` / `runImport()` paths always `challenge` now, so they're removed along with `busy`/`error` state and the `fetchSeasonEvents`/`importMatch`/`sleep` imports. The match listing, round grouping, round-move selector, and suspects all stay. Per-match Import/Retry buttons become status text (catch-up handles missing + partial matches).

- [ ] **Step 1: Replace the file**

Overwrite `src/components/MatchesTab.jsx` with:

```jsx
import { useEffect, useMemo, useRef } from "react";
import { upsertMatchStubs, applyImport, matchRound, setMatchRound, isSupersededPostponed, roundSuspects, allMatchTeamPoints } from "../lib/store.js";
import { TeamPill, PtsPill } from "./Pills.jsx";
import ConsoleImport from "./ConsoleImport.jsx";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

// long name on desktop, short code on phones (CSS picks one)
const teamLabel = (t) => (
  <>
    <span className="gt-sm">{t?.name ?? "?"}</span>
    <span className="lt-sm">{t?.shortName ?? "?"}</span>
  </>
);

export default function MatchesTab({ data, update }) {
  const currentRef = useRef(null);

  const all = Object.values(data.matches);
  const hiddenShells = all.filter((m) => isSupersededPostponed(data, m)).length;
  const matches = all.filter((m) => !isSupersededPostponed(data, m));
  const gone = (m) => m.status === "postponed" || m.status === "canceled";
  const todo = (m) => !gone(m) && ((m.status === "finished" && !m.importedAt) || m.status === "notstarted");

  // True group-by-round (overrides included), newest round first, kickoff order within.
  const byRound = new Map();
  for (const m of matches) {
    const r = matchRound(m);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const rounds = [...byRound.entries()]
    .map(([round, items]) => ({ round, items: items.sort((a, b) => a.kickoff - b.kickoff) }))
    .sort((a, b) => (b.round ?? -1) - (a.round ?? -1));
  const allRounds = rounds.map((r) => r.round).filter((r) => r != null).sort((a, b) => a - b);
  // Current gameweek = earliest round that still has something to do.
  const currentRound = rounds.length
    ? Math.min(...rounds.filter((r) => r.items.some(todo)).map((r) => r.round ?? Infinity))
    : null;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, []); // on mount only — jump to the current gameweek

  const moveMatch = (eventId, value) =>
    update((d) => setMatchRound(d, eventId, value === "" ? null : Number(value)));

  const suspects = roundSuspects(data);
  const teamPts = useMemo(() => allMatchTeamPoints(data), [data]);

  return (
    <div>
      <ConsoleImport data={data} update={update} />
      {matches.length === 0 && <p className="dim">No matches yet — run the console import above.</p>}
      {rounds.map(({ round, items }) => (
        <section
          key={round ?? "none"}
          ref={round === currentRound ? currentRef : null}
          style={{ scrollMarginTop: 56 }}
        >
          <h3>Round {round ?? "?"} <span className="dim">— {fmtDate(items[0].kickoff)}</span></h3>
          {items.map((m) => (
            <div key={m.eventId} className="card row">
              <span style={{ flex: 1 }}>
                <TeamPill team={data.teams[m.homeTeamId]} label={teamLabel(data.teams[m.homeTeamId])} />
                {teamPts.has(m.eventId) && <> <PtsPill pts={teamPts.get(m.eventId).home} /></>}
                {" "}{m.homeScore ?? ""}–{m.awayScore ?? ""}{" "}
                {teamPts.has(m.eventId) && <><PtsPill pts={teamPts.get(m.eventId).away} /> </>}
                <TeamPill team={data.teams[m.awayTeamId]} label={teamLabel(data.teams[m.awayTeamId])} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}> ⚠R{suspects.get(m.eventId)}?</span>
                )}
              </span>
              <select
                title="Move to another round"
                value={m.roundOverride ?? ""}
                onChange={(e) => moveMatch(m.eventId, e.target.value)}
              >
                <option value="">R{m.round ?? "?"}</option>
                {allRounds.filter((r) => r !== m.round).map((r) => (
                  <option key={r} value={r}>→ R{r}</option>
                ))}
              </select>
              {gone(m) ? <span className="dim">postponed</span>
                : m.status !== "finished" ? <span className="dim">upcoming</span>
                : m.importedAt && m.partial ? <span className="banner warn" style={{ margin: 0 }}>no lineups — re-run import</span>
                : m.importedAt ? <span style={{ color: "var(--accent)" }}>✓</span>
                : <span className="dim">not imported</span>}
            </div>
          ))}
        </section>
      ))}
      {hiddenShells > 0 && (
        <p className="dim">{hiddenShells} postponed duplicate{hiddenShells > 1 ? "s" : ""} hidden (rescheduled by SofaScore).</p>
      )}
    </div>
  );
}
```

> `upsertMatchStubs` and `applyImport` are imported but only used transitively via `ConsoleImport`; keep the import line as written (other store helpers on it are used). If your linter flags the two unused names, drop only them from the import — do not remove `matchRound`/`setMatchRound`/`isSupersededPostponed`/`roundSuspects`/`allMatchTeamPoints`.

- [ ] **Step 2: Verify the build compiles (catches JSX errors tests can't)**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm run build`
Expected: build succeeds, no errors.

- [ ] **Step 3: Run the full suite**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test`
Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchesTab.jsx
git commit -m "feat: replace dead live-import controls with the console-import panel"
```

---

### Task 7: Version bump, full verification, deploy

**Files:**
- Modify: `package.json` (version), `package-lock.json`

- [ ] **Step 1: Bump the version**

Edit `package.json` `"version"` from `0.16.0` to `0.17.0`.

- [ ] **Step 2: Sync the lockfile**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm install --package-lock-only`
Expected: `package-lock.json` version updates to 0.17.0.

- [ ] **Step 3: Full test + build gate**

Run: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && npm test && npm run build`
Expected: all tests PASS, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: v0.17.0 — console-snippet import"
```

- [ ] **Step 5: Deploy + manual verification**

Push to `main` (triggers GitHub Actions → Pages). Then on the live site:
1. Open a `sofascore.com` tab, copy a fresh `x-requested-with` from any Network request, paste it into the panel's token field.
2. Click Copy snippet, paste into the sofascore.com console, confirm it logs `captured N match(es)`.
3. Paste the clipboard blob into the panel, Import, and confirm a gameweek's matches show ✓ with sensible scores/points.

---

## Self-Review

**Spec coverage:**
- Mechanism (www base + `x-requested-with` + credentials) → Task 3 snippet. ✓
- Reuse via injectable fetcher → Tasks 1–2 (`blobToFetcher`, `decodeBlob`/`applyDecoded` call existing `fetchSeasonEvents`/`importMatch`/`applyImport`). ✓
- `buildImportSnippet`, `blobToFetcher` units + round-trip test → Tasks 1–3. ✓
- `ConsoleImport` component + SSR smoke → Task 5. ✓
- Token in Drive save (`meta.sofascoreToken`), survives re-import (user-owned, set via `update`) → Tasks 4–5. ✓
- Season catch-up of missing matches; known set skips imported → Tasks 3, 5. ✓
- Token-expiry detection + refresh message → Task 3. ✓
- Bad-JSON and wrong-season error handling → Task 5. ✓
- Replace dead MatchesTab controls → Task 6. ✓
- Out-of-scope (per-round, auto-token-refresh, mobile import) → not built. ✓
- Backfill (old "Re-import all"): preserved via the "Re-fetch all" checkbox in Task 5 (not in the spec body but a natural consequence of replacing that button; noted here).

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `blobToFetcher`/`decodeBlob`/`applyDecoded`/`buildImportSnippet` names and signatures match across Tasks 1–6. Blob shape `{ meta: { tournamentId, seasonId, builtFor }, payloads: { "<path>": json | {__status:404} } }` is identical in the snippet (Task 3), the fetcher (Task 1), and the round-trip test (Task 2). `meta.sofascoreToken` consistent across Tasks 4–5.
