# Graph Stat Selectors — Design

**Date:** 2026-06-06
**Status:** Approved
**Extends:** 2026-06-06-gameweek-graphs-design.md (shipped in v0.8.0)

## Goal

- **Players tab graph:** add a stat selector like the Table tab's — `FPts | G | Ast | Yel | Red`, default FPts.
- **Table tab graph:** add result stats — buttons become `P | W | D | L | GF | GA | Pts | FPts | Yel | Red | Ast` (table-column order).

## Decisions

| Decision | Choice |
|---|---|
| Player stats | `fantasy` (FPts), `goals` (G), `assists` (Ast), `yellows` (Yel), `reds` (Red); default `fantasy` |
| Team stats added | `played` (P, 1 per match), `won`/`drawn`/`lost` (1 or 0), `gf`/`ga` (goals that week) — all require non-null scores, mirroring leagueTable's guard |
| Positionless players | Only `fantasy` is all-null; goals/cards/assists don't need a position and now chart real values |
| Accounting conventions | Goals/assists: numeric adjustments added (as playerTotals does). Yellows: second yellow counts as a yellow too; reds = dismissals (straight red or second yellow) — leagueTable conventions, identical at player and team level |
| Cumulative defaults | Unchanged (Players off, Table on); toggle independent of stat |
| GameweekChart | Untouched — both tabs pass stat buttons as children |

## Changes

- `src/lib/series.js`:
  - `playerWeeklySeries(data, playerId, stat = "fantasy")` — generalized; new `PLAYER_STATS` constant.
  - `teamWeeklySeries` — match loop handles the result-stat family (`points`, `played`, `won`, `drawn`, `lost`, `gf`, `ga`); appearance loop unchanged for the rest. `TEAM_STATS` extended and reordered to table-column order.
- `src/components/PlayersTab.jsx`: `stat` state (default `"fantasy"`), `PLAYER_STATS` buttons as GameweekChart children, stat added to the chartSeries memo deps and call.
- `src/components/TableTab.jsx`: no code change (buttons already map `TEAM_STATS`).

## Testing

Extend `test/series.test.js` against the existing fixture: player goals/assists/yellows/reds series; positionless player still charts goals; team P/W/D/L/GF/GA series; default-stat backward compatibility (existing fantasy tests unchanged).

## Out of scope

Minutes/starts stats, per-stat cumulative memory, GD as a stat (derivable from GF−GA cumulative if ever wanted).
