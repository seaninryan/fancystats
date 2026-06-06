# Cross-Check Everywhere + Penalties Column + Re-Import — Design

**Date:** 2026-06-06
**Status:** Approved

## Goals

1. Site cross-check triangle becomes directional: **green = site total higher than ours, red = lower**.
2. Same triangle on the **Teams** grid (per-player Pts total) and the **Table** tab (FPts vs the sum of the team's players' sitePoints).
3. **Pen** column on the Players tab (penalties scored, adjustment-aware).
4. **↻ Re-import all** button on Matches — re-runs every imported match through the current parser. Root cause being healed: penScored parsing landed 2026-06-05 (`c50317e`) after the season was imported, so stored appearances all carry `penScored: 0`.

## Decisions

| Decision | Choice |
|---|---|
| Triangle direction | `siteDelta = ours − site`; delta < 0 (site higher) → green `var(--accent)`; delta > 0 → red `var(--err)`. CSS modifier classes `site-up`/`site-down` on the existing `.pts-diff` base. |
| Cross-check scope | Always season-vs-site, on all three tabs, regardless of active windows |
| Table FPts site total | `teamSitePoints(data)` (new pure fn): per team — `site` (Σ sitePoints where present), `withData`, `missing` counts over the team's players. Triangle only when `withData > 0` and delta ≠ 0; tooltip appends `· N players missing site data` when relevant. |
| Teams grid season points | The existing totals loop gains a `seasonPoints` accumulator (computed for every appearance, not just windowed ones) |
| Pen column | `playerTotals` gains `pens` (Σ `penScored`, adjustment field `penScored` applied with the leagueTable `Math.max(0, …)` clamp); Players COLS gets `["pens", "Pen", "penalties scored"]` after A. Reads 0 until re-import. |
| Re-import all | Button beside "Import all missing": `runImport` over every `importedAt` match (existing 300ms politeness + progress + error handling). Safe: `applyImport` preserves user-owned fields; adjustments/absences are keyed separately and untouched. |

## Changes

- `src/lib/store.js`: `playerTotals` adds `pens`; new `teamSitePoints(data)`.
- `src/styles.css`: `.pts-diff` color moves to `site-up`/`site-down` modifiers.
- `src/components/PlayersTab.jsx`: Pen column; triangle direction class.
- `src/components/TeamsTab.jsx`: `seasonPoints` in totals; triangle on the Pts total cell.
- `src/components/TableTab.jsx`: FPts cell special-cased with the team-level cross-check (season fantasy from `leagueTable(data, null)` memo).
- `src/components/MatchesTab.jsx`: re-import-all button.

## Testing

`test/store.test.js`: `playerTotals` pens with and without adjustment; `teamSitePoints` sums/withData/missing. UI: suite + build + manual (re-import a match with a known penalty → Pen column and Table Pen column populate; triangles green/red per direction).

## Out of scope

Encoding any FAI-vs-SofaScore scoring-rule differences the diagnostics reveal (next batch, evidence first); PlayerDetail cross-check.
