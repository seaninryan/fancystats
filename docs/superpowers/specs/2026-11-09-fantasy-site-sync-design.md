# Fantasy site sync: site points per gameweek, My Team

**Date:** 2026-11-09 · **Status:** approved design

## Goal

Bring the fantasy site's own per-gameweek data into the app:

1. **Site points win.** The site's points for each player and gameweek become the fantasy
   points the app uses everywhere: totals, table, charts, 🔥 and the later suggestions.
   Our own scoring only fills gaps, such as matches played since the last capture.
2. **My Team.** Your team for every gameweek (XI, bench order, captain, points), shown in a
   new tab, and 🔵 "in squad" kept in step with the latest gameweek automatically.

Out of scope, for later specs: league standings and opponents' teams (the data model leaves
room), suggestions, and incremental re-fetching.

## Background (validated 2026-11-06)

Comparing every player's 2026 per-gameweek breakdown on the site with our scoring showed our
rules were right except for clean sheets and sent-off starters (fixed in v0.29.1). After that
fix, 97.4% of player-gameweeks match exactly. What's left is data that differs between
SofaScore and the site: about 85 extra assists credited by the site, plus a few penalty saves,
goals, cards and appearances. Rules can't close that gap; only the site's own numbers can.

Site pages, all server-rendered HTML that a logged-in, same-origin `fetch` can read:

| Page | Gives |
|---|---|
| `GET /Stats/PlayerStats` + 14 POSTs (existing snippet) | price, position, season total for **every** player |
| `GET /Team/Transfers` | site player id, name, club crest, price, position, total — but **only players you don't own** (12 of 15 squad players missing) |
| `GET /Results?teamId=<t>&gameweek=<n>` | that team's XI and bench for the GW: per player `onclick="playerScore('<siteId>', '<full name>', '<shown points>')"`; captain marked `(c)` inside the player card; bench is the second `.card.scroll-animate` block, in order; GW total in the `<h2>` "83 Points"; GW options in the change-gameweek `<select>` |
| `GET /ViewPlayer/ViewPlayer?playerId=<siteId>` | every GW: blocks `[id$="+MatchDetails"]`, label "GW n", two crest images, "Total Points: n", rows `Stat / Value / Points` (Appearance, Team Result, Clean Sheet, Goals, Assists, Yellow Cards, Red Cards, Own Goals, Penalty Misses, Penalty Saves). "Didn't Play" GWs are listed too. |

Quirks the import must absorb:
- On ViewPlayer, **crest order is not home/away**, and for a player who changed club one crest
  can be his **current** club, not the one he played for that week. Never trust the crests to
  pick home/away or the player's team.
- A team with no match in a GW has no block for it. A double gameweek has two blocks with the
  same GW number.
- The site occasionally returns HTTP 500; one retry is enough.

## Capture: one "Fantasy sync" snippet

`buildSyncSnippet({ siteTeamId })` in `src/lib/fantasyImport.js` returns the snippet. The
user runs it in a logged-in fantasy-site tab (any page). Steps, about 340 requests, 300ms
apart (~2½ minutes), progress logged:

1. **Prices:** `GET /Stats/PlayerStats` to read the antiforgery token and club list from the
   fetched page (not the live one, so any page works), then the existing 14 POSTs. Reuse the
   existing pass A/pass B code and merge logic unchanged; pass A also builds the crest →
   fantasy club id map.
2. **Ids:** `GET /Team/Transfers`; per row: site id (last cell), name, crest → club id.
3. **My team:** read the GW options from `/Results?teamId=<t>&gameweek=1`, then fetch every
   GW. Per GW: `xi` (11 site ids in page order), `bench` (4, in order), `captain` (site id
   with the `(c)` marker), `shown` (siteId → shown points, captain already multiplied),
   `total`. A GW page with no players is skipped. Squad players' site ids come from here.
4. **History:** union of site ids from steps 2 and 3, then `ViewPlayer` for each. Per block:
   `[gw, clubIdA, clubIdB, total, rows]`, where each row is `[stat, value, points]` and
   clubs are resolved through the crest map (an unknown crest → null).

