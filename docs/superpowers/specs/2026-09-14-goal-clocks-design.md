# Matches tab — goal clocks (minutes since last scored / conceded)

Date: 2026-09-14

## Goal

Add a fifth comparison chip to every upcoming fixture on the Matches tab: how
long each club has gone without scoring, and how long without conceding, both
measured in **match minutes**, both mirrored as a signed delta like the four
chips already there. A drastic divergence is highlighted, and the pair feeds the
🎯 favourable-fixture score.

Extends `docs/superpowers/specs/2026-08-28-matches-fixture-comparison-design.md`
— read that first. Every rule it sets (mirrored delta chips, tint from lib's
`lead`, nothing stored, per-render derivation) holds here unchanged.

Nothing is stored. The clocks recompute at render time from `matches`, so an
adjustment or a round override still retroactively fixes the comparison.

## 1. The clock

New export in `src/lib/store.js`, sibling to `teamWindowEventIds`:

```js
teamGoalClocks(data, n = 5) -> Map<teamId, {
  scored, conceded,        // minutes since the last goal for / against
  scoredOpen, concededOpen,// true when no such goal falls inside the window
  span,                    // minutes of evidence: 90 * matches in the window
  matches,                 // matches in the window
}>
```

### Which matches count

The club's last `n` matches that are **imported and scored**:

```js
m.importedAt && m.goalTimes && m.homeScore != null && m.awayScore != null
```

— the same filter `leagueTable` applies, for the same reason. `normalize()`
writes `homeScore: null` for an imported-but-unplayed event, and such an event
carries an empty `goalTimes`; counting it would donate 90 phantom goalless
minutes to both clubs and read as a clean sheet nobody kept.

**This filter is applied before taking the last `n`, and that is deliberate —
do not "fix" it into agreement with `teamWindowEventIds`.** That helper windows
on imported-only and lets `leagueTable` discard null-scored matches afterwards,
so `leagueTable(data, 5)` can cover fewer than five played games. The clock
wants five matches of actual evidence, so it filters first and takes five of
what survives. The two helpers answer different questions; keep them apart.

Ordering is by `kickoff`, matching `teamImportedMatches`.

### How minutes accumulate

Walk backwards from the most recent match, adding **90 minutes per match**, and
stop at the first goal:

- A goal in the most recent match at minute `t` gives a clock of `90 - t`.
- No goal in that match: add 90, move to the previous one, and a goal there at
  `t` gives `90 + (90 - t)`.

Goal minutes are clamped to `[0, 90]`. SofaScore records stoppage-time goals as
`time + addedTime` (90+4 → 94), and match end is not reliably reported, so a
fixed 90-minute match keeps the ceiling exact at `90n` and every club on the
same scale. A 94' goal reads as `0'` ago, which is what it means.

The clock is anchored to **the end of the last match played**, never to
wall-clock now. A number that drifts every hour cannot be compared between two
clubs whose last fixtures were on different days, and would make the chip change
without the data changing.

### Scored and conceded

`scored` walks the club's own `goalTimes` side (`goalTimes.home` when it is the
home club); `conceded` walks the opponent's. Own goals already land on the
**benefiting** side inside `normalize()` — that is what its "the goal still
counts in goalTimes so team score/clean sheets stay right" comment buys — so
both lists are correct as they stand. Do not re-attribute them here.

### An unresolved clock

No goal anywhere in the window sets `scoredOpen` / `concededOpen` and the value
is the minutes **actually observed** (`span`), not the nominal `90n` ceiling.
A club with two matches in the window has 180 minutes of evidence; reporting 450
would invent three matches of clean sheet that were never played. The UI renders
an open clock with a trailing `+` (`450'+`), and where the two clubs' `span`
differ the tooltip says so — the same honesty `gamesClause` already provides for
the points chip.

A club with no qualifying matches has no entry in the map. `compareFixture`
already returns `null` for the whole fixture when either club is missing from
the league table, so this case never reaches the chip.

## 2. Scoring

`fixtureContext` calls `teamGoalClocks(data, FORM_LONG)` once and stores the map;
never call it per fixture.

Two gaps, from the home side's perspective:

```
scoredGap   = away.scored   - home.scored     // + = home scored more recently
concededGap = home.conceded - away.conceded   // + = home has stayed clean longer
```

Each is normalised against a **fixed** `CAP = 90 * FORM_LONG = 450`, then
clamped to ±1 by the existing `clamp1`:

```
parts.goals = (clamp1(scoredGap / CAP) + clamp1(concededGap / CAP)) / 2
```

A fixed cap, not a league spread. The other per-game metrics divide by the
league's own `max - min` because their natural scale is unknowable; a clock's
scale is known exactly (0 to 450). Spread-normalising it would rescale the whole
league's noise into a full-strength signal in the opening weeks, when every
club's clocks are small and close together. With a fixed cap, small clocks
correctly produce a small component.

`CAP` is derived from `FORM_LONG`, so the window and the denominator can never
drift apart.

### Weights

The two clocks are one component, at 0.10. The other four scale by 0.9:

| Metric | Was | Now |
|---|---|---|
| position | 0.20 | 0.18 |
| points/game | 0.30 | 0.27 |
| form | 0.30 | 0.27 |
| fantasy/game | 0.20 | 0.18 |
| **goal clocks** | — | **0.10** |
| | 1.00 | 1.00 |

0.10 and not more because the clocks correlate hard with points-per-game and
form — a club that has not scored in 450 minutes is already bottom of both. A
larger weight would re-count the same evidence under a new name.

Grade thresholds (`0.45` / `0.28` / `0.14`) are unchanged, so existing tags
barely move.

### Lead and drastic

`lead.goals = sign(dir * parts.goals)`, exactly like every other metric — the
chip's tint is never re-derived in the component.

