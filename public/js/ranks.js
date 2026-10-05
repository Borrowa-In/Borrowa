import { db } from "./firebase-config.js";
import { collection, getDocs, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Shared rank logic: activity points, tiers and the aesthetic card styles.
// Points are worked out live from Firestore (nothing to cheat or sync).
// The scoring rules live in points.js (pure, unit-tested, and anti-farming).
import { computeStats, CAPS, POINTS } from "./points.js";
import { cleanRankConfig, tierLook } from "./rank-style.js";
export { CAPS, POINTS };

// Lowest tier first. `min` = points needed to reach it.
const BASE_TIERS = [
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
  // Given by admins only (min: null keeps it off the points ladder). Holding this rank is also what
  // lets a member open the moderator page and review reports (see firestore.rules isModerator()).
  { key: "moderator", name: "Moderator", icon: "🛡️", min: null, manual: true, color: "#ffffff",
    bg: "linear-gradient(135deg,#3730a3,#0e7490)", border: "#312e81", glow: "0 6px 20px rgba(55,48,163,.34)",
    card: "linear-gradient(160deg,#fff 40%,#e0e7ff 100%)", accent: "#3730a3" },
];

// The live list everyone imports. The main admin can restyle the built-in ranks (gradients) and add
// custom ranks (siteConfig/ranks). applyRankConfig() rewrites this array IN PLACE so every page
// that imported it sees the change. A custom rank with `min: null` is only given by an admin.
export const TIERS = BASE_TIERS.map((t) => ({ ...t, accent: t.accent || t.color }));
let rankConfig = { overrides: {}, custom: [] };
let adminLook = null;

export function applyRankConfig(raw) {
  rankConfig = cleanRankConfig(raw);
  const next = BASE_TIERS.map((t) => {
    const st = rankConfig.overrides[t.key];
    return st ? { ...t, ...tierLook(st), style: st, styled: true } : { ...t, accent: t.accent || t.color };
  });
  rankConfig.custom.forEach((c) => {
    next.push({ key: c.id, name: c.name, icon: c.icon, min: c.min, custom: true, manual: c.min === null,
      style: { c1: c.c1, c2: c.c2, angle: c.angle, text: c.text }, styled: true, ...tierLook(c) });
  });
  TIERS.length = 0;
  next.forEach((t) => TIERS.push(t));
  adminLook = rankConfig.overrides.admin ? tierLook(rankConfig.overrides.admin) : null;
  return rankConfig;
}
export function getRankConfig() { return JSON.parse(JSON.stringify(rankConfig)); }
export const BASE_RANKS = BASE_TIERS.map((t) => ({ key: t.key, name: t.name, icon: t.icon, min: t.min }));

// Is this member a moderator? (rank is admin-only writable, so it can't be faked.)
export function isModeratorTier(tier) { return !!tier && tier.key === "moderator"; }

// Ranks that are reached by points, lowest first. Admin-only custom ranks are not on this ladder.
function ladder() { return TIERS.filter((t) => Number.isFinite(t.min)).sort((a, b) => a.min - b.min); }

export function tierForPoints(pts) {
  const l = ladder();
  let t = l[0] || TIERS[0];
  for (const x of l) if (pts >= x.min) t = x;
  return t;
}

// Next tier up. If the member has an admin-assigned tier, go one above that.
export function nextTier(pts, currentTier = null) {
  const l = ladder();
  if (currentTier) {
    const i = l.findIndex((t) => t.key === currentTier.key);
    return i < 0 ? null : l[i + 1] || null;
  }
  return l.find((t) => t.min > pts) || null;
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || null;
}

export function tierBadgeHtml(tier, small = false) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${tier.bg};color:${tier.color};border:1px solid ${tier.border};padding:${small ? "2px 8px" : "3px 10px"};border-radius:999px;font-size:${small ? 10 : 11}px;font-weight:700;white-space:nowrap;">${tier.icon} ${tier.name}</span>`;
}

// ---- chat name tag + namecard ----------------------------------------------------------------
// The name is drawn ON the rank's own background, using the rank's text colour (admins can pick it),
// with a faint shadow so it stays readable on any gradient. Newcomers get a plain, quiet name.
const escTxt = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lightText = (c) => /^#?(fff|ffffff)$/i.test(String(c || "").trim());

export function nameTagHtml(name, tier, small = false) {
  const n = escTxt(name || "Neighbor");
  if (!tier || tier.key === "none") return `<span class="name-tag name-tag-plain${small ? " name-tag-sm" : ""}">${n}</span>`;
  const shadow = lightText(tier.color) ? "text-shadow:0 1px 2px rgba(0,0,0,.35);" : "";
  return `<span class="name-tag${small ? " name-tag-sm" : ""}" style="background:${tier.bg};color:${tier.color};border-color:${tier.border};box-shadow:${tier.glow};${shadow}"><span class="name-tag-icon">${tier.icon}</span><span class="name-tag-text">${n}</span></span>`;
}

