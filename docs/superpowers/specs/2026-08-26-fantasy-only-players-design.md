# Fantasy-only players — design

**Date:** 2026-08-26
**Status:** approved-for-planning

## Problem

A player who has never played a minute cannot exist in fancystats at all.

`src/lib/store.js:42` is the only place a player record is ever created, and it runs
only from `applyImport` with the players list `sofascore.normalize()` produced. That
list is built from surviving *appearances*, and `src/lib/sofascore.js:97` drops the
unused bench:

```js
if (!a.started && a.subOnMin == null && a.minutes <= 0 && !playedPerStats) continue;
```

Nothing else can create a player. `applyFantasyRows` (`store.js:204`) and
`applyPasteResults` (`store.js:177`) both `continue` on an unknown id — the fantasy
capture can only *enrich* players who already exist. The link UI can only bind an
unmatched row to an existing player; "skip" is the only other option. The design was
deliberate, and `FantasyImport.jsx:113` says so:

> pts is the triage signal: 0 means they've never played, so there's no SofaScore
> record to link them to and skipping is correct

**Observed:** Danny Mandroiu (Shamrock Rovers) is absent from the app. He has missed
every match this season, so he appears in no lineups payload we fetch — SofaScore's
`/lineups` carries only the matchday squad, XI plus named subs. Harvesting unused
bench players would not have surfaced him either.

**The only source that knows he exists is the Fantasy LOI capture.** Pass A of the
snippet (`Statistic=Value`, one POST per club) returns each club's full registered
squad with a price, regardless of appearances. He currently lands in `unmatched` with
0 points and is skipped.

## Approach

Let the fantasy import materialize players SofaScore has never seen, as full first-class
records — starrable, squad-able, flaggable, searchable — that merge into the real
record when the player finally debuts.

## The record

A row that matches no SofaScore player becomes an entry in `data.players` with
`fantasyOnly: true`, carrying `name`, `teamId`, `gamePosition`, `price`, `sitePoints`
and the usual `defaultPlayer` fields.

**Id:** `fx-<normalized-name-hyphenated>-<teamId>`, e.g. `fx-danny-mandroiu-2334`,
built from `normalizeName()` (`pasteImport.js`) with spaces replaced by hyphens.
Three constraints drive that shape:

- **Deterministic** — the same capture row always yields the same id, so a re-import
  updates the existing ghost instead of duplicating it, and user-owned fields survive.
- **No colon** — absence keys are `` `${eventId}:${playerId}` `` and `playerOutNow`
  parses them with `key.split(":")`. A colon in the id would corrupt that parse.
- **Non-numeric** — `Number(id)` is `NaN`, so `playerAppearances` and
  `appearancesByPlayer`'s `index.get(Number(id))` both safely find nothing.

**Club is required.** A row whose club did not resolve to a SofaScore team gets no
record: without a `teamId` we could never reconcile it on debut, and the import
already prompts the user to bind unrecognised clubs.

## Creation is explicit, not silent

`UnmatchedLinks` gains a third per-row option — **add as new player** — alongside the
existing link targets and "skip".

