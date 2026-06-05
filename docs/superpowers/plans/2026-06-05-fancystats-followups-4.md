# fancystats Follow-ups 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Cross-tab player navigation; Teams shows the full remaining season with out-planning (note + N weeks, 🚫 across affected upcoming cells); availability editing moves Teams-side (player page display-only); user-editable team colours; wrong-round date heuristics on Matches.

**Architecture:** App owns `openPlayerId` and passes `openPlayer(id)` to tabs; PlayerDetail renders as an overlay view. Flags gain optional `until` (timestamp); `activeFlag(p, now)` becomes time-aware (backward-compatible default). Teams records can carry a user-owned `colorBg` — `applyImport`/`upsertMatchStubs` must merge rather than replace team records. New store helper `roundSuspects(data)`.

**Env:** prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task 1: Library (TDD)

**Files:** Modify `src/lib/store.js`, `src/lib/teamColors.js`; tests in `test/store.test.js`, `test/teamColors.test.js`.

- [ ] **Step 1: failing tests — append to test/store.test.js** (add `setTeamColor, roundSuspects` to its store imports):

```js
describe("team customization", () => {
  it("setTeamColor sets and clears a user colour that survives sync and import", () => {
    let d = setTeamColor(importedFixture(), 1, "#123456");
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = upsertMatchStubs(d, [], [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }]);
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = applyImport(d, {
      match: { eventId: 101, round: 2, kickoff: 1, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0, goalTimes: { home: [], away: [] }, partial: false },
      teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }], players: [], appearances: [],
    }, NOW);
    expect(d.teams["1"].colorBg).toBe("#123456");
    d = setTeamColor(d, 1, null);
    expect(d.teams["1"].colorBg).toBeUndefined();
  });
});

describe("timed availability", () => {
  it("markOut with until expires automatically; expired flags are history", () => {
    const until = NOW + 14 * 86400000; // two weeks
    let d = markOut(importedFixture(), 10, "hamstring", NOW, until);
    expect(activeFlag(d.players["10"], NOW)).toMatchObject({ note: "hamstring", until });
    expect(activeFlag(d.players["10"], until + 1)).toBeNull(); // lapsed
    // lapsed flag doesn't block a new one
    d = markOut(d, 10, "suspended", until + 2);
    expect(activeFlag(d.players["10"], until + 2).note).toBe("suspended");
    expect(d.players["10"].flags).toHaveLength(2);
  });
  it("activeFlag without until stays active regardless of time (back-compat)", () => {
    const d = markOut(importedFixture(), 10, "long-term", NOW);
    expect(activeFlag(d.players["10"], NOW + 999 * 86400000)).toMatchObject({ note: "long-term" });
  });
});

describe("roundSuspects", () => {
  const DAY = 86400000;
  const mk = (eventId, round, day, extra = {}) => ({
    eventId, round, kickoff: NOW + day * DAY, status: "finished",
    homeTeamId: 1, awayTeamId: 2, homeScore: 0, awayScore: 0, ...extra,
  });
  it("flags a match dated with another round's cluster and suggests it", () => {
    const d = emptyData();
    [[100, 1, 0], [101, 1, 0], [102, 1, 1], [103, 1, 1]].forEach(([id, r, day]) => { d.matches[id] = mk(id, r, day); });
    [[200, 3, 14], [201, 3, 14], [202, 3, 15]].forEach(([id, r, day]) => { d.matches[id] = mk(id, r, day); });
    d.matches[999] = mk(999, 1, 14); // labelled R1, played with the R3 cluster
    const sus = roundSuspects(d);
    expect(sus.get(999)).toBe(3);
    expect(sus.has(100)).toBe(false);
  });
  it("ignores postponed shells and respects roundOverride", () => {
    const d = emptyData();
    d.matches[1] = mk(1, 1, 0);
    d.matches[2] = mk(2, 1, 0);
    d.matches[3] = mk(3, 3, 14);
    d.matches[4] = mk(4, 3, 14);
    d.matches[5] = { ...mk(5, 1, 14), roundOverride: 3 }; // user already fixed it
    d.matches[6] = mk(6, 1, 14, { status: "postponed" });  // shell, ignored
    const sus = roundSuspects(d);
    expect(sus.has(5)).toBe(false);
    expect(sus.has(6)).toBe(false);
  });
});
```

