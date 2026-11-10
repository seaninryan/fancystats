# Fantasy Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Suggestions panel on My Team: weakest squad players, buy targets, best fixture runs, ranked by one outlook score (form + fixtures).

**Architecture:** Pure derivations in a new `src/lib/suggestions.js` built on existing helpers (`teamWindowEventIds`, `playerTotals`, `fixtureContext`/`compareFixture`, `isHot`, `activeFlag`/`playerOutNow`, `teamLines`). A thin `SuggestionsPanel.jsx` rendered by `MyTeamTab`. Nothing stored.

**Tech Stack:** React 18, Vite, Vitest (node env, SSR smoke tests). Spec: `docs/superpowers/specs/2026-11-09-fantasy-suggestions-design.md`.

**Env:** prefix every npm/npx command with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" &&` (system Node 14 breaks Vitest).

---

### Task 1: suggestions lib

**Files:**
- Create: `src/lib/suggestions.js`
- Test: `test/suggestions.test.js`

- [ ] **Step 1: Write the failing tests** — `test/suggestions.test.js`:

```js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, applySiteSync, setPlayerField, markOut } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { suggestionContext, playerOutlook, mySquad, sellCandidates, buyTargets, fixtureRuns, FORM_WINDOW } from "../src/lib/suggestions.js";

const NOW = 1765000000000;
const DAY = 86400000;
const TEAMS = [1, 2, 3, 4].map((id) => ({ id, name: `Club ${id}`, shortName: `C${id}` }));
// Player 10 (club 1) and 11 (club 1) and 20 (club 2), 30 (club 3), 40 (club 4).
const PLAYERS = [[10, 1], [11, 1], [20, 2], [30, 3], [40, 4]].map(([id, teamId]) => ({ id, name: `P${id}`, teamId }));

// Played rounds 1..6: club 1 beats everyone, club 4 loses to everyone. Player 10 scores in
// every club-1 match; 11 plays only some; 20/30/40 play every match.
const PAIRS = [[1, 2, 3, 4], [1, 3, 2, 4], [1, 4, 2, 3], [1, 2, 3, 4], [1, 3, 2, 4], [1, 4, 2, 3]];
function played() {
  let d = emptyData();
  PAIRS.forEach(([a, b, c, e], i) => {
    const r = i + 1;
    for (const [k, [h, aw]] of [[a, b], [c, e]].entries()) {
      const eventId = r * 10 + k;
      const homeWins = h === 1 || aw === 4;
      const apps = [];
      const app = (pid, teamId, goals) => ({ eventId, playerId: pid, teamId, started: true, minutes: 90, goals, assists: 0 });
      for (const [pid, tid] of [[10, 1], [20, 2], [30, 3], [40, 4]]) if (tid === h || tid === aw) apps.push(app(pid, tid, pid === 10 ? 1 : 0));
      if ((h === 1 || aw === 1) && r % 2 === 0) apps.push(app(11, 1, 0)); // 11 misses odd rounds
      d = applyImport(d, {
        match: { eventId, round: r, kickoff: NOW - (10 - r) * DAY, status: "finished", homeTeamId: h, awayTeamId: aw,
          homeScore: homeWins ? 2 : 0, awayScore: homeWins ? 0 : 2,
          goalTimes: { home: homeWins ? [10, 20] : [], away: homeWins ? [] : [10, 20] }, partial: false },
        teams: TEAMS, players: PLAYERS, appearances: apps,
      }, NOW);
    }
  });
  for (const [pid, pos] of [[10, "FWD"], [11, "MID"], [20, "FWD"], [30, "MID"], [40, "FWD"]]) d = setPlayerField(d, pid, "gamePosition", pos);
  for (const [pid, price] of [[10, 9.5], [20, 7], [30, 6], [40, 5]]) d = setPlayerField(d, pid, "price", price);
  return d;
}
// Upcoming round 7: club 4 hosts club 1 (hard for 4, easy for 1), club 2 hosts club 3.
function withFixtures(d) {
  return applyImport(d, {
    match: { eventId: 71, round: 7, kickoff: NOW + DAY, status: "notstarted", homeTeamId: 4, awayTeamId: 1 },
    teams: TEAMS, players: [], appearances: [],
  }, NOW);
}
function squad(d, siteIds) {
  return applySiteSync(d, {
    capturedAt: NOW, siteTeamId: 7378, clubs: [], players: [], history: {},
    myTeam: { "6": { lines: [[siteIds[0]], [siteIds[1]]], bench: siteIds.slice(2), captain: siteIds[0], shown: {}, names: {}, total: 50 } },
  }, [{ playerId: "10", siteId: 510 }, { playerId: "11", siteId: 511 }, { playerId: "40", siteId: 540 }], NOW);
}
const view = (d) => seasonView(d, d.meta.seasonId);

describe("suggestions", () => {
  it("form is points per team match over the last 5, a missed match counting 0", () => {
    const v = view(played());
    const s = suggestionContext(v, NOW);
    const p10 = playerOutlook(s, "10");
    const p11 = playerOutlook(s, "11");
    expect(p10.games).toBe(FORM_WINDOW);
    expect(p10.form).toBeCloseTo(p10.points / 5);
    expect(p11.games).toBe(5);
    expect(p11.points).toBeLessThan(p10.points);
    expect(p11.form).toBeCloseTo(p11.points / 5); // 3 missed matches still in the denominator
  });
  it("no upcoming fixtures: outlook is form alone", () => {
    const s = suggestionContext(view(played()), NOW);
    expect(s.anyUpcoming).toBe(false);
    const p = playerOutlook(s, "10");
    expect(p.fixtures).toEqual([]);
    expect(p.ease).toBe(0);
    expect(p.score).toBeCloseTo(p.form);
  });
  it("fixture ease from each side, and the outlook formula", () => {
    const s = suggestionContext(view(withFixtures(played())), NOW);
    expect(s.anyUpcoming).toBe(true);
    const one = s.upcoming.get(1)[0];
    const four = s.upcoming.get(4)[0];
    expect(one).toMatchObject({ eventId: 71, round: 7, opponentId: 4, home: false });
    expect(four).toMatchObject({ opponentId: 1, home: true });
    expect(one.ease).toBeGreaterThan(0);
    expect(four.ease).toBeCloseTo(-one.ease);
    expect(one.tag).toMatch(/🎯/);
    expect(four.tag).toBe(null);
    const p = playerOutlook(s, "10");
    expect(p.ease).toBeCloseTo(one.ease);
    expect(p.score).toBeCloseTo(p.form + Math.abs(p.form) * 0.5 * one.ease);
    expect(playerOutlook(s, "40").score).toBeLessThan(playerOutlook(s, "40").form + 1e-9);
  });
  it("the squad is the latest captured gameweek, XI then bench", () => {
    expect(mySquad(view(played()))).toEqual([]);
    const sq = mySquad(view(squad(played(), [510, 511, 540])));
    expect(sq.map((e) => e.playerId)).toEqual(["10", "11", "40"]);
  });
  it("sell candidates: out players first, then weakest outlook", () => {
    let d = squad(played(), [510, 511, 540]);
    let rows = sellCandidates(suggestionContext(view(d), NOW));
    expect(rows.map((r) => r.entry.playerId)).toEqual(["40", "11", "10"]);
    d = markOut(d, "10", "hamstring", NOW);
    rows = sellCandidates(suggestionContext(view(d), NOW));
    expect(rows[0].entry.playerId).toBe("10");
    expect(rows[0].outlook.out).toBeTruthy();
  });
  it("buy targets: not owned, not out, has games, by position, limited", () => {
    let d = squad(played(), [510, 511, 540]);
    const s = suggestionContext(view(d), NOW);
    expect(buyTargets(s).map((o) => o.playerId)).toEqual(["20", "30"].sort((a, b) =>
      playerOutlook(s, b).score - playerOutlook(s, a).score));
    expect(buyTargets(s, { position: "MID" }).map((o) => o.playerId)).toEqual(["30"]);
    expect(buyTargets(s, { limit: 1 })).toHaveLength(1);
    d = markOut(d, "20", "", NOW);
    expect(buyTargets(suggestionContext(view(d), NOW)).map((o) => o.playerId)).toEqual(["30"]);
  });
  it("fixture runs: clubs with upcoming fixtures, easiest first", () => {
    expect(fixtureRuns(suggestionContext(view(played()), NOW))).toEqual([]);
    const runs = fixtureRuns(suggestionContext(view(withFixtures(played())), NOW));
    expect(runs.map((r) => r.teamId)).toEqual([1, 4]);
    expect(runs[0].name).toBe("Club 1");
    expect(runs[0].ease).toBeGreaterThan(runs[1].ease);
  });
});
```

