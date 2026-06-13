// Console-snippet import. SofaScore's anti-bot challenge blocks all direct API
// access (see docs/superpowers/specs/2026-06-13-console-snippet-import-design.md);
// data is only reachable from inside a sofascore.com tab. We generate a snippet the
// user runs there; it copies a path-keyed payload blob to the clipboard; we replay
// that blob through the existing sofascore.js pipeline via an injected fetcher.
import { API, fetchSeasonEvents, importMatch } from "./sofascore.js";
import { upsertMatchStubs, applyImport } from "./store.js";

// A fetcher with the same contract as real fetch / the test stubs, but serving
// responses from a pasted blob. Keys are path suffixes like "/event/555".
// A recorded {__status:404} or a missing key yields a 404 (matches importMatch's
// graceful-degrade and walkEvents' stop-on-404).
export function blobToFetcher(blob) {
  const payloads = blob?.payloads || {};
  return async (url) => {
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const hit = payloads[path];
    if (hit === undefined || (hit && hit.__status === 404)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => hit };
  };
}

// Async: turn a pasted blob into the inputs the store mutators need. No dependency
// on the current data object, so the result can be applied inside a pure updater.
export async function decodeBlob(blob) {
  const fetcher = blobToFetcher(blob);
  const meta = { tournamentId: blob?.meta?.tournamentId, seasonId: blob?.meta?.seasonId };
  const { stubs, teams } = await fetchSeasonEvents(meta, fetcher);
  const results = [], failed = [];
  for (const id of blob?.meta?.builtFor || []) {
    try { results.push(await importMatch(id, fetcher)); }
    catch (e) { failed.push({ id, error: e.message }); }
  }
  return { stubs, teams, results, failed };
}

// Pure: fold decoded pieces into the data object via the existing store mutators.
export function applyDecoded(data, decoded, now) {
  let next = upsertMatchStubs(data, decoded.stubs, decoded.teams);
  next.meta = { ...next.meta, lastEventSync: now };
  for (const r of decoded.results) next = applyImport(next, r, now);
  return next;
}

// Returns the console snippet source. The user pastes it into a sofascore.com tab's
// DevTools console; it walks the season, skips KNOWN ids, fetches event+lineups+
// incidents for the rest, and copies a path-keyed blob to the clipboard via copy().
export function buildImportSnippet({ tournamentId, seasonId, token, knownEventIds }) {
  const known = JSON.stringify(knownEventIds || []);
  return `// fancystats import — run on a https://www.sofascore.com tab (DevTools console).
(async () => {
  const BASE = "https://www.sofascore.com/api/v1";
  const TOKEN = ${JSON.stringify(token || "")};
  const T = ${Number(tournamentId)}, S = ${Number(seasonId)};
  const KNOWN = new Set(${known});
  const payloads = {};
  const get = async (path) => {
    const r = await fetch(BASE + path, { headers: { "x-requested-with": TOKEN }, credentials: "include" });
    if (r.status === 403) throw new Error("challenge");
    if (r.status === 404) { payloads[path] = { __status: 404 }; return null; }
    const body = await r.json();
    payloads[path] = body;
    return body;
  };
  const walk = async (dir) => {
    const out = [];
    for (let p = 0; p < 20; p++) {
      const body = await get(\`/unique-tournament/\${T}/season/\${S}/events/\${dir}/\${p}\`);
      if (!body) break;
      out.push(...(body.events || []));
      if (!body.hasNextPage) break;
    }
    return out;
  };
  try {
    const events = [...(await walk("last")), ...(await walk("next"))];
    const todo = events.filter((e) => e.status?.type === "finished" && !KNOWN.has(e.id));
    for (const e of todo) {
      await get(\`/event/\${e.id}\`);
      await get(\`/event/\${e.id}/lineups\`);
      await get(\`/event/\${e.id}/incidents\`);
    }
    const blob = { meta: { tournamentId: T, seasonId: S, builtFor: todo.map((e) => e.id) }, payloads };
    // copy() (DevTools Command Line API) is out of scope inside this async IIFE after an
    // await, so don't rely on it: stash on window and attempt a normal clipboard write.
    // navigator.clipboard rejects if the page isn't focused (focus is in DevTools) — caught.
    const json = JSON.stringify(blob);
    window.fancystatsBlob = json;
    try { await navigator.clipboard.writeText(json); } catch (err) { /* not focused — use the fallback */ }
    console.log(\`%cfancystats: captured \${todo.length} match(es). If your clipboard is empty, run  copy(fancystatsBlob)  then paste into the app.\`, "color:lime;font-weight:bold");
  } catch (e) {
    if (e.message === "challenge")
      console.log("%cfancystats: token expired — copy a fresh x-requested-with from any Network request and update it in the app.", "color:red;font-weight:bold");
    else console.log("%cfancystats: " + e.message, "color:red");
  }
})();`;
}
