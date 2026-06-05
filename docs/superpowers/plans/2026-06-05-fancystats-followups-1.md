# fancystats Follow-ups 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Post-UAT enhancements: user-movable rounds, auto-scroll to current round, "Club Picture" paste fix, decorated Teams grid (colours, goals/assists/cards/penalties), star/squad toggles on Teams.

**Architecture:** Same as phase 1. New user-owned match field `roundOverride` (survives re-import like player edits); effective round via `matchRound()` everywhere. New import-owned appearance field `penScored` from the normalizer.

**Tech Stack:** unchanged (Vite/React/vitest). Env note: prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task A: Library changes (TDD)

**Files:**
- Modify: `src/lib/store.js`, `src/lib/sofascore.js`, `src/lib/pasteImport.js`
- Test: `test/store.test.js`, `test/normalize.test.js`, `test/pasteImport.test.js`

- [ ] **Step 1: Failing tests — append to test/store.test.js** (add `matchRound, setMatchRound` to the store import list):

```js
describe("round overrides", () => {
  it("matchRound prefers the user override", () => {
    expect(matchRound({ round: 12 })).toBe(12);
    expect(matchRound({ round: 12, roundOverride: 14 })).toBe(14);
  });
  it("setMatchRound sets and clears the override", () => {
    let d = importedFixture();
    d = setMatchRound(d, 100, 14);
    expect(matchRound(d.matches["100"])).toBe(14);
    d = setMatchRound(d, 100, null);
    expect(d.matches["100"].roundOverride).toBeUndefined();
    expect(matchRound(d.matches["100"])).toBe(1);
  });
  it("setting the override to the natural round clears it", () => {
    let d = setMatchRound(importedFixture(), 100, 1);
    expect(d.matches["100"].roundOverride).toBeUndefined();
  });
  it("roundOverride survives re-import and re-sync", () => {
    let d = setMatchRound(importedFixture(), 100, 14);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [], appearances: [],
    }, NOW + 5);
    expect(matchRound(d.matches["100"])).toBe(14);
    d = upsertMatchStubs(d, [{ eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 }], []);
    expect(matchRound(d.matches["100"])).toBe(14);
  });
});
```

- [ ] **Step 2: Failing test — append to test/normalize.test.js** (inside the "edge cases" describe or a new one):

```js
  it("tracks penalty goals separately as penScored", () => {
    const i = structuredClone(incidents);
    i.incidents.push({ incidentType: "goal", incidentClass: "penalty", time: 85, isHome: true, player: { id: 102, name: "Graham Burke" } });
    const res = run(event, lineups, i);
    expect(app(res, 102)).toMatchObject({ goals: 2, penScored: 1 }); // open-play 30' + pen 85'
    expect(res.match.goalTimes.home).toEqual([30, 75, 85]);
  });
```

