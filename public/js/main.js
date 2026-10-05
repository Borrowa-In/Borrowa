import { auth, db, DEV_MODE } from "./firebase-config.js";
import { 
  collection, addDoc, serverTimestamp, getDocs, query, orderBy, doc, deleteDoc, updateDoc, getDoc,
  runTransaction, arrayUnion, writeBatch, setDoc, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { compressPhoto } from "./photo.js";
import { 
  onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { buildUnclaimUpdate, buildReturnUpdate } from "./item-status.js";
import { notifyPosterOfClaim, initClaimNotifications } from "./notifications.js";
import { renderNavProfileButton } from "./nav-profile.js";
import { saveNavCache, clearNavCache } from "./nav-cache.js";
import { loadRankData, peekRankData, tierBadgeHtml, adminBadgeHtml, TIERS } from "./ranks.js";
import { isAdminUser, needsVerification, isTester } from "./auth.js";
import { getCurrentPositionSafe, distanceMeters } from "./geo.js";
import { recordLoginIp, isIpBanned } from "./ip-guard.js";
import { initE2ee } from "./e2ee.js";
import { getOrCreateChat } from "./chat.js";
import { mountPushPrompt, refreshPushToken, forgetPushOnThisDevice } from "./push.js";
import { itemArtHtml } from "./art.js";
import { createColorStudio } from "./color-studio.js";
import { postBgCss, clampAngle } from "./rank-style.js";

// Escapes HTML-significant characters before untrusted data (item titles,
// descriptions, locations, conditions, poster names, etc.) gets interpolated
// into an innerHTML template — without this, a listing containing something
// like <img src=x onerror=...> would execute in every viewer's browser.
function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Item names always start with a capital letter ("wooden chair" -> "Wooden chair").
function capFirst(text) {
  const t = String(text == null ? "" : text).trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

// Admin post colours. Only plain #rrggbb values are ever used in a style
// attribute, so a stored colour can never smuggle in other CSS or HTML.
function safeHex(c) { return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : ""; }
function cleanPostStyle(st) {
  if (!st || typeof st !== "object") return null;
  const out = {};
  for (const k of ["bg", "bg2", "border", "title", "text"]) { const v = safeHex(st[k]); if (v) out[k] = v; }
  // A gradient needs a first colour; the angle only means something with two colours.
  if (out.bg2 && !out.bg) delete out.bg2;
  if (out.bg2 && st.angle !== undefined && st.angle !== null && st.angle !== "") out.angle = clampAngle(st.angle, 160);
  return Object.keys(out).length ? out : null;
}
const ADMIN_STYLE_DEFAULTS = { bg: "#ffffff", bg2: "#e6f6ec", angle: 160, border: "#14632f", title: "#14632f", text: "#4b5563" };

// Is the signed-in member an admin? Drives the admin-only post colour tools.
let currentUserIsAdmin = false;

// Only Firebase Storage image URLs are ever used as a CSS background / image
// source. Anything else (javascript:, data:, a quote that would break out of
// url('...')) is dropped.
function safeImageUrl(url) {
  if (typeof url !== "string") return "";
  const inline = /^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length < 90000;
  if (!inline && !/^https:\/\/firebasestorage\.googleapis\.com\//.test(url)) return "";
  if (/['"()\\\s<>]/.test(url)) return "";
  return url;
}

// Radius used to split the community feed into a "near you" bucket and a
// "rest of the community" bucket (see loadItems()). Distance is computed
// from the viewer's live browser location to the item's stored post
// location, best-effort — see js/geo.js for why this fails open.
const NEARBY_RADIUS_METERS = 1000;

// The browser location prompt only needs to fire once per page load, not
// on every loadItems() call (category clicks, post/claim actions, etc.).
// undefined = not yet requested, null = denied/unsupported/timed out.
let cachedViewerLocation;
let locationRequested = false;
const LOC_KEY = "borrowa_loc_v1";

// Instant, never waits: last-known location (this page or earlier in the
// session). undefined = we don't know yet.
function peekViewerLocation() {
  if (cachedViewerLocation !== undefined) return cachedViewerLocation;
  try {
    const c = JSON.parse(sessionStorage.getItem(LOC_KEY) || "null");
    if (c && Date.now() - c.t < 10 * 60 * 1000) { cachedViewerLocation = c.loc; return c.loc; }
  } catch (e) {}
  return undefined;
}

// Asks for the location in the background. Items render straight away and
// are re-sorted once (if) the location arrives, instead of the whole page
// sitting empty for up to 6 seconds waiting on GPS.
function warmViewerLocation() {
  if (locationRequested) return;
  locationRequested = true;
  getCurrentPositionSafe().then((loc) => {
    cachedViewerLocation = loc;
    try { sessionStorage.setItem(LOC_KEY, JSON.stringify({ t: Date.now(), loc })); } catch (e) {}
    loadItems();
  });
}

// Used by the claim flow, which does need an answer before it continues.
async function getViewerLocationCached() {
  const known = peekViewerLocation();
  if (known !== undefined) return known;
  cachedViewerLocation = await getCurrentPositionSafe();
  try { sessionStorage.setItem(LOC_KEY, JSON.stringify({ t: Date.now(), loc: cachedViewerLocation })); } catch (e) {}
  return cachedViewerLocation;
}

// DOM Elements
const postModalOverlay = document.getElementById("post-modal-overlay");
const navPostBtn = document.getElementById("nav-post-btn");
const heroPostBtn = document.getElementById("hero-post-btn");
const postModalClose = document.getElementById("post-modal-close");
const postItemForm = document.getElementById("post-item-form");
const logoutBtn = document.getElementById("logout-btn");
const itemGrid = document.getElementById("item-grid");

// Item photo upload elements (post/edit modal)
const postPhotoInput = document.getElementById("post-photo-input");
const postPhotoPreview = document.getElementById("post-photo-preview");
const postPhotoFilename = document.getElementById("post-photo-filename");
let editingPhotoURL = null; // existing photoURL of the item being edited, kept unless a new file is chosen

// Claim Modal Elements
const claimModalOverlay = document.getElementById("claim-modal-overlay");
const claimModalClose = document.getElementById("claim-modal-close");
const claimCancelBtn = document.getElementById("claim-cancel-btn");
const claimConfirmBtn = document.getElementById("claim-confirm-btn");
const claimItemDetails = document.getElementById("claim-item-details");

// Ensure modal overlays are hidden on load
if (postModalOverlay) postModalOverlay.style.display = "none";
if (claimModalOverlay) claimModalOverlay.style.display = "none";

// Tracks whether the signed-in user is currently banned (set from the
// users/{uid} doc in the auth listener below) — used to short-circuit
// posting/claiming with a friendly message instead of a raw permission
// error from Firestore rules.
let currentUserBanned = false;

// Lending and borrowing need a verified email (firestore.rules enforces it too).
async function emailGateBlocks(user) {
  let admin = false;
  try { admin = await isAdminUser(user); } catch (e) {}
  return needsVerification(user, admin);
}
const VERIFY_MSG = "Please verify your email first. Use the yellow banner at the top to resend the link.";

// --- Quantity helpers ---
// Items now track quantityTotal / quantityAvailable as whole-number integers
// so a listing can be partially claimed instead of being all-or-nothing.
// Older docs only have a free-text `quantity` string (e.g. "3 kg") — fall
// back to parsing that so existing listings keep working.
function getQuantityInfo(item) {
  if (typeof item.quantityTotal === "number" && typeof item.quantityAvailable === "number") {
    return {
      total: Math.max(0, Math.round(item.quantityTotal)),
      available: Math.max(0, Math.round(item.quantityAvailable)),
      unit: String(item.quantityUnit || "units").slice(0, 20)
    };
  }

  // Legacy fallback: parse "3 kg" style strings and treat the item as fully
  // available/claimed based on its status, since no partial data exists.
  const match = /^([\d.]+)\s*(.*)$/.exec((item.quantity || "").trim());
  const total = match ? Math.max(1, Math.round(parseFloat(match[1]))) : 1;
  const unit = (match && match[2].trim()) || "units";
  const available = (!item.status || item.status === "available") ? total : 0;
  return { total, available, unit };
}

let searchInput = document.getElementById("search-input") || document.querySelector("input[type='search']") || document.querySelector("input[placeholder*='Search' i]");
let editingDocId = null;
let currentCategory = "All";
let selectedClaimDocId = null;
let selectedClaimItemData = null;

// Ensure search bar exists and functions
if (itemGrid && !searchInput) {
  const searchWrapper = document.createElement("div");
  searchWrapper.style.cssText = "display: flex; gap: 8px; margin-bottom: 24px; max-width: 600px; width: 100%; position: relative; z-index: 10;";
  searchWrapper.innerHTML = `
    <input type="search" id="dynamic-search-input" placeholder="Search items by title or description..." style="flex: 1; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none;" />
    <button id="dynamic-search-btn" style="background: #14632f; color: #ffffff; border: none; padding: 0 18px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">➔</button>
  `;
  itemGrid.parentElement.insertBefore(searchWrapper, itemGrid);
  searchInput = document.getElementById("dynamic-search-input");
}

if (searchInput) {
  // Filter while typing (short pause so it doesn't redraw on every key).
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadItems(), 250);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadItems();
    }
  });
}

const existingSearchBtn = document.getElementById("search-action-btn") || document.getElementById("dynamic-search-btn");
if (existingSearchBtn) {
  existingSearchBtn.addEventListener("click", () => loadItems());
}

// Show a live thumbnail of whatever photo the person just picked, and note
// its filename so it's clear a photo has been attached before they submit.
if (postPhotoInput) {
  postPhotoInput.addEventListener("change", () => {
    const file = postPhotoInput.files && postPhotoInput.files[0];
    if (!file) {
      if (postPhotoFilename) postPhotoFilename.textContent = "No file selected — items with photos get borrowed faster";
      if (postPhotoPreview) postPhotoPreview.style.display = "none";
      return;
    }
    if (postPhotoFilename) postPhotoFilename.textContent = file.name;
    if (postPhotoPreview) {
      const reader = new FileReader();
      reader.onload = () => {
        postPhotoPreview.src = reader.result;
        postPhotoPreview.style.display = "block";
      };
      reader.readAsDataURL(file);
    }
  });
}

let editingHasPhoto = false;
function resetPhotoField(existingPhotoURL = null) {
  editingPhotoURL = existingPhotoURL;
  editingHasPhoto = false;
  if (postPhotoInput) postPhotoInput.value = "";
  if (postPhotoPreview) {
    if (existingPhotoURL) {
      postPhotoPreview.src = existingPhotoURL;
      postPhotoPreview.style.display = "block";
    } else {
      postPhotoPreview.src = "";
      postPhotoPreview.style.display = "none";
    }
  }
  if (postPhotoFilename) {
    postPhotoFilename.textContent = existingPhotoURL
      ? "Current photo — choose a file to replace it"
      : "No file selected — items with photos get borrowed faster";
  }
}

// Admin-only "Post style" section of the lend form (colours of the card, title and text).
function syncAdminStyleBox() {
  const box = document.getElementById("admin-style-box");
  if (box) box.style.display = currentUserIsAdmin ? "block" : "none";
}
// One-click card looks for the inline colour studio: background gradient + matching border/title/text.
const POST_STYLE_PRESETS = [
  { name: "Sunset",   values: { bg: "#fff3e8", bg2: "#ffd2b0", border: "#f97316", title: "#9a3412", text: "#5b3a29" }, angle: 150 },
  { name: "Ocean",    values: { bg: "#e6f7fd", bg2: "#b4e4f4", border: "#0891b2", title: "#0e5a73", text: "#31515c" }, angle: 150 },
  { name: "Forest",   values: { bg: "#eaf8ef", bg2: "#b9e6c8", border: "#14632f", title: "#14632f", text: "#3b5a46" }, angle: 150 },
  { name: "Berry",    values: { bg: "#f7edff", bg2: "#f8cfe8", border: "#a21caf", title: "#7e1fa8", text: "#5a3a66" }, angle: 150 },
  { name: "Gold",     values: { bg: "#fffbe6", bg2: "#ffe28a", border: "#d97706", title: "#92400e", text: "#5c4a1e" }, angle: 150 },
  { name: "Candy",    values: { bg: "#ffe9ef", bg2: "#ffd3c2", border: "#ec4899", title: "#9d174d", text: "#6b3a4a" }, angle: 150 },
  { name: "Mint",     values: { bg: "#e5fbf4", bg2: "#b3efd3", border: "#11998e", title: "#0b6b61", text: "#2f5a53" }, angle: 150 },
  { name: "Midnight", values: { bg: "#0f2027", bg2: "#2c5364", border: "#38bdf8", title: "#ffffff", text: "#cbd5e1" }, angle: 150 },
  { name: "Royal",    values: { bg: "#41295a", bg2: "#2f0743", border: "#c4b5fd", title: "#ffffff", text: "#e9d5ff" }, angle: 150 },
  { name: "Fire",     values: { bg: "#fff0e6", bg2: "#ffc9a8", border: "#ef3b36", title: "#b91c1c", text: "#6b3a2f" }, angle: 150 },
];
let postStyleStudio = null;
function readStyleFields() {
  const f = postItemForm; const g = (n, d) => (f && f.elements[n] ? f.elements[n].value : d);
  return { bg: g("styleBg", ""), bg2: g("styleBg2", ""), angle: g("styleAngle", ""), border: g("styleBorder", ""), title: g("styleTitle", ""), text: g("styleText", "") };
}
function updateAdminStylePreview() {
  const f = postItemForm; const pv = document.getElementById("admin-style-preview");
  if (!f || !pv) return;
  const on = document.getElementById("admin-style-on");
  const use = !!(on && on.checked);
  const st = cleanPostStyle(readStyleFields()) || {};
  const bg = use ? (postBgCss({ ...st, bg: st.bg || ADMIN_STYLE_DEFAULTS.bg }) || ADMIN_STYLE_DEFAULTS.bg) : ADMIN_STYLE_DEFAULTS.bg;
  const bd = use ? (st.border || ADMIN_STYLE_DEFAULTS.border) : ADMIN_STYLE_DEFAULTS.border;
  pv.style.background = bg; pv.style.border = "2px solid " + bd;
  const t = pv.querySelector(".item-title"); const p = pv.querySelector("p");
  if (t) { t.style.color = use ? (st.title || ADMIN_STYLE_DEFAULTS.title) : ADMIN_STYLE_DEFAULTS.title; t.style.setProperty("--accent", bd); }
  if (p) p.style.color = use ? (st.text || ADMIN_STYLE_DEFAULTS.text) : ADMIN_STYLE_DEFAULTS.text;
}
function writeStyleFields(state, announce) {
  const f = postItemForm; if (!f) return;
  const v = state.values;
  f.elements.styleBg.value = v.bg; f.elements.styleBg2.value = state.gradientOn ? v.bg2 : "";
  f.elements.styleAngle.value = state.angle; f.elements.styleBorder.value = v.border;
  f.elements.styleTitle.value = v.title; f.elements.styleText.value = v.text;
  // Tell the form something style-related changed (turns "use my colors" on and refreshes the preview).
  if (announce) f.elements.styleBg.dispatchEvent(new Event("input", { bubbles: true }));
}
function mountPostStyleStudio() {
  const root = document.getElementById("admin-style-studio");
  if (!root || postStyleStudio) return;
  postStyleStudio = createColorStudio(root, {
    slots: [
      { key: "bg", label: "Card colour" }, { key: "bg2", label: "Second colour" },
      { key: "border", label: "Border" }, { key: "title", label: "Title" }, { key: "text", label: "Text" },
    ],
    values: ADMIN_STYLE_DEFAULTS, angle: ADMIN_STYLE_DEFAULTS.angle,
    gradientToggle: { slot: "bg2", label: "Gradient background", on: false },
    presets: POST_STYLE_PRESETS,
    onChange: (state) => writeStyleFields(state, true),
  });
}
function loadAdminStyleFields(editData) {
  const f = postItemForm; if (!f) return;
  mountPostStyleStudio();
  const st = editData ? cleanPostStyle(editData.postStyle) : null;
  const on = document.getElementById("admin-style-on");
  if (on) on.checked = !!st;
  const state = {
    values: { bg: (st && st.bg) || ADMIN_STYLE_DEFAULTS.bg, bg2: (st && st.bg2) || ADMIN_STYLE_DEFAULTS.bg2,
      border: (st && st.border) || ADMIN_STYLE_DEFAULTS.border, title: (st && st.title) || ADMIN_STYLE_DEFAULTS.title, text: (st && st.text) || ADMIN_STYLE_DEFAULTS.text },
    angle: st && st.angle !== undefined ? st.angle : ADMIN_STYLE_DEFAULTS.angle,
    gradientOn: !!(st && st.bg2),
  };
  writeStyleFields(state, false);
  if (postStyleStudio) postStyleStudio.set(state);
  updateAdminStylePreview();
}
if (postItemForm) {
  postItemForm.addEventListener("input", (e) => {
    if (e.target && (e.target.id === "admin-style-on" || /^style/.test(e.target.name || ""))) {
      if (e.target.name && e.target.id !== "admin-style-on") { const on = document.getElementById("admin-style-on"); if (on) on.checked = true; }
      updateAdminStylePreview();
    }
  });
  const rs = document.getElementById("admin-style-reset");
  if (rs) rs.addEventListener("click", () => loadAdminStyleFields(null));
}

// Modal Controls (Post / Edit)
function openModal(editData = null) {
  // Guests can browse but not lend: send them to log in / sign up instead.
  if (!auth.currentUser) {
    showNotification("Log in or sign up to lend an item.", "error");
    setTimeout(() => { window.location.href = "login.html?next=home.html"; }, 900);
    return;
  }
  // Pages without the lend-item form (e.g. Requests) send the member to the
  // home page, which opens the form automatically.
  if (!postModalOverlay) {
    window.location.href = "home.html?lend=1";
    return;
  }
  postModalOverlay.style.display = "flex";
  syncAdminStyleBox();
  
  const modalTitle = postModalOverlay.querySelector("h3");
  const submitBtn = postItemForm ? postItemForm.querySelector('button[type="submit"]') : null;

  if (editData) {
    editingDocId = editData.id;
    if (modalTitle) modalTitle.textContent = "Edit listing";
    if (submitBtn) submitBtn.textContent = "Save changes";

    if (postItemForm) {
      postItemForm.title.value = editData.title || "";
      postItemForm.category.value = editData.category || "";
      postItemForm.condition.value = editData.condition || "";

      // Prefer the structured integer fields; fall back to parsing the old
      // free-text quantity string ("3 kg") for listings created before this.
      const knownUnits = ["units", "kg", "g", "pieces", "packs", "liters"];
      let amountValue = 1;
      let parsedUnit = "";
      if (typeof editData.quantityTotal === "number") {
        amountValue = Math.max(1, Math.round(editData.quantityTotal));
        parsedUnit = (editData.quantityUnit || "").toLowerCase();
      } else {
        const quantityMatch = /^([\d.]+)\s*(.*)$/.exec((editData.quantity || "").trim());
        amountValue = quantityMatch ? Math.max(1, Math.round(parseFloat(quantityMatch[1]))) : 1;
        parsedUnit = quantityMatch ? quantityMatch[2].trim().toLowerCase() : "";
      }
      postItemForm.quantityAmount.value = amountValue;
      postItemForm.quantityUnit.value = knownUnits.includes(parsedUnit) ? parsedUnit : "units";

      postItemForm.pickupLocation.value = editData.pickupLocation || "";
      if (postItemForm.borrowPeriod) postItemForm.borrowPeriod.value = editData.borrowPeriod || "1 week";
      postItemForm.description.value = editData.description || "";
      loadAdminStyleFields(editData);
    }
    resetPhotoField(editData.photoURL || null);
    if (editData.hasPhoto && !editData.photoURL) {
      editingHasPhoto = true;
      getDoc(doc(db, "itemPhotos", editData.id)).then((ph) => {
        const d = ph.exists() ? safeImageUrl(ph.data().data) : "";
        if (d && postPhotoPreview) { postPhotoPreview.src = d; postPhotoPreview.style.display = "block"; }
        if (d && postPhotoFilename) postPhotoFilename.textContent = "Current photo — choose a file to replace it";
      }).catch(() => {});
    }
    } else {
    editingDocId = null;
    if (modalTitle) modalTitle.textContent = "Lend an item";
    if (submitBtn) submitBtn.textContent = "List item";
    if (postItemForm) { postItemForm.reset(); loadAdminStyleFields(null); }
    resetPhotoField(null);
  }
}

function closeModal() {
  if (postModalOverlay) postModalOverlay.style.display = "none";
  if (postItemForm) postItemForm.reset();
  editingDocId = null;
  resetPhotoField(null);
}

const lendClick = () => {
  if (!auth.currentUser) { window.location.href = "login.html?next=home.html"; return; }
  openModal();
};
if (navPostBtn) navPostBtn.addEventListener("click", lendClick);
if (heroPostBtn) heroPostBtn.addEventListener("click", lendClick);
if (postModalClose) postModalClose.addEventListener("click", closeModal);

if (postModalOverlay) {
  postModalOverlay.addEventListener("click", (e) => {
    if (e.target === postModalOverlay) closeModal();
  });
}

// Claim Modal Controls
function openClaimModal(docId, item) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    showNotification("Please log in to borrow items.", "error");
    window.location.href = "login.html";
    return;
  }

  const qty = getQuantityInfo(item);
  if (item.status === "claimed" || qty.available <= 0) {
    showNotification("This item is no longer available.", "error");
    return;
  }

  selectedClaimDocId = docId;
  selectedClaimItemData = item;

  if (claimItemDetails) {
    claimItemDetails.innerHTML = `
      You are about to borrow <strong>${escapeHtml(capFirst(item.title) || "this item")}</strong> from <strong>${escapeHtml(item.pickupLocation || "the lender")}</strong>.
      ${item.borrowPeriod ? `The lender asks that it be returned within <strong>${escapeHtml(item.borrowPeriod)}</strong>. ` : ""}Once confirmed, a private chat will open with the lender to arrange pickup and return.
    `;
  }

  const claimAmountContainer = document.getElementById("claim-amount-container");
  if (claimAmountContainer) {
    const dueDefault = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const dueMin = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const dueMax = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const dueHtml = `<label style="display:block;font-size:13px;font-weight:600;color:#374151;margin:12px 0 4px;">I'll return it by</label>
      <input type="date" id="claim-due-input" min="${dueMin}" max="${dueMax}" value="${dueDefault}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;" />`;
    if (qty.available > 1) {
      claimAmountContainer.innerHTML = `
        <label style="display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 4px;">
          How many would you like to borrow? (${qty.available} ${escapeHtml(qty.unit)} available)
        </label>
        <input type="number" id="claim-amount-input" min="1" step="1" max="${qty.available}" value="1"
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box;" />
      ` + dueHtml;
    } else {
      claimAmountContainer.innerHTML = dueHtml;
    }
  }

  if (claimModalOverlay) claimModalOverlay.style.display = "flex";
}

