// Admin "Reports" tab. Nothing here is automatic: reports just pile up, grouped
// by what was reported, most-reported first, and an admin decides what to do.
import { auth, db, ADMIN_EMAIL } from "./firebase-config.js";
import { setDevicesBanned } from "./device.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, getDoc, updateDoc, deleteDoc, doc, query, where, orderBy, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const body = document.getElementById("admin-reports-body");
const countEl = document.getElementById("reports-count");
const showAll = document.getElementById("reports-show-handled");
const COLL = { item: "items", request: "borrowRequests", user: "users", chat: "users" };
const LABEL = { item: "Listing", request: "Borrow request", user: "Member", chat: "Member (reported in chat)" };
// Closing a report always erases any chat key the reporter shared.
const closeReports = (g, status) => Promise.all(g.reports.map((r) =>
  updateDoc(doc(db, "reports", r.id), r.chatKey ? { status, chatKey: deleteField() } : { status })));
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function load() {
  body.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading…</td></tr>`;
  try {
    const snap = await getDocs(showAll.checked ? collection(db, "reports") : query(collection(db, "reports"), where("status", "==", "open")));
    const groups = new Map();
    snap.docs.forEach((d) => {
      const r = { id: d.id, ...d.data() };
      const key = r.kind + ":" + r.targetId;
      if (!groups.has(key)) groups.set(key, { kind: r.kind, targetId: r.targetId, reports: [] });
      groups.get(key).reports.push(r);
    });
    const list = [...groups.values()].sort((a, b) => b.reports.length - a.reports.length);
    // Look up what each report points at (item or member) so the admin sees names, not IDs.
    await Promise.all(list.map(async (g) => {
      try {
        const s = await getDoc(doc(db, COLL[g.kind] || "users", g.targetId));
        g.target = s.exists() ? s.data() : null;
        if ((g.kind === "item" || g.kind === "request") && g.target?.userId) {
          const o = await getDoc(doc(db, "users", g.target.userId));
          g.owner = o.exists() ? { uid: g.target.userId, ...o.data() } : { uid: g.target.userId };
        } else if ((g.kind === "user" || g.kind === "chat") && g.target) g.owner = { uid: g.targetId, ...g.target };
      } catch (e) { g.target = null; }
    }));
    countEl.textContent = list.length ? `(${list.length})` : "";
    render(list);
  } catch (e) {
    console.error(e);
    body.innerHTML = `<tr><td colspan="5" style="color:red;text-align:center;">Couldn't load reports. Publish the latest firestore.rules.</td></tr>`;
  }
}

