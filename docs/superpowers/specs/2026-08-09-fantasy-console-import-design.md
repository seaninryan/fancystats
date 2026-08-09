# Fantasy LOI console-snippet import — design

**Date:** 2026-08-09
**Status:** approved-for-planning

## Problem

Fantasy game data (prices, game positions, site points) enters the app by copying
the Player Stats table off `fantasyloi.leagueofireland.ie` and pasting it into
Settings. Two real costs:

1. **The position dropdown is manual state.** The paste UI has five modes (price,
   GK, DEF, MID, FWD) and the user must set the site's `Position` dropdown to match
   the mode selected in the app. Get it wrong and every player in the paste is
   assigned the wrong position.
2. **Squad players are missing.** The copy was being taken from the *Transfers*
   page, which lists transfer *options* — it excludes the players already in the
   user's team. Those 15 players' prices and positions had to be typed in by hand.

## Investigation — confirmed, not assumed

A `fetch`/`XHR` probe run on the Player Stats page captured **nothing**: the site is
not a SPA. Search is a plain form POST that re-renders the whole page server-side.
The returned HTML (captured in full) shows:

- **ASP.NET Core MVC**, `POST /Stats/PlayerStats`, `Content-Type:
  application/x-www-form-urlencoded`.
- Three form fields — `Statistic`, `Club`, `Position` — plus a hidden
  `__RequestVerificationToken` (antiforgery) present in the page's own form.
- `Statistic` options: `Total Score`, `Goals Scored`, `Assists`, `Clean Sheets`,
  `Yellow Cards`, `Red Cards`, `Value`, `Selected By %`.
- `Club` options: `All` plus ten `<option value="<id>">Club Name</option>` pairs
  (e.g. `14420` → `Bohemians`, `55386` → `St Patricks Athletic`).
- `Position` options: `All`, `Goalkeeper`, `Defender`, `Midfielder`, `Forward`
  (labelled GK/DEF/MID/FWD in the UI).
- Results render as `<table class="table mt-5">` with `<th>` = `Club`, `Name`,
  `<statistic>`; each `<tr>` is club crest `<img>`, name, value.

**Player Stats is league-wide** — it is not the transfer-options list, so it already
contains the user's own squad. Verified by replaying the POST for one club
(`Club=14420`, `Statistic=Value`, `Position=All`): 24 rows — Bohemians' full squad,
including three players the user currently owns. Problem 2 is solved by changing
*which page* the data comes from; no team-sheet scraping is required.

**`Statistic=Value` is the fantasy price.** Verified by the same replay: the third
`<th>` reads `Value` and cells are bare decimals — `9.4`, and `9` for whole numbers.
No currency symbol, no thousands separator. `parseFloat` on the cell text is
sufficient. Crest `src` came back as a stable path (`/Images/Crests/PremierDivision/
Bohemians.png`), confirming it works as the pass A ↔ pass B join key.

The third column **is** the statistic, so a single request can return price or score
but never both — this is what forces the two-pass design below.

Because the token and cookies live in the user's logged-in tab, this must run
in-page, exactly like the SofaScore snippet.

## Capture strategy — 14 POSTs

The snippet reads the antiforgery token and the club `<option>` list out of the live
page's own form, then issues:

- **Pass A — 10 requests**, one per club: `Statistic=Value, Club=<id>, Position=All`.
  Yields name + price for every player at that club. **Club is exact** — it is the
  query parameter, not something parsed out of the page. Side effect: records which
  crest-image URL appears for that club, building a crest → clubId map for free.
- **Pass B — 4 requests**, one per position: `Statistic=Total Score, Club=All,
  Position=<Goalkeeper|Defender|Midfielder|Forward>`. Yields name + site points, with
  **position exact** (the query parameter) and club resolved from the crest map
  built in pass A.

Merged on `name + clubId` as a **union**: a player present in only one pass still
produces a row, with the other pass's field left `null`. If a pass B row's crest is
absent from the map (a club whose pass A list was empty, or a crest change mid-run),
its `clubId` is `null` and the row imports name-only — never silently attached to the
wrong club.

Result: one row per player carrying position, price and site points, with nothing
depending on dropdown state the user has to remember.

Requests are ~300ms apart, matching the politeness pattern of the SofaScore snippet.

Alternatives rejected: 4 POSTs using only `Club=All` (no exact club, forces
crest-name guessing); 80 POSTs over the full club × position × statistic grid
(exact but needlessly slow).

## Architecture — mirror `consoleImport.js`

Vitest runs in a **node** environment with no jsdom, so no HTML parsing may live in
app code. The split follows the SofaScore feature:

- **In-page (snippet):** fetch, `DOMParser`, table → row extraction, merge. Emits an
  already-structured blob. Not unit-tested beyond interpolation asserts; verified
  manually after deploy.
- **In-app (pure, tested):** blob validation, club mapping, name matching, store
  mutation.

### Blob format

```json
{
  "meta": { "source": "fantasyloi", "capturedAt": 1770000000000,
            "clubs": [{ "id": "14420", "name": "Bohemians" }] },
  "players": [{ "name": "Colm Whelan", "clubId": "14420",
                "position": "FWD", "price": 6.5, "sitePoints": 137 }]
}
```

`position` is normalized to the app's `GK|DEF|MID|FWD` inside the snippet. `price`
and `sitePoints` are numbers or `null`. Cell values are bare decimals (verified);
the parser still takes the first float found, so a later currency prefix would not
break it.

### New units

**`src/lib/fantasyImport.js`**