NOTE for the implementer: if a fixture detail in this test doesn't match how `applyImport`
expects its input (check `test/fixtures.test.js` and `test/leagues.test.js` for working
fixture builders), adjust the FIXTURE BUILDERS, never the assertions' intent. The intent is:
form window/denominator, ease symmetry and sign, outlook formula, squad order, sell order
(out first), buy-target filters, fixture-run order.

- [ ] **Step 2: Run** `npx vitest run test/suggestions.test.js` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/suggestions.js`:

```js
// src/lib/suggestions.js
// Transfer suggestions for the My Team panel: the weakest players in the user's squad,
// players worth bringing in, and the clubs with the easiest next fixtures — all ranked by
// one outlook score (recent form adjusted by fixture ease). Season views only; nothing stored.
// See docs/superpowers/specs/2026-11-09-fantasy-suggestions-design.md.
import { teamWindowEventIds, playerTotals, appearancesByPlayer, isHot, activeFlag, playerOutNow, playerName, matchRound } from "./store.js";
import { fixtureContext, compareFixture } from "./fixtures.js";
import { myTeamGameweeks, teamLines } from "./myTeam.js";

export const FORM_WINDOW = 5;     // team matches, same window as the Teams page
export const FIXTURE_COUNT = 3;   // upcoming fixtures that count
export const FIXTURE_WEIGHT = 0.5; // a perfectly easy run lifts form by half

