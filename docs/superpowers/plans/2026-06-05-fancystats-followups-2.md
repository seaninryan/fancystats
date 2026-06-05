# fancystats Follow-ups 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Light theme + app icon + version; directional mismatch indicator with filter; Teams page overhaul (alphabetical, next fixture, home/away+result headers, per-cell fantasy points, sortable windowed totals with All/3/5 highlighting); team colours on Players; availability flags ("out" with note + history); upcoming fixtures; stale-data banner; postponed/superseded match hygiene; date on all match rows; sticky first table column.

**Architecture:** unchanged. New user-owned player field `flags` (array of `{setAt, clearedAt, note}`) — survives re-imports automatically (imports never touch user player fields). `playerTotals` gains an options bag `{position, eventIds}`. New pure module `src/lib/teamColors.js`. Version injected by Vite `define` from package.json.

**Env:** prefix npm/npx with `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && `.

---

### Task 1: Library changes (TDD)

**Files:**
- Modify: `src/lib/store.js`, `package.json`, `vite.config.js`
- Create: `src/lib/teamColors.js`
- Test: `test/store.test.js`, `test/teamColors.test.js`

- [ ] **Step 1: Failing tests — append to test/store.test.js** (extend that file's store import list with: `markOut, clearOut, activeFlag, mismatchInfo, isSupersededPostponed, staleInfo`):

```js
describe("availability flags", () => {
  it("markOut adds an active flag; clearOut closes it; history retained", () => {
    let d = markOut(importedFixture(), 10, "ACL injury", NOW);
    expect(activeFlag(d.players["10"])).toMatchObject({ note: "ACL injury", setAt: NOW, clearedAt: null });
    d = markOut(d, 10, "second note ignored while active", NOW + 1);
    expect(d.players["10"].flags).toHaveLength(1);
    d = clearOut(d, 10, NOW + 2);
    expect(activeFlag(d.players["10"])).toBeNull();
    expect(d.players["10"].flags[0].clearedAt).toBe(NOW + 2);
    d = markOut(d, 10, "World Cup", NOW + 3);
    expect(d.players["10"].flags).toHaveLength(2);
    expect(activeFlag(d.players["10"]).note).toBe("World Cup");
  });
  it("flags survive re-import", () => {
    let d = markOut(importedFixture(), 10, "suspended", NOW);
    d = applyImport(d, {
      match: { eventId: 100, round: 1, kickoff: 1764900000000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0, goalTimes: { home: [40], away: [] }, partial: false },
      teams: [], players: [{ id: 10, name: "A Keena", teamId: 1 }], appearances: [],
    }, NOW + 5);
    expect(activeFlag(d.players["10"]).note).toBe("suspended");
  });
});

describe("playerTotals options", () => {
  it("position override re-scores without changing the stored position", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "DEF");
    expect(playerTotals(d, 10).points).toBe(3 + 2 + 6 + 4);      // fullMatch+win+DEF goal+CS
    expect(playerTotals(d, 10, { position: "FWD" }).points).toBe(3 + 2 + 4); // FWD goal, no CS
    expect(d.players["10"].gamePosition).toBe("DEF");
  });
  it("eventIds filter restricts which matches count", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(playerTotals(d, 10, { eventIds: new Set([100]) }).points).toBe(9);
    const t = playerTotals(d, 10, { eventIds: new Set([999]) });
    expect(t.points).toBe(0);
    expect(t.minutes).toBe(0);
  });
});

describe("mismatchInfo", () => {
  const threeApps = (d) => {
    for (const ev of [101, 102]) {
      d.matches[ev] = { ...d.matches["100"], eventId: ev };
      d.appearances[`${ev}:10`] = { ...d.appearances["100:10"], eventId: ev };
    }
    return d;
  };
  it("favourable: game DEF, really a FWD — positive delta", () => {
    let d = threeApps(setPlayerField(importedFixture(), 10, "gamePosition", "DEF"));
    const mi = mismatchInfo(d, 10);
    expect(mi.realPosition).toBe("FWD");
    expect(mi.delta).toBeGreaterThan(0); // DEF goals (6) + clean sheets beat FWD scoring
  });
  it("unfavourable: game FWD, really a DEF — negative delta", () => {
    let d = threeApps(setPlayerField(importedFixture(), 10, "gamePosition", "FWD"));
    d = setPlayerField(d, 10, "realPosition", "DEF");
    expect(mismatchInfo(d, 10).delta).toBeLessThan(0);
  });
  it("null when no mismatch or too few observations", () => {
    let d = setPlayerField(importedFixture(), 10, "gamePosition", "FWD");
    expect(mismatchInfo(d, 10)).toBeNull(); // only 1 appearance, no manual realPosition
    d = setPlayerField(d, 10, "realPosition", "FWD");
    expect(mismatchInfo(d, 10)).toBeNull(); // positions agree
  });
});

describe("postponed hygiene", () => {
  const withShell = () => {
    let d = importedFixture();
    d.matches["200"] = { eventId: 200, round: 1, kickoff: 1764800000000, status: "postponed", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null };
    return d;
  };
  it("isSupersededPostponed: postponed twin of a real same-pairing same-round match", () => {
    const d = withShell();
    expect(isSupersededPostponed(d, d.matches["200"])).toBe(true);
    expect(isSupersededPostponed(d, d.matches["100"])).toBe(false); // the real one
  });
  it("a lone postponed match is not superseded", () => {
    let d = withShell();
    d.matches["200"].awayTeamId = 99; // different pairing
    expect(isSupersededPostponed(d, d.matches["200"])).toBe(false);
  });
  it("staleInfo counts played-but-missing matches, ignoring postponed/superseded", () => {
    let d = withShell();
    const now = 1765000000000;
    d.matches["300"] = { eventId: 300, round: 2, kickoff: now - 4 * 3600 * 1000, status: "finished", homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 0 }; // finished, unimported
    d.matches["301"] = { eventId: 301, round: 2, kickoff: now - 4 * 3600 * 1000, status: "notstarted", homeTeamId: 2, awayTeamId: 1, homeScore: null, awayScore: null }; // stale stub
    d.matches["302"] = { eventId: 302, round: 3, kickoff: now + 4 * 3600 * 1000, status: "notstarted", homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null }; // future
    expect(staleInfo(d, now).count).toBe(2); // 300 + 301; shell 200 excluded, 302 future, 100 imported
  });
});
```

- [ ] **Step 2: Failing tests — create test/teamColors.test.js:**

```js
import { describe, it, expect } from "vitest";
import { teamColor } from "../src/lib/teamColors.js";

describe("teamColor", () => {
  it("maps known clubs to their colours", () => {
    expect(teamColor({ name: "Shamrock Rovers" }).bg).toBe("#0e7a3c");
    expect(teamColor({ name: "Bohemians" }).bg).toBe("#c8102e");
  });
  it("falls back to a deterministic colour for unknown clubs", () => {
    const a = teamColor({ name: "Mystery FC" });
    expect(a).toEqual(teamColor({ name: "Mystery FC" }));
    expect(a.bg).toMatch(/^hsl\(/);
    expect(teamColor(null).bg).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 3: run both test files — new tests fail (exports missing).**

- [ ] **Step 4: Implement.**

`src/lib/teamColors.js` (new):

```js
// Real club colours for the LOI Premier Division (keyed by SofaScore team name).
// Unknown clubs (promotion, name drift) get a stable fallback hue.
const CLUB_COLORS = {
  "Shamrock Rovers": { bg: "#0e7a3c", fg: "#ffffff" },
  "Bohemians": { bg: "#c8102e", fg: "#ffffff" },
  "St. Patrick's Athletic": { bg: "#e03a3e", fg: "#ffffff" },
  "Derry City": { bg: "#d6001c", fg: "#ffffff" },
  "Dundalk": { bg: "#1d1d1b", fg: "#ffffff" },
  "Shelbourne": { bg: "#d4002a", fg: "#ffffff" },
  "Sligo Rovers": { bg: "#b3001e", fg: "#ffffff" },
  "Galway United": { bg: "#6a1a41", fg: "#ffffff" },
  "Drogheda United": { bg: "#7b2d43", fg: "#ffffff" },
  "Cork City": { bg: "#0c5c2e", fg: "#ffffff" },
  "Waterford": { bg: "#0050a0", fg: "#ffffff" },
};

export function teamColor(team) {
  const known = team?.name && CLUB_COLORS[team.name];
  if (known) return known;
  let h = 0;
  for (const ch of team?.name || "?") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 55% 38%)`, fg: "#ffffff" };
}
```

`src/lib/store.js` — replace `playerTotals` with the options-bag version and append the new functions:

```js
// opts.position: score as if the player had this position (mismatch what-ifs).
// opts.eventIds: Set — only count appearances from these matches (windowed totals).
export function playerTotals(data, playerId, opts = {}) {
  const player = data.players[playerId];
  const position = opts.position ?? player?.gamePosition;
  let apps = playerAppearances(data, playerId);
  if (opts.eventIds) apps = apps.filter((a) => opts.eventIds.has(a.eventId));
  const t = { minutes: 0, goals: 0, assists: 0, starts: 0, subApps: 0, points: position ? 0 : null };
  for (const a of apps) {
    const key = `${a.eventId}:${a.playerId}`;
    const adj = data.adjustments[key] || null;
    const eff = { ...a };
    if (adj) for (const f of ["goals", "assists", "minutes"]) if (typeof adj[f] === "number") eff[f] += adj[f];
    t.minutes += eff.minutes; t.goals += eff.goals; t.assists += eff.assists;
    a.started ? t.starts++ : t.subApps++;
    if (t.points !== null) {
      const match = data.matches[a.eventId];
      if (match?.goalTimes) t.points += scoreAppearance(a, match, position, adj).total;
    }
  }
  return t;
}

// ---- availability flags (user-owned; imports never touch them) ----

export function markOut(data, playerId, note, now) {
  const next = structuredClone(data);
  const p = next.players[playerId];
  if (!p) return data;
  p.flags = p.flags || [];
  if (!p.flags.some((f) => !f.clearedAt)) p.flags.push({ setAt: now, clearedAt: null, note: note || "" });
  return next;
}

export function clearOut(data, playerId, now) {
  const next = structuredClone(data);
  const f = next.players[playerId]?.flags?.find((x) => !x.clearedAt);
  if (!f) return data;
  f.clearedAt = now;
  return next;
}

export const activeFlag = (p) => p?.flags?.find((f) => !f.clearedAt) || null;

// ---- directional position mismatch ----

// null when positions agree (or can't be established). delta > 0 means the game's
// position OVERPAYS vs where they really play — a player to exploit.
export function mismatchInfo(data, playerId) {
  const player = data.players[playerId];
  if (!player?.gamePosition) return null;
  let real = player.realPosition;
  if (!real) {
    const derived = deriveRealPosition(playerAppearances(data, playerId));
    if (derived && derived.total >= 3) real = derived.position;
  }
  if (!real || real === player.gamePosition) return null;
  const gamePts = playerTotals(data, playerId).points ?? 0;
  const realPts = playerTotals(data, playerId, { position: real }).points ?? 0;
  return { realPosition: real, delta: gamePts - realPts };
}

// ---- postponed/stale hygiene ----

// A postponed event whose pairing+natural-round has a real sibling event is a dead
// shell left behind by SofaScore rescheduling (they create a new event id).
export function isSupersededPostponed(data, m) {
  if (m.status !== "postponed" && m.status !== "canceled") return false;
  return Object.values(data.matches).some((o) =>
    o.eventId !== m.eventId && o.status !== "postponed" && o.status !== "canceled" &&
    o.homeTeamId === m.homeTeamId && o.awayTeamId === m.awayTeamId && o.round === m.round);
}

// Matches that kicked off (>3h ago) whose stats we don't have yet.
export function staleInfo(data, now) {
  const cutoff = now - 3 * 3600 * 1000;
  const missing = Object.values(data.matches).filter((m) =>
    m.kickoff < cutoff &&
    m.status !== "postponed" && m.status !== "canceled" &&
    !(m.status === "finished" && m.importedAt) &&
    !isSupersededPostponed(data, m));
  return { count: missing.length };
}
```

`package.json`: bump `"version"` to `"0.2.0"`.

`vite.config.js`:

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  base: "/fancystats/",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
```

- [ ] **Step 5: full suite green** (`npx vitest run` — expect 89 + 12 new = 101).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ test/ package.json vite.config.js
git commit -m "feat: flags, directional mismatch, windowed totals, postponed/stale hygiene, team colours, version define"
```

---

### Task 2: Light theme, icons, version display, stale banner, sticky columns

**Files:**
- Modify: `src/styles.css`, `index.html`, `src/App.jsx`
- Create: `tools/make-icon.py`, `public/icon-180.png`, `public/icon-touch-180.png`

- [ ] **Step 1: Light palette — replace the `:root` block in src/styles.css with:**

```css
:root {
  --bg: #f4f6f7; --panel: #ffffff; --line: #d7dee3;
  --text: #17222b; --dim: #5d7180; --accent: #1f7a4d; --warn: #9c7100; --err: #b3261e;
  color-scheme: light;
}
```

and update the two banner rules and the blue cell colour:

```css
.banner.warn { background: #fdf2d0; color: #6e5400; }
.banner.err { background: #fbdcd7; color: #8c1d18; }
.cell-on { color: #2563b8; }
```

Append the sticky-first-column helper:

```css
.sticky-col th:first-child, .sticky-col td:first-child {
  position: sticky; left: 0; background: var(--bg); z-index: 2;
}
```

- [ ] **Step 2: tools/make-icon.py** (run with `python3 tools/make-icon.py` from repo root; PIL 10.x is installed):

```python
"""Generate fancystats icons: football on rising bar chart, accent green."""
import math
from PIL import Image, ImageDraw

S = 720  # render 4x, downscale for anti-aliasing
GREEN = (31, 122, 77, 255)
INK = (23, 34, 43, 255)

def draw_mark(d):
    bw, gap, base = 150, 55, S - 70
    heights = [240, 380, 520]
    for i, h in enumerate(heights):
        x = 65 + i * (bw + gap)
        d.rounded_rectangle([x, base - h, x + bw, base], radius=42, fill=GREEN)
    # football perched on the tallest bar
    cx = 65 + 2 * (bw + gap) + bw // 2
    cy, r = base - heights[2] - 95, 88
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255), outline=INK, width=12)
    pts = [(cx + 0.45 * r * math.sin(i * 2 * math.pi / 5),
            cy - 0.45 * r * math.cos(i * 2 * math.pi / 5)) for i in range(5)]
    d.polygon(pts, fill=INK)
    for px, py in pts:
        d.line([px, py, cx + (px - cx) * 2.1, cy + (py - cy) * 2.1], fill=INK, width=10)

# transparent favicon
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_mark(ImageDraw.Draw(img))
img.resize((180, 180), Image.LANCZOS).save("public/icon-180.png")

# iOS home-screen tile (solid light background; iOS renders transparency as black)
tile = Image.new("RGBA", (S, S), (244, 246, 247, 255))
draw_mark(ImageDraw.Draw(tile))
tile.resize((180, 180), Image.LANCZOS).save("public/icon-touch-180.png")
print("wrote public/icon-180.png, public/icon-touch-180.png")
```

Run it (`mkdir -p public` first). Vite copies `public/` to the site root of `dist/`.

- [ ] **Step 3: index.html** — inside `<head>`, after the referrer meta, add:

```html
  <link rel="icon" type="image/png" sizes="180x180" href="./icon-180.png" />
  <link rel="apple-touch-icon" href="./icon-touch-180.png" />
```

- [ ] **Step 4: src/App.jsx** — version + stale banner:

Add to the imports: `import { emptyData, staleInfo } from "./lib/store.js";` (replacing the existing emptyData import line).

Add below the imports:

```js
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
```

In the ready-state render, change the save-state span so the version shows beside it:

```jsx
        <span className="dim" role="status" aria-live="polite" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ not saved" : `v${VERSION}`}
        </span>
```

And directly under the `</nav>` (above the authExpired banner), add:

```jsx
      {(() => {
        const stale = staleInfo(data, Date.now());
        return stale.count > 0 && tab !== "matches" ? (
          <div className="banner warn" role="status">
            Stats may be out of date — {stale.count} match{stale.count > 1 ? "es" : ""} played since the last update.{" "}
            <button onClick={() => setTab("matches")}>Go to Matches</button>
          </div>
        ) : null;
      })()}
```

(Hidden on the Matches tab itself, where the state is already visible. `Date.now()` in render is acceptable here — display-only, not inside a state updater.)

- [ ] **Step 5:** `npm test && npm run build` green; confirm `dist/icon-180.png` exists after build. Commit:

```bash
git add src/styles.css index.html src/App.jsx tools/make-icon.py public/
git commit -m "feat: light theme, app icons, version badge, stale-data banner, sticky-column css"
```

---

### Task 3: Matches tab — dates everywhere, postponed handling, superseded shells hidden

**Files:**
- Modify: `src/components/MatchesTab.jsx`

- [ ] **Step 1: Apply these changes:**

a) Import `isSupersededPostponed` from `../lib/store.js` (extend the existing import).

