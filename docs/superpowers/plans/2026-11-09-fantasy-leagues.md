# Fantasy Leagues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the user's private fantasy mini-leagues (standings for every gameweek, opponents' latest teams) in the Fantasy sync and show them in a Leagues tab.

**Architecture:** The existing Fantasy sync snippet gains a leagues step; `parseSyncBlob`/`applySiteSync` carry the new raw fields into `data.site[seasonId]`; `src/lib/leagues.js` derives standings, race series and squad comparisons from a season view; a new LeaguesTab renders them, sharing a `TeamLines` component with MyTeamTab.

**Tech Stack:** React 18, Vite, Vitest (node env, SSR smoke tests), recharts via `GameweekChart`.

**Spec:** `docs/superpowers/specs/2026-11-09-fantasy-leagues-design.md` (read it first).

## Ground rules for every task

- Prefix every npm/npx command with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" &&`.
- Pure logic in `src/lib/` with tests; thin components. Nothing derived stored. Season views only for site data.
- TDD: write the test, see it fail, implement, see it pass. Run `npm test && npm run build` before committing.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Snippet — capture leagues and opponents

**Files:** Modify `src/lib/fantasyImport.js` (`buildSyncSnippet`); Test `test/fantasyImport.test.js`

- [ ] **Step 1: Failing tests.** In the `describe("buildSyncSnippet", …)` block add:

```js
  it("captures your leagues, private standings for every period and opponents' teams", () => {
    for (const s of ['load("/Leagues")', "leagueCode=", "&period=", "yourLeagues", "opponents", "#details", "me: { details: myDetails }"]) {
      expect(snip).toContain(s);
    }
  });
```

- [ ] **Step 2:** run `npx vitest run test/fantasyImport.test.js` → FAIL.

- [ ] **Step 3: Implement.** Inside the snippet template literal (keep the doubled-backslash convention — the new code below has no backslashes):

(a) Replace the body of the step-3 gameweek loop's parsing with a shared `parseTeam` helper. Directly after the `card` helper, add:

```js
    const parseTeam = (doc) => {
      const pitch = doc.querySelector(".pitch");
      if (!pitch) return null;
      const lines = [...pitch.children].map((row) => [...row.querySelectorAll("[onclick^=playerScore]")].map(card).filter(Boolean)).filter((l) => l.length);
      const bench = [...doc.querySelectorAll("[onclick^=playerScore]")].filter((el) => !pitch.contains(el)).map(card).filter(Boolean);
      const all = lines.flat().concat(bench);
      if (!all.length) return null;
      const h = [...doc.querySelectorAll("h2")].find((x) => /Points/.test(x.textContent));
      const g = { lines: lines.map((l) => l.map((x) => x.id)), bench: bench.map((x) => x.id),
        captain: (all.find((x) => x.captain) || {}).id || null, shown: {}, names: {}, total: h ? num(h.textContent) : null };
      for (const x of all) { g.shown[x.id] = x.pts; g.names[x.id] = x.name; }
      return { g, all };
    };
    // Team Details modal: <label><strong>Key: </strong>value</label>
    const details = (doc) => {
      const out = {};
      const box = doc.querySelector("#details");
      if (box) for (const l of box.querySelectorAll("label")) {
        const k = txt(l.querySelector("strong"));
        if (k) out[k.replace(/:$/, "")] = txt(l).slice(k.length).trim();
      }
      return out;
    };
```

and change the loop to:

```js
    const myTeam = {}, squadIds = new Map();
    let myDetails = {};
    for (const gw of gws) {
      const doc = gw === 1 ? first : await load("/Results?teamId=" + TEAM + "&gameweek=" + gw);
      if (gw !== 1 && !doc.querySelector("select option")) throw new Error("couldn't read your Results page for GW " + gw + " — session expired? log in and re-run");
      const t = parseTeam(doc);
      if (!t) continue;
      for (const x of t.all) { ids.add(x.id); squadIds.set(x.name, x.id); }
      myTeam[gw] = t.g;
      myDetails = details(doc);
      say("your team — GW " + gw + ": " + (t.g.total == null ? "?" : t.g.total) + " pts");
    }
```

(b) After the "squad players aren't on Transfers" line and before `// 4. every player's season`, insert:

```js
    // 5. your leagues: positions everywhere; full standings and opponents' latest teams for private ones
    const lp = await load("/Leagues");
    const globalCodes = new Set(), yourLeagues = [];
    const codeOf = (a) => { try { return new URL(a.getAttribute("href"), location.href).searchParams.get("leagueCode"); } catch (e) { return null; } };
    for (const t of lp.querySelectorAll("table")) {
      const head = [...t.querySelectorAll("th")].map(txt);
      for (const tr of t.querySelectorAll("tr")) {
        const a = tr.querySelector("a[href*=leagueCode]");
        const code = a ? codeOf(a) : null;
        if (!code) continue;
        if (head[0] === "League") yourLeagues.push({ code: code, name: txt(tr.cells[0]), position: num(txt(tr.cells[1])) });
        else if (!head.length) globalCodes.add(code);
      }
    }
    if (!yourLeagues.length) throw new Error("couldn't read your Leagues page — log in and re-run");
    for (const l of yourLeagues) l.private = !globalCodes.has(l.code) && l.code !== "Overall";
    const leagues = {}, rivals = new Map();
    for (const l of yourLeagues.filter((x) => x.private)) {
      const lg = { name: l.name, periods: {} };
      for (const p of ["Overall"].concat(gws)) {
        const doc = await load("/Leagues?leagueCode=" + encodeURIComponent(l.code) + "&period=" + p);
        const table = [...doc.querySelectorAll("table")].find((t) => txt(t.querySelector("th")) === "#");
        if (!table) throw new Error("couldn't read league " + l.name + " (" + p + ") — log in and re-run");
        lg.periods[p] = [...table.querySelectorAll("tr")].map((tr) => {
          const a = tr.querySelector("a[href*=teamId]");
          const m = a ? (a.getAttribute("href").match(/teamId=([0-9]+)/) || []) : [];
          const id = m[1] ? Number(m[1]) : null;
          if (id && id !== TEAM) rivals.set(id, txt(a));
          return [num(txt(tr.cells[0])), id, a ? txt(a) : "", num(txt(tr.cells[2]))];
        }).filter((r) => r[1]);
      }
      leagues[l.code] = lg;
      say("league " + l.name + ": " + lg.periods.Overall.length + " managers");
    }
    const opponents = {};
    const myGws = Object.keys(myTeam).map(Number);
    if (myGws.length) {
      const latest = Math.max.apply(null, myGws);
      for (const [tid, manager] of rivals) {
        const doc = await load("/Results?teamId=" + tid + "&gameweek=" + latest);
        const t = parseTeam(doc);
        opponents[tid] = { manager: manager, gw: latest, team: t ? t.g : null, details: details(doc) };
        if (t) for (const x of t.all) ids.add(x.id);
      }
      say("opponents' teams: " + rivals.size);
    }
```

Note: the regex `/teamId=([0-9]+)/` deliberately avoids `\d` so no backslash escaping is needed inside the template literal.

(c) Extend the blob:

```js
    const blob = { meta: { source: "fantasyloi-sync", version: 1, capturedAt: Date.now(), siteTeamId: TEAM, clubs: clubs, failed: failed },
      players: [...rows.values()], history: history, myTeam: myTeam,
      yourLeagues: yourLeagues, leagues: leagues, opponents: opponents, me: { details: myDetails } };
```

and add `", " + Object.keys(leagues).length + " leagues"` to the final "done" message after the gameweeks count.

- [ ] **Step 4:** `npm test && npm run build` → PASS (incl. the existing `new Function(snip)` validity test).
- [ ] **Step 5: Commit** `feat: sync snippet captures private leagues (every period) and opponents' latest teams`.

---

### Task 2: Parse and store the league data

**Files:** Modify `src/lib/fantasyImport.js` (`parseSyncBlob`), `src/lib/store.js` (`applySiteSync`); Test `test/fantasyImport.test.js`, `test/store.test.js`

- [ ] **Step 1: Failing tests.** In `describe("parseSyncBlob", …)`:

```js
  it("carries leagues, opponents and your Team Details, defaulting when absent (older files)", () => {
    const r = parseSyncBlob(blob({
      yourLeagues: [{ code: "abc", name: "Mini", position: 2, private: true }],
      leagues: { abc: { name: "Mini", periods: { Overall: [[1, 9, "X", 50]] } } },
      opponents: { "9": { manager: "X", gw: 1, team: null, details: {} } },
      me: { details: { "Team Name": "Mine" } },
    }));
    expect(r.yourLeagues[0].code).toBe("abc");
    expect(r.leagues.abc.periods.Overall[0][3]).toBe(50);
    expect(r.opponents["9"].manager).toBe("X");
    expect(r.me.details["Team Name"]).toBe("Mine");
    const old = parseSyncBlob(blob());
    expect(old.yourLeagues).toEqual([]);
    expect(old.leagues).toEqual({});
    expect(old.opponents).toEqual({});
    expect(old.me).toEqual({});
  });
```

In `test/store.test.js` `describe("applySiteSync", …)`: update the first test's expected `site[...]` object to also include `yourLeagues: [], leagues: {}, opponents: {}, me: {}`, and add:

```js
  it("stores league data with the site season", () => {
    const d = applySiteSync(importedFixture(), parsed({
      yourLeagues: [{ code: "abc", name: "Mini", position: 1, private: true }],
      leagues: { abc: { name: "Mini", periods: {} } }, opponents: { "9": { manager: "X" } }, me: { details: { a: "b" } },
    }), rows, NOW);
    const s = d.site[d.meta.seasonId];
    expect(s.yourLeagues[0].name).toBe("Mini");
    expect(s.leagues.abc.name).toBe("Mini");
    expect(s.opponents["9"].manager).toBe("X");
    expect(s.me.details.a).toBe("b");
  });
```

- [ ] **Step 2:** run the two files → FAIL.
- [ ] **Step 3: Implement.** `parseSyncBlob` return object gains:

```js
    yourLeagues: Array.isArray(blob.yourLeagues) ? blob.yourLeagues : [],
    leagues: obj(blob.leagues),
    opponents: obj(blob.opponents),
    me: obj(blob.me),
```

`applySiteSync`'s stored season object gains:

```js
      yourLeagues: parsed.yourLeagues ?? [], leagues: parsed.leagues ?? {},
      opponents: parsed.opponents ?? {}, me: parsed.me ?? {},
```

(Other tests that build `parsed` objects without these fields must keep passing — the `??` defaults cover them.)

- [ ] **Step 4:** `npm test && npm run build` → PASS. **Step 5: Commit** `feat: parse and store league standings, opponents and team details from the sync`.

---

### Task 3: `teamLines` + `src/lib/leagues.js`

**Files:** Modify `src/lib/myTeam.js`; Create `src/lib/leagues.js`; Test `test/leagues.test.js` (new). Existing `test/myTeam.test.js` must keep passing.

- [ ] **Step 1: Failing tests.** Create `test/leagues.test.js`:

```js
// test/leagues.test.js
import { describe, it, expect } from "vitest";
import { emptyData, applyImport, applySiteSync } from "../src/lib/store.js";
import { seasonView } from "../src/lib/seasons.js";
import { teamLines } from "../src/lib/myTeam.js";
import { ordinal, leaguePositions, privateLeagues, leagueStandings, leagueRace, opponentTeam, squadComparison } from "../src/lib/leagues.js";

const NOW = 1765000000000;
const ME = 7378;
const team = (ids, captain, total) => ({
  lines: [[ids[0]], [ids[1]], [ids[2]], [ids[3]]], bench: [ids[4]], captain,
  shown: Object.fromEntries(ids.map((id) => [id, 2])), names: Object.fromEntries(ids.map((id) => [id, `P${id}`])), total,
});
function view(extra = {}) {
  const d0 = applyImport(emptyData(), {
    match: { eventId: 100, round: 1, kickoff: NOW - 1e6, status: "finished", homeTeamId: 1, awayTeamId: 2,
      homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [],
  }, NOW);
  const d = applySiteSync(d0, {
    capturedAt: NOW, siteTeamId: ME, clubs: [], players: [], history: {},
    myTeam: { "2": team([1, 2, 3, 501, 5], 501, 60) },
    yourLeagues: [
      { code: "Overall", name: "Overall League", position: 50, private: false },
      { code: "Galway United", name: "Galway United", position: 3, private: false },
      { code: "abc", name: "Mini", position: 1, private: true },
    ],
    leagues: { abc: { name: "Mini", periods: {
      Overall: [[1, ME, "Sean", 100], [2, 8, "Billy", 95], [3, 9, "Alfie", 90]],
      "1": [[1, 8, "Billy", 60], [2, ME, "Sean", 40], [3, 9, "Alfie", 30]],
      "2": [[1, ME, "Sean", 60], [2, 9, "Alfie", 60], [3, 8, "Billy", 35]],
    } } },
    opponents: { "8": { manager: "Billy", gw: 2, team: team([1, 2, 7, 501, 9], 7, 35), details: { "Triple Captain Used": "Yes" } } },
    me: { details: {} },
    ...extra,
  }, [{ playerId: "10", siteId: 501 }], NOW);
  return seasonView(d, d.meta.seasonId);
}

describe("leagues", () => {
  it("ordinal", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 50, 101].map(ordinal))
      .toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "50th", "101st"]);
  });
  it("positions in every league, and the private ones with sizes", () => {
    expect(leaguePositions(view()).map((l) => `${l.name}:${l.position}`)).toEqual(["Overall League:50", "Galway United:3", "Mini:1"]);
    expect(privateLeagues(view())).toEqual([{ code: "abc", name: "Mini", myRank: 1, size: 3 }]);
  });
  it("standings with latest gameweek points, movement and gap", () => {
    const s = leagueStandings(view(), "abc");
    expect(s.map((r) => [r.rank, r.manager, r.gwPoints, r.total, r.gap, r.move, r.isMe])).toEqual([
      [1, "Sean", 60, 100, 0, 1, true],     // before GW2: Billy 60, Sean 40, Alfie 30 -> Sean was 2nd
      [2, "Billy", 35, 95, -5, -1, false],  // was 1st
      [3, "Alfie", 60, 90, -10, 0, false],  // was 3rd
    ]);
    expect(s[0].gw).toBe(2);
    expect(leagueStandings(view(), "nope")).toEqual([]);
  });
  it("race series per manager per gameweek", () => {
    const r = leagueRace(view(), "abc");
    expect(r.map((x) => x.manager)).toEqual(["Sean", "Billy", "Alfie"]);
    expect(r[1].points).toEqual([{ round: 1, value: 60 }, { round: 2, value: 35 }]);
  });
  it("an opponent's team, built like mine", () => {
    const t = opponentTeam(view(), 8);
    expect(t.manager).toBe("Billy");
    expect(t.total).toBe(35);
    expect(t.lines.map((l) => l.label)).toEqual(["GK", "DEF", "MID", "FWD"]);
    expect(t.lines[3].players[0]).toMatchObject({ siteId: 501, playerId: "10", name: "A Keena" });
    expect(t.details["Triple Captain Used"]).toBe("Yes");
    expect(opponentTeam(view(), 9)).toBe(null);
  });
  it("squad comparison against my latest gameweek", () => {
    const c = squadComparison(view(), 8);
    expect([...c.shared].sort()).toEqual([1, 2, 501]);
    expect([...c.theirsOnly].sort()).toEqual([7, 9]);
    expect(c.mineOnly.map((e) => e.siteId).sort()).toEqual([3, 5]);
    expect(c.myCaptain).toBe(501);
    expect(c.theirCaptain).toBe(7);
  });
  it("teamLines builds lines and bench from a raw team", () => {
    const t = teamLines(view(), team([1, 2, 3, 501, 5], 501, 60));
    expect(t.total).toBe(60);
    expect(t.bench.map((e) => e.siteId)).toEqual([5]);
    expect(t.lines[3].players[0].captain).toBe(true);
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** In `src/lib/myTeam.js`, extract the body of `myTeamGameweek` into an exported `teamLines(view, g)` that returns `{ total, lines, bench }` (same entry builder: siteId, playerId via `player.siteId`, name = linked player's name or `g.names[sid]` or `#sid`, points from `g.shown`, captain), and make `myTeamGameweek` return `g ? { gw: Number(gw), ...teamLines(view, g) } : null`.

Create `src/lib/leagues.js`:

```js
// src/lib/leagues.js
// Private fantasy mini-leagues, from the season's site data (view.site, stored raw by
// applySiteSync from the Fantasy sync). Season views only. Standings rows from the site are
// [rank, teamId, manager, points], per period ("Overall" or a gameweek number).
import { teamLines, myTeamGameweeks } from "./myTeam.js";

const siteOf = (view) => view.site || {};

export function ordinal(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th";
  return `${n}${suffix}`;
}

export function leaguePositions(view) {
  return (siteOf(view).yourLeagues || []).filter((l) => l.position != null)
    .map((l) => ({ code: l.code, name: l.name, position: l.position, private: !!l.private }));
}

export function privateLeagues(view) {
  const leagues = siteOf(view).leagues || {};
  return (siteOf(view).yourLeagues || []).filter((l) => l.private && leagues[l.code])
    .map((l) => ({ code: l.code, name: leagues[l.code].name || l.name, myRank: l.position,
      size: (leagues[l.code].periods?.Overall || []).length }));
}

const gameweeksOf = (lg) => Object.keys(lg?.periods || {}).filter((p) => p !== "Overall")
  .map(Number).filter(Number.isFinite).sort((a, b) => a - b);

// Rows by rank: { rank, move, teamId, manager, gwPoints, total, gap, isMe, gw }.
// move = previous rank - rank, previous rank = competition rank by total before the latest gameweek.
export function leagueStandings(view, code) {
  const lg = siteOf(view).leagues?.[code];
  const overall = lg?.periods?.Overall;
  if (!overall?.length) return [];
  const played = gameweeksOf(lg).filter((g) => (lg.periods[g] || []).length);
  const gw = played.length ? played[played.length - 1] : null;
  const gwPts = new Map((gw != null ? lg.periods[gw] : []).map(([, id, , pts]) => [id, pts]));
  const me = Number(siteOf(view).siteTeamId);
  const rows = overall.map(([rank, teamId, manager, total]) => ({
    rank, teamId, manager, total, gwPoints: gwPts.get(teamId) ?? null, isMe: teamId === me,
  }));
  const before = (r) => r.total - (r.gwPoints ?? 0);
  const myTotal = rows.find((r) => r.isMe)?.total ?? null;
  return rows
    .map((r) => ({
      ...r,
      gw,
      move: gw == null ? 0 : 1 + rows.filter((o) => before(o) > before(r)).length - r.rank,
      gap: myTotal == null ? null : r.total - myTotal,
    }))
    .sort((a, b) => a.rank - b.rank);
}

// One series per manager in the Overall table: per-gameweek points (null when absent).
export function leagueRace(view, code) {
  const lg = siteOf(view).leagues?.[code];
  if (!lg?.periods?.Overall) return [];
  const gws = gameweeksOf(lg);
  const byGw = gws.map((g) => new Map((lg.periods[g] || []).map(([, id, , pts]) => [id, pts])));
  return lg.periods.Overall.map(([, teamId, manager]) => ({
    teamId, manager, points: gws.map((g, i) => ({ round: g, value: byGw[i].get(teamId) ?? null })),
  }));
}

export function opponentTeam(view, teamId) {
  const o = siteOf(view).opponents?.[teamId];
  if (!o?.team) return null;
  return { manager: o.manager, gw: o.gw, details: o.details || {}, ...teamLines(view, o.team) };
}

const squadIds = (t) => new Set([...(t.lines || []).flat(), ...(t.bench || [])].map(Number));

// Their latest team vs my latest captured gameweek (lines + bench).
export function squadComparison(view, teamId) {
  const theirs = siteOf(view).opponents?.[teamId]?.team;
  const gws = myTeamGameweeks(view);
  const mine = gws.length ? siteOf(view).myTeam[gws[gws.length - 1]] : null;
  if (!theirs || !mine) return null;
  const a = squadIds(mine), b = squadIds(theirs);
  const mineLines = teamLines(view, mine);
  return {
    shared: new Set([...b].filter((x) => a.has(x))),
    theirsOnly: new Set([...b].filter((x) => !a.has(x))),
    mineOnly: [...mineLines.lines.flatMap((l) => l.players), ...mineLines.bench].filter((e) => !b.has(e.siteId)),
    myCaptain: mine.captain ?? null,
    theirCaptain: theirs.captain ?? null,
  };
}
```