function closeClaimModal() {
  if (claimModalOverlay) claimModalOverlay.style.display = "none";
  const claimAmountContainer = document.getElementById("claim-amount-container");
  if (claimAmountContainer) claimAmountContainer.innerHTML = "";
  selectedClaimDocId = null;
  selectedClaimItemData = null;
}

if (claimModalClose) claimModalClose.addEventListener("click", closeClaimModal);
if (claimCancelBtn) claimCancelBtn.addEventListener("click", closeClaimModal);

if (claimModalOverlay) {
  claimModalOverlay.addEventListener("click", (e) => {
    if (e.target === claimModalOverlay) closeClaimModal();
  });
}

// Confirm Claim Button Action
if (claimConfirmBtn) {
  claimConfirmBtn.addEventListener("click", async () => {
    if (!selectedClaimDocId) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      window.location.href = "login.html";
      return;
    }
    if (currentUserBanned) {
      showNotification("Your account is restricted and can't borrow items. Contact an admin.", "error");
      return;
    }
    if (await emailGateBlocks(currentUser)) { showNotification(VERIFY_MSG, "error"); return; }

    const dueInput = document.getElementById("claim-due-input");
    const dueAt = dueInput && dueInput.value ? new Date(dueInput.value + "T18:00:00") : new Date(Date.now() + 3 * 864e5);
    const amountInput = document.getElementById("claim-amount-input");
    // Whole units only — you can't borrow a fraction of an item.
    let claimAmount = amountInput ? Math.round(parseFloat(amountInput.value)) : 1;
    if (!Number.isFinite(claimAmount) || claimAmount < 1) claimAmount = 1;

    claimConfirmBtn.disabled = true;
    const itemRef = doc(db, "items", selectedClaimDocId);

    try {
      // Run the read-check-write as a transaction so two people borrowing the
      // last item(s) at the same time can't both succeed (no overselling)
      // and so the listing only closes once quantity actually hits zero.
      const result = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(itemRef);
        if (!snap.exists()) throw new Error("This item no longer exists.");

        const data = snap.data();
        if (data.userId === currentUser.uid) {
          throw new Error("You can't borrow your own item.");
        }

        const qty = getQuantityInfo(data);
        if (data.status === "claimed" || qty.available <= 0) {
          throw new Error("This item is no longer available.");
        }

        const amount = Math.min(claimAmount, qty.available);
        const newAvailable = qty.available - amount;

        transaction.update(itemRef, {
          quantityTotal: qty.total,
          quantityAvailable: newAvailable,
          quantityUnit: qty.unit,
          // Keep the post active while stock remains; only close it out
          // once every unit has been claimed.
          status: newAvailable <= 0 ? "claimed" : "available",
          claimedBy: currentUser.uid,
          claimedByName: currentUser.displayName || currentUser.email.split('@')[0],
          claimedAt: serverTimestamp(),
          claims: arrayUnion({
            uid: currentUser.uid,
            name: currentUser.displayName || currentUser.email.split('@')[0],
            amount,
            claimedAt: new Date(),
            dueAt
          })
        });

        return { amount, remaining: newAvailable, unit: qty.unit, posterUid: data.userId, itemTitle: data.title };
      });

      // Let the lender know their item was borrowed — surfaced as a popup /
      // bell notification next time they're on the site.
      notifyPosterOfClaim({
        posterUid: result.posterUid,
        itemId: selectedClaimDocId,
        itemTitle: result.itemTitle,
        claimerUid: currentUser.uid,
        claimerName: currentUser.displayName || currentUser.email.split('@')[0],
        amount: result.amount,
        unit: result.unit,
      });

      sessionStorage.setItem('active_claim_item', selectedClaimDocId);
      closeClaimModal();
      showNotification(
        `Borrowed ${result.amount} ${result.unit}! Opening your chat with the lender...`,
        "success"
      );

      setTimeout(() => {
        window.location.href = "chat.html";
      }, 1000);
    } catch (err) {
      console.error("Error borrowing item:", err);
      const isPermissionDenied = err && (err.code === "permission-denied" || /permission/i.test(err.message || ""));
      showNotification(
        isPermissionDenied
          ? "Couldn't borrow this item — it may have changed since this page loaded. Try refreshing."
          : (err.message || "Failed to borrow item. Try again."),
        "error"
      );
    } finally {
      claimConfirmBtn.disabled = false;
    }
  });
}

