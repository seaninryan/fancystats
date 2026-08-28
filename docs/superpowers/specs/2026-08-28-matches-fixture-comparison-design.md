# Matches tab — team links + fixture comparison

Date: 2026-08-28

## Goal

Make the Matches tab useful for planning, not just for auditing imports:

1. Team names on a fixture row link through to that club on the Teams tab.
2. Upcoming fixtures show a quick side-by-side stat comparison (table position,
   league points, 3- and 5-game form position, team fantasy points).
3. A graded "favourable fixture" tag marks the side the numbers favour.

Nothing is stored. Every number recomputes at render time from `matches` +
`appearances` + `adjustments`, so an adjustment or a round override retroactively
fixes the comparison too.

## 1. Team links

Both team pills on every fixture row (upcoming or played) become clickable, with
the same dotted-underline affordance the player links use elsewhere. Clicking
switches to the Teams tab with that club selected.

Mechanics:

- `App.jsx` holds `focusTeam` state: `{ teamId, nonce }` (nonce = a counter, so
  clicking the same club twice still re-focuses).
- `MatchesTab` receives `openTeam(teamId)`; it sets `focusTeam` and switches tab.
- `TeamsTab` receives `focusTeam` and adopts `focusTeam.teamId` in an effect keyed
  on the nonce. The user's own dropdown selection is never overwritten otherwise.
- Team ids are numbers in records and strings as keys — `openTeam` passes
  `String(teamId)` because `TeamsTab` compares stringified ids throughout.

## 2. Per-side stat chips

Shown only on **upcoming** fixtures: `m.status !== "finished"` and the match is
not postponed/canceled (reuse the existing `gone(m)` helper). Played fixtures
keep today's row exactly as it is — the result already tells the story.

Layout: four chips per side — the home group directly after the home team pill,
the away group directly before the away team pill, so each group reads next to
its own club. On narrow screens the groups wrap onto their own lines (the row is
already `.row` with `flex-wrap`).

| Chip | Value | Tooltip |
|---|---|---|
| `4th` | league table position | `league position 4th of 10 — 5 places better than BOH` |
| `38` | league points | `2.11 pts/game — +0.90/game vs BOH; 38 pts from 18 games` |
| `F 2/2` | last-3 / last-5 form-table positions | `form: 2nd over last 3, 2nd over last 5 (BOH 8th / 7th)` |
| `612F` | team fantasy points | `612 fantasy pts (34.0/game) — +7.3/game vs BOH` |

Both the points and the fantasy tooltip lead with the **per-game** delta, because
per-game is what the tag scored: with unequal games played a total-points delta
can point the opposite way to the chip's own tint, and a tooltip that argues with
its own chip colour is worse than no tooltip. The totals stay as the chip labels
and as trailing detail in the tooltip. The position tooltip words its comparison
from the *scored* (tie-aware) ranks for the same reason, saying "level on the
table's tiebreakers" where the displayed dense positions differ but the scored gap
is zero.

The tint direction is never re-derived in the component: `compareFixture` returns
a per-metric `lead` (+1 leads / -1 trails / 0 level or no data) computed from the
same gaps the score uses, and the component only maps it to a class.

Each chip is tinted for the leading side and dimmed for the trailing side, so the
direction reads at a glance; exact deltas live in the tooltip. Equal values are
neutral (neither tinted nor dimmed).

If **either** side has no imported matches, the whole comparison is omitted for
that fixture (no chips, no tag) — there is nothing to compare.

## 3. Favourable-fixture tag

Weighted, graded, and explainable. For a fixture, from the perspective of one
side, each metric becomes a signed gap, range-normalised against the league's own
spread for that metric and clamped to ±1:

- **table position** — weight 0.20. Gap = `oppPos - myPos`, normalised by
  `teamCount - 1`. Weight 0.20 rather than 0.30 because league position ranks on
  *total* points: a club with games in hand sits artificially low, and at 0.30
  the position and form components together outvoted the two per-game metrics
  badly enough to score the genuinely stronger side negative (6 pts from 2 games
  hosting 8 pts from 4). Form is not affected — inside a last-3/last-5 window
  clubs have played the same number of games by construction.
- **league points per game** — weight 0.30.
- **form** — weight 0.30. Mean of the last-3 and last-5 position gaps, each
  normalised by `teamCount - 1` over that window's table.
- **fantasy points per game** — weight 0.20.

Per-game normalisation throughout, so a team with a game in hand is not
mis-rated. Range normalisation for the two per-game metrics: divide the gap by
`max - min` of that metric across the league table; when the spread is 0 the
component is 0.

Each window's `teamCount` comes from that window's own table.