- [ ] **Step 4:** `npm test && npm run build` → PASS. **Step 5: Commit** `feat: leagues lib — standings with movement, race series, opponent teams, squad comparison`.

---

### Task 4: UI — TeamLines, My Team header, Leagues tab

**Files:** Create `src/components/TeamLines.jsx`, `src/components/LeaguesTab.jsx`; Modify `src/components/MyTeamTab.jsx`, `src/App.jsx`; Test `test/leaguesTab.test.jsx` (new); `test/myTeamTab.test.jsx` must keep passing.

- [ ] **Step 1: Failing tests.** Create `test/leaguesTab.test.jsx` reusing the same `view()` fixture as `test/leagues.test.js` (copy the fixture code — `team`, `view`, constants — into this file):

```jsx
import { renderToStaticMarkup } from "react-dom/server";
import LeaguesTab from "../src/components/LeaguesTab.jsx";
import MyTeamTab from "../src/components/MyTeamTab.jsx";
// ...fixture copied from test/leagues.test.js...

describe("LeaguesTab SSR", () => {
  it("points to Settings without league data", () => {
    const d = emptyData();
    expect(renderToStaticMarkup(<LeaguesTab data={seasonView(d, d.meta.seasonId)} openPlayer={() => {}} />)).toContain("Fantasy sync");
  });
  it("shows the first private league's standings and race", () => {
    const html = renderToStaticMarkup(<LeaguesTab data={view()} openPlayer={() => {}} />);
    expect(html).toContain("Mini");
    expect(html).toContain("Billy");
    expect(html).toContain("Alfie");
    expect(html).toContain("GW 2");
    expect(html).toContain("Cumulative");
  });
});

describe("MyTeamTab header", () => {
  it("lists league positions", () => {
    const html = renderToStaticMarkup(<MyTeamTab data={view()} openPlayer={() => {}} />);
    expect(html).toContain("50th overall");
    expect(html).toContain("3rd Galway United");
    expect(html).toContain("1st Mini");
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.**

`src/components/TeamLines.jsx` — move `Entry` and the lines/bench markup out of MyTeamTab:

```jsx
// src/components/TeamLines.jsx — a fantasy team's XI rows + bench (My Team, Leagues).
import { PtsPill } from "./Pills.jsx";

function Entry({ e, openPlayer, badge }) {
  const name = e.playerId
    ? <span className="cell-click" style={{ textDecoration: "underline dotted" }} onClick={() => openPlayer(e.playerId)}>{e.name}</span>
    : <span title="not linked to a SofaScore player">{e.name}</span>;
  return (
    <span className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {badge ? badge(e) : null}{name}{e.captain ? <strong> (c)</strong> : null}<PtsPill pts={e.points} />
    </span>
  );
}

// team: { lines: [{label, players}], bench } from teamLines(); badge(entry) -> optional node
export default function TeamLines({ team, openPlayer, badge = null }) {
  return (
    <div className="card">
      {team.lines.map((l, i) => (
        <div key={i} className="row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
          <span className="dim" style={{ width: "3rem" }}>{l.label}</span>
          {l.players.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} badge={badge} />)}
        </div>
      ))}
      <div className="row" style={{ flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
        <span className="dim" style={{ width: "3rem" }}>Bench</span>
        {team.bench.map((e) => <Entry key={e.siteId} e={e} openPlayer={openPlayer} badge={badge} />)}
      </div>
    </div>
  );
}
```

`MyTeamTab.jsx`: remove `Entry` and the inline lines card; render `<TeamLines team={t} openPlayer={openPlayer} />`. Above the gameweek card add the positions line:

```jsx
      {positions.length > 0 && (
        <p className="dim">{positions.map((p) => `${ordinal(p.position)} ${p.code === "Overall" ? "overall" : p.name}`).join(" · ")}</p>
      )}
```

with `const positions = leaguePositions(data);` and imports from `../lib/leagues.js`. (Render it in the empty state too? No — only when a team exists.)

`src/components/LeaguesTab.jsx`:

```jsx
// src/components/LeaguesTab.jsx — private fantasy mini-leagues (from Fantasy sync).
import { useState } from "react";
import { privateLeagues, leagueStandings, leagueRace, opponentTeam, squadComparison } from "../lib/leagues.js";
import GameweekChart from "./GameweekChart.jsx";
import TeamLines from "./TeamLines.jsx";

