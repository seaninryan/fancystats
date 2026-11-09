import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { initAuth, isSignedIn, signIn, saveLatest, driveLoad, startTokenKeepAlive } from "./lib/drive.js";
import { emptyData, staleInfo, migrateSeasons } from "./lib/store.js";
import { seasonView } from "./lib/seasons.js";
import SeasonBar, { SeasonBanner } from "./components/SeasonBar.jsx";
import MatchesTab from "./components/MatchesTab.jsx";
import PlayersTab from "./components/PlayersTab.jsx";
import MyTeamTab from "./components/MyTeamTab.jsx";
import LeaguesTab from "./components/LeaguesTab.jsx";
import TeamsTab from "./components/TeamsTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";
import TableTab from "./components/TableTab.jsx";
import PlayerDetail from "./components/PlayerDetail.jsx";

const TABS = [
  ["matches", "Matches", MatchesTab],
  ["table", "Table", TableTab],
  ["players", "Players", PlayersTab],
  ["myteam", "My Team", MyTeamTab],
  ["leagues", "Leagues", LeaguesTab],
  ["teams", "Teams", TeamsTab],
  ["settings", "⚙", SettingsTab],
];

const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export default function App() {
  const [phase, setPhase] = useState("booting"); // booting | signedout | loading | ready | gis-failed
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("matches");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | error
  const [authExpired, setAuthExpired] = useState(false);
  const [openPlayerId, setOpenPlayerId] = useState(null);
  const [focusTeam, setFocusTeam] = useState(null); // { teamId, nonce } — set by team links
  const [viewSeason, setViewSeason] = useState(null); // null = current season
  const dirtyRef = useRef(false);

  useEffect(() => {
    initAuth({ onAuthExpired: () => setAuthExpired(true) }).then((ok) => {
      if (!ok) return setPhase("gis-failed");
      setPhase(isSignedIn() ? "loading" : "signedout");
    });
  }, []);

  useEffect(() => {
    if (phase !== "loading") return;
    startTokenKeepAlive();
    driveLoad()
      .then((loaded) => { setData(migrateSeasons(loaded ? { ...emptyData(), ...loaded } : emptyData())); setPhase("ready"); })
      .catch(() => { setData(migrateSeasons(emptyData())); setPhase("ready"); });
  }, [phase]);

  // Single mutation entry point. The updater stays pure; persisting happens in
  // the effect below so StrictMode/concurrent re-runs can never double-save.
  const update = useCallback((updater) => {
    dirtyRef.current = true;
    setData(updater);
  }, []);

  useEffect(() => {
    if (!dirtyRef.current || !data) return;
    dirtyRef.current = false;
    setSaveState("saving");
    saveLatest(data).then((ok) => {
      setSaveState(ok ? "idle" : "error");
      if (ok) setAuthExpired(false);
    });
  }, [data]);

  const openTeam = useCallback((teamId) => {
    setFocusTeam((f) => ({ teamId: String(teamId), nonce: (f?.nonce ?? 0) + 1 }));
    setOpenPlayerId(null);
    setTab("teams");
    window.scrollTo({ top: 0 });
  }, []);

  const curSeason = data?.meta.seasonId;
  // viewSeason only holds a PAST season; anything else (null, the current id, an id that no longer exists) means current
  const shownSeason = viewSeason != null && Number(viewSeason) !== Number(curSeason) && data?.seasons?.[viewSeason] ? viewSeason : curSeason;
  const readOnly = data != null && Number(shownSeason) !== Number(curSeason);
  const view = useMemo(() => (data ? seasonView(data, shownSeason) : null), [data, shownSeason]);
  // Past seasons are read-only: edit attempts surface a brief notice instead of silently doing nothing.
  const [roNotice, setRoNotice] = useState(false);
  const roUpdate = useCallback(() => setRoNotice(true), []);
  useEffect(() => {
    if (!roNotice) return;
    const t = setTimeout(() => setRoNotice(false), 3000);
    return () => clearTimeout(t);
  }, [roNotice]);
  const changeSeason = useCallback((id) => {
    setViewSeason(Number(id) === Number(data?.meta.seasonId) ? null : id);
    setOpenPlayerId(null);
    setTab((t) => (t === "settings" ? "matches" : t));
  }, [data?.meta.seasonId]);

  const handleSignIn = async () => {
    if (!(await signIn())) return;
    setAuthExpired(false);
    if (data) {
      // Re-established session: flush the in-memory edits. Never reload over
      // them — edits made while the session was expired would be lost.
      setSaveState("saving");
      saveLatest(data).then((ok) => setSaveState(ok ? "idle" : "error"));
    } else {
      setPhase("loading");
    }
  };

  if (phase === "booting") return <p className="page dim">Loading…</p>;
  if (phase === "gis-failed") return <p className="page banner err">Google sign-in failed to load. Refresh to retry.</p>;
  if (phase === "signedout" || phase === "loading") {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: "30vh" }}>
        <h1>fancystats</h1>
        <p className="dim">fantasy football stats</p>
        {phase === "signedout"
          ? <button className="primary" onClick={handleSignIn}>Sign in with Google</button>
          : <p className="dim">Loading your data…</p>}
      </div>
    );
  }

  const tabs = readOnly ? TABS.filter(([k]) => k !== "settings") : TABS;
  const Active = (tabs.find(([k]) => k === tab) ?? tabs[0])[2];
  return (
    <div>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setOpenPlayerId(null); window.scrollTo({ top: 0 }); }}>{label}</button>
        ))}
        <SeasonBar data={data} viewSeason={shownSeason} onChange={changeSeason} />
        <span className="dim" role="status" aria-live="polite" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ not saved" : `v${VERSION}`}
        </span>
      </nav>
      <SeasonBanner data={data} viewSeason={shownSeason} onChange={changeSeason} />
      {(() => {
        const stale = readOnly ? { count: 0 } : staleInfo(view, Date.now());
        return stale.count > 0 && tab !== "settings" ? (
          <div className="banner warn" role="status">
            Stats may be out of date — {stale.count} match{stale.count > 1 ? "es" : ""} played since the last update.{" "}
            <button onClick={() => setTab("settings")}>Go to Settings</button>
          </div>
        ) : null;
      })()}
      {readOnly && roNotice && (
        <div className="banner warn" role="status">
          Past seasons are read-only — switch back to {data.seasons?.[curSeason]?.label ?? curSeason} to edit.
        </div>
      )}
      {authExpired && (
        <div className="banner err row" role="alert">
          Session expired — <button onClick={handleSignIn}>Reconnect</button>
        </div>
      )}
      <main className="page">
        {openPlayerId && view.players[openPlayerId] && (
          <PlayerDetail key={shownSeason} data={view} fullData={data} update={readOnly ? roUpdate : update} readOnly={readOnly} playerId={openPlayerId} onBack={() => setOpenPlayerId(null)} />
        )}
        {/* keep the tab mounted while a player is open so filters/sort survive the round-trip */}
        <div style={{ display: openPlayerId && view.players[openPlayerId] ? "none" : undefined }}>
          <Active key={shownSeason} data={view} fullData={data} update={readOnly ? roUpdate : update} readOnly={readOnly} openPlayer={setOpenPlayerId} openTeam={openTeam} focusTeam={focusTeam} />
        </div>
      </main>
    </div>
  );
}
