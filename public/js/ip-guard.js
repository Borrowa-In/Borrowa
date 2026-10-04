// Best-effort IP banning for a client-only (no backend server) app.
//
// IMPORTANT LIMITATION: Firestore Security Rules have no concept of the
// caller's real network IP address — there is no `request.ip` in the rules
// language. So this can't be enforced the way a real server-side IP ban
// would be. What we do instead: ask a public "what's my IP" API what
// address the browser is calling from, record it on the user's profile at
// login, and check it against an admin-maintained `bannedIPs` collection
// at login/signup and on every page load. This deters casual ban-evasion
// (spinning up a second account from the same home wifi) but can be
// bypassed by a VPN, mobile data, or another network — it's a speed bump,
// not a lock.
import { db, USE_CLOUD_FUNCTIONS, DEV_MODE } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const IP_ENDPOINTS = [
  "https://api.ipify.org?format=json",
  "https://api64.ipify.org?format=json",
];

// The IP check used to run (twice!) on every single page load, each time
// waiting on a third-party request. That was a big part of why moving between
// pages felt slow. Now the answer is remembered for the browser session and
// re-checked every few minutes in the background instead.
const CACHE_KEY = "borrowa_ip_v1";
const FN_OFF_KEY = "borrowa_fn_off";
const CACHE_TTL = 10 * 60 * 1000;
let lastLookup = null; // { ip, banned (true/false/null=unknown), uid, wrote, t }

function readCached() {
  if (lastLookup && Date.now() - lastLookup.t < CACHE_TTL) return lastLookup;
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (c && c.ip && Date.now() - c.t < CACHE_TTL) { lastLookup = c; return c; }
  } catch (e) {}
  return null;
}
function saveCached(c) {
  lastLookup = c;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
}

async function ipifyLookup() {
  for (const url of IP_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.ip) return data.ip;
    } catch (e) {
      // try the next endpoint
    }
  }
  return null;
}

// Preferred: ask our own backend (functions/index.js -> checkIp). The server
// sees the real network address, so it can't be faked from the browser.
// If the function isn't deployed we remember that and use ipify instead.
async function serverLookup() {
  if (!USE_CLOUD_FUNCTIONS || sessionStorage.getItem(FN_OFF_KEY)) return null;
  try {
    const base = "https://www.gstatic.com/firebasejs/10.12.2/";
    const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
      import(base + "firebase-functions.js"),
      import(base + "firebase-app.js"),
    ]);
    const res = await httpsCallable(getFunctions(getApp()), "checkIp")();
    if (res.data && res.data.ip) return { ip: res.data.ip, banned: !!res.data.banned };
  } catch (e) {
    try { sessionStorage.setItem(FN_OFF_KEY, "1"); } catch (_) {}
  }
  return null;
}

// Returns the browser's public IP (cached). Returns null (fail open — never
// blocks on lookup failure) if every method fails.
export async function getPublicIp() {
  if (DEV_MODE) return null; // dev: no IP lookup, no IP bans
  const c = readCached();
  if (c) return c.ip;
  const viaServer = await serverLookup();
  if (viaServer) { saveCached({ ...viaServer, t: Date.now() }); return viaServer.ip; }
  const ip = await ipifyLookup();
  if (ip) saveCached({ ip, banned: null, t: Date.now() });
  return ip;
}

export async function isIpBanned(ip) {
  if (!ip) return false;
  const c = readCached();
  if (c && c.ip === ip && typeof c.banned === "boolean") return c.banned;
  try {
    const snap = await getDoc(doc(db, "bannedIPs", ip));
    const banned = snap.exists();
    if (c && c.ip === ip) saveCached({ ...c, banned });
    return banned;
  } catch (e) {
    return false; // fail open
  }
}

// Records the caller's current public IP on their profile (best-effort,
// silent on failure) so an admin can see and, if needed, ban it later from
// the user editor in admin.html. Only writes when something changed.
export async function recordLoginIp(uid) {
  const ip = await getPublicIp();
  if (!ip) return null;
  const c = readCached();
  if (c && c.uid === uid && c.wrote) return ip;
  try {
    await setDoc(doc(db, "userIps", uid), { ip, updatedAt: serverTimestamp() });
    saveCached({ ...(c || { ip, banned: null }), ip, uid, wrote: true, t: (c && c.t) || Date.now() });
  } catch (e) {
    // Non-fatal — the login itself should still succeed even if this fails.
  }
  return ip;
}

// Forget the remembered IP result (used at sign-in so a fresh ban is seen at once).
export function resetIpCache() {
  lastLookup = null;
  try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
}

export async function banIp(ip, reason, adminUid) {
  await setDoc(doc(db, "bannedIPs", ip), {
    ip,
    reason: reason || "",
    bannedAt: new Date(),
    bannedByUid: adminUid || null,
  });
}

export async function unbanIp(ip) {
  await deleteDoc(doc(db, "bannedIPs", ip));
}