// --- STANDALONE LIVE STATS ---
// Home-page numbers: items listed, items currently out on loan, members who
// have taken part, and open borrow requests.
async function fetchLiveStats() {
  if (!document.getElementById("stat-items-listed")) return; // only the home page shows these
  try {
    // Fast path: one cached summary (kept current by the Cloud Function).
    const summary = await loadRankData();
    if (summary && summary.home) {
      const h = summary.home;
      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      setStat("stat-items-listed", h.items); setStat("stat-active-borrows", h.borrows);
      setStat("stat-active-members", h.members); setStat("stat-open-requests", h.requests);
      try { sessionStorage.setItem("borrowa_home_stats", JSON.stringify(h)); } catch (e) {}
      return;
    }
  } catch (e) { /* fall through to the direct count below */ }
  try {
    const snapshot = await getDocs(collection(db, "items"));
    const totalItems = snapshot.size;

    const uniqueUsers = new Set();
    let activeBorrows = 0;

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.userId) uniqueUsers.add(data.userId);
      (data.claims || []).forEach((c) => { if (c && c.uid) uniqueUsers.add(c.uid); });
      if (data.status === "claimed") activeBorrows += 1;
    });

    let openRequests = 0;
    try {
      const reqSnapshot = await getDocs(collection(db, "borrowRequests"));
      reqSnapshot.forEach((r) => {
        const d = r.data();
        if (d.userId) uniqueUsers.add(d.userId);
        if ((d.status || "open") === "open") openRequests += 1;
      });
    } catch (e) {
      openRequests = 0;
    }

    const itemsEl = document.getElementById("stat-items-listed");
    const borrowsEl = document.getElementById("stat-active-borrows");
    const membersEl = document.getElementById("stat-active-members");
    const requestsEl = document.getElementById("stat-open-requests");

    if (itemsEl) itemsEl.innerText = totalItems;
    if (borrowsEl) borrowsEl.innerText = activeBorrows;
    if (membersEl) membersEl.innerText = uniqueUsers.size;
    if (requestsEl) requestsEl.innerText = openRequests;

    // "Instant stats" cache so the next page view can paint last-known
    // numbers immediately (see the inline script in home.html).
    try {
      sessionStorage.setItem("borrowa_home_stats", JSON.stringify({
        items: totalItems,
        borrows: activeBorrows,
        members: uniqueUsers.size,
        requests: openRequests,
      }));
    } catch (e) {
      // sessionStorage can throw in some private-browsing modes — skip.
    }
  } catch (err) {
    console.error("Error fetching stats:", err);
  }
}

