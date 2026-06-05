# fancystats — Design

**Date:** 2026-06-05
**Status:** Approved pending user review
**Phase:** 1 (data pipeline + foundation); phase 2 (analysis) gets its own spec later

## Overview

A personal web app to help with League of Ireland fantasy football (fantasyloi.leagueofireland.ie). It imports match data from SofaScore for the LOI Premier Division, stores normalized per-player stats in the user's Google Drive, and presents them with fantasy-relevant context the official game doesn't offer (form windows, value, position mis-categorisation).

Follows the architecture proven by `~/workspace/sideline`: static site on GitHub Pages, all data private in the user's Google Drive, no server. Borrows SofaScore endpoint knowledge from `~/workspace/settee`.

## Architecture

- **Stack:** Vite + React. Pure-logic modules (`sofascore.js`, `scoring.js`, `drive.js`, `pasteImport.js`) separate from UI components; unit-tested with vitest.
- **Deploy:** push to `main` → GitHub Actions runs tests, builds, deploys to GitHub Pages (`https://seaninryan.github.io/fancystats/`). Deploy is blocked if tests fail. Site works from any device (phone included); the toolchain exists only at dev/CI time.
- **Runtime:** fully client-side.
  - Fetches `api.sofascore.com` directly from the browser — **verified working 2026-06-05** (CORS `access-control-allow-origin: *`; note curl/server-side requests get 403 — browser TLS fingerprint is what passes, so any future automation must stay in-browser).
  - Google Drive `appDataFolder`, single file `fancystats.json`, loaded once at startup, whole-file save (last-write-wins). Auth/token/retry code lifted from sideline (GIS token client, sessionStorage token recall, pre-save refresh, silent reauth, 401-retry-then-banner).
  - Fantasy LOI game data (prices, game positions) enters via manual paste — the fantasyloi site has no JSON API and no CORS headers.
- **Trust model:** public repo, no secrets in code (OAuth client ID is public by design), private data only in the user's Drive.

## External data sources

### SofaScore (automatic)

- Tournament `192` = LOI Premier Division; season `87682` = 2026 (current). Both stored in `meta`, discoverable via `/unique-tournament/192/seasons` when the season rolls over.
- Endpoints:
  - `/unique-tournament/{t}/season/{s}/events/last/{page}` — season event list (paginated)
  - `/event/{id}` — score, round, status, teams
  - `/event/{id}/lineups` — starters/bench, per-match position, minutes; **can 404** (known from settee)
  - `/event/{id}/incidents` — goals (scorer + assister), cards, substitutions with minutes, missed/saved penalties

### Fantasy LOI (paste-in)

- `POST /Stats/PlayerStats` page renders the full player table (name + selected statistic). Filtered to `Statistic=Value` it yields prices; filtered per `Position` it yields game positions (4 pastes, one per position).
- User copies the rendered page/table from their browser and pastes into the app. Parser fuzzy-matches names to SofaScore players; unmatched names resolved manually via a picker; the manual link is remembered.

### Rules sources

