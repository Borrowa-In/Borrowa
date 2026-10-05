import { auth, db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc,
  serverTimestamp, arrayUnion, increment, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getOrCreateChat } from "./chat.js";
import { getUserProfile, isAdminUser, needsVerification } from "./auth.js";
import { loadRankData, peekRankData, nameTagHtml, postLookForTier, TIERS } from "./ranks.js";

// Borrow requests: a member posts something they need, neighbors who have
// it tap "I can lend this", which records the offer and opens a chat with
// the requester. Stored in the `borrowRequests` Firestore collection.

const COLLECTION = "borrowRequests";
const MAX_OPEN_PER_USER = 5;

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showToast(message, type = "success") {
  document.getElementById("req-toast")?.remove();
  const t = document.createElement("div");
  t.id = "req-toast";
  t.style.background = type === "error" ? "#dc2626" : "#1a7a40";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3500);
}

const gridEl = document.getElementById("req-grid");
const overlay = document.getElementById("req-overlay");
const form = document.getElementById("req-form");
const submitBtn = document.getElementById("req-submit");

let currentUser = null;
let myProfile = null;
let allRequests = [];
let view = "open";

function todayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDate(str) {
  if (!str) return "";
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis() : null;
  if (!ms) return "just now";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function requireLogin() {
  if (currentUser) return true;
  window.location.href = "login.html?next=requests.html";
  return false;
}

// ---------- Loading + rendering ----------
async function loadRequests() {
  try {
    const snap = await getDocs(query(collection(db, COLLECTION), orderBy("createdAt", "desc")));
    allRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Failed to load borrow requests:", e);
    gridEl.innerHTML = `<div class="req-empty">Couldn't load requests. Check that the Firestore rules for <b>borrowRequests</b> are published.</div>`;
    return;
  }
  render();
  ensureRanks();
}

function visibleRequests() {
  const term = (document.getElementById("req-search").value || "").trim().toLowerCase();
  const cat = document.getElementById("req-category-filter").value;
  return allRequests.filter((r) => {
    const status = r.status || "open";
    if (view === "open" && status !== "open") return false;
    if (view === "fulfilled" && status !== "fulfilled") return false;
    if (view === "mine" && (!currentUser || r.userId !== currentUser.uid)) return false;
    if (cat !== "All" && r.category !== cat) return false;
    if (term && !`${r.title} ${r.details || ""} ${r.building || ""}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

function render() {
  const list = visibleRequests();
  if (!list.length) {
    const msg = view === "mine"
      ? "You haven't posted any requests yet."
      : view === "fulfilled" ? "No fulfilled requests yet." : "No open requests right now. Be the first to ask!";
    gridEl.innerHTML = `<div class="req-empty">${msg}</div>`;
    return;
  }
  gridEl.innerHTML = "";
  list.forEach((r) => gridEl.appendChild(createCard(r)));
}

// Poster ranks, so each request card wears its poster's rank colours and name tag.
let rankMembers = new Map();
{ const known = peekRankData(); if (known) rankMembers = known.members; }
function ensureRanks() {
  loadRankData().then((d) => {
    const changed = d.members !== rankMembers;
    rankMembers = d.members;
    if (changed && allRequests.length) render();
  }).catch(() => {});
}

function createCard(r) {
  const posterTier = (rankMembers.get(r.userId) || {}).tier || TIERS[0];
  const look = postLookForTier(posterTier);
  const posterName = r.userName || "Neighbor";
  const isOwner = currentUser && r.userId === currentUser.uid;
  const status = r.status || "open";
  const offers = r.offerCount || 0;
  const alreadyOffered = currentUser && (r.offeredBy || []).includes(currentUser.uid);
  const late = status === "open" && r.neededBy && r.neededBy < todayStr();

  const card = document.createElement("div");
  card.className = "req-card" + (isOwner ? " mine" : "") + (look ? " ranked" : "");
  if (look) card.style.cssText = `background:${look.bg};color:${look.color};border:2px solid ${look.border};box-shadow:${look.glow};`;
  card.innerHTML = `
    <div class="req-card-top">
      <h3>${r.urgent && status === "open" ? "🔥 " : ""}${escapeHtml(r.title)}</h3>
      <span class="badge ${status === "fulfilled" ? "badge-fulfilled" : "badge-open"}">${status === "fulfilled" ? "Fulfilled" : "Open"}</span>
    </div>
    <div><span class="badge badge-cat">${escapeHtml(r.category || "Misc")}</span></div>
    ${r.details ? `<p class="req-details">${escapeHtml(r.details)}</p>` : ""}
    <div class="req-meta">
      <span>Needed by <b class="${late ? "req-late" : ""}">${escapeHtml(formatDate(r.neededBy))}${late ? " (passed)" : ""}</b></span>
      <span>Borrow for <b>${escapeHtml(r.duration || "Not sure")}</b></span>
      <span>📍 <b>${escapeHtml(r.building || "N/A")}</b></span>
    </div>
    <div class="req-actions"></div>
    <div class="req-who">
      ${isOwner ? `You ${nameTagHtml(posterName, posterTier, true)}` : nameTagHtml(posterName, posterTier, true)} · ${timeAgo(r.createdAt)}
      ${offers ? ` · ${offers} offer${offers === 1 ? "" : "s"}` : ""}
    </div>`;

  const actions = card.querySelector(".req-actions");
  if (!isOwner) {
    const rep = document.createElement("a");
    rep.href = "report.html?type=request&id=" + encodeURIComponent(r.id);
    rep.textContent = "🚩 Report";
    rep.title = "Report this request";
    rep.style.cssText = "font-size:12px;font-weight:600;color:#b91c1c;border:1px solid #fecaca;background:#fef2f2;padding:4px 10px;border-radius:999px;text-decoration:none;margin-left:auto;";
    actions.appendChild(rep);
  }

  if (isOwner) {
    if (status === "open") {
      actions.appendChild(makeBtn("Mark fulfilled", "btn btn-primary btn-sm", () => setStatus(r, "fulfilled")));
    } else {
      actions.appendChild(makeBtn("Reopen", "btn btn-outline btn-sm", () => setStatus(r, "open")));
    }
    actions.appendChild(makeBtn("Delete", "btn btn-outline btn-sm", () => removeRequest(r)));
    if (offers) {
      const link = document.createElement("a");
      link.href = "chat.html";
      link.className = "btn btn-outline btn-sm";
      link.textContent = "View offers in Messages";
      actions.appendChild(link);
    }
  } else if (status === "open") {
    actions.appendChild(makeBtn(alreadyOffered ? "Message requester" : "I can lend this", "btn btn-primary btn-sm", () => offerToLend(r, alreadyOffered)));
  }
  return card;
}

function makeBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

// ---------- Actions ----------
// Offering and posting need a verified email (firestore.rules enforces it too).
async function emailBlocked() {
  let admin = false;
  try { admin = await isAdminUser(currentUser); } catch (e) {}
  if (needsVerification(currentUser, admin)) {
    showToast("Please verify your email first. Use the yellow banner at the top to resend the link.", "error");
    return true;
  }
  return false;
}

async function offerToLend(r, alreadyOffered) {
  if (!requireLogin()) return;
  if (!alreadyOffered && await emailBlocked()) return;
  try {
    if (!alreadyOffered) {
      await updateDoc(doc(db, COLLECTION, r.id), {
        offerCount: increment(1),
        offeredBy: arrayUnion(currentUser.uid),
      });
    }
    const chatId = await getOrCreateChat(`req-${r.id}`, `Borrow request: ${r.title}`, r.userId, r.userName || "Neighbor");
    window.location.href = `chat.html?id=${encodeURIComponent(chatId)}`;
  } catch (e) {
    console.error(e);
    showToast(e.message || "Couldn't send your offer. Please try again.", "error");
  }
}

// Asks the requester WHO actually helped, so only a real helper earns points.
// Resolves to a uid, "" (nobody on Borrowa) or null (cancelled).
async function pickHelper(r) {
  const uids = (r.offeredBy || []).filter((u) => u && u !== currentUser.uid);
  if (!uids.length) return "";
  const names = await Promise.all(uids.map(async (uid) => {
    try { const p = await getUserProfile(uid); return (p && p.name) || "Neighbor"; } catch (e) { return "Neighbor"; }
  }));
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1500;display:flex;align-items:center;justify-content:center;padding:16px;";
    const box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:12px;padding:22px;width:100%;max-width:420px;box-shadow:0 10px 25px rgba(0,0,0,.15);";
    box.innerHTML = `<h3 style="margin:0 0 6px;font-size:18px;color:#111;">Who helped you?</h3>
      <p class="req-hint" style="margin:0 0 14px;">Pick the neighbor who lent you the item. They earn points for helping.</p>
      <div id="helper-options" style="display:flex;flex-direction:column;gap:8px;"></div>`;
    const list = box.querySelector("#helper-options");
    const done = (v) => { wrap.remove(); resolve(v); };
    uids.forEach((uid, i) => list.appendChild(makeBtn(names[i], "btn btn-outline", () => done(uid))));
    list.appendChild(makeBtn("Someone else / nobody here", "btn btn-outline", () => done("")));
    const cancel = makeBtn("Cancel", "btn btn-outline btn-sm", () => done(null));
    cancel.style.marginTop = "12px";
    box.appendChild(cancel);
    wrap.appendChild(box);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(null); });
    document.body.appendChild(wrap);
  });
}

async function setStatus(r, status) {
  try {
    const update = { status };
    if (status === "fulfilled") {
      const helper = await pickHelper(r);
      if (helper === null) return;                 // cancelled
      if (helper) update.fulfilledBy = helper;
    } else {
      update.fulfilledBy = deleteField();          // reopening clears the credit
    }
    await updateDoc(doc(db, COLLECTION, r.id), update);
    showToast(status === "fulfilled" ? "Marked as fulfilled. Thanks for sharing!" : "Request reopened.");
    await loadRequests();
  } catch (e) {
    console.error(e);
    showToast("Couldn't update the request.", "error");
  }
}

async function removeRequest(r) {
  if (!confirm(`Delete your request for "${r.title}"?`)) return;
  try {
    await deleteDoc(doc(db, COLLECTION, r.id));
    showToast("Request deleted.");
    await loadRequests();
  } catch (e) {
    console.error(e);
    showToast("Couldn't delete the request.", "error");
  }
}

// ---------- New request modal ----------
function openModal() {
  if (!requireLogin()) return;
  const myOpen = allRequests.filter((r) => r.userId === currentUser.uid && (r.status || "open") === "open").length;
  if (myOpen >= MAX_OPEN_PER_USER) {
    showToast(`You can have up to ${MAX_OPEN_PER_USER} open requests. Mark one fulfilled or delete it first.`, "error");
    return;
  }
  form.reset();
  const dateEl = document.getElementById("req-needed-by");
  dateEl.min = todayStr();
  if (myProfile && myProfile.building && myProfile.building !== "General") {
    document.getElementById("req-building").value = myProfile.building;
  }
  overlay.style.display = "flex";
}
function closeModal() { overlay.style.display = "none"; }

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireLogin()) return;
  if (await emailBlocked()) return;

  const title = document.getElementById("req-title").value.trim();
  const neededBy = document.getElementById("req-needed-by").value;
  const building = document.getElementById("req-building").value.trim();
  if (!title || !building) { showToast("Please fill in the item and your building.", "error"); return; }
  if (neededBy < todayStr()) { showToast("Needed-by date can't be in the past.", "error"); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = "Posting...";
  try {
    await addDoc(collection(db, COLLECTION), {
      userId: currentUser.uid,
      userName: (myProfile && myProfile.name) || currentUser.displayName || (currentUser.email || "Neighbor").split("@")[0],
      title,
      category: document.getElementById("req-category").value,
      details: document.getElementById("req-details").value.trim(),
      duration: document.getElementById("req-duration").value,
      neededBy,
      building,
      status: "open",
      offerCount: 0,
      offeredBy: [],
      createdAt: serverTimestamp(),
      urgent: !!(document.getElementById("req-urgent") || {}).checked,
    });
    closeModal();
    showToast("Request posted! Neighbors can now offer to lend it.");
    view = "mine";
    syncTabs();
    await loadRequests();
  } catch (err) {
    console.error(err);
    showToast("Couldn't post your request. Are you banned or offline?", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Post request";
  }
});

// ---------- Wiring ----------
function syncTabs() {
  document.querySelectorAll(".req-chip").forEach((c) => c.classList.toggle("active", c.dataset.view === view));
}

document.getElementById("new-request-btn").addEventListener("click", openModal);
document.getElementById("req-close").addEventListener("click", closeModal);
document.getElementById("req-cancel").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
document.getElementById("req-search").addEventListener("input", render);
document.getElementById("req-category-filter").addEventListener("change", render);
document.querySelectorAll(".req-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (chip.dataset.view === "mine" && !requireLogin()) return;
    view = chip.dataset.view;
    syncTabs();
    render();
  });
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    try { myProfile = await getUserProfile(user.uid); } catch (e) { myProfile = null; }
  }
  loadRequests();
});
