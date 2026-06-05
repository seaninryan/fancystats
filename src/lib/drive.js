// src/lib/drive.js
// Google Drive appDataFolder storage. Ported from sideline (index.html) —
// token lifecycle, 401-retry and file management are intentionally identical.

export const CLIENT_ID = "1082152886862-ls2qdqu246emgs93q6hvrcqq4ipi1iur.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.appdata";
const TOK_KEY = "fancystats_tok";
const FILE_NAME = "fancystats.json";

let tokenClient = null;
let accessToken = null;
let tokenExp = 0;
let fileId = null;
let onAuthExpired = null;

function rememberToken(resp) {
  accessToken = resp.access_token;
  const ttl = Number(resp.expires_in) || 3600;
  tokenExp = Date.now() + (ttl - 60) * 1000; // 60s safety margin
  sessionStorage.setItem(TOK_KEY, JSON.stringify({ t: accessToken, exp: tokenExp }));
}

function recallToken() {
  try {
    const j = JSON.parse(sessionStorage.getItem(TOK_KEY));
    if (j?.t && j.exp > Date.now()) { tokenExp = j.exp; return j.t; }
  } catch { /* corrupt/absent */ }
  return null;
}

// Resolves true when GIS is ready. Call once at app start.
export function initAuth(handlers = {}) {
  onAuthExpired = handlers.onAuthExpired || null;
  accessToken = recallToken();
  return new Promise((resolve) => {
    const started = Date.now();
    const poll = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(poll);
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: () => {},
        });
        resolve(true);
      } else if (Date.now() - started > 10000) {
        clearInterval(poll);
        resolve(false);
      }
    }, 100);
  });
}

export function isSignedIn() {
  return !!accessToken && tokenExp > Date.now();
}

function requestToken(opts = {}) {
  return new Promise((resolve) => {
    if (!tokenClient) return resolve(false);
    tokenClient.callback = (resp) => {
      if (resp.access_token) { rememberToken(resp); resolve(true); } else resolve(false);
    };
    tokenClient.error_callback = () => resolve(false);
    tokenClient.requestAccessToken(opts);
  });
}

export const signIn = () => requestToken(); // user gesture -> consent popup allowed
const reauth = () => requestToken({ prompt: "" }); // silent

// Roll the token if it expires soon. Call before save bursts.
export async function ensureFreshToken() {
  if (tokenExp - Date.now() < 10 * 60 * 1000) await reauth();
}

async function dfetch(url, opts) {
  const headers = { Authorization: "Bearer " + accessToken, ...(opts?.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) throw Object.assign(new Error("auth"), { code: 401 });
  return res;
}

async function ensureFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await dfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}`);
  const j = await r.json();
  if (j.files?.length) { fileId = j.files[0].id; return fileId; }
  const cr = await dfetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] }),
  });
  fileId = (await cr.json()).id;
  return fileId;
}

// -> parsed data object, or null when the file is new/empty.
export async function driveLoad() {
  await ensureFile();
  const r = await dfetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

async function driveSave(data) {
  await ensureFile();
  const r = await dfetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
  );
  if (!r.ok) throw Object.assign(new Error("save failed"), { code: r.status });
}

// Save with one silent-reauth retry on 401; banner callback if that fails too.
export async function saveWithRetry(data) {
  await ensureFreshToken();
  try { await driveSave(data); return true; }
  catch (e) {
    if (e.code === 401 && (await reauth())) {
      try { await driveSave(data); return true; } catch { /* fall through */ }
    }
    if (onAuthExpired) onAuthExpired();
    return false;
  }
}

// Background keep-alive: silent reauth when <12 min left. Call once after sign-in.
export function startTokenKeepAlive() {
  const tick = () => {
    if (accessToken && tokenExp - Date.now() < 12 * 60 * 1000) reauth();
  };
  setInterval(tick, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}
