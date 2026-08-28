// test/matchesTab.test.jsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MatchesTab from "../src/components/MatchesTab.jsx";
import { emptyData, applyImport, upsertMatchStubs } from "../src/lib/store.js";

const NOW = 1765000000000;
const DAY = 86400000;

const TEAMS = [
  { id: 1, name: "Shelbourne", shortName: "SHE" },
  { id: 2, name: "Bohemians", shortName: "BOH" },
];

function app(eventId, playerId, teamId, goals) {
  return {
    eventId, playerId, teamId, started: true, subOnMin: null, subOffMin: null,
    minutes: 90, positionPlayed: "F", goals, assists: 0, ownGoals: 0,
    yellow: 0, secondYellow: false, red: false, penScored: 0, penMissed: 0, penSaved: 0,
  };
}

// Two played rounds (SHE beat BOH twice) plus one upcoming stub.
function seeded() {
  let d = emptyData();
  for (const [eventId, round, home, away, hs, as] of [
    [101, 1, 1, 2, 3, 0],
    [102, 2, 2, 1, 0, 2],
  ]) {
    d = applyImport(d, {
      match: {
        eventId, round, kickoff: NOW - (4 - round) * DAY, status: "finished",
        homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [{ id: 11, name: "P1", teamId: 1 }, { id: 12, name: "P2", teamId: 2 }],
      appearances: [app(eventId, 11, 1, home === 1 ? hs : as), app(eventId, 12, 2, home === 2 ? hs : as)],
    }, NOW);
  }
  d = upsertMatchStubs(d, [{
    eventId: 900, round: 3, kickoff: NOW + DAY, status: "notstarted",
    homeTeamId: 1, awayTeamId: 2, homeScore: null, awayScore: null,
  }], TEAMS);
  return d;
}

const render = (d) =>
  renderToStaticMarkup(<MatchesTab data={d} update={() => {}} openTeam={() => {}} />);

describe("MatchesTab fixture comparison", () => {
  it("renders comparison chips on the upcoming fixture", () => {
    const html = render(seeded());
    expect(html).toContain("cmp-chips");           // the chip group is present
    expect(html).toMatch(/league position/);       // chip tooltips wired
    expect(html).toMatch(/1st|2nd/);               // ordinal position rendered
  });

  it("tags the favoured side", () => {
    const html = render(seeded());
    expect(html).toContain("🎯");
    expect(html).toMatch(/favourable for/);
  });

  it("shows no chips when there is nothing upcoming", () => {
    let d = emptyData();
    d = applyImport(d, {
      match: {
        eventId: 101, round: 1, kickoff: NOW - DAY, status: "finished",
        homeTeamId: 1, awayTeamId: 2, homeScore: 1, awayScore: 0,
        goalTimes: { home: [], away: [] }, partial: false,
      },
      teams: TEAMS,
      players: [{ id: 11, name: "P1", teamId: 1 }],
      appearances: [app(101, 11, 1, 1)],
    }, NOW);
    const html = render(d);
    expect(html).not.toContain("cmp-chips");
  });

  it.skip("renders team names as links", () => {
    const html = render(seeded());
    expect(html).toContain('role="link"');
    expect(html).toContain("Shelbourne");
  });

  it("survives an empty save", () => {
    expect(render(emptyData())).toContain("No matches yet");
  });
});