- [ ] **Step 2: failing test — append to test/teamColors.test.js:**

```js
  it("user colour override beats the club map, with luminance-based text", () => {
    expect(teamColor({ name: "Shamrock Rovers", colorBg: "#ffee00" })).toEqual({ bg: "#ffee00", fg: "#17222b" });
    expect(teamColor({ name: "Shamrock Rovers", colorBg: "#112233" }).fg).toBe("#ffffff");
  });
```

- [ ] **Step 3: run, confirm new failures.**

- [ ] **Step 4: implement.**

`src/lib/store.js`:

a) Team-record merges must preserve user fields — in BOTH `applyImport` and `upsertMatchStubs`, change the team write to:

```js
  for (const t of teams) next.teams[t.id] = { ...next.teams[t.id], name: t.name, shortName: t.shortName };
```

b) Append:

```js
export function setTeamColor(data, teamId, colorBg) {
  const next = structuredClone(data);
  const t = next.teams[teamId];
  if (!t) return data;
  if (colorBg) t.colorBg = colorBg;
  else delete t.colorBg;
  return next;
}
```

c) `markOut` gains an optional `until` (timestamp, null = indefinite) and uses the time-aware check:

```js
export function markOut(data, playerId, note, now, until = null) {
  const p0 = data.players[playerId];
  if (!p0) return data;
  if ((p0.flags || []).some((f) => isFlagActive(f, now))) return data; // already out — no change
  const next = structuredClone(data);
  const p = next.players[playerId];
  p.flags = p.flags || [];
  p.flags.push({ setAt: now, clearedAt: null, note: note || "", until });
  return next;
}
```

d) Time-aware `activeFlag` (default keeps old call sites working):

```js
const isFlagActive = (f, now) => !f.clearedAt && (f.until == null || f.until > now);

export const activeFlag = (p, now = Date.now()) =>
  p?.flags?.find((f) => isFlagActive(f, now)) || null;
```

e) Append `roundSuspects`:

```js
// Matches whose date sits clearly inside another round's date cluster — the
// SofaScore reschedule pattern. Returns Map<eventId, suggestedRound>.
export function roundSuspects(data) {
  const DAY = 86400000;
  const groups = new Map();
  for (const m of Object.values(data.matches)) {
    if (m.status === "postponed" || m.status === "canceled") continue;
    if (isSupersededPostponed(data, m)) continue;
    const r = matchRound(m);
    if (r == null) continue;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(m);
  }
  const medians = new Map();
  for (const [r, ms] of groups) {
    const ks = ms.map((m) => m.kickoff).sort((a, b) => a - b);
    medians.set(r, ks[Math.floor(ks.length / 2)]);
  }
  const suspects = new Map();
  for (const [r, ms] of groups) {
    for (const m of ms) {
      let best = r;
      let bestDist = Math.abs(m.kickoff - medians.get(r));
      for (const [r2, med] of medians) {
        if (r2 === r) continue;
        const d2 = Math.abs(m.kickoff - med);
        if (d2 < bestDist - 2 * DAY) { best = r2; bestDist = d2; } // clearly closer
      }
      if (best !== r) suspects.set(m.eventId, best);
    }
  }
  return suspects;
}
```

`src/lib/teamColors.js` — user override first, with luminance-picked text:

```js
function contrastFg(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#17222b" : "#ffffff";
}
```

and at the top of `teamColor`:

```js
  if (team?.colorBg) return { bg: team.colorBg, fg: contrastFg(team.colorBg) };
```

- [ ] **Step 5:** `npx vitest run` — 110 + 6 = 116 green. Commit:

```bash
git add src/lib/ test/
git commit -m "feat: timed flags, team colour overrides, wrong-round detection"
```

---

