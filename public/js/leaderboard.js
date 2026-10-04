import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { loadRankData, peekRankData, TIERS, tierBadgeHtml, nextTier, tierForPoints } from "./ranks.js";

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let myUid = null;
let data = null;
onAuthStateChanged(auth, (user) => {
  myUid = user ? user.uid : null;
  if (data) render(data);
});

// Module scripts run after the page is parsed, so no DOMContentLoaded wait is needed.
(async () => {
  const listEl = document.getElementById("leaderboard-list");
  if (!listEl) return;
  // 1) Paint last-known numbers immediately (no "Loading..." flash between pages).
  const known = peekRankData();
  if (known) { data = known; render(known); }
  // 2) Then fetch fresh data and repaint only if something actually changed.
  try {
    const fresh = await loadRankData(!!known);
    const changed = !known || JSON.stringify(fresh.ranked.map((m) => [m.uid, m.points])) !== JSON.stringify(known.ranked.map((m) => [m.uid, m.points]));
    data = fresh;
    if (changed) render(fresh);
  } catch (err) {
    console.error("Error loading leaderboard:", err);
    if (!known) listEl.innerHTML = `<p style="color: #991b1b; text-align: center;">Failed to load leaderboard data.</p>`;
  }
})();

function renderTierLegend() {
  const el = document.getElementById("tier-legend");
  if (!el) return;
  el.innerHTML = TIERS.filter((t) => t.key !== "none").map((t) =>
    `<div style="background:${t.card};border:1px solid ${t.border};box-shadow:${t.glow};border-radius:12px;padding:12px 14px;text-align:center;">
       <div style="font-size:22px;">${t.icon}</div>
       <div style="font-weight:700;color:${t.color};font-size:13px;">${t.name}</div>
       <div style="font-size:11px;color:#6b7280;">${t.min}+ pts</div>
     </div>`).join("");
}

function podiumCard(m, place) {
  const t = m.tier;
  const heights = { 1: 150, 2: 120, 3: 100 };
  const medal = { 1: "🏆", 2: "🥈", 3: "🥉" }[place];
  const isMe = myUid && m.uid === myUid;
  return `
    <div style="flex:1;min-width:110px;max-width:220px;display:flex;flex-direction:column;justify-content:flex-end;">
      <div style="background:${t.card};border:2px solid ${t.border};box-shadow:${t.glow};border-radius:16px;padding:14px 10px;text-align:center;min-height:${heights[place]}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;${isMe ? "outline:3px solid #86efac;" : ""}">
        <div style="font-size:${place === 1 ? 34 : 28}px;line-height:1;">${medal}</div>
        <div style="width:44px;height:44px;border-radius:50%;background:${t.bg};color:${t.color};border:2px solid ${t.border};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;">${escapeHtml(m.name.trim().charAt(0).toUpperCase() || "?")}</div>
        <div style="font-weight:700;color:#0e1a12;font-size:14px;word-break:break-word;">${escapeHtml(m.name)}${isMe ? " (you)" : ""}</div>
        ${tierBadgeHtml(t, true)}
        <div style="font-weight:800;color:${t.color};font-size:18px;">${m.points} pts</div>
      </div>
    </div>`;
}

