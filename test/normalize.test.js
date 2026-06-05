// test/normalize.test.js
import { describe, it, expect } from "vitest";
import { normalize } from "../src/lib/sofascore.js";
import event from "./fixtures/event-ordinary.json";
import lineups from "./fixtures/lineups-ordinary.json";
import incidents from "./fixtures/incidents-ordinary.json";

const run = (e = event, l = lineups, i = incidents) =>
  normalize(structuredClone(e), structuredClone(l), structuredClone(i));
const app = (res, id) => res.appearances.find((a) => a.playerId === id);

describe("match record", () => {
  it("extracts core fields and goal times per side", () => {
    const { match } = run();
    expect(match).toMatchObject({
      eventId: 555, round: 12, status: "finished",
      homeTeamId: 1, awayTeamId: 2, homeScore: 2, awayScore: 1, partial: false,
    });
    expect(match.kickoff).toBe(1764936000000);
    expect(match.goalTimes).toEqual({ home: [30, 75], away: [80] });
  });
  it("extracts teams with short names", () => {
    const { teams } = run();
    expect(teams).toContainEqual({ id: 1, name: "Shamrock Rovers", shortName: "SRO" });
  });
});

describe("appearances", () => {
  it("credits scorer, assister, and sub minutes", () => {
    const res = run();
    expect(app(res, 102)).toMatchObject({ goals: 1, started: true, minutes: 90, positionPlayed: "F" });
    expect(app(res, 101)).toMatchObject({ assists: 1, subOffMin: 60, minutes: 60 });
    expect(app(res, 103)).toMatchObject({ goals: 1, started: false, subOnMin: 60, minutes: 30 });
    expect(app(res, 201)).toMatchObject({ yellow: 1 });
  });
  it("drops unused bench players", () => {
    const res = run();
    expect(app(res, 202)).toBeUndefined();
    expect(res.players.find((p) => p.id === 202)).toBeUndefined();
  });
  it("derives minutes when statistics are absent", () => {
    const l = structuredClone(lineups);
    for (const side of [l.home, l.away]) for (const p of side.players) delete p.statistics;
    const res = run(event, l, incidents);
    expect(app(res, 101).minutes).toBe(60); // subbed off at 60
    expect(app(res, 103).minutes).toBe(30); // on at 60
    expect(app(res, 100).minutes).toBe(90); // full match
  });
});

describe("edge cases", () => {
  it("second yellow and straight red", () => {
    const i = structuredClone(incidents);
    i.incidents.push(
      { incidentType: "card", incidentClass: "yellowRed", time: 85, isHome: false, player: { id: 201, name: "Rob Cornwall" } },
      { incidentType: "card", incidentClass: "red", time: 88, isHome: true, player: { id: 102, name: "Graham Burke" } },
    );
    const res = run(event, lineups, i);
    expect(app(res, 201)).toMatchObject({ yellow: 1, secondYellow: true });
    expect(app(res, 102).red).toBe(true);
  });
  it("own goal counts for the benefiting side and scorer gets ownGoals", () => {
    const i = structuredClone(incidents);
    i.incidents.push({ incidentType: "goal", incidentClass: "ownGoal", time: 85, isHome: true, player: { id: 201, name: "Rob Cornwall" } });
    const res = run(event, lineups, i);
    expect(app(res, 201).ownGoals).toBe(1);
    expect(app(res, 201).goals).toBe(0);
    expect(res.match.goalTimes.home).toEqual([30, 75, 85]);
  });
  it("missed penalty", () => {
    const i = structuredClone(incidents);
    i.incidents.push({ incidentType: "inGamePenalty", incidentClass: "missed", time: 50, isHome: true, player: { id: 102, name: "Graham Burke" } });
    expect(app(run(event, lineups, i), 102).penMissed).toBe(1);
  });
  it("missing lineups -> partial match, no appearances", () => {
    const res = normalize(structuredClone(event), null, structuredClone(incidents));
    expect(res.match.partial).toBe(true);
    expect(res.appearances).toEqual([]);
    expect(res.match.goalTimes.home).toEqual([30, 75]); // goal times still captured
  });
});
