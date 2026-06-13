# Console-snippet import — design

**Date:** 2026-06-13
**Status:** approved-for-planning

## Problem

SofaScore deployed an anti-bot challenge in front of its data API. Confirmed by
investigation (not assumed):

- The deployed app's fetches return `403 {"reason":"challenge"}`. The existing
  Referer suppression (`referrerPolicy: "no-referrer"` + meta tag) is intact and
  working — the request carries **no `Referer`** — so this is not a regression in
  our code.
- A clean top-level browser navigation to `api.sofascore.com/...` (no `Origin`
  header at all) **also** returns `challenge`. So the block is **origin-independent** —
  not about the `github.io` origin.
- Inspecting a *working* request from the SofaScore site's own Network tab revealed
  the gate: the site calls its **own same-origin path** `https://www.sofascore.com/api/v1/...`
  (not the `api.` subdomain) and sends header **`x-requested-with: <token>`** with
  `credentials: include`.
- A console probe run inside a `sofascore.com` tab using that exact recipe returned
  **200 + JSON** for the season-events endpoint and for `event` / `lineups` /
  `incidents`. Verified.

Conclusion: the data is only reachable from **inside a `sofascore.com` tab**. A
client-only app fetching cross-origin can never satisfy the gate. We therefore move
imports into a snippet the user runs in that tab, and paste the result back.

## Confirmed mechanism

Run inside a `https://www.sofascore.com` tab:

```
base   = https://www.sofascore.com/api/v1
header = x-requested-with: <token>          // e.g. "2421c3" — a frontend build hash
fetch opts = { headers, credentials: "include" }
```

Only `x-requested-with` matters. `sentry-trace` / `baggage` (their telemetry),
`if-none-match` (caching), and `sec-ch-ua` (browser auto-adds) are noise.

The token is tied to SofaScore's frontend build and will rotate when they redeploy.
When it does, fetches return `challenge` again and the user re-copies a fresh value
from any Network request.

## Architecture — reuse, don't rebuild

`fetchJson(path, fetcher)`, `fetchSeasonEvents(meta, fetcher)`, and
`importMatch(eventId, fetcher)` in `src/lib/sofascore.js` already take an
**injectable fetcher**. The whole feature hinges on that seam:

- The **snippet** is standalone JS (does not import app code). It replicates the
  same walk + per-match fetches the app does today, but in-page with the correct
  base + header, and **records every response into a path-keyed map**.
- The **paste-back import** supplies a fetcher that reads from the pasted map
  instead of the network, then runs the *existing* `fetchSeasonEvents` and
  `importMatch` unchanged. The normalizer, scoring, `applyImport`, and the single
  `update()` persistence path are all reused with zero changes.

No server. Stays 100% client-only. Nothing derived is stored (the blob holds raw
payloads; only the existing normalized output is persisted, exactly as today).

## Data flow

1. `ConsoleImport` panel reads app state: `data.meta.tournamentId`,
   `data.meta.seasonId`, the stored `x-requested-with` token, and the set of
   already-imported event ids (`m.importedAt && m.goalTimes`).
2. Panel renders a **generated snippet** with those values baked in, plus a token
   input field (default = stored token) and a "Copy snippet" button.
