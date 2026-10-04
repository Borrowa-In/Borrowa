import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, orderBy, doc, updateDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { guardAdminPage } from "./auth.js";

// Admin moderation for the Borrow Requests board (requests.html).
// Admins can mark any request fulfilled/open or delete it.

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const bodyEl = document.getElementById("admin-requests-body");
const searchEl = document.getElementById("search-requests");
let requests = [];
let filter = "active"; // active | fulfilled | all
const isActive = (r) => (r.status || "open") !== "fulfilled";

function timeAgo(ts) {
  const ms = ts && ts.toMillis ? ts.toMillis() : (ts && ts.seconds ? ts.seconds * 1000 : 0);
  if (!ms) return "";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function updateCounts() {
  const active = requests.filter(isActive).length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("stat-active-requests", active);
  set("requests-count", `(${active})`);
  set("rf-active", `(${active})`);
  set("rf-fulfilled", `(${requests.length - active})`);
  set("rf-all", `(${requests.length})`);
}

async function load() {
  try {
    const snap = await getDocs(query(collection(db, "borrowRequests"), orderBy("createdAt", "desc")));
    requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error(e);
    bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#991b1b;">Couldn't load requests. Publish the updated firestore.rules first.</td></tr>`;
    return;
  }
  updateCounts();
  render();
}

function render() {
  const term = (searchEl?.value || "").trim().toLowerCase();
  const list = requests.filter((r) =>
    (filter === "all" || (filter === "active" ? isActive(r) : !isActive(r))) &&
    (!term || `${r.title} ${r.userName} ${r.building}`.toLowerCase().includes(term)));

  if (!list.length) {
    bodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--admin-muted);">${filter === "active" ? "No active borrow requests right now." : "No borrow requests found."}</td></tr>`;
    return;
  }
  bodyEl.innerHTML = "";
  list.forEach((r) => {
    const fulfilled = (r.status || "open") === "fulfilled";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(r.title)}</strong><div style="font-size:0.78rem; color:var(--admin-muted);">${escapeHtml(r.category || "")}${r.createdAt ? " · " + timeAgo(r.createdAt) : ""}</div></td>
      <td>${escapeHtml(r.userName || "Neighbor")}</td>
      <td>${escapeHtml(r.building || "N/A")}</td>
      <td>${escapeHtml(r.neededBy || "")}</td>
      <td>${r.offerCount || 0}</td>
      <td><span class="badge ${fulfilled ? 'badge-admin' : 'badge-available'}">${fulfilled ? "Fulfilled" : "Open"}</span></td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-action btn-outline-action toggle-req" type="button">${fulfilled ? "Reopen" : "Mark fulfilled"}</button>
          <button class="btn-action btn-danger-action delete-req" type="button">Delete</button>
        </div>
      </td>`;
    tr.querySelector(".toggle-req").addEventListener("click", async () => {
      try {
        await updateDoc(doc(db, "borrowRequests", r.id), { status: fulfilled ? "open" : "fulfilled" });
        await load();
      } catch (e) { console.error(e); alert("Couldn't update that request."); }
    });
    tr.querySelector(".delete-req").addEventListener("click", async () => {
      if (!confirm(`Delete the request for "${r.title}"?`)) return;
      try {
        await deleteDoc(doc(db, "borrowRequests", r.id));
        await load();
      } catch (e) { console.error(e); alert("Couldn't delete that request."); }
    });
    bodyEl.appendChild(tr);
  });
}

searchEl?.addEventListener("input", render);
document.querySelectorAll(".req-filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    document.querySelectorAll(".req-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});
guardAdminPage(() => load());