- [ ] **Step 3: Failing test — append to test/pasteImport.test.js** (parsePaste describe; the user's real copy shape):

```js
  it("ignores the fantasyloi 'Club Picture' image-cell text", () => {
    const text = [
      "Club Picture\tLuke Turner\t116",
      "Club Picture\tDaryl Horgan\t116",
      "Club Picture\tEd McGinty\t116",
      "Club Picture\tHarry Wood\t115",
    ].join("\n");
    expect(parsePaste(text)).toEqual([
      { name: "Luke Turner", value: 116 },
      { name: "Daryl Horgan", value: 116 },
      { name: "Ed McGinty", value: 116 },
      { name: "Harry Wood", value: 115 },
    ]);
  });
```

- [ ] **Step 4: Run the three test files, confirm the new tests fail** (missing exports / wrong name picked / no penScored field).

- [ ] **Step 5: Implement.**

`src/lib/store.js` — add after `upsertMatchStubs`:

```js
// Effective gameweek: the user's override wins (matches get moved, double weeks happen).
export function matchRound(m) {
  return m.roundOverride ?? m.round;
}

export function setMatchRound(data, eventId, round) {
  const next = structuredClone(data);
  const m = next.matches[eventId];
  if (!m) return data;
  if (round == null || round === m.round) delete m.roundOverride;
  else m.roundOverride = round;
  return next;
}
```

In `applyImport`, replace the match-write line with:

```js
  const prevMatch = next.matches[match.eventId];
  next.matches[match.eventId] = { ...match, importedAt: now };
  // user-owned match field survives re-import, like player edits do
  if (prevMatch?.roundOverride != null) next.matches[match.eventId].roundOverride = prevMatch.roundOverride;
```

(`upsertMatchStubs` already preserves unknown fields via `{ ...prev, ...s }` — no change.)

`src/lib/sofascore.js` — in the lineup skeleton object add `penScored: 0,` next to `penMissed: 0,`; in the goal incident branch change the scorer credit to:

```js
        stat(inc.player?.id, (a) => {
          a.goals++;
          if (inc.incidentClass === "penalty") a.penScored++;
        });
```

`src/lib/pasteImport.js` — add `"club picture",` to the STOPWORDS set.

- [ ] **Step 6: Full suite green** (`npx vitest run` — expect 89: 83 + 4 store + 1 normalize + 1 paste).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ test/
git commit -m "feat: round overrides, penScored tracking, Club Picture paste fix"
```

---

### Task B: Matches tab — round selector, group-by-round, auto-scroll

**Files:**
- Modify: `src/components/MatchesTab.jsx`

- [ ] **Step 1: Rework the component.** Replace the consecutive-run grouping, add the selector and auto-scroll. The component body changes to:

```jsx
// src/components/MatchesTab.jsx
import { useEffect, useRef, useState } from "react";
import { fetchSeasonEvents, importMatch, sleep } from "../lib/sofascore.js";
import { upsertMatchStubs, applyImport, matchRound, setMatchRound } from "../lib/store.js";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

export default function MatchesTab({ data, update }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const currentRef = useRef(null);

  const sync = async () => {
    setBusy("Checking for matches…"); setError(null);
    try {
      const { stubs, teams } = await fetchSeasonEvents(data.meta);
      const now = Date.now();
      update((d) => {
        const next = upsertMatchStubs(d, stubs, teams);
        next.meta = { ...next.meta, lastEventSync: now };
        return next;
      });
    } catch (e) { setError(`Sync failed: ${e.message}`); }
    setBusy(null);
  };

  const runImport = async (eventIds) => {
    setError(null);
    const results = [];
    for (let i = 0; i < eventIds.length; i++) {
      setBusy(`Importing ${i + 1}/${eventIds.length}…`);
      try { results.push(await importMatch(eventIds[i])); }
      catch (e) { setError(`Stopped at match ${eventIds[i]}: ${e.message}. Imported ${results.length} before failing.`); break; }
      if (i < eventIds.length - 1) await sleep(300);
    }
    if (results.length) {
      const now = Date.now();
      update((d) => results.reduce((acc, r) => applyImport(acc, r, now), d));
    }
    setBusy(null);
  };

  const matches = Object.values(data.matches);
  const missing = matches.filter((m) => m.status === "finished" && !m.importedAt);
  const team = (id) => data.teams[id]?.shortName || id;
  const todo = (m) => (m.status === "finished" && !m.importedAt) || m.status === "notstarted";

  // True group-by-round (overrides included), newest round first, kickoff order within.
  const byRound = new Map();
  for (const m of matches) {
    const r = matchRound(m);
    if (!byRound.has(r)) byRound.set(r, []);
    byRound.get(r).push(m);
  }
  const rounds = [...byRound.entries()]
    .map(([round, items]) => ({ round, items: items.sort((a, b) => a.kickoff - b.kickoff) }))
    .sort((a, b) => (b.round ?? -1) - (a.round ?? -1));
  const allRounds = rounds.map((r) => r.round).filter((r) => r != null).sort((a, b) => a - b);
  // Current gameweek = earliest round that still has something to do.
  const currentRound = rounds.length
    ? Math.min(...rounds.filter((r) => r.items.some(todo)).map((r) => r.round ?? Infinity))
    : null;

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "start" });
  }, []); // on mount only — jump to the current gameweek

  const moveMatch = (eventId, value) =>
    update((d) => setMatchRound(d, eventId, value === "" ? null : Number(value)));

  return (
    <div>
      <div className="card row">
        <button onClick={sync} disabled={!!busy}>⟳ Check for new matches</button>
        {missing.length > 0 && (
          <button className="primary" disabled={!!busy} onClick={() => runImport(missing.map((m) => m.eventId))}>
            Import all missing ({missing.length})
          </button>
        )}
        {busy && <span className="dim">{busy}</span>}
        {data.meta.lastEventSync && !busy && (
          <span className="dim">synced {fmtDate(data.meta.lastEventSync)}</span>
        )}
      </div>
      {error && <div className="banner err">{error}</div>}
      {matches.length === 0 && <p className="dim">No matches yet — tap “Check for new matches”.</p>}
      {rounds.map(({ round, items }) => (
        <section
          key={round ?? "none"}
          ref={round === currentRound ? currentRef : null}
          style={{ scrollMarginTop: 56 }}
        >
          <h3>Round {round ?? "?"} <span className="dim">— {fmtDate(items[0].kickoff)}</span></h3>
          {items.map((m) => (
            <div key={m.eventId} className="card row">
              <span style={{ flex: 1 }}>
                {team(m.homeTeamId)} {m.homeScore ?? ""}–{m.awayScore ?? ""} {team(m.awayTeamId)}
                {m.status !== "finished" && <span className="dim"> · {fmtDate(m.kickoff)}</span>}
              </span>
              <select
                title="Move to another round"
                value={m.roundOverride ?? ""}
                onChange={(e) => moveMatch(m.eventId, e.target.value)}
                disabled={!!busy}
              >
                <option value="">R{m.round ?? "?"}</option>
                {allRounds.filter((r) => r !== m.round).map((r) => (
                  <option key={r} value={r}>→ R{r}</option>
                ))}
              </select>
              {m.status !== "finished" ? <span className="dim">upcoming</span>
                : m.importedAt && m.partial ? (
                  <span className="row">
                    <span className="banner warn" style={{ margin: 0 }}>no lineups</span>
                    <button disabled={!!busy} onClick={() => runImport([m.eventId])}>Retry</button>
                  </span>
                )
                : m.importedAt ? <span style={{ color: "var(--accent)" }}>✓</span>
                : <button className="primary" disabled={!!busy} onClick={() => runImport([m.eventId])}>Import</button>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2:** `npm test && npm run build` green. Commit:

```bash
git add src/components/MatchesTab.jsx
git commit -m "feat: movable rounds, true round grouping, auto-scroll to current gameweek"
```

---

### Task C: Teams grid decorations + toggles; effective round everywhere

**Files:**
- Modify: `src/components/TeamsTab.jsx`, `src/components/PlayerDetail.jsx`, `src/styles.css`

- [ ] **Step 1: styles.css** — append:

```css
.cell-start { color: var(--accent); }
.cell-off { color: var(--warn); }
.cell-on { color: #4a90d9; }
.cell-out { opacity: .4; }
.mini-toggle { padding: 1px 5px; font-size: 12px; border-radius: 6px; }
.mini-toggle.off { opacity: .35; }
```

- [ ] **Step 2: TeamsTab.jsx** — replace `cellFor` with the decorated version, accept `update`, add toggles, use `matchRound`:

```jsx
// src/components/TeamsTab.jsx
import { useState } from "react";
import { matchRound, setPlayerField } from "../lib/store.js";

// Colour = how they appeared; emoji = what they did.
function cellFor(app) {
  if (!app) return { sym: "—", cls: "cell-out", title: "did not play" };
  const goals = app.goals || 0;
  const pens = Math.min(app.penScored || 0, goals);
  const deco =
    "⚽".repeat(goals - pens) + "⚽🥅".repeat(pens) +
    "👟".repeat(app.assists || 0) +
    (app.secondYellow ? "🟨🟨" : app.yellow ? "🟨" : "") +
    (app.red ? "🟥" : "") +
    "❌".repeat(app.penMissed || 0) +
    "🧤".repeat(app.penSaved || 0);
  const words = [
    goals && `${goals} goal${goals > 1 ? "s" : ""}${pens ? ` (${pens} pen)` : ""}`,
    app.assists && `${app.assists} assist${app.assists > 1 ? "s" : ""}`,
    app.secondYellow ? "second yellow" : app.yellow ? "yellow card" : null,
    app.red && "straight red",
    app.penMissed && "missed penalty",
    app.penSaved && "penalty saved",
  ].filter(Boolean).join(", ");
  if (!app.started) return { sym: `○${app.subOnMin ?? ""}'${deco}`, cls: "cell-on", title: `sub on ${app.subOnMin}'${words ? " — " + words : ""}` };
  if (app.subOffMin != null) return { sym: `◐${app.subOffMin}'${deco}`, cls: "cell-off", title: `subbed off ${app.subOffMin}'${words ? " — " + words : ""}` };
  return { sym: `●${deco}`, cls: "cell-start", title: `full match${words ? " — " + words : ""}` };
}

export default function TeamsTab({ data, update }) {
  const teamIds = Object.keys(data.teams);
  const [teamId, setTeamId] = useState(teamIds[0] || null);
  // Recover if teams arrived after mount (or the stored selection vanished).
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;

  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected))
    .sort((a, b) => a.kickoff - b.kickoff);

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === selected);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  const counts = new Map();
  for (const a of apps) counts.set(a.playerId, (counts.get(a.playerId) || 0) + 1);
  const playerIds = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  const toggle = (pid, field, value) => update((d) => setPlayerField(d, pid, field, value));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={selected || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        <span className="dim">● start · ◐ off · ○ on · ⚽ goal · 🥅 pen · 👟 assist</span>
      </div>
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr>
              <th>Player</th>
              {matches.map((m) => {
                const home = String(m.homeTeamId) === selected;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                return <th key={m.eventId} title={`${home ? "v" : "@"} ${opp}`}>R{matchRound(m)}</th>;
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => {
                const p = data.players[pid];
                return (
                  <tr key={pid}>
                    <td>
                      <button className={`mini-toggle ${p?.starred ? "" : "off"}`} title="watchlist"
                        onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
                      <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} title="in my squad"
                        onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
                      {" "}{p?.name || pid}
                    </td>
                    {matches.map((m) => {
                      const { sym, cls, title } = cellFor(byPlayerMatch.get(`${m.eventId}:${pid}`));
                      return <td key={m.eventId} className={cls} title={title}>{sym}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: PlayerDetail.jsx** — effective round in the appearance log: add `matchRound` to the store import and change `R{m?.round}` to `R{m ? matchRound(m) : "?"}`.

- [ ] **Step 4:** `npm test && npm run build` green. Commit:

```bash
git add src/components/TeamsTab.jsx src/components/PlayerDetail.jsx src/styles.css
git commit -m "feat: decorated teams grid with pens/cards, star+squad toggles, effective rounds"
```

---

### Task D: Deploy + user verification

- [ ] `git push`; watch the Actions run to success.
- [ ] User verifies on the live site: move a match to another round and back; re-import that match and confirm the override survives; Matches opens scrolled to the current gameweek; re-paste the fantasyloi table (Club Picture rows parse); Teams shows colours/emoji matching a known match; ⭐/🔵 from Teams reflect in the Players filters.