Joining ids to step 1 rows: by `name + clubId` from Transfers, else by name among the squad
ids from step 3 (unique within a squad). Rows left without an id still import prices as
today; they just get no history.

**Errors:** any page that still fails after one retry, or a page that comes back as the
sign-in page, stops the run with nothing produced (all or nothing, as today). Wrong domain or
not logged in → a clear console message.

**Output:** the snippet **downloads** `fancystats-sync-YYYY-MM-DD.json` (Blob + `<a download>`),
so there's no clipboard step. Blob:

```json
{
  "meta": { "source": "fantasyloi-sync", "version": 1, "capturedAt": 0,
            "siteTeamId": 7378, "clubs": [{ "id": "14420", "name": "Bohemians" }] },
  "players": [{ "name": "", "clubId": "", "position": "MID", "price": 6.5,
                "sitePoints": 36, "siteId": 710952 }],
  "history": { "710952": [[1, "14420", "55388", 2, [["Appearance", "Started", 2]]]] },
  "myTeam": { "35": { "xi": [59089], "bench": [716551], "captain": 213284,
                      "shown": { "59089": 9 }, "total": 83 } }
}
```

## Data model

- **`data.site: { [seasonId]: SiteSeason }`**, import-owned and replaced wholesale on each
  sync of that season. `SiteSeason = { capturedAt, siteTeamId, history, myTeam }`, with
  `history` and `myTeam` stored exactly as in the blob (raw facts, keyed by site ids and GW).
  The sync writes to `data.site[meta.seasonId]`.
- **`player.siteId: number | null`**, a link set when the import matches a site row to our
  player, including manual links made through the unmatched list. It stays on re-imports;
  a later sync only overwrites it with a new match.
- **`meta.siteTeamId: number | null`**, user-owned, entered once in Settings and written into
  the snippet.
- `emptyData()` gains `site: {}`. Older saves need no migration (missing means "never synced").
- `seasonView` projects `site` to the viewed season: `view.site = data.site?.[sid] ?? null`.
  `player.siteId` is identity, shared across seasons like `name`.

Nothing derived is stored. Matching site gameweeks to our matches happens at render time.

## Site points: `src/lib/sitePoints.js`

**`siteIndex(view)`**, memoised per view object with a `WeakMap`, returns:
- `byKey: Map<"eventId:playerId", { total, rows }>`
- `unresolved: [{ playerId, siteId, gw, total, reason }]`, where `reason` is either
  `"no-match"` (no match in round `gw` for the player's team) or `"no-appearance"` (a match
  exists, the site says he played, SofaScore has no appearance).

Resolution, for every player with a `siteId` and every site block:
1. Candidates: imported matches with `matchRound(m) === gw` that involve the player's team.
   The player's team is the `teamId` on his appearances in that round; failing that, any team
   in the block's two clubs that the player has appeared for this season.
2. One candidate → it. Two (double GW) → the one whose two teams both appear in the block's
   clubs; still tied → unresolved.
