# Players Tab: Biggest Climbers (± Column) — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

Surface form trends on the Players tab: when a Last 3/5 window is active, a sortable **±** column shows each player's fantasy points-per-team-match in the window minus the same over all earlier imported matches. Sort descending = biggest climbers, ascending = biggest fallers.

## Decisions

| Decision | Choice |
|---|---|
| Metric | Form vs baseline: `windowPts / windowTeamMatches − priorPts / priorTeamMatches` |
| Denominator | Team matches (not appearances) — sitting out drags form down, consistent with the hot rule |
| Window | The same `teamWindowEventIds(data, win)` set used everywhere else; prior = the team's earlier imported matches |
| Null (shows "—") | No fantasy position, empty window, or **no prior games** (a newcomer can't climb relative to nothing) |
| UI | `±` column inserted after Pts, only while Last 3/5 is active; green `+4.2` / red `−1.8` (existing `gain`/`loss` classes), one decimal; sortable via the existing header mechanics (nulls sink) |
| Switching to "All" | Column disappears; if sorted by ±, sort falls back to Pts desc |
| No preset button | The column composes with all existing filters; no new mode |

## Changes

- `src/lib/store.js`: `playerClimb(data, playerId, { apps, windowIds })` — pure, sibling of `playerTotals`; uses `teamImportedMatches` for the prior set and `playerTotals` for both sums.
- `src/components/PlayersTab.jsx`: `climb` field in the rows memo (null when no window); column list becomes dynamic (climb spliced in after points when windowed); one conditional `<td>`; window-button click resets a climb sort when switching to All.

## Testing

`test/store.test.js`: dedicated fixture (4 imported matches, one improving player ≈ +5.3, one declining ≈ −5.0); null for: window spanning all matches (no baseline), positionless player, empty/missing windowIds.

## Out of scope

Climbers on the Table/Teams tabs, rank-movement variant, price-value metrics.
