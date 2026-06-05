import { teamColor } from "../lib/teamColors.js";

export function TeamPill({ team, label }) {
  const c = teamColor(team);
  return <span className="chip" style={{ background: c.bg, color: c.fg }}>{label ?? team?.shortName ?? "?"}</span>;
}

const POS_CLS = { GK: "pos-gk", DEF: "pos-def", MID: "pos-mid", FWD: "pos-fwd" };

export function PosPill({ pos }) {
  if (!pos) return <span className="dim">—</span>;
  return <span className={`chip ${POS_CLS[pos] || ""}`}>{pos}</span>;
}

// Points pill: red at 0, yellow around 1, deepening green toward 10+.
export function ptsColor(pts) {
  const hue = pts <= 0 ? 0 : 50 + ((Math.min(pts, 10) - 1) * 80) / 9;
  return `hsl(${hue} 68% 36%)`;
}

export function PtsPill({ pts }) {
  if (pts == null) return <span className="dim">·</span>;
  return <span className="chip" style={{ background: ptsColor(pts), color: "#fff" }}>{pts}</span>;
}