fetchLiveStats();

// Authentication UI tracking & Admin Dashboard Button Handler
onAuthStateChanged(auth, async (user) => {
  // Kick off the listings right away (auth is known now) instead of after
  // the profile / admin / IP checks below, which used to delay the first paint.
  loadItems();
  if (logoutBtn) logoutBtn.style.display = user ? "inline-block" : "none";
  // Guests can't lend, so don't offer it: show log in / sign up instead.
  if (navPostBtn) navPostBtn.textContent = user ? "+ Lend item" : "Log in / Sign up";
  if (heroPostBtn) heroPostBtn.textContent = user ? "Lend an item" : "Sign up to lend";

  const navContainer = document.querySelector(".nav-links") || document.querySelector(".nav");
  let adminBtn = document.getElementById("nav-admin-dashboard-btn");

  if (user) {
    refreshPushToken(user).catch(() => {}); // quietly keep this phone's alert token fresh
    const isAdmin = await isAdminUser(user);
    currentUserIsAdmin = !!isAdmin;
    syncAdminStyleBox();

    if (isAdmin && navContainer && !adminBtn) {
      adminBtn = document.createElement("a");
      adminBtn.id = "nav-admin-dashboard-btn";
      adminBtn.href = "admin.html";
      adminBtn.textContent = "Dashboard";
      adminBtn.style.cssText = "color: #14632f; text-decoration: none; font-weight: 650; background: #d3f5df; padding: 6px 12px; border-radius: 6px; display: inline-flex; align-items: center;";
      navContainer.appendChild(adminBtn);
    } else if (!isAdmin && adminBtn) {
      adminBtn.remove();
    }

    // Remember ban state so lending/borrowing/chat can be blocked gracefully,
    // and publish this browser's end-to-end-encryption public key early so
    // anyone opening a chat with this user can encrypt to them right away.
    initE2ee(user.uid);

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userData = userSnap.exists() ? userSnap.data() : {};
      currentUserBanned = !!userData.banned;
      // Moderators (rank given by an admin) get a link to the report-review page. Admins already have the Dashboard.
      const isMod = userData.rank === "moderator" && !userData.banned && !isAdmin;
      let modBtn = document.getElementById("nav-moderator-btn");
      if (isMod && navContainer && !modBtn) {
        modBtn = document.createElement("a");
        modBtn.id = "nav-moderator-btn";
        modBtn.href = "moderator.html";
        modBtn.textContent = "Moderation";
        modBtn.style.cssText = "color: #fff; text-decoration: none; font-weight: 650; background: linear-gradient(135deg,#3730a3,#0e7490); padding: 6px 12px; border-radius: 6px; display: inline-flex; align-items: center;";
        navContainer.appendChild(modBtn);
      } else if (!isMod && modBtn) {
        modBtn.remove();
      }
      const navName = userData.name || user.displayName || (user.email || "").split("@")[0];
      renderNavProfileButton({ name: navName });
      saveNavCache({ name: navName, admin: !!isAdmin, mod: isMod, tierKey: "none", points: 0 });
      // Add the member's rank tier to the menu once points are worked out.
      loadRankData().then(({ members }) => {
        const me = members.get(user.uid);
        renderNavProfileButton({ name: navName, tier: me ? me.tier : TIERS[0], points: me ? me.points : 0 });
        saveNavCache({ name: navName, admin: !!isAdmin, mod: isMod, tierKey: me ? me.tier.key : "none", points: me ? me.points : 0 });
      }).catch(() => {});
      if (currentUserBanned) {
        showNotification("Your account has been restricted by an admin. You can browse, but can't lend, borrow, or chat.", "error");
      }

      // IP ban re-check: catches a session that was already open when an
      // admin banned its network, not just fresh logins (auth.js handles
      // the fresh-login case). Best-effort — see js/ip-guard.js for why
      // this can't be a hard guarantee in a client-only app.
      const ip = await recordLoginIp(user.uid);
      if (ip && await isIpBanned(ip)) {
        showNotification("This device/network has been blocked by an admin. Signing you out...", "error");
        setTimeout(async () => {
          await forgetPushOnThisDevice();
          await signOut(auth);
          window.location.href = "login.html?blocked=ip";
        }, 1200);
        return;
      }
    } catch (e) {
      console.warn("Failed to load profile:", e);
    }
  } else {
    currentUserIsAdmin = false;
    syncAdminStyleBox();
    if (adminBtn) adminBtn.remove();
    clearNavCache();
    const slot = document.getElementById("nav-profile-slot");
    if (slot) { slot.style.display = "none"; slot.innerHTML = ""; }
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    clearNavCache();
    await forgetPushOnThisDevice();
    await signOut(auth);
    window.location.href = "login.html";
  });
}