3. User opens a `sofascore.com` tab → DevTools console → pastes the snippet.
   The snippet:
   - Walks `events/last/{page}` then `events/next/{page}` (same `MAX_PAGES`,
     stop-on-404 logic as `walkEvents`), recording each page response under its
     path key.
   - From the walked events, selects **finished** matches whose id is **not** in
     the baked-in known-ids set (season catch-up of missing matches).
   - For each selected match, fetches `event` / `lineups` / `incidents`, recording
     each under its path key. A `lineups`/`incidents` 404 is recorded as a 404
     marker (matches `importMatch`'s graceful degrade); an `event` failure is logged.
   - Assembles `{ meta: { tournamentId, seasonId, builtFor: eventIds }, payloads: { "<path>": <json|{__status:404}> } }`
     and copies it to the clipboard via the console's built-in `copy()`. Logs a
     one-line summary (`captured N matches`).
   - If any fetch returns `challenge`/403, stops and logs:
     *"token expired — copy a fresh x-requested-with from any Network request and update it in the app."*
4. User pastes the blob into the panel's textarea → **Import**. The app:
   - `JSON.parse`s the blob, builds `blobToFetcher(blob)`.
   - Runs `fetchSeasonEvents(data.meta, fetcher)` → `upsertMatchStubs` (fixtures /
     teams / scores refresh), sets `lastEventSync`.
   - Runs `importMatch(id, fetcher)` for each `meta.builtFor` id → reduces through
     `applyImport`. No `sleep` (data is local).
   - Persists via the existing single `update()` effect. Shows an imported/failed summary.

## New units (pure + testable)

- **`buildImportSnippet({ tournamentId, seasonId, token, knownEventIds })` → string**
  (`src/lib/consoleImport.js`). Returns the snippet source. Snapshot-tested; assert
  the ids/token/known-set are interpolated and the base + `x-requested-with` are present.
- **`blobToFetcher(blob)` → fetcher** (`src/lib/consoleImport.js`). Returns
  `(url, opts) => Promise<{ ok, status, json() }>`: strips the `api.sofascore.com/api/v1`
  prefix to a path key, looks it up in `blob.payloads`; `{__status:404}` → `{ ok:false, status:404 }`;
  missing key → `{ ok:false, status:404 }`. Unit-tested by hand-assembling a blob
  from the existing `test/fixtures/*.json` and running it through real
  `fetchSeasonEvents` / `importMatch`, asserting the same normalized output as a
  direct-fixture import.
- **`ConsoleImport` component** (`src/components/ConsoleImport.jsx`). Token field,
  Copy-snippet button, paste textarea, Import button, busy/result/error display.
  SSR smoke-tested like the other components.

## Token storage

Stored in the Drive save as a user-owned field — proposal: `data.meta.sofascoreToken`.
Survives re-imports (import-owned fields get overwritten; this is user-owned). Syncs
across devices, so the value entered on desktop is present on the phone too. The
token input writes it via `update`.

## Integration with MatchesTab

The existing `sync()` and `runImport()` in `MatchesTab.jsx` call sofascore with the
default network `fetch` and now always fail with `challenge`. They are superseded by
the paste path. Decision for the plan: replace the live network buttons with the
`ConsoleImport` panel (the live path is dead and keeping a button that always errors
is worse than removing it). The `fetchSeasonEvents` / `importMatch` / `applyImport`
functions themselves are unchanged.

## Error handling

- **Snippet, token expired / challenge:** stop, log the refresh instruction. The
  partial blob is not copied (avoid a confusing half-import).
- **Paste, bad JSON:** caught, "Couldn't parse — copy the snippet output again."
- **Paste, blob from a different season:** `meta.seasonId` mismatch vs `data.meta` →
  warn before importing.
- **Per-match replay failure:** mirrors today — a non-404 throw stops the loop and
  reports how many imported before failing; 404 on lineups/incidents degrades.

## Testing

- `consoleImport.test.js`: `buildImportSnippet` snapshot + interpolation asserts;
  `blobToFetcher` round-trip through real `fetchSeasonEvents`/`importMatch` against
  `test/fixtures/`, asserting parity with a direct import.
- `consoleImport.test.jsx`: SSR smoke render of the panel.
- Manual after deploy: run the real snippet on `sofascore.com`, paste, confirm a
  gameweek imports and scores match.

## Out of scope (YAGNI)

- Per-round / single-match targeting (season catch-up only for v1).
- Auto-refreshing the token (user re-copies on the rare rotation).
- Mobile import: the snippet needs a desktop DevTools console, so importing is
  desktop-only. Viewing on mobile is unaffected; the synced token leaves a future
  bookmarklet path open but that is not built now.

## Limitations

- Manual step per catch-up (open tab, paste snippet, copy, paste back). Acceptable —
  it is a few clicks per gameweek and the live API path is gone.
- Token rotation requires a manual re-copy when SofaScore redeploys their frontend.
