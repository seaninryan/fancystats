# Teams Grid: Per-Week 🔥 + Frozen Stat Columns — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

1. **Per-week 🔥 in match cells:** a Teams-grid cell shows 🔥 when the player was in form *after that match* — same rules as the Players-tab hot filter (≥8 fantasy pts in ≥2 of the team's last 3 imported matches), with the window ending at that cell's match. The rightmost cell flame therefore always agrees with the current row/Players-tab flame.
2. **Frozen columns:** Player, Pos, Min, G, A, Pts stay pinned while the match grid scrolls horizontally — desktop only; below 640px only Player stays frozen (mobile real estate).

## Decisions

| Decision | Choice |
|---|---|
| Hot timing | "After that match": window = that match + up to 2 before it; <2 team matches in window → never hot (same guard as isHot) |
| Single source of truth | New `hotEventIds(data, playerId, apps?)` → `Set<eventId>` in store.js; `isHot` refactored to delegate (hot now = hot after the team's latest imported match). Existing isHot tests must keep passing unchanged. |
| Cell rendering | 🔥 prepended to the cell symbol; tooltip gains "— in form". Only played cells; absences/upcoming unaffected. |
| Freeze mechanism | CSS sticky with fixed widths + cumulative left offsets on a new `.freeze-stats` table class (cols 1–6). Player cell content wrapped in a fixed-width flex div so long names ellipsize instead of breaking the offsets (name link gets a title with the full name). |
| Mobile | `@media (max-width: 640px)`: cols 2–6 revert to static; col 1 stays frozen via existing `.sticky-col`. |
| Positionless players | No computable score → `hotEventIds` returns an empty set (matches isHot returning false). |

## Changes

- `src/lib/store.js`: `hotEventIds(data, playerId, appsArg?)` — walks the player's team's imported matches chronologically, scores the player's appearance in each (adjustment-aware, via scoreAppearance), and collects the eventIds of matches after which the trailing window satisfies the hot rule. `isHot` becomes: hotEventIds contains the latest team match's eventId. Sitting a match out still consumes a window slot (score = null).
- `src/components/TeamsTab.jsx`: compute `playerApps` once per row (it's currently filtered twice); add `hotEvents = hotEventIds(...)`; played cells check `hotEvents.has(m.eventId)`. Table gets `freeze-stats` class; player cell content wrapped in `.player-cell` div.
- `src/styles.css`: `.freeze-stats` sticky rules for cols 1–6 (widths 210/52/56/40/40/56, lefts 0/210/262/318/358/398, `background: var(--bg)`, z-index matching existing corner conventions), `.player-cell` flex wrapper with ellipsizing name link, mobile media query reverting cols 2–6.

## Testing

`test/store.test.js`: new fixture — one team, four imported matches, player scores per match [9, 8, 3, —(absent)]: hot exactly after matches 2 and 3 (the 8 pins the ≥ threshold boundary; the absence pins slot consumption); single-match team → empty set; positionless player → empty set; `isHot` agrees with membership of the latest match. All existing isHot tests unchanged and green.

Component/CSS changes: full suite + build + manual check (scroll the Teams grid; flames appear mid-season and the rightmost matches the row flame; mobile width keeps only Player frozen).

## Out of scope

Hot indicators on upcoming columns, configurable hot rules, freezing on the Players/Table tabs.
