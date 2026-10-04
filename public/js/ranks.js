import { db } from "./firebase-config.js";
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Shared rank logic: activity points, tiers and the aesthetic card styles.
// Points are worked out live from Firestore (nothing to cheat or sync).
// The scoring rules live in points.js (pure, unit-tested, and anti-farming).
import { computeStats, CAPS, POINTS } from "./points.js";
export { CAPS, POINTS };

// Lowest tier first. `min` = points needed to reach it.
export const TIERS = [
  { key: "none",     name: "Newcomer", icon: "🌱", min: 0,   color: "#4b5563", bg: "#f3f4f6", border: "#d5e3da", glow: "none",
    card: "#ffffff" },
  { key: "bronze",   name: "Bronze",   icon: "🥉", min: 15,  color: "#9a3412", bg: "#ffedd5", border: "#fdba74", glow: "0 4px 14px rgba(194,65,12,.18)",
    card: "linear-gradient(160deg,#fff 55%,#fff1e6 100%)" },
  { key: "silver",   name: "Silver",   icon: "🥈", min: 40,  color: "#475569", bg: "#f1f5f9", border: "#cbd5e1", glow: "0 4px 16px rgba(100,116,139,.22)",
    card: "linear-gradient(160deg,#fff 55%,#eef2f7 100%)" },
  { key: "gold",     name: "Gold",     icon: "🥇", min: 90,  color: "#a16207", bg: "#fef3c7", border: "#fcd34d", glow: "0 6px 18px rgba(217,119,6,.28)",
    card: "linear-gradient(160deg,#fff 50%,#fff6d6 100%)" },
  { key: "platinum", name: "Platinum", icon: "💠", min: 160, color: "#0e7490", bg: "#cffafe", border: "#67e8f9", glow: "0 6px 20px rgba(6,182,212,.30)",
    card: "linear-gradient(160deg,#fff 45%,#e0f7fb 100%)" },
  { key: "diamond",  name: "Diamond",  icon: "💎", min: 260, color: "#6d28d9", bg: "#ede9fe", border: "#c4b5fd", glow: "0 8px 24px rgba(124,58,237,.34)",
    card: "linear-gradient(160deg,#fff 40%,#f0e9ff 100%)" },
];

export function tierForPoints(pts) {
  let t = TIERS[0];
  for (const x of TIERS) if (pts >= x.min) t = x;
  return t;
}

// Next tier up. If the member has an admin-assigned tier, go one above that.
export function nextTier(pts, currentTier = null) {
  if (currentTier) {
    const i = TIERS.findIndex((t) => t.key === currentTier.key);
    return TIERS[i + 1] || null;
  }
  return TIERS.find((t) => t.min > pts) || null;
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || null;
}

export function tierBadgeHtml(tier, small = false) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${tier.bg};color:${tier.color};border:1px solid ${tier.border};padding:${small ? "2px 8px" : "3px 10px"};border-radius:999px;font-size:${small ? 10 : 11}px;font-weight:700;white-space:nowrap;">${tier.icon} ${tier.name}</span>`;
}

// The "Admin" rank. It is not a points tier: it only appears on posts made by
// admins (the flag is checked by firestore.rules, so nobody else can set it).
export function adminBadgeHtml(small = false) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:linear-gradient(135deg,#0a1a10,#14632f);color:#fff;border:1px solid #2da45a;padding:${small ? "2px 9px" : "3px 11px"};border-radius:999px;font-size:${small ? 10 : 11}px;font-weight:800;letter-spacing:.4px;white-space:nowrap;box-shadow:0 2px 8px rgba(20,99,47,.35);">🛡️ ADMIN</span>`;
}