const gone = (m) => m.status === "postponed" || m.status === "canceled";
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function suggestionContext(view, now = Date.now()) {
  const ctx = fixtureContext(view);
  const upcoming = new Map(); // teamId (number) -> fixtures, soonest first
  const future = Object.values(view.matches)
    .filter((m) => !m.importedAt && m.status !== "finished" && !gone(m))
    .sort((a, b) => (a.kickoff || 0) - (b.kickoff || 0));
  for (const m of future) {
    const cmp = compareFixture(ctx, m);
    for (const home of [true, false]) {
      const teamId = Number(home ? m.homeTeamId : m.awayTeamId);
      const list = upcoming.get(teamId) || [];
      if (list.length >= FIXTURE_COUNT) continue;
      list.push({
        eventId: m.eventId, round: matchRound(m), kickoff: m.kickoff,
        opponentId: Number(home ? m.awayTeamId : m.homeTeamId), home,
        ease: cmp ? (home ? cmp.score : -cmp.score) : 0,
        tag: cmp?.favoured && Number(cmp.favoured.teamId) === teamId ? cmp.favoured.tag : null,
      });
      upcoming.set(teamId, list);
    }
  }
  return {
    view, now, upcoming, anyUpcoming: upcoming.size > 0,
    windows: teamWindowEventIds(view, FORM_WINDOW),
    apps: appearancesByPlayer(view),
  };
}

export function playerOutlook(sctx, playerId) {
  const { view, now } = sctx;
  const p = view.players[playerId];
  if (!p?.gamePosition || p.teamId == null) return null;
  const apps = sctx.apps.get(Number(playerId)) || [];
  const win = sctx.windows.get(Number(p.teamId));
  const games = win?.size ?? 0;
  const points = games ? playerTotals(view, playerId, { apps, eventIds: win }).points ?? 0 : 0;
  const form = games ? points / games : 0;
  const fixtures = sctx.upcoming.get(Number(p.teamId)) || [];
  const ease = mean(fixtures.map((f) => f.ease));
  return {
    playerId: String(playerId), name: playerName(p), position: p.gamePosition, teamId: Number(p.teamId),
    price: p.price ?? null, form, games, points, fixtures, ease,
    score: form + Math.abs(form) * FIXTURE_WEIGHT * ease,
    hot: isHot(view, playerId, apps),
    out: activeFlag(p, now) || playerOutNow(view, playerId, now),
  };
}

export function mySquad(view) {
  const gws = myTeamGameweeks(view);
  if (!gws.length) return [];
  const t = teamLines(view, view.site.myTeam[gws[gws.length - 1]]);
  return [...t.lines.flatMap((l) => l.players), ...t.bench];
}