**A club in the all-time table can be missing from a form table.**
`teamWindowEventIds` filters only on `m.importedAt && m.goalTimes`, but
`leagueTable` additionally skips matches with a null score — and
`normalize()` writes `homeScore: null` for an imported-but-unplayed event. So a
club whose last N imported matches are all null-scored drops out of
`leagueTable(data, N)` while staying in the all-time table. A missing form rank
is therefore `null`, not an error: the form component contributes 0 (the same
"no signal" rule as a zero spread) and the form chip renders `F —/—`. Never
subtract an absent rank — that was the NaN that silently suppressed the whole
tag.

**Two rankings, two jobs.** The *displayed* position is the dense table index
(`i + 1`) — identical to what the Table tab renders, so the two tabs can never
contradict each other. The *scored* gap uses shared ranks: clubs that
`leagueTable`'s own ordering cannot separate count as level, so a fixture between
genuinely level clubs reads as a zero gap instead of an arbitrary one place. That
ordering lives in exactly one place — `leagueOrder` exported from `store.js`,
which `leagueTable` sorts with and `fixtures.js` tests for equality. Never
restate the tiebreakers.

**Fantasy coverage is not a signal.** `leagueTable` only accrues fantasy points
for players with a `gamePosition` set, so a club whose squad has no positions
yet reads as the league's worst on a metric carrying weight 0.20 — a data gap
dressed up as form. When either club's fantasy total is 0, the fantasy component
contributes 0 and both fantasy chips render neutral, tooltipped as missing data.

`score` = the weighted sum ∈ [−1, 1] from the home side's perspective. The
favoured side is the positive one. Grades on `|score|`:

| Threshold | Grade | Tag |
|---|---|---|
| ≥ 0.45 | `mismatch` | 🎯🎯🎯 |
| ≥ 0.28 | `strong` | 🎯🎯 |
| ≥ 0.14 | `slight` | 🎯 |
| below | none | — |

The tag renders beside the favoured club's chip group. Its tooltip spells out the
breakdown, e.g. `favourable for SHE (strong): position +5, points +0.9/game,
form +5.5, fantasy +7.3/game`.

🎯 rather than ⭐ deliberately: ⭐ already means "watchlist" on Players and Teams.

No home-advantage term. We have no data to calibrate one, and an untested
constant would quietly distort every tag.

## 4. Code layout

New pure module `src/lib/fixtures.js`:

- `fixtureContext(data)` — builds the three league tables (`leagueTable(data)`,
  `leagueTable(data, 3)`, `leagueTable(data, 5)`) once, plus position maps,
  per-game values and the normalisation spreads.
- `compareFixture(ctx, match)` — returns
  `{ home, away, favoured: { teamId, score, grade, reasons } | null }`, or `null`
  when either side has no imported matches. Each side carries
  `{ teamId, pos, teamCount, points, played, ppg, form3, form5, fantasy, fpg }`.

`MatchesTab` memoizes `fixtureContext(data)` on `data` and calls `compareFixture`
per upcoming fixture. No derivation logic in the component — it only renders.

CSS: reuse `.chip`; add a small `.cmp` group class plus `.cmp-up` / `.cmp-down`
tints in `src/styles.css`.

## 5. Testing

- `test/fixtures.test.js` — new. Fixtures built through real store operations
  (`applyImport`), per project convention. Covers: both-sides-have-data happy
  path; position/points/form/fantasy gaps each moving the score in the right
  direction, **isolated one at a time** (a fixture where all four move together
  proves nothing about any of them); the exact grade and tag at each threshold,
  plus the just-below-`0.14` boundary returning `favoured: null`; `null` when a
  side has no imported matches; zero spread not producing NaN; adjustments
  flowing into the fantasy component; a club missing from a form table (imported
  match with a null score) scoring without NaN; clubs with unequal games played;
  and a fixture set where the last-3 and last-5 windows genuinely differ — with
  every club on exactly N matches the three tables are identical and most of the
  module is untested.

  Assertions must pin values, not shapes. `toBeGreaterThan(0)` on a 1-based rank,
  `toBeGreaterThanOrEqual(0)` on a `max - min` spread, and
  `typeof x === "number"` (which passes on NaN) cannot fail for the right reason.
- `test/matchesTab.test.jsx` — new SSR smoke test via `renderToStaticMarkup`:
  an upcoming fixture renders chips and a tag, a played fixture does not, and
  team pills render as links.
- `npm run build` to catch JSX errors the tests cannot.

## Out of scope

- As-of-kickoff standings for played fixtures (current standings only, and only
  on upcoming rows).
- Home advantage weighting.
- Squad-relative favourability ("good fixture for players I own").
