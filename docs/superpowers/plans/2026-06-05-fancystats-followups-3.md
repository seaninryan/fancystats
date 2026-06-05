# fancystats Follow-ups 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Visible horizontal scrollbars; upcoming-fixture columns on Teams; result-points tooltip + W/D/L colours; team pills everywhere; position pills everywhere (+ Pos column on Teams); data-error flagging for players with appearances but no fantasy identity; display-name override + fantasyloi alias editing; smart suggestions for unmatched paste rows.

**Architecture:** New user-owned player field `customName` (display override; survives re-imports since imports only write `name`/`teamId`). Shared pill components in `src/components/Pills.jsx`. New lib helpers: `playerName`, `missingFantasyData` (store), `suggestLinks` (pasteImport, also teaches `matchPlayers` about customName).

**Env:** prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task 1: Library (TDD)

**Files:** Modify `src/lib/store.js`, `src/lib/pasteImport.js`; tests in `test/store.test.js`, `test/pasteImport.test.js`.

- [ ] **Step 1: failing tests — append to test/store.test.js** (add `playerName, missingFantasyData` to its store imports):

```js
describe("identity & data errors", () => {
  it("playerName prefers customName and survives re-import", () => {
    let d = setPlayerField(importedFixture(), 10, "customName", "Aidan Keena ✪");
    expect(playerName(d.players["10"])).toBe("Aidan Keena ✪");
    expect(playerName(d.players["11"])).toBe("B Burke");
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [{ id: 10, name: "A. Keena", teamId: 1 }], appearances: [],
    }, NOW + 1);
    expect(playerName(d.players["10"])).toBe("Aidan Keena ✪");
    expect(d.players["10"].name).toBe("A. Keena");
  });
  it("missingFantasyData flags players with appearances but no game position", () => {
    const d = importedFixture();
    const apps = playerAppearances(d, 10);
    expect(missingFantasyData(d.players["10"], apps)).toBe(true);
    const d2 = setPlayerField(d, 10, "gamePosition", "FWD");
    expect(missingFantasyData(d2.players["10"], apps)).toBe(false);
    expect(missingFantasyData(d.players["10"], [])).toBe(false); // no appearances, nothing to flag
  });
});
```

- [ ] **Step 2: failing tests — append to test/pasteImport.test.js** (add `suggestLinks` to its imports):

```js
describe("suggestLinks", () => {
  const players = {
    30: { name: "Pico", teamId: 1, pasteAlias: null },
    31: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    32: { name: "Aaron Greene", teamId: 1, pasteAlias: null },
  };
  it("ranks the shared-word candidate first (Pico Lopez → Pico)", () => {
    expect(suggestLinks("Pico Lopez", players)[0]).toBe("30");
  });
  it("matches on shared surname", () => {
    expect(suggestLinks("G. Burke", players)[0]).toBe("31");
  });
  it("returns empty for nothing similar", () => {
    expect(suggestLinks("Zlatan Ibrahimović", players)).toEqual([]);
  });
});

describe("matchPlayers with customName", () => {
  it("matches a paste row against the user's display-name override", () => {
    const players = { 30: { name: "Pico", customName: "Pico Lopez", teamId: 1, pasteAlias: null } };
    const { matched } = matchPlayers([{ name: "Pico Lopez", value: 4.5 }], players);
    expect(matched[0]?.playerId).toBe("30");
  });
});
```

- [ ] **Step 3: run both files, confirm new tests fail.**

- [ ] **Step 4: implement.**

`src/lib/store.js` — add `customName: null,` to `defaultPlayer`, and append:

```js
// Display name: the user's override wins (SofaScore short names like "Pico"
// don't always match fantasyloi's, and re-imports must not clobber the fix).
export const playerName = (p) => p?.customName || p?.name || "?";

// A player who appears in matches but has no game position earns no points in
// our model — almost always an unlinked fantasyloi identity. Surface it loudly.
export function missingFantasyData(player, apps) {
  return apps.length > 0 && !player?.gamePosition;
}
```

