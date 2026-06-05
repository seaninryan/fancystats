// src/lib/pasteImport.js
// Parse text copied from the fantasy site's Player Stats table and match names
// to SofaScore player records.

// Mc/Mac spelling variants are intentionally NOT conflated — false matches are worse; the manual-link UI handles them.
export function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[''.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NAME_RE = /\p{L}{2,}/u; // at least one real word
const NUM_RE = /^\d+(?:\.\d+)?$/;

// Table-furniture words that must never be taken as a player name.
const STOPWORDS = new Set([
  "player", "players", "player stats", "value", "statistic", "statistics",
  "points", "price", "club", "club picture", "position", "total score", "selected by",
]);

const isStopword = (s) => STOPWORDS.has(normalizeName(s));

// -> [{ name, value }]
// Handles: "Name\t10", "Name\tTeam\t10", "1\tName\t10", and vertical copies
// ("Name" / "10" on separate lines, possibly with a rank column between).
// Values are NOT range-validated here: the same parser serves price pastes and
// position pastes whose statistic column varies; the preview UI shows values.
export function parsePaste(text) {
  const rows = [];
  let pendingName = null;
  let pendingValue = null;
  const commit = () => {
    if (pendingName && pendingValue != null) rows.push({ name: pendingName, value: pendingValue });
    pendingName = null;
    pendingValue = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { commit(); continue; }
    const fields = line.includes("\t") ? line.split(/\t+/) : line.split(/ {2,}/);
    if (fields.length >= 2) {
      const nameField = fields.find((f) => NAME_RE.test(f) && !isStopword(f));
      const nums = fields.map((f) => f.trim()).filter((f) => NUM_RE.test(f));
      if (nameField && nums.length) {
        commit();
        rows.push({ name: nameField.trim(), value: parseFloat(nums[nums.length - 1]) });
        continue;
      }
    }
    if (NUM_RE.test(line)) {
      // last number before the next name wins, so a rank column can't pose as the value
      if (pendingName) pendingValue = parseFloat(line);
    } else if (NAME_RE.test(line) && !isStopword(line)) {
      commit();
      pendingName = line;
    }
  }
  commit();
  return rows;
}

function surnameInitialKey(name) {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]} ${parts[parts.length - 1]}`; // "p oconor"
}

// rows from parsePaste; players: data.players ({id: {name, pasteAlias, ...}})
// -> { matched: [{playerId, name, value}], unmatched: [{name, value}] }
export function matchPlayers(rows, players) {
  const byFull = new Map();
  const byAlias = new Map();
  const byInitial = new Map(); // key -> [playerId]; ambiguous keys stay unmatched
  for (const [id, p] of Object.entries(players)) {
    const norm = normalizeName(p.name);
    byFull.set(norm, [...(byFull.get(norm) || []), id]);
    if (p.customName) byFull.set(normalizeName(p.customName), [...(byFull.get(normalizeName(p.customName)) || []), id]);
    if (p.pasteAlias) byAlias.set(normalizeName(p.pasteAlias), id);
    const key = surnameInitialKey(p.name);
    if (key) byInitial.set(key, [...(byInitial.get(key) || []), id]);
  }
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const norm = normalizeName(row.name);
    const fullCandidates = byFull.get(norm) || [];
    // duplicate full names (two John Murphys) stay unmatched for manual linking
    let id = fullCandidates.length === 1 ? fullCandidates[0] : byAlias.get(norm);
    if (!id) {
      const key = surnameInitialKey(row.name);
      const candidates = key ? byInitial.get(key) || [] : [];
      if (candidates.length === 1) id = candidates[0];
    }
    if (id) matched.push({ playerId: id, name: row.name, value: row.value });
    else unmatched.push(row);
  }
  return { matched, unmatched };
}

// Candidate player ids for an unmatched paste row, best first. Shared words
// (surnames, nicknames) score highest; containment breaks ties.
export function suggestLinks(rowName, players) {
  const norm = normalizeName(rowName);
  const words = norm.split(" ").filter(Boolean);
  return Object.entries(players)
    .map(([id, p]) => {
      const pn = normalizeName(p.customName || p.name);
      if (!pn) return { id, score: 0 };
      if (pn === norm) return { id, score: 100 };
      const pWords = pn.split(" ").filter(Boolean);
      let score = words.filter((w) => pWords.includes(w)).length * 10;
      if (score && (norm.includes(pn) || pn.includes(norm))) score += 5;
      return { id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}
