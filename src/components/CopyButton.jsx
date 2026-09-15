// src/components/CopyButton.jsx
import { useEffect, useRef, useState } from "react";

const HOLD = { copied: 2000, failed: 3000 };

// Pure state → presentation. Exported so all three states are unit-testable in the
// node environment, where no click can be simulated.
export function copyLabel(state, idle) {
  if (state === "copied") return { label: "✓ Copied", className: "copied" };
  if (state === "failed") return { label: "Copy failed", className: "copy-failed" };
  return { label: idle, className: undefined };
}

export default function CopyButton({ text, disabled, children }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; clearTimeout(timer.current); }, []);

  // writeText can resolve after the card unmounts, so the guard has to sit here
  // rather than only in the unmount cleanup.
  const flash = (next) => {
    if (!mounted.current) return;
    clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => setState("idle"), HOLD[next]);
  };

  const copy = async () => {
    // Deliberately no optional chaining on navigator.clipboard: where the API is
    // missing (any non-secure context) the click must report a failure, not look
    // like it worked.
    try {
      await navigator.clipboard.writeText(text);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  const { label, className } = copyLabel(state, children);
  return <button className={className} onClick={copy} disabled={disabled}>{label}</button>;
}
