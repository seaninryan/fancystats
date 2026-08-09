// src/lib/fantasyImport.js
// Import from the Fantasy LOI site (fantasyloi.leagueofireland.ie). It is a
// server-rendered ASP.NET Core MVC app: Player Stats is a form POST whose third
// table column IS the selected statistic, so price and score need separate
// requests. See docs/superpowers/specs/2026-08-09-fantasy-console-import-design.md.
import { normalizeName } from "./pasteImport.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

// Accept a number or a numeric string ("8.3"); anything else -> null. Coercing
// rather than rejecting matters because a silently dropped price is invisible.
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// Pure: validate + normalize a pasted capture. Throws user-facing messages.
export function parseFantasyBlob(text) {
  let blob;
  try {
    blob = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("Couldn't parse — run the snippet again and copy all of its output.");
  }
  if (blob?.meta?.source !== "fantasyloi") throw new Error("That's not a Fantasy LOI capture.");
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      clubId: p.clubId != null ? String(p.clubId) : null,
      gamePosition: POSITIONS.includes(p.position) ? p.position : null,
      price: numOrNull(p.price),
      sitePoints: numOrNull(p.sitePoints),
    }));
  if (!players.length) throw new Error("No players in the capture — are you logged in on the fantasy site?");
  return { clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [], players };
}

// Pure: fantasy club id -> our SofaScore team id. Auto-resolves by normalized name,
// which absorbs the site's punctuation drift ("St Patricks Athletic" vs SofaScore's
// "St. Patrick's Athletic"). A stored user override always wins. Unknown -> null,
// never a guess: a wrong club would gate name matching to the wrong squad.
export function mapClubs(clubs, teams, overrides = {}) {
  const byName = new Map();
  for (const [id, t] of Object.entries(teams || {})) {
    if (t?.name) byName.set(normalizeName(t.name), id);
  }
  const out = {};
  for (const c of clubs || []) {
    const id = String(c.id);
    const override = (overrides || {})[id];
    out[id] = override ? String(override) : byName.get(normalizeName(c.name || "")) ?? null;
  }
  return out;
}

// Pure: stamp each capture row with the team it belongs to (null when unresolved,
// which makes matchPlayers fall back to name-only matching for that row).
export function withTeamIds(players, clubMap) {
  return (players || []).map((p) => ({ ...p, teamId: (p.clubId && clubMap?.[p.clubId]) || null }));
}

// Returns the console snippet source. The user pastes it into a logged-in
// fantasyloi.leagueofireland.ie tab's DevTools console. It replays the site's own
// form POST 14 times: 10 clubs x Statistic=Value (price, club exact from the query,
// and a crest -> club map as a side effect), then 4 positions x Statistic=Total
// Score (points, position exact from the query, club via the crest map). The third
// table column IS the statistic, so price and score can't come from one request.
export function buildFantasySnippet() {
  return `// fancystats fantasy import — run on a logged-in fantasyloi.leagueofireland.ie tab.
(async () => {
  const HOST = "fantasyloi.leagueofireland.ie";
  const POS = [["Goalkeeper", "GK"], ["Defender", "DEF"], ["Midfielder", "MID"], ["Forward", "FWD"]];
  const say = (m, c) => console.log("%cfancystats: " + m, "color:" + c + ";font-weight:bold");
  if (!location.hostname.endsWith(HOST)) return say("run this on a " + HOST + " tab.", "red");
  const token = document.querySelector("input[name=__RequestVerificationToken]")?.value;
  const clubSel = document.querySelector("select#Club");
  if (!token || !clubSel) return say("couldn't find the search form — make sure you're logged in, open Stats > Player Stats, then re-run.", "red");
  const clubs = [...clubSel.options].filter((o) => o.value !== "All").map((o) => ({ id: o.value, name: o.text.trim() }));
  window.fancystatsFantasyBlob = null; // clear any earlier run's blob so a failure can't leave a stale one to copy
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => { const m = String(s == null ? "" : s).match(/-?\\d+(?:\\.\\d+)?/); return m ? parseFloat(m[0]) : null; };
  const post = async (Statistic, Club, Position) => {
    const body = new URLSearchParams({ Statistic, Club, Position, __RequestVerificationToken: token });
    const r = await fetch("/Stats/PlayerStats", { method: "POST", body, credentials: "include" });
    if (!r.ok) throw new Error("HTTP " + r.status + " on " + Statistic + "/" + Club + "/" + Position);
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    if (!doc.querySelector("select#Club")) throw new Error("session expired — log in again, then re-run");
    return [...doc.querySelectorAll("table.table tbody tr")].map((tr) => {
      const img = tr.querySelector("img");
      return {
        name: (tr.cells[1] ? tr.cells[1].textContent : "").trim(),
        value: num(tr.cells[2] ? tr.cells[2].textContent : null),
        crest: img ? img.getAttribute("src") : "",
      };
    }).filter((x) => x.name);
  };
  try {
    const rows = new Map();          // "name|clubId" -> merged row
    const crestToClub = new Map();
    const key = (n, c) => n + "|" + c;
    for (const c of clubs) {                                   // pass A — price, club exact
      const list = await post("Value", c.id, "All");
      for (const x of list) {
        if (x.crest) crestToClub.set(x.crest, c.id);
        const k = key(x.name, c.id);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: c.id, price: x.value }));
      }
      say("club " + c.name + ": " + list.length, "gray");
      await sleep(300);
    }
    for (const pair of POS) {                                  // pass B — points, position exact
      const list = await post("Total Score", "All", pair[0]);
      for (const x of list) {
        const clubId = crestToClub.get(x.crest) || null;       // unknown crest -> null, never a guess
        const k = key(x.name, clubId);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: clubId, position: pair[1], sitePoints: x.value }));
      }
      say(pair[1] + ": " + list.length, "gray");
      await sleep(300);
    }
    const blob = { meta: { source: "fantasyloi", capturedAt: Date.now(), clubs: clubs }, players: [...rows.values()] };
    const json = JSON.stringify(blob);
    // copy() (the DevTools Command Line API) is out of scope inside an async IIFE
    // after an await, and navigator.clipboard rejects while focus is in DevTools —
    // so stash on window and offer the manual copy as the fallback.
    window.fancystatsFantasyBlob = json;
    try { await navigator.clipboard.writeText(json); } catch (err) { /* not focused — use the fallback */ }
    say("captured " + blob.players.length + " players. If your clipboard is empty, run  copy(fancystatsFantasyBlob)  then paste into the app.", "lime");
  } catch (e) {
    // all-or-nothing: the blob is only built after both passes, so a throw here
    // means nothing was captured. Say so — an error alone reads as "partly done".
    say(e.message + " — nothing captured, re-run from the start.", "red");
  }
})();`;
}
