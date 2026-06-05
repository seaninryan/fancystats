# fancystats Follow-ups 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Aligned Teams cells (symbol left, points pill right); per-cell absence marking replacing the weeks-based out-planner — click a cell, type a reason, Enter; clearable; retrospective; "out now" derived from upcoming absences.

**Architecture:** New top-level user-owned map `data.absences` keyed `"<eventId>:<playerId>"` → `{ note, setAt }`. Imports never touch it. Older stored data lacks the key → App normalises on load by shallow-merging over `emptyData()`. Legacy `flags` stay in the data but lose their UI (functions remain in store.js for data compatibility).

**Env:** prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task 1: Library (TDD)

**Files:** Modify `src/lib/store.js`; tests in `test/store.test.js`.

- [ ] **Step 1: failing tests — append to test/store.test.js** (add `setAbsence, getAbsence, playerOutNow` to its store imports):

```js
describe("absences", () => {
  it("set, read, overwrite and clear a per-match absence", () => {
    let d = setAbsence(importedFixture(), 100, 10, "ankle knock", NOW);
    expect(getAbsence(d, 100, 10)).toMatchObject({ note: "ankle knock", setAt: NOW });
    d = setAbsence(d, 100, 10, "ankle (4-6 wks)", NOW + 1);
    expect(getAbsence(d, 100, 10).note).toBe("ankle (4-6 wks)");
    d = setAbsence(d, 100, 10, null, NOW + 2);
    expect(getAbsence(d, 100, 10)).toBeNull();
  });
  it("absences survive re-import", () => {
    let d = setAbsence(importedFixture(), 100, 10, "suspended", NOW);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [], appearances: [],
    }, NOW + 5);
    expect(getAbsence(d, 100, 10).note).toBe("suspended");
  });
  it("playerOutNow reports the next upcoming absence, ignoring past ones", () => {
    let d = importedFixture();
    d.matches[700] = { eventId: 700, round: 9, kickoff: NOW + 7 * 86400000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    d.matches[701] = { eventId: 701, round: 10, kickoff: NOW + 14 * 86400000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    expect(playerOutNow(d, 10, NOW)).toBeNull();
    d = setAbsence(d, 100, 10, "was injured", NOW);      // past match — history only
    expect(playerOutNow(d, 10, NOW)).toBeNull();
    d = setAbsence(d, 701, 10, "World Cup", NOW);
    d = setAbsence(d, 700, 10, "World Cup", NOW);
    expect(playerOutNow(d, 10, NOW)).toMatchObject({ note: "World Cup", eventId: 700 }); // soonest upcoming
  });
  it("emptyData includes the absences map", () => {
    expect(emptyData().absences).toEqual({});
  });
});
```

- [ ] **Step 2: run, confirm failures.**

- [ ] **Step 3: implement in src/lib/store.js.**

a) `emptyData()` gains `absences: {},` alongside `adjustments`.

b) Append:

```js
// ---- per-match absences (user-owned; imports never touch them) ----
// Marked directly on grid cells: why a player misses/missed a given match.

export function setAbsence(data, eventId, playerId, note, now) {
  const next = structuredClone(data);
  next.absences = next.absences || {}; // pre-absences stored data
  const key = `${eventId}:${playerId}`;
  if (note) next.absences[key] = { note, setAt: now };
  else delete next.absences[key];
  return next;
}

export function getAbsence(data, eventId, playerId) {
  return data.absences?.[`${eventId}:${playerId}`] || null;
}

// "Out now" = has an absence on an upcoming (unplayed) match; returns the
// soonest one so lists can show the current reason.
export function playerOutNow(data, playerId, now = Date.now()) {
  let best = null;
  for (const [key, a] of Object.entries(data.absences || {})) {
    const [eventId, pid] = key.split(":");
    if (pid !== String(playerId)) continue;
    const m = data.matches[eventId];
    if (!m || m.kickoff <= now || m.status === "finished") continue;
    if (!best || m.kickoff < data.matches[best.eventId].kickoff) {
      best = { ...a, eventId: Number(eventId) };
    }
  }
  return best;
}
```

