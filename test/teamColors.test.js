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
  it("user colour override beats the club map, with luminance-based text", () => {
    expect(teamColor({ name: "Shamrock Rovers", colorBg: "#ffee00" })).toEqual({ bg: "#ffee00", fg: "#17222b" });
    expect(teamColor({ name: "Shamrock Rovers", colorBg: "#112233" }).fg).toBe("#ffffff");
  });
});
