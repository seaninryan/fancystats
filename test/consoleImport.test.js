import { describe, it, expect } from "vitest";
import { API } from "../src/lib/sofascore.js";
import { blobToFetcher } from "../src/lib/consoleImport.js";
import { decodeBlob, applyDecoded } from "../src/lib/consoleImport.js";
import { emptyData } from "../src/lib/store.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

const blobFor555 = () => ({
  meta: { tournamentId: 192, seasonId: 87682, builtFor: [555] },
  payloads: {
    "/unique-tournament/192/season/87682/events/last/0": {
      events: [{
        id: 555, startTimestamp: 100, status: { type: "finished" }, roundInfo: { round: 12 },
        homeTeam: { id: 1, name: "Shamrock Rovers", nameCode: "SRO" },
        awayTeam: { id: 2, name: "Bohemians", nameCode: "BOH" },
        homeScore: { current: 2 }, awayScore: { current: 1 },
      }],
      hasNextPage: false,
    },
    "/event/555": event,
    "/event/555/lineups": lineups,
    "/event/555/incidents": incidents,
  },
});

describe("blobToFetcher", () => {
  it("serves a recorded payload by path suffix", async () => {
    const f = blobToFetcher({ payloads: { "/event/555": { event: { id: 555 } } } });
    const res = await f(API + "/event/555");
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ event: { id: 555 } });
  });
  it("returns 404 for a missing key", async () => {
    const f = blobToFetcher({ payloads: {} });
    const res = await f(API + "/event/999");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
  it("returns 404 for a recorded {__status:404} marker", async () => {
    const f = blobToFetcher({ payloads: { "/event/9/lineups": { __status: 404 } } });
    const res = await f(API + "/event/9/lineups");
    expect(res.status).toBe(404);
  });
});

describe("decodeBlob + applyDecoded", () => {
  it("imports the captured match and refreshes the stub", async () => {
    const decoded = await decodeBlob(blobFor555());
    expect(decoded.failed).toEqual([]);
    expect(decoded.results).toHaveLength(1);
    const data = applyDecoded(emptyData(), decoded, 1000);
    expect(data.matches[555].importedAt).toBe(1000);
    expect(data.matches[555].homeTeamId).toBe(1);
    expect(Object.keys(data.appearances).some((k) => k.startsWith("555:"))).toBe(true);
    expect(data.meta.lastEventSync).toBe(1000);
  });
  it("records a per-match failure without aborting the rest", async () => {
    const blob = blobFor555();
    delete blob.payloads["/event/555"]; // event fetch -> 404 -> importMatch throws
    const decoded = await decodeBlob(blob);
    expect(decoded.results).toEqual([]);
    expect(decoded.failed).toHaveLength(1);
    expect(decoded.failed[0].id).toBe(555);
  });
});
