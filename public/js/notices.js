// Notice board: shared pieces used by the composer (admin + moderator pages) and the home popup.
// Notices live in Firestore `notices/{id}`. Only admins/moderators can post (see firestore.rules).
import { auth, db } from "./firebase-config.js";
import { TIERS, loadRankConfig } from "./ranks.js";
import { GRADIENT_PRESETS } from "./rank-style.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, limit, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Fonts (Google Fonts are allowed by the site's CSP). Keys are stored in the notice.
export const FONTS = {
  playfair: { label: "Playfair (elegant)",  css: "'Playfair Display', Georgia, serif" },
  bebas:    { label: "Bebas (bold caps)",   css: "'Bebas Neue', Impact, sans-serif" },
  poppins:  { label: "Poppins (modern)",    css: "'Poppins', 'Segoe UI', sans-serif" },
  inter:    { label: "Inter (clean)",       css: "'Inter', -apple-system, 'Segoe UI', sans-serif" },
  merri:    { label: "Merriweather (book)", css: "'Merriweather', Georgia, serif" },
  caveat:   { label: "Caveat (handwritten)", css: "'Caveat', 'Comic Sans MS', cursive" },
  mono:     { label: "Mono (typewriter)",   css: "'Courier New', monospace" },
};
const FONT_URL = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Caveat:wght@500;700&family=Inter:wght@400;500;600&family=Merriweather:wght@400;700&family=Playfair+Display:wght@700;900&family=Poppins:wght@400;500;600;700&display=swap";
export function loadFonts() {
  if (document.getElementById("notice-fonts")) return;
  const l = document.createElement("link"); l.id = "notice-fonts"; l.rel = "stylesheet"; l.href = FONT_URL;
  document.head.appendChild(l);
}
export const fontCss = (k, fallback) => (FONTS[k] || FONTS[fallback]).css;

// Gradients only (no free colour picker).
export const GRADIENTS = GRADIENT_PRESETS;
export const gradCss = (g) => `linear-gradient(${g.angle || 135}deg, ${g.c1}, ${g.c2})`;

// Automatic sizing: shorter text -> bigger. `scale` is the admin's optional override.
const SCALE = { small: 0.85, auto: 1, large: 1.2 };
export function autoSizes(title, body, scale = "auto") {
  const k = SCALE[scale] || 1;
  const tl = (title || "").length, bl = (body || "").length;
  const t = tl <= 18 ? 34 : tl <= 36 ? 28 : tl <= 60 ? 23 : 19;
  const b = bl <= 80 ? 19 : bl <= 200 ? 16.5 : bl <= 450 ? 15 : 13.5;
  return { title: Math.round(t * k), body: +(b * k).toFixed(1) };
}

// One renderer for both the live preview and the popup.
export function noticeCardHtml(n) {
  const g = { c1: n.c1, c2: n.c2, angle: n.angle };
  const s = autoSizes(n.title, n.body, n.sizeScale);
  const text = n.text || "#ffffff";
  return `<div class="nb-card" style="background:${gradCss(g)};color:${esc(text)};">
    <div class="nb-title" style="font-family:${fontCss(n.titleFont, "playfair")};font-size:${s.title}px;">${esc(n.title) || "Your title"}</div>
    <div class="nb-body" style="font-family:${fontCss(n.bodyFont, "inter")};font-size:${s.body}px;">${esc(n.body) || "Your message appears here…"}</div>
  </div>`;
}
export const NOTICE_CSS = `
.nb-card{border-radius:16px;padding:26px 24px;box-shadow:0 12px 30px rgba(0,0,0,.25);word-wrap:break-word;overflow-wrap:anywhere}
.nb-title{font-weight:700;line-height:1.15;margin-bottom:12px}
.nb-body{line-height:1.5;white-space:pre-wrap}`;

