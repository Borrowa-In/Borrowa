// Pure colour / gradient helpers shared by the post-style panel, the rank editor and ranks.js.
// No imports on purpose, so it can be unit-tested in Node (tests/rank-style.test.mjs).
//
// Safety: only plain #rrggbb colours and whole-number angles are ever turned into CSS, and ranks
// pulled from the database are re-cleaned here before use, so a stored value can never smuggle
// other CSS or HTML into a page.

export const BASE_RANK_KEYS = ["none", "bronze", "silver", "gold", "platinum", "diamond", "moderator"];
export const STYLE_KEYS = [...BASE_RANK_KEYS, "admin"];
export const MAX_CUSTOM_RANKS = 20;

export function safeHex(c) {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c.trim()) ? c.trim().toLowerCase() : "";
}

// Accepts "#abc", "abc", "#aabbcc", "aabbcc" and returns "#aabbcc" (or "").
export function normalizeHex(input) {
  let s = String(input || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(s) ? "#" + s : "";
}

export function clampAngle(a, fallback = 135) {
  const n = Math.round(Number(a));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(360, Math.max(0, n));
}

export function hexToRgb(hex) {
  const h = safeHex(hex);
  if (!h) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
export function rgbToHex(r, g, b) {
  const c = (v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha))})`;
}

// h 0-360, s/l 0-100
export function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.min(100, Math.max(0, s)) / 100; l = Math.min(100, Math.max(0, l)) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// Blend two colours: t=0 -> a, t=1 -> b.
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Readable text colour for a background made of one or two colours.
export function contrastText(c1, c2) {
  const l = c2 ? (luminance(c1) + luminance(c2)) / 2 : luminance(c1);
  return l > 0.42 ? "#111827" : "#ffffff";
}

// "linear-gradient(135deg,#aaa,#bbb)", or a flat colour when there is no second colour.
export function gradientCss(c1, c2, angle = 135) {
  const a = safeHex(c1), b = safeHex(c2);
  if (!a) return "#ffffff";
  if (!b || a === b) return a;
  return `linear-gradient(${clampAngle(angle)}deg,${a},${b})`;
}

export const GRADIENT_PRESETS = [
  { name: "Sunset",   c1: "#ff7e5f", c2: "#feb47b", angle: 135, text: "#3b1305" },
  { name: "Ocean",    c1: "#2193b0", c2: "#6dd5ed", angle: 135, text: "#062b38" },
  { name: "Forest",   c1: "#134e29", c2: "#3fae63", angle: 135, text: "#ffffff" },
  { name: "Berry",    c1: "#8e2de2", c2: "#f368a8", angle: 135, text: "#ffffff" },
  { name: "Gold",     c1: "#f7c948", c2: "#fff1b8", angle: 135, text: "#4a3500" },
  { name: "Midnight", c1: "#0f2027", c2: "#2c5364", angle: 135, text: "#ffffff" },
  { name: "Candy",    c1: "#ff9a9e", c2: "#fad0c4", angle: 120, text: "#4a1020" },
  { name: "Mint",     c1: "#11998e", c2: "#a8f0c6", angle: 135, text: "#05302b" },
  { name: "Fire",     c1: "#ef3b36", c2: "#ffb347", angle: 135, text: "#ffffff" },
  { name: "Sky",      c1: "#4facfe", c2: "#c2e9fb", angle: 160, text: "#052a4a" },
  { name: "Royal",    c1: "#41295a", c2: "#8b6bd1", angle: 135, text: "#ffffff" },
  { name: "Peach",    c1: "#ffecd2", c2: "#fcb69f", angle: 135, text: "#4a2214" },
];

export const SWATCHES = [
  "#ffffff", "#f3f4f6", "#9ca3af", "#4b5563", "#111827", "#000000",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef",
  "#ec4899", "#14632f", "#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8",
];

// ---- rank styles -------------------------------------------------------------------------

export function cleanRankStyle(raw) {
  if (!raw || typeof raw !== "object") return null;
  const c1 = safeHex(raw.c1);
  if (!c1) return null;
  const c2 = safeHex(raw.c2) || c1;
  return { c1, c2, angle: clampAngle(raw.angle), text: safeHex(raw.text) || contrastText(c1, c2) };
}

function cleanName(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f<>&"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Everything read back from the database goes through here.
export function cleanRankConfig(raw) {
  const out = { overrides: {}, custom: [] };
  if (!raw || typeof raw !== "object") return out;
  const ov = raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {};
  for (const key of STYLE_KEYS) {
    const st = cleanRankStyle(ov[key]);
    if (st) out.overrides[key] = st;
  }
  const seen = new Set();
  (Array.isArray(raw.custom) ? raw.custom : []).forEach((c) => {
    if (!c || typeof c !== "object" || out.custom.length >= MAX_CUSTOM_RANKS) return;
    const id = typeof c.id === "string" && /^c_[a-z0-9]{2,16}$/.test(c.id) ? c.id : "";
    const st = cleanRankStyle(c);
    const name = cleanName(c.name, 24);
    if (!id || !st || !name || seen.has(id)) return;
    seen.add(id);
    const min = Number.isFinite(Number(c.min)) && c.min !== null && c.min !== "" ? Math.min(100000, Math.max(1, Math.round(Number(c.min)))) : null;
    out.custom.push({ id, name, icon: cleanName(c.icon, 8) || "⭐", min, ...st });
  });
  return out;
}

// CSS-ready pieces for a rank built from a style.
export function tierLook(style) {
  const { c1, c2, angle, text } = style;
  return {
    bg: gradientCss(c1, c2, angle),
    color: text,
    border: mix(c1, "#000000", 0.18),
    accent: mix(c2 || c1, "#000000", 0.42),   // readable on white / light cards
    glow: `0 6px 20px ${rgba(c1, 0.34)}`,
    card: `linear-gradient(160deg,#ffffff 38%,${rgba(c2, 0.22)} 100%)`,
  };
}

export function newRankId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "c_";
  const buf = new Uint8Array(6);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(buf);
  buf.forEach((b) => { s += chars[b % chars.length]; });
  return s;
}

// ---- admin post style (gradient background) --------------------------------------------------

export function postBgCss(ps, fallback = "") {
  if (!ps || !ps.bg) return fallback;
  return ps.bg2 ? gradientCss(ps.bg, ps.bg2, ps.angle == null ? 160 : ps.angle) : ps.bg;
}
