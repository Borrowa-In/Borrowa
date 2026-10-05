// Admin "Moderator checked" tab: reports a moderator has already reviewed. Each shows the
// moderator's verdict (violation / false report) and note, and the admin takes the real action:
// delete the listing, ban the member, dismiss, reopen for a second look, or clear.
import { auth, db, ADMIN_EMAIL } from "./firebase-config.js";
import { setDevicesBanned } from "./device.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, getDoc, updateDoc, deleteDoc, doc, query, where, deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const body = document.getElementById("admin-modreports-body");
const countEl = document.getElementById("modreports-count");
const COLL = { item: "items", request: "borrowRequests", user: "users" };
const LABEL = { item: "Listing", request: "Borrow request", user: "Member" };
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const setStatus = (g, status) => Promise.all(g.reports.map((r) => updateDoc(doc(db, "reports", r.id), { status })));

async function load() {
  if (!body) return;
  body.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading…</td></tr>`;
  try {
    const snap = await getDocs(query(collection(db, "reports"), where("status", "==", "checked")));
    const groups = new Map();
    snap.docs.forEach((d) => {
      const r = { id: d.id, ...d.data() };
      const key = r.kind + ":" + r.targetId;
      if (!groups.has(key)) groups.set(key, { kind: r.kind, targetId: r.targetId, reports: [] });
      groups.get(key).reports.push(r);
    });
    const list = [...groups.values()].sort((a, b) => {
      const t = (g) => Math.max(...g.reports.map((r) => r.modAt?.toMillis?.() || 0));
      return t(b) - t(a);
    });
    await Promise.all(list.map(async (g) => {
      try {
        const s = await getDoc(doc(db, COLL[g.kind] || "users", g.targetId));
        g.target = s.exists() ? s.data() : null;
        if ((g.kind === "item" || g.kind === "request") && g.target?.userId) {
          const o = await getDoc(doc(db, "users", g.target.userId));
          g.owner = o.exists() ? { uid: g.target.userId, ...o.data() } : { uid: g.target.userId };
        } else if (g.kind === "user" && g.target) g.owner = { uid: g.targetId, ...g.target };
        if (g.owner?.uid) {
          const p = await getDoc(doc(db, "userPrivate", g.owner.uid)).catch(() => null);
          g.owner.email = p && p.exists() ? p.data().email : "";
        }
      } catch (e) { g.target = null; }
    }));
    countEl.textContent = list.length ? `(${list.length})` : "";
    render(list);
  } catch (e) {
    console.error(e);
    body.innerHTML = `<tr><td colspan="5" style="color:red;text-align:center;">Couldn't load. Publish the latest firestore.rules.</td></tr>`;
  }
}