const COLORS = ["#0e7a3c", "#c8102e", "#1f5fbf", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f", "#57534e", "#b45309"];
const moveText = (m) => (m > 0 ? `▲${m}` : m < 0 ? `▼${-m}` : "–");

export default function LeaguesTab({ data, openPlayer }) {
  const leagues = privateLeagues(data);
  const [picked, setPicked] = useState(null);
  const [rival, setRival] = useState(null);
  const [cumulative, setCumulative] = useState(true);
  if (!leagues.length) {
    return <p className="dim">No league data yet — run the Fantasy sync on the ⚙ Settings tab.</p>;
  }
  const code = leagues.some((l) => l.code === picked) ? picked : leagues[0].code;
  const rows = leagueStandings(data, code);
  const gw = rows[0]?.gw;
  const series = leagueRace(data, code).map((s, i) => ({
    key: String(s.teamId), label: s.manager, color: COLORS[i % COLORS.length], points: s.points,
  }));
  const opp = rival != null ? opponentTeam(data, rival) : null;
  const cmp = rival != null ? squadComparison(data, rival) : null;
  return (
    <div>
      <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        {leagues.map((l) => (
          <button key={l.code} className={l.code === code ? "primary" : ""} onClick={() => { setPicked(l.code); setRival(null); }}>
            {l.name} <span className="dim">({l.myRank ?? "?"}/{l.size})</span>
          </button>
        ))}
      </div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>#</th><th title="places moved since the previous gameweek">±</th><th>Manager</th>
            <th>{gw != null ? `GW ${gw}` : "GW"}</th><th>Total</th><th title="points behind (−) or ahead of you">Gap</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className={r.isMe ? "row-me" : "cell-click"} style={r.isMe ? { fontWeight: 600 } : undefined}
                onClick={() => !r.isMe && setRival(r.teamId === rival ? null : r.teamId)}>
                <td>{r.rank}</td><td className="dim">{moveText(r.move)}</td><td>{r.manager}{r.isMe ? " (you)" : ""}</td>
                <td>{r.gwPoints ?? "—"}</td><td>{r.total}</td><td>{r.gap == null || r.isMe ? "" : r.gap > 0 ? `+${r.gap}` : r.gap}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dim" style={{ margin: "6px 0 0" }}>Click a manager to compare their team with yours.</p>
      </div>
      {opp && (
        <div>
          <h3>{opp.manager}{opp.details["Team Name"] ? ` — ${opp.details["Team Name"]}` : ""} <span className="dim">GW {opp.gw}: {opp.total ?? "—"} pts</span></h3>
          <p className="dim">
            {["Triple Captain Used", "Full Squad Counts Used", "Unlimited Transfers Used"]
              .filter((k) => opp.details[k] != null).map((k) => `${k.replace(" Used", "")}: ${opp.details[k]}`).join(" · ")}
          </p>
          <TeamLines team={opp} openPlayer={openPlayer}
            badge={(e) => (cmp?.shared.has(e.siteId) ? <span title="you have him too">🔵</span> : <span title="differential — you don't have him">◆</span>)} />
          {cmp && cmp.mineOnly.length > 0 && (
            <p><strong>You have, they don&rsquo;t:</strong> {cmp.mineOnly.map((e) => e.name).join(", ")}</p>
          )}
        </div>
      )}
      <GameweekChart series={series} cumulative={cumulative} onToggleCumulative={() => setCumulative(!cumulative)} />
    </div>
  );
}
```

`src/App.jsx`: import LeaguesTab and add `["leagues", "Leagues", LeaguesTab],` to `TABS` right after the My Team entry.

- [ ] **Step 4:** `npm test && npm run build` → PASS. **Step 5: Commit** `feat: Leagues tab — standings with movement, points race, opponent team comparison; league positions on My Team`.

---

### Task 5: Release (controller)

- [ ] Run the snippet against captured pages with the mock harness; `npm test && npm run build`; bump to 0.31.0, sync lockfile, commit, push, watch the deploy.