- `buildFantasySnippet()` → string. Takes no parameters — the token, the club list
  and the position list all come from the live page, so nothing needs interpolating
  from app state. Snapshot-tested plus asserts that the endpoint, the two statistic
  names and the position set are present.
- `parseFantasyBlob(text)` → `{ clubs, players }` or throws a user-facing message.
  Validates `meta.source === "fantasyloi"`, non-empty `players`, and that each row
  has a name.
- `mapClubs(blobClubs, teams, overrides)` → `{ [fantasyClubId]: teamId | null }`.
  Auto-resolves by comparing `normalizeName(club.name)` against
  `normalizeName(team.name)` — this handles the punctuation drift between
  `"St Patricks Athletic"` and SofaScore's `"St. Patrick's Athletic"`. `overrides`
  (from `data.meta.fantasyClubMap`) wins over auto-resolution. Unresolved clubs map
  to `null`.

**`src/lib/pasteImport.js` — extended, not forked**

`matchPlayers(rows, players, opts)` gains an optional per-row team constraint: when a
row carries a resolved `teamId`, only players on that team are candidates. This kills
wrong matches between same-named players at different clubs. A row whose club is
unresolved falls back to today's name-only behaviour, so the existing paste path is
unaffected. `suggestLinks` is likewise team-aware when a teamId is supplied.

**`src/lib/store.js`**

`applyFantasyRows(data, matched, now)` — `structuredClone`, sets per player:
`price` + `priceUpdatedAt`, `sitePoints`, and `gamePosition` +
`gamePositionSource = "fantasy"` only when `gamePositionSource !== "manual"`; plus
`pasteAlias` for manually linked rows. Nothing derived is stored. User-owned fields
(manual positions, stars, flags, `inSquad`) are untouched.

`data.meta.fantasyClubMap` is a new **user-owned** field: `{fantasyClubId: teamId}`,
written only by the club-mapping UI, never by an import.

### Components

- **`src/components/FantasyImport.jsx`** — card in Settings, above the existing paste
  card. Copy-snippet button → paste textarea → Parse → preview (`N matched ·
  M unmatched`, each unmatched row labelled with its club) → Apply. Any club that
  `mapClubs` could not resolve gets a select to bind it to a SofaScore team, written
  through `update` to `meta.fantasyClubMap`.
- **`src/components/UnmatchedLinks.jsx`** — the unmatched-row linking list
  (`suggestLinks` dropdown with Suggested / All players optgroups) extracted from
  `SettingsTab.jsx` and shared by both import cards. Behaviour unchanged; extraction
  exists only to avoid duplicating ~25 lines of JSX.

The existing paste card **stays** as a fallback if the site's markup changes.

## Data flow

1. User opens a logged-in `fantasyloi.leagueofireland.ie` tab → DevTools console →
   pastes the snippet (typing `allow pasting` if prompted).
2. Snippet reads token + clubs from the page form, runs pass A then pass B, merges,
   stashes the JSON on `window.fancystatsFantasyBlob` and attempts
   `navigator.clipboard.writeText`. (As with the SofaScore snippet, DevTools `copy()`
   is out of scope inside an async IIFE after an `await`, and `navigator.clipboard`
   rejects when focus is in DevTools — hence the window stash plus a logged
   `copy(fancystatsFantasyBlob)` fallback instruction.)
3. User pastes into the panel → Parse. The app runs `parseFantasyBlob` → `mapClubs`
   → `matchPlayers` with team constraints, and shows the preview.
4. Apply → `update((d) => applyFantasyRows(d, rows, now))`, persisted by the single
   existing effect.

## Error handling

**Snippet**
- Not on the fantasy domain → stop, log which tab to run it in.
- No form / no `__RequestVerificationToken` → "log in first, then re-run".
- A POST that returns the sign-in page or a non-200 → stop, log, and **do not** emit
  a partial blob (a half-captured import is worse than none).

**App**
- Unparseable JSON or wrong `meta.source` → banner, nothing applied.
- Empty `players` → banner, nothing applied.
- Unresolved clubs → non-blocking: those rows still import, matched by name only,
  and the panel offers the mapping select.

## Testing

- `test/fantasyImport.test.js` — `buildFantasySnippet` interpolation/snapshot;
  `parseFantasyBlob` happy path + each malformed case; `mapClubs` auto-resolution
  including the St Pat's punctuation case, override precedence, and the unresolved
  case; `applyFantasyRows` built through real store operations (`applyImport` →
  `applyFantasyRows`), asserting manual positions survive and nothing derived is
  written.
- `test/pasteImport.test.js` — added cases for team-constrained matching: two
  same-named players on different clubs resolve correctly; unresolved club keeps the
  old name-only behaviour.
- `test/fantasyImport.test.jsx` — SSR smoke render of `FantasyImport` and
  `UnmatchedLinks`.
- Manual after deploy: run the snippet, confirm the player count matches the site,
  spot-check three prices and one squad player that the old transfers copy missed.

## Out of scope (YAGNI)

- The other `Statistic` options (Goals Scored, Assists, Clean Sheets, Yellow/Red
  Cards, Selected By %) — the app derives these from SofaScore.
- Auto-setting `inSquad` from the team sheet.
- Mobile: the snippet needs a desktop DevTools console. Viewing is unaffected.
- Removing the legacy paste card.

## Limitations

- Scraping server-rendered HTML is inherently coupled to the site's markup. If the
  table structure changes, the snippet breaks and the legacy paste card is the
  fallback. The parser targets `table` → `tbody tr` → three cells, which is about as
  loose as it can be while still being correct.
- Requires being logged in on the fantasy site in the same browser.