`src/lib/pasteImport.js`:

a) In `matchPlayers`, where `byFull` is built, also register the override:

```js
    byFull.set(normalizeName(p.name), [...(byFull.get(normalizeName(p.name)) || []), id]);
    if (p.customName) byFull.set(normalizeName(p.customName), [...(byFull.get(normalizeName(p.customName)) || []), id]);
```

(Adapt to the existing array-candidates structure — keep the duplicate-stays-unmatched behaviour.)

b) Append:

```js
// Candidate player ids for an unmatched paste row, best first. Shared words
// (surnames, nicknames) score highest; containment breaks ties.
export function suggestLinks(rowName, players) {
  const norm = normalizeName(rowName);
  const words = norm.split(" ").filter(Boolean);
  return Object.entries(players)
    .map(([id, p]) => {
      const pn = normalizeName(p.customName || p.name);
      if (!pn) return { id, score: 0 };
      if (pn === norm) return { id, score: 100 };
      const pWords = pn.split(" ").filter(Boolean);
      let score = words.filter((w) => pWords.includes(w)).length * 10;
      if (score && (norm.includes(pn) || pn.includes(norm))) score += 5;
      return { id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}
```

- [ ] **Step 5:** `npx vitest run` — expect 104 + 6 = 110 green. Commit:

```bash
git add src/lib/ test/
git commit -m "feat: display-name override, data-error helper, paste link suggestions"
```

---

### Task 2: Pills, CSS, Matches/Players/Settings wiring

**Files:** Create `src/components/Pills.jsx`; modify `src/styles.css`, `src/components/MatchesTab.jsx`, `src/components/PlayersTab.jsx`, `src/components/SettingsTab.jsx`.

- [ ] **Step 1: src/components/Pills.jsx:**

```jsx
import { teamColor } from "../lib/teamColors.js";

export function TeamPill({ team, label }) {
  const c = teamColor(team);
  return <span className="chip" style={{ background: c.bg, color: c.fg }}>{label ?? team?.shortName ?? "?"}</span>;
}

const POS_CLS = { GK: "pos-gk", DEF: "pos-def", MID: "pos-mid", FWD: "pos-fwd" };

export function PosPill({ pos }) {
  if (!pos) return <span className="dim">—</span>;
  return <span className={`chip ${POS_CLS[pos] || ""}`}>{pos}</span>;
}
```

- [ ] **Step 2: styles.css — append:**

```css
/* always-visible horizontal scrollbars on wide tables */
.scroll-x { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.scroll-x::-webkit-scrollbar { height: 8px; }
.scroll-x::-webkit-scrollbar-thumb { background: var(--line); border-radius: 4px; }

.pos-gk { background: #b8860b; color: #fff; }
.pos-def { background: #2563b8; color: #fff; }
.pos-mid { background: #1f7a4d; color: #fff; }
.pos-fwd { background: #c0392b; color: #fff; }

.err-cell { background: #fbdcd7; }
.upcoming-col { opacity: .55; }
.res-w { color: var(--accent); font-weight: 600; }
.res-d { color: var(--warn); font-weight: 600; }
.res-l { color: var(--err); font-weight: 600; }
```

- [ ] **Step 3: MatchesTab — team pills.** Import `{ TeamPill }` from `./Pills.jsx`. Replace the row label span body (`{team(m.homeTeamId)} {m.homeScore ?? ""}–{m.awayScore ?? ""} {team(m.awayTeamId)}…`) with:

```jsx
              <span style={{ flex: 1 }}>
                <TeamPill team={data.teams[m.homeTeamId]} /> {m.homeScore ?? ""}–{m.awayScore ?? ""} <TeamPill team={data.teams[m.awayTeamId]} />
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
              </span>
```

The old `team(id)` helper becomes unused — remove it.

