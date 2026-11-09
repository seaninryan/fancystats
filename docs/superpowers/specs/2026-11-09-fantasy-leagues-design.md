# Fantasy leagues: standings, points race, opponents

**Date:** 2026-11-09 · **Status:** approved design · builds on `2026-11-09-fantasy-site-sync-design.md`

## Goal

Track the user's private mini-leagues from the fantasy site: standings with movement, a
season-long points race, and each opponent's current team compared with the user's.

Decisions (user): private leagues only (club-wide and Overall leagues are too big; their
positions are still shown); every manager's points for every gameweek plus each opponent's
**latest** team only. Out of scope: opponents' past teams, big-league tables, suggestions.

## Site pages (verified against captured HTML)

- Any `/Leagues…` page has a "your leagues" table (`thead`: League | Position, then a link
  `/Leagues?leagueCode=<code>`), a Global Leagues table in a modal (rows with `leagueCode`
  links, no `thead`; includes `Overall` and the club leagues), and, when a league is shown,
  its standings table (`thead`: # | Manager Name | Points; rows link `/Results?teamId=<id>`).
  The league name is the card header `<h2>`. A `select#Period` offers `Overall` and `1`…`36`.
- `/Leagues?leagueCode=<code>&period=<Overall|n>` shows that league for that period.
- `/Results?teamId=<id>&gameweek=<n>` is any manager's team (same markup as the user's). Its
  Team Details modal (`#details`) holds `<label><strong>Key: </strong>value</label>` rows:
  Manager, Team Name, Club Supported, Captain, Unlimited Transfers Used, Full Squad Counts
  Used, Triple Captain Used.

## Capture (Fantasy sync snippet, new step between "your team" and "history")

1. Load `/Leagues`. Collect `yourLeagues: [{ code, name, position, private }]` from the
   your-leagues table; `private` = the code is not in the Global Leagues table.
2. For each private league and each period (`Overall` + every gameweek of the user's team):
   load the standings; rows → `[rank, teamId, manager, points]`. ≈ 3 × 37 pages.
3. For every other manager in those leagues: load their team for the user's latest captured
   gameweek; parse it with the same team parser as the user's team, plus Team Details.
   ≈ 22 pages. Their players' site ids join the history set.
4. The user's own Team Details come from their latest gameweek page.

All-or-nothing as before; a page without the expected table throws. About +1 minute.

Blob (still `version: 1`; new top-level fields are optional so older files load):
```json
{
  "yourLeagues": [{ "code": "nevt9766MD", "name": "Schooligans", "position": 1, "private": true }],
  "leagues": { "nevt9766MD": { "name": "Schooligans",
               "periods": { "Overall": [[1, 7378, "Sean Ryan", 2512]], "35": [[1, 7378, "Sean Ryan", 83]] } } },
  "opponents": { "8128": { "manager": "Billy Scanlan", "gw": 36,
                 "team": { "lines": [], "bench": [], "captain": 1, "shown": {}, "names": {}, "total": 67 },
                 "details": { "Team Name": "…", "Triple Captain Used": "No" } } },
  "me": { "details": { "Team Name": "Monster monster FC" } }
}
```

## Data

`applySiteSync` stores `yourLeagues` (default `[]`), `leagues`, `opponents`, `me` (default
`{}`) in `data.site[seasonId]` alongside the existing fields. Raw facts, replaced per sync.

## Lib

`src/lib/myTeam.js`: extract `teamLines(view, g)` → `{ total, lines, bench }` (the entry
builder already used by `myTeamGameweek`, which now delegates to it).

`src/lib/leagues.js` (season views only):
- `ordinal(n)` → "1st", "2nd", "3rd", "11th"…
- `leaguePositions(view)` → `[{ code, name, position, private }]` (every league, for the My
  Team header).
- `privateLeagues(view)` → `[{ code, name, myRank, size }]` for private leagues with standings.
- `leagueStandings(view, code)` → rows sorted by rank:
  `{ rank, move, teamId, manager, gwPoints, total, gap, isMe, gw }`. `gw` = latest gameweek
  with standings; `gwPoints` = that gameweek's points; `move` = previous rank − rank, where
  previous rank is the competition rank (1 + number of managers strictly ahead) by
  `total − gwPoints`; `gap` = total − the user's total (null when the user isn't in it).
- `leagueRace(view, code)` → `[{ teamId, manager, points: [{ round, value }] }]`, one per
  manager in the Overall table, per gameweek points (null when absent).
- `opponentTeam(view, teamId)` → `{ manager, gw, details, total, lines, bench }` or null.
- `squadComparison(view, teamId)` → `{ shared: Set<siteId>, theirsOnly: Set<siteId>,
  mineOnly: [entry], myCaptain, theirCaptain }` comparing their latest team with the user's
  latest captured gameweek (lines + bench), or null when either is missing.

## UI

- `src/components/TeamLines.jsx`: the lines + bench rendering from MyTeamTab, extracted, with
  an optional `badge(entry)` render prop. MyTeamTab uses it unchanged in appearance.
- **My Team** header: "50th overall · 3rd Galway United · 1st Schooligans" from
  `leaguePositions` (Overall League shown as "overall").
- **Leagues tab** (after My Team): league chips; standings table (#, ±, Manager, GW n, Total,
  Gap) with the user's row highlighted; points-race chart (cumulative on by default) via
  `GameweekChart`; clicking another manager shows their team (TeamLines with a
  shared/differential badge), their captain and chips (Team Details), and "You have, they
  don't". Empty state points to Settings → Fantasy sync.

## Testing

Lib tests through `applySiteSync` + `seasonView`: parse defaults for old files; storage;
`ordinal`; standings incl. movement with ties and gap; race series; opponent team; squad
comparison. SSR smoke: LeaguesTab empty and populated; My Team header. Snippet: text asserts
+ `new Function` validity; controller runs it against captured pages with a mocked fetch.
