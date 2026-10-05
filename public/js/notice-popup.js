// Home page popup: shows notices meant for this member's rank, once per visit.
// "Visit" = browser tab session (sessionStorage): moving between pages doesn't re-show it,
// but closing the site and coming back later does.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { noticeCardHtml, NOTICE_CSS, loadFonts, myRankKey } from "./notices.js";

const SEEN = "borrowa_notices_seen";
const seen = () => { try { return JSON.parse(sessionStorage.getItem(SEEN) || "[]"); } catch (e) { return []; } };
const markSeen = (id) => { try { sessionStorage.setItem(SEEN, JSON.stringify([...new Set([...seen(), id])])); } catch (e) {} };

function show(queue) {
  const n = queue.shift();
  if (!n) return;
  markSeen(n.id);
  loadFonts();
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;";
  wrap.innerHTML = `<style>${NOTICE_CSS}</style><div style="max-width:460px;width:100%;max-height:92vh;overflow:auto;">
    <div style="font-size:12px;font-weight:700;color:#fff;margin:0 4px 8px;letter-spacing:.06em">📢 NOTICE${queue.length ? ` · ${queue.length} more` : ""}</div>
    ${noticeCardHtml(n)}
    <button type="button" id="nb-ok" style="margin-top:12px;width:100%;padding:11px;border:0;border-radius:10px;background:#fff;font-weight:700;cursor:pointer;font-size:15px">${queue.length ? "Next" : "Got it"}</button></div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); show(queue); };
  wrap.querySelector("#nb-ok").addEventListener("click", close);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const snap = await getDocs(query(collection(db, "notices"), orderBy("createdAt", "desc"), limit(10)));
    const done = seen(), now = Date.now();
    const fresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !done.includes(n.id) && !(n.expiresAt && n.expiresAt.toMillis && n.expiresAt.toMillis() < now));
    if (!fresh.length) return;
    const rank = await myRankKey(user.uid);
    const mine = fresh.filter((n) => (n.targets || []).includes("all") || (n.targets || []).includes(rank));
    if (mine.length) show(mine.slice(0, 3));
  } catch (e) { console.warn("Notices unavailable:", e); }
});
