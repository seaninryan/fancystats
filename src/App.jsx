import { useEffect, useState, useCallback } from "react";
import { initAuth, isSignedIn, signIn, saveWithRetry, driveLoad, startTokenKeepAlive } from "./lib/drive.js";
import { emptyData } from "./lib/store.js";
import MatchesTab from "./components/MatchesTab.jsx";
import PlayersTab from "./components/PlayersTab.jsx";
import TeamsTab from "./components/TeamsTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";

const TABS = [
  ["matches", "Matches", MatchesTab],
  ["players", "Players", PlayersTab],
  ["teams", "Teams", TeamsTab],
  ["settings", "⚙", SettingsTab],
];

export default function App() {
  const [phase, setPhase] = useState("booting"); // booting | signedout | loading | ready | gis-failed
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("matches");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | error
  const [authExpired, setAuthExpired] = useState(false);

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

  // Single mutation entry point: components pass an updater (data) => newData.
  const update = useCallback((updater) => {
    setData((prev) => {
      const next = updater(prev);
      setSaveState("saving");
      saveWithRetry(next).then((ok) => setSaveState(ok ? "idle" : "error"));
      return next;
    });
  }, []);

  const handleSignIn = async () => {
    if (await signIn()) { setAuthExpired(false); setPhase("loading"); }
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

  const Active = TABS.find(([k]) => k === tab)[2];
  return (
    <div>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
        ))}
        <span className="dim" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "⚠ not saved" : ""}
        </span>
      </nav>
      {authExpired && (
        <div className="banner err row">
          Session expired — <button onClick={handleSignIn}>Reconnect</button>
        </div>
      )}
      <main className="page">
        <Active data={data} update={update} />
      </main>
    </div>
  );
}
