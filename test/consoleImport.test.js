import { describe, it, expect } from "vitest";
import { API } from "../src/lib/sofascore.js";
import { blobToFetcher } from "../src/lib/consoleImport.js";

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