- [ ] **Step 4:** `npx vitest run` — 124 + 4 = 128 green. Commit:

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: per-match absence model"
```

---

### Task 2: Components

**Files:** Modify `src/App.jsx`, `src/components/TeamsTab.jssx` (TeamsTab.jsx), `src/components/PlayersTab.jsx`, `src/components/PlayerDetail.jsx`, `src/styles.css`.

- [ ] **Step 1: App.jsx — normalise loaded data** (migration for pre-absences saves). In the loading effect change:

```js
      .then((loaded) => { setData(loaded || emptyData()); setPhase("ready"); })
```
to:
```js
      .then((loaded) => { setData(loaded ? { ...emptyData(), ...loaded } : emptyData()); setPhase("ready"); })
```

(Shallow merge: any top-level key added in newer versions gets its default.)

- [ ] **Step 2: styles.css — append:**

```css
.cell-wrap { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 70px; }
.cell-click { cursor: pointer; }
.absence-bar { position: sticky; left: 0; }
```

- [ ] **Step 3: TeamsTab — aligned cells + per-cell absences.**

a) Store import: add `setAbsence, getAbsence, playerOutNow`; REMOVE `markOut, clearOut, activeFlag` (no longer used here). Delete the `OutEditor` component and the `outEdit` state, the 🚫 mini-toggle button, and the old out-window logic in upcoming cells.

b) New state + handlers near the top of the component:

```js
  const [absEdit, setAbsEdit] = useState(null); // { eventId, pid }
  const lastNoteFor = (pid) => {
    const mine = Object.entries(data.absences || {})
      .filter(([k]) => k.endsWith(`:${pid}`))
      .map(([, a]) => a)
      .sort((a, b) => b.setAt - a.setAt);
    return mine[0]?.note || "";
  };
```

c) Module-level editor bar (rendered between the controls row and the table whenever `absEdit` is set):

```jsx
function AbsenceBar({ ctx, existing, defaultNote, onSave, onClear, onClose }) {
  const [note, setNote] = useState(existing?.note ?? defaultNote);
  return (
    <form className="card row absence-bar" onSubmit={(e) => { e.preventDefault(); onSave(note); }}>
      <span>{ctx}</span>
      <input autoFocus placeholder="why are they out?" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <button className="primary" type="submit">OK</button>
      {existing && <button type="button" onClick={onClear}>Clear</button>}
      <button type="button" onClick={onClose}>✕</button>
    </form>
  );
}
```

Render slot (after the legend paragraph, before the table wrapper):

```jsx
      {absEdit && (() => {
        const m = data.matches[absEdit.eventId];
        const home = String(m.homeTeamId) === selected;
        const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
        const ctx = `${playerName(data.players[absEdit.pid])} · R${matchRound(m)} ${home ? "v" : "@"} ${opp}`;
        return (
          <AbsenceBar key={`${absEdit.eventId}:${absEdit.pid}`} ctx={ctx}
            existing={getAbsence(data, absEdit.eventId, absEdit.pid)}
            defaultNote={lastNoteFor(absEdit.pid)}
            onSave={(note) => {
              const now = Date.now();
              update((d) => setAbsence(d, absEdit.eventId, absEdit.pid, note.trim() || null, now));
              setAbsEdit(null);
            }}
            onClear={() => {
              const now = Date.now();
              update((d) => setAbsence(d, absEdit.eventId, absEdit.pid, null, now));
              setAbsEdit(null);
            }}
            onClose={() => setAbsEdit(null)} />
        );
      })()}