// Bigger card for the top of a conversation: initial, name, rank and (for moderators) a trust line.
export function nameCardHtml(name, tier) {
  const n = escTxt(name || "Neighbor");
  const t = tier || TIERS[0];
  const shadow = lightText(t.color) ? "text-shadow:0 1px 2px rgba(0,0,0,.35);" : "";
  const mod = isModeratorTier(t);
  return `<span class="namecard" style="background:${t.key === "none" ? "#f3f4f6" : t.bg};color:${t.key === "none" ? "#111827" : t.color};border-color:${t.border};box-shadow:${t.key === "none" ? "none" : t.glow};${t.key === "none" ? "" : shadow}">
    <span class="namecard-avatar" style="border-color:${t.key === "none" ? "#d5e3da" : "rgba(255,255,255,.65)"};">${escTxt(String(name || "?").trim().charAt(0).toUpperCase() || "?")}</span>
    <span class="namecard-body"><span class="namecard-name">${n}</span><span class="namecard-rank">${t.icon} ${escTxt(t.name)}${mod ? " · Borrowa team" : ""}</span></span>
  </span>`;
}

// The look of a post made by this tier, taken from the rank's own saved colours
// (so a rank restyled in the admin panel restyles its posts too). Newcomers keep the plain card.
export function postLookForTier(tier) {
  if (!tier || tier.key === "none") return null;
  return { bg: tier.bg, color: tier.color, border: tier.border, glow: tier.glow };
}

// Same, for the Admin rank (uses the colours saved for "admin", or the built-in green).
export function adminPostLook() {
  return {
    bg: adminLook ? adminLook.bg : "linear-gradient(135deg,#0a1a10,#14632f)",
    color: adminLook ? adminLook.color : "#ffffff",
    border: adminLook ? adminLook.border : "#2da45a",
    glow: adminLook ? adminLook.glow : "0 6px 18px rgba(20,99,47,.22)",
  };
}

// The "Admin" rank. It is not a points tier: it only appears on posts made by
// admins (the flag is checked by firestore.rules, so nobody else can set it).
export function adminBadgeHtml(small = false) {
  const bg = adminLook ? adminLook.bg : "linear-gradient(135deg,#0a1a10,#14632f)";
  const color = adminLook ? adminLook.color : "#fff";
  const border = adminLook ? adminLook.border : "#2da45a";
  const glow = adminLook ? adminLook.glow : "0 2px 8px rgba(20,99,47,.35)";
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${color};border:1px solid ${border};padding:${small ? "2px 9px" : "3px 11px"};border-radius:999px;font-size:${small ? 10 : 11}px;font-weight:800;letter-spacing:.4px;white-space:nowrap;box-shadow:${glow};">🛡️ ADMIN</span>`;
}

// ---------------------------------------------------------------------
// Rank styles chosen by the main admin: siteConfig/ranks (one small document).
// Read by everyone (cached for 5 minutes in this tab); written only by the main admin.
// ---------------------------------------------------------------------
const CFG_KEY = "borrowa_rankcfg_v1";
const CFG_MAX_AGE = 5 * 60 * 1000;
let cfgInflight = null;
function readCfgCache() {
  try { const c = JSON.parse(sessionStorage.getItem(CFG_KEY) || "null"); return c && c.cfg ? c : null; } catch (e) { return null; }
}
function writeCfgCache(cfg) { try { sessionStorage.setItem(CFG_KEY, JSON.stringify({ t: Date.now(), cfg })); } catch (e) {} }

export function loadRankConfig(force = false) {
  const c = readCfgCache();
  if (!force && c && Date.now() - c.t < CFG_MAX_AGE) return Promise.resolve(rankConfig);
  if (cfgInflight) return cfgInflight;
  cfgInflight = (async () => {
    try {
      const snap = await getDoc(doc(db, "siteConfig", "ranks"));
      const raw = snap.exists() ? snap.data() : {};
      applyRankConfig(raw);
      writeCfgCache(getRankConfig());
    } catch (e) { console.warn("Couldn't read rank styles (using the defaults):", e); }
    return rankConfig;
  })().finally(() => { cfgInflight = null; });
  return cfgInflight;
}

// Main admin only (firestore.rules refuse everyone else). Replaces the whole document.
export async function saveRankConfig(cfg) {
  const clean = cleanRankConfig(cfg);
  await setDoc(doc(db, "siteConfig", "ranks"), { ...clean, updatedAt: serverTimestamp() });
  applyRankConfig(clean);
  writeCfgCache(getRankConfig());
  try { sessionStorage.removeItem("borrowa_rank_v2"); } catch (e) {}
  return getRankConfig();
}

// Paint immediately from the last-known styles so badges never flash the default look.
{ const c = readCfgCache(); if (c) applyRankConfig(c.cfg); }

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
    await loadRankConfig();
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
