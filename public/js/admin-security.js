// Admin page extras: (1) warn if the main admin's email isn't verified yet (firestore.rules now require it),
// (2) the "Admin log" tab, (3) a one-click tool that blurs exact locations on old listings.
import { auth, db, ADMIN_EMAIL } from "./firebase-config.js";
import { guardAdminPage, sendVerification, refreshVerification } from "./auth.js";
import { loadAdminLog, logAdminAction } from "./admin-log.js";
import { collection, getDocs, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function verifyBanner(user) {
  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL || user.emailVerified) return;
  const box = document.createElement("div");
  box.style.cssText = "background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:10px;padding:12px 16px;margin:0 0 18px;font-size:14px;";
  box.innerHTML = `<b>⚠️ Verify the admin email.</b> The security rules now only treat this account as admin once its email is verified. Without it, admin actions will be refused.
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button type="button" id="av-send" class="tab-btn" style="border:1px solid #fdba74;">Send verification email</button>
      <button type="button" id="av-done" class="tab-btn" style="border:1px solid #fdba74;">I've verified it</button>
      <span id="av-msg"></span></div>`;
  const host = document.querySelector(".admin-container") || document.body;
  host.insertBefore(box, host.firstChild);
  const msg = box.querySelector("#av-msg");
  box.querySelector("#av-send").onclick = async () => { try { await sendVerification(user); msg.textContent = "Sent — check the inbox."; } catch (e) { msg.textContent = "Couldn't send (try again in a minute)."; } };
  box.querySelector("#av-done").onclick = async () => { const ok = await refreshVerification().catch(() => false); if (ok) location.reload(); else msg.textContent = "Not verified yet."; };
}

async function renderLog() {
  const el = document.getElementById("admin-log-body"); if (!el) return;
  try {
    const rows = await loadAdminLog(100);
    el.innerHTML = rows.length ? rows.map((r) => `<tr><td>${r.createdAt && r.createdAt.toDate ? esc(r.createdAt.toDate().toLocaleString()) : ""}</td><td>${esc(r.adminEmail)}</td><td>${esc(r.action)}</td><td>${esc(r.target)}</td></tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:#6b7280;">Nothing logged yet.</td></tr>`;
  } catch (e) { el.innerHTML = `<tr><td colspan="4" style="color:#b91c1c;">Couldn't load the log (publish the latest firestore.rules).</td></tr>`; }
}

function blurTool() {
  const btn = document.getElementById("blur-old-btn"), out = document.getElementById("blur-old-msg"); if (!btn) return;
  btn.onclick = async () => {
    if (!confirm("Round the saved location of every existing listing to about 110 m? This can't be undone.")) return;
    btn.disabled = true; out.textContent = "Working…";
    try {
      const snap = await getDocs(collection(db, "items")); let n = 0;
      for (const d of snap.docs) {
        const l = d.data().location;
        if (!l || typeof l.lat !== "number" || typeof l.lng !== "number") continue;
        const r = (v) => Math.round(v * 1000) / 1000;
        if (r(l.lat) === l.lat && r(l.lng) === l.lng) continue;
        await updateDoc(doc(db, "items", d.id), { location: { ...l, lat: r(l.lat), lng: r(l.lng) } }); n++;
      }
      logAdminAction("Blurred old listing locations", n + " listings");
      out.textContent = `Done: ${n} listing${n === 1 ? "" : "s"} updated.`;
    } catch (e) { console.error(e); out.textContent = "Stopped early — see the console."; }
    btn.disabled = false;
  };
}

guardAdminPage((user) => {
  verifyBanner(user);
  renderLog();
  blurTool();
  document.querySelector('.tab-btn[data-tab="adminlog-tab"]')?.addEventListener("click", renderLog);
});
