# Import feedback — design

**Date:** 2026-09-15
**Status:** approved

## Problem

The Settings tab's three import cards act silently.

- Both "Copy snippet" buttons (`ConsoleImport.jsx`, `FantasyImport.jsx`) call
  `navigator.clipboard?.writeText(...)` and render nothing. The `?.` means that on a
  context without the clipboard API the click is a no-op with no error — you go to
  DevTools, paste, and get whatever was on the clipboard before.
- `FantasyImport.apply` and `SettingsTab.apply` clear the textarea and the preview and
  say nothing. The cleared form is the only tell that anything happened, and it looks
  identical to a form you cleared yourself.
- `ConsoleImport.doImport` does set a status string, but renders it as undifferentiated
  dim text in a row beside the "last sync" date, so success reads like chrome.

## Goals

Confirm, visibly, that (a) a copy landed on the clipboard and (b) a paste-import was applied.

Non-goals: reworking the import flows, the error paths (the existing `.banner.err` is
fine), or the layout of the cards.

## Design

### `src/components/CopyButton.jsx` (new)

Replaces both inline clipboard buttons.

Props: `text`, `disabled`, `children` (idle label), and any `className`.

State is one of `idle` / `copied` / `failed`:

- click → `await navigator.clipboard.writeText(text)` → `copied` for 2000ms → `idle`
- a rejected write, or no `navigator.clipboard` at all → `failed` for 3000ms → `idle`

The missing-API case must land in `failed`, not be swallowed: that is the bug the `?.`
currently hides.

The label swaps to `✓ Copied` / `Copy failed` while flashed, and `copied` adds a
`.copied` class so the accent-green tint registers without reading the label. The
revert timer is cleared on unmount.

### `src/components/Flash.jsx` (new)

The auto-fading success banner: `<div className="banner ok">✓ {message}</div>`.

Holds for 5000ms, then calls `onDone` so the parent clears its own state — the parent
owns the message, `Flash` only owns the timer. `onDone` is kept in a ref and left out
of the effect deps so an unrelated re-render cannot restart the countdown. Renders
`null` for an empty message.

### Wiring

| Card | Message |
|---|---|
| `ConsoleImport` | existing `Imported N match(es)` string, moved from the dim span into `Flash` |
| `FantasyImport` | `Applied N players` (`+ M new` appended when any were created) |
| `SettingsTab` | `Updated N players — <kind label>` |

`ConsoleImport`'s in-progress `Importing…` stays a plain dim span: it must not fade
while the work is still running, and it is replaced by the result either way.

`FantasyImport` and `SettingsTab` compute their counts *before* `setPreview(null)`
clears the source.

Every card clears a pending flash when the textarea changes or a re-parse runs, so a
fresh paste never sits beneath a stale success message.

### `src/styles.css`

- `.banner.ok` — green sibling of the existing `.warn` / `.err` banners
- `button.copied` — accent fill, matching `button.primary`
- `@keyframes flash-out` — opacity hold, then a ~500ms dissolve at the tail

Light theme only; the stylesheet has no dark mode.

## Testing

Extend the existing SSR smoke tests (`consoleImport`, `fantasyImport`, `settingsTab`)
to cover the new render branches, and add `test/copyButton.test.jsx`.

Nothing lands in `src/lib/`: this is UI state with no domain rule to extract, so there
are no new pure functions to unit-test. Clipboard interaction and the fade remain
manual-after-deploy, per the project's existing convention.