// Handle Posting / Updating Items
let isSubmitting = false;

if (postItemForm) {
  postItemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!auth.currentUser) {
      showNotification("Log in or sign up to lend an item.", "error");
      return;
    }
    if (currentUserBanned) {
      showNotification("Your account is restricted and can't lend items. Contact an admin.", "error");
      return;
    }
    if (auth.currentUser && await emailGateBlocks(auth.currentUser)) { showNotification(VERIFY_MSG, "error"); return; }
    isSubmitting = true;

    const submitBtn = postItemForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";
    }

    const formData = new FormData(postItemForm);
    const currentUser = auth.currentUser;

    try {
      const category = formData.get("category");
      const quantityUnit = formData.get("quantityUnit") || "units";
      // Quantities are always whole units — round and floor at 1 so the
      // amount can never dip into fractions like 0.1.
      const quantityTotal = Math.max(1, Math.round(parseFloat(formData.get("quantityAmount"))));

      // Best-effort location capture (see js/geo.js) — lets the home page
      // show listings "near you". Skipped silently if not allowed.
      const postLocation = editingDocId ? undefined : await getCurrentPositionSafe();

      // Photo (optional) — shrunk in the browser and saved in Firestore (itemPhotos),
      // not Firebase Storage. Only saved when a new file was actually chosen; editing an
      // item without touching the photo field leaves the existing photo (if
      // any) untouched via editingPhotoURL.
      const legacyUrl = editingPhotoURL && /^https:/.test(editingPhotoURL) ? editingPhotoURL : null;
      let photoData = null;
      const chosenPhoto = postPhotoInput && postPhotoInput.files && postPhotoInput.files[0];
      if (chosenPhoto && currentUser) {
        if (submitBtn) submitBtn.textContent = "Preparing photo...";
        photoData = await compressPhoto(chosenPhoto);   // shrunk in the browser; saved in itemPhotos, not on the listing
        if (submitBtn) submitBtn.textContent = "Saving...";
      }

      const cleanTitle = capFirst(formData.get("title"));
      if (!cleanTitle) { showNotification("Please enter a name for the item.", "error"); return; }

      // Admin-only extras: the Admin rank + custom colours (firestore.rules refuse these from anyone else).
      let adminExtra = {};
      let adminStyleOn = false;
      let adminStyle = null;
      if (currentUserIsAdmin && currentUser) {
        adminStyleOn = !!(document.getElementById("admin-style-on") || {}).checked;
        adminStyle = adminStyleOn ? cleanPostStyle({
          bg: formData.get("styleBg"), bg2: formData.get("styleBg2"), angle: formData.get("styleAngle"),
          border: formData.get("styleBorder"), title: formData.get("styleTitle"), text: formData.get("styleText"),
        }) : null;
      }

      const itemPayload = {
        title: cleanTitle,
        category,
        condition: formData.get("condition"),
        quantityTotal,
        quantityUnit,
        quantity: `${quantityTotal} ${quantityUnit}`, // kept for legacy/display compatibility
        pickupLocation: formData.get("pickupLocation"),
        description: formData.get("description") || "",
        photoURL: legacyUrl,
        hasPhoto: !!(photoData || legacyUrl || editingHasPhoto),
        // How long the lender is happy for it to be borrowed.
        borrowPeriod: formData.get("borrowPeriod") || "1 week"
      };

      if (editingDocId) {
        // Preserve whatever is already out on loan: shrink/grow the
        // available count with the total instead of resetting it, so an
        // edit never re-opens units that were already claimed away.
        const existingSnap = await getDoc(doc(db, "items", editingDocId));
        const existingData = existingSnap.exists() ? existingSnap.data() : {};
        const existingQty = getQuantityInfo(existingData);
        const claimedSoFar = existingQty.total - existingQty.available;
        const newAvailable = Math.max(0, quantityTotal - claimedSoFar);

        if (currentUserIsAdmin && existingData.userId === currentUser.uid) {
          adminExtra = { adminPost: true, postStyle: adminStyle ? adminStyle : deleteField() };
        }

        const editBatch = writeBatch(db);
        editBatch.update(doc(db, "items", editingDocId), {
          ...itemPayload,
          ...adminExtra,
          quantityAvailable: newAvailable,
          status: newAvailable <= 0 ? "claimed" : "available",
          updatedAt: serverTimestamp()
        });
        if (photoData) editBatch.set(doc(db, "itemPhotos", editingDocId), { ownerId: currentUser.uid, data: photoData });
        await editBatch.commit();
        showNotification("Listing updated! ✏️", "success");
      } else {
        // New-account limit (see firestore.rules): max 3 listings in the first 24h.
        const NEW_ACCOUNT_LIMIT = 3;
        const counterRef = doc(db, "postCounts", currentUser.uid);
        const counterSnap = await getDoc(counterRef);
        const posted = counterSnap.exists() ? counterSnap.data().n : 0;
        const created = new Date(currentUser.metadata.creationTime).getTime();
        if (!DEV_MODE && !isTester(currentUser) && Date.now() - created < 864e5 && posted >= NEW_ACCOUNT_LIMIT) {
          const freeAt = new Date(created + 864e5).toLocaleString();
          showNotification(`New accounts can post ${NEW_ACCOUNT_LIMIT} listings in their first 24 hours. You can post more after ${freeAt}.`, "error");
          return;
        }
        const batch = writeBatch(db);
        batch.set(counterRef, { n: posted + 1 });
        const newItemRef = doc(collection(db, "items"));
        if (photoData) batch.set(doc(db, "itemPhotos", newItemRef.id), { ownerId: currentUser.uid, data: photoData });
        if (currentUserIsAdmin) {
          adminExtra = { adminPost: true };
          if (adminStyle) adminExtra.postStyle = adminStyle;
        }
        batch.set(newItemRef, {
          ...itemPayload,
          ...adminExtra,
          quantityAvailable: quantityTotal,
          status: "available",
          userId: currentUser ? currentUser.uid : "anonymous",
          userName: currentUser ? String(currentUser.displayName || currentUser.email.split("@")[0]).slice(0, 60) : "Neighbor",
          claimedBy: null,
          claimedByName: null,
          location: postLocation || null,
          createdAt: serverTimestamp(),
          expiresAt: new Date(Date.now() + (category === "Misc" && /food|meal|snack|biryani|lunch|dinner/i.test(String(formData.get("title") || "")) ? 2 * 36e5 : 5 * 864e5)),
        });
        await batch.commit();

        showNotification("Your item is listed for neighbors to borrow! 🎉", "success");
      }

      closeModal();
      fetchLiveStats();
      loadItems();
    } catch (err) {
      console.error("Error saving item:", err);
      showNotification(err && err.code === "permission-denied" ? "Couldn't post. Verify your email first, and note new accounts can post 3 listings in their first 24 hours." : "Error saving item.", "error");
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = editingDocId ? "Save changes" : "List item";
      }
    }
  });
}

// Category Filter Click Handling
document.addEventListener("click", (e) => {
  const categoryBtn = e.target.closest("[data-category], .filter-chip");
  if (categoryBtn) {
    currentCategory = categoryBtn.getAttribute("data-category") || categoryBtn.textContent.trim();
    
    document.querySelectorAll(".filter-chip").forEach(btn => {
      const btnCat = btn.getAttribute("data-category");
      if (btnCat && btnCat.toLowerCase() === currentCategory.toLowerCase()) {
        btn.style.backgroundColor = "#14632f";
        btn.style.color = "#ffffff";
        btn.style.borderColor = "#14632f";
      } else {
        btn.style.backgroundColor = "#ffffff";
        btn.style.color = "#374151";
        btn.style.borderColor = "#d5e3da";
      }
    });

    loadItems();
  }
});

// Toast notification helper
function showNotification(message, type = "success") {
  const existing = document.getElementById("toast-notification");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast-notification";
  toast.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 99999;
    padding: 16px 24px; border-radius: 10px; font-size: 15px; font-weight: 600;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); text-align: center;
    max-width: min(90vw, 480px); line-height: 1.4;
    background: ${type === "success" ? "#f1f6f2" : "#fef2f2"};
    color: ${type === "success" ? "#14632f" : "#991b1b"};
    border: 1px solid ${type === "success" ? "#cfe3d4" : "#fecaca"};
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Lender rank data, used to style each item card by the lender's tier.
let rankMembers = new Map();
let rankReady = false;

