// Real club colours for the LOI Premier Division (keyed by SofaScore team name).
// Unknown clubs (promotion, name drift) get a stable fallback hue.
const CLUB_COLORS = {
  "Shamrock Rovers": { bg: "#0e7a3c", fg: "#ffffff" },
  "Bohemians": { bg: "#c8102e", fg: "#ffffff" },
  "St. Patrick's Athletic": { bg: "#e03a3e", fg: "#ffffff" },
  "Derry City": { bg: "#d6001c", fg: "#ffffff" },
  "Dundalk": { bg: "#1d1d1b", fg: "#ffffff" },
  "Shelbourne": { bg: "#d4002a", fg: "#ffffff" },
  "Sligo Rovers": { bg: "#b3001e", fg: "#ffffff" },
  "Galway United": { bg: "#6a1a41", fg: "#ffffff" },
  "Drogheda United": { bg: "#7b2d43", fg: "#ffffff" },
  "Cork City": { bg: "#0c5c2e", fg: "#ffffff" },
  "Waterford": { bg: "#0050a0", fg: "#ffffff" },
};

export function teamColor(team) {
  const known = team?.name && CLUB_COLORS[team.name];
  if (known) return known;
  let h = 0;
  for (const ch of team?.name || "?") h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 55% 38%)`, fg: "#ffffff" };
}
