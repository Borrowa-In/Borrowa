import { ADMIN_EMAIL } from "./firebase-config.js";
import { guardAdminPage } from "./auth.js";
import { TIERS, loadRankConfig, saveRankConfig, getRankConfig, tierBadgeHtml, adminBadgeHtml } from "./ranks.js";
import { createColorStudio } from "./color-studio.js";
import {
  GRADIENT_PRESETS, MAX_CUSTOM_RANKS, tierLook, contrastText, safeHex, clampAngle, newRankId,
} from "./rank-style.js";

// Ranks tab (admin.html). Only the MAIN admin sees it; firestore.rules also refuse everyone else.
// Everything happens inline on the page: no pop-ups, no browser colour dialog.

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Starting gradients the first time a built-in rank is restyled.
const DEFAULT_STYLES = {
  none:     { c1: "#f3f4f6", c2: "#d1d5db", angle: 135, text: "#374151" },
  bronze:   { c1: "#fdba74", c2: "#c2652a", angle: 135, text: "#431407" },
  silver:   { c1: "#e5e7eb", c2: "#94a3b8", angle: 135, text: "#1e293b" },
  gold:     { c1: "#fde047", c2: "#d97706", angle: 135, text: "#451a03" },
  platinum: { c1: "#a5f3fc", c2: "#0891b2", angle: 135, text: "#083344" },
  diamond:  { c1: "#c4b5fd", c2: "#6d28d9", angle: 135, text: "#ffffff" },
  admin:    { c1: "#0a1a10", c2: "#14632f", angle: 135, text: "#ffffff" },
};
const QUICK_ICONS = ["👑", "🌟", "⭐", "🔥", "💫", "🏆", "🎖️", "🦁", "🚀", "🌈", "🧠", "❤️", "🍀", "⚡"];

const listEl = document.getElementById("rk-list");
const editorEl = document.getElementById("rk-editor");
let cfg = { overrides: {}, custom: [] };
let editing = null;          // { key, isCustom, isAdmin, name, icon, min, style, isNew }
let studio = null;
let deleteArmed = false;

const entryStyle = (key) => (cfg.overrides[key] || DEFAULT_STYLES[key] || DEFAULT_STYLES.none);

function badgeFor(e) {
  if (e.isAdmin) { return adminBadgeHtml(false); }
  const look = tierLook(e.style);
  return tierBadgeHtml({ name: e.name || "Rank name", icon: e.icon || "⭐", ...look }, false);
}

function entries() {
  const out = [];
  TIERS.filter((t) => !t.custom).forEach((t) => out.push({
    key: t.key, name: t.name, icon: t.icon, min: t.min, isCustom: false, isAdmin: false,
    style: { ...entryStyle(t.key) }, styled: !!cfg.overrides[t.key],
  }));
  out.push({ key: "admin", name: "Admin", icon: "🛡️", min: null, isCustom: false, isAdmin: true, style: { ...entryStyle("admin") }, styled: !!cfg.overrides.admin });
  cfg.custom.forEach((c) => out.push({
    key: c.id, name: c.name, icon: c.icon, min: c.min, isCustom: true, isAdmin: false,
    style: { c1: c.c1, c2: c.c2, angle: c.angle, text: c.text }, styled: true,
  }));
  return out;
}

function requirement(e) {
  if (e.isAdmin) return "Shown on admin posts";
  if (e.isCustom) return e.min ? `Earned at ${e.min} points · or given by an admin` : "Given by an admin only";
  if (e.key === "moderator") return "Given by admins · can review reports";
  return e.min ? `${e.min}+ points` : "Everyone starts here";
}

function renderList() {
  const all = entries();
  listEl.innerHTML = `
    <button type="button" class="rk-new" id="rk-new" ${cfg.custom.length >= MAX_CUSTOM_RANKS ? "disabled" : ""}>＋ New custom rank</button>
    <div class="rk-group">Built-in ranks</div>
    ${all.filter((e) => !e.isCustom).map(rowHtml).join("")}
    <div class="rk-group">Your custom ranks</div>
    ${all.filter((e) => e.isCustom).map(rowHtml).join("") || `<div class="rk-empty small">None yet. Make one!</div>`}
  `;
}
function rowHtml(e) {
  const on = editing && editing.key === e.key && !editing.isNew ? " on" : "";
  return `<button type="button" class="rk-row${on}" data-key="${esc(e.key)}">
    <span class="rk-row-badge">${badgeFor(e)}</span>
    <span class="rk-row-meta"><b>${esc(e.name)}</b><small>${esc(requirement(e))}${e.styled && !e.isCustom ? " · custom colours" : ""}</small></span>
    <span class="rk-row-go">Edit</span>
  </button>`;
}

