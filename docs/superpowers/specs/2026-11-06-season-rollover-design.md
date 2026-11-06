# Season rollover — keep past seasons viewable

**Date:** 2026-11-06 · **Status:** approved design

## Goal

The 2026 season has ended. Start 2027 in the same save without losing 2026: past seasons stay
browsable (whole app, read-only) and a player's last-season line is visible from their detail
page and as an optional Players column.

Today matches carry no season, so changing `meta.seasonId` would blend seasons (Round 1 overlaps,
totals sum across years, stale prices/site points carry over). This design fixes that.

## Approach: tag + project

One save file. Every match is tagged with a `seasonId`. A pure projection
`seasonView(data, seasonId)` returns a data object containing only that season, and the app hands
that view — not raw data — to every tab. Existing derivations (`leagueTable`, `playerTotals`,
`hotEventIds`, `teamWindowEventIds`, series, fixtures…) are untouched because they already take
`data`. Rejected: one Drive file per season (multi-file drive.js, second load for the inline line);
threading a season filter through every derivation (invasive, easy to forget).

## Data model

- `match.seasonId: number` — import-owned. Stamped from `data.meta.seasonId` by `applyImport` and
  `upsertMatchStubs` **only when the match has no seasonId yet** (a re-import never moves a match
  between seasons).
- `data.seasons: { [seasonId]: { label: string, players?: { [playerId]: ArchivedFantasy } } }`
  where `ArchivedFantasy = { price, sitePoints, gamePosition, gamePositionSource, inSquad }`.
  The current season has an entry too (label only, no `players` until it is archived).
- Unchanged and shared across seasons: `teams`, team colours, `players` identity fields
  (`name`, `teamId`, `customName`, `pasteAlias`, `starred`, `realPosition`), `meta.fantasyClubMap`.
  `appearances` / `adjustments` / `absences` stay keyed by `eventId:playerId`; their season follows
  their match.

### Migration (`migrateSeasons(data)` in store.js, run on load in App.jsx)

Idempotent. Ensures `data.seasons` exists; stamps every match lacking `seasonId` with
`meta.seasonId`; ensures `seasons[meta.seasonId]` exists, label defaulting to `"2026"` for 87682
and to `String(seasonId)` otherwise. Safe because no rollover has happened yet, so every untagged
match belongs to the current season. `emptyData()` includes `seasons: {}`.

## Rollover (`startNewSeason(data, { seasonId, label })` in store.js)

Pure mutator. Rejects (throws) if `seasonId` equals the current one or already exists in `seasons`.
1. Archive: for every player, copy the `ArchivedFantasy` fields into
   `seasons[oldId].players[pid]` (skip players whose fields are all null/false).
2. Reset live players: `price`, `sitePoints`, `gamePosition`, `gamePositionSource` → null,
   `priceUpdatedAt` → null, `inSquad` → false. Flags are left alone (they expire on their own).
3. `meta.seasonId = seasonId`, `meta.lastEventSync = null`; `seasons[seasonId] = { label }`.
Nothing is deleted.

## Projection (`seasonView(data, seasonId)` in a new `src/lib/seasons.js`)

Returns a new object (no mutation of `data`):
- `matches` filtered to `m.seasonId === seasonId`.
- `appearances`, `adjustments`, `absences` filtered to keys whose eventId is in those matches.
- For a **past** season: each player's `ArchivedFantasy` fields replaced from
  `seasons[seasonId].players[pid]` (missing archive entry → null/false). For the current season
  players are returned as-is.
- Everything else passed through.

Also `seasonList(data)` → `[{ seasonId, label, current }]` newest first, and
`previousSeasonId(data)` → the most recent non-current season or null.

## UI

- **App.jsx** holds `viewSeason` (default = `meta.seasonId`). It computes
  `view = useMemo(() => seasonView(data, viewSeason))` and passes `view` to tabs. When viewing a
  past season, tabs receive a no-op `update` and a `readOnly` prop; import/edit controls
  (ConsoleImport, FantasyImport, paste, adjustment/position/round editors, rollover) hide or disable
  on `readOnly`. A banner reads "Viewing <label> (read-only) · Back to <current label>".
- **Season picker** in the header, shown only when `seasonList` has >1 entry.
- **PlayerDetail**: a line under the header, when `previousSeasonId` exists and the player has
  appearances there: `<label>: N apps · M′ · xG yA · P pts (P/apps per game)` via
  `playerTotals(seasonView(fullData, prev), id)`. PlayerDetail and PlayersTab therefore also receive
  the raw save as a `fullData` prop (they otherwise get `view` as `data`). Hidden in past-season view.
- **PlayersTab**: a sortable "Last" column (previous-season fantasy points, blank for players with
  no appearances then), shown only when `previousSeasonId` exists and not in past-season view.
- **SettingsTab** "Season" card: replace the raw season-id input (which would mis-tag matches) with
  "Start new season…": inputs for season id + label, a confirm step listing what's archived/reset,
  then `update((d) => startNewSeason(d, …))`. Plus **Download backup** — saves the whole data
  object as `fancystats-backup-YYYY-MM-DD.json` (Blob + object URL), always available.

## Behaviour notes

- Form windows, 🔥, goal clocks and climbers naturally start fresh each season (they see only the
  viewed season). Early-season windows will be thin; accepted.
- `staleInfo`, `roundSuspects`, `missingFantasyData` likewise operate on the current view.
- Console-import blob season check (ConsoleImport.jsx) is unchanged.

## Testing

Vitest, fixtures via real store ops (`applyImport`, `setAdjustment`, `setPlayerField`…):
- `migrateSeasons`: stamps untagged, leaves tagged, idempotent, seeds label.
- `applyImport`/`upsertMatchStubs`: stamp new matches; re-import keeps original seasonId.
- `startNewSeason`: archives fields, resets live, keeps identity/user fields, rejects duplicate id,
  deletes nothing.
- `seasonView`: filters matches/appearances/adjustments/absences; restores archived fantasy fields
  for a past season; `leagueTable`/`playerTotals` on each view equal single-season expectations.
- SSR smoke: PlayerDetail renders the last-season line; App-level read-only banner renders.
