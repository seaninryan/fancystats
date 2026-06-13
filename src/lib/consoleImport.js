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
