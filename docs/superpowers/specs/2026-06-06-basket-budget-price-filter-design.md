# Selection Basket Cost + Budget Cap + Price Filter — Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

Players tab: the 📈 selection doubles as a budgeting basket — show the combined price of selected players, allow a budget cap with a red over-budget signal, and add an independent max-price table filter.

## Decisions

- **Σ cost chip** in the graph card's control row whenever players are selected: `Σ €23.5` (`/ €20.0` appended when a cap is set). Tooltip: selection count, players without a price (not counted), and `over by €X` when applicable.
- **Cap input** (`cap €`) beside the chip; session-only state; empty = no cap. Over-cap turns the chip `.loss` red.
- **Price filter** (`€ ≤`) in the filter row: hides players priced above it AND players with no price while active; composes with all other filters.
- All session state in PlayersTab; no lib/data changes. One mental model: 📈 selection = graph + basket.

## Out of scope

Per-position budgets, persisting cap/selection, basket on other tabs.