- **Pre-selected** for rows whose `sitePoints` is 0 or null (the existing triage rule)
  **unless a clubmate's name is within one edit of the row's** — so the first import is
  one click on Apply. The veto matters because a row also goes unmatched when the name
  is ambiguous (two SofaScore ids for one Ben Mahon, so `matchPlayers` can't choose) or
  drifted by a character ("Kovalevskis" on the site, "Kovaleskis" on SofaScore).
  Creating a record in either case duplicates someone we already hold. Comparison is on
  the whole name, not the surname: "Alex Noonan" beside "Michael Noonan" is a second
  player, "Max Kovalevskis" beside "Max Kovaleskis" is one person spelled two ways.
  The rule is `shouldCreateRow` in `fantasyImport.js`.

A wrongly created ghost is undone by `removeFantasyOnlyPlayer`, surfaced as **Remove**
in Player Detail. It refuses any record with appearances or without `fantasyOnly`, so
it can never delete real history.
- **Not** pre-selected for rows with points above 0. "Unmatched but scoring" means name
  drift on a player who *has* played; inventing a ghost there would create a duplicate
  of a real record, which is the worse failure. Those rows keep today's link-or-skip
  behaviour.

The option is unavailable (and the row falls back to skip) when the row's club is
unresolved.

## Promotion on debut

A new pure function `reconcileFantasyOnly(data)` runs at the end of `applyDecoded`
(`consoleImport.js`), after a SofaScore batch has been folded in. That is the exact
moment a real player record first appears, so the ghost is retired in the same update
that creates its replacement and a duplicate row is never visible. Running it on the
fantasy-import side instead would leave the duplicate standing until the next price
capture.

For each `fantasyOnly` player, find real (non-`fantasyOnly`) players on the same
`teamId` whose normalized name matches exactly, or whose `surnameInitialKey` matches.
That helper already exists in `pasteImport.js` and maps both "Danny Mandroiu" and
"D. Mandroiu" to `"d mandroiu"`, so no new matching code is written.

- **Exactly one candidate** — merge and retire the ghost:
  - copy user-owned fields onto the real record: `starred`, `inSquad`, `flags`,
    `customName`, `pasteAlias`, `realPosition`, and `gamePosition`: a manual position
    always wins, otherwise the ghost's captured position fills a gap so a freshly
    debuted player is not left positionless (and flagged ❗) until the next capture;
  - carry `price`, `priceUpdatedAt` and `sitePoints` across only where the real record
    has none, so a fresher SofaScore-side value is never clobbered;
  - rekey every `data.absences` entry from the ghost id to the real id;
  - delete the ghost.
- **Two or more candidates** — leave the ghost alone. The capture row then appears in
  the manual link list, where the user resolves it. Never guess.
- **None** — leave the ghost alone; the player still has not played.

## Rendering

**Players tab.** Dimmed row with 💤 before the name, `title="hasn't played yet"`.
They appear by default — the whole point is that looking for Mandroiu finds him.

Two consequences accepted deliberately:

- They carry a `gamePosition` from the capture, so `playerTotals` returns `points: 0`
  rather than `null`. They sit among the genuine zero-scorers rather than sinking to
  the bottom of a points sort. That is accurate: they are on zero.
- `playerClimb` must return `null` for a player with no appearances instead of a
  negative number. A `±` of `−2.3` reads as a decline; the player simply is not there.

**Teams tab: included** (revised 2026-08-27 at the user's request; originally excluded
on the grounds that the grid answers "who played in which match"). The selected club's
ghosts are seeded into `totals` *after* the appearance loop — so they can never
overwrite a real player's figures — with `points: null`, which makes the existing
"nulls sink" sort rule handle them the same way it handles any other pointless row.
Their per-match cells fall through to the existing no-appearance branch, so they stay
absence-markable: you can still record *why* a player hasn't featured.

**Player Detail: unchanged.** It already handles zero appearances (`apps = []`,
`deriveRealPosition` → `null`), and its absence filter uses `k.endsWith(':' + playerId)`,
which works for a colon-free string id.

**No spurious ❗** — `missingFantasyData(player, apps)` requires `apps.length > 0`.

## Invariants preserved

- Nothing derived is stored. A ghost holds only captured fantasy data plus user-owned
  fields, exactly like every other player record.
- The user-owned / import-owned split holds: a re-import matches the ghost by name and
  club through the existing `matchPlayers` path, so `applyFantasyRows` refreshes its
  `price`, `sitePoints` and non-manual `gamePosition` and never touches stars, squad
  membership, flags, `customName` or a manual position. A ghost's `name` is not
  refreshed — the id is derived from it, so a spelling change on the fantasy site
  yields a new ghost rather than a rename. Accepted: rare, and visible as a duplicate
  rather than a silent loss.
- `leagueTable`, `hotEventIds`, `allMatchTeamPoints` and `teamWindowEventIds` all
  iterate appearances or imported matches, so ghosts cannot move them.
- `teamSitePoints` iterates all players and will count a ghost's `sitePoints` (usually
  0) and its `withData`/`missing` tally. Correct: the official site total includes him.

## Testing

Lib-level, building fixtures through real store operations per the repo conventions:

- id determinism across two imports of the same row; club guard (no `teamId` → no record).
- `reconcileFantasyOnly` merges on exact name and on `surnameInitialKey`; refuses when
  two candidates match; leaves ghosts alone when none match.
- User-owned field carry-over and absence rekeying on merge; price/sitePoints only fill
  gaps.
- Re-import of a ghost updates price and site points without disturbing stars or flags.
- `leagueTable`, `hotEventIds` and `allMatchTeamPoints` unchanged by the presence of ghosts.
- `playerClimb` returns `null` for a zero-appearance player.
- SSR smoke test that the Players tab renders a ghost row.

## Out of scope

- Harvesting unused bench players from SofaScore lineups. It would not have found
  Mandroiu (he has been in no matchday squad) and adds a second ghost provenance.
- Any hand-rolled "add a player" form. The capture is the source of truth for who is
  registered.