// Core function to load items with fail-safe error rendering
async function loadItems() {
  if (!itemGrid) return;
  
  try {
    // Rank styling never holds up the listings: use what we already know,
    // and if we know nothing yet, fetch it in the background and re-render once.
    const knownRanks = peekRankData();
    if (knownRanks) { rankMembers = knownRanks.members; rankReady = true; }
    else if (!rankReady) {
      rankReady = true;
      loadRankData().then((d) => { rankMembers = d.members; loadItems(); }).catch(() => {});
    }
    let snapshot;
    try {
      const q = query(collection(db, "items"), orderBy("createdAt", "desc"));
      snapshot = await getDocs(q);
    } catch (indexError) {
      console.warn("Index warning detected, falling back to unordered fetch:", indexError);
      snapshot = await getDocs(collection(db, "items"));
    }

    // Expiry without Cloud Functions: hide lapsed listings that nobody has borrowed,
    // and let the owner's browser delete their own lapsed ones.
    {
      const nowMs = Date.now(), meUid = auth.currentUser ? auth.currentUser.uid : null;
      const live = [];
      snapshot.docs.forEach((d) => {
        const x = d.data(), exp = x.expiresAt && x.expiresAt.toMillis ? x.expiresAt.toMillis() : 0;
        const inUse = (x.claims && x.claims.length) || x.claimedBy;
        if (exp && exp < nowMs && !inUse) {
          if (meUid && x.userId === meUid) { deleteDoc(d.ref).catch(() => {}); if (x.hasPhoto) deleteDoc(doc(db, "itemPhotos", d.id)).catch(() => {}); }
          return;
        }
        live.push(d);
      });
      snapshot = { docs: live, empty: live.length === 0, size: live.length, forEach: (f) => live.forEach(f) };
      // In-app return reminder for the signed-in borrower (no email/Functions needed).
      document.getElementById("due-banner")?.remove();
      const due = [];
      live.forEach((d) => (d.data().claims || []).forEach((c) => {
        const t = c.dueAt && c.dueAt.toMillis ? c.dueAt.toMillis() : 0;
        if (meUid && c.uid === meUid && t && t < nowMs + 864e5) due.push({ title: d.data().title, t });
      }));
      if (due.length) {
        const b = document.createElement("div");
        b.id = "due-banner";
        b.style.cssText = "background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:10px;padding:10px 14px;margin:0 0 14px;font-size:14px;";
        b.textContent = "⏰ " + due.map((x) => `${x.title}: ${x.t < nowMs ? "overdue" : "due " + new Date(x.t).toLocaleDateString()}`).join(" · ");
        itemGrid.parentNode.insertBefore(b, itemGrid);
      }
    }
    itemGrid.innerHTML = "";

    if (snapshot.empty) {
      itemGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #666; padding: 40px;">Nothing listed yet. Be the first to lend something!</p>`;
      return;
    }

    const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const myItemsList = [];
    const communityItemsList = [];

    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const docId = docSnap.id;

      const title = (item.title || "").toLowerCase();
      const description = (item.description || "").toLowerCase();
      const category = (item.category || "").toLowerCase();

      const location = (item.pickupLocation || "").toLowerCase();
      const matchesSearch = !searchTerm || title.includes(searchTerm) || description.includes(searchTerm) || location.includes(searchTerm) || category.includes(searchTerm);
      const matchesCategory = currentCategory === "All" || category === currentCategory.toLowerCase();

      if (!matchesSearch || !matchesCategory) return;

      const isOwner = currentUserId && item.userId === currentUserId;
      if (isOwner) {
        myItemsList.push({ docId, item, isOwner });
      } else {
        communityItemsList.push({ docId, item, isOwner });
      }
    });

    // Split everyone else's listings into "within 1km" and "rest of the
    // community" using the viewer's live browser location vs. each item's
    // stored post location. This is best-effort and fails open: if the
    // viewer never granted location, or an item has no stored location
    // (e.g. an older listing), it simply falls into the community bucket
    // instead of blocking anything.
    let viewerLocation = peekViewerLocation();
    if (viewerLocation === undefined) { viewerLocation = null; warmViewerLocation(); }
    const nearbyItemsList = [];
    const widerCommunityList = [];

    communityItemsList.forEach((entry) => {
      const itemLocation = entry.item.location;
      const distance = viewerLocation && itemLocation ? distanceMeters(viewerLocation, itemLocation) : null;
      entry.distanceMeters = distance;
      if (distance !== null && distance <= NEARBY_RADIUS_METERS) {
        nearbyItemsList.push(entry);
      } else {
        widerCommunityList.push(entry);
      }
    });

    // Nearby items sort closest-first. Everything else stays newest-first.
    nearbyItemsList.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));

    if (myItemsList.length === 0 && nearbyItemsList.length === 0 && widerCommunityList.length === 0) {
      itemGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #666; padding: 40px;">No items match your search or category.</p>`;
      return;
    }

    if (myItemsList.length > 0) {
      const mySection = document.createElement("div");
      mySection.style.cssText = "margin-bottom: 36px; width: 100%; grid-column: 1 / -1;";
      mySection.innerHTML = `
        <h2 style="font-size: 20px; font-weight: 700; color: #14632f; margin-bottom: 16px; border-bottom: 2px solid #cfe3d4; padding-bottom: 8px;">
          📦 My Listings (${myItemsList.length})
        </h2>
        <div id="my-subgrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;"></div>
      `;
      itemGrid.appendChild(mySection);
      const mySubgrid = mySection.querySelector("#my-subgrid");
      myItemsList.forEach(({ docId, item, isOwner }) => {
        mySubgrid.appendChild(createItemCard(docId, item, isOwner));
      });
    }

    if (nearbyItemsList.length > 0) {
      const nearbySection = document.createElement("div");
      nearbySection.style.cssText = "margin-bottom: 36px; width: 100%; grid-column: 1 / -1;";
      nearbySection.innerHTML = `
        <h2 style="font-size: 20px; font-weight: 700; color: #0369a1; margin-bottom: 16px; border-bottom: 2px solid #bae6fd; padding-bottom: 8px;">
          📍 Near You — within 1km (${nearbyItemsList.length})
        </h2>
        <div id="nearby-subgrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;"></div>
      `;
      itemGrid.appendChild(nearbySection);
      const nearbySubgrid = nearbySection.querySelector("#nearby-subgrid");
      nearbyItemsList.forEach(({ docId, item, isOwner, distanceMeters }) => {
        nearbySubgrid.appendChild(createItemCard(docId, item, isOwner, distanceMeters));
      });
    } else if (!viewerLocation) {
      const nearbyNote = document.createElement("div");
      nearbyNote.style.cssText = "margin-bottom: 24px; width: 100%; grid-column: 1 / -1; font-size: 13px; color: #6b7280; background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 8px; padding: 12px 16px;";
      nearbyNote.textContent = "📍 Enable location access in your browser to see items listed within 1km of you.";
      itemGrid.appendChild(nearbyNote);
    }

    if (widerCommunityList.length > 0) {
      const commSection = document.createElement("div");
      commSection.style.cssText = "width: 100%; grid-column: 1 / -1;";
      commSection.innerHTML = `
        <h2 style="font-size: 20px; font-weight: 700; color: #1f2937; margin-bottom: 16px; border-bottom: 2px solid #d5e3da; padding-bottom: 8px;">
          🌍 All Items to Borrow (${widerCommunityList.length})
        </h2>
        <div id="comm-subgrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;"></div>
      `;
      itemGrid.appendChild(commSection);
      const commSubgrid = commSection.querySelector("#comm-subgrid");
      widerCommunityList.forEach(({ docId, item, isOwner, distanceMeters }) => {
        commSubgrid.appendChild(createItemCard(docId, item, isOwner, distanceMeters));
      });
    }

    mountPushPrompt(); // one-time "turn on phone alerts" card (no-op until VAPID key is set)
  } catch (e) {
    console.error("Critical error loading items:", e);
    // Overwrite the loading text so the user sees a clear error message instead of freezing
    itemGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #dc2626; padding: 40px;">Failed to load items. Check your internet connection or Firebase Console rules.</p>`;
  }
}

