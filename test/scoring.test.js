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

describe("red-carded starter (current behavior — re-verify vs real gameweek in Task 13)", () => {
  // A red card is not a substitution, so subOffMin stays null: the player is
  // treated as on-pitch to FT for clean-sheet purposes and keeps fullMatch tier.
  it("loses the clean sheet if the opposition scores after the dismissal", () => {
    const m = { ...match, homeScore: 2, awayScore: 1, goalTimes: { home: [30, 75], away: [80] } };
    const s = scoreAppearance({ ...base, red: true }, m, "DEF");
    expect(s.breakdown.find(([r]) => r === "cleanSheet")).toBeUndefined();
    expect(s.breakdown.find(([r]) => r === "fullMatch")[1]).toBe(3);
  });
  it("keeps the clean sheet if the opposition never scores", () => {
    const s = scoreAppearance({ ...base, red: true }, match, "DEF");
    expect(s.breakdown.find(([r]) => r === "cleanSheet")[1]).toBe(4);
    expect(s.total).toBe(3 + 2 + 4 - 4); // fullMatch + win + CS + straight red
  });
});

describe("invariants", () => {
  it("total always equals the sum of breakdown points", () => {
    const cases = [
      [{ ...base, goals: 2, assists: 1, yellow: 1 }, "FWD"],
      [{ ...base, started: false, subOnMin: 70, minutes: 20 }, "DEF"],
      [{ ...base, penSaved: 1, subOffMin: 88, minutes: 88 }, "GK"],
      [{ ...base, ownGoals: 1, penMissed: 1, red: true }, "MID"],
    ];
    for (const [app, pos] of cases) {
      const s = scoreAppearance(app, match, pos);
      expect(s.total).toBe(s.breakdown.reduce((sum, [, p]) => sum + p, 0));
    }
  });
});
