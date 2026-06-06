# Header Tooltips + Graph-Selection Affordance — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

1. Hover tooltips on every column header across the Players, Table and Teams tables.
2. Make graph selection discoverable: a 📈 toggle at the start of each selectable row (dim when off, full-colour when selected — the existing `.mini-toggle`/`.off` pattern from the Teams grid), on BOTH the Players and Table tabs. Row-click still toggles; the icon is the affordance and an extra click target. The player name gets a dotted underline as the navigation affordance (matching the Teams grid's name links).

## Decisions

| Decision | Choice |
|---|---|
| Icon | 📈 `.mini-toggle` button INSIDE the first cell (not a new column — a new column would break `.sticky-col` first-child rules, the Players climb-splice indices, and the Table rank cell) |
| Row-click | Kept on both tabs; icon click calls the same toggle with `stopPropagation` (row-click would double-toggle otherwise) |
| Name affordance | Players tab name text gets `underline dotted` (Teams-grid convention); name click still opens PlayerDetail |
| Tooltip mechanism | Extend the COLS arrays to `[key, label, tip]` triples; headers render `title={tip}`. Teams tab's existing match-header titles (date + result-points explainer) unchanged. |
| Existing pensScored header note | Folded into its new tip verbatim |

## Tooltip copy

- **Players:** Player "click name for details · row or 📈 adds to the graph"; Team "club"; Pos "fantasy game position (▲▼ = differs from where they really play)"; € "price on the fantasy site"; Pts "fantasy points in the selected window"; ± "form vs baseline: points per team match in the window minus before it"; G "goals"; A "assists"; Min "minutes played"; St "matches started"; Sub "appearances as a substitute".
- **Table:** #/Team header "click to restore league order · row or 📈 adds to the graph"; P "played"; W "won"; D "drawn"; L "lost"; GF "goals for"; GA "goals against"; GD "goal difference"; Pts "league points"; FPts "fantasy points scored by the team's players"; 🟨 "yellow cards (a second yellow counts too)"; 🟥 "dismissals (straight red or second yellow)"; Pen "penalties scored (missed shown in row tooltip)"; 👟 "assists".
- **Teams:** Player "click to sort by appearances"; Pos "fantasy game position"; Min/G/A "minutes/goals/assists in the selected window"; Pts "fantasy points in the selected window".

## Changes

- `src/components/PlayersTab.jsx`: COLS → triples (incl. the spliced ± entry); header `title`; 📈 toggle at the start of the name cell (stopPropagation); name text in a dotted-underline span.
- `src/components/TableTab.jsx`: COLS → triples; `#  Team` header title; 📈 toggle at the start of the rank cell (stopPropagation).
- `src/components/TeamsTab.jsx`: TOTAL_COLS → triples; Player/Pos header titles.
- No lib, CSS, or data changes (`.mini-toggle` styles already exist).

## Testing

UI-only — full suite + build, manual verification after deploy (hover each header; toggle via icon, row, and combinations; name still opens detail).