// ---------- Composer ----------
const COMPOSER_CSS = NOTICE_CSS + `
.nbc{display:grid;grid-template-columns:1.1fr 1fr;gap:22px}
@media(max-width:820px){.nbc{grid-template-columns:1fr}}
.nbc label.l{display:block;font-size:12px;font-weight:700;color:#374151;margin:12px 0 4px}
.nbc input[type=text],.nbc textarea,.nbc select{width:100%;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font:inherit;font-size:14px;box-sizing:border-box}
.nbc textarea{min-height:110px;resize:vertical}
.nbc-row{display:flex;gap:10px}.nbc-row>*{flex:1}
.nbc-send{border:1px solid #d5e3da;border-radius:10px;padding:10px 12px;background:#f6faf7;margin-bottom:6px}
.nbc-send h4{margin:0 0 6px;font-size:13px;text-align:right}
.nbc-ranks{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:flex-end}
.nbc-ranks label{font-size:13px;display:inline-flex;gap:5px;align-items:center;cursor:pointer}
.nbc-grads{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.nbc-g{height:34px;border-radius:8px;border:3px solid transparent;cursor:pointer;padding:0}
.nbc-g.on{border-color:#111827;box-shadow:0 0 0 2px #fff inset}
.nbc-btn{background:linear-gradient(180deg,#218c4a,#17703a);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer;margin-top:14px}
.nbc-btn:disabled{opacity:.6}
.nbc-msg{font-size:13px;margin-left:10px}
.nbc-list{margin-top:26px}.nbc-item{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border:1px solid #d5e3da;border-radius:10px;margin-bottom:8px;background:#fff;font-size:13px}
.nbc-item b{display:block;font-size:14px}.nbc-del{background:#fee2e2;color:#991b1b;border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:600}`;

