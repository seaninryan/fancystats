# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment — read this first

The system Node is **v14** and silently breaks Vite/Vitest. `.nvmrc` says 20. Prefix every npm/npx command:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## Commands

```bash
npm run dev                              # http://localhost:5173/fancystats/
npm test                                 # vitest run (all suites)
npx vitest run test/store.test.js        # one file
npx vitest run -t "hotEventIds"          # by test name
npm run build                            # vite build (catches JSX errors tests can't)
```

**Deploy** = push to `main` → GitHub Actions → Pages (https://seaninryan.github.io/fancystats/). Always bump `package.json` version first and sync the lockfile (`npm install --package-lock-only`) — the version renders in the app footer and is the user's cache tell.

## What this is

Client-only React app, no server. All data lives in ONE JSON object persisted whole to the owner's Google Drive appDataFolder (`src/lib/drive.js`). Match data is imported from the SofaScore API directly in the browser.

## Architecture

**Pure logic in `src/lib/`, thin components in `src/components/`.** All domain rules live in unit-tested pure functions; components only wire state and render. New derivations belong in lib with tests, not in components.

- `store.js` — the data model. Every mutator takes the data object and returns a new one (`structuredClone`, never mutate). Also holds derivations: `playerTotals`, `leagueTable`, `isHot`/`hotEventIds`, `teamWindowEventIds`.
- `scoring.js` — fantasy scoring rules; `scoreAppearance(app, match, position, adjustment)` is stateless and adjustment-aware.
- `series.js` — per-gameweek chart series for the graphs (Players/Table tabs).
- `sofascore.js` — API response normalization. `pasteImport.js` — fantasy-site paste parsing. `drive.js` — auth + whole-save persistence. `teamColors.js` — club colors.

**Nothing derived is ever stored.** Totals, league table, hot flames, and chart series are all computed at render time from `matches` + `appearances` + `adjustments`, so a user correction (adjustment, round override) retroactively fixes all history. Don't cache or materialize derived stats into the save.

**Single mutation path:** components call `update(updater)` from `App.jsx`; updaters are pure; a single effect persists the whole save. Never call drive functions from components.

## Data model invariants

- Records keyed by SofaScore ids: `appearances`/`adjustments`/`absences` use `"<eventId>:<playerId>"`. Object keys are strings but record fields (`playerId`, `teamId`) are numbers — coerce with `String()`/`Number()` when comparing.
- **Gameweek = `matchRound(m)`** (`roundOverride ?? round`), never raw `m.round`.
- **An "imported" match** = `m.importedAt && m.goalTimes`; everything else (stubs, postponed shells) is invisible to all stats.
- User-owned fields (positions set manually, prices, stars, flags, `roundOverride`, custom names, adjustments, absences) survive re-imports; import-owned fields get overwritten. Preserve this split in any new field.
- Single sources of truth for conventions: card/assist accounting mirrors `leagueTable` (`appearanceStat` in series.js shares it); the hot rule lives only in `hotEventIds` (`isHot` delegates). Extend those, don't fork them.

## SofaScore quirks (hard-won)

- The API 403-blocks curl/Node TLS fingerprints outright — **never test endpoints with curl**; use the browser or `tools/capture.html`.
- Any request with a github.io `Referer` is blocked. `fetchJson` uses `referrerPolicy: "no-referrer"` plus a site-wide no-referrer meta tag — keep that on any new fetch code.
- Batch imports pause ~300ms between matches (politeness); keep that pattern.

## Testing conventions

Vitest in node environment — no jsdom. Lib tests build fixtures through real store operations (`applyImport`, `setAdjustment`...), not hand-rolled objects. Component "tests" are SSR smoke tests via `renderToStaticMarkup` (see `test/gameweekChart.test.jsx`); interaction coverage is manual after deploy.

## Workflow

Specs and plans for each feature batch live in `docs/superpowers/specs/` and `docs/superpowers/plans/` — read the relevant spec before extending a feature. CSS is a single `src/styles.css` with CSS variables; reuse the established classes (`.card`, `.row`, `.chip`, `.sticky-col`, `.freeze-stats`).
