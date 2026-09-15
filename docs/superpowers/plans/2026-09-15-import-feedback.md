# Import Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Settings tab's import cards visible confirmation when a snippet is copied and when a pasted import is applied.

**Architecture:** Two new presentational components — `CopyButton` (a self-reverting clipboard button) and `Flash` (a success banner that clears itself after 5s) — wired into the three existing import cards. The branchy string/class derivations are exported as pure functions from their component files and unit-tested directly, following the `defaultLinks` pattern already established in `FantasyImport.jsx` / `test/fantasyImport.test.jsx`. No `src/lib/` changes: there is no domain rule here, only UI state.

**Tech Stack:** React 18, Vite, Vitest (node environment — **no jsdom**, so component tests are `renderToStaticMarkup` SSR smoke tests and effects never run).

**Spec:** `docs/superpowers/specs/2026-09-15-import-feedback-design.md`

---

## Environment

The system Node is v14 and silently breaks Vite/Vitest. Prefix **every** npm/npx command in this plan:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
```

## File Structure

| File | Responsibility |
|---|---|
| `src/components/Flash.jsx` (create) | Success banner; owns only the dismissal timer |
| `src/components/CopyButton.jsx` (create) | Clipboard write + the idle/copied/failed label cycle |
| `test/flash.test.jsx` (create) | SSR coverage of the render branches |
| `test/copyButton.test.jsx` (create) | SSR coverage + unit tests for `copyLabel` |
| `src/styles.css` (modify) | `.banner.ok`, `.banner.flash`, `button.copied`, `button.copy-failed`, `@keyframes flash-out` |
| `src/components/ConsoleImport.jsx` (modify) | Swap in `CopyButton`; move the result string into `Flash` |
| `src/components/FantasyImport.jsx` (modify) | Swap in `CopyButton`; add `appliedMessage` + `Flash` |
| `src/components/SettingsTab.jsx` (modify) | Add short kind names, `appliedMessage` + `Flash` |
| `package.json` / `package-lock.json` (modify) | Version bump — it renders in the footer and is the user's cache tell |

---

### Task 1: Styles

**Files:**
- Modify: `src/styles.css:24-26` (the `.banner` block)

- [ ] **Step 1: Add the success banner next to its warn/err siblings**

Find this block at `src/styles.css:24`:

```css
.banner { padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.banner.warn { background: #fdf2d0; color: #6e5400; }
.banner.err { background: #fbdcd7; color: #8c1d18; }
```

Replace it with:

```css
.banner { padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.banner.warn { background: #fdf2d0; color: #6e5400; }
.banner.err { background: #fbdcd7; color: #8c1d18; }
.banner.ok { background: #dcf0e4; color: #14512f; }
/* holds legible, then dissolves over the last half-second so the removal reads
   as a fade rather than a layout jump */
.banner.flash { animation: flash-out 5s forwards; }
@keyframes flash-out { 0%, 90% { opacity: 1; } 100% { opacity: 0; } }
```

- [ ] **Step 2: Add the copy-button states**

Find this line at `src/styles.css:12`:

```css
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
```

Add directly beneath it:

```css
button.copied { background: var(--accent); border-color: var(--accent); color: #fff; }
button.copy-failed { background: #fbdcd7; border-color: #f0b4ab; color: #8c1d18; }
```

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: success banner and copy-button feedback states"
```

---

### Task 2: The `Flash` banner

**Files:**
- Create: `src/components/Flash.jsx`
- Test: `test/flash.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `test/flash.test.jsx`:

```jsx
// test/flash.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Flash from "../src/components/Flash.jsx";

describe("Flash SSR", () => {
  it("renders the message as a success banner", () => {
    const html = renderToStaticMarkup(<Flash message="Imported 6 match(es)." onDone={() => {}} />);
    expect(html).toContain("Imported 6 match(es).");
    expect(html).toContain("banner ok");
    expect(html).toContain("flash"); // carries the fade animation
  });
  it("renders nothing when there is no message", () => {
    expect(renderToStaticMarkup(<Flash message={null} onDone={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<Flash message="" onDone={() => {}} />)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/flash.test.jsx
```

Expected: FAIL — cannot resolve `../src/components/Flash.jsx`.

- [ ] **Step 3: Write the component**

Create `src/components/Flash.jsx`:

```jsx
// src/components/Flash.jsx
import { useEffect, useRef } from "react";

const HOLD_MS = 5000;

// A success banner that dismisses itself. The parent owns the message and clears it
// from onDone; Flash owns nothing but the timer. onDone is read through a ref so an
// unrelated parent re-render can't restart the countdown mid-fade.
export default function Flash({ message, onDone, ms = HOLD_MS }) {
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => done.current(), ms);
    return () => clearTimeout(t);
  }, [message, ms]);
  if (!message) return null;
  return <div className="banner ok flash">✓ {message}</div>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/flash.test.jsx
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/Flash.jsx test/flash.test.jsx
git commit -m "feat: self-dismissing success banner"
```

---

### Task 3: The `CopyButton`

**Files:**
- Create: `src/components/CopyButton.jsx`
- Test: `test/copyButton.test.jsx`

- [ ] **Step 1: Write the failing test**

`copyLabel` is a pure state→presentation map, exported from the component file so the
three states are testable without a DOM. This mirrors `defaultLinks` in
`src/components/FantasyImport.jsx`.

Create `test/copyButton.test.jsx`:

```jsx
// test/copyButton.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CopyButton, { copyLabel } from "../src/components/CopyButton.jsx";

describe("copyLabel", () => {
  it("shows the caller's label when idle, with no state class", () => {
    expect(copyLabel("idle", "Copy snippet")).toEqual({ label: "Copy snippet", className: undefined });
  });
  it("confirms a copy", () => {
    expect(copyLabel("copied", "Copy snippet")).toEqual({ label: "✓ Copied", className: "copied" });
  });
  it("reports a failure rather than silently reverting", () => {
    expect(copyLabel("failed", "Copy snippet")).toEqual({ label: "Copy failed", className: "copy-failed" });
  });
});

describe("CopyButton SSR", () => {
  it("renders the idle label", () => {
    const html = renderToStaticMarkup(<CopyButton text="x">Copy snippet</CopyButton>);
    expect(html).toContain("Copy snippet");
    expect(html).not.toContain("disabled");
  });
  it("honours disabled", () => {
    const html = renderToStaticMarkup(<CopyButton text="x" disabled>Copy snippet</CopyButton>);
    expect(html).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/copyButton.test.jsx
```

Expected: FAIL — cannot resolve `../src/components/CopyButton.jsx`.

- [ ] **Step 3: Write the component**

Create `src/components/CopyButton.jsx`:

```jsx
// src/components/CopyButton.jsx
import { useEffect, useRef, useState } from "react";

const HOLD = { copied: 2000, failed: 3000 };

// Pure state → presentation. Exported so all three states are unit-testable in the
// node environment, where no click can be simulated.
export function copyLabel(state, idle) {
  if (state === "copied") return { label: "✓ Copied", className: "copied" };
  if (state === "failed") return { label: "Copy failed", className: "copy-failed" };
  return { label: idle, className: undefined };
}

export default function CopyButton({ text, disabled, children }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (next) => {
    clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => setState("idle"), HOLD[next]);
  };

  const copy = async () => {
    // Deliberately no optional chaining on navigator.clipboard: where the API is
    // missing (any non-secure context) the click must report a failure, not look
    // like it worked.
    try {
      await navigator.clipboard.writeText(text);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  const { label, className } = copyLabel(state, children);
  return <button className={className} onClick={copy} disabled={disabled}>{label}</button>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/copyButton.test.jsx
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/CopyButton.jsx test/copyButton.test.jsx
git commit -m "feat: copy button that confirms or reports failure"
```

---

### Task 4: Wire `ConsoleImport`

**Files:**
- Modify: `src/components/ConsoleImport.jsx`
- Test: `test/consoleImport.test.jsx`

`status` currently carries both the in-progress `Importing…` and the result. Split them:
`status` keeps the in-progress text (it must **not** fade while work is running) and the
new `flash` carries the result.

- [ ] **Step 1: Add the imports**

At the top of `src/components/ConsoleImport.jsx`, after the existing `consoleImport.js` import, add:

```jsx
import CopyButton from "./CopyButton.jsx";
import Flash from "./Flash.jsx";
```

- [ ] **Step 2: Add the flash state**

Find:

```jsx
  const [error, setError] = useState(null);
  const [refetchAll, setRefetchAll] = useState(false);
```

Replace with:

```jsx
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [refetchAll, setRefetchAll] = useState(false);
```

- [ ] **Step 3: Route the result through the flash**

Find the whole `doImport` body and replace it with:

```jsx
  const doImport = async () => {
    setError(null); setStatus(null); setFlash(null);
    let blob;
    try { blob = JSON.parse(paste); }
    catch { setError("Couldn't parse — copy the snippet output again."); return; }
    if (blob?.meta?.seasonId != null && String(blob.meta.seasonId) !== String(data.meta.seasonId)) {
      setError(`Blob is for season ${blob.meta.seasonId}, app is on ${data.meta.seasonId}.`);
      return;
    }
    setBusy(true); setStatus("Importing…");
    try {
      const decoded = await decodeBlob(blob);
      const now = Date.now();
      update((d) => applyDecoded(d, decoded, now));
      setPaste("");
      setFlash(`Imported ${decoded.results.length} match(es)${decoded.failed.length ? `, ${decoded.failed.length} failed` : ""}.`);
      if (decoded.failed.length) setError(decoded.failed.map((f) => `${f.id}: ${f.error}`).join("; "));
    } catch (e) {
      setError(e.message);
    }
    setStatus(null);
    setBusy(false);
  };
```

- [ ] **Step 4: Swap the copy button in**

Find:

```jsx
        <button onClick={() => navigator.clipboard?.writeText(snippet)} disabled={!token}>Copy snippet</button>
```

Replace with:

```jsx
        <CopyButton text={snippet} disabled={!token}>Copy snippet</CopyButton>
```

- [ ] **Step 5: Clear a stale flash when a new blob is pasted**

Find:

```jsx
      <textarea placeholder="Paste the snippet output here" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} style={{ width: "100%", fontFamily: "monospace" }} />
```

Replace with:

```jsx
      <textarea placeholder="Paste the snippet output here" value={paste}
        onChange={(e) => { setPaste(e.target.value); setFlash(null); }}
        rows={4} style={{ width: "100%", fontFamily: "monospace" }} />
```

- [ ] **Step 6: Render the banner**

Find:

```jsx
      {error && <div className="banner err">{error}</div>}
    </div>
  );
}
```

Replace with:

```jsx
      <Flash message={flash} onDone={() => setFlash(null)} />
      {error && <div className="banner err">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 7: Add the test**

Append to the `describe("ConsoleImport SSR", ...)` block in `test/consoleImport.test.jsx`, before its closing `});`:

```jsx
  it("offers a copy button, disabled until a token is set", () => {
    const html = renderToStaticMarkup(<ConsoleImport data={emptyData()} update={() => {}} />);
    expect(html).toContain("Copy snippet");
    expect(html).toContain("disabled");
  });
  it("enables the copy button once a token is set", () => {
    const data = { ...emptyData(), meta: { ...emptyData().meta, sofascoreToken: "2421c3" } };
    const html = renderToStaticMarkup(<ConsoleImport data={data} update={() => {}} />);
    // the Import button is still disabled (nothing pasted), the copy one is not
    expect(html.match(/disabled/g)).toHaveLength(1);
  });
```

- [ ] **Step 8: Run the test**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/consoleImport.test.jsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/ConsoleImport.jsx test/consoleImport.test.jsx
git commit -m "feat: console import confirms a copy and a finished import"
```

---

### Task 5: Wire `FantasyImport`

**Files:**
- Modify: `src/components/FantasyImport.jsx`
- Test: `test/fantasyImport.test.jsx`

- [ ] **Step 1: Write the failing test for the message**

Append to `test/fantasyImport.test.jsx`:

```jsx
describe("appliedMessage", () => {
  it("reports the player count", () => {
    expect(appliedMessage(214, 0)).toBe("Applied 214 players");
  });
  it("calls out newly created players separately", () => {
    expect(appliedMessage(214, 3)).toBe("Applied 214 players + 3 new");
  });
});
```

And extend its import at the top of the file — find:

```jsx
import FantasyImport, { defaultLinks } from "../src/components/FantasyImport.jsx";
```

Replace with:

```jsx
import FantasyImport, { defaultLinks, appliedMessage } from "../src/components/FantasyImport.jsx";
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx
```

Expected: FAIL — `appliedMessage is not a function`.

- [ ] **Step 3: Add the imports and the pure message builder**

In `src/components/FantasyImport.jsx`, after the existing `UnmatchedLinks` import, add:

```jsx
import CopyButton from "./CopyButton.jsx";
import Flash from "./Flash.jsx";
```

Then, directly above `export default function FantasyImport`, add:

```jsx
// Mirrors the Apply button's own wording, so the confirmation reads as the same
// sentence the button promised.
export function appliedMessage(players, newCount) {
  return `Applied ${players} players${newCount ? ` + ${newCount} new` : ""}`;
}
```

- [ ] **Step 4: Add the state and set it on apply**

Find:

```jsx
  const [preview, setPreview] = useState(null); // { players, clubs, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);
```

Replace with:

```jsx
  const [preview, setPreview] = useState(null); // { players, clubs, clubMap, matched, unmatched, links }
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
```

Find the `apply` function and replace the whole thing with:

```jsx
  const apply = () => {
    const picks = preview.unmatched.map((u, i) => ({ u, pid: preview.links[i] }));
    const linked = picks
      .filter((x) => x.pid && x.pid !== NEW_PLAYER)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const created = picks.filter((x) => x.pid === NEW_PLAYER).map((x) => x.u);
    const now = Date.now(); // updaters stay pure — same convention as the paste card
    update((d) => {
      const next = applyFantasyRows(d, [...preview.matched, ...linked], now);
      return created.length ? addFantasyOnlyPlayers(next, created, now) : next;
    });
    // counted before the preview is cleared — it's the only source for these numbers
    setFlash(appliedMessage(preview.matched.length + linked.length, created.length));
    setPreview(null);
    setPaste("");
  };
```

Also clear a stale flash on a fresh parse — find `const parse = () => {` and its first line:

```jsx
  const parse = () => {
    setError(null);
```

Replace with:

```jsx
  const parse = () => {
    setError(null); setFlash(null);
```

- [ ] **Step 5: Swap the copy button in and render the banner**

Find:

```jsx
        <button onClick={() => navigator.clipboard?.writeText(SNIPPET)}>Copy snippet</button>
```

Replace with:

```jsx
        <CopyButton text={SNIPPET}>Copy snippet</CopyButton>
```

Find:

```jsx
      {error && <div className="banner err">{error}</div>}
```

Replace with:

```jsx
      <Flash message={flash} onDone={() => setFlash(null)} />
      {error && <div className="banner err">{error}</div>}
```

Clear the flash when the paste box changes — find:

```jsx
        onChange={(e) => { setPaste(e.target.value); setPreview(null); }} />
```

Replace with:

```jsx
        onChange={(e) => { setPaste(e.target.value); setPreview(null); setFlash(null); }} />
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/fantasyImport.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/FantasyImport.jsx test/fantasyImport.test.jsx
git commit -m "feat: fantasy import confirms what it applied"
```

---

### Task 6: Wire `SettingsTab`

**Files:**
- Modify: `src/components/SettingsTab.jsx`
- Test: `test/settingsTab.test.jsx`

The five `KINDS` labels are long form-filling instructions ("Prices (Statistic = Value,
Position = All)") and read badly in a sentence, so each gains a short name for the
confirmation.

- [ ] **Step 1: Write the failing test**

Extend the import at the top of `test/settingsTab.test.jsx` — find:

```jsx
import SettingsTab from "../src/components/SettingsTab.jsx";
```

Replace with:

```jsx
import SettingsTab, { appliedMessage } from "../src/components/SettingsTab.jsx";
```

Append to the file:

```jsx
describe("appliedMessage", () => {
  it("names which of the five imports landed", () => {
    expect(appliedMessage(180, "price")).toBe("Updated 180 players — prices");
    expect(appliedMessage(22, "GK")).toBe("Updated 22 players — goalkeeper positions");
    expect(appliedMessage(60, "DEF")).toBe("Updated 60 players — defender positions");
    expect(appliedMessage(70, "MID")).toBe("Updated 70 players — midfielder positions");
    expect(appliedMessage(40, "FWD")).toBe("Updated 40 players — forward positions");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/settingsTab.test.jsx
```

Expected: FAIL — `appliedMessage is not a function`.

- [ ] **Step 3: Add short names, the imports, and the message builder**

In `src/components/SettingsTab.jsx`, after the `ConsoleImport` import, add:

```jsx
import Flash from "./Flash.jsx";
```

Find the `KINDS` constant:

```jsx
const KINDS = [
  ["price", "Prices (Statistic = Value, Position = All)"],
  ["GK", "Positions — Goalkeepers"], ["DEF", "Positions — Defenders"],
  ["MID", "Positions — Midfielders"], ["FWD", "Positions — Forwards"],
];
```

Replace with (third element is the short name used in the confirmation):

```jsx
const KINDS = [
  ["price", "Prices (Statistic = Value, Position = All)", "prices"],
  ["GK", "Positions — Goalkeepers", "goalkeeper positions"],
  ["DEF", "Positions — Defenders", "defender positions"],
  ["MID", "Positions — Midfielders", "midfielder positions"],
  ["FWD", "Positions — Forwards", "forward positions"],
];

// Five near-identical imports share this card, so the confirmation has to say which
// one landed.
export function appliedMessage(count, kind) {
  const short = (KINDS.find(([k]) => k === kind) || [])[2] || kind;
  return `Updated ${count} players — ${short}`;
}
```

- [ ] **Step 4: Add the state and set it on apply**

Find:

```jsx
  const [preview, setPreview] = useState(null); // { matched, unmatched, links: {idx: playerId} }
```

Replace with:

```jsx
  const [preview, setPreview] = useState(null); // { matched, unmatched, links: {idx: playerId} }
  const [flash, setFlash] = useState(null);
```

Find `const parse = () => {` and replace the whole function with:

```jsx
  const parse = () => {
    const rows = parsePaste(text);
    const { matched, unmatched } = matchPlayers(rows, data.players);
    setPreview({ matched, unmatched, links: {} });
    setFlash(null);
  };
```

Find `const apply = () => {` and replace the whole function with:

```jsx
  const apply = () => {
    const linked = preview.unmatched
      .map((u, i) => ({ u, pid: preview.links[i] }))
      .filter((x) => x.pid)
      .map(({ u, pid }) => ({ ...u, playerId: pid, alias: u.name }));
    const now = Date.now();
    update((d) => applyPasteResults(d, [...preview.matched, ...linked], kind, now));
    // counted before the preview is cleared — it's the only source for this number
    setFlash(appliedMessage(preview.matched.length + linked.length, kind));
    setPreview(null); setText("");
  };
```

- [ ] **Step 5: Clear the flash on a kind change or a fresh paste, and render the banner**

Find:

```jsx
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); }}>
```

Replace with:

```jsx
          <select value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setFlash(null); }}>
```

Find:

```jsx
          onChange={(e) => { setText(e.target.value); setPreview(null); }} />
```

Replace with:

```jsx
          onChange={(e) => { setText(e.target.value); setPreview(null); setFlash(null); }} />
```

Find the closing of the parse/apply row:

```jsx
          )}
        </div>
        {preview && (
          <div style={{ marginTop: 8 }}>
            <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
```

Replace with:

```jsx
          )}
        </div>
        <Flash message={flash} onDone={() => setFlash(null)} />
        {preview && (
          <div style={{ marginTop: 8 }}>
            <p>✓ {preview.matched.length} matched · {preview.unmatched.length} unmatched</p>
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx vitest run test/settingsTab.test.jsx
```

Expected: PASS. Note the existing `rel="noreferrer"` / `target="_blank"` count
assertions must still hold at 2 — `CopyButton` adds no links.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsTab.jsx test/settingsTab.test.jsx
git commit -m "feat: paste import says how many players it updated"
```

---

### Task 7: Full verification and release

**Files:**
- Modify: `package.json:4`, `package-lock.json`

- [ ] **Step 1: Run the whole suite**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm test
```

Expected: all suites pass. Do not continue on a failure — fix it first.

- [ ] **Step 2: Build**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run build
```

Expected: `built in …`, no errors. The build is the only check that catches JSX
mistakes the node-environment tests cannot.

- [ ] **Step 3: Bump the version**

This is a feature, so the minor: `0.27.0` → `0.28.0`. It renders in the app footer and
is the user's cache tell, so it must move before the deploy.

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm version 0.28.0 --no-git-tag-version
npm install --package-lock-only
```

- [ ] **Step 4: Verify both files moved**

```bash
grep -m2 '"version"' package.json package-lock.json
```

Expected: `0.28.0` in `package.json` and in `package-lock.json`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: v0.28.0"
```

---

## Manual verification (after deploy)

The node test environment has no DOM, so the interactive half is checked by hand:

1. Settings → **Copy snippet** on the console card → label flips to `✓ Copied` green, reverts after ~2s, and the clipboard holds the snippet.
2. Same on the Fantasy LOI card.
3. Paste a snippet output → **Import** → green `✓ Imported N match(es).` banner, which fades away after ~5s.
4. Fantasy LOI: paste → **Parse** → **Apply** → green `✓ Applied N players` banner.
5. Legacy paste card: pick a kind, paste, **Parse** → **Apply** → green `✓ Updated N players — <kind>`.
6. Type into a paste box while a banner is showing → the banner clears immediately.