function render(list) {
  if (!list.length) { body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#6b7280;">No moderator-checked reports waiting. 🎉</td></tr>`; return; }
  body.innerHTML = list.map((g, i) => {
    const what = g.target
      ? `<strong>${esc(g.kind === "user" ? g.target.name : g.target.title)}</strong><div style="font-size:.8rem;color:#6b7280;">${LABEL[g.kind] || ""}</div>`
      : `<em>Already removed</em><div style="font-size:.8rem;color:#6b7280;">${esc(g.targetId)}</div>`;
    const owner = (g.kind === "item" || g.kind === "request") && g.owner ? `<div style="font-size:.8rem;color:#6b7280;">by ${esc(g.owner.name || g.owner.uid)}</div>` : "";
    const verdicts = g.reports.reduce((m, r) => { if (!m.has(r.modBy)) m.set(r.modBy, r); return m; }, new Map());
    const verdictHtml = [...verdicts.values()].map((r) => {
      const v = r.modVerdict === "violation";
      return `<div style="margin-bottom:6px;"><span class="badge" style="background:${v ? "#fee2e2" : "#dcfce7"};color:${v ? "#991b1b" : "#166534"};">${v ? "🚨 Violation" : "✅ False report"}</span>
        <div style="font-size:.8rem;color:#4b5563;margin-top:3px;">by ${esc(r.modByName || "moderator")}${r.modAt?.toDate ? " · " + esc(r.modAt.toDate().toLocaleString()) : ""}</div>
        ${r.modNote ? `<div style="font-size:.8rem;color:#374151;">“${esc(r.modNote)}”</div>` : ""}</div>`;
    }).join("");
    const reasons = {};
    g.reports.forEach((r) => { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    const details = g.reports.filter((r) => r.details).slice(0, 3).map((r) => `<div style="font-size:.8rem;color:#4b5563;">“${esc(r.details)}”</div>`).join("");
    const isSafeOwner = g.owner && g.owner.email === ADMIN_EMAIL;
    const banned = g.owner?.banned;
    const violation = g.reports.some((r) => r.modVerdict === "violation");
    return `<tr>
      <td><span class="badge" style="background:#fee2e2;color:#991b1b;font-size:1rem;">${g.reports.length}</span></td>
      <td>${what}${owner}</td>
      <td>${verdictHtml}</td>
      <td>${Object.entries(reasons).map(([k, v]) => `${esc(k)} ×${v}`).join("<br>")}${details}</td>
      <td><div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${(g.kind === "item" || g.kind === "request") && g.target ? `<button class="btn-action ${violation ? "btn-danger-action" : "btn-outline-action"}" data-act="del-item" data-i="${i}">Delete ${g.kind === "item" ? "listing" : "request"}</button>` : ""}
        ${g.owner && !isSafeOwner ? `<button class="btn-action ${banned ? "btn-outline-action" : (violation ? "btn-danger-action" : "btn-outline-action")}" data-act="ban" data-i="${i}">${banned ? "Unban member" : "Ban member"}</button>` : ""}
        <button class="btn-action ${violation ? "btn-outline-action" : "btn-primary-action"}" data-act="dismiss" data-i="${i}">Dismiss${violation ? "" : " (false report)"}</button>
        <button class="btn-action btn-outline-action" data-act="reopen" data-i="${i}">Reopen</button>
        <button class="btn-action btn-outline-action" data-act="delete-reports" data-i="${i}">Clear</button>
      </div></td></tr>`;
  }).join("");
  body._groups = list;
}

body?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const g = body._groups[Number(btn.dataset.i)];
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === "del-item") {
      if (!confirm("Delete this? The reports on it will be marked resolved.")) { btn.disabled = false; return; }
      await deleteDoc(doc(db, COLL[g.kind], g.targetId));
      if (g.kind === "item") deleteDoc(doc(db, "itemPhotos", g.targetId)).catch(() => {});
      await setStatus(g, "resolved");
    } else if (act === "ban") {
      const ban = !g.owner.banned;
      if (!confirm(`${ban ? "Ban" : "Unban"} ${g.owner.name || "this member"}?`)) { btn.disabled = false; return; }
      await updateDoc(doc(db, "users", g.owner.uid), { banned: ban });
      try { await setDevicesBanned(g.owner.uid, ban); } catch (err) { console.warn("Device ban failed:", err); }
      if (ban) await setStatus(g, "resolved");
    } else if (act === "dismiss") {
      await setStatus(g, "dismissed");
    } else if (act === "reopen") {
      // Back to the open queue (and the main Reports tab) so it can be looked at again.
      await Promise.all(g.reports.map((r) => updateDoc(doc(db, "reports", r.id), {
        status: "open", modVerdict: deleteField(), modNote: deleteField(), modBy: deleteField(), modByName: deleteField(), modAt: deleteField(),
      })));
    } else if (act === "delete-reports") {
      if (!confirm("Permanently delete these reports?")) { btn.disabled = false; return; }
      await Promise.all(g.reports.map((r) => deleteDoc(doc(db, "reports", r.id))));
    }
    await load();
    document.dispatchEvent(new CustomEvent("borrowa-reports-changed"));
  } catch (err) {
    console.error(err);
    alert("That didn't work. Check firestore.rules are published.");
    btn.disabled = false;
  }
});

document.querySelector('.tab-btn[data-tab="modreports-tab"]')?.addEventListener("click", load);
onAuthStateChanged(auth, (u) => { if (u) load(); });