// Formats a distance in meters as a short human label, e.g. "450 m away"
// or "3.2 km away". Returns "" when distance is null/unknown so callers
// can safely drop it into a template without an extra branch.
function formatDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined) return "";
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m away`;
  return `${(distanceMeters / 1000).toFixed(1)} km away`;
}

function createItemCard(docId, item, isOwner, distanceMeters = null) {
  docId = String(docId).replace(/[^A-Za-z0-9_-]/g, "");
  const card = document.createElement("div");
  card.className = "item-card";
  card.style.cssText = "position: relative; z-index: 5;";

  const qty = getQuantityInfo(item);
  // A listing stays open for borrowing as long as any units remain — it
  // shows as "Borrowed" once quantityAvailable reaches 0 (or an admin
  // force-closes it directly via the status field).
  const isAvailable = item.status !== "claimed" && qty.available > 0;

  const ownerMember = rankMembers.get(item.userId);
  const ownerTier = ownerMember ? ownerMember.tier : TIERS[0];

  const hasPhoto = !!(item.hasPhoto || safeImageUrl(item.photoURL));
  const photoHtml = hasPhoto
    ? `<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">📷 Photo · tap to view</div>`
    : "";

  // Admin posts show the Admin rank (never a points tier) and may carry the
  // admin's own colours. Everyone else gets their normal rank styling.
  const isAdminPost = item.adminPost === true;
  const ps = isAdminPost ? cleanPostStyle(item.postStyle) : null;
  const accent = (ps && ps.border) || (isAdminPost ? ADMIN_STYLE_DEFAULTS.border : "#1f8a47");
  const titleColor = (ps && ps.title) || ADMIN_STYLE_DEFAULTS.title;
  const bodyColor = (ps && ps.text) || "";
  const cardLook = isAdminPost
    ? `background: ${postBgCss(ps) || "linear-gradient(160deg,#fff 40%,#e6f6ec 100%)"}; border: 2px solid ${accent}; box-shadow: 0 6px 18px rgba(20,99,47,.22);`
    : (ownerTier.key !== "none" ? `background: ${ownerTier.card}; border: 2px solid ${ownerTier.border}; box-shadow: ${ownerTier.glow};` : "");
  const descColor = bodyColor || "#4b5563";
  const infoColor = bodyColor || "#6b7280";
  const rankLine = isAdminPost
    ? `<div style="margin-bottom: 10px;">${adminBadgeHtml(true)} <span style="font-size: 11px; color: ${infoColor}; margin-left: 4px;">lender</span></div>`
    : (ownerTier.key !== "none" ? `<div style="margin-bottom: 10px;">${tierBadgeHtml(ownerTier, true)} <span style="font-size: 11px; color: #6b7280; margin-left: 4px;">lender</span></div>` : "");

  card.innerHTML = `
    <div class="rank-card rank-card-${isAdminPost ? "admin" : ownerTier.key}" style="padding: 20px; border-radius: 12px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; ${cardLook}">
      <div>
        ${rankLine}
        ${itemArtHtml(item)}
        ${photoHtml}
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; gap: 8px; flex-wrap: wrap;">
          <div style="display:flex; gap:6px; align-items:center; flex-wrap: wrap;">
            <span style="background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;">${escapeHtml(item.category || "General")}</span>
            <a href="report.html?type=item&id=${encodeURIComponent(docId)}" title="Report this listing" style="font-size:12px;font-weight:600;color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;padding:3px 9px;border-radius:999px;text-decoration:none;margin-left:auto;">🚩 Report</a>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 4px; background: ${isAvailable ? '#f1f6f2' : '#fef2f2'}; color: ${isAvailable ? '#14632f' : '#991b1b'};">
              ${isAvailable ? (qty.total > 1 ? `${qty.available} of ${qty.total} available` : 'Available') : 'Borrowed'}
            </span>
            <div class="owner-actions-${docId}" style="display: flex; gap: 6px;"></div>
          </div>
        </div>
        <h3 class="item-title" style="color: ${isAdminPost ? titleColor : ""}; --accent: ${accent};">${escapeHtml(capFirst(item.title))}</h3>
        <p style="color: ${descColor}; font-size: 14px; margin-bottom: 14px; line-height: 1.4;">${escapeHtml(item.description || "No description provided.")}</p>
      </div>
      <div>
        <div style="font-size: 13px; color: ${infoColor}; border-top: 1px solid rgba(0,0,0,0.06); margin-top: 12px; padding-top: 12px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px;">
          <span>📍 <strong>Pickup:</strong> ${escapeHtml(item.pickupLocation)}${distanceMeters !== null ? ` · <strong>${formatDistance(distanceMeters)}</strong>` : ""}</span>
          <span>✨ <strong>Condition:</strong> ${escapeHtml(item.condition)}</span>
          <span>🔢 <strong>Quantity:</strong> ${qty.available} / ${qty.total} ${escapeHtml(qty.unit)} available</span>
          <span>⏳ <strong>Borrow for:</strong> up to ${escapeHtml(item.borrowPeriod || "a week")}</span>
        </div>
        <div class="card-action-footer-${docId}"></div>
      </div>
    </div>
  `;

  const footerActionContainer = card.querySelector(`.card-action-footer-${docId}`);

  if (isOwner) {
    const actionsContainer = card.querySelector(`.owner-actions-${docId}`);
    
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.style.cssText = "background: #f1f6f2; color: #14632f; border: 1px solid #cfe3d4; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600;";
    editBtn.addEventListener("click", async () => {
      const docSnap = await getDoc(doc(db, "items", docId));
      if (docSnap.exists()) openModal({ id: docSnap.id, ...docSnap.data() });
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.confirmState = "false";
    deleteBtn.style.cssText = "background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600;";

    deleteBtn.addEventListener("click", async () => {
      if (deleteBtn.dataset.confirmState === "false") {
        deleteBtn.dataset.confirmState = "true";
        deleteBtn.textContent = "Confirm?";
        deleteBtn.style.backgroundColor = "#dc2626";
        deleteBtn.style.color = "#ffffff";
        setTimeout(() => {
          if (deleteBtn.dataset.confirmState === "true") {
            deleteBtn.dataset.confirmState = "false";
            deleteBtn.textContent = "Delete";
            deleteBtn.style.backgroundColor = "#fef2f2";
            deleteBtn.style.color = "#991b1b";
          }
        }, 3000);
        return;
      }

      try {
        const delBatch = writeBatch(db);
        delBatch.delete(doc(db, "items", docId));
        if (item.hasPhoto) delBatch.delete(doc(db, "itemPhotos", docId));
        await delBatch.commit();
        showNotification("Item deleted successfully! 🗑️", "success");
        fetchLiveStats();
        loadItems();
      } catch (e) {
        showNotification("Delete failed.", "error");
      }
    });

    actionsContainer.appendChild(editBtn);
    actionsContainer.appendChild(deleteBtn);

    // Show "Mark as Returned" whenever any unit is out, not only when every unit is.
    if (item.status === "claimed" || qty.available < qty.total) {
      const unclaimBtn = document.createElement("button");
      unclaimBtn.textContent = "Mark as Returned";
      unclaimBtn.style.cssText = "background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600;";
      unclaimBtn.addEventListener("click", async () => {
        if (!confirm("Confirm the borrower gave this back? It will be listed as available again, and the loan counts toward both of your leaderboard points.")) {
          return;
        }
        unclaimBtn.disabled = true;
        try {
          // Re-read the item first so the reset is based on current data
          // (e.g. quantityTotal) rather than a possibly-stale card.
          const freshSnap = await getDoc(doc(db, "items", docId));
          if (!freshSnap.exists()) {
            showNotification("This listing no longer exists.", "error");
            return;
          }
          await updateDoc(doc(db, "items", docId), buildReturnUpdate(freshSnap.data()));
          showNotification("Marked as returned. It's available to borrow again. ↩️", "success");
          fetchLiveStats();
          loadItems();
        } catch (e) {
          console.error("Failed to reopen listing:", e);
          showNotification("Couldn't update the listing.", "error");
        } finally {
          unclaimBtn.disabled = false;
        }
      });
      actionsContainer.appendChild(unclaimBtn);

      if (item.claimedBy) {
        const chatBtn = document.createElement("button");
        chatBtn.textContent = "💬 Chat";
        chatBtn.style.cssText = "background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 600;";
        chatBtn.addEventListener("click", async () => {
          chatBtn.disabled = true;
          try {
            const chatId = await getOrCreateChat(docId, item.title, item.claimedBy, item.claimedByName || "Neighbor");
            window.location.href = `chat.html?id=${encodeURIComponent(chatId)}`;
          } catch (e) {
            console.error("Failed to open chat:", e);
            showNotification("Couldn't open chat.", "error");
          } finally {
            chatBtn.disabled = false;
          }
        });
        actionsContainer.appendChild(chatBtn);
      }
    }

    footerActionContainer.innerHTML = `<button class="btn btn-outline btn-sm" disabled style="width: 100%; opacity: 0.6; cursor: not-allowed;">Your Listing</button>`;
  } else if (isAvailable) {
    const borrowBtn = document.createElement("button");
    borrowBtn.className = "btn btn-primary btn-sm";
    borrowBtn.textContent = "View details & borrow";
    borrowBtn.style.width = "100%";
    borrowBtn.addEventListener("click", () => openItemDetails(docId, item, isOwner, distanceMeters));
    footerActionContainer.appendChild(borrowBtn);
  } else if (auth.currentUser && item.claimedBy === auth.currentUser.uid) {
    const chatBtn = document.createElement("button");
    chatBtn.className = "btn btn-primary btn-sm";
    chatBtn.style.width = "100%";
    chatBtn.textContent = "💬 Chat with lender";
    chatBtn.addEventListener("click", async () => {
      chatBtn.disabled = true;
      try {
        const posterName = item.userName || ((item.userEmail && item.userEmail !== "anonymous") ? item.userEmail.split("@")[0] : "Neighbor");
        const chatId = await getOrCreateChat(docId, item.title, item.userId, posterName);
        window.location.href = `chat.html?id=${encodeURIComponent(chatId)}`;
      } catch (e) {
        console.error("Failed to open chat:", e);
        showNotification("Couldn't open chat.", "error");
      } finally {
        chatBtn.disabled = false;
      }
    });
    footerActionContainer.appendChild(chatBtn);
  } else {
    footerActionContainer.innerHTML = `<button class="btn btn-outline btn-sm" disabled style="width: 100%; opacity: 0.6; cursor: not-allowed;">Currently Borrowed</button>`;
  }

  card.style.cursor = "pointer";
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select, textarea")) return;
    openItemDetails(docId, item, isOwner, distanceMeters);
  });
  return card;
}