async function safeDocs(name) {
  try {
    return (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn(`Couldn't read ${name} for ranks:`, e);
    return [];
  }
}

// ---------------------------------------------------------------------
// Rank data loader
//
// Fast path  : one small read of `leaderboard/top`, a document the Cloud
//              Function in /functions keeps up to date (see functions/index.js).
// Fallback   : if that function isn't deployed yet, work the numbers out in
//              the browser from items / borrowRequests / users (the old way).
// Either way the result is cached in sessionStorage, so moving between pages
// paints instantly from the last-known data and then refreshes quietly.
// ---------------------------------------------------------------------
const CACHE_KEY = "borrowa_rank_v2";
const CACHE_MAX_AGE = 5 * 60 * 1000;
const SUMMARY_MAX_AGE = 3 * 60 * 60 * 1000; // a published summary is trusted for 3 hours
let memo = null;       // hydrated result for this page
let inflight = null;   // shared promise, so concurrent callers don't double-fetch

function hydrate(raw) {
  const members = new Map();
  const ranked = (raw.ranked || []).map((m) => {
    const assignedRank = tierByKey(m.assignedRank) ? m.assignedRank : null;
    const mm = { ...m, assignedRank, name: m.name || "Neighbor" };
    mm.tier = (assignedRank && tierByKey(assignedRank)) || tierForPoints(mm.points || 0);
    members.set(mm.uid, mm);
    return mm;
  });
  return { members, ranked, banned: new Set(), totals: raw.totals || {}, home: raw.home || null };
}

function readCache() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    return c && c.raw ? c : null;
  } catch (e) { return null; }
}
function writeCache(raw) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), raw })); } catch (e) {}
}

// Synchronous: last-known data (or null). Lets a page paint before the network answers.
export function peekRankData() {
  if (memo) return memo;
  const c = readCache();
  return c ? hydrate(c.raw) : null;
}

async function fromServerSummary() {
  try {
    const snap = await getDoc(doc(db, "leaderboard", "top"));
    if (!snap.exists()) return null;
    const { updatedAt, source, ...raw } = snap.data();
    // Too old (nobody has published it for a while)? Ignore it and work the
    // numbers out directly so visitors never see badly outdated rankings.
    const ageMs = updatedAt && updatedAt.toMillis ? Date.now() - updatedAt.toMillis() : Infinity;
    return ageMs < SUMMARY_MAX_AGE ? raw : null;
  } catch (e) { return null; }
}

async function computeInBrowser() {
  const [items, requests, users] = await Promise.all([safeDocs("items"), safeDocs("borrowRequests"), safeDocs("users")]);
  return computeStats({ items, requests, users });
}

// Returns { members: Map(uid -> member), ranked, banned:Set, totals, home }
export function loadRankData(force = false) {
  if (!force && memo) return Promise.resolve(memo);
  if (!force) {
    const c = readCache();
    if (c && Date.now() - c.t < CACHE_MAX_AGE) { memo = hydrate(c.raw); return Promise.resolve(memo); }
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const raw = (await fromServerSummary()) || (await computeInBrowser());
    writeCache(raw);
    memo = hydrate(raw);
    return memo;
  })().finally(() => { inflight = null; });
  return inflight;
}

// ---------------------------------------------------------------------
// Admin publishing. Called from admin.html (the rules only let admins write
// leaderboard/top). Works the numbers out once and stores them in ONE small
// document, so every visitor afterwards reads a single doc instead of
// downloading every item, request and user.
// ---------------------------------------------------------------------
export async function publishLeaderboard() {
  const raw = await computeInBrowser();
  raw.ranked = raw.ranked.slice(0, 1000); // keeps the doc well under Firestore's 1 MiB limit
  await setDoc(doc(db, "leaderboard", "top"), { ...raw, source: "admin", updatedAt: serverTimestamp() });
  try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
  memo = null;
  return raw;
}

// When was it last published? (Date or null)
export async function leaderboardUpdatedAt() {
  try {
    const snap = await getDoc(doc(db, "leaderboard", "top"));
    const t = snap.exists() && snap.get("updatedAt");
    return t && t.toDate ? t.toDate() : null;
  } catch (e) { return null; }
}
