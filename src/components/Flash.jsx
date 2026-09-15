// src/components/Flash.jsx
import { useEffect, useRef } from "react";

const HOLD_MS = 5000;

// A success banner that dismisses itself. The parent owns the message and clears it
// from onDone; Flash owns nothing but the timer. onDone is read through a ref so an
// unrelated parent re-render can't restart the countdown mid-fade.
export default function Flash({ message, onDone, ms = HOLD_MS }) {
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => done.current(), ms);
    return () => clearTimeout(t);
  }, [message, ms]);
  if (!message) return null;
  return <div className="banner ok flash">✓ {message}</div>;
}