export function sellCandidates(sctx) {
  const rows = mySquad(sctx.view).map((entry) => ({
    entry, outlook: entry.playerId ? playerOutlook(sctx, entry.playerId) : null,
  }));
  const rank = (r) => (r.outlook == null ? 2 : r.outlook.out ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.outlook && b.outlook ? a.outlook.score - b.outlook.score : 0));
}

export function buyTargets(sctx, { position = null, limit = 5 } = {}) {
  const owned = new Set(mySquad(sctx.view).map((e) => e.playerId).filter(Boolean));
  return Object.keys(sctx.view.players)
    .filter((pid) => !owned.has(pid))
    .map((pid) => playerOutlook(sctx, pid))
    .filter((o) => o && o.games > 0 && !o.out && (!position || o.position === position))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function fixtureRuns(sctx) {
  return [...sctx.upcoming.entries()]
    .map(([teamId, fixtures]) => ({
      teamId, name: sctx.view.teams[teamId]?.name ?? `#${teamId}`, fixtures, ease: mean(fixtures.map((f) => f.ease)),
    }))
    .sort((a, b) => b.ease - a.ease);
}
```

Check before relying on them: `activeFlag`, `playerOutNow`, `appearancesByPlayer` (Map keyed by the
appearance's numeric `playerId`), `teamWindowEventIds` (Map keyed by numeric teamId) are exported
from `store.js`; `view.teams` is keyed by teamId string. Fix the imports if a name differs.

- [ ] **Step 4: Run** `npx vitest run test/suggestions.test.js` — PASS; then `npm test` — all pass.

- [ ] **Step 5: Commit** `git add src/lib/suggestions.js test/suggestions.test.js && git commit -m "feat: suggestions lib — outlook from form and fixture ease, sell candidates, buy targets, fixture runs"`

### Task 2: Suggestions panel on My Team

**Files:**
- Create: `src/components/SuggestionsPanel.jsx`
- Modify: `src/components/MyTeamTab.jsx` (render `<SuggestionsPanel data={data} openPlayer={openPlayer} />` after the chart)
- Modify: `src/styles.css` (only if a `.weak` row style is needed — reuse existing classes where possible)
- Test: `test/suggestionsPanel.test.jsx`

- [ ] **Step 1: Failing SSR test** — `test/suggestionsPanel.test.jsx`: build a season with played matches + a captured squad (reuse/copy the `played()`/`squad()` builders from `test/suggestions.test.js`; export nothing from tests — copy), render `<MyTeamTab data={view} openPlayer={() => {}} />` and assert the HTML contains "Suggestions", "Weakest in your squad", "Buy targets", a squad player name, a non-owned player name, and "outlook is form only" (no upcoming fixtures). With an upcoming fixture added, assert "Best fixture runs" and "🎯". With no squad (`emptyData()`), assert "Suggestions" is absent.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** `src/components/SuggestionsPanel.jsx`:

```jsx
// src/components/SuggestionsPanel.jsx — sell / buy / fixture suggestions under My Team.
import { useMemo, useState } from "react";
import { suggestionContext, sellCandidates, buyTargets, fixtureRuns, mySquad } from "../lib/suggestions.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const signed = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
const one = (n) => n.toFixed(1);

function Next({ fixtures, teams }) {
  if (!fixtures.length) return <span className="dim">—</span>;
  return fixtures.map((f) => (
    <span key={f.eventId} title={`ease ${signed(f.ease)}`} style={{ marginRight: 6, whiteSpace: "nowrap" }}>
      {teams[f.opponentId]?.shortName ?? `#${f.opponentId}`}({f.home ? "h" : "a"}){f.tag ?? ""}
    </span>
  ));
}

const why = (o) => `form ${one(o.form)}/game (${o.points} pts in ${o.games}) · fixtures ${signed(o.ease)} → outlook ${one(o.score)}`;

export default function SuggestionsPanel({ data, openPlayer }) {
  const [pos, setPos] = useState(null);
  const sctx = useMemo(() => suggestionContext(data, Date.now()), [data]);
  if (!mySquad(data).length) return null;
  const sell = sellCandidates(sctx);
  const buy = buyTargets(sctx, { position: pos });
  const runs = fixtureRuns(sctx);
  const name = (playerId, label) => (
    <span className="cell-click" onClick={() => openPlayer(playerId)}>{label}</span>
  );
  return (
    <div>
      <h3>Suggestions</h3>
      {!sctx.anyUpcoming && <p className="dim">No upcoming fixtures — outlook is form only.</p>}
      <div className="card scroll-x">
        <strong>Weakest in your squad</strong>
        <table>
          <thead><tr><th>Player</th><th>Pos</th><th>Price</th><th title={`points per team match, last 5`}>Form</th><th>Next</th><th>Outlook</th></tr></thead>
          <tbody>
            {sell.map(({ entry, outlook: o }, i) => (
              <tr key={entry.siteId} className={i < 3 && o ? "weak" : undefined}>
                <td>{entry.playerId ? name(entry.playerId, entry.name) : entry.name}{o?.out ? " ⛔" : ""}</td>
                <td>{o?.position ?? ""}</td><td>{o?.price ?? ""}</td>
                <td>{o ? one(o.form) : "—"}</td>
                <td>{o ? <Next fixtures={o.fixtures} teams={data.teams} /> : ""}</td>
                <td title={o ? why(o) : "not linked to a player with a position"}>{o ? one(o.score) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card scroll-x">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <strong>Buy targets</strong>
          {[null, ...POSITIONS].map((p) => (
            <button key={p ?? "all"} className={pos === p ? "primary" : ""} onClick={() => setPos(p)}>{p ?? "All"}</button>
          ))}
        </div>
        <table>
          <thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Price</th><th>Form</th><th>Next</th><th>Outlook</th></tr></thead>
          <tbody>
            {buy.map((o) => (
              <tr key={o.playerId}>
                <td>{name(o.playerId, o.name)}{o.hot ? " 🔥" : ""}</td>
                <td>{data.teams[o.teamId]?.shortName ?? ""}</td><td>{o.position}</td><td>{o.price ?? ""}</td>
                <td>{one(o.form)}</td><td><Next fixtures={o.fixtures} teams={data.teams} /></td>
                <td title={why(o)}>{one(o.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sctx.anyUpcoming && (
        <div className="card scroll-x">
          <strong>Best fixture runs</strong>
          <table>
            <thead><tr><th>Club</th><th>Next</th><th title="mean ease, −1 hard … +1 easy">Ease</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.teamId}><td>{r.name}</td><td><Next fixtures={r.fixtures} teams={data.teams} /></td><td>{signed(r.ease)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

Add to `src/styles.css` (near `.row-me` if present; match its look but in an amber tint using
existing CSS variables if there is a warning colour variable):

```css
tr.weak td { background: color-mix(in srgb, #d97706 12%, transparent); }
```

Check `openPlayer`'s signature in `TeamLines.jsx` / `MyTeamTab` and match it (it may take a
playerId string). Check the existing `.cell-click` class is the clickable-name convention.

- [ ] **Step 4: Run** the new test, `npm test`, and `npm run build` — all pass.

- [ ] **Step 5: Commit** `git commit -m "feat: Suggestions panel on My Team — weakest squad players, buy targets, fixture runs"`

---

## Part 2: swap pairs (spec addendum 2026-11-10)

### Task 3: bank + swapPairs lib

**Files:** Modify `src/lib/store.js` (add `setFantasyBank`), `src/lib/suggestions.js` (add `CLUB_LIMIT`, `swapPairs`); Test `test/suggestions.test.js`, `test/store.test.js`.

- [ ] Tests first (reuse the `played()`/`squad()` builders in test/suggestions.test.js; give
  players prices with `setPlayerField(d, pid, "price", x)`):
  - `setFantasyBank(d, 1.5).meta.fantasyBank === 1.5`; returns a new object; original untouched; and `applySiteSync` on top keeps it.
  - swapPairs returns only same-position replacements (sell a FWD → buy a FWD).
  - affordability: a replacement priced above `sell.price + bank` is excluded; raising `bank` admits it; `bankAfter` is `sell.price + bank − buy.price`.
  - club limit: with 3 squad players from club X (not the seller's club), a club-X candidate is excluded; if the seller IS from club X the candidate is allowed.
  - excludes squad members, out players, `games === 0`; only `gain > 0`; sorted by gain desc; at most one row per seller; `sellCount` respected.
  Build extra squad players/clubs as needed; keep fixtures realistic via `applyImport` (played) and `upsertMatchStubs` (upcoming).
- [ ] Implement:

```js
// store.js
// User-owned (syncs never touch it): the fantasy bank balance in €m, typed in on My Team.
export function setFantasyBank(data, value) {
  const next = structuredClone(data);
  next.meta.fantasyBank = Number.isFinite(value) ? value : 0;
  return next;
}
```

```js
// suggestions.js
export const CLUB_LIMIT = 3; // most squad players from one club (site rule, user-confirmed)

export function swapPairs(sctx, { bank = 0, sellCount = 5 } = {}) {
  const { view } = sctx;
  const squad = mySquad(view);
  const owned = new Set(squad.map((e) => e.playerId).filter(Boolean));
  const perClub = new Map();
  for (const e of squad) {
    const t = e.playerId != null ? view.players[e.playerId]?.teamId : null;
    if (t != null) perClub.set(Number(t), (perClub.get(Number(t)) || 0) + 1);
  }
  const pool = Object.keys(view.players).filter((pid) => !owned.has(pid))
    .map((pid) => playerOutlook(sctx, pid))
    .filter((o) => o && o.games > 0 && !o.out && o.price != null);
  const rows = [];
  for (const { outlook: sell } of sellCandidates(sctx).filter((r) => r.outlook && r.outlook.price != null).slice(0, sellCount)) {
    const budget = sell.price + bank;
    let best = null;
    for (const o of pool) {
      if (o.position !== sell.position || o.price > budget + 1e-9) continue;
      const after = (perClub.get(o.teamId) || 0) - (o.teamId === sell.teamId ? 1 : 0) + 1;
      if (after > CLUB_LIMIT) continue;
      if (!best || o.score > best.score) best = o;
    }
    if (best && best.score > sell.score) {
      rows.push({ sell, buy: best, gain: best.score - sell.score, bankAfter: budget - best.price });
    }
  }
  return rows.sort((a, b) => b.gain - a.gain);
}
```

- [ ] `npm test` green; commit `feat: swap pairs — same position, within bank, club limit`.

### Task 4: Swaps card

**Files:** Modify `src/components/SuggestionsPanel.jsx`, `src/components/MyTeamTab.jsx` (pass `update`, `readOnly` through to the panel — App already gives every tab `update` and `readOnly`); Test `test/suggestionsPanel.test.jsx`.

- [ ] SSR test: with a squad and a priced affordable better same-position player, the HTML contains "Swaps", "Bank", the seller and buyer names; with nothing improving, "No improving swap within budget."
- [ ] Implement in the panel after the "Weakest in your squad" card:

```jsx
const bank = data.meta?.fantasyBank ?? 0;
const swaps = swapPairs(sctx, { bank });
// …
<div className="card scroll-x">
  <div className="row">
    <strong>Swaps</strong>
    <label style={{ marginLeft: "auto" }}>Bank €
      <input type="number" step="0.1" style={{ width: "5em" }} defaultValue={bank} disabled={readOnly}
        onBlur={(e) => update((d) => setFantasyBank(d, parseFloat(e.target.value)))} />m
    </label>
  </div>
  {swaps.length === 0 ? <p className="dim">No improving swap within budget.</p> : (
    <table>
      <thead><tr><th>Sell</th><th></th><th>Buy</th><th>Gain</th><th title="bank after this swap">Bank</th></tr></thead>
      <tbody>
        {swaps.map(({ sell, buy, gain, bankAfter }) => (
          <tr key={sell.playerId}>
            <td>{name(sell.playerId, sell.name)} <span className="dim">{sell.position} €{sell.price} · {one(sell.score)}</span></td>
            <td>→</td>
            <td>{name(buy.playerId, buy.name)}{buy.hot ? " 🔥" : ""} <span className="dim">{data.teams[buy.teamId]?.shortName ?? ""} €{buy.price} · {one(buy.score)}</span></td>
            <td title={`${why(sell)}\n${why(buy)}`}>+{one(gain)}</td>
            <td>€{bankAfter.toFixed(1)}m</td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
</div>
```
  Default `update = () => {}` and `readOnly = false` props so existing callers/tests keep working.
- [ ] `npm test`, `npm run build` green; commit `feat: Swaps card with bank balance on My Team`.