// Enlarged details popup. The photo is only fetched here, when someone opens a listing,
// so Browse stays fast no matter how many listings have photos.
function openItemDetails(docId, item, isOwner, distanceMeters) {
  document.getElementById("item-detail-overlay")?.remove();
  const qty = getQuantityInfo(item);
  const isAvailable = item.status !== "claimed" && qty.available > 0;
  const tier = (rankMembers.get(item.userId) || {}).tier || TIERS[0];
  const isAdminPost = item.adminPost === true;
  const ps = isAdminPost ? cleanPostStyle(item.postStyle) : null;
  const accent = (ps && ps.border) || (isAdminPost ? ADMIN_STYLE_DEFAULTS.border : "#1f8a47");
  const lender = item.userName || "Neighbor";
  const exp = item.expiresAt && item.expiresAt.toDate ? item.expiresAt.toDate().toLocaleString() : "";
  const row = (icon, label, val) => `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f2;font-size:14px;"><span>${icon}</span><span style="color:#6b7280;min-width:92px;">${label}</span><strong style="flex:1;color:#111;">${val}</strong></div>`;
  const o = document.createElement("div");
  o.id = "item-detail-overlay";
  o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9000;padding:14px;";
  o.innerHTML = `<div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;width:100%;max-width:640px;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:18px 20px 8px;">
      <div><div style="font-size:12px;font-weight:600;color:#0369a1;">${escapeHtml(item.category || "General")}</div>
      <h2 class="item-title" style="margin:2px 0 0;font-size:24px;${isAdminPost ? `color:${(ps && ps.title) || ADMIN_STYLE_DEFAULTS.title};` : ""}--accent:${accent};">${escapeHtml(capFirst(item.title))}</h2></div>
      <button id="detail-x" aria-label="Close" style="border:0;background:#f1f5f2;border-radius:50%;width:34px;height:34px;font-size:18px;cursor:pointer;">×</button>
    </div>
    <div id="detail-photo" style="margin:6px 20px 0;"></div>
    <div style="padding:10px 20px 0;">
      <span style="font-size:12px;font-weight:700;padding:4px 9px;border-radius:6px;background:${isAvailable ? "#f1f6f2" : "#fef2f2"};color:${isAvailable ? "#14632f" : "#991b1b"};">${isAvailable ? qty.available + " of " + qty.total + " " + escapeHtml(qty.unit) + " available" : "Borrowed"}</span>
      <p style="color:${(ps && ps.text) || "#374151"};line-height:1.55;margin:12px 0;white-space:pre-wrap;">${escapeHtml(item.description || "No description provided.")}</p>
      ${row("📍", "Pickup", escapeHtml(item.pickupLocation) + (distanceMeters !== null && distanceMeters !== undefined ? " · " + formatDistance(distanceMeters) : ""))}
      ${row("✨", "Condition", escapeHtml(item.condition))}
      ${row("🔢", "Quantity", qty.available + " / " + qty.total + " " + escapeHtml(qty.unit))}
      ${row("⏳", "Borrow for", "up to " + escapeHtml(item.borrowPeriod || "a week"))}
      ${row("🧑", "Lender", escapeHtml(lender) + (isAdminPost ? " " + adminBadgeHtml(true) : (tier.key !== "none" ? " " + tierBadgeHtml(tier, true) : "")))}
      ${exp ? row("🕒", "Listing ends", escapeHtml(exp)) : ""}
    </div>
    <div id="detail-actions" style="display:flex;gap:8px;flex-wrap:wrap;padding:16px 20px 20px;"></div>
  </div>`;
  document.body.appendChild(o);
  const close = () => { o.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  o.addEventListener("click", (e) => { if (e.target === o) close(); });
  o.querySelector("#detail-x").onclick = close;

  // Photo: fetched now, only because the person opened this listing.
  const photoBox = o.querySelector("#detail-photo");
  const showImg = (src) => { photoBox.innerHTML = `<img alt="${escapeHtml(item.title)}" style="width:100%;max-height:340px;object-fit:contain;background:#f1f5f2;border-radius:12px;display:block;" />`; photoBox.firstChild.src = src; };
  const legacy = safeImageUrl(item.photoURL);
  if (legacy) showImg(legacy);
  else if (item.hasPhoto) {
    photoBox.innerHTML = `<div style="height:140px;border-radius:12px;background:#f1f5f2;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:13px;">Loading photo…</div>`;
    getDoc(doc(db, "itemPhotos", docId)).then((ph) => {
      const src = ph.exists() ? safeImageUrl(ph.data().data) : "";
      if (src) showImg(src); else photoBox.innerHTML = `<div style="color:#9ca3af;font-size:13px;">Photo unavailable.</div>`;
    }).catch(() => { photoBox.innerHTML = `<div style="color:#9ca3af;font-size:13px;">Couldn't load the photo.</div>`; });
  }

  const actions = o.querySelector("#detail-actions");
  const btn = (label, cls, fn) => { const b = document.createElement("button"); b.className = cls; b.textContent = label; b.addEventListener("click", fn); actions.appendChild(b); return b; };
  if (isOwner) {
    btn("Edit listing", "btn btn-outline btn-sm", async () => { close(); const sn = await getDoc(doc(db, "items", docId)); if (sn.exists()) openModal({ id: sn.id, ...sn.data() }); });
    const note = document.createElement("span"); note.style.cssText = "font-size:13px;color:#6b7280;align-self:center;"; note.textContent = "This is your listing."; actions.appendChild(note);
  } else {
    if (isAvailable) btn("Borrow this item", "btn btn-primary", () => { close(); openClaimModal(docId, item); });
    btn("💬 Ask the lender", "btn btn-outline", async (e) => {
      if (!auth.currentUser) { window.location.href = "login.html"; return; }
      e.target.disabled = true;
      try { const chatId = await getOrCreateChat(docId, item.title, item.userId, lender); window.location.href = `chat.html?id=${encodeURIComponent(chatId)}`; }
      catch (err) { showNotification("Couldn't open chat.", "error"); e.target.disabled = false; }
    });
    const rep = document.createElement("a");
    rep.href = "report.html?type=item&id=" + encodeURIComponent(docId);
    rep.textContent = "🚩 Report";
    rep.style.cssText = "margin-left:auto;align-self:center;font-size:13px;font-weight:600;color:#b91c1c;text-decoration:none;";
    actions.appendChild(rep);
  }
}

// Arriving from another page's "Lend item" button (?lend=1): open the form.
if (postModalOverlay && new URLSearchParams(window.location.search).get("lend") === "1") {
  openModal();
  history.replaceState(null, "", window.location.pathname);
}

// (Listings are loaded from the onAuthStateChanged handler above, once.)

// Lender notifications: shows a popup + keeps a nav bell in sync whenever
// the signed-in user has unread "your item was borrowed" notifications.
initClaimNotifications();