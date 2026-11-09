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

// One capture row -> the shape every import path uses.
function normalizePlayerRow(p) {
  return {
    name: String(p.name).trim(),
    clubId: p.clubId != null ? String(p.clubId) : null,
    gamePosition: POSITIONS.includes(p.position) ? p.position : null,
    price: numOrNull(p.price),
    sitePoints: numOrNull(p.sitePoints),
  };
}

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
    .map(normalizePlayerRow);
  if (!players.length) throw new Error("No players in the capture — are you logged in on the fantasy site?");
  return { clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [], players };
}

// Pure: validate + normalize a Fantasy sync file (buildSyncSnippet's download).
// history/myTeam are raw site facts and pass through untouched; mapping them onto
// our matches happens at render time (sitePoints.js).
export function parseSyncBlob(text) {
  let blob;
  try {
    blob = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("Couldn't read that file — load the fancystats-sync JSON the snippet downloaded.");
  }
  if (blob?.meta?.source !== "fantasyloi-sync") throw new Error("That's not a Fantasy sync file.");
  if (blob.meta.version !== 1) {
    throw new Error(`Unsupported sync file version ${blob.meta.version} — copy the snippet again and re-run it.`);
  }
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map((p) => ({ ...normalizePlayerRow(p), siteId: numOrNull(p.siteId) }));
  if (!players.length) throw new Error("No players in the file — are you logged in on the fantasy site?");
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    capturedAt: numOrNull(blob.meta.capturedAt),
    siteTeamId: numOrNull(blob.meta.siteTeamId),
    clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [],
    players,
    history: obj(blob.history),
    myTeam: obj(blob.myTeam),
    yourLeagues: Array.isArray(blob.yourLeagues) ? blob.yourLeagues : [],
    leagues: obj(blob.leagues),
    opponents: obj(blob.opponents),
    me: obj(blob.me),
    // player pages the site couldn't serve (persistent HTTP 500): no history for them
    failed: (Array.isArray(blob.meta.failed) ? blob.meta.failed : []).map(numOrNull).filter((x) => x != null),
  };
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