```

d) Played cells — align content and make appearance-less cells clickable (retrospective absences). The played-cell render becomes:

```jsx
                    {matches.map((m) => {
                      const key = `${m.eventId}:${pid}`;
                      const a = byPlayerMatch.get(key);
                      const adj = data.adjustments[key];
                      const absence = getAbsence(data, m.eventId, pid);
                      const { sym, cls, title } = cellFor(a, adj);
                      const pts = a && data.players[pid]?.gamePosition && m.goalTimes
                        ? scoreAppearance(a, m, data.players[pid].gamePosition, adj).total : null;
                      const winCls = windowIds.has(m.eventId) && win !== "all" ? " win-col" : "";
                      if (!a) {
                        return (
                          <td key={m.eventId} className={`cell-out cell-click${winCls}`}
                            title={absence ? absence.note : "didn't play — click to note why"}
                            onClick={() => setAbsEdit({ eventId: m.eventId, pid })}>
                            {absence ? "🚫" : "—"}
                          </td>
                        );
                      }
                      return (
                        <td key={m.eventId} className={`${cls}${winCls}`} title={title}>
                          <span className="cell-wrap"><span>{sym}</span><PtsPill pts={pts} /></span>
                        </td>
                      );
                    })}
```

e) Upcoming cells become absence-clickable:

```jsx
                    {upcoming.map((m) => {
                      const absence = getAbsence(data, m.eventId, pid);
                      return (
                        <td key={m.eventId} className="upcoming-col cell-click"
                          title={absence ? absence.note : "click to mark out"}
                          onClick={() => setAbsEdit({ eventId: m.eventId, pid })}>
                          {absence ? "🚫" : "·"}
                        </td>
                      );
                    })}
```

f) The row's name-cell out indicator: `const out = playerOutNow(data, pid, now);` → `{out ? <span title={out.note}>🚫 </span> : ""}` placed before the 🔥 marker. (The old activeFlag-based `out` is gone.)

- [ ] **Step 4: PlayersTab.** Store import: replace `activeFlag` with `playerOutNow`; the rows memo `out` becomes `out: playerOutNow(data, id),` (title usage `r.out.note` unchanged).

- [ ] **Step 5: PlayerDetail.** Replace the flags-based availability card with an absence list (keep showing legacy flags history beneath, read-only). Replace the `out`/`history` derivations and the card with:

```js
  const out = playerOutNow(data, playerId, now);
  const absences = Object.entries(data.absences || {})
    .filter(([k]) => k.endsWith(`:${playerId}`) || k.endsWith(`:${Number(playerId)}`))
    .map(([k, a]) => ({ ...a, eventId: Number(k.split(":")[0]) }))
    .sort((a, b) => (data.matches[a.eventId]?.kickoff || 0) - (data.matches[b.eventId]?.kickoff || 0));
  const legacyFlags = (p.flags || []);
```

```jsx
      {(absences.length > 0 || legacyFlags.length > 0) && (
        <div className="card">
          {absences.map((a) => {
            const m = data.matches[a.eventId];
            const future = m && m.kickoff > now && m.status !== "finished";
            return (
              <div key={a.eventId} className={future ? "" : "dim"}>
                🚫 R{m ? matchRound(m) : "?"} {fmtD(m?.kickoff)} — {a.note} <span className="dim">(mark/clear on the Teams page)</span>
              </div>
            );
          })}
          {legacyFlags.map((f, i) => (
            <div key={`f${i}`} className="dim">↳ {f.note || "out"} · {fmtD(f.setAt)} → {f.clearedAt ? fmtD(f.clearedAt) : f.until ? fmtD(f.until) : "…"} (legacy)</div>
          ))}
        </div>
      )}
```

(`activeFlag` import becomes unused here — remove it.)

- [ ] **Step 6:** `npm test && npm run build` (128 green). Commit:

```bash
git add src/App.jsx src/components/TeamsTab.jsx src/components/PlayersTab.jsx src/components/PlayerDetail.jsx src/styles.css
git commit -m "feat: per-cell absence marking with aligned team cells; retire weeks-based out-planner"
```

---

### Task 3: Deploy

- [ ] Bump package.json to 0.6.0, commit `chore: v0.6.0`, push, watch Actions, site 200.
- [ ] User verifies: Teams cells align (symbol left, pill right); clicking an upcoming cell opens the bar (autofocus, Enter saves) and paints 🚫; consecutive cells prefill the reason; clicking a 🚫 cell edits/clears; a past "—" cell takes a retrospective reason; 🚫-out indicator on Players/Teams reflects upcoming absences; player page lists absences read-only.