function render(list) {
  if (!list.length) { body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b7280;">No reports. 🎉</td></tr>`; return; }
  body.innerHTML = list.map((g, i) => {
    const reasons = {};
    g.reports.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    const what = g.target
      ? (g.kind === "item" || g.kind === "request" ? `<strong>${esc(g.target.title)}</strong><div style="font-size:.8rem;color:#6b7280;">${LABEL[g.kind]}</div>`
                           : `<strong>${esc(g.target.name)}</strong><div style="font-size:.8rem;color:#6b7280;">${LABEL[g.kind]}</div>`)
      : `<em>Already removed</em><div style="font-size:.8rem;color:#6b7280;">${esc(g.targetId)}</div>`;
    const owner = (g.kind === "item" || g.kind === "request") && g.owner ? `<div style="font-size:.8rem;color:#6b7280;">by ${esc(g.owner.name || g.owner.uid)}</div>` : "";
    const details = g.reports.filter((r) => r.details).slice(0, 3).map((r) => `<div style="font-size:.8rem;color:#4b5563;">“${esc(r.details)}”</div>`).join("");
    const isSafeOwner = g.owner && g.owner.email === ADMIN_EMAIL;
    const banned = g.owner?.banned;
    return `<tr>
      <td><span class="badge" style="background:#fee2e2;color:#991b1b;font-size:1rem;">${g.reports.length}</span></td>
      <td>${what}${owner}</td>
      <td>${Object.entries(reasons).map(([k, v]) => `${esc(k)} ×${v}`).join("<br>")}${details}</td>
      <td>${banned ? "🚫 Banned" : "Active"}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${(g.kind === "item" || g.kind === "request") && g.target ? `<button class="btn-action btn-danger-action" data-act="del-item" data-i="${i}">Delete ${g.kind === "item" ? "listing" : "request"}</button>` : ""}
        ${g.reports.filter((r) => r.kind === "chat" && r.chatKey).map((r, j) => `<button class="btn-action btn-outline-action" data-act="view-chat" data-i="${i}" data-j="${j}">💬 Read chat${g.reports.length > 1 ? " #" + (j + 1) : ""}</button>`).join("")}
        ${g.owner && !isSafeOwner ? `<button class="btn-action ${banned ? "btn-outline-action" : "btn-danger-action"}" data-act="ban" data-i="${i}">${banned ? "Unban member" : "Ban member"}</button>` : ""}
        <button class="btn-action btn-outline-action" data-act="dismiss" data-i="${i}">Dismiss</button>
        <button class="btn-action btn-outline-action" data-act="delete-reports" data-i="${i}">Clear</button>
      </div></td></tr>`;
  }).join("");
  body._groups = list;
}

body.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const g = body._groups[Number(btn.dataset.i)];
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === "view-chat") {
      const r = g.reports.filter((x) => x.kind === "chat" && x.chatKey)[Number(btn.dataset.j)];
      await showChat(r, g);
      btn.disabled = false;
      return;
    }
    if (act === "del-item") {
      if (!confirm("Delete this listing? Reports on it will be marked resolved.")) { btn.disabled = false; return; }
      await deleteDoc(doc(db, COLL[g.kind], g.targetId));
      if (g.kind === "item") deleteDoc(doc(db, "itemPhotos", g.targetId)).catch(() => {});
      await closeReports(g, "resolved");
    } else if (act === "ban") {
      const ban = !g.owner.banned;
      if (!confirm(`${ban ? "Ban" : "Unban"} ${g.owner.name || "this member"}?`)) { btn.disabled = false; return; }
      await updateDoc(doc(db, "users", g.owner.uid), { banned: ban });
      try { await setDevicesBanned(g.owner.uid, ban); } catch (e) { console.warn("Device ban failed:", e); }
      if (ban) await closeReports(g, "resolved");
    } else if (act === "dismiss") {
      await closeReports(g, "dismissed");
    } else if (act === "delete-reports") {
      if (!confirm("Permanently delete these reports?")) { btn.disabled = false; return; }
      await Promise.all(g.reports.map((r) => deleteDoc(doc(db, "reports", r.id))));
    }
    await load();
  } catch (err) {
    console.error(err);
    alert("That didn't work. Check firestore.rules are published.");
    btn.disabled = false;
  }
});

showAll.addEventListener("change", load);
document.addEventListener("borrowa-reports-changed", load);   // e.g. an admin reopened a moderator-checked report
onAuthStateChanged(auth, (u) => { if (u) load(); });

// Decrypts the real stored messages with the key the reporter chose to share.
async function showChat(r, g) {
  const raw = Uint8Array.from(atob(r.chatKey), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  const snap = await getDocs(query(collection(db, "chats", r.chatId, "messages"), orderBy("createdAt", "asc")));
  const rows = [];
  for (const d of snap.docs) {
    const m = d.data();
    let text;
    try {
      if (m.cipher) {
        const iv = Uint8Array.from(atob(m.iv), (c) => c.charCodeAt(0));
        const buf = Uint8Array.from(atob(m.cipher), (c) => c.charCodeAt(0));
        text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, buf));
      } else text = m.text || "";
    } catch (e) { text = "(couldn't decrypt)"; }
    const when = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : "";
    const reporter = m.senderId === r.reporterId;
    rows.push(`<div style="margin:6px 0;text-align:${reporter ? "right" : "left"};"><div style="font-size:11px;color:#6b7280;">${reporter ? "Reporter" : "Reported: " + esc(g.owner?.name || "member")} · ${esc(when)}</div><div style="display:inline-block;max-width:80%;background:${reporter ? "#dcfce7" : "#fee2e2"};padding:7px 11px;border-radius:10px;text-align:left;">${esc(text)}</div></div>`);
  }
  const o = document.createElement("div");
  o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  o.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;"><div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;"><strong>Reported conversation</strong><div style="font-size:12px;color:#6b7280;">Reason: ${esc(r.reason)}${r.details ? " — “" + esc(r.details) + "”" : ""}. Read only. The shared key is deleted when you dismiss or resolve the report.</div></div><div style="padding:12px 18px;overflow:auto;flex:1;">${rows.join("") || "<em>No messages.</em>"}</div><div style="padding:12px 18px;border-top:1px solid #e5e7eb;text-align:right;"><button class="btn btn-primary btn-sm" id="chat-close">Close</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector("#chat-close").onclick = () => o.remove();
}
