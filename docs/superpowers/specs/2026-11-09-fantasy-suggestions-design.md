# Fantasy suggestions: weak squad players, buy targets, fixture runs

**Date:** 2026-11-09 · **Status:** approved design · builds on `2026-11-09-fantasy-site-sync-design.md`
and the fixture comparison in `src/lib/fixtures.js`

## Goal

A Suggestions panel on the My Team tab with three ranked lists: the weakest players in the
user's squad, the best players to bring in, and the clubs with the easiest next fixtures.

Decisions (user): ranked lists only (no sell→buy pairing; the bank balance isn't captured);
one outlook score from form + fixtures; a section on My Team, not a new tab.
Out of scope: budget/club-limit checks, swap pairs, price-value ranking, new sync data.

## Outlook (one number per player)

- **Form** = fantasy points per TEAM match over the player's club's last `FORM_WINDOW = 5`
  imported matches (`teamWindowEventIds(view, 5)`), points via `playerTotals(..., { eventIds })`
  (so site points win, as everywhere). Missed matches count as 0 — the `playerClimb` rule.
- **Upcoming fixtures** of a club: matches with `!importedAt`, `status !== "finished"`, not
  postponed/canceled, sorted by kickoff; the first `FIXTURE_COUNT = 3`.
- **Ease** of one fixture = `compareFixture(ctx, m).score` from the club's side (home: score;
  away: −score), in [−1, 1]; 0 when the comparison is null. The 🎯 tag is shown when the
  comparison's `favoured.teamId` is the club.
- **Fixtures** = mean ease of the upcoming fixtures; 0 when there are none.
- **Outlook** = `form + |form| × FIXTURE_WEIGHT × fixtures`, `FIXTURE_WEIGHT = 0.5` (equal to
  `form × (1 + ½ × fixtures)` for non-negative form; the `|form|` keeps an easy run from
  making a negative form worse).
- **Out** = `activeFlag(player, now) || playerOutNow(view, playerId, now)`.
- **Hot** = `isHot(view, playerId, apps)`.

With no upcoming fixtures (season over) the outlook is form alone; the panel says so.

## Lib — `src/lib/suggestions.js` (season views; nothing stored)

- `suggestionContext(view, now)` → `{ view, now, windows, upcoming: Map<teamId:number, fixture[]>,
  apps: appearancesByPlayer(view), anyUpcoming }`. Builds `fixtureContext` once.
  fixture = `{ eventId, round, kickoff, opponentId, home, ease, tag }` (`tag` null unless the
  club is favoured).
- `playerOutlook(sctx, playerId)` → `{ playerId, name, position, teamId, price, form, games,
  points, fixtures, ease, score, hot, out }` or null without a `gamePosition` or `teamId`.
- `mySquad(view)` → entries (XI then bench, `teamLines` shape) of the latest captured
  gameweek, or `[]`.
- `sellCandidates(sctx)` → `[{ entry, outlook }]` for the squad: out players first, then
  outlook ascending; entries with no outlook (unlinked / no position) last.
- `buyTargets(sctx, { position = null, limit = 5 })` → outlooks of players not in the squad,
  with a position, `games > 0`, not out; optional position filter; outlook descending; top
  `limit`.
- `fixtureRuns(sctx)` → `[{ teamId, name, fixtures, ease }]` for clubs with upcoming
  fixtures, ease descending.

## UI — `src/components/SuggestionsPanel.jsx`, rendered at the bottom of My Team

- Heading "Suggestions"; when `!anyUpcoming`: dim note "No upcoming fixtures — outlook is
  form only."
- **Weakest in your squad**: table Player (click → `openPlayer`), Pos, Price, Form, Next,
  Outlook; ⛔ when out; the first 3 rows highlighted (`row-me` style class `weak`).
- **Buy targets**: All/GK/DEF/MID/FWD chips; table Player, Club, Pos, Price, Form, Next,
  Outlook; 🔥 when hot.
- **Best fixture runs** (only when `anyUpcoming`): Club, next fixtures, ease.
- "Next" cell: per fixture `OPP(h|a)` plus its 🎯 tag. Outlook cell tooltip:
  `form 6.2/game (31 pts in 5) · fixtures +0.32 → outlook 7.2`.
- Panel hidden when there's no captured squad (My Team already shows its empty state).

## Testing

Lib (fixtures through `applyImport` / `applySiteSync` / `markOut` + `seasonView`): form over
the window with a missed match as 0; ease sign home vs away and mean over the next 3;
outlook formula incl. no fixtures; out-first sell order; buy targets exclude squad/out/no
games, filter by position, limit; fixture runs order. SSR smoke: panel populated (names,
"Suggestions", form-only note) and absent without a squad.

## Addendum (2026-11-10): swap pairs — approved

The bank balance only appears on the site while transfers are open: it is the last argument
of the `replacePlayer(…, currentBalance)` buttons on `/Team/Transfers`. With the season over
there are none, so for now the user types it in. Sync capture is deferred to 2027.

- **Bank**: `data.meta.fantasyBank` (€m, number, default 0). User-owned; set through
  `setFantasyBank(data, value)` in store.js; syncs never touch it. A "Bank €__m" number input
  on the panel, disabled for read-only past seasons.
- **`CLUB_LIMIT = 3`** (user-confirmed) in suggestions.js.
- **`swapPairs(sctx, { bank = 0, sellCount = 5 })`**: for each of the first `sellCount`
  `sellCandidates` that have an outlook and a price, the best-outlook player who is not in the
  squad, same `position`, `games > 0`, not out, priced and `price <= sell.price + bank`
  (1e-9 tolerance), and whose club would hold at most `CLUB_LIMIT` squad players after the swap
  (selling frees the seller's club slot; squad counts use squad entries' players' `teamId`).
  → `[{ sell, buy, gain, bankAfter }]` with `gain = buy.score − sell.score > 0`, `bankAfter =
  sell.price + bank − buy.price`, sorted by gain descending. A seller with no improving
  replacement yields no row.
- **UI**: a "Swaps" card after "Weakest in your squad": bank input, then rows "Sell A (POS
  €p, outlook) → buy B (CLUB €p, outlook) · +gain · bank €x"; empty state "No improving swap
  within budget." Names open the player.
- Out of scope: points hits, double transfers, chips.
