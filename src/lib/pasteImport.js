// src/lib/pasteImport.js
// Parse text copied from the fantasyloi Player Stats table and match names
// to SofaScore player records.

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

// -> [{ name, value }]
export function parsePaste(text) {
  const rows = [];
  let pendingName = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { pendingName = null; continue; }
    const tab = line.match(/^(.+?)\t+(\d+(?:\.\d+)?)$/) || line.match(/^(.+?) {2,}(\d+(?:\.\d+)?)$/);
    if (tab && NAME_RE.test(tab[1])) {
      rows.push({ name: tab[1].trim(), value: parseFloat(tab[2]) });
      pendingName = null;
    } else if (NUM_RE.test(line)) {
      if (pendingName) { rows.push({ name: pendingName, value: parseFloat(line) }); pendingName = null; }
    } else if (NAME_RE.test(line)) {
      pendingName = line;
    }
  }
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
    byFull.set(normalizeName(p.name), id);
    if (p.pasteAlias) byAlias.set(normalizeName(p.pasteAlias), id);
    const key = surnameInitialKey(p.name);
    if (key) byInitial.set(key, [...(byInitial.get(key) || []), id]);
  }
  const matched = [];
  const unmatched = [];
  for (const row of rows) {
    const norm = normalizeName(row.name);
    let id = byFull.get(norm) || byAlias.get(norm);
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
