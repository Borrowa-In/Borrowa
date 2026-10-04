// "Report conversation" dialog. Chats are end-to-end encrypted, so admins can't read
// them by default. Reporting lets the reporter share THIS chat's key with admins,
// who then read the real stored messages (not a copy the reporter could fake).
// The key is deleted from the report as soon as an admin closes it.
import { auth, db } from "./firebase-config.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { exportChatKeyForReport } from "./e2ee.js";

export function openChatReport({ chatId, otherUid, otherName }) {
  document.getElementById("chat-report-modal")?.remove();
  const o = document.createElement("div");
  o.id = "chat-report-modal";
  o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  o.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-sizing:border-box;">
    <h3 style="margin:0 0 6px;">Report ${esc(otherName || "this member")}</h3>
    <p style="font-size:13px;color:#4b5563;margin:0 0 12px;">Messages are private. If you report, you share <strong>this conversation</strong> with Borrowa admins so they can check what happened. They are not shown to anyone else, and access is removed when the report is closed.</p>
    <select id="cr-reason" style="width:100%;padding:9px;margin-bottom:8px;"><option>Harassment or abuse</option><option>Scam / asking for money</option><option>Threats</option><option>Inappropriate content</option><option>Other</option></select>
    <textarea id="cr-details" maxlength="500" rows="3" placeholder="What happened? (optional)" style="width:100%;padding:9px;box-sizing:border-box;"></textarea>
    <div id="cr-msg" style="min-height:20px;font-size:13px;font-weight:600;margin:6px 0;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-outline btn-sm" id="cr-cancel">Cancel</button><button class="btn btn-primary btn-sm" id="cr-send">Share with admins &amp; report</button></div></div>`;
  document.body.appendChild(o);
  const q = (id) => o.querySelector("#" + id), msg = q("cr-msg");
  q("cr-cancel").onclick = () => o.remove();
  o.addEventListener("click", (e) => { if (e.target === o) o.remove(); });
  q("cr-send").onclick = async () => {
    const me = auth.currentUser;
    if (!me) { msg.textContent = "Please log in."; return; }
    q("cr-send").disabled = true; msg.textContent = "Sending…";
    try {
      const chatKey = await exportChatKeyForReport(otherUid);
      await setDoc(doc(db, "reports", `chat_${chatId}_${me.uid}`), {
        kind: "chat", targetId: otherUid, chatId, chatKey,
        reason: q("cr-reason").value, details: q("cr-details").value.slice(0, 500),
        reporterId: me.uid, status: "open", createdAt: serverTimestamp(),
      });
      msg.textContent = "Reported. An admin will review the conversation.";
      setTimeout(() => o.remove(), 1800);
    } catch (e) {
      msg.textContent = e.code === "permission-denied" ? "You've already reported this conversation." : "Couldn't send the report. Try again.";
      q("cr-send").disabled = false;
    }
  };
}