### Task 2: App-level player navigation

**Files:** Modify `src/App.jsx`, `src/components/PlayersTab.jsx`, `src/components/TeamsTab.jsx`.

- [ ] **Step 1: App.jsx.** Add state + import:

```js
import PlayerDetail from "./components/PlayerDetail.jsx";
...
const [openPlayerId, setOpenPlayerId] = useState(null);
```

In the ready-state render, replace `<Active data={data} update={update} />` with:

```jsx
        {openPlayerId && data.players[openPlayerId]
          ? <PlayerDetail data={data} update={update} playerId={openPlayerId} onBack={() => setOpenPlayerId(null)} />
          : <Active data={data} update={update} openPlayer={setOpenPlayerId} />}
```

Also clear the open player when switching tabs — the tab button onClick becomes `onClick={() => { setTab(key); setOpenPlayerId(null); }}`.

- [ ] **Step 2: PlayersTab.** Accept `openPlayer` prop; delete the local `openId` state, the `PlayerDetail` import, and the early-return block; row `onClick={() => openPlayer(r.id)}`.

- [ ] **Step 3: TeamsTab.** Accept `openPlayer` prop; the player-name text in each row becomes a navigable element:

```jsx
                      {" "}{out ? <span title={out.note}>🚫 </span> : ""}
                      <a role="link" tabIndex={0} style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                        onClick={() => openPlayer(String(pid))}
                        onKeyDown={(e) => e.key === "Enter" && openPlayer(String(pid))}>
                        {playerName(p) || pid}
                      </a>
```

(`String(pid)` — App looks players up by key; PlayersTab passes string ids, keep it consistent.)

- [ ] **Step 4:** `npm test && npm run build` (116 green). Commit:

```bash
git add src/App.jsx src/components/PlayersTab.jsx src/components/TeamsTab.jsx
git commit -m "feat: cross-tab player navigation"
```

---

### Task 3: Teams — full season, out-planning, colour editor; PlayerDetail display-only flags

**Files:** Modify `src/components/TeamsTab.jsx`, `src/components/PlayerDetail.jsx`.

- [ ] **Step 1: TeamsTab.**

a) Imports: add `markOut, clearOut, setTeamColor` to the store import.

b) Full season: the `upcoming` computation drops `.slice(0, 3)` (keep the sort and the gone-filter).

c) Colour editor next to the team select:

```jsx
        <input type="color" title="team colour (saves when you close the picker)"
          defaultValue={teamColor(data.teams[selected]).bg.startsWith("#") ? teamColor(data.teams[selected]).bg : "#888888"}
          key={selected}
          onBlur={(e) => update((d) => setTeamColor(d, selected, e.target.value))} />
        <button className="mini-toggle" title="reset to default colour"
          onClick={() => update((d) => setTeamColor(d, selected, null))}>↺</button>
```

(`key={selected}` re-seeds the defaultValue when the team changes. Import `teamColor` from `../lib/teamColors.js`.)

d) Out-planning UI. Component state: `const [outEdit, setOutEdit] = useState(null); // pid being edited`. Replace the 🚫 indicator in the name cell with a button that toggles the editor, and render the editor row content inline after the name when `outEdit === pid`:

```jsx
                      <button className={`mini-toggle ${out ? "" : "off"}`} aria-pressed={!!out}
                        title={out ? `out: ${out.note}` : "mark out"}
                        onClick={() => setOutEdit(outEdit === pid ? null : pid)}>🚫</button>
```

and directly under the `<a>…</a>` player link, still inside the name `<td>`:

```jsx
                      {outEdit === pid && (
                        <OutEditor out={out} onClose={() => setOutEdit(null)}
                          onMark={(note, weeks) => {
                            const now = Date.now();
                            const until = weeks ? now + weeks * 7 * 86400000 : null;
                            update((d) => markOut(d, pid, note, now, until));
                            setOutEdit(null);
                          }}
                          onClear={() => {
                            const now = Date.now();
                            update((d) => clearOut(d, pid, now));
                            setOutEdit(null);
                          }} />
                      )}
```