b) Filter shells and count them — replace `const matches = Object.values(data.matches);` with:

```js
  const all = Object.values(data.matches);
  const hiddenShells = all.filter((m) => isSupersededPostponed(data, m)).length;
  const matches = all.filter((m) => !isSupersededPostponed(data, m));
```

c) Treat postponed as inert — replace the `todo` definition with:

```js
  const gone = (m) => m.status === "postponed" || m.status === "canceled";
  const todo = (m) => !gone(m) && ((m.status === "finished" && !m.importedAt) || m.status === "notstarted");
```

d) Every row shows its date — replace the match-label span body with:

```jsx
              <span style={{ flex: 1 }}>
                {team(m.homeTeamId)} {m.homeScore ?? ""}–{m.awayScore ?? ""} {team(m.awayTeamId)}
                <span className="dim"> · {fmtDate(m.kickoff)}</span>
              </span>
```

e) Postponed badge — in the status/action ternary chain, add a first branch:

```jsx
              {gone(m) ? <span className="dim">postponed</span>
                : m.status !== "finished" ? <span className="dim">upcoming</span>
                : ...unchanged rest...}
```

f) Footnote — after the rounds list (bottom of the component), add:

```jsx
      {hiddenShells > 0 && (
        <p className="dim">{hiddenShells} postponed duplicate{hiddenShells > 1 ? "s" : ""} hidden (rescheduled by SofaScore).</p>
      )}
```

