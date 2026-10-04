import { auth, MAIL_SENDER_NAME, MAIL_SENDER_ADDRESS } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { isAdminUser, needsVerification, sendVerification, refreshVerification } from "./auth.js";

// Shows a banner under the nav while a signed-in member hasn't verified their
// email. Until they do, firestore.rules blocks lending, borrowing, requesting
// and offering (browsing and chatting still work).

const BANNER_ID = "verify-banner";

function remove() { document.getElementById(BANNER_ID)?.remove(); }

function show(user) {
  if (document.getElementById(BANNER_ID)) return;
  const bar = document.createElement("div");
  bar.id = BANNER_ID;
  bar.setAttribute("role", "status");
  bar.style.cssText = "background:#fef3c7;border-bottom:1px solid #fcd34d;color:#78350f;font-size:13.5px;padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;text-align:center;";

  const msg = document.createElement("span");
  msg.textContent = `Verify your email to lend, borrow and post requests. We sent a link to ${user.email} from \"${MAIL_SENDER_NAME}\" (${MAIL_SENDER_ADDRESS}). Not there? Check Spam/Junk.`;

  const mk = (label, filled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `cursor:pointer;border-radius:6px;padding:5px 12px;font-size:12.5px;font-weight:600;border:1px solid #92400e;${filled ? "background:#92400e;color:#fff;" : "background:#fff;color:#92400e;"}`;
    return b;
  };
  const resend = mk("Resend email", false);
  const done = mk("I've verified", true);
  const note = document.createElement("span");
  note.style.cssText = "font-weight:600;";

  resend.addEventListener("click", async () => {
    resend.disabled = true;
    try {
      await sendVerification(user);
      note.textContent = "Sent! Check your inbox (and spam).";
      setTimeout(() => { resend.disabled = false; }, 30000);
    } catch (e) {
      note.textContent = e && e.code === "auth/too-many-requests"
        ? "Too many requests. Please wait a few minutes."
        : "Couldn't send the email. Try again shortly.";
      resend.disabled = false;
    }
  });

  done.addEventListener("click", async () => {
    done.disabled = true;
    note.textContent = "Checking...";
    try {
      if (await refreshVerification()) { remove(); location.reload(); return; }
      note.textContent = "Not verified yet. Click the link in the email first.";
    } catch (e) {
      note.textContent = "Couldn't check. Try again.";
    }
    done.disabled = false;
  });

  bar.append(msg, resend, done, note);
  const nav = document.querySelector("nav.nav");
  if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling);
  else document.body.prepend(bar);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { remove(); return; }
  let admin = false;
  try { admin = await isAdminUser(user); } catch (e) {}
  if (needsVerification(user, admin)) show(user); else remove();
});
