// Ratings after a loan (firestore.rules: ratings/{itemId_raterUid}). One rating per person per listing, never edited.
// Ratings are shown next to the lender's name; they do not change leaderboard points.
import { auth, db } from "./firebase-config.js";
import { doc, setDoc, getDocs, collection, query, where, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const ratingId = (itemId, raterUid) => `${itemId}_${raterUid}`;

export function summarize(list) {
  const scores = list.map((r) => Number(r.score)).filter((n) => n >= 1 && n <= 5);
  if (!scores.length) return { count: 0, avg: 0 };
  return { count: scores.length, avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 };
}

export async function loadRatingSummary(uid) {
  try {
    const snap = await getDocs(query(collection(db, "ratings"), where("rateeId", "==", uid), limit(100)));
    return summarize(snap.docs.map((d) => d.data()));
  } catch (e) { return { count: 0, avg: 0 }; }
}

export const ratingText = (s) => (s && s.count ? `⭐ ${s.avg.toFixed(1)} (${s.count})` : "No ratings yet");

export async function saveRating({ itemId, rateeId, score, comment = "" }) {
  const me = auth.currentUser;
  if (!me) throw new Error("Please log in.");
  const n = Math.round(Number(score));
  if (!(n >= 1 && n <= 5)) throw new Error("Pick 1 to 5 stars.");
  return setDoc(doc(db, "ratings", ratingId(itemId, me.uid)), {
    itemId, raterId: me.uid, rateeId, score: n, comment: String(comment).slice(0, 200), createdAt: serverTimestamp(),
  });
}

// Small pop-up: stars + optional comment. Resolves true if a rating was saved.
export function promptRating({ itemId, rateeId, rateeName }) {
  return new Promise((resolve) => {
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    o.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:380px;width:100%;padding:20px;box-sizing:border-box;">
      <h3 style="margin:0 0 8px;">Rate ${esc(rateeName || "this neighbour")}</h3>
      <div id="rt-stars" style="font-size:30px;cursor:pointer;letter-spacing:4px;user-select:none;">☆☆☆☆☆</div>
      <textarea id="rt-note" maxlength="200" rows="2" placeholder="Optional comment" style="width:100%;margin-top:8px;padding:9px;box-sizing:border-box;"></textarea>
      <div id="rt-msg" style="min-height:18px;font-size:13px;font-weight:600;margin:6px 0;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-outline btn-sm" id="rt-skip">Skip</button><button class="btn btn-primary btn-sm" id="rt-send">Submit</button></div></div>`;
    document.body.appendChild(o);
    let score = 0;
    const stars = o.querySelector("#rt-stars"), msg = o.querySelector("#rt-msg");
    const paint = () => { stars.textContent = "★".repeat(score) + "☆".repeat(5 - score); };
    stars.addEventListener("click", (e) => {
      const r = stars.getBoundingClientRect();
      score = Math.min(5, Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * 5)));
      paint();
    });
    const done = (v) => { o.remove(); resolve(v); };
    o.querySelector("#rt-skip").onclick = () => done(false);
    o.querySelector("#rt-send").onclick = async () => {
      if (!score) { msg.textContent = "Tap a star first."; return; }
      msg.textContent = "Saving…";
      try { await saveRating({ itemId, rateeId, score, comment: o.querySelector("#rt-note").value }); done(true); }
      catch (e) { msg.textContent = e.code === "permission-denied" ? "You've already rated this loan." : "Couldn't save the rating."; }
    };
  });
}
