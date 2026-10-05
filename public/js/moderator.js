// Moderator page: a personal review queue. A moderator can ONLY mark an open report as
// "violation" or "false report" (+ an optional note). The report then moves to the admins'
// "Moderator checked" tab, where an admin takes the real action. firestore.rules enforce all of
// this on the server (isModerator()), so this page is a convenience, not the security.
import { auth, db } from "./firebase-config.js";
import { isAdminUser } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, getDoc, updateDoc, doc, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const listEl = document.getElementById("mod-list");
const todoCount = document.getElementById("mod-todo-count");
const tabs = document.querySelectorAll(".mod-tab");
const COLL = { item: "items", request: "borrowRequests", user: "users" };
const LABEL = { item: "Listing", request: "Borrow request", user: "Member" };
const OUTCOME = { checked: "⏳ Waiting for an admin", resolved: "✅ Admin took action", dismissed: "🗂️ Admin dismissed it" };
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let me = null;        // { uid, name }
let view = "todo";
let groups = [];

async function describe(g) {
  try {
    const s = await getDoc(doc(db, COLL[g.kind], g.targetId));
    g.target = s.exists() ? s.data() : null;
    if (g.target && (g.kind === "item" || g.kind === "request") && g.target.userId) {
      const o = await getDoc(doc(db, "users", g.target.userId));
      g.ownerName = o.exists() ? o.data().name : "";
    }
  } catch (e) { g.target = null; }
}

function group(reports) {
  const map = new Map();
  reports.forEach((r) => {
    const key = r.kind + ":" + r.targetId;
    if (!map.has(key)) map.set(key, { kind: r.kind, targetId: r.targetId, reports: [] });
    map.get(key).reports.push(r);
  });
  return [...map.values()];
}

function cardTop(g) {
  const name = g.target ? (g.kind === "user" ? g.target.name : g.target.title) : null;
  const preview = g.target && g.kind !== "user"
    ? `<div class="mod-preview">${g.target.description || g.target.details ? esc(String(g.target.description || g.target.details).slice(0, 240)) : ""}${g.ownerName ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">Posted by ${esc(g.ownerName)}</div>` : ""}</div>` : "";
  const reasons = {};
  g.reports.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
  const details = g.reports.filter((r) => r.details).slice(0, 3).map((r) => `<div class="mod-detail">“${esc(r.details)}”</div>`).join("");
  return `<div class="mod-head">
      <div><div class="mod-title">${name ? esc(name) : "<em>Already removed</em>"}</div><div class="mod-kind">${LABEL[g.kind] || "Report"}</div></div>
      <span class="mod-count">${g.reports.length} report${g.reports.length > 1 ? "s" : ""}</span>
    </div>
    ${preview}
    <div class="mod-reasons">${Object.entries(reasons).map(([k, v]) => `<span class="mod-reason">${esc(k)}${v > 1 ? " ×" + v : ""}</span>`).join("")}</div>
    ${details}`;
}

function renderTodo() {
  const eligible = groups.filter((g) => g.reports.some((r) => r.reporterId !== me.uid && r.targetId !== me.uid));
  todoCount.textContent = eligible.length ? `(${eligible.length})` : "";
  if (!eligible.length) { listEl.innerHTML = `<div class="mod-empty">Nothing to review right now. 🎉</div>`; return; }
  listEl.innerHTML = eligible.map((g, i) => `<div class="mod-card" data-i="${i}">
      ${cardTop(g)}
      <input class="mod-note-input" maxlength="200" placeholder="Note for the admins (optional)" />
      <div class="mod-actions">
        <button type="button" class="mod-btn mod-btn-violation" data-v="violation">🚨 Violation</button>
        <button type="button" class="mod-btn mod-btn-false" data-v="false">✅ False report</button>
      </div></div>`).join("");
  listEl._groups = eligible;
}

function renderMine() {
  const rows = groups;
  if (!rows.length) { listEl.innerHTML = `<div class="mod-empty">You haven't checked any reports yet.</div>`; return; }
  listEl.innerHTML = rows.map((g) => {
    const first = g.reports[0];
    const v = first.modVerdict === "violation" ? "violation" : "false";
    return `<div class="mod-card done-${v}">
      ${cardTop(g)}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <span class="mod-verdict mod-verdict-${v}">${v === "violation" ? "🚨 You marked: Violation" : "✅ You marked: False report"}</span>
        <span style="font-size:12px;color:#6b7280;">${OUTCOME[first.status] || ""}</span>
      </div>
      ${first.modNote ? `<div class="mod-detail">Your note: ${esc(first.modNote)}</div>` : ""}
    </div>`;
  }).join("");
}

async function load() {
  listEl.innerHTML = `<div class="mod-empty">Loading…</div>`;
  try {
    let docs;
    if (view === "todo") {
      // Same filters the security rules allow: open reports about listings / requests / members.
      docs = (await getDocs(query(collection(db, "reports"), where("status", "==", "open"), where("kind", "in", ["item", "user", "request"])))).docs;
    } else {
      docs = (await getDocs(query(collection(db, "reports"), where("modBy", "==", me.uid)))).docs;
    }
    let reports = docs.map((d) => ({ id: d.id, ...d.data() }));
    if (view === "mine") reports.sort((a, b) => (b.modAt?.toMillis?.() || 0) - (a.modAt?.toMillis?.() || 0));
    groups = group(reports);
    await Promise.all(groups.map(describe));
    view === "todo" ? renderTodo() : renderMine();
  } catch (e) {
    console.error(e);
    listEl.innerHTML = `<div class="mod-empty" style="color:#b91c1c;">Couldn't load reports. Ask an admin to publish the latest firestore.rules.</div>`;
  }
}

listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-v]");
  if (!btn) return;
  const card = btn.closest(".mod-card");
  const g = listEl._groups[Number(card.dataset.i)];
  const verdict = btn.dataset.v;
  const note = card.querySelector(".mod-note-input").value.trim().slice(0, 200);
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    // Never your own reports, or reports about yourself (the rules refuse those too).
    const mine = g.reports.filter((r) => r.reporterId !== me.uid && r.targetId !== me.uid);
    await Promise.all(mine.map((r) => updateDoc(doc(db, "reports", r.id), {
      status: "checked", modVerdict: verdict, modNote: note, modBy: me.uid, modByName: me.name.slice(0, 60), modAt: serverTimestamp(),
    })));
    await load();
  } catch (err) {
    console.error(err);
    alert("That didn't work. Make sure you're a moderator and the latest firestore.rules are published.");
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
});

tabs.forEach((t) => t.addEventListener("click", () => {
  tabs.forEach((x) => x.classList.toggle("active", x === t));
  view = t.dataset.view;
  load();
}));

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html?next=moderator.html"; return; }
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const u = snap.exists() ? snap.data() : {};
    const ok = (u.rank === "moderator" && !u.banned) || (await isAdminUser(user));
    if (!ok) { window.location.href = "home.html"; return; }
    me = { uid: user.uid, name: u.name || user.displayName || "Moderator" };
    load();
  } catch (e) { window.location.href = "home.html"; }
});
