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

// -> [{ name, value, price? }]
// Handles: "Name\t10", "Name\tTeam\t10", "1\tName\t10", vertical copies
// ("Name" / "10" on separate lines, possibly with a rank column between), and
// the two-column site format ("Name" then "Club Picture\t4.0\t25") where the
// decimal first number is the price and the last number the site's total.
// Values are NOT range-validated here: the same parser serves price pastes and
// position pastes whose statistic column varies; the preview UI shows values.
export function parsePaste(text) {
  const rows = [];
  let pendingName = null;
  let pendingNums = [];
  const rowFrom = (name, nums) => {
    const row = { name, value: parseFloat(nums[nums.length - 1]) };
    // price column: only a decimal-formatted leading number (a rank never is)
    if (nums.length >= 2 && /^\d+\.\d+$/.test(nums[0])) row.price = parseFloat(nums[0]);
    return row;
  };
  const commit = () => {
    if (pendingName && pendingNums.length) rows.push(rowFrom(pendingName, pendingNums));
    pendingName = null;
    pendingNums = [];
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
        rows.push(rowFrom(nameField.trim(), nums));
        continue;
      }
      // furniture row ("Club Picture  4.0  25"): all word fields are
      // stopwords — its numbers belong to the pending name above
      if (!nameField && nums.length && pendingName) {
        pendingNums.push(...nums);
        commit();
        continue;
      }
    }
    if (NUM_RE.test(line)) {
      // numbers accumulate; rowFrom takes the last as the value, so a rank
      // line can't pose as the value (same effect as the old last-wins rule)
      if (pendingName) pendingNums.push(line);
    } else if (NAME_RE.test(line) && !isStopword(line)) {
      commit();
      pendingName = line;
    }
  }
  commit();
  return rows;
}

export function surnameInitialKey(name) {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[0][0]} ${parts[parts.length - 1]}`; // "p oconor"
}

// rows from parsePaste (or a fantasy capture); players: data.players ({id: {name, pasteAlias, ...}})
// A row may carry `teamId` (fantasy captures know the club): candidates are then
// restricted to that team, which resolves same-named players across clubs. Rows
// without `teamId` behave exactly as before.
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
  // ids are object keys (strings) but teamId is a number on the record — compare loosely
  const onTeam = (id, teamId) => String(players[id]?.teamId) === String(teamId);
  const pick = (ids, row) => {
    const cands = row.teamId != null ? ids.filter((id) => onTeam(id, row.teamId)) : ids;
    return cands.length === 1 ? cands[0] : null;
  };
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const norm = normalizeName(row.name);
    // duplicate full names (two John Murphys) stay unmatched unless the club splits them
    let id = pick(byFull.get(norm) || [], row) || byAlias.get(norm);
    if (!id) {
      const key = surnameInitialKey(row.name);
      id = pick(key ? byInitial.get(key) || [] : [], row);
    }
    if (id) matched.push({ playerId: id, ...row });
    else unmatched.push(row);
  }
  return { matched, unmatched };
}

// Candidate player ids for an unmatched row, best first. Shared words
// (surnames, nicknames) score highest; containment breaks ties; a known club floats its own
// players to the top.
export function suggestLinks(rowName, players, teamId = null) {
  const norm = normalizeName(rowName);
  const words = norm.split(" ").filter(Boolean);
  return Object.entries(players)
    .map(([id, p]) => {
      const pn = normalizeName(p.customName || p.name);
      const clubBonus = teamId != null && String(p.teamId) === String(teamId) ? 20 : 0;
      if (!pn) return { id, score: 0 };
      if (pn === norm) return { id, score: 100 + clubBonus };
      const pWords = pn.split(" ").filter(Boolean);
      let score = words.filter((w) => pWords.includes(w)).length * 10;
      if (score && (norm.includes(pn) || pn.includes(norm))) score += 5;
      return { id, score: score ? score + clubBonus : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}