function myRankCard(ranked) {
  const el = document.getElementById("my-rank-slot");
  if (!el) return;
  if (!myUid) { el.innerHTML = ""; return; }
  const idx = ranked.findIndex((m) => m.uid === myUid);
  const me = idx >= 0 ? ranked[idx] : null;
  const pts = me ? me.points : 0;
  const t = me ? me.tier : tierForPoints(pts);
  const nt = nextTier(pts, me && me.assignedRank ? t : null);
  const pct = nt ? Math.max(0, Math.min(100, Math.round(((pts - t.min) / (nt.min - t.min)) * 100))) : 100;
  el.innerHTML = `
    <div style="background:${t.card};border:2px solid ${t.border};box-shadow:${t.glow};border-radius:16px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="font-size:40px;line-height:1;">${t.icon}</div>
          <div>
            <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Your rank</div>
            <div style="font-size:22px;font-weight:800;color:${t.color};">${t.name}${me ? ` · #${idx + 1}` : ""}</div>
            ${me && me.assignedRank ? `<div style="font-size:11px;color:#6b7280;">Awarded by an admin</div>` : ""}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:28px;font-weight:800;color:${t.color};">${pts} pts</div>
          ${me ? `<div style="font-size:12px;color:#6b7280;">${me.lent} lent · ${me.borrowed} borrowed · ${me.offers} helped</div>` : ""}
        </div>
      </div>
      <div style="margin-top:14px;height:10px;background:rgba(0,0,0,.07);border-radius:999px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${t.color};border-radius:999px;transition:width .6s;"></div>
      </div>
      <div style="font-size:12px;color:#4b5563;margin-top:6px;">
        ${nt ? `${Math.max(0, nt.min - pts)} more points to reach <b>${nt.icon} ${nt.name}</b>` : "You've reached the top tier. Legend!"}
      </div>
    </div>`;
}

function render({ ranked, totals }) {
  const listEl = document.getElementById("leaderboard-list");
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
  setText("lead-stat-items", totals.items);
  setText("lead-stat-borrows", totals.borrows);
  setText("lead-stat-members", totals.members);
  setText("lead-stat-requests", totals.requests);
  renderTierLegend();
  myRankCard(ranked);

  const podiumEl = document.getElementById("podium");
  if (podiumEl) {
    const top = ranked.slice(0, 3);
    if (top.length) {
      // Visual order: 2nd, 1st, 3rd
      const order = [top[1] && { m: top[1], p: 2 }, { m: top[0], p: 1 }, top[2] && { m: top[2], p: 3 }].filter(Boolean);
      podiumEl.innerHTML = order.map((o) => podiumCard(o.m, o.p)).join("");
    } else podiumEl.innerHTML = "";
  }

  if (!ranked.length) {
    listEl.innerHTML = `<p style="text-align: center; color: #6b7280; padding: 20px;">No activity yet. Lend an item, borrow something or post a request to get on the board!</p>`;
    return;
  }

  const cols = "56px 1fr 80px 80px 80px 90px";
  let html = `
    <div style="overflow-x: auto;">
    <div style="min-width: 600px; display: flex; flex-direction: column; gap: 6px;">
      <div style="display: grid; grid-template-columns: ${cols}; font-weight: 600; font-size: 12px; color: #6b7280; padding-bottom: 8px; border-bottom: 1px solid #d5e3da; text-transform: uppercase; letter-spacing: 0.03em;">
        <span>Rank</span><span>Member</span>
        <span style="text-align:center;">Lent</span>
        <span style="text-align:center;">Borrowed</span>
        <span style="text-align:center;">Helped</span>
        <span style="text-align:right;">Points</span>
      </div>`;

  ranked.forEach((m, i) => {
    const rank = i + 1;
    const t = m.tier;
    const isMe = myUid && m.uid === myUid;
    html += `
      <div style="display: grid; grid-template-columns: ${cols}; align-items: center; padding: 10px 8px; border: 1px solid ${t.border}; background: ${t.card}; box-shadow: ${rank <= 3 ? t.glow : "none"}; border-radius: 12px; ${isMe ? "outline: 2px solid #86efac;" : ""}">
        <div>
          <span style="background: ${t.bg}; color: ${t.color}; border: 1px solid ${t.border}; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px;">${rank}</span>
        </div>
        <div style="font-weight: 600; color: #0e1a12; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          ${escapeHtml(m.name)} ${rank === 1 ? "🏆" : ""}
          ${tierBadgeHtml(t, true)}
          ${isMe ? `<span style="font-size: 11px; font-weight: 600; color: #14632f; background: #d3f5df; padding: 2px 8px; border-radius: 999px;">You</span>` : ""}
        </div>
        <div style="text-align:center;">${m.lent}</div>
        <div style="text-align:center;">${m.borrowed}</div>
        <div style="text-align:center;" title="Offers to lend on requests">${m.offers}</div>
        <div style="text-align: right; font-weight: 700; color: ${t.color};">${m.points} pts</div>
      </div>`;
  });

  html += `</div></div>`;
  listEl.innerHTML = html;
}