with a module-level editor component:

```jsx
function OutEditor({ out, onClose, onMark, onClear }) {
  const [note, setNote] = useState(out?.note || "");
  const [weeks, setWeeks] = useState("");
  return (
    <div className="row" style={{ marginTop: 4 }}>
      {out ? (
        <>
          <span className="dim">{out.note || "out"}{out.until ? ` (until ${new Date(out.until).toLocaleDateString("en-IE")})` : ""}</span>
          <button onClick={onClear}>Back available</button>
        </>
      ) : (
        <>
          <input placeholder="injured / suspended / away…" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 150 }} />
          <input type="number" min="1" max="40" placeholder="wks" title="weeks out (blank = indefinite)"
            value={weeks} onChange={(e) => setWeeks(e.target.value)} style={{ width: 55 }} />
          <button className="primary" onClick={() => onMark(note, Number(weeks) || 0)}>Save</button>
        </>
      )}
      <button onClick={onClose}>✕</button>
    </div>
  );
}
```

e) Upcoming cells show the out-plan — replace the trailing upcoming-cell render with:

```jsx
                    {upcoming.map((m) => (
                      <td key={m.eventId} className="upcoming-col"
                        title={out && (out.until == null || m.kickoff < out.until) ? out.note || "out" : ""}>
                        {out && (out.until == null || m.kickoff < out.until) ? "🚫" : "·"}
                      </td>
                    ))}
```

f) Time-aware lookup — where `out` is computed per row, use `activeFlag(p, now)` (the component already has `now`; add `activeFlag` to the store import if not present).

- [ ] **Step 2: PlayerDetail — display-only availability.** Replace the `AvailabilityCard` component and its render slot with a passive card (delete the old component):

```jsx
      {(out || history.length > 0) && (
        <div className="card">
          {out && <div>🚫 <b>{out.note || "out"}</b> <span className="dim">
            since {fmtD(out.setAt)}{out.until ? ` · until ${fmtD(out.until)}` : ""} — manage on the Teams page</span></div>}
          {history.map((f, i) => (
            <div key={i} className="dim">↳ {f.note || "out"} · {fmtD(f.setAt)} → {fmtD(f.clearedAt ?? f.until)}</div>
          ))}
        </div>
      )}
```

and update the derivations: `const out = activeFlag(p, now);` and history includes lapsed flags:

```js
  const history = (p.flags || []).filter((f) => f !== out && (f.clearedAt || (f.until && f.until <= now)));
```

(`markOut`/`clearOut` imports in PlayerDetail become unused — remove them.)

- [ ] **Step 3:** `npm test && npm run build` (116 green). Commit:

```bash
git add src/components/TeamsTab.jsx src/components/PlayerDetail.jsx
git commit -m "feat: full-season teams grid with out-planning and colour editor; passive availability card"
```

---

### Task 4: Matches — wrong-round flags

**Files:** Modify `src/components/MatchesTab.jsx`.

- [ ] **Step 1:** Add `roundSuspects` to the store import. Before the return, compute `const suspects = roundSuspects(data);`. In the row render, right after the date span, add:

```jsx
                {suspects.has(m.eventId) && (
                  <span className="loss" title={`date suggests Round ${suspects.get(m.eventId)} — use the selector to move it`}> ⚠R{suspects.get(m.eventId)}?</span>
                )}
```

- [ ] **Step 2:** `npm test && npm run build`. Commit:

```bash
git add src/components/MatchesTab.jsx
git commit -m "feat: flag matches whose date suggests a different round"
```

---

### Task 5: Deploy

- [ ] Bump package.json to 0.4.0, commit `chore: v0.4.0`, push, watch Actions, site 200.
- [ ] User verifies: tap a Teams player name → player page (alias editing) → back; full-season upcoming columns; 🚫 out-planning with weeks painting upcoming cells; colour picker recolours pills everywhere and survives a sync; player page availability is read-only; Matches shows ⚠R3? on the SHA–DUN replay (if not yet moved).
