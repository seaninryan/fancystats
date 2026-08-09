// src/lib/fantasyImport.js
// Import from the Fantasy LOI site (fantasyloi.leagueofireland.ie). It is a
// server-rendered ASP.NET Core MVC app: Player Stats is a form POST whose third
// table column IS the selected statistic, so price and score need separate
// requests. See docs/superpowers/specs/2026-08-09-fantasy-console-import-design.md.
import { normalizeName } from "./pasteImport.js";

const POSITIONS = ["GK", "DEF", "MID", "FWD"];

const numOrNull = (v) => (Number.isFinite(v) ? v : null);

// Pure: validate + normalize a pasted capture. Throws user-facing messages.
export function parseFantasyBlob(text) {
  let blob;
  try {
    blob = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw new Error("Couldn't parse — run the snippet again and copy all of its output.");
  }
  if (blob?.meta?.source !== "fantasyloi") throw new Error("That's not a Fantasy LOI capture.");
  const players = (Array.isArray(blob.players) ? blob.players : [])
    .filter((p) => p && String(p.name || "").trim())
    .map((p) => ({
      name: String(p.name).trim(),
      clubId: p.clubId != null ? String(p.clubId) : null,
      gamePosition: POSITIONS.includes(p.position) ? p.position : null,
      price: numOrNull(p.price),
      sitePoints: numOrNull(p.sitePoints),
    }));
  if (!players.length) throw new Error("No players in the capture — are you logged in on the fantasy site?");
  return { clubs: Array.isArray(blob.meta.clubs) ? blob.meta.clubs : [], players };
}
