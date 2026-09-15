// src/components/Flash.jsx
import { useEffect, useRef } from "react";

const HOLD_MS = 5000;

// A success banner that dismisses itself. The parent owns the message and clears it
// from onDone; Flash owns nothing but the timer. onDone is read through a ref so an
// unrelated parent re-render can't restart the countdown mid-fade.
//
// The hold isn't a prop: .banner.flash hardcodes the matching fade in styles.css, so
// a caller-supplied duration would desync the dissolve from the actual removal.
export default function Flash({ message, onDone }) {
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => done.current(), HOLD_MS);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  // role=status matches the stale-stats banner in App.jsx — without it the only
  // confirmation an import landed is never announced, and it's gone in 5s.
  return <div className="banner ok flash" role="status">✓ {message}</div>;
}