`drastic` is a **separate boolean**, true when `|scoredGap| >= DRASTIC` or
`|concededGap| >= DRASTIC`, where `DRASTIC = 180` (two matches). It is deliberately
not folded into the tint: a fixture can read `⚽+312 🛡-400`, where the two halves
are drastically apart but the combined lead is level or points the other way,
and there would be no tint to make bold. Keeping the two orthogonal means the
highlight can never contradict the 🎯 tag.

Both sides of a fixture share the same `drastic` value — the gaps are mirrored,
so their magnitudes are equal.

`compareFixture` returns, per side, `{ ...clock, lead: { ..., goals } }` and, at
the top level, `drastic`, `scoredGap`, `concededGap`.

The tag's `reasons` array gains a line: `goals +172'/-132'` — scored gap then
conceded gap, from the favoured club's view, matching the chip face. This line
carries two values, so it does not go through the single-gap `reason()` helper;
give it its own formatter rather than bending `reason()` to take a pair.

## 3. The chip

A fifth chip per side, after `fpts`, inside the existing `.cmp-chips` group:

```
SHE [pts] [🎯][pos +2][pts +6][form +1.5][fpts +88][⚽+172 🛡-132]  2–1  [pos -2][pts -6][form -1.5][fpts -88][⚽-172 🛡+132] [pts] BOH
```

The chip is appended last in `SideChips`, which renders the same chip order for
both sides; only the *values* mirror. (The visual asymmetry — `fpts` innermost on
the home side, outermost on the away side — is the existing layout's, not
something this change introduces.)

Both halves use the existing `deltaLabel`, so they mirror and round the way the
other chips do. The chip carries `leadCls(side.lead.goals)` plus `cmp-hot` when
`drastic`.

`⚽` = the scored gap (`+` = this club scored more recently). `🛡` = the conceded
gap (`+` = this club has gone longer without conceding). Both point the same way:
positive is good for the club the chip sits beside.

### Tooltip

States both raw clocks for both clubs, then the comparison:

> `goal clock: last scored 38' ago, last conceded 312' ago (last 5) v BOH 210' / 180' — scoring 172' more recently and 132' longer unbeaten at the back; both gaps drastic (≥ 180' = two matches)`

Rules:

- An open clock is written `450'+`, and the phrase is "no goal in the last 5",
  never a bare number implying a goal was found.
- When the two clubs' `span` differ, add the clause naming it, e.g.
  `over 5 matches v BOH 3`.
- The drastic clause names **which** halves crossed the threshold: "both gaps
  drastic", "scoring gap drastic", "clean-sheet gap drastic". A highlight the
  reader cannot attribute is noise.
- A zero gap reads "level", not "+0", matching `bothWays`.

### CSS

`src/styles.css`, beside the existing `.cmp-*` rules:

```css
.cmp-chips .chip.cmp-hot { font-weight: 700; box-shadow: inset 0 0 0 1px var(--warn); }
.cmp-chips .chip.cmp-down.cmp-hot { opacity: .8; }
```

`cmp-hot` composes with any tint: `cmp-up cmp-hot`, `cmp-down cmp-hot`, or bare
`cmp-hot`. The `.cmp-down.cmp-hot` rule lifts the dimming so a drastic chip stays
readable on the trailing side — a highlight that is simultaneously faded is not
a highlight.

## 4. Testing

**`test/store.test.js`** — `teamGoalClocks`, fixtures built through `applyImport`
per project convention:

- A goal at 70' in the latest match → `scored: 20`.
- A goalless latest match and a goal at 30' in the one before → `scored: 150`.
- A stoppage-time goal (`time: 90, addedTime: 4` → 94) clamps to `0`, not `-4`.
- `conceded` reads the opponent's list, including when the club is the away side.
- An own goal counts for the side it was credited to, on both clocks.
- No goal in the whole window → `scoredOpen: true` with the value equal to
  `span`, and `span` equal to `90 * matches` — specifically a club with 2
  matches reports `180`, never `450`.
- A null-scored imported match is excluded: it neither contributes 90 minutes
  nor occupies a window slot. A club whose six matches include a null-scored one
  windows the five scored ones.
- Exactly `n` matches are used when more exist.

**`test/fixtures.test.js`** — the score and the chip contract:

- The goals component alone moves the score in the right direction, **isolated**
  — a fixture where the other four metrics are level. A fixture where everything
  moves together proves nothing about this metric.
- `scoredGap` and `concededGap` are tested separately; one pointing each way
  nets to a smaller component than both pointing the same way.
- The cap clamps: a 600' gap and a 450' gap produce the same component.
- `drastic` is true at exactly 180 and false at 179, on either half alone.
- `drastic` is true while `lead.goals` is 0 (the `⚽+312 🛡-400` shape) — the
  orthogonality the design depends on.
- `lead.goals` is mirrored between the two sides, and `drastic` is equal.
- The weights still sum to 1: a fixture maximal on every metric scores exactly
  ±1.
- The grade thresholds still fire at the documented boundaries.

Assertions pin values, not shapes — `toBeGreaterThan(0)` on a clock and
`typeof x === "number"` (which passes on `NaN`) cannot fail for the right reason.

**`test/matchesTab.test.jsx`** — the fifth chip renders on an upcoming fixture,
does not render on a played one, and a drastic fixture emits `cmp-hot`.

**`npm run build`** for JSX errors the tests cannot catch.

## Out of scope

- Real-time decay (a clock that counts up between fixtures).
- Per-player goal clocks, or clocks on the Teams tab.
- Weighting a goal by its game state, opponent, or whether it was a penalty.
- Re-tuning the grade thresholds — the 0.9 rescale keeps them roughly calibrated
  and changing both at once would make either change untestable.
