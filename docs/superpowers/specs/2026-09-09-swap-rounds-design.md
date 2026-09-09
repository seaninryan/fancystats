# Swap whole rounds on the Matches tab

## Why

SofaScore keeps a postponed fixture's original round number. When a *whole* round is
postponed and replayed later, its number no longer matches the order the games are
played in — and fancystats numbers gameweeks straight from `roundInfo.round`
(`sofascore.js`), so the tab shows the two rounds the wrong way round.

Observed case (tournament 192 / season 87682, September 2026):

| SofaScore round | Fixtures | Played |
| --- | --- | --- |
| 30 | Dundalk–Pats, Shels–Drogheda, Sligo–Galway, Waterford–Derry | postponed from Fri 4 Sep → **Mon 14 Sep** (new event ids) |
| 30 | Shamrock Rovers–Bohs | postponed from Fri 4 Sep → **Mon 12 Oct** |
| 31 | Drogheda–Sligo, Galway–Bohs, Shels–Derry, Waterford–Dundalk, Pats–Rovers | **Fri 11 Sep** |
| 32 | … | Fri 18 Sep |

Round 30 is now played after round 31, so the fantasy gameweeks and SofaScore's
numbering disagree for exactly that pair.

`roundSuspects` cannot catch this: it looks for a single match sitting inside another
round's date cluster, and here both clusters are internally consistent. The existing
remedy is the per-match round selector — ten dropdown changes to swap two rounds.

## Decision

Keep `matchRound(m) = roundOverride ?? round` and SofaScore's numbering as the
default. Add a **manual whole-round swap**: one click writes the overrides for every
match in both rounds. The user decides when the numbering is wrong; the app never
renumbers on its own.

## `swapRounds(data, a, b)` — `src/lib/store.js`

Pure, like every other mutator: one `structuredClone`, returns new data.

- Every match with `matchRound(m) === a` takes round `b`; every match with
  `matchRound(m) === b` takes round `a`.
- Applies `setMatchRound`'s rule rather than writing `roundOverride` directly: the
  override is **deleted** when the new round equals the match's natural `round`. So a
  swap and a swap back leave no `roundOverride` behind — the save stays clean and a
  later event re-sync can still correct the round from SofaScore.
- Superseded postponed shells (`isSupersededPostponed`) are left untouched. They are
  invisible to every screen and every stat, and `isSupersededPostponed` pairs on the
  natural `round`, so overriding the live event never breaks the sibling match.
- A genuinely postponed match with no replacement **does** move with its round: it is
  on screen under that round.
- No-ops returning `data` unchanged: `a === b`, either round `null`, or neither round
  has any match.

## The control

Each round section header on the Matches tab gains one small button per **adjacent
section in the rendered list** — the neighbouring round as displayed, so a gap (a
round number with no matches) never strands a round without a partner.

```
Round 31  — Fri 11 Sep   [⇅R32] [⇅R30]
Round 30  — Mon 14 Sep   [⇅R32] [⇅R29]     ← after the swap, R30 is the 11 Sep set
```

- `title` carries the whole sentence: `swap Round 30 with Round 31 — moves all 5
  matches in each`.
- Mutual on both sides, like the mirrored delta chips: either header fixes the pair,
  and either header undoes it.
- The `Round ?` group (matches with no round at all) gets no buttons.
- Click handler: `update((d) => swapRounds(d, round, neighbour))`.

Nothing else changes. `currentRound` is already "earliest round that still has
something to do", so after a swap it lands on the 11 Sep fixtures by itself, and the
graphs' x-axis follows `matchRound` — both correct themselves for free.

## Tests

Lib tests build fixtures through real store operations (`upsertMatchStubs`,
`applyImport`, `setMatchRound`), never hand-rolled objects:

1. Both rounds' matches move — every match's `matchRound` is the other round.
2. Swap, then swap back: **zero** `roundOverride` keys remain. Asserted on the field,
   not on `matchRound`, so an implementation that writes redundant overrides fails.
3. A match already carrying an override swaps on its **effective** round, not its
   natural one.
4. Superseded postponed shells keep their round and gain no override.
5. A visible postponed match (no replacement) moves with its round.
6. No-op guards: same round, `null` round, unknown round — identity-equal `data`.

Plus an SSR smoke test (`renderToStaticMarkup`) that the Matches tab renders the swap
buttons for the right neighbour numbers and none for the no-round group.