// Returns the Fantasy sync console snippet. The user pastes it into a logged-in
// fantasyloi.leagueofireland.ie tab (any page). ~340 read-only requests, 300ms
// apart, one retry each (the site throws the odd HTTP 500), all-or-nothing:
//   1. Player Stats (token + 14 POSTs): price, position, total for every player
//   2. /Team/Transfers: site ids for players you don't own
//   3. /Results for every gameweek: your XI rows, bench, captain, points (+ squad site ids)
//   4. /ViewPlayer for every site id: each gameweek's points breakdown
// It downloads fancystats-sync-YYYY-MM-DD.json for Settings → Fantasy sync.
export function buildSyncSnippet({ siteTeamId } = {}) {
  const team = Number(siteTeamId);
  if (!Number.isInteger(team) || team <= 0) throw new Error("Set your fantasy team id first.");
  return `// fancystats fantasy sync — run on a logged-in fantasyloi.leagueofireland.ie tab (any page).
(async () => {
  const HOST = "fantasyloi.leagueofireland.ie", TEAM = ${team};
  const POS = [["Goalkeeper", "GK"], ["Defender", "DEF"], ["Midfielder", "MID"], ["Forward", "FWD"]];
  const say = (m, c) => console.log("%cfancystats: " + m, "color:" + (c || "gray") + ";font-weight:bold");
  if (!location.hostname.endsWith(HOST)) return say("run this on a " + HOST + " tab.", "red");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (e) => (e ? e.textContent : "").replace(/\\s+/g, " ").trim();
  const num = (s) => { const m = String(s == null ? "" : s).match(/-?\\d+(?:\\.\\d+)?/); return m ? parseFloat(m[0]) : null; };
  const path = (src) => { try { return new URL(src, location.href).pathname; } catch (e) { return src || ""; } };
  const load = async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, Object.assign({ credentials: "include" }, init));
      if (r.redirected && /login|account/i.test(r.url)) throw new Error("session expired — log in again, then re-run");
      if (r.ok) {
        const doc = new DOMParser().parseFromString(await r.text(), "text/html");
        await sleep(300);
        return doc;
      }
      if (attempt >= 1) throw new Error("HTTP " + r.status + " on " + url);
      await sleep(1500);
    }
  };
  try {
    // 1. prices, positions, totals: the Player Stats form, read from a fetched copy so any page works
    const statsPage = await load("/Stats/PlayerStats");
    const tokenEl = statsPage.querySelector("input[name=__RequestVerificationToken]");
    const clubSel = statsPage.querySelector("select#Club");
    if (!tokenEl || !clubSel) throw new Error("couldn't read the Player Stats form — log in on the fantasy site, then re-run");
    const token = tokenEl.value;
    const clubs = [...clubSel.options].filter((o) => o.value !== "All").map((o) => ({ id: o.value, name: o.text.trim() }));
    const post = async (Statistic, Club, Position) => {
      const doc = await load("/Stats/PlayerStats", { method: "POST", body: new URLSearchParams({ Statistic, Club, Position, __RequestVerificationToken: token }) });
      if (!doc.querySelector("select#Club")) throw new Error("session expired — log in again, then re-run");
      return [...doc.querySelectorAll("table.table tbody tr")].map((tr) => {
        const img = tr.querySelector("img");
        return { name: txt(tr.cells[1]), value: num(tr.cells[2] ? tr.cells[2].textContent : null), crest: img ? path(img.getAttribute("src")) : "" };
      }).filter((x) => x.name);
    };
    const rows = new Map(), crestToClub = new Map();
    const key = (n, c) => n + "|" + c;
    for (const c of clubs) {
      const list = await post("Value", c.id, "All");
      for (const x of list) {
        if (x.crest) crestToClub.set(x.crest, c.id);
        const k = key(x.name, c.id);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: c.id, price: x.value }));
      }
      say("prices — " + c.name + ": " + list.length);
    }
    for (const pair of POS) {
      const list = await post("Total Score", "All", pair[0]);
      for (const x of list) {
        const clubId = crestToClub.get(x.crest) || null;
        const k = key(x.name, clubId);
        rows.set(k, Object.assign({}, rows.get(k), { name: x.name, clubId: clubId, position: pair[1], sitePoints: x.value }));
      }
      say("points — " + pair[1] + ": " + list.length);
    }
    const club = (img) => (img ? crestToClub.get(path(img.getAttribute("src"))) || null : null);
    const byName = new Map();
    for (const row of rows.values()) byName.set(row.name, byName.has(row.name) ? null : row); // null = ambiguous
    // 2. site ids: Transfers lists every player you don't own
    const tr = await load("/Team/Transfers");
    const body = tr.querySelector("#boday");
    if (!body) throw new Error("couldn't read the Transfers page — log in on the fantasy site, then re-run");
    const ids = new Set();
    for (const r of body.querySelectorAll("tr")) {
      const id = num(txt(r.cells[7]));
      if (!id) continue;
      ids.add(id);
      const img = r.cells[2] ? r.cells[2].querySelector("img") : null;
      if (img) { // its title names the club: teach the crest map this crest path too
        const c = clubs.find((x) => x.name === img.getAttribute("title"));
        if (c) crestToClub.set(path(img.getAttribute("src")), c.id);
      }
      const name = txt(r.cells[1]);
      const row = rows.get(key(name, club(img))) || byName.get(name);
      if (row) row.siteId = id;
    }
    say("site ids: " + ids.size);
    // 3. your team, every gameweek
    const first = await load("/Results?teamId=" + TEAM + "&gameweek=1");
    const gws = [...new Set([...first.querySelectorAll("select option")].map((o) => Number(o.value))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 100))].sort((a, b) => a - b);
    if (!gws.length) throw new Error("couldn't read your Results page — check your team id (" + TEAM + ") and that you're logged in");
    const card = (el) => {
      const m = (el.getAttribute("onclick") || "").match(/playerScore\\('(\\d+)',\\s*'(.*)',\\s*'(-?\\d+)'\\)/);
      return m && { id: Number(m[1]), name: m[2], pts: Number(m[3]), captain: el.textContent.includes("(c)") };
    };
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
    // squad players aren't on Transfers: join them to their Player Stats row by name
    for (const row of rows.values()) if (row.siteId == null && squadIds.has(row.name)) row.siteId = squadIds.get(row.name);
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
    // 4. every player's season, gameweek by gameweek
    const history = {}, failed = [];
    const totalOf = new Map([...rows.values()].filter((x) => x.siteId != null).map((x) => [x.siteId, x.sitePoints]));
    let n = 0;
    for (const id of ids) {
      let doc;
      try {
        doc = await load("/ViewPlayer/ViewPlayer?playerId=" + id);
      } catch (e) {
        // Some player pages fail on the site every time (HTTP 500): skip those, list them in
        // the file, and stop only if many do (then the site itself is struggling).
        if (!/^HTTP 5/.test(e.message)) throw e;
        failed.push(id);
        if (failed.length > 5) throw new Error("the fantasy site is failing on many player pages — try again later");
        say("player " + id + "'s page fails on the site — skipped", "orange");
        continue;
      }
      history[id] = [...doc.querySelectorAll('[id$="+MatchDetails"]')].map((b) => {
        const imgs = b.querySelectorAll(".card-body img");
        const stats = [...b.querySelectorAll("table tbody tr")].map((r) => [...r.cells].map(txt))
          .filter((r) => r.length === 3 && r[0] !== "Stat").map((r) => [r[0], r[1], num(r[2])]);
        return [num(txt(b.querySelector(".card-header label"))), club(imgs[0]), club(imgs[1]), num(txt(b.querySelector(".card-body p"))), stats];
      });
      if (!doc.querySelector("h2.pageTitle") || (!history[id].length && typeof totalOf.get(id) === "number" && totalOf.get(id) !== 0)) {
        throw new Error("couldn't read player " + id + "'s history — session expired? log in and re-run");
      }
      if (++n % 25 === 0) say("history: " + n + "/" + ids.size);
    }
    const blob = { meta: { source: "fantasyloi-sync", version: 1, capturedAt: Date.now(), siteTeamId: TEAM, clubs: clubs, failed: failed },
      players: [...rows.values()], history: history, myTeam: myTeam,
      yourLeagues: yourLeagues, leagues: leagues, opponents: opponents, me: { details: myDetails } };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: "application/json" }));
    a.download = "fancystats-sync-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    say("done — " + blob.players.length + " players, " + ids.size + " histories, " + Object.keys(myTeam).length +
      " gameweeks of your team, " + Object.keys(leagues).length + " leagues" + (failed.length ? ", " + failed.length + " player page(s) skipped" : "") + ". Load the downloaded file in fancystats → ⚙ → Fantasy sync.", "lime");
  } catch (e) {
    say(e.message + " — nothing captured, re-run from the start.", "red");
  }
})();`;
}