- Scoring matrix from https://fantasyloi.leagueofireland.ie/Rules/Rules (captured below; **re-verify against the live page during implementation**).
- FAQ (https://fantasyloi.leagueofireland.ie/FAQ/FAQ) nuances that affect us:
  - Assists are broader than SofaScore's definition (penalty won → assist; rebound after save/block/post → assist; shot causing own goal → assist). Computed assists may undercount → handled by the adjustments overlay.
  - Official data source is Comet; the game's own points can shift mid-gameweek.
  - Captains/chips/auto-subs affect only *team* totals — out of scope until phase 2.

## Data model (`fancystats.json` in Drive appDataFolder)

```js
{
  version: 1,
  meta: { tournamentId: 192, seasonId: 87682, lastEventSync: ts },

  teams: {            // keyed by SofaScore team id
    "<teamId>": { name, shortName }
  },

  matches: {          // keyed by SofaScore event id
    "<eventId>": {
      round, kickoff, status,            // status: notstarted|finished|postponed…
      homeTeamId, awayTeamId, homeScore, awayScore,
      importedAt,                        // absent/null = listed, not imported
      partial                            // true = lineups were missing (retryable)
    }
  },

  players: {          // keyed by SofaScore player id
    "<playerId>": {
      name, teamId,
      gamePosition,            // "GK"|"DEF"|"MID"|"FWD"|null — Fantasy LOI's assignment
      gamePositionSource,      // "paste"|"manual"|null
      realPosition,            // manual override; null = derive from appearances
      price, priceUpdatedAt,
      starred,                 // ⭐ one to watch
      inSquad,                 // currently in the user's fantasy team
      pasteAlias               // remembered fantasyloi name when fuzzy match failed
    }
  },

  appearances: {      // keyed by "<eventId>:<playerId>"
    "<k>": {
      eventId, playerId, teamId,
      started, subOnMin, subOffMin, minutes,
      positionPlayed,          // SofaScore per-match position (G/D/M/F) → feeds realPosition
      goals, assists, ownGoals,
      yellow, secondYellow, red,
      penMissed, penSaved
    }
  },

  adjustments: {      // same key as appearances; sparse; survives re-imports
    "<k>": { assists: 1, note: "won pen vs Derry" }   // deltas applied at scoring time
  }
}
```

Rules of the model:

- **Imports own** `teams`, `matches`, `appearances` — re-importing a match overwrites exactly those records for that match.
- **The user owns** everything on `players` except `name`/`teamId`, plus all of `adjustments`. Re-imports never touch user-owned fields.
- **Nothing derived is stored** — fantasy points, clean sheets, real-position inference, form windows are all computed at render time, so corrections re-score history instantly.
- Size: ~180 matches × ~32 appearances ≈ 6k records ≪ 1MB. Single-file load/save stays comfortable.

## Import pipeline

1. **Sync list:** fetch season event pages, upsert `matches` stubs (fixtures included, shown greyed). Diff against `importedAt` to find missing finished matches.
2. **Import a match** (sequential, ~300ms gap between matches to stay polite):
   - `/event/{id}` → match record fields
   - `/event/{id}/lineups` → appearance skeletons (started/bench, positionPlayed, minutes); on 404 → mark `partial: true`, continue, surface for retry
   - `/event/{id}/incidents` → goals/assists/cards/subs/penalties merged into appearances
   - `normalize(event, lineups, incidents)` is a pure function → `{ match, appearances[], teams[] }`
   - auto-create unknown players (name, teamId from lineups)
3. **Save once per import batch** with sideline's `saveWithRetry`. A failed batch stops at the last fully-saved match; no half-written matches.
4. Full-season backfill ≈ 150+ matches × 3 requests — a one-time progress-bar operation (~2 minutes).

## Scoring engine (`scoring.js`)

Declarative rules table (verify values against live rules page during implementation):

```js
const RULES = {
  appearance: { sub: 1, startedSubbedOff: 2, fullMatch: 3 },
  teamResult: { win: 2, draw: 1 },              // requires an appearance
  goal:       { GK: 10, DEF: 6, MID: 5, FWD: 4 },
  assist:     3,
  cleanSheet: { positions: ["GK", "DEF"], fullMatch: 4, startedPartial: 2, sub: 1 },
  ownGoal: -2, penMiss: -3, penSave: 5,         // penSave GK only
  yellow: -1, secondYellow: -2, straightRed: -4
};
```

- `scoreAppearance(appearance, match, position, adjustments)` → `{ total, breakdown: [[reason, pts]…] }` — pure, position passed in so the same function scores by `gamePosition` (what the game pays) or `realPosition` (what they "should" earn — phase 2's mis-categorisation lens).
- Clean sheet: opposition scored 0 during the player's minutes on pitch (opposition goal times vs subOn/subOff).
- Adjustments applied as deltas before scoring; breakdown marks adjusted components.

## UI (phase 1) — five screens behind a tab bar, mobile-first

1. **Matches** — fixtures grouped by round; ✅ imported / [Import] / greyed upcoming; "Import all missing" with progress; partial-import warnings with retry.
2. **Players** — sortable table (pos, €, goals, assists, minutes, starts/subs, total fantasy points); filters: team, position, ⭐, my-squad, search. ⚠ marker where observed `positionPlayed` history disagrees with `gamePosition` (simple majority heuristic in phase 1; full report in phase 2).
3. **Player detail** — per-match appearance log; editors for `gamePosition` and `realPosition` (showing the auto-derived value, e.g. "auto: F in 11/12"); ⭐/🔵 toggles; tap a stat to record an adjustment with optional note; ✏ marks adjusted stats.
4. **Teams** — pick a team → players × rounds grid: ● started / ◐ subbed off / ○ sub on / — unused. Answers "who have the starters been."
5. **Settings (⚙)** — Google sign-in/out, resync, paste import (instructions, textarea, parse preview "28 matched · 2 unmatched", manual link picker), season/tournament info.

## Error handling

- **Drive:** sideline's stack verbatim (token recall, pre-save refresh, silent reauth on visibility/interval, 401 retry then reconnect banner).
- **SofaScore:** per-step tolerance (lineups 404 → partial import); batch import stops cleanly on network/403 failure; failures are visible in the matches list, never silent.
- **Paste import:** parse → preview → commit; nothing saved until the user confirms.

## Testing (vitest, run in CI)

- `normalize()` golden-file tests on captured real payloads: ordinary match, red-card match, missing lineups, own-goal + missed-penalty match.
- `scoring()` table-driven per rule + cross-check of at least one real gameweek against points the game actually awarded.
- Paste parser against real copied text including awkward names (O'Conor, James-Taylor, etc.).
- CI: test → build → deploy; deploy blocked on red.

## Setup checklist (one-time)

- Google Cloud OAuth client: add `https://seaninryan.github.io` to allowed JS origins (and `http://localhost:5173` for dev).
- GitHub repo `fancystats`, Pages via Actions workflow.
- `.gitignore`: `node_modules/`, `dist/`, `.superpowers/`.

## Phase 2 (future spec)

Form tables (last-N-gameweek leaderboards), value metrics (pts/€), fixture difficulty, minutes-security/rotation trends, full mis-categorisation report (game-position points vs real-position points), penalty-taker & set-piece duty tracking, possibly squad simulation (captain/chips/auto-subs).

## Risks

- **SofaScore could start blocking browser requests or change response shapes.** Mitigation: failures are loud; normalizer is golden-file tested so shape drift is caught in dev; historical data can be re-imported any time it's reachable.
- **Assist divergence from the game's Comet-based numbers** — by design, handled via adjustments overlay.
- **Name matching fantasyloi ↔ SofaScore** — fuzzy match + remembered manual aliases (`pasteAlias`).
- **Single-file last-write-wins sync** — same trade-off sideline accepted; fine for a single user, multi-device sessions should resync before editing.
