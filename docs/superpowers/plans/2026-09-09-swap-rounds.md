# Plan — swap whole rounds on the Matches tab

Spec: `docs/superpowers/specs/2026-09-09-swap-rounds-design.md`

Environment first, every command:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## Task 1 — `swapRounds` in `src/lib/store.js` (TDD)

Write `test/store.test.js` cases first, all six from the spec, building fixtures with
`upsertMatchStubs` / `applyImport` / `setMatchRound`. Then implement beside
`setMatchRound`:

```js
export function swapRounds(data, a, b) { … }
```

- One `structuredClone`; return `data` itself for every no-op (same round, null round,
  no matches in either round) so callers can compare by identity.
- Partition on `matchRound(m)` **before** mutating, so the two groups can't see each
  other's new rounds.
- Set the new round through the same rule `setMatchRound` uses — delete
  `roundOverride` when the target equals the match's natural `round`, otherwise set
  it. Factor that rule into a small local helper both functions use; don't duplicate
  the condition.
- Skip matches where `isSupersededPostponed(data, m)` is true.

Verify: `npx vitest run test/store.test.js`.

## Task 2 — swap buttons in `src/components/MatchesTab.jsx`

`rounds` is already sorted newest-first. For each section, its neighbours are
`rounds[i - 1]` and `rounds[i + 1]`; render a button for each neighbour whose `round`
is not `null`, and render none at all when this section's own `round` is `null`.

```jsx
<button className="chip" title={`swap Round ${round} with Round ${n.round} — moves all ${…} matches in each`}
  onClick={() => update((d) => swapRounds(d, round, n.round))}>⇅R{n.round}</button>
```

Match count in the title: `items.length` for this round, `n.items.length` for the
neighbour — say both when they differ (`moves 5 and 4 matches`). Reuse existing CSS
classes; no new stylesheet rules unless the header needs a flex gap.

Add the SSR smoke case to `test/matchesTab.test.jsx` (or the existing Matches SSR
test file): buttons present with the right neighbour labels, absent for the no-round
group.

## Task 3 — ship

- `npm test` (all suites) and `npm run build` — the build catches JSX errors tests
  can't.
- Bump `package.json` version (minor: 0.26.0), then
  `npm install --package-lock-only` to sync the lockfile.
- Commit and push to `main`; GitHub Actions deploys to Pages.