export async function mountNoticeComposer(root, { isAdmin = false } = {}) {
  if (!root) return;
  loadFonts();
  await loadRankConfig();
  if (!document.getElementById("nbc-css")) {
    const st = document.createElement("style"); st.id = "nbc-css"; st.textContent = COMPOSER_CSS; document.head.appendChild(st);
  }
  const fontOpts = (sel) => Object.entries(FONTS).map(([k, f]) => `<option value="${k}"${k === sel ? " selected" : ""}>${f.label}</option>`).join("");
  root.innerHTML = `<div class="nbc">
    <div>
      <label class="l">Title</label>
      <input type="text" id="nbc-title" maxlength="80" placeholder="e.g. Maintenance this Sunday" />
      <div class="nbc-row">
        <div><label class="l">Title font</label><select id="nbc-tfont">${fontOpts("playfair")}</select></div>
        <div><label class="l">Body font</label><select id="nbc-bfont">${fontOpts("inter")}</select></div>
      </div>
      <label class="l">Message</label>
      <textarea id="nbc-body" maxlength="800" placeholder="Write the notice…"></textarea>
      <div class="nbc-row">
        <div><label class="l">Text size (auto-fits your text)</label>
          <select id="nbc-scale"><option value="small">Smaller</option><option value="auto" selected>Auto</option><option value="large">Larger</option></select></div>
        <div><label class="l">Keep it up for</label>
          <select id="nbc-exp"><option value="24">1 day</option><option value="72">3 days</option><option value="168" selected>7 days</option><option value="720">30 days</option><option value="0">Until I delete it</option></select></div>
      </div>
      <label class="l">Background (gradients)</label>
      <div class="nbc-grads" id="nbc-grads"></div>
      <button type="button" class="nbc-btn" id="nbc-post">📢 Post notice</button><span class="nbc-msg" id="nbc-msg"></span>
    </div>
    <div>
      <div class="nbc-send"><h4>Send to:</h4>
        <div class="nbc-ranks" id="nbc-ranks">
          <label><input type="checkbox" id="nbc-all" checked /> <b>Everyone</b></label>
          ${TIERS.map((t) => `<label><input type="checkbox" class="nbc-rk" value="${esc(t.key)}" /> ${esc(t.icon || "")} ${esc(t.name)}</label>`).join("")}
        </div></div>
      <label class="l">Live preview</label>
      <div id="nbc-preview"></div>
    </div>
  </div>
  <div class="nbc-list"><h3 style="margin:0 0 10px">Posted notices</h3><div id="nbc-list">Loading…</div></div>`;

  const $ = (id) => root.querySelector("#" + id);
  let gi = 0;
  const gradsEl = $("nbc-grads");
  gradsEl.innerHTML = GRADIENTS.map((g, i) => `<button type="button" class="nbc-g${i === 0 ? " on" : ""}" data-i="${i}" title="${esc(g.name)}" style="background:${gradCss(g)}"></button>`).join("");
  const draft = () => {
    const g = GRADIENTS[gi];
    return { title: $("nbc-title").value.trim(), body: $("nbc-body").value.trim(), titleFont: $("nbc-tfont").value, bodyFont: $("nbc-bfont").value,
      sizeScale: $("nbc-scale").value, c1: g.c1, c2: g.c2, angle: g.angle, text: g.text };
  };
  const paint = () => { $("nbc-preview").innerHTML = noticeCardHtml(draft()); };
  root.addEventListener("input", paint); root.addEventListener("change", paint);
  gradsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".nbc-g"); if (!b) return;
    gi = +b.dataset.i; gradsEl.querySelectorAll(".nbc-g").forEach((x) => x.classList.toggle("on", x === b)); paint();
  });
  // "Everyone" and the individual ranks are exclusive of each other.
  const all = $("nbc-all"), rks = () => [...root.querySelectorAll(".nbc-rk")];
  all.addEventListener("change", () => { if (all.checked) rks().forEach((r) => (r.checked = false)); });
  rks().forEach((r) => r.addEventListener("change", () => { if (r.checked) all.checked = false; if (!rks().some((x) => x.checked)) all.checked = true; }));
  paint();

  async function refresh() {
    const listEl = $("nbc-list");
    try {
      const snap = await getDocs(query(collection(db, "notices"), orderBy("createdAt", "desc"), limit(30)));
      const me = auth.currentUser && auth.currentUser.uid;
      if (snap.empty) { listEl.textContent = "No notices yet."; return; }
      listEl.innerHTML = snap.docs.map((d) => {
        const n = d.data(), mine = n.authorId === me, exp = n.expiresAt && n.expiresAt.toMillis && n.expiresAt.toMillis() < Date.now();
        return `<div class="nbc-item"><div><b>${esc(n.title)}</b>To: ${esc((n.targets || []).join(", "))} · by ${esc(n.authorName || "")}${exp ? " · <i>expired</i>" : ""}</div>
          ${(isAdmin || mine) ? `<button class="nbc-del" data-id="${d.id}">Delete</button>` : ""}</div>`;
      }).join("");
    } catch (e) { listEl.textContent = "Couldn't load notices."; }
  }
  $("nbc-list").addEventListener("click", async (e) => {
    const b = e.target.closest(".nbc-del"); if (!b) return;
    b.disabled = true;
    try { await deleteDoc(doc(db, "notices", b.dataset.id)); } catch (err) { alert("Couldn't delete."); }
    refresh();
  });

  $("nbc-post").addEventListener("click", async () => {
    const msg = $("nbc-msg"), d = draft();
    const targets = all.checked ? ["all"] : rks().filter((r) => r.checked).map((r) => r.value);
    if (!d.title || !d.body) { msg.style.color = "#b91c1c"; msg.textContent = "Add a title and a message."; return; }
    const btn = $("nbc-post"); btn.disabled = true; msg.style.color = "#6b7280"; msg.textContent = "Posting…";
    try {
      const hrs = +$("nbc-exp").value;
      const u = auth.currentUser;
      await addDoc(collection(db, "notices"), {
        ...d, targets, authorId: u.uid, authorName: u.displayName || (u.email || "").split("@")[0] || "Staff",
        expiresAt: hrs ? Timestamp.fromMillis(Date.now() + hrs * 3600 * 1000) : null,
        createdAt: serverTimestamp(),
      });
      msg.style.color = "#15803d"; msg.textContent = "Posted ✓";
      $("nbc-title").value = ""; $("nbc-body").value = ""; paint(); refresh();
    } catch (e) { console.error(e); msg.style.color = "#b91c1c"; msg.textContent = "Couldn't post (no permission?)."; }
    btn.disabled = false;
  });
  refresh();
}