- [ ] **Step 2:** `npm test && npm run build` green. Commit:

```bash
git add src/components/MatchesTab.jsx
git commit -m "feat: match dates, postponed badges, superseded shells hidden"
```

---

### Task 4: Players tab + Player detail — chips, directional mismatch, flags, upcoming

**Files:**
- Modify: `src/components/PlayersTab.jsx`, `src/components/PlayerDetail.jsx`, `src/styles.css`

- [ ] **Step 1: styles.css** — append:

```css
.chip { padding: 1px 7px; border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.gain { color: var(--accent); font-weight: 700; }
.loss { color: var(--err); font-weight: 700; }
```

- [ ] **Step 2: Replace src/components/PlayersTab.jsx with:**

```jsx
import { useMemo, useState } from "react";
import { playerTotals, playerAppearances, mismatchInfo, activeFlag } from "../lib/store.js";
import { teamColor } from "../lib/teamColors.js";
import PlayerDetail from "./PlayerDetail.jsx";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];
const COLS = [
  ["name", "Player"], ["teamName", "Team"], ["pos", "Pos"], ["price", "€"], ["points", "Pts"],
  ["goals", "G"], ["assists", "A"], ["minutes", "Min"], ["starts", "St"], ["subApps", "Sub"],
];

function MismatchMark({ mi }) {
  if (!mi) return null;
  const up = mi.delta >= 0;
  return (
    <span className={up ? "gain" : "loss"}
      title={`really plays ${mi.realPosition}: game position pays ${up ? "+" : ""}${mi.delta} pts vs real`}>
      {up ? "▲" : "▼"}
    </span>
  );
}

export default function PlayersTab({ data, update }) {
  const [filters, setFilters] = useState({ team: "all", pos: "all", starred: false, inSquad: false, mismatch: false, q: "" });
  const [sort, setSort] = useState({ key: "points", dir: -1 });
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    return Object.entries(data.players).map(([id, p]) => {
      const team = data.teams[p.teamId];
      return {
        id, name: p.name, teamId: p.teamId, team,
        teamName: team?.shortName || "?",
        pos: p.gamePosition || "—",
        price: p.price, starred: p.starred, inSquad: p.inSquad,
        mi: mismatchInfo(data, id), out: activeFlag(p),
        ...playerTotals(data, id),
      };
    });
  }, [data]);

  const shown = rows
    .filter((r) =>
      (filters.team === "all" || String(r.teamId) === filters.team) &&
      (filters.pos === "all" || r.pos === filters.pos) &&
      (!filters.starred || r.starred) &&
      (!filters.inSquad || r.inSquad) &&
      (!filters.mismatch || r.mi) &&
      (!filters.q || r.name.toLowerCase().includes(filters.q.toLowerCase())))
    .sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      // deliberate: null prices/points always sink to the bottom, regardless of sort direction
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
          {Object.entries(data.teams)
            .sort((a, b) => a[1].name.localeCompare(b[1].name))
            .map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
        </select>
        <select value={filters.pos} onChange={(e) => setFilters({ ...filters, pos: e.target.value })}>
          <option value="all">All pos</option>
          {POSITIONS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button className={filters.starred ? "primary" : ""} onClick={() => setFilters({ ...filters, starred: !filters.starred })}>⭐</button>
        <button className={filters.inSquad ? "primary" : ""} onClick={() => setFilters({ ...filters, inSquad: !filters.inSquad })}>My squad</button>
        <button className={filters.mismatch ? "primary" : ""} title="position mismatches only"
          onClick={() => setFilters({ ...filters, mismatch: !filters.mismatch })}>▲▼</button>
        <input placeholder="Search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} style={{ flex: 1, minWidth: 100 }} />
      </div>
      <div className="scroll-x">
        <table className="sticky-col">
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
                <td>{r.starred ? "⭐ " : ""}{r.inSquad ? "🔵 " : ""}{r.out ? <span title={r.out.note}>🚫 </span> : ""}{r.name}</td>
                <td><span className="chip" style={{ background: teamColor(r.team).bg, color: teamColor(r.team).fg }}>{r.teamName}</span></td>
                <td>{r.pos} <MismatchMark mi={r.mi} /></td>
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

(Note: `playerAppearances` is no longer used here — drop it from the import if unused after this change.)

- [ ] **Step 3: PlayerDetail.jsx changes:**

a) Extend imports:

```js
import { setPlayerField, setAdjustment, playerAppearances, deriveRealPosition, matchRound, markOut, clearOut, activeFlag, mismatchInfo } from "../lib/store.js";
import { teamColor } from "../lib/teamColors.js";
```

b) In the component body (after `const derived = ...`), add:

```js
  const out = activeFlag(p);
  const mi = mismatchInfo(data, playerId);
  const history = (p.flags || []).filter((f) => f.clearedAt);
  const now = Date.now();
  const upcoming = Object.values(data.matches)
    .filter((m) => (m.homeTeamId === p.teamId || m.awayTeamId === p.teamId)
      && m.kickoff > now && m.status !== "postponed" && m.status !== "canceled")
    .sort((a, b) => a.kickoff - b.kickoff)
    .slice(0, 2);
  const fmtD = (ts) => new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