- [ ] **Step 4: PlayersTab.** Import `{ PosPill }` from `./Pills.jsx` and add `playerName, missingFantasyData` to the store import. In the rows memo: `name: playerName(p)` (sorting/search then use the override automatically) and add `err: missingFantasyData(p, apps)`. Add `posRaw: p.gamePosition,` to the row object (keep the existing `pos` string — the position filter uses it). The Pos cell render becomes `<td><PosPill pos={r.posRaw} /> <MismatchMark mi={r.mi} /></td>`. The Pts cell becomes:

```jsx
                <td className={r.err ? "err-cell" : ""} title={r.err ? "No fantasy data — set a position or add their fantasyloi alias in the player view" : ""}>{r.err ? "❗" : r.points ?? "—"}</td>
```

- [ ] **Step 5: SettingsTab — suggested links first.** Import `suggestLinks` from `../lib/pasteImport.js`. Replace the unmatched-row `<select>` options with optgrouped suggestions:

```jsx
                <select value={preview.links[i] || ""}
                  onChange={(e) => setPreview({ ...preview, links: { ...preview.links, [i]: e.target.value || undefined } })}>
                  <option value="">skip</option>
                  {(() => {
                    const sugg = suggestLinks(u.name, data.players);
                    const all = Object.entries(data.players)
                      .filter(([id]) => !sugg.includes(id))
                      .sort((a, b) => (a[1].customName || a[1].name).localeCompare(b[1].customName || b[1].name));
                    return (
                      <>
                        {sugg.length > 0 && (
                          <optgroup label="Suggested">
                            {sugg.map((id) => <option key={id} value={id}>{data.players[id].customName || data.players[id].name} ({data.teams[data.players[id].teamId]?.shortName})</option>)}
                          </optgroup>
                        )}
                        <optgroup label="All players">
                          {all.map(([id, p]) => <option key={id} value={id}>{p.customName || p.name} ({data.teams[p.teamId]?.shortName})</option>)}
                        </optgroup>
                      </>
                    );
                  })()}
                </select>
```

- [ ] **Step 6:** `npm test && npm run build` (110 green). Commit:

```bash
git add src/components/Pills.jsx src/styles.css src/components/MatchesTab.jsx src/components/PlayersTab.jsx src/components/SettingsTab.jsx
git commit -m "feat: team/position pills, visible scrollbars, data-error flag, paste suggestions"
```

---

### Task 3: PlayerDetail identity editors + TeamsTab upcoming/pos/result colours

**Files:** Modify `src/components/PlayerDetail.jsx`, `src/components/TeamsTab.jsx`.

- [ ] **Step 1: PlayerDetail.**

a) Imports: add `playerName` to the store import; add `import { TeamPill, PosPill } from "./Pills.jsx";`.

b) Header `<h3>`: `{playerName(p)}` instead of `{p.name}`, and the club chip becomes `<TeamPill team={data.teams[p.teamId]} label={data.teams[p.teamId]?.name} />`.

c) New Identity card directly under the star/squad card:

```jsx
      <div className="card row">
        <label>Display name{" "}
          <input defaultValue={playerName(p)} style={{ width: 150 }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setField("customName", v && v !== p.name ? v : null);
            }} />
        </label>
        <label>fantasyloi alias{" "}
          <input defaultValue={p.pasteAlias || ""} placeholder="name used on fantasyloi" style={{ width: 170 }}
            onBlur={(e) => setField("pasteAlias", e.target.value.trim() || null)} />
        </label>
      </div>
```

(`defaultValue` + `onBlur` deliberately — one save per edit, not per keystroke.)

d) Positions card: wrap current values with pills — next to the Game pos select add `<PosPill pos={p.gamePosition} />`, next to Real pos add `<PosPill pos={p.realPosition || derived?.position} />`.

e) Appearance log: the opponent cell becomes a pill — replace the `R{...} {opp}` cell content with:

```jsx
                  <td>R{m ? matchRound(m) : "?"} {a.teamId === m?.homeTeamId ? "v" : "@"} <TeamPill team={data.teams[a.teamId === m?.homeTeamId ? m?.awayTeamId : m?.homeTeamId]} /></td>
```

(The old `opp` string-building line becomes unused — remove it.)

- [ ] **Step 2: TeamsTab.**

a) Imports: add `playerName, missingFantasyData` to the store import; `import { TeamPill, PosPill } from "./Pills.jsx";`.

b) Upcoming columns — after the `windowIds` line add:

```js
  const upcoming = Object.values(data.matches)
    .filter((m) => (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected)
      && m.kickoff > now && !gone(m))
    .sort((a, b) => a.kickoff - b.kickoff)
    .slice(0, 3);
```

(`nextMatch` becomes `upcoming[0]` — replace its computation and keep the next-fixture line, now rendering the opponent as `<TeamPill …/>`.)

c) Result points get colour + tooltip — replace `resultPts` with:

```js
  const RESULT_TIP = "team result points: win +2 · draw +1 · loss 0 (every appearing player gets them)";
  const resultPts = (m) => {
    const ours = String(m.homeTeamId) === selected ? m.homeScore : m.awayScore;
    const theirs = String(m.homeTeamId) === selected ? m.awayScore : m.homeScore;
    if (ours == null || theirs == null) return null;
    return ours > theirs ? { txt: "+2", cls: "res-w" } : ours === theirs ? { txt: "+1", cls: "res-d" } : { txt: "0", cls: "res-l" };
  };
```

Header `<th>` for played matches becomes:

```jsx
                return (
                  <th key={m.eventId} className={windowIds.has(m.eventId) && win !== "all" ? "win-col" : ""}
                    title={`${fmtD(m.kickoff)} — ${RESULT_TIP}`}>
                    R{matchRound(m)}
                    <span className="sub">{home ? "v" : "@"}{opp} {rp && <span className={rp.cls}>{rp.txt}</span>}</span>
                  </th>
                );
```

with `const rp = resultPts(m);` computed alongside `opp`.

After the played `<th>`s, render upcoming headers:

```jsx
              {upcoming.map((m) => {
                const home = String(m.homeTeamId) === selected;
                return (
                  <th key={m.eventId} className="upcoming-col" title={fmtD(m.kickoff)}>
                    R{matchRound(m)}
                    <span className="sub">{home ? "v" : "@"}{data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName}</span>
                  </th>
                );
              })}
```

d) Pos column — add `<th>Pos</th>` right after the Player `<th>` (before TOTAL_COLS), and in each row after the name cell:

```jsx
                    <td><PosPill pos={p?.gamePosition} /></td>
```

e) Per-row error flag — inside the row map (where `p` and `t` are computed), add `const err = missingFantasyData(p, apps.filter((x) => x.playerId === pid));` and the totals Pts cell becomes:

```jsx
                    <td className={err ? "err-cell" : ""} title={err ? "No fantasy data — set a position or add their fantasyloi alias in the player view" : ""}>{err ? "❗" : t.points ?? "—"}</td>
```

f) Row name cell: `{playerName(p) || pid}` instead of `{p?.name || pid}`. Add empty upcoming cells at the end of each row:

```jsx
                    {upcoming.map((m) => <td key={m.eventId} className="upcoming-col">·</td>)}
```

- [ ] **Step 3:** `npm test && npm run build` (110 green). Commit:

```bash
git add src/components/PlayerDetail.jsx src/components/TeamsTab.jsx
git commit -m "feat: identity editors, teams upcoming columns, result colours, pos pills, error flags"
```

---

### Task 4: Deploy + verify

- [ ] Bump package.json version to 0.3.0, commit `chore: v0.3.0`, `git push`, watch Actions, site 200.
- [ ] User verifies: scrollbar visible; 3 upcoming columns; +2 tooltip & W/D/L colours; pills everywhere; Pos column; Pico shows ❗ → set alias "Pico Lopez" + display name, re-paste, prices land.
