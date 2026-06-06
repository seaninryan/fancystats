# Row Hover + Two-Column Paste (Prices & Site Points) — Design

**Date:** 2026-06-06
**Status:** Approved

## Goals

1. **Row hover:** subtle emphasis on mouseover for all table rows.
2. **Two-column paste format:** the fantasy site's player pages now copy as name line + furniture line (`Club Picture\t4.0\t25` — price then total points). Parse it; the existing player **price** field currently holds site *points* from an old paste, and pasting real prices heals it.
3. **Site-points cross-check:** store the site's total as `player.sitePoints`; on the Players tab Pts cell, show a small amber corner triangle + tooltip when our computed season total disagrees.

## Decisions

| Decision | Choice |
|---|---|
| Hover tint | `tbody tr:hover` → #eaf0f4; selected rows darken to #ddeee5 (keep their green identity); `err-cell` keeps red; sticky/frozen cells tint with the row |
| Price detection | In a multi-number row, price = first number ONLY when decimal-formatted (`4.0`, `5.9`) — a leading integer rank can never pose as a price; `value` stays "last number" (back-compat: old single-number pastes unchanged) |
| Furniture lines | A line whose word-fields are all stopwords but carrying numbers (the `Club Picture …` line) attaches its numbers to the pending name instead of clobbering it |
| Position-paste enrichment | GK/DEF/MID/FWD pastes also apply price + sitePoints when the row carries a price; manual `gamePositionSource` still protects the position, never the price |
| `price` kind | `p.price = m.price ?? m.value`; sitePoints stored only when the two-column format was detected |
| sitePoints storage | `player.sitePoints` (number, default null in `defaultPlayer`); paste-owned, survives match re-imports like other player fields |
| Cross-check semantics | Compare the **season** computed total vs sitePoints, even when a Last 3/5 window is active (window changes the displayed number, not the check). Triangle only when both exist and differ. Tooltip: `+1 vs official site (ours 25 · site 24)`. Honest noise: behind-on-imports shows as a difference — the tooltip's two numbers make that readable. |
| Triangle | CSS `::after` corner wedge in `var(--warn)` via a `.pts-diff` cell class |
| € header tooltip | Unchanged — becomes accurate once real prices are pasted |

## Changes

- `src/styles.css`: hover rules (+ sticky/frozen/selected/err companions); `.pts-diff` corner triangle.
- `src/lib/pasteImport.js`: `parsePaste` accumulates pending numbers, recognises furniture lines, emits optional `price`; `matchPlayers` carries the whole row through (`...row`).
- `src/lib/store.js`: `defaultPlayer` gains `sitePoints: null`; `applyPasteResults` applies `price`/`sitePoints` per the table above.
- `src/components/SettingsTab.jsx`: unmatched preview shows `(25 · €4.0)` for two-column rows; linked rows spread the full row so price survives manual linking.
- `src/components/PlayersTab.jsx`: rows memo computes `seasonPts`/`sitePoints`/`siteDelta`; Pts cell gets `.pts-diff` + tooltip.

## Testing

- `test/pasteImport.test.js`: two-column format (exact user sample lines, tab and multi-space), rank line yields no price, vertical decimal variant, matchPlayers carries price. All 17 existing tests unchanged.
- `test/store.test.js`: price-kind two-column sets price+sitePoints; old single-number price paste unchanged (no sitePoints); enriched position paste; manual-position guard with price still applying. Existing applyPasteResults tests unchanged.
- UI: suite + build + manual.

## Out of scope

Showing sitePoints anywhere besides the Players Pts tooltip; auto-reconciling differences; PlayerDetail cross-check.