```

c) Header line gets the club chip (replace the `<h3>`):

```jsx
        <h3 style={{ margin: 0 }}>
          {p.name}{" "}
          <span className="chip" style={{ background: teamColor(data.teams[p.teamId]).bg, color: teamColor(data.teams[p.teamId]).fg }}>
            {data.teams[p.teamId]?.name}
          </span>
        </h3>
```

d) In the positions card, show the mismatch verdict — after the Real pos label add:

```jsx
          {mi && (
            <span className={mi.delta >= 0 ? "gain" : "loss"}>
              {mi.delta >= 0 ? "▲" : "▼"} game position pays {mi.delta >= 0 ? "+" : ""}{mi.delta} pts vs {mi.realPosition}
            </span>
          )}
```

e) New availability + upcoming card (insert after the positions card):

```jsx
      <AvailabilityCard p={p} out={out} history={history} fmtD={fmtD}
        onMark={(note) => update((d) => markOut(d, playerId, note, Date.now()))}
        onClear={() => update((d) => clearOut(d, playerId, Date.now()))} />
      {upcoming.length > 0 && (
        <div className="card dim">
          Upcoming: {upcoming.map((m) => {
            const home = m.homeTeamId === p.teamId;
            const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
            return `${home ? "v" : "@"} ${opp} ${fmtD(m.kickoff)}`;
          }).join(" · ")}
        </div>
      )}