3. Key `eventId:playerId`. If an appearance exists → `byKey` (a "Didn't Play" block goes in
   with total 0, so the site's "didn't play" wins too). If not: a block where he played →
   `unresolved` (`no-appearance`); a "Didn't Play" block → ignored. A "Didn't Play" block
   with no candidate match is also ignored, never `no-match`.

Because this runs on `matchRound`, correcting a round override (for example GW32 Galway v
Shelbourne) immediately reconnects the site points.

**`appearancePoints(view, app)`** returns `{ total, source, site, ours }`:
- `ours` = `scoreAppearance(app, match, player.gamePosition, adjustment)`, or null when the
  player has no `gamePosition` or the match isn't imported (as today).
- `site` = `siteIndex(view).byKey.get(key)` or null.
- `source = "site"` and `total = site.total` when `site` exists, even without a
  `gamePosition`; else `"ours"` with `ours.total`; else `total: null`.

Every place that computes points switches to `appearancePoints`, so there is one rule:
`playerTotals`, `hotEventIds`, `leagueTable`, `allMatchTeamPoints` (store.js), the fantasy
stat in `series.js`, and the per-match cells in `TeamsTab.jsx` and `PlayerDetail.jsx`.
`scoreAppearance` itself is unchanged.

Adjustments: a user adjustment applies to our scoring only. When a site value exists, the
site wins and the adjustment is shown as overridden in PlayerDetail.

## UI

**Settings, "Fantasy sync" card** (replaces the current fantasy import card; the paste card
stays as a fallback):
- Site team id input → `meta.siteTeamId`. Copy-snippet button, disabled until it's set.
- File input for the downloaded JSON → `parseSyncBlob` → preview:
  - N players matched / M unmatched (unmatched linking reuses `UnmatchedLinks`).
  - GWs of history captured, your team's GWs captured.
  - **Site gameweeks needing attention:** `unresolved` from a trial `siteIndex` on the
    would-be result, grouped by reason, e.g. "GW32: 28 player-gameweeks have no match. Check
    the round of Galway United v Shelbourne".
- Apply → one `update((d) => applySiteSync(d, parsed, matched, now))`.

**`applySiteSync(data, parsed, matched, now)`** in store.js, pure, `structuredClone`:
1. Prices, positions, site totals: the existing `applyFantasyRows` path, plus `siteId` on
   every matched row.
2. `data.site[meta.seasonId] = { capturedAt, siteTeamId, history, myTeam }`.
3. 🔵 sync: `inSquad = true` for our players whose `siteId` is in the latest captured GW's
   `xi` + `bench`; `false` for everyone else.

**Points source marker:** per-match points from our scoring, not the site, render in italics
with `title="our estimate (site not captured yet)"`. PlayerDetail rows that have both and
disagree show `site 8 · ours 5 (assists)`, naming the components that differ, using the
site's stat rows and our breakdown.

**My Team tab** (`src/components/MyTeamTab.jsx`, after Players):
- Shown when `view.site?.myTeam` has GWs; otherwise a note pointing to Settings.
- GW picker defaulting to the latest captured GW.
- XI grouped GK / DEF / MID / FWD (by the player's `gamePosition`), each with shown points;
  captain marked "(c)". Bench below, in order, with points. GW total.
- Season chart of your GW totals (recharts, like the existing charts).
- Player names open PlayerDetail. Site ids with no linked player show the site name, unlinked.
- Read-only in past-season view (no editing controls on this tab anyway).

Derivations for the tab live in lib: `myTeamGameweek(view, gw)` →
`{ gw, total, lines: { GK, DEF, MID, FWD }, bench, captainId }` with entries
`{ siteId, playerId|null, name, points, captain }`, and `myTeamSeries(view)` →
`[{ gw, total }]`.

## Testing

Vitest, fixtures built through real store operations (`applyImport`, `setMatchRound`,
`applySiteSync`…):

- `parseSyncBlob`: happy path; wrong source or version; empty players; history and myTeam
  shapes.
- `buildSyncSnippet`: contains the site team id and the four page paths; throws without a
  team id.
- `siteIndex`: single match; double GW split by clubs; the crest quirk (one club is the
  player's current club); changing `roundOverride` re-points a block; `no-match` and
  `no-appearance` reasons; "Didn't Play" zeroing an appearance.
- `appearancePoints`: site wins; falls back to ours; site works without `gamePosition`;
  adjustment ignored when site exists.
- Derivations: `playerTotals` and `leagueTable` use site points when present.
- `applySiteSync`: writes `site[seasonId]`, sets `siteId`, 🔵 sync, leaves manual positions,
  stars, flags and adjustments alone; `seasonView` projects `site`.
- `myTeamGameweek` / `myTeamSeries`.
- SSR smoke: the sync card, MyTeamTab with and without data, the italic marker.
- Manual after deploy: run a real sync; season totals now equal site totals except the listed
  `no-appearance` cases; GW35 My Team shows 83 with Lonergan (c) 16.

## Limitations

- Site appearances that SofaScore lacks (5 in 2026) are listed, not counted.
- Scraping is coupled to the site's markup; the paste card remains the fallback for prices.
- About 2½ minutes per sync, needing a desktop browser.
