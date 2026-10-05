// Notices page: every notice meant for this member (their rank or "everyone"), newest first.
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { noticeCardHtml, NOTICE_CSS, loadFonts, myRankKey, esc } from "./notices.js";

const list = document.getElementById("nt-list");
const st = document.createElement("style"); st.textContent = NOTICE_CSS; document.head.appendChild(st);
loadFonts();

onAuthStateChanged(auth, async (user) => {
  if (!user) { list.innerHTML = '<div class="nt-empty">Log in to see notices.</div>'; return; }
  try {
    const [snap, rank] = await Promise.all([
      getDocs(query(collection(db, "notices"), orderBy("createdAt", "desc"), limit(50))),
      myRankKey(user.uid),
    ]);
    const now = Date.now();
    const mine = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => (n.targets || []).includes("all") || (n.targets || []).includes(rank));
    if (!mine.length) { list.innerHTML = '<div class="nt-empty">No notices for you right now 🎉</div>'; return; }
    list.innerHTML = mine.map((n) => {
      const old = n.expiresAt && n.expiresAt.toMillis && n.expiresAt.toMillis() < now;
      const when = n.createdAt && n.createdAt.toDate ? n.createdAt.toDate().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
      return `<div class="${old ? "nt-old" : ""}">${noticeCardHtml(n)}<div class="nt-meta">${esc(n.authorName || "Borrowa team")} · ${esc(when)}${old ? " · expired" : ""}</div></div>`;
    }).join("");
  } catch (e) { console.error(e); list.innerHTML = '<div class="nt-empty">Couldn\'t load notices. Try again.</div>'; }
});
