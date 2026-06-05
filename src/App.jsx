import { useEffect, useRef, useState, useCallback } from "react";
import { initAuth, isSignedIn, signIn, saveLatest, driveLoad, startTokenKeepAlive } from "./lib/drive.js";
import { emptyData, staleInfo } from "./lib/store.js";
import MatchesTab from "./components/MatchesTab.jsx";
import PlayersTab from "./components/PlayersTab.jsx";
import TeamsTab from "./components/TeamsTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";
import PlayerDetail from "./components/PlayerDetail.jsx";

const TABS = [
  ["matches", "Matches", MatchesTab],
  ["players", "Players", PlayersTab],
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
      .then((loaded) => { setData(loaded || emptyData()); setPhase("ready"); })
      .catch(() => { setData(emptyData()); setPhase("ready"); });
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
        <p className="dim">League of Ireland fantasy stats</p>
        {phase === "signedout"
          ? <button className="primary" onClick={handleSignIn}>Sign in with Google</button>
          : <p className="dim">Loading your data…</p>}
      </div>
    );
  }

  const Active = (TABS.find(([k]) => k === tab) ?? TABS[0])[2];
  return (
    <div>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setOpenPlayerId(null); }}>{label}</button>
        ))}
        <span className="dim" role="status" aria-live="polite" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ not saved" : `v${VERSION}`}
        </span>
      </nav>
      {(() => {
        const stale = staleInfo(data, Date.now());
        return stale.count > 0 && tab !== "matches" ? (
          <div className="banner warn" role="status">
            Stats may be out of date — {stale.count} match{stale.count > 1 ? "es" : ""} played since the last update.{" "}
            <button onClick={() => setTab("matches")}>Go to Matches</button>
          </div>
        ) : null;
      })()}
      {authExpired && (
        <div className="banner err row" role="alert">
          Session expired — <button onClick={handleSignIn}>Reconnect</button>
        </div>
      )}
      <main className="page">
        {openPlayerId && data.players[openPlayerId]
          ? <PlayerDetail data={data} update={update} playerId={openPlayerId} onBack={() => setOpenPlayerId(null)} />
          : <Active data={data} update={update} openPlayer={setOpenPlayerId} />}
      </main>
    </div>
  );
}
