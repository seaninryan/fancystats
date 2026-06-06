# Gameweek Graphs — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

Add interactive line graphs of per-gameweek stats to two tabs:

- **Players tab:** select players in the table; a graph of each selected player's fantasy points per gameweek appears at the top.
- **Table tab:** select teams in the league table; a graph of each selected team's progress through the gameweeks appears at the top, with a stat selector (league points, fantasy points, yellows, reds, assists) and a cumulative/weekly toggle.

## Decisions made

| Decision | Choice |
|---|---|
| Teams shown on Table tab graph | Multiple, selectable (row click adds/removes lines) |
| Selection UX (both tabs) | Click the row to toggle selection; selected rows highlighted |
| Player detail access | Clicking the player **name** opens PlayerDetail; rest of row toggles selection |
| Charting | **Recharts** library |
| Cumulative toggle | Present on both tabs. Default **off** on Players (weekly form view), **on** on Table (season progress). Toggle is independent of the selected stat. |
| Graph vs. Last 3/5/All window | Graph always shows the full season; window buttons only affect the table below |
| Selection persistence | Session-only component state (not persisted to save file) |

## Data derivation — `src/lib/series.js` (new, pure, unit-tested)

Per-gameweek history is not stored; it is derived at render time from `matches` + `appearances` + `adjustments`, consistent with the project's "scores are never pre-computed" principle.

- `playerWeeklySeries(data, playerId)` → `[{ round, value }]`
  Fantasy points per gameweek via `scoreAppearance(app, match, position, adjustment)`, grouped by effective round (`match.roundOverride ?? match.round`). Only imported, finished matches count.
- `teamWeeklySeries(data, teamId, stat)` → `[{ round, value }]`
  `stat` ∈ `points` (league points from result: 3/1/0), `fantasy` (sum of all the team's players' fantasy points), `yellows`, `reds`, `assists`.
- `accumulate(points)` → running-total transform for the cumulative toggle (nulls pass through without breaking the running sum).
- **X-axis domain:** all rounds that have at least one imported match, from min to max.
- **Gaps vs zeros:** if a team has no imported finished match in a round (postponed, not yet imported), the value is `null` → rendered as a line gap. A player who appeared but scored 0 shows `0`. A player whose team played but who didn't appear shows `0`.

## Shared chart component — `src/components/GameweekChart.jsx` (new)

Wraps a Recharts `LineChart`:

- Props: `series` (`[{ key, label, color, points: [{ round, value }] }]`), `cumulative`, `onToggleCumulative`, `onClear`, optional stat-selector slot/children for the Table tab.
- One `<Line>` per selected player/team; X = gameweek number, Y = stat value.
- Tooltip + legend from Recharts; `connectNulls={false}` so missing rounds render as gaps.
- Line colors from `teamColor()`; a fallback palette disambiguates when two selections share a team color.
- Styled with the existing CSS variables (`--panel`, `--line`, `--text`, `--dim`, `--accent`); rendered inside a `.card` at the top of the tab, only when ≥1 row is selected.
- Includes a **Cumulative** toggle button and a **Clear** (selection) button.

## Players tab changes — `src/components/PlayersTab.jsx`

- New state: `selected` — a `Set` of player ids.
- Row `onClick` toggles selection (previously opened PlayerDetail). Player **name** cell gets its own click handler with `stopPropagation()` that calls `openPlayer(id)`.
- Selected rows get a highlight class (new CSS rule, accent-tinted background).
- When ≥1 player selected, `GameweekChart` renders above the filter row showing fantasy points per gameweek, one line per player, labelled with player names. Cumulative defaults off.
- Selection is independent of filters: a selected player filtered out of the table stays selected and charted.

## Table tab changes — `src/components/TableTab.jsx`

- New state: `selected` (Set of team ids), `stat` (`"points"` default), `cumulative` (default `true`).
- Rows get `onClick` to toggle selection (no existing click handler — no conflict) plus the same highlight class.
- When ≥1 team selected, `GameweekChart` renders above the table with stat selector buttons — `Pts | FPts | Yel | Red | Ast` — and the cumulative toggle. Line colors = team colors, labels = team short names.

## Dependencies & environment

- `npm install recharts` — the project's first runtime dependency beyond react/react-dom; accepted trade-off for free tooltips/legends/axes.
- Install and dev/test runs must use the nvm-selected modern Node (Vite 5 needs ≥18), not the system Node 14.

## Testing

- **Vitest unit tests** for `series.js`: round grouping, `roundOverride` respected, gaps (null) for rounds without imported matches, zeros for played-but-scoreless weeks, adjustments included in fantasy points, league-points derivation from scores (W/D/L), each team stat, cumulative transform incl. null handling, x-domain spanning min→max imported round.
- **Component smoke test** only for `GameweekChart` (renders given series without crashing); chart internals are Recharts' responsibility.

## Edge cases

- Players with missing fantasy data (`err` flag): line renders from whatever is computable — same value as the Pts column.
- `partial` matches: appearances that exist are counted, consistent with table totals.
- Matches not `finished` or not imported are excluded everywhere.

## Out of scope

- Persisting selections to the save file.
- Graphing on Teams/Matches tabs.
- Any stat selector on the Players tab graph (fantasy points only).
