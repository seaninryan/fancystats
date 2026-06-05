# fancystats Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the phase-1 fancystats app: import LOI Premier Division match data from SofaScore in the browser, store normalized stats in Google Drive, score them with Fantasy LOI rules, and browse via five mobile-first screens on GitHub Pages.

**Architecture:** Vite + React static SPA deployed to GitHub Pages by GitHub Actions. All logic client-side: `src/lib/` holds pure, vitest-covered modules (normalizer, scoring, store, paste parser) plus the Drive storage module ported from sideline; React components per tab consume them. Single `fancystats.json` in Drive `appDataFolder`, whole-file load/save, last-write-wins.

**Tech Stack:** Vite 5, React 18, vitest, Google Identity Services + Drive REST v3, GitHub Actions Pages deploy.

**Spec:** `docs/superpowers/specs/2026-06-05-fancystats-design.md`

**Plan-level notes:**
- The SofaScore API returns 403 to non-browser TLS fingerprints (curl/Node may be blocked). Tests therefore use fixture JSON files whose content this plan provides verbatim, matching SofaScore's real schema. Task 4 also creates `tools/capture.html` so the user can capture real payloads from a browser later and drop them into `test/fixtures/` as additional golden tests.
- Card-points decision (verify in Task 13 against a real gameweek): yellow −1; a second yellow adds −2 (net −3); straight red −4 alone.
- `penSaved` is normalized to 0 (SofaScore incident data doesn't reliably attribute saves); record via the adjustments overlay. Rare event, revisit in phase 2.
- Clean-sheet boundary: a goal conceded at exactly the player's `subOffMin`/`subOnMin` minute counts as conceded while on.

## File structure

```
fancystats/
├── index.html                    # Vite entry
├── package.json
├── vite.config.js                # base: '/fancystats/'
├── .github/workflows/deploy.yml  # test → build → Pages deploy
├── tools/capture.html            # dev helper: capture real SofaScore payloads
├── src/
│   ├── main.jsx                  # ReactDOM bootstrap
│   ├── App.jsx                   # auth gate, data load/save, tab nav
│   ├── styles.css
│   ├── lib/
│   │   ├── scoring.js            # RULES, scoreAppearance, concededWhileOn
│   │   ├── store.js              # data-model ops + derived queries (pure)
│   │   ├── sofascore.js          # fetch wrappers, normalize(), importMatch()
│   │   ├── pasteImport.js        # fantasyloi paste parser + name matching
│   │   └── drive.js              # GIS auth + Drive load/save (port of sideline)
│   └── components/
│       ├── MatchesTab.jsx
│       ├── PlayersTab.jsx
│       ├── PlayerDetail.jsx
│       ├── TeamsTab.jsx
│       └── SettingsTab.jsx
└── test/
    ├── scoring.test.js
    ├── store.test.js
    ├── normalize.test.js
    ├── sofascore.test.js
    ├── pasteImport.test.js
    └── fixtures/
        ├── event-ordinary.json
        ├── lineups-ordinary.json
        └── incidents-ordinary.json
```

Position strings everywhere: `"GK" | "DEF" | "MID" | "FWD"`. SofaScore per-match positions: `"G" | "D" | "M" | "F"`, mapped only in `store.deriveRealPosition` and display code.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/styles.css`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "fancystats",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write vite.config.js**

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/fancystats/",
});
```

- [ ] **Step 3: Write index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>fancystats</title>
</head>
<body>
  <div id="root"></div>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: Write src/main.jsx**

```jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
```

- [ ] **Step 5: Write placeholder src/App.jsx** (replaced in Task 8)

```jsx
export default function App() {
  return <h1>fancystats</h1>;
}
```

- [ ] **Step 6: Write src/styles.css**

```css
:root {
  --bg: #14181c; --panel: #1d242b; --line: #2e3942;
  --text: #e8eef2; --dim: #8da0ad; --accent: #2f9e6e; --warn: #d4a017; --err: #c0392b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  padding-bottom: env(safe-area-inset-bottom); }
button { font: inherit; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input, select, textarea { font: inherit; color: inherit; background: var(--panel);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { color: var(--dim); font-weight: 600; cursor: pointer; position: sticky; top: 0; background: var(--bg); }
.tabs { display: flex; gap: 6px; padding: 10px; position: sticky; top: 0; background: var(--bg); z-index: 5; }
.tabs button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.page { padding: 0 10px 30px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin: 8px 0; }
.dim { color: var(--dim); }
.banner { padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.banner.warn { background: #3a2f10; color: var(--warn); }
.banner.err { background: #3a1510; color: #ff8a73; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.scroll-x { overflow-x: auto; }
```

- [ ] **Step 7: Install and verify**

Run: `npm install && npm run build && npm test`
Expected: build succeeds writing `dist/`; vitest reports "no test files found" with exit code 1 — that is fine at this step (tests arrive in Task 2).

Run: `git status --short` and confirm `node_modules/` and `dist/` are NOT listed (already in `.gitignore`).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.js index.html src/
git commit -m "feat: scaffold Vite + React app"
```

---

### Task 2: Scoring engine (`src/lib/scoring.js`)

**Files:**
- Create: `src/lib/scoring.js`
- Test: `test/scoring.test.js`

The match shape consumed here: `{ homeTeamId, awayTeamId, homeScore, awayScore, goalTimes: { home: [minutes...], away: [minutes...] } }`.
Appearance shape: see spec — `started, subOnMin, subOffMin, minutes, goals, assists, ownGoals, yellow, secondYellow, red, penMissed, penSaved, teamId`.
Adjustment: object of numeric deltas on those stat fields (e.g. `{ assists: 1 }`), plus optional `note` (ignored by scoring).

- [ ] **Step 1: Write the failing tests**

```js
// test/scoring.test.js
import { describe, it, expect } from "vitest";
import { RULES, scoreAppearance, concededWhileOn } from "../src/lib/scoring.js";

const match = {
  homeTeamId: 1, awayTeamId: 2,
  homeScore: 2, awayScore: 0,
  goalTimes: { home: [30, 75], away: [] },
};
const base = {
  teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90,
  goals: 0, assists: 0, ownGoals: 0,
  yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0,
};

const total = (app, m, pos, adj) => scoreAppearance(app, m, pos, adj).total;
const pts = (app, m, pos, reason) =>
  scoreAppearance(app, m, pos).breakdown.find(([r]) => r === reason)?.[1];

describe("appearance + team result", () => {
  it("full match win, FWD goal: 3+2+4", () => {
    expect(total({ ...base, goals: 1 }, match, "FWD")).toBe(9);
  });
  it("started, subbed off, win: 2+2", () => {
    expect(total({ ...base, subOffMin: 70, minutes: 70 }, match, "MID")).toBe(4);
  });
  it("sub appearance in a draw: 1+1", () => {
    const m = { ...match, homeScore: 1, awayScore: 1, goalTimes: { home: [10], away: [80] } };
    expect(total({ ...base, started: false, subOnMin: 60, minutes: 30 }, m, "MID")).toBe(2);
  });
  it("losing side gets no team-result points", () => {
    expect(total({ ...base, teamId: 2 }, match, "MID")).toBe(3); // full match only
  });
});

describe("goals by position", () => {
  it.each([["GK", 10], ["DEF", 6], ["MID", 5], ["FWD", 4]])("%s goal = %i", (pos, val) => {
    expect(pts({ ...base, goals: 1 }, match, pos, "goals")).toBe(val);
  });
  it("two goals double up", () => {
    expect(pts({ ...base, goals: 2 }, match, "FWD", "goals")).toBe(8);
  });
  it("assist = 3 any position", () => {
    expect(pts({ ...base, assists: 1 }, match, "DEF", "assists")).toBe(3);
  });
});

describe("clean sheets (GK/DEF only)", () => {
  it("DEF full match, no goals conceded: +4", () => {
    expect(pts(base, match, "DEF", "cleanSheet")).toBe(4);
  });
  it("MID never gets clean sheet points", () => {
    expect(pts(base, match, "MID", "cleanSheet")).toBeUndefined();
  });
  it("DEF subbed off before concession keeps partial CS: +2", () => {
    const m = { ...match, homeScore: 2, awayScore: 1, goalTimes: { home: [30, 75], away: [80] } };
    expect(pts({ ...base, subOffMin: 71, minutes: 71 }, m, "DEF", "cleanSheet")).toBe(2);
  });
  it("goal at exactly subOffMin counts as conceded", () => {
    const m = { ...match, awayScore: 1, goalTimes: { home: [30, 75], away: [71] } };
    expect(pts({ ...base, subOffMin: 71, minutes: 71 }, m, "DEF", "cleanSheet")).toBeUndefined();
  });
  it("sub DEF coming on after all concessions: +1", () => {
    const m = { ...match, awayScore: 1, goalTimes: { home: [], away: [20] } };
    expect(pts({ ...base, started: false, subOnMin: 46, minutes: 44 }, m, "DEF", "cleanSheet")).toBe(1);
  });
});

describe("negatives", () => {
  it("yellow −1", () => expect(pts({ ...base, yellow: 1 }, match, "MID", "yellow")).toBe(-1));
  it("second yellow adds −2 (net −3 with the yellow)", () => {
    const s = scoreAppearance({ ...base, yellow: 1, secondYellow: true }, match, "MID");
    expect(s.breakdown.find(([r]) => r === "secondYellow")[1]).toBe(-2);
  });
  it("straight red −4", () => expect(pts({ ...base, red: true }, match, "MID", "straightRed")).toBe(-4));
  it("own goal −2, pen miss −3", () => {
    expect(pts({ ...base, ownGoals: 1 }, match, "DEF", "ownGoal")).toBe(-2);
    expect(pts({ ...base, penMissed: 1 }, match, "FWD", "penMiss")).toBe(-3);
  });
  it("pen save +5 for GK only", () => {
    expect(pts({ ...base, penSaved: 1 }, match, "GK", "penSave")).toBe(5);
    expect(pts({ ...base, penSaved: 1 }, match, "DEF", "penSave")).toBeUndefined();
  });
});

describe("adjustments", () => {
  it("assist delta applies and is marked adjusted", () => {
    const s = scoreAppearance(base, match, "MID", { assists: 1, note: "won pen" });
    expect(s.breakdown.find(([r]) => r === "assists")[1]).toBe(3);
    expect(s.adjusted).toBe(true);
  });
});

describe("concededWhileOn", () => {
  it("counts only opposition goals during the player's minutes", () => {
    const m = { ...match, goalTimes: { home: [10], away: [20, 60] } };
    expect(concededWhileOn({ ...base, subOnMin: 46, started: false }, m)).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/scoring.test.js`
Expected: FAIL — cannot resolve `../src/lib/scoring.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/scoring.js
// Fantasy LOI scoring rules — values from fantasyloi.leagueofireland.ie/Rules/Rules
// (re-verified during Task 13 against a real gameweek).
export const RULES = {
  appearance: { sub: 1, startedSubbedOff: 2, fullMatch: 3 },
  teamResult: { win: 2, draw: 1 }, // requires an appearance
  goal: { GK: 10, DEF: 6, MID: 5, FWD: 4 },
  assist: 3,
  cleanSheet: { positions: ["GK", "DEF"], fullMatch: 4, startedPartial: 2, sub: 1 },
  ownGoal: -2,
  penMiss: -3,
  penSave: 5, // GK only
  yellow: -1,
  secondYellow: -2, // in addition to the yellow
  straightRed: -4,
};

const STAT_FIELDS = ["goals", "assists", "ownGoals", "yellow", "penMissed", "penSaved", "minutes"];

function applyAdjustment(app, adj) {
  const out = { ...app };
  for (const f of STAT_FIELDS) if (typeof adj[f] === "number") out[f] = (out[f] || 0) + adj[f];
  if (typeof adj.secondYellow === "boolean") out.secondYellow = adj.secondYellow;
  if (typeof adj.red === "boolean") out.red = adj.red;
  return out;
}

// Opposition goals scored while this player was on the pitch.
// Boundary: a goal at exactly subOnMin/subOffMin counts as conceded while on.
export function concededWhileOn(app, match) {
  const oppGoals = app.teamId === match.homeTeamId ? match.goalTimes.away : match.goalTimes.home;
  const from = app.started ? 0 : app.subOnMin ?? Infinity;
  const to = app.subOffMin ?? Infinity;
  return oppGoals.filter((m) => m >= from && m <= to).length;
}

// app: appearance record; match: needs homeTeamId/awayTeamId/homeScore/awayScore/goalTimes
// position: "GK"|"DEF"|"MID"|"FWD" (caller chooses gamePosition or realPosition)
// adjustment: optional delta object from data.adjustments
export function scoreAppearance(app0, match, position, adjustment = null) {
  const app = adjustment ? applyAdjustment(app0, adjustment) : app0;
  const br = [];

  const tier = !app.started ? "sub" : app.subOffMin != null ? "startedSubbedOff" : "fullMatch";
  br.push([tier, RULES.appearance[tier]]);

  const ours = app.teamId === match.homeTeamId ? match.homeScore : match.awayScore;
  const theirs = app.teamId === match.homeTeamId ? match.awayScore : match.homeScore;
  if (ours > theirs) br.push(["win", RULES.teamResult.win]);
  else if (ours === theirs) br.push(["draw", RULES.teamResult.draw]);

  if (app.goals) br.push(["goals", app.goals * RULES.goal[position]]);
  if (app.assists) br.push(["assists", app.assists * RULES.assist]);

  if (RULES.cleanSheet.positions.includes(position) && concededWhileOn(app, match) === 0) {
    const key = tier === "fullMatch" ? "fullMatch" : tier === "startedSubbedOff" ? "startedPartial" : "sub";
    br.push(["cleanSheet", RULES.cleanSheet[key]]);
  }

  if (app.ownGoals) br.push(["ownGoal", app.ownGoals * RULES.ownGoal]);
  if (app.penMissed) br.push(["penMiss", app.penMissed * RULES.penMiss]);
  if (app.penSaved && position === "GK") br.push(["penSave", app.penSaved * RULES.penSave]);

  if (app.yellow) br.push(["yellow", app.yellow * RULES.yellow]);
  if (app.secondYellow) br.push(["secondYellow", RULES.secondYellow]);
  if (app.red) br.push(["straightRed", RULES.straightRed]);

  return {
    total: br.reduce((s, [, p]) => s + p, 0),
    breakdown: br,
    adjusted: !!adjustment,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/scoring.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring.js test/scoring.test.js
git commit -m "feat: Fantasy LOI scoring engine with itemized breakdown"
```

---

### Task 3: Data store operations (`src/lib/store.js`)

**Files:**
- Create: `src/lib/store.js`
- Test: `test/store.test.js`

Pure functions over the `fancystats.json` object. All mutating ops return a **new** object (React state friendly). Ownership rules from the spec: imports own `teams`/`matches`/`appearances`; the user owns player fields (except `name`/`teamId`) and all `adjustments`.

- [ ] **Step 1: Write the failing tests**

```js
// test/store.test.js
import { describe, it, expect } from "vitest";
import {
  emptyData, applyImport, upsertMatchStubs, setPlayerField,
  setAdjustment, deriveRealPosition, playerTotals, positionMismatch,
} from "../src/lib/store.js";

const NOW = 1765000000000;

function importedFixture() {
  return applyImport(emptyData(), {
    match: {
      eventId: 100, round: 1, kickoff: 1764900000000, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0,
      goalTimes: { home: [40], away: [] }, partial: false,
    },
    teams: [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }],
    players: [{ id: 10, name: "A Keena", teamId: 1 }, { id: 11, name: "B Burke", teamId: 1 }],
    appearances: [
      { eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 1, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 },
      { eventId: 100, playerId: 11, teamId: 1, started: false, subOnMin: 60, subOffMin: null, minutes: 30, positionPlayed: "M", goals: 0, assists: 1, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 },
    ],
  }, NOW);
}

describe("applyImport", () => {
  it("writes match, teams, appearances and stamps importedAt", () => {
    const d = importedFixture();
    expect(d.matches["100"].importedAt).toBe(NOW);
    expect(d.teams["1"].name).toBe("Shamrock Rovers");
    expect(d.appearances["100:10"].goals).toBe(1);
  });
  it("creates unknown players with default user fields", () => {
    const p = importedFixture().players["10"];
    expect(p).toMatchObject({ name: "A Keena", teamId: 1, gamePosition: null, realPosition: null, price: null, starred: false, inSquad: false, pasteAlias: null });
  });
  it("re-import replaces that match's appearances but keeps user player fields", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    d = setPlayerField(d, 10, "starred", true);
    const re = applyImport(d, {
      match: { ...d.matches["100"], eventId: 100, homeScore: 2 },
      teams: [], players: [{ id: 10, name: "Aidan Keena", teamId: 1 }],
      appearances: [{ eventId: 100, playerId: 10, teamId: 1, started: true, subOnMin: null, subOffMin: null, minutes: 90, positionPlayed: "F", goals: 2, assists: 0, ownGoals: 0, yellow: 0, secondYellow: false, red: false, penMissed: 0, penSaved: 0 }],
    }, NOW + 1);
    expect(re.appearances["100:10"].goals).toBe(2);
    expect(re.appearances["100:11"]).toBeUndefined(); // old appearance for this match removed
    expect(re.players["10"].gamePosition).toBe("FWD"); // user-owned survives
    expect(re.players["10"].starred).toBe(true);
    expect(re.players["10"].name).toBe("Aidan Keena"); // import-owned updated
  });
  it("does not mutate its input", () => {
    const d = emptyData();
    importedFixture();
    expect(d.matches).toEqual({});
  });
});

describe("upsertMatchStubs", () => {
  it("adds new fixtures without importedAt", () => {
    const d = upsertMatchStubs(emptyData(), [
      { eventId: 200, round: 2, kickoff: 1, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null },
    ], [{ id: 1, name: "Shamrock Rovers", shortName: "SRO" }, { id: 2, name: "Bohemians", shortName: "BOH" }]);
    expect(d.matches["200"].importedAt).toBeUndefined();
    expect(d.teams["2"].shortName).toBe("BOH");
  });
  it("updates status/scores on imported matches but preserves importedAt and goalTimes", () => {
    let d = importedFixture();
    d = upsertMatchStubs(d, [{ eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0 }], []);
    expect(d.matches["100"].importedAt).toBe(NOW);
    expect(d.matches["100"].goalTimes.home).toEqual([40]);
  });
});

describe("user edits", () => {
  it("setPlayerField sets gamePositionSource=manual when editing gamePosition", () => {
    const d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    expect(d.players["10"].gamePosition).toBe("MID");
    expect(d.players["10"].gamePositionSource).toBe("manual");
  });
  it("setAdjustment stores deltas and removes empty ones", () => {
    let d = setAdjustment(importedFixture(), "100:10", { assists: 1, note: "won pen" });
    expect(d.adjustments["100:10"].assists).toBe(1);
    d = setAdjustment(d, "100:10", null);
    expect(d.adjustments["100:10"]).toBeUndefined();
  });
});

describe("derived queries", () => {
  it("deriveRealPosition: majority of positionPlayed, mapped to fantasy positions", () => {
    const apps = [
      { positionPlayed: "F" }, { positionPlayed: "F" }, { positionPlayed: "M" },
    ];
    expect(deriveRealPosition(apps)).toEqual({ position: "FWD", count: 2, total: 3 });
    expect(deriveRealPosition([])).toBeNull();
  });
  it("playerTotals aggregates stats and fantasy points by gamePosition", () => {
    let d = importedFixture();
    d = setPlayerField(d, 10, "gamePosition", "FWD");
    const t = playerTotals(d, 10);
    // full match 3 + win 2 + goal(FWD) 4 = 9
    expect(t).toMatchObject({ minutes: 90, goals: 1, assists: 0, starts: 1, subApps: 0, points: 9 });
  });
  it("playerTotals applies adjustments", () => {
    let d = importedFixture();
    d = setPlayerField(d, 11, "gamePosition", "MID");
    d = setAdjustment(d, "100:11", { assists: 1 });
    // sub 1 + win 2 + assists (1+1)*3 = 9
    expect(playerTotals(d, 11).points).toBe(9);
    expect(playerTotals(d, 11).assists).toBe(2);
  });
  it("playerTotals returns null points when gamePosition unset", () => {
    expect(playerTotals(importedFixture(), 10).points).toBeNull();
  });
  it("positionMismatch flags game vs derived disagreement (min 3 observations)", () => {
    const apps3 = [{ positionPlayed: "F" }, { positionPlayed: "F" }, { positionPlayed: "F" }];
    expect(positionMismatch({ gamePosition: "DEF", realPosition: null }, apps3)).toBe(true);
    expect(positionMismatch({ gamePosition: "FWD", realPosition: null }, apps3)).toBe(false);
    expect(positionMismatch({ gamePosition: "DEF", realPosition: "DEF" }, apps3)).toBe(false); // manual override wins
    expect(positionMismatch({ gamePosition: "DEF", realPosition: null }, apps3.slice(0, 2))).toBe(false); // too few
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/store.test.js`
Expected: FAIL — cannot resolve `../src/lib/store.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/store.js
// Pure operations on the fancystats.json data object. Every mutator returns a new object.
import { scoreAppearance } from "./scoring.js";

export const POS_MAP = { G: "GK", D: "DEF", M: "MID", F: "FWD" };

export function emptyData() {
  return {
    version: 1,
    meta: { tournamentId: 192, seasonId: 87682, lastEventSync: null },
    teams: {}, matches: {}, players: {}, appearances: {}, adjustments: {},
  };
}

function defaultPlayer(p) {
  return {
    name: p.name, teamId: p.teamId,
    gamePosition: null, gamePositionSource: null, realPosition: null,
    price: null, priceUpdatedAt: null,
    starred: false, inSquad: false, pasteAlias: null,
  };
}

// normalized: { match, teams, players, appearances } from sofascore.normalize()
export function applyImport(data, normalized, now) {
  const next = structuredClone(data);
  const { match, teams, players, appearances } = normalized;
  for (const t of teams) next.teams[t.id] = { name: t.name, shortName: t.shortName };
  for (const k of Object.keys(next.appearances)) {
    if (k.startsWith(match.eventId + ":")) delete next.appearances[k];
  }
  next.matches[match.eventId] = { ...match, importedAt: now };
  for (const a of appearances) next.appearances[`${a.eventId}:${a.playerId}`] = a;
  for (const p of players) {
    const existing = next.players[p.id];
    if (existing) { existing.name = p.name; existing.teamId = p.teamId; }
    else next.players[p.id] = defaultPlayer(p);
  }
  return next;
}

// stubs: [{eventId, round, kickoff, status, homeTeamId, awayTeamId, homeScore, awayScore}]
export function upsertMatchStubs(data, stubs, teams) {
  const next = structuredClone(data);
  for (const t of teams) next.teams[t.id] = { name: t.name, shortName: t.shortName };
  for (const s of stubs) {
    const prev = next.matches[s.eventId] || {};
    next.matches[s.eventId] = { ...prev, ...s }; // preserves importedAt/goalTimes/partial when present
  }
  return next;
}

export function setPlayerField(data, playerId, field, value) {
  const next = structuredClone(data);
  const p = next.players[playerId];
  if (!p) return data;
  p[field] = value;
  if (field === "gamePosition") p.gamePositionSource = "manual";
  return next;
}

export function setAdjustment(data, key, adj) {
  const next = structuredClone(data);
  const hasDeltas = adj && Object.keys(adj).some((k) => k !== "note" && adj[k]);
  if (hasDeltas) next.adjustments[key] = adj;
  else delete next.adjustments[key];
  return next;
}

export function playerAppearances(data, playerId) {
  return Object.values(data.appearances)
    .filter((a) => a.playerId === Number(playerId) || a.playerId === playerId)
    .sort((a, b) => (data.matches[a.eventId]?.kickoff || 0) - (data.matches[b.eventId]?.kickoff || 0));
}

export function deriveRealPosition(apps) {
  const counts = {};
  for (const a of apps) {
    if (!a.positionPlayed) continue;
    counts[a.positionPlayed] = (counts[a.positionPlayed] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return { position: POS_MAP[entries[0][0]], count: entries[0][1], total };
}

// Mismatch when game position disagrees with where they actually play.
// Manual realPosition override beats derivation; require >=3 observations to flag.
export function positionMismatch(player, apps) {
  if (!player.gamePosition) return false;
  if (player.realPosition) return player.realPosition !== player.gamePosition;
  const derived = deriveRealPosition(apps);
  if (!derived || derived.total < 3) return false;
  return derived.position !== player.gamePosition;
}

export function playerTotals(data, playerId) {
  const player = data.players[playerId];
  const apps = playerAppearances(data, playerId);
  const t = { minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: player?.gamePosition ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists;
    a.started ? t.starts++ : t.subApps++;
    if (t.points !== null) {
      const match = data.matches[a.eventId];
      if (match?.goalTimes) t.points += scoreAppearance(a, match, player.gamePosition, adj).total;
    }
  }
  return t;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: scoring + store tests all PASS.

```bash
git add src/lib/store.js test/store.test.js
git commit -m "feat: data store operations with import/user-edit ownership rules"
```

---

### Task 4: SofaScore normalizer (`normalize()`)

**Files:**
- Create: `test/fixtures/event-ordinary.json`, `test/fixtures/lineups-ordinary.json`, `test/fixtures/incidents-ordinary.json`
- Create: `src/lib/sofascore.js` (normalize only; fetch functions arrive in Task 5)
- Create: `tools/capture.html`
- Test: `test/normalize.test.js`

Fixtures are realistic synthetic payloads matching SofaScore's schema (squads trimmed to a few players to keep them readable). Edge cases (red card, own goal, missing lineups) are built in-test by cloning and tweaking the ordinary fixture.

- [ ] **Step 1: Write the fixtures**

`test/fixtures/event-ordinary.json`:

```json
{
  "event": {
    "id": 555,
    "startTimestamp": 1764936000,
    "status": { "code": 100, "type": "finished" },
    "roundInfo": { "round": 12 },
    "homeTeam": { "id": 1, "name": "Shamrock Rovers", "nameCode": "SRO" },
    "awayTeam": { "id": 2, "name": "Bohemians", "nameCode": "BOH" },
    "homeScore": { "current": 2, "period1": 1 },
    "awayScore": { "current": 1, "period1": 0 }
  }
}
```

`test/fixtures/lineups-ordinary.json`:

```json
{
  "confirmed": true,
  "home": {
    "formation": "4-3-3",
    "players": [
      { "player": { "id": 100, "name": "Leon Pohls", "position": "G" }, "position": "G", "shirtNumber": 1, "substitute": false, "statistics": { "minutesPlayed": 90 } },
      { "player": { "id": 101, "name": "Roberto Lopes", "position": "D" }, "position": "D", "shirtNumber": 4, "substitute": false, "statistics": { "minutesPlayed": 60 } },
      { "player": { "id": 102, "name": "Graham Burke", "position": "F" }, "position": "F", "shirtNumber": 9, "substitute": false, "statistics": { "minutesPlayed": 90 } },
      { "player": { "id": 103, "name": "Dylan Watts", "position": "M" }, "position": "M", "shirtNumber": 22, "substitute": true, "statistics": { "minutesPlayed": 30 } }
    ]
  },
  "away": {
    "formation": "4-4-2",
    "players": [
      { "player": { "id": 200, "name": "James Talbot", "position": "G" }, "position": "G", "shirtNumber": 1, "substitute": false, "statistics": { "minutesPlayed": 90 } },
      { "player": { "id": 201, "name": "Rob Cornwall", "position": "D" }, "position": "D", "shirtNumber": 5, "substitute": false, "statistics": { "minutesPlayed": 90 } },
      { "player": { "id": 203, "name": "Dawson Devoy", "position": "M" }, "position": "M", "shirtNumber": 8, "substitute": false, "statistics": { "minutesPlayed": 90 } },
      { "player": { "id": 202, "name": "Unused Sub", "position": "F" }, "position": "F", "shirtNumber": 19, "substitute": true }
    ]
  }
}
```

`test/fixtures/incidents-ordinary.json`:

```json
{
  "incidents": [
    { "incidentType": "period", "text": "HT", "isLive": false },
    { "incidentType": "goal", "incidentClass": "regular", "time": 30, "isHome": true,
      "player": { "id": 102, "name": "Graham Burke" }, "assist1": { "id": 101, "name": "Roberto Lopes" } },
    { "incidentType": "substitution", "time": 60, "isHome": true,
      "playerIn": { "id": 103, "name": "Dylan Watts" }, "playerOut": { "id": 101, "name": "Roberto Lopes" } },
    { "incidentType": "goal", "incidentClass": "regular", "time": 75, "isHome": true,
      "player": { "id": 103, "name": "Dylan Watts" } },
    { "incidentType": "card", "incidentClass": "yellow", "time": 78, "isHome": false,
      "player": { "id": 201, "name": "Rob Cornwall" } },
    { "incidentType": "goal", "incidentClass": "regular", "time": 80, "isHome": false,
      "player": { "id": 203, "name": "Dawson Devoy" } }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

```js
// test/normalize.test.js
import { describe, it, expect } from "vitest";
import { normalize } from "../src/lib/sofascore.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

const run = (e = event, l = lineups, i = incidents) =>
  normalize(structuredClone(e), structuredClone(l), structuredClone(i));
const app = (res, id) => res.appearances.find((a) => a.playerId === id);

describe("match record", () => {
  it("extracts core fields and goal times per side", () => {
    const { match } = run();
    expect(match).toMatchObject({
      eventId: 555, round: 12, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 1, partial: false,
    });
    expect(match.kickoff).toBe(1764936000000);
    expect(match.goalTimes).toEqual({ home: [30, 75], away: [80] });
  });
  it("extracts teams with short names", () => {
    const { teams } = run();
    expect(teams).toContainEqual({ id: 1, name: "Shamrock Rovers", shortName: "SRO" });
  });
});

describe("appearances", () => {
  it("credits scorer, assister, and sub minutes", () => {
    const res = run();
    expect(app(res, 102)).toMatchObject({ goals: 1, started: true, minutes: 90, positionPlayed: "F" });
    expect(app(res, 101)).toMatchObject({ assists: 1, subOffMin: 60, minutes: 60 });
    expect(app(res, 103)).toMatchObject({ goals: 1, started: false, subOnMin: 60, minutes: 30 });
    expect(app(res, 201)).toMatchObject({ yellow: 1 });
  });
  it("drops unused bench players", () => {
    const res = run();
    expect(app(res, 202)).toBeUndefined();
    expect(res.players.find((p) => p.id === 202)).toBeUndefined();
  });
  it("derives minutes when statistics are absent", () => {
    const l = structuredClone(lineups);
    for (const side of [l.home, l.away]) for (const p of side.players) delete p.statistics;
    const res = run(event, l, incidents);
    expect(app(res, 101).minutes).toBe(60); // subbed off at 60
    expect(app(res, 103).minutes).toBe(30); // on at 60
    expect(app(res, 100).minutes).toBe(90); // full match
  });
});

describe("edge cases", () => {
  it("second yellow and straight red", () => {
    const i = structuredClone(incidents);
    i.incidents.push(
      { incidentType: "card", incidentClass: "yellowRed", time: 85, isHome: false, player: { id: 201, name: "Rob Cornwall" } },
      { incidentType: "card", incidentClass: "red", time: 88, isHome: true, player: { id: 102, name: "Graham Burke" } },
    );
    const res = run(event, lineups, i);
    expect(app(res, 201)).toMatchObject({ yellow: 1, secondYellow: true });
    expect(app(res, 102).red).toBe(true);
  });
  it("own goal counts for the benefiting side and scorer gets ownGoals", () => {
    const i = structuredClone(incidents);
    i.incidents.push({ incidentType: "goal", incidentClass: "ownGoal", time: 85, isHome: true, player: { id: 201, name: "Rob Cornwall" } });
    const res = run(event, lineups, i);
    expect(app(res, 201).ownGoals).toBe(1);
    expect(app(res, 201).goals).toBe(0);
    expect(res.match.goalTimes.home).toEqual([30, 75, 85]);
  });
  it("missed penalty", () => {
    const i = structuredClone(incidents);
    i.incidents.push({ incidentType: "inGamePenalty", incidentClass: "missed", time: 50, isHome: true, player: { id: 102, name: "Graham Burke" } });
    expect(app(run(event, lineups, i), 102).penMissed).toBe(1);
  });
  it("missing lineups -> partial match, no appearances", () => {
    const res = normalize(structuredClone(event), null, structuredClone(incidents));
    expect(res.match.partial).toBe(true);
    expect(res.appearances).toEqual([]);
    expect(res.match.goalTimes.home).toEqual([30, 75]); // goal times still captured
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/normalize.test.js`
Expected: FAIL — cannot resolve `../src/lib/sofascore.js`.

- [ ] **Step 4: Write the implementation**

```js
// src/lib/sofascore.js
// SofaScore payloads -> normalized records. Pure; fetch functions live alongside (Task 5).

export function normalize(eventPayload, lineupsPayload, incidentsPayload) {
  const e = eventPayload.event;
  const match = {
    eventId: e.id,
    round: e.roundInfo?.round ?? null,
    kickoff: (e.startTimestamp || 0) * 1000,
    status: e.status?.type || "unknown",
    homeTeamId: e.homeTeam.id,
    awayTeamId: e.awayTeam.id,
    homeScore: e.homeScore?.current ?? null,
    awayScore: e.awayScore?.current ?? null,
    goalTimes: { home: [], away: [] },
    partial: !lineupsPayload,
  };
  const team = (t) => ({ id: t.id, name: t.name, shortName: t.nameCode || t.shortName || t.name });
  const teams = [team(e.homeTeam), team(e.awayTeam)];

  const apps = new Map();
  const addSide = (side, teamId) => {
    for (const entry of side?.players || []) {
      apps.set(entry.player.id, {
        eventId: e.id, playerId: entry.player.id, teamId,
        name: entry.player.name,
        started: !entry.substitute,
        subOnMin: null, subOffMin: null,
        minutes: entry.statistics?.minutesPlayed ?? null,
        positionPlayed: entry.position || entry.player.position || null,
        goals: 0, assists: 0, ownGoals: 0,
        yellow: 0, secondYellow: false, red: false,
        penMissed: 0, penSaved: 0,
      });
    }
  };
  if (lineupsPayload) {
    addSide(lineupsPayload.home, e.homeTeam.id);
    addSide(lineupsPayload.away, e.awayTeam.id);
  }

  const stat = (id, fn) => { const a = id != null ? apps.get(id) : null; if (a) fn(a); };
  for (const inc of incidentsPayload?.incidents || []) {
    if (inc.incidentType === "goal") {
      (inc.isHome ? match.goalTimes.home : match.goalTimes.away).push(inc.time);
      if (inc.incidentClass === "ownGoal") {
        stat(inc.player?.id, (a) => a.ownGoals++);
      } else {
        stat(inc.player?.id, (a) => a.goals++);
        stat(inc.assist1?.id, (a) => a.assists++);
      }
    } else if (inc.incidentType === "substitution") {
      stat(inc.playerIn?.id, (a) => { a.subOnMin = inc.time; });
      stat(inc.playerOut?.id, (a) => { a.subOffMin = inc.time; });
    } else if (inc.incidentType === "card") {
      if (inc.incidentClass === "yellow") stat(inc.player?.id, (a) => a.yellow++);
      else if (inc.incidentClass === "yellowRed") stat(inc.player?.id, (a) => { a.secondYellow = true; });
      else if (inc.incidentClass === "red") stat(inc.player?.id, (a) => { a.red = true; });
    } else if (inc.incidentType === "inGamePenalty" && inc.incidentClass === "missed") {
      // penSaved is NOT derived here: SofaScore doesn't reliably attribute the save.
      // Record keeper pen-saves via the adjustments overlay.
      stat(inc.player?.id, (a) => a.penMissed++);
    }
  }
  match.goalTimes.home.sort((a, b) => a - b);
  match.goalTimes.away.sort((a, b) => a - b);

  const appearances = [];
  const players = [];
  for (const a of apps.values()) {
    if (a.minutes == null) {
      a.minutes = a.started ? a.subOffMin ?? 90 : a.subOnMin != null ? 90 - a.subOnMin : 0;
    }
    if (!a.started && a.subOnMin == null && a.minutes <= 0) continue; // unused bench
    const { name, ...record } = a;
    appearances.push(record);
    players.push({ id: a.playerId, name, teamId: a.teamId });
  }
  return { match, teams, players, appearances };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/normalize.test.js`
Expected: PASS.

- [ ] **Step 6: Write tools/capture.html** (dev helper for capturing real payloads as future fixtures; open it directly in a browser via `file://` or the dev server — SofaScore allows browser-origin fetches)

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>fancystats fixture capture</title></head>
<body style="font-family: monospace; background:#111; color:#eee; padding:20px">
<h3>Capture SofaScore payloads for test/fixtures/</h3>
<p>Event id: <input id="ev" value=""> <button onclick="cap()">Fetch event + lineups + incidents</button></p>
<p>Downloads three JSON files; drop them into test/fixtures/ and write tests against them.</p>
<script>
const API = "https://api.sofascore.com/api/v1";
async function grab(path, name) {
  const r = await fetch(API + path);
  const body = r.ok ? await r.json() : { error: r.status };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
}
async function cap() {
  const id = document.getElementById("ev").value.trim();
  await grab(`/event/${id}`, `event-${id}.json`);
  await grab(`/event/${id}/lineups`, `lineups-${id}.json`);
  await grab(`/event/${id}/incidents`, `incidents-${id}.json`);
}
</script>
</body>
</html>
```

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add src/lib/sofascore.js test/normalize.test.js test/fixtures/ tools/capture.html
git commit -m "feat: SofaScore payload normalizer with fixture tests"
```

---

### Task 5: SofaScore fetch + import orchestration

**Files:**
- Modify: `src/lib/sofascore.js` (append; `normalize` from Task 4 stays unchanged)
- Test: `test/sofascore.test.js`

All network functions take an injectable `fetcher` (defaults to `window.fetch`) so tests run with a stub and never hit the network.

- [ ] **Step 1: Write the failing tests**

```js
// test/sofascore.test.js
import { describe, it, expect } from "vitest";
import { fetchJson, fetchSeasonEvents, importMatch, API } from "../src/lib/sofascore.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

// Stub fetcher: map of url-suffix -> {status, body}; records calls.
function stub(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const { status = 200, body } = hit[1];
    return { ok: status < 400, status, json: async () => body };
  };
  f.calls = calls;
  return f;
}

describe("fetchJson", () => {
  it("returns parsed body on 200", async () => {
    const f = stub({ "/event/1": { body: { a: 1 } } });
    expect(await fetchJson("/event/1", f)).toEqual({ a: 1 });
    expect(f.calls[0]).toBe(API + "/event/1");
  });
  it("throws with status on failure", async () => {
    const f = stub({ "/event/1": { status: 403, body: {} } });
    await expect(fetchJson("/event/1", f)).rejects.toThrow("403");
  });
});

describe("fetchSeasonEvents", () => {
  const meta = { tournamentId: 192, seasonId: 87682 };
  const ev = (id, ts) => ({
    id, startTimestamp: ts, status: { type: "finished" }, roundInfo: { round: 1 },
    homeTeam: { id: 1, name: "Shamrock Rovers", nameCode: "SRO" },
    awayTeam: { id: 2, name: "Bohemians", nameCode: "BOH" },
    homeScore: { current: 1 }, awayScore: { current: 0 },
  });
  it("walks past and upcoming pages and returns stubs + teams", async () => {
    const f = stub({
      "/unique-tournament/192/season/87682/events/last/0": { body: { events: [ev(11, 100)], hasNextPage: true } },
      "/unique-tournament/192/season/87682/events/last/1": { body: { events: [ev(12, 200)], hasNextPage: false } },
      "/unique-tournament/192/season/87682/events/next/0": { body: { events: [ev(13, 300)], hasNextPage: false } },
    });
    const { stubs, teams } = await fetchSeasonEvents(meta, f);
    expect(stubs.map((s) => s.eventId).sort()).toEqual([11, 12, 13]);
    expect(stubs[0]).toMatchObject({ round: 1, homeTeamId: 1, awayTeamId: 2 });
    expect(teams.find((t) => t.id === 2).shortName).toBe("BOH");
  });
  it("tolerates a 404 on the upcoming feed (end of season)", async () => {
    const f = stub({
      "/unique-tournament/192/season/87682/events/last/0": { body: { events: [ev(11, 100)], hasNextPage: false } },
      "/unique-tournament/192/season/87682/events/next/0": { status: 404, body: {} },
    });
    const { stubs } = await fetchSeasonEvents(meta, f);
    expect(stubs).toHaveLength(1);
  });
});

describe("importMatch", () => {
  it("fetches event+lineups+incidents and returns normalized result", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { body: lineups },
      "/event/555/incidents": { body: incidents },
    });
    const res = await importMatch(555, f);
    expect(res.match.partial).toBe(false);
    expect(res.appearances.length).toBeGreaterThan(0);
  });
  it("survives lineups 404 as a partial import", async () => {
    const f = stub({
      "/event/555": { body: event },
      "/event/555/lineups": { status: 404, body: {} },
      "/event/555/incidents": { body: incidents },
    });
    const res = await importMatch(555, f);
    expect(res.match.partial).toBe(true);
    expect(res.appearances).toEqual([]);
  });
  it("propagates event fetch failure", async () => {
    const f = stub({ "/event/555": { status: 403, body: {} } });
    await expect(importMatch(555, f)).rejects.toThrow("403");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/sofascore.test.js`
Expected: FAIL — `fetchJson` etc. not exported.

- [ ] **Step 3: Append the implementation to src/lib/sofascore.js**

```js
export const API = "https://api.sofascore.com/api/v1";

export async function fetchJson(path, fetcher = (...a) => fetch(...a)) {
  const res = await fetcher(API + path);
  if (!res.ok) {
    const err = new Error(`SofaScore ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function eventToStub(e) {
  return {
    eventId: e.id,
    round: e.roundInfo?.round ?? null,
    kickoff: (e.startTimestamp || 0) * 1000,
    status: e.status?.type || "unknown",
    homeTeamId: e.homeTeam.id,
    awayTeamId: e.awayTeam.id,
    homeScore: e.homeScore?.current ?? null,
    awayScore: e.awayScore?.current ?? null,
  };
}

const MAX_PAGES = 20; // safety: a season is ~180 matches, ~30/page

async function walkEvents(meta, direction, fetcher) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let body;
    try {
      body = await fetchJson(
        `/unique-tournament/${meta.tournamentId}/season/${meta.seasonId}/events/${direction}/${page}`,
        fetcher,
      );
    } catch (e) {
      if (e.status === 404 && page === 0) return out; // empty feed (e.g. season over)
      if (e.status === 404) return out; // walked past the last page
      throw e;
    }
    out.push(...(body.events || []));
    if (!body.hasNextPage) break;
  }
  return out;
}

// Returns { stubs, teams } for store.upsertMatchStubs.
export async function fetchSeasonEvents(meta, fetcher = (...a) => fetch(...a)) {
  const events = [
    ...(await walkEvents(meta, "last", fetcher)),
    ...(await walkEvents(meta, "next", fetcher)),
  ];
  const teams = new Map();
  for (const e of events) {
    for (const t of [e.homeTeam, e.awayTeam]) {
      teams.set(t.id, { id: t.id, name: t.name, shortName: t.nameCode || t.shortName || t.name });
    }
  }
  return { stubs: events.map(eventToStub), teams: [...teams.values()] };
}

// Fetch one match's payloads and normalize. Lineups/incidents failures degrade
// gracefully (partial import); an event fetch failure throws.
export async function importMatch(eventId, fetcher = (...a) => fetch(...a)) {
  const eventPayload = await fetchJson(`/event/${eventId}`, fetcher);
  let lineupsPayload = null;
  try {
    lineupsPayload = await fetchJson(`/event/${eventId}/lineups`, fetcher);
  } catch { /* known SofaScore gap -> partial import */ }
  let incidentsPayload = { incidents: [] };
  try {
    incidentsPayload = await fetchJson(`/event/${eventId}/incidents`, fetcher);
  } catch { /* score-only import still useful */ }
  return normalize(eventPayload, lineupsPayload, incidentsPayload);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/sofascore.test.js`
Expected: PASS (and `npm test` stays green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sofascore.js test/sofascore.test.js
git commit -m "feat: SofaScore season sync and match import with injectable fetcher"
```

---

### Task 6: Fantasy LOI paste import (`src/lib/pasteImport.js`)

**Files:**
- Create: `src/lib/pasteImport.js`
- Test: `test/pasteImport.test.js`

Input: text copied from `fantasyloi.leagueofireland.ie/Stats/PlayerStats` (Statistic=Value for prices; Position filter set per paste for game positions). Browser copies of that table produce either `Name<TAB>number` lines or `Name` / `number` on alternating lines — support both, ignore everything else (nav junk, headers).

- [ ] **Step 1: Write the failing tests**

```js
// test/pasteImport.test.js
import { describe, it, expect } from "vitest";
import { parsePaste, matchPlayers, normalizeName } from "../src/lib/pasteImport.js";

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation", () => {
    expect(normalizeName("Pádraig O'Conor")).toBe("padraig oconor");
    expect(normalizeName("James-Taylor,  Douglas ")).toBe("james taylor douglas");
  });
});

describe("parsePaste", () => {
  it("parses tab-separated rows and skips junk", () => {
    const text = [
      "Player Stats", "Statistic", "Value",          // page furniture
      "Padraig Amond\t10",
      "Graham Burke\t9.9",
      "Sign In", "© Fantasy LOI",
    ].join("\n");
    expect(parsePaste(text)).toEqual([
      { name: "Padraig Amond", value: 10 },
      { name: "Graham Burke", value: 9.9 },
    ]);
  });
  it("parses name/number alternating lines", () => {
    const text = "Padraig Amond\n10\nGraham Burke\n9.9";
    expect(parsePaste(text)).toEqual([
      { name: "Padraig Amond", value: 10 },
      { name: "Graham Burke", value: 9.9 },
    ]);
  });
  it("ignores pure-number noise without a preceding name", () => {
    expect(parsePaste("2026\n\nPadraig Amond\t10")).toEqual([{ name: "Padraig Amond", value: 10 }]);
  });
});

describe("matchPlayers", () => {
  const players = {
    10: { name: "Pádraig Amond", teamId: 1, pasteAlias: null },
    11: { name: "Graham Burke", teamId: 1, pasteAlias: null },
    12: { name: "Patrick O'Conor", teamId: 2, pasteAlias: null },
    13: { name: "Sean Boyd", teamId: 2, pasteAlias: "S. Boyd (FLOI)" },
  };
  it("matches on normalized full name (diacritics-insensitive)", () => {
    const { matched } = matchPlayers([{ name: "Padraig Amond", value: 10 }], players);
    expect(matched).toEqual([{ playerId: "10", name: "Padraig Amond", value: 10 }]);
  });
  it("matches via remembered pasteAlias", () => {
    const { matched } = matchPlayers([{ name: "S. Boyd (FLOI)", value: 5 }], players);
    expect(matched[0].playerId).toBe("13");
  });
  it("matches surname + first initial", () => {
    const { matched } = matchPlayers([{ name: "P. O'Conor", value: 4.5 }], players);
    expect(matched[0].playerId).toBe("12");
  });
  it("reports unmatched and ambiguous names as unmatched", () => {
    const ps = { ...players, 14: { name: "Paul O'Conor", teamId: 3, pasteAlias: null } };
    const { matched, unmatched } = matchPlayers(
      [{ name: "P. O'Conor", value: 4.5 }, { name: "Nobody Real", value: 1 }], ps);
    expect(matched).toEqual([]);
    expect(unmatched.map((u) => u.name)).toEqual(["P. O'Conor", "Nobody Real"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/pasteImport.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

```js
// src/lib/pasteImport.js
// Parse text copied from the fantasyloi Player Stats table and match names
// to SofaScore player records.

export function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NAME_RE = /\p{L}{2,}/u; // at least one real word
const NUM_RE = /^\d+(?:\.\d+)?$/;

// -> [{ name, value }]
export function parsePaste(text) {
  const rows = [];
  let pendingName = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { pendingName = null; continue; }
    const tab = line.match(/^(.+?)\t+(\d+(?:\.\d+)?)$/) || line.match(/^(.+?) {2,}(\d+(?:\.\d+)?)$/);
    if (tab && NAME_RE.test(tab[1])) {
      rows.push({ name: tab[1].trim(), value: parseFloat(tab[2]) });
      pendingName = null;
    } else if (NUM_RE.test(line)) {
      if (pendingName) { rows.push({ name: pendingName, value: parseFloat(line) }); pendingName = null; }
    } else if (NAME_RE.test(line)) {
      pendingName = line;
    }
  }
  return rows;
}

function surnameInitialKey(name) {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]} ${parts[parts.length - 1]}`; // "p oconor"
}

// rows from parsePaste; players: data.players ({id: {name, pasteAlias, ...}})
// -> { matched: [{playerId, name, value}], unmatched: [{name, value}] }
export function matchPlayers(rows, players) {
  const byFull = new Map();
  const byAlias = new Map();
  const byInitial = new Map(); // key -> [playerId]; ambiguous keys stay unmatched
  for (const [id, p] of Object.entries(players)) {
    byFull.set(normalizeName(p.name), id);
    if (p.pasteAlias) byAlias.set(normalizeName(p.pasteAlias), id);
    const key = surnameInitialKey(p.name);
    if (key) byInitial.set(key, [...(byInitial.get(key) || []), id]);
  }
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const norm = normalizeName(row.name);
    let id = byFull.get(norm) || byAlias.get(norm);
    if (!id) {
      const key = surnameInitialKey(row.name);
      const candidates = key ? byInitial.get(key) || [] : [];
      if (candidates.length === 1) id = candidates[0];
    }
    if (id) matched.push({ playerId: id, name: row.name, value: row.value });
    else unmatched.push(row);
  }
  return { matched, unmatched };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/pasteImport.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pasteImport.js test/pasteImport.test.js
git commit -m "feat: fantasyloi paste parser with fuzzy name matching"
```

---

### Task 7: Google Drive storage (`src/lib/drive.js`)

**Files:**
- Create: `src/lib/drive.js`

Port of sideline's proven Drive layer (`~/workspace/sideline/index.html`, the auth + drive section near the top of the babel script). No unit tests — it's all network/GIS glue; it gets manually verified in Task 8 Step 5. Keep the logic identical to sideline's; only the file name and module packaging change.

- [ ] **Step 1: Get the OAuth client id from sideline**

Run: `grep -o 'CLIENT_ID *= *"[^"]*"' ~/workspace/sideline/index.html`
Expected: one line like `CLIENT_ID = "1234567890-abc.apps.googleusercontent.com"`. Use that value in Step 2. (Same Google Cloud project serves both apps; origins get extended in Task 13.)

- [ ] **Step 2: Write src/lib/drive.js** (replace `<CLIENT_ID_FROM_STEP_1>` with the real value — it is a public identifier, safe to commit)

```js
// src/lib/drive.js
// Google Drive appDataFolder storage. Ported from sideline (index.html) —
// token lifecycle, 401-retry and file management are intentionally identical.

export const CLIENT_ID = "<CLIENT_ID_FROM_STEP_1>";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";
const TOK_KEY = "fancystats_tok";
const FILE_NAME = "fancystats.json";

let tokenClient = null;
let accessToken = null;
let tokenExp = 0;
let fileId = null;
let onAuthExpired = null;

function rememberToken(resp) {
  accessToken = resp.access_token;
  const ttl = Number(resp.expires_in) || 3600;
  tokenExp = Date.now() + (ttl - 60) * 1000; // 60s safety margin
  sessionStorage.setItem(TOK_KEY, JSON.stringify({ t: accessToken, exp: tokenExp }));
}

function recallToken() {
  try {
    const j = JSON.parse(sessionStorage.getItem(TOK_KEY));
    if (j?.t && j.exp > Date.now()) { tokenExp = j.exp; return j.t; }
  } catch { /* corrupt/absent */ }
  return null;
}

// Resolves true when GIS is ready. Call once at app start.
export function initAuth(handlers = {}) {
  onAuthExpired = handlers.onAuthExpired || null;
  accessToken = recallToken();
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(poll);
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: () => {},
        });
        resolve(true);
      } else if (Date.now() - started > 10000) {
        clearInterval(poll);
        resolve(false);
      }
    }, 100);
  });
}

export function isSignedIn() {
  return !!accessToken && tokenExp > Date.now();
}

function requestToken(opts = {}) {
  return new Promise((resolve) => {
    if (!tokenClient) return resolve(false);
    tokenClient.callback = (resp) => {
      if (resp.access_token) { rememberToken(resp); resolve(true); } else resolve(false);
    };
    tokenClient.error_callback = () => resolve(false);
    tokenClient.requestAccessToken(opts);
  });
}

export const signIn = () => requestToken(); // user gesture -> consent popup allowed
const reauth = () => requestToken({ prompt: "" }); // silent

// Roll the token if it expires soon. Call before save bursts.
export async function ensureFreshToken() {
  if (tokenExp - Date.now() < 10 * 60 * 1000) await reauth();
}

async function dfetch(url, opts) {
  const headers = { Authorization: "Bearer " + accessToken, ...(opts?.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) throw Object.assign(new Error("auth"), { code: 401 });
  return res;
}

async function ensureFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await dfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}`);
  const j = await r.json();
  if (j.files?.length) { fileId = j.files[0].id; return fileId; }
  const cr = await dfetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }),
  });
  fileId = (await cr.json()).id;
  return fileId;
}

// -> parsed data object, or null when the file is new/empty.
export async function driveLoad() {
  await ensureFile();
  const r = await dfetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

async function driveSave(data) {
  await ensureFile();
  const r = await dfetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  if (!r.ok) throw Object.assign(new Error("save failed"), { code: r.status });
}

// Save with one silent-reauth retry on 401; banner callback if that fails too.
export async function saveWithRetry(data) {
  await ensureFreshToken();
  try { await driveSave(data); return true; }
  catch (e) {
    if (e.code === 401 && (await reauth())) {
      try { await driveSave(data); return true; } catch { /* fall through */ }
    }
    if (onAuthExpired) onAuthExpired();
    return false;
  }
}

// Background keep-alive: silent reauth when <12 min left. Call once after sign-in.
export function startTokenKeepAlive() {
  const tick = () => {
    if (accessToken && tokenExp - Date.now() < 12 * 60 * 1000) reauth();
  };
  setInterval(tick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}
```

- [ ] **Step 3: Verify it builds and commit**

Run: `npm run build && npm test`
Expected: build OK, tests still green.

```bash
git add src/lib/drive.js
git commit -m "feat: Drive appDataFolder storage ported from sideline"
```

---

### Task 8: App shell — auth gate, data load/save, tab navigation

**Files:**
- Modify: `src/App.jsx` (replace the Task 1 placeholder entirely)
- Create: `src/components/MatchesTab.jsx`, `src/components/PlayersTab.jsx`, `src/components/TeamsTab.jsx`, `src/components/SettingsTab.jsx` (minimal placeholders, fleshed out in Tasks 9–12)

- [ ] **Step 1: Write placeholder tab components** (same pattern ×4, shown once — create all four files; each gets real content in its own task)

```jsx
// src/components/MatchesTab.jsx  (likewise PlayersTab/TeamsTab/SettingsTab with their names)
export default function MatchesTab() {
  return <div className="card dim">Matches — coming in Task 9</div>;
}
```

- [ ] **Step 2: Write src/App.jsx**

```jsx
import { useEffect, useState, useCallback } from "react";
import { initAuth, isSignedIn, signIn, saveWithRetry, driveLoad, startTokenKeepAlive } from "./lib/drive.js";
import { emptyData } from "./lib/store.js";
import MatchesTab from "./components/MatchesTab.jsx";
import PlayersTab from "./components/PlayersTab.jsx";
import TeamsTab from "./components/TeamsTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";

const TABS = [
  ["matches", "Matches", MatchesTab],
  ["players", "Players", PlayersTab],
  ["teams", "Teams", TeamsTab],
  ["settings", "⚙", SettingsTab],
];

export default function App() {
  const [phase, setPhase] = useState("booting"); // booting | signedout | loading | ready | gis-failed
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("matches");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | error
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    initAuth({ onAuthExpired: () => setAuthExpired(true) }).then((ok) => {
      if (!ok) return setPhase("gis-failed");
      setPhase(isSignedIn() ? "loading" : "signedout");
    });
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    startTokenKeepAlive();
    driveLoad()
      .then((loaded) => { setData(loaded || emptyData()); setPhase("ready"); })
      .catch(() => { setData(emptyData()); setPhase("ready"); });
  }, [phase]);

  // Single mutation entry point: components pass an updater (data) => newData.
  const update = useCallback((updater) => {
    setData((prev) => {
      const next = updater(prev);
      setSaveState("saving");
      saveWithRetry(next).then((ok) => setSaveState(ok ? "idle" : "error"));
      return next;
    });
  }, []);

  const handleSignIn = async () => {
    if (await signIn()) { setAuthExpired(false); setPhase("loading"); }
  };

  if (phase === "booting") return <p className="page dim">Loading…</p>;
  if (phase === "gis-failed") return <p className="page banner err">Google sign-in failed to load. Refresh to retry.</p>;
  if (phase === "signedout" || phase === "loading") {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: "30vh" }}>
        <h1>fancystats</h1>
        <p className="dim">League of Ireland fantasy stats</p>
        {phase === "signedout"
          ? <button className="primary" onClick={handleSignIn}>Sign in with Google</button>
          : <p className="dim">Loading your data…</p>}
      </div>
    );
  }

  const Active = TABS.find(([k]) => k === tab)[2];
  return (
    <div>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
        <span className="dim" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ not saved" : ""}
        </span>
      </nav>
      {authExpired && (
        <div className="banner err row">
          Session expired — <button onClick={handleSignIn}>Reconnect</button>
        </div>
      )}
      <main className="page">
        <Active data={data} update={update} />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify build and tests**

Run: `npm test && npm run build`
Expected: green + builds.

- [ ] **Step 4: Manual verification (requires the localhost OAuth origin — see note)**

Add `http://localhost:5173` to the OAuth client's authorized JavaScript origins in Google Cloud console (console.cloud.google.com → APIs & Services → Credentials → the sideline web client) if not already present. Then:

Run: `npm run dev` and open `http://localhost:5173/fancystats/`.
Expected: sign-in screen → Google consent → empty app with four tabs and placeholder content; no console errors; reloading the page skips consent (sessionStorage token).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/
git commit -m "feat: app shell with auth gate, Drive-backed state, tab nav"
```

---

### Task 9: Matches tab — sync, import, retry

**Files:**
- Modify: `src/components/MatchesTab.jsx` (replace placeholder)

UI components are verified manually (`npm run dev`); all logic they call is already unit-tested.

- [ ] **Step 1: Write the component**

```jsx
// src/components/MatchesTab.jsx
import { useState } from "react";
import { fetchSeasonEvents, importMatch, sleep } from "../lib/sofascore.js";
import { upsertMatchStubs, applyImport } from "../lib/store.js";

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

export default function MatchesTab({ data, update }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const sync = async () => {
    setBusy("Checking for matches…"); setError(null);
    try {
      const { stubs, teams } = await fetchSeasonEvents(data.meta);
      update((d) => {
        const next = upsertMatchStubs(d, stubs, teams);
        next.meta = { ...next.meta, lastEventSync: Date.now() };
        return next;
      });
    } catch (e) { setError(`Sync failed: ${e.message}`); }
    setBusy(null);
  };

  // Sequential, polite (300ms gap); one state update + Drive save for the whole batch.
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
      update((d) => results.reduce((acc, r) => applyImport(acc, r, Date.now()), d));
    }
    setBusy(null);
  };

  const matches = Object.values(data.matches).sort((a, b) => b.kickoff - a.kickoff);
  const missing = matches.filter((m) => m.status === "finished" && !m.importedAt);
  const team = (id) => data.teams[id]?.shortName || id;

  const rounds = [];
  for (const m of matches) {
    const last = rounds[rounds.length - 1];
    if (last && last.round === m.round) last.items.push(m);
    else rounds.push({ round: m.round, items: [m] });
  }

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
        <section key={round ?? "none"}>
          <h3>Round {round ?? "?"} <span className="dim">— {fmtDate(items[0].kickoff)}</span></h3>
          {items.map((m) => (
            <div key={m.eventId} className="card row">
              <span style={{ flex: 1 }}>
                {team(m.homeTeamId)} {m.homeScore ?? ""}–{m.awayScore ?? ""} {team(m.awayTeamId)}
                {m.status !== "finished" && <span className="dim"> · {fmtDate(m.kickoff)}</span>}
              </span>
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

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, sign in, open Matches.
Expected: “Check for new matches” fills the fixture list grouped by round (newest first, upcoming greyed); “Import” on one match shows progress then ✓; “Import all missing” imports sequentially with a counter; data survives a page reload (Drive round-trip). Verify in another tab via Players placeholder later.

- [ ] **Step 3: Run tests and commit**

Run: `npm test`
Expected: green.

```bash
git add src/components/MatchesTab.jsx
git commit -m "feat: matches tab with season sync and batch import"
```

---

### Task 10: Players tab + player detail

**Files:**
- Modify: `src/components/PlayersTab.jsx` (replace placeholder)
- Create: `src/components/PlayerDetail.jsx`

- [ ] **Step 1: Write PlayersTab**

```jsx
// src/components/PlayersTab.jsx
import { useMemo, useState } from "react";
import { playerTotals, playerAppearances, positionMismatch } from "../lib/store.js";
import PlayerDetail from "./PlayerDetail.jsx";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const COLS = [
  ["name", "Player"], ["pos", "Pos"], ["price", "€"], ["points", "Pts"],
  ["goals", "G"], ["assists", "A"], ["minutes", "Min"], ["starts", "St"], ["subApps", "Sub"],
];

export default function PlayersTab({ data, update }) {
  const [filters, setFilters] = useState({ team: "all", pos: "all", starred: false, inSquad: false, q: "" });
  const [sort, setSort] = useState({ key: "points", dir: -1 });
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    return Object.entries(data.players).map(([id, p]) => {
      const totals = playerTotals(data, id);
      const apps = playerAppearances(data, id);
      return {
        id, name: p.name, teamId: p.teamId, pos: p.gamePosition || "—",
        price: p.price, starred: p.starred, inSquad: p.inSquad,
        mismatch: positionMismatch(p, apps), ...totals,
      };
    });
  }, [data]);

  const shown = rows
    .filter((r) =>
      (filters.team === "all" || String(r.teamId) === filters.team) &&
      (filters.pos === "all" || r.pos === filters.pos) &&
      (!filters.starred || r.starred) &&
      (!filters.inSquad || r.inSquad) &&
      (!filters.q || r.name.toLowerCase().includes(filters.q.toLowerCase())))
    .sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });

  if (openId) {
    return <PlayerDetail data={data} update={update} playerId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={filters.team} onChange={(e) => setFilters({ ...filters, team: e.target.value })}>
          <option value="all">All teams</option>
          {Object.entries(data.teams).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select>
        <select value={filters.pos} onChange={(e) => setFilters({ ...filters, pos: e.target.value })}>
          <option value="all">All pos</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className={filters.starred ? "primary" : ""} onClick={() => setFilters({ ...filters, starred: !filters.starred })}>⭐</button>
        <button className={filters.inSquad ? "primary" : ""} onClick={() => setFilters({ ...filters, inSquad: !filters.inSquad })}>My squad</button>
        <input placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} style={{ flex: 1, minWidth: 100 }} />
      </div>
      <div className="scroll-x">
        <table>
          <thead><tr>
            {COLS.map(([key, label]) => (
              <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
                {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: "pointer" }}>
                <td>{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.name}</td>
                <td>{r.pos}{r.mismatch ? " ⚠" : ""}</td>
                <td>{r.price ?? "—"}</td>
                <td>{r.points ?? "—"}</td>
                <td>{r.goals}</td><td>{r.assists}</td><td>{r.minutes}</td><td>{r.starts}</td><td>{r.subApps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="dim">No players match — import some matches first.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write PlayerDetail**

```jsx
// src/components/PlayerDetail.jsx
import { useState } from "react";
import { setPlayerField, setAdjustment, playerAppearances, deriveRealPosition } from "../lib/store.js";
import { scoreAppearance } from "../lib/scoring.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

function AdjustForm({ adj, onSave, onCancel }) {
  const [goals, setGoals] = useState(adj?.goals ?? 0);
  const [assists, setAssists] = useState(adj?.assists ?? 0);
  const [note, setNote] = useState(adj?.note ?? "");
  return (
    <div className="card">
      <div className="row">
        <label>Δ goals <input type="number" value={goals} style={{ width: 60 }} onChange={(e) => setGoals(Number(e.target.value))} /></label>
        <label>Δ assists <input type="number" value={assists} style={{ width: 60 }} onChange={(e) => setAssists(Number(e.target.value))} /></label>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input placeholder="note (e.g. won pen)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" onClick={() => onSave(goals || assists ? { goals, assists, note } : null)}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function PlayerDetail({ data, update, playerId, onBack }) {
  const [adjustKey, setAdjustKey] = useState(null);
  const p = data.players[playerId];
  const apps = playerAppearances(data, playerId);
  const derived = deriveRealPosition(apps);
  const team = (id) => data.teams[id]?.shortName || id;

  const setField = (field, value) => update((d) => setPlayerField(d, playerId, field, value));

  return (
    <div>
      <div className="row"><button onClick={onBack}>←</button><h3 style={{ margin: 0 }}>{p.name} · {data.teams[p.teamId]?.name}</h3></div>
      <div className="card row">
        <button className={p.starred ? "primary" : ""} onClick={() => setField("starred", !p.starred)}>⭐ watch</button>
        <button className={p.inSquad ? "primary" : ""} onClick={() => setField("inSquad", !p.inSquad)}>🔵 in squad</button>
        <span className="dim">€{p.price ?? "?"}</span>
      </div>
      <div className="card">
        <div className="row">
          <label>Game pos:
            <select value={p.gamePosition || ""} onChange={(e) => setField("gamePosition", e.target.value || null)}>
              <option value="">—</option>{POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>Real pos:
            <select value={p.realPosition || ""} onChange={(e) => setField("realPosition", e.target.value || null)}>
              <option value="">auto{derived ? `: ${derived.position} (${derived.count}/${derived.total})` : ""}</option>
              {POSITIONS.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Match</th><th>Min</th><th>G</th><th>A</th><th>Pos</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            {[...apps].reverse().map((a) => {
              const m = data.matches[a.eventId];
              const key = `${a.eventId}:${a.playerId}`;
              const adj = data.adjustments[key];
              const score = p.gamePosition && m?.goalTimes ? scoreAppearance(a, m, p.gamePosition, adj) : null;
              const opp = a.teamId === m?.homeTeamId ? `v ${team(m?.awayTeamId)}` : `@ ${team(m?.homeTeamId)}`;
              return (
                <tr key={key}>
                  <td>R{m?.round} {opp}</td>
                  <td>{a.minutes + (adj?.minutes || 0)}</td>
                  <td>{a.goals + (adj?.goals || 0)}{adj?.goals ? "✏" : ""}</td>
                  <td>{a.assists + (adj?.assists || 0)}{adj?.assists ? "✏" : ""}</td>
                  <td>{a.positionPlayed}</td>
                  <td title={score ? score.breakdown.map(([r, v]) => `${r} ${v > 0 ? "+" : ""}${v}`).join(", ") : ""}>
                    {score ? score.total : "—"}
                  </td>
                  <td><button onClick={() => setAdjustKey(key)}>✏</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adjustKey && (
        <AdjustForm
          adj={data.adjustments[adjustKey]}
          onSave={(adj) => { update((d) => setAdjustment(d, adjustKey, adj)); setAdjustKey(null); }}
          onCancel={() => setAdjustKey(null)}
        />
      )}
      {apps.length === 0 && <p className="dim">No appearances imported yet.</p>}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev` with at least one round imported.
Expected: Players table sorts on header taps and filters work; ⚠ appears only for players with ≥3 appearances contradicting their game position; opening a player shows the appearance log; setting Game pos makes Pts appear (hover a Pts cell to see the breakdown); saving an adjustment marks ✏ and changes points; toggles persist after reload.

- [ ] **Step 4: Run tests and commit**

Run: `npm test`
Expected: green.

```bash
git add src/components/PlayersTab.jsx src/components/PlayerDetail.jsx
git commit -m "feat: players table and player detail with adjustments"
```

---

### Task 11: Teams tab — starters grid

**Files:**
- Modify: `src/components/TeamsTab.jsx` (replace placeholder)

- [ ] **Step 1: Write the component**

```jsx
// src/components/TeamsTab.jsx
import { useState } from "react";

// ● started full · ◐ subbed off · ○ came on as sub · — no appearance
function cellFor(app) {
  if (!app) return { sym: "—", title: "did not play" };
  if (!app.started) return { sym: `○${app.subOnMin ?? ""}'`, title: `sub on ${app.subOnMin}'` };
  if (app.subOffMin != null) return { sym: `◐${app.subOffMin}'`, title: `subbed off ${app.subOffMin}'` };
  return { sym: "●", title: "full match" };
}

export default function TeamsTab({ data }) {
  const teamIds = Object.keys(data.teams);
  const [teamId, setTeamId] = useState(teamIds[0] || null);

  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === teamId || String(m.awayTeamId) === teamId))
    .sort((a, b) => a.kickoff - b.kickoff);

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === teamId);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  // Order rows by appearance count (regulars first).
  const counts = new Map();
  for (const a of apps) counts.set(a.playerId, (counts.get(a.playerId) || 0) + 1);
  const playerIds = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={teamId || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        <span className="dim">● start · ◐ off · ○ on · — out</span>
      </div>
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr>
              <th>Player</th>
              {matches.map((m) => {
                const home = String(m.homeTeamId) === teamId;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                return <th key={m.eventId} title={`${home ? "v" : "@"} ${opp}`}>R{m.round}</th>;
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => (
                <tr key={pid}>
                  <td>{data.players[pid]?.name || pid}</td>
                  {matches.map((m) => {
                    const { sym, title } = cellFor(byPlayerMatch.get(`${m.eventId}:${pid}`));
                    return <td key={m.eventId} title={title}>{sym}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev` with several rounds imported.
Expected: picking a team shows the players × rounds grid, regulars at the top, symbols matching lineups (cross-check one match against SofaScore's site); column headers show R<round> with opponent on hover.

- [ ] **Step 3: Run tests and commit**

Run: `npm test`
Expected: green.

```bash
git add src/components/TeamsTab.jsx
git commit -m "feat: teams tab starters grid"
```

---

### Task 12: Settings tab — paste import, resync, season info

**Files:**
- Modify: `src/lib/store.js` (add `applyPasteResults`)
- Modify: `test/store.test.js` (add tests)
- Modify: `src/components/SettingsTab.jsx` (replace placeholder)

- [ ] **Step 1: Write the failing tests** (append to `test/store.test.js`; add `applyPasteResults` to its store import list)

```js
describe("applyPasteResults", () => {
  it("price paste sets price + timestamp", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A Keena", value: 9.5 }], "price", NOW);
    expect(d.players["10"].price).toBe(9.5);
    expect(d.players["10"].priceUpdatedAt).toBe(NOW);
  });
  it("position paste sets gamePosition with source=paste", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A Keena", value: 9.5 }], "FWD", NOW);
    expect(d.players["10"]).toMatchObject({ gamePosition: "FWD", gamePositionSource: "paste" });
  });
  it("position paste never clobbers a manual gamePosition", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "MID");
    d = applyPasteResults(d, [{ playerId: "10", name: "A Keena", value: 9.5 }], "FWD", NOW);
    expect(d.players["10"].gamePosition).toBe("MID");
  });
  it("remembers manual-link aliases", () => {
    const d = applyPasteResults(importedFixture(), [{ playerId: "10", name: "A. Keena (FLOI)", value: 9.5, alias: "A. Keena (FLOI)" }], "price", NOW);
    expect(d.players["10"].pasteAlias).toBe("A. Keena (FLOI)");
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run test/store.test.js`
Expected: 4 new failures — `applyPasteResults` not exported.

- [ ] **Step 3: Implement in src/lib/store.js**

```js
// kind: "price" | "GK" | "DEF" | "MID" | "FWD"
export function applyPasteResults(data, matched, kind, now) {
  const next = structuredClone(data);
  for (const m of matched) {
    const p = next.players[m.playerId];
    if (!p) continue;
    if (kind === "price") {
      p.price = m.value;
      p.priceUpdatedAt = now;
    } else if (p.gamePositionSource !== "manual") {
      p.gamePosition = kind;
      p.gamePositionSource = "paste";
    }
    if (m.alias) p.pasteAlias = m.alias;
  }
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Write SettingsTab**

```jsx
// src/components/SettingsTab.jsx
import { useState } from "react";
import { parsePaste, matchPlayers } from "../lib/pasteImport.js";
import { applyPasteResults } from "../lib/store.js";

const KINDS = [
  ["price", "Prices (Statistic = Value, Position = All)"],
  ["GK", "Positions — Goalkeepers"], ["DEF", "Positions — Defenders"],
  ["MID", "Positions — Midfielders"], ["FWD", "Positions — Forwards"],
];

export default function SettingsTab({ data, update }) {
  const [kind, setKind] = useState("price");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null); // { matched, unmatched, links: {idx: playerId} }

  const parse = () => {
    const rows = parsePaste(text);
    const { matched, unmatched } = matchPlayers(rows, data.players);
    setPreview({ matched, unmatched, links: {} });
  };

  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ playerId: pid, name: u.name, value: u.value, alias: u.name }));
    update((d) => applyPasteResults(d, [...preview.matched, ...linked], kind, Date.now()));
    setPreview(null); setText("");
  };

  const signOut = () => { sessionStorage.clear(); window.location.reload(); };

  return (
    <div>
      <div className="card">
        <h3>Import from Fantasy LOI</h3>
        <p className="dim">
          Open fantasyloi.leagueofireland.ie → Stats → Player Stats, set the dropdowns to match
          your selection below, select the whole results table, copy, and paste here.
        </p>
        <div className="row">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>
            {KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <textarea rows={6} style={{ width: "100%", marginTop: 8 }} value={text}
          placeholder="Padraig Amond	10&#10;Michael Duffy	10&#10;…"
          onChange={(e) => { setText(e.target.value); setPreview(null); }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={parse} disabled={!text.trim()}>Parse</button>
          {preview && (
            <button className="primary" onClick={apply}>
              Apply {preview.matched.length + Object.keys(preview.links).length} players
            </button>
          )}
        </div>
        {preview && (
          <div style={{ marginTop: 8 }}>
            <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
            {preview.unmatched.map((u, i) => (
              <div className="row" key={i}>
                <span style={{ flex: 1 }}>“{u.name}” ({u.value})</span>
                <select value={preview.links[i] || ""}
                  onChange={(e) => setPreview({ ...preview, links: { ...preview.links, [i]: e.target.value || undefined } })}>
                  <option value="">skip</option>
                  {Object.entries(data.players)
                    .sort((a, b) => a[1].name.localeCompare(b[1].name))
                    .map(([id, p]) => <option key={id} value={id}>{p.name} ({data.teams[p.teamId]?.shortName})</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3>Season</h3>
        <p className="dim">
          Tournament {data.meta.tournamentId} · season {data.meta.seasonId}.
          New season? Find the id via api.sofascore.com/api/v1/unique-tournament/192/seasons
          (open in a browser tab) and update below.
        </p>
        <div className="row">
          <label>Season id <input defaultValue={data.meta.seasonId} style={{ width: 110 }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v && v !== data.meta.seasonId) update((d) => ({ ...d, meta: { ...d.meta, seasonId: v } }));
            }} /></label>
        </div>
      </div>
      <div className="card row">
        <button onClick={() => window.location.reload()}>⟳ Resync from Drive</button>
        <button onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. On the real fantasyloi Player Stats page select Statistic=Value, copy the table, paste under “Prices”, Parse.
Expected: high match count (imported players only — players never seen in lineups won't match, that's expected), manual-link dropdowns for stragglers; Apply then check a player's € in the Players tab; repeat once with a Positions paste and confirm gamePosition fills in and Pts start computing. Manually-set positions must survive a second paste.

- [ ] **Step 7: Run tests and commit**

Run: `npm test`
Expected: green.

```bash
git add src/lib/store.js test/store.test.js src/components/SettingsTab.jsx
git commit -m "feat: settings tab with fantasyloi paste import and season config"
```

---

### Task 13: CI, deploy, and end-to-end verification

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `README.md`

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/deploy.yml
name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write README.md**

```markdown
# fancystats

Personal League of Ireland fantasy football stats. Static React app on GitHub
Pages; match data imported from SofaScore in the browser; everything stored in
my own Google Drive (appDataFolder). No server.

- Live: https://seaninryan.github.io/fancystats/
- Spec: docs/superpowers/specs/2026-06-05-fancystats-design.md
- Dev: `npm install && npm run dev` (http://localhost:5173/fancystats/)
- Tests: `npm test`
- Deploy: push to main → GitHub Actions → Pages
```

- [ ] **Step 3: Create the GitHub repo and push**

```bash
gh repo create fancystats --public --source . --push
gh api repos/{owner}/fancystats/pages -X POST -f build_type=workflow
git add .github/ README.md
git commit -m "feat: GitHub Actions Pages deploy"
git push
```

Then run: `gh run watch`
Expected: build job (tests pass) then deploy job succeed; site responds at `https://seaninryan.github.io/fancystats/`.

If `gh api ... /pages` returns 409 the Pages site already exists — fine. If repo creation requires auth scopes, fall back to creating the repo in the GitHub UI and `git remote add origin … && git push -u origin main`, then enable Pages (Settings → Pages → Source: GitHub Actions).

- [ ] **Step 4: OAuth origin (manual, user)**

In Google Cloud console → APIs & Services → Credentials → the web client used by sideline: confirm `https://seaninryan.github.io` is in Authorized JavaScript origins (it should be, from sideline) and that `http://localhost:5173` was added in Task 8. No redirect URIs needed (token flow).

- [ ] **Step 5: End-to-end verification on the deployed site**

From a phone or any non-dev browser, open `https://seaninryan.github.io/fancystats/`:
1. Sign in → Matches → Check for new matches → Import all missing (full-season backfill; expect a few minutes).
2. Settings → paste prices, paste the four position tables.
3. Players: confirm Pts populate; pick 2–3 players whose scores you know from your fantasy team and compare a finished gameweek's points against the game's published numbers.
4. Record any divergence: assist-definition gaps → fix with an adjustment (✏) and note; systematic rule errors (e.g. the second-yellow decision) → fix `RULES`/scoring, add a regression test reproducing the real case, commit, push.
5. Teams tab: spot-check one club's grid against SofaScore lineups.

- [ ] **Step 6: Capture real fixtures (optional but recommended)**

Open `tools/capture.html` in a browser, enter an imported match's event id (visible in SofaScore match URLs), download the three payloads into `test/fixtures/`, and add a golden test in `test/normalize.test.js` asserting a few known values from that real match. Commit.

- [ ] **Step 7: Final check and commit**

Run: `npm test && npm run build`
Expected: green.

```bash
git add -A
git commit -m "chore: phase 1 complete — verified against live gameweek"
git push
```

---

## Verification checklist (whole plan)

- [ ] `npm test` green: scoring, store, normalize, sofascore, pasteImport suites
- [ ] CI deploys on push; site loads on phone
- [ ] Full season imported; partial imports visible and retryable
- [ ] Prices + game positions pasted in; manual edits survive re-paste and re-import
- [ ] Computed points match the game's published scores for sampled players (divergences explained as assist-definition gaps and adjusted)
- [ ] Teams grid matches SofaScore lineups for a sampled match