function sampleHtml(e) {
  if (e.isAdmin) {
    const look = tierLook(e.style);
    return `<div class="rk-sample" style="background:${look.card};border:2px solid ${look.border};box-shadow:${look.glow}">
      <div>${adminBadgeHtml(true)}</div><div class="rk-sample-title">Sample admin post</div><div class="rk-sample-text">This is how your admin badge looks on a listing.</div></div>`;
  }
  const look = tierLook(e.style);
  return `<div class="rk-sample" style="background:${look.card};border:2px solid ${look.border};box-shadow:${look.glow}">
    <div>${tierBadgeHtml({ name: e.name || "Rank name", icon: e.icon || "⭐", ...look }, true)}</div>
    <div class="rk-sample-title">Sample listing</div><div class="rk-sample-text">Lent by a member with this rank.</div></div>`;
}

function refreshPreview() {
  if (!editing) return;
  const big = document.getElementById("rk-preview-badge");
  const card = document.getElementById("rk-preview-card");
  if (big) big.innerHTML = badgeFor(editing);
  if (card) card.innerHTML = sampleHtml(editing);
}

function openEditor(entry, isNew = false) {
  editing = { ...entry, style: { ...entry.style }, isNew };
  deleteArmed = false;
  const e = editing;
  editorEl.innerHTML = `
    <div class="rk-ed-head">
      <h3>${isNew ? "New custom rank" : `Edit ${esc(e.name)}`}</h3>
      <button type="button" class="rk-x" id="rk-close" aria-label="Close editor">✕</button>
    </div>
    <div class="rk-preview">
      <div id="rk-preview-badge"></div>
      <div id="rk-preview-card"></div>
    </div>
    ${e.isCustom ? `
    <div class="rk-fields">
      <label class="rk-f"><span>Name</span><input type="text" id="rk-name" maxlength="24" placeholder="e.g. Legend" value="${esc(e.name)}" /></label>
      <label class="rk-f"><span>Icon</span><input type="text" id="rk-icon" maxlength="8" value="${esc(e.icon)}" /></label>
      <label class="rk-f"><span>Points (optional)</span><input type="number" id="rk-min" min="1" max="100000" step="1" placeholder="optional" title="Leave empty if only admins should be able to give this rank" value="${e.min ? esc(e.min) : ""}" /></label>
    </div>
    <div class="rk-icons" role="group" aria-label="Quick icons">${QUICK_ICONS.map((i) => `<button type="button" class="rk-icon-btn" data-icon="${i}">${i}</button>`).join("")}</div>` : ""}
    <div class="rk-studio" id="rk-studio"></div>
    <div class="rk-actions">
      <button type="button" class="rk-save" id="rk-save">Save ${isNew ? "rank" : "changes"}</button>
      ${!e.isCustom && cfg.overrides[e.key] ? `<button type="button" class="rk-ghost" id="rk-reset">Reset to default look</button>` : ""}
      ${e.isCustom && !isNew ? `<button type="button" class="rk-danger" id="rk-delete">Delete rank</button>` : ""}
      <span class="rk-status" id="rk-status" role="status" aria-live="polite"></span>
    </div>`;

  studio = createColorStudio(document.getElementById("rk-studio"), {
    slots: [{ key: "c1", label: "Color 1" }, { key: "c2", label: "Color 2" }, { key: "text", label: "Text" }],
    values: { c1: e.style.c1, c2: e.style.c2, text: e.style.text },
    angle: e.style.angle,
    presets: GRADIENT_PRESETS,
    onChange: ({ values, angle }) => {
      editing.style = { c1: values.c1, c2: values.c2, angle, text: values.text };
      refreshPreview();
    },
  });
  refreshPreview();
  renderList();
  editorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setStatus(msg, kind = "") {
  const el = document.getElementById("rk-status");
  if (el) { el.textContent = msg; el.className = "rk-status " + kind; }
}

function closeEditor() {
  editing = null; studio = null;
  editorEl.innerHTML = `<div class="rk-empty">Choose a rank to edit, or press <b>＋ New custom rank</b>.</div>`;
  renderList();
}

async function persist(nextCfg, okMsg) {
  const btn = document.getElementById("rk-save");
  if (btn) btn.disabled = true;
  setStatus("Saving…");
  try {
    cfg = await saveRankConfig(nextCfg);
    document.dispatchEvent(new CustomEvent("borrowa-ranks-saved"));
    renderList();
    setStatus(okMsg, "ok");
  } catch (err) {
    console.error("Couldn't save ranks:", err);
    setStatus("Couldn't save. Publish the updated firestore.rules, then try again.", "bad");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function onSave() {
  const e = editing; if (!e) return;
  const next = JSON.parse(JSON.stringify(cfg));
  const style = { c1: safeHex(e.style.c1), c2: safeHex(e.style.c2) || safeHex(e.style.c1), angle: clampAngle(e.style.angle), text: safeHex(e.style.text) || contrastText(e.style.c1, e.style.c2) };
  if (e.isCustom) {
    const name = (document.getElementById("rk-name").value || "").replace(/\s+/g, " ").trim();
    const icon = (document.getElementById("rk-icon").value || "").trim() || "⭐";
    const minRaw = (document.getElementById("rk-min").value || "").trim();
    if (!name) { setStatus("Give the rank a name first.", "bad"); document.getElementById("rk-name").focus(); return; }
    if (minRaw && !(Number.isInteger(Number(minRaw)) && Number(minRaw) >= 1 && Number(minRaw) <= 100000)) { setStatus("“Points needed” must be a whole number from 1 to 100000 (or empty).", "bad"); return; }
    const dup = [...entries().filter((x) => x.key !== e.key)].some((x) => x.name.toLowerCase() === name.toLowerCase());
    if (dup) { setStatus("There is already a rank with that name.", "bad"); return; }
    const rec = { id: e.key, name, icon, min: minRaw ? Number(minRaw) : null, ...style };
    const i = next.custom.findIndex((c) => c.id === e.key);
    if (i >= 0) next.custom[i] = rec; else next.custom.push(rec);
    editing = { ...e, name, icon, min: rec.min, isNew: false };
    persist(next, `Saved. “${name}” is live on every page.`).then(() => openEditorKeepStatus());
  } else {
    next.overrides[e.key] = style;
    persist(next, `Saved. ${e.name} now uses your gradient.`).then(() => openEditorKeepStatus());
  }
}
// After a save, re-open the editor on the saved rank without losing the "Saved" message.
function openEditorKeepStatus() {
  const msg = (document.getElementById("rk-status") || {}).textContent || "";
  const kind = ((document.getElementById("rk-status") || {}).className || "").includes("ok") ? "ok" : "bad";
  const e = entries().find((x) => x.key === (editing && editing.key));
  if (e && kind === "ok") { openEditor(e, false); setStatus(msg, kind); }
}

function onReset() {
  const e = editing; if (!e) return;
  const next = JSON.parse(JSON.stringify(cfg));
  delete next.overrides[e.key];
  persist(next, `${e.name} is back to its default look.`).then(() => {
    const again = entries().find((x) => x.key === e.key);
    if (again) { const msg = document.getElementById("rk-status").textContent; openEditor(again, false); setStatus(msg, "ok"); }
  });
}

function onDelete() {
  const e = editing; if (!e) return;
  const btn = document.getElementById("rk-delete");
  if (!deleteArmed) {
    deleteArmed = true; btn.textContent = "Click again to delete";
    setStatus("Members who were given this rank go back to their points rank.", "bad");
    return;
  }
  const next = JSON.parse(JSON.stringify(cfg));
  next.custom = next.custom.filter((c) => c.id !== e.key);
  persist(next, `Deleted “${e.name}”.`).then(() => closeEditor());
}

function init(user) {
  const isMain = String((user && user.email) || "").toLowerCase() === ADMIN_EMAIL;
  const tabBtn = document.getElementById("ranks-tab-btn");
  if (!isMain || !listEl || !editorEl) return;   // other admins never see this tab
  if (tabBtn) tabBtn.hidden = false;

  loadRankConfig(true).then(() => { cfg = getRankConfig(); renderList(); });
  renderList();

  listEl.addEventListener("click", (ev) => {
    if (ev.target.closest("#rk-new")) {
      if (cfg.custom.length >= MAX_CUSTOM_RANKS) return;
      const s = { c1: "#8e2de2", c2: "#f368a8", angle: 135, text: "#ffffff" };
      openEditor({ key: newRankId(), name: "", icon: "⭐", min: null, isCustom: true, isAdmin: false, style: s, styled: true }, true);
      document.getElementById("rk-name")?.focus();
      return;
    }
    const row = ev.target.closest(".rk-row");
    if (row) { const e = entries().find((x) => x.key === row.dataset.key); if (e) openEditor(e, false); }
  });

  editorEl.addEventListener("click", (ev) => {
    if (ev.target.closest("#rk-close")) return closeEditor();
    if (ev.target.closest("#rk-save")) return onSave();
    if (ev.target.closest("#rk-reset")) return onReset();
    if (ev.target.closest("#rk-delete")) return onDelete();
    const ic = ev.target.closest(".rk-icon-btn");
    if (ic && editing) { const el = document.getElementById("rk-icon"); if (el) { el.value = ic.dataset.icon; editing.icon = ic.dataset.icon; refreshPreview(); } }
  });
  editorEl.addEventListener("input", (ev) => {
    if (!editing) return;
    if (ev.target.id === "rk-name") { editing.name = ev.target.value; refreshPreview(); }
    if (ev.target.id === "rk-icon") { editing.icon = ev.target.value; refreshPreview(); }
  });
}

document.addEventListener("DOMContentLoaded", () => guardAdminPage(init));