// Within one insert/delete/substitution. Guards against surname drift between the
// two sources ("Kovalevskis" on the fantasy site, "Kovaleskis" on SofaScore). Short
// names are excluded: at four characters a single edit joins unrelated people.
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (Math.min(a.length, b.length) < 5) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Should an unmatched capture row become a fantasy-only record?
//
// Zero site points means the player has never played, so no SofaScore record can
// exist to link to — EXCEPT that a row also goes unmatched when the name is
// ambiguous (two clubmates called Ben Mahon, so matchPlayers can't choose) or has
// drifted by a character. Creating a record there duplicates someone who already
// exists, which is worse than asking. So a near-identical clubmate name vetoes it
// and the row keeps the link-or-skip default, with the Suggested list to hand.
//
// Compared on the WHOLE name, not the surname: "Alex Noonan" alongside "Michael
// Noonan" is a real second player, while "Max Kovalevskis" alongside "Max
// Kovaleskis" is one person spelled two ways.
export function shouldCreateRow(row, players) {
  if (row.teamId == null || row.sitePoints) return false;
  const target = normalizeName(row.name);
  if (!target) return false;
  return !Object.values(players || {}).some((p) =>
    !p.fantasyOnly &&
    String(p.teamId) === String(row.teamId) &&
    withinOneEdit(normalizeName(p.name), target));
}