```

f) Add the AvailabilityCard component at module level (above PlayerDetail):

```jsx
function AvailabilityCard({ p, out, history, fmtD, onMark, onClear }) {
  const [note, setNote] = useState("");
  return (
    <div className="card">
      {out ? (
        <div className="row">
          <span>🚫 <b>{out.note || "out"}</b> <span className="dim">since {fmtD(out.setAt)}</span></span>
          <button onClick={onClear}>Back available</button>
        </div>
      ) : (
        <div className="row">
          <input placeholder="injured / suspended / World Cup…" value={note}
            onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <button onClick={() => { onMark(note); setNote(""); }}>Mark out</button>
        </div>
      )}
      {history.length > 0 && (
        <div className="dim" style={{ marginTop: 6 }}>
          {history.map((f, i) => (
            <div key={i}>↳ {f.note || "out"} · {fmtD(f.setAt)} → {fmtD(f.clearedAt)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
```

(Note the `Date.now()` calls in `onMark`/`onClear` happen in the event handler before `update` — fine; do NOT move them inside the updater.)

Wait — they ARE inside the update callback as written. Hoist them:

```jsx
        onMark={(note) => { const now = Date.now(); update((d) => markOut(d, playerId, note, now)); }}
        onClear={() => { const now = Date.now(); update((d) => clearOut(d, playerId, now)); }}
```

Use this hoisted form.

g) Add `className="sticky-col"` to the appearance-log `<table>`.

- [ ] **Step 4:** `npm test && npm run build` green. Commit:

```bash
git add src/components/PlayersTab.jsx src/components/PlayerDetail.jsx src/styles.css
git commit -m "feat: team chips, directional mismatch + filter, availability flags, upcoming fixtures"
```

---

### Task 5: Teams tab overhaul

**Files:**
- Modify: `src/components/TeamsTab.jsx`, `src/styles.css`

- [ ] **Step 1: styles.css** — append:

```css
.win-col { background: #e9f3ee; }
th .sub { display: block; font-size: 11px; font-weight: 400; }
```

- [ ] **Step 2: Replace src/components/TeamsTab.jsx with:**

```jsx
import { useState } from "react";
import { matchRound, setPlayerField, activeFlag } from "../lib/store.js";
import { scoreAppearance } from "../lib/scoring.js";

// Colour = how they appeared; emoji = what they did. (cellFor unchanged from before:
// keep the existing implementation including the adjustment merge.)
function cellFor(app0, adj) { /* KEEP the current implementation verbatim */ }

const fmtD = (ts) => new Date(ts).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

const TOTAL_COLS = [["minutes", "Min"], ["goals", "G"], ["assists", "A"], ["points", "Pts"]];

export default function TeamsTab({ data, update }) {
  const teamIds = Object.keys(data.teams)
    .sort((a, b) => data.teams[a].name.localeCompare(data.teams[b].name));
  const [teamId, setTeamId] = useState(teamIds[0] || null);
  const [win, setWin] = useState("all"); // "all" | 3 | 5
  const [sort, setSort] = useState({ key: "apps", dir: -1 });
  const selected = teamId && data.teams[teamId] ? teamId : teamIds[0] || null;

  const gone = (m) => m.status === "postponed" || m.status === "canceled";
  const matches = Object.values(data.matches)
    .filter((m) => m.importedAt && (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected))
    .sort((a, b) => a.kickoff - b.kickoff);

  const now = Date.now();
  const nextMatch = Object.values(data.matches)
    .filter((m) => (String(m.homeTeamId) === selected || String(m.awayTeamId) === selected)
      && m.kickoff > now && !gone(m))
    .sort((a, b) => a.kickoff - b.kickoff)[0];

  const windowMatches = win === "all" ? matches : matches.slice(-win);
  const windowIds = new Set(windowMatches.map((m) => m.eventId));

  const apps = Object.values(data.appearances).filter((a) => String(a.teamId) === selected);
  const byPlayerMatch = new Map(apps.map((a) => [`${a.eventId}:${a.playerId}`, a]));

  // Windowed running totals per player (adjustment-aware, like PlayerDetail).
  const totals = new Map(); // pid -> {apps, minutes, goals, assists, points|null}
  for (const a of apps) {
    if (!totals.has(a.playerId)) totals.set(a.playerId, { apps: 0, minutes: 0, goals: 0, assists: 0, points: null });
    const t = totals.get(a.playerId);
    t.apps++; // all-time, used for default row order
    if (!windowIds.has(a.eventId)) continue;
    const adj = data.adjustments[`${a.eventId}:${a.playerId}`] || null;
    const g = (a.goals || 0) + (typeof adj?.goals === "number" ? adj.goals : 0);
    const as = (a.assists || 0) + (typeof adj?.assists === "number" ? adj.assists : 0);
    t.minutes += (a.minutes || 0) + (typeof adj?.minutes === "number" ? adj.minutes : 0);
    t.goals += Math.max(0, g);
    t.assists += Math.max(0, as);
    const p = data.players[a.playerId];
    const m = data.matches[a.eventId];
    if (p?.gamePosition && m?.goalTimes) {
      t.points = (t.points ?? 0) + scoreAppearance(a, m, p.gamePosition, adj).total;
    }
  }

  const playerIds = [...totals.keys()].sort((a, b) => {
    const ta = totals.get(a), tb = totals.get(b);
    const key = sort.key;
    const av = ta[key], bv = tb[key];
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sort.dir;
  });

  const resultPts = (m) => {
    const ours = String(m.homeTeamId) === selected ? m.homeScore : m.awayScore;
    const theirs = String(m.homeTeamId) === selected ? m.awayScore : m.homeScore;
    if (ours == null || theirs == null) return "";
    return ours > theirs ? "+2" : ours === theirs ? "+1" : "0";
  };

  const toggle = (pid, field, value) => update((d) => setPlayerField(d, pid, field, value));

  return (
    <div>
      <div className="row" style={{ margin: "8px 0" }}>
        <select value={selected || ""} onChange={(e) => setTeamId(e.target.value)}>
          {teamIds.map((id) => <option key={id} value={id}>{data.teams[id].name}</option>)}
        </select>
        {["all", 3, 5].map((w) => (
          <button key={w} className={win === w ? "primary" : ""} onClick={() => setWin(w)}>
            {w === "all" ? "All" : `Last ${w}`}
          </button>
        ))}
        {nextMatch && (
          <span className="dim">
            Next: {String(nextMatch.homeTeamId) === selected ? "v" : "@"}{" "}
            {data.teams[String(nextMatch.homeTeamId) === selected ? nextMatch.awayTeamId : nextMatch.homeTeamId]?.shortName}
            {" "}· {fmtD(nextMatch.kickoff)}
          </span>
        )}
      </div>
      <p className="dim">● start · ◐ off · ○ on · ⚽ goal · 🥅 pen · 👟 assist · number = fantasy pts</p>
      {matches.length === 0 ? <p className="dim">No imported matches for this team yet.</p> : (
        <div className="scroll-x">
          <table className="sticky-col">
            <thead><tr>
              <th onClick={() => setSort({ key: "apps", dir: -1 })}>Player</th>
              {TOTAL_COLS.map(([key, label]) => (
                <th key={key} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
                  {label}{sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
                </th>
              ))}
              {matches.map((m) => {
                const home = String(m.homeTeamId) === selected;
                const opp = data.teams[home ? m.awayTeamId : m.homeTeamId]?.shortName;
                return (
                  <th key={m.eventId} className={windowIds.has(m.eventId) && win !== "all" ? "win-col" : ""}
                    title={fmtD(m.kickoff)}>
                    R{matchRound(m)}
                    <span className="sub">{home ? "v" : "@"}{opp} {resultPts(m)}</span>
                  </th>
                );
              })}
            </tr></thead>
            <tbody>
              {playerIds.map((pid) => {
                const p = data.players[pid];
                const t = totals.get(pid);
                const out = activeFlag(p);
                return (
                  <tr key={pid}>
                    <td>
                      <button className={`mini-toggle ${p?.starred ? "" : "off"}`} aria-pressed={!!p?.starred} title="watchlist"
                        onClick={() => toggle(pid, "starred", !p?.starred)}>⭐</button>
                      <button className={`mini-toggle ${p?.inSquad ? "" : "off"}`} aria-pressed={!!p?.inSquad} title="in my squad"
                        onClick={() => toggle(pid, "inSquad", !p?.inSquad)}>🔵</button>
                      {" "}{out ? <span title={out.note}>🚫 </span> : ""}{p?.name || pid}
                    </td>
                    <td>{t.minutes}</td><td>{t.goals}</td><td>{t.assists}</td><td>{t.points ?? "—"}</td>
                    {matches.map((m) => {
                      const key = `${m.eventId}:${pid}`;
                      const a = byPlayerMatch.get(key);
                      const adj = data.adjustments[key];
                      const { sym, cls, title } = cellFor(a, adj);
                      const pts = a && data.players[pid]?.gamePosition && m.goalTimes
                        ? scoreAppearance(a, m, data.players[pid].gamePosition, adj).total : null;
                      return (
                        <td key={m.eventId}
                          className={`${cls}${windowIds.has(m.eventId) && win !== "all" ? " win-col" : ""}`}
                          title={title}>
                          {sym}{a ? <span className="dim"> {pts ?? "·"}</span> : ""}
                        </td>
                      );
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

**IMPORTANT:** `cellFor` must be carried over verbatim from the current file (it already merges adjustments and renders all decorations) — only its surroundings change.

- [ ] **Step 3:** `npm test && npm run build` green. Commit:

```bash
git add src/components/TeamsTab.jsx src/styles.css
git commit -m "feat: teams overhaul — windowed sortable totals, fixture headers, cell points, next match"
```

---

### Task 6: Deploy + user verification

- [ ] `git push`; watch Actions to success; site 200.
- [ ] User verifies: light theme everywhere; icon on tab/home-screen; `v0.2.0` in the bar; SHA–DUN shell hidden with footnote and the 1-1 movable to GW3; dates on all match rows; stale banner appears when relevant; ▲▼ with filter on Players; team chips; mark a player out and see 🚫 across screens + history after clearing; Teams: alphabetical, next fixture, header opp/result pts, cell pts, Last 3/5 highlight + totals, sort by Min/Pts; frozen first column when scrolling sideways on phone.


