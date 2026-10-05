// Admin "Device limits" tab: pick how many accounts one device may hold (tick a box),
// and tick individual devices as "unlimited" so any number of accounts can join them.
// Server-side enforcement is in firestore.rules (deviceLimit() + devices/{id}).
import { db, auth } from "./firebase-config.js";
import { getDeviceLimit, setDeviceLimit, markDeviceUnlimited, getDeviceId } from "./device.js";
import { logAdminAction } from "./admin-log.js";
import { collection, getDocs, updateDoc, doc, query, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const root = document.getElementById("device-limits-root");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OPTIONS = [1, 2, 3, 4, 5, 10, 25, 999];
const label = (n) => (n === 999 ? "Unlimited" : String(n));

async function render() {
  if (!root) return;
  const current = await getDeviceLimit(true);
  root.innerHTML = `
    <div style="background:#fff;border:1px solid #d5e3da;border-radius:12px;padding:16px 18px;margin-bottom:20px;">
      <h3 style="margin:0 0 4px;">Accounts allowed per device</h3>
      <p style="margin:0 0 12px;color:#5a6b60;font-size:13px;">Tick one. Applies to every normal device. Currently: <b id="dl-cur">${label(current)}</b>.</p>
      <div id="dl-opts" style="display:flex;flex-wrap:wrap;gap:8px 18px;">
        ${OPTIONS.map((n) => `<label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer;font-size:14px;"><input type="checkbox" class="dl-opt" value="${n}" ${n === current ? "checked" : ""}/> ${label(n)}</label>`).join("")}
      </div>
      <button type="button" id="dl-save" class="tab-btn active" style="margin-top:14px;">Save limit</button>
      <span id="dl-msg" style="margin-left:10px;font-size:13px;"></span>
    </div>
    <div style="background:#fff;border:1px solid #d5e3da;border-radius:12px;padding:16px 18px;">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
        <h3 style="margin:0;">Devices</h3>
        <button type="button" id="dl-mine" class="tab-btn" style="border:1px solid #cfe3d4;">Make THIS browser unlimited</button>
      </div>
      <p style="margin:0 0 10px;color:#5a6b60;font-size:13px;">Tick <b>Unlimited</b> on a device to let any number of accounts use it (they also skip the 2-account cap and verification, like your own device).</p>
      <div id="dl-devices">Loading…</div>
    </div>`;

  const opts = [...root.querySelectorAll(".dl-opt")];
  opts.forEach((o) => o.addEventListener("change", () => { if (o.checked) opts.forEach((x) => { if (x !== o) x.checked = false; }); else o.checked = true; }));
  const msg = root.querySelector("#dl-msg");
  root.querySelector("#dl-save").addEventListener("click", async () => {
    const n = +(opts.find((o) => o.checked) || {}).value;
    msg.style.color = "#6b7280"; msg.textContent = "Saving…";
    try { await setDeviceLimit(n); logAdminAction("Set accounts-per-device limit", String(n)); root.querySelector("#dl-cur").textContent = label(n); msg.style.color = "#15803d"; msg.textContent = "Saved ✓"; }
    catch (e) { console.error(e); msg.style.color = "#b91c1c"; msg.textContent = "Couldn't save — publish the latest firestore.rules."; }
  });
  root.querySelector("#dl-mine").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const ok = await markDeviceUnlimited(auth.currentUser);
    e.target.textContent = ok ? "✅ This browser is unlimited" : "Only the main admin can do this";
    loadDevices();
  });
  loadDevices();
}

async function loadDevices() {
  const el = root.querySelector("#dl-devices");
  try {
    const snap = await getDocs(query(collection(db, "devices"), limit(300)));
    const mine = getDeviceId();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => (d.uids || []).length || d.unlimited)
      .sort((a, b) => (b.unlimited ? 1 : 0) - (a.unlimited ? 1 : 0) || (b.uids || []).length - (a.uids || []).length);
    if (!rows.length) { el.textContent = "No devices recorded yet."; return; }
    el.innerHTML = `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Device</th><th>Accounts</th><th>Status</th><th>Unlimited</th></tr></thead><tbody>${rows.map((d) => {
      const emails = (d.uids || []).map((u) => (d.emails || {})[u] || u.slice(0, 6) + "…");
      return `<tr><td>${esc(d.id.slice(0, 8))}…${d.id === mine ? " <b>(this browser)</b>" : ""}</td>
        <td>${(d.uids || []).length}<div style="font-size:11px;color:#6b7280;">${esc(emails.join(", "))}</div></td>
        <td>${d.banned ? "🚫 Blocked" : "OK"}</td>
        <td><label style="cursor:pointer;"><input type="checkbox" class="dl-unl" data-id="${esc(d.id)}" ${d.unlimited ? "checked" : ""}/> Unlimited</label></td></tr>`;
    }).join("")}</tbody></table></div>`;
    el.querySelectorAll(".dl-unl").forEach((c) => c.addEventListener("change", async () => {
      c.disabled = true;
      try { await updateDoc(doc(db, "devices", c.dataset.id), { unlimited: c.checked }); logAdminAction(c.checked ? "Device set unlimited" : "Device limit restored", c.dataset.id.slice(0, 8)); }
      catch (e) { console.error(e); c.checked = !c.checked; alert("Couldn't change that device."); }
      c.disabled = false;
    }));
  } catch (e) { console.error(e); el.textContent = "Couldn't load devices (publish the latest firestore.rules)."; }
}

// Wait until the admin page has confirmed the person is an admin, then draw.
import("./auth.js").then(({ guardAdminPage }) => guardAdminPage(() => render()));
