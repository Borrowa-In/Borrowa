// "This device is full" dialog. Shown when a 3rd account tries to log in / sign up on a device
// that already has 2 accounts. Lists the accounts on the device and lets the person delete one
// (after entering that account's password) to make room, then continues with what they were doing.
import { deleteAccountOnThisDevice, resetPassword } from "./auth.js";
import { MAIL_NOTE } from "./firebase-config.js";

// true  = show the full email addresses of the accounts on this device
// false = hide the middle of each address (jo••••@gmail.com)
const SHOW_FULL_EMAILS = true;

function maskEmail(e) {
  const [l, d] = String(e).split("@");
  if (!d) return e;
  return l.slice(0, Math.min(2, l.length)) + "••••••@" + d;
}
function el(tag, props = {}, style = "", ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  if (style) n.style.cssText = style;
  for (const k of kids) n.append(k);
  return n;
}
const BTN = "cursor:pointer;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:600;border:1px solid #d1d5db;background:#fff;color:#111;";
const DANGER = "cursor:pointer;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:600;border:1px solid #b91c1c;background:#b91c1c;color:#fff;";
const INPUT = "width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-top:6px;";

// accounts: [{ uid, email|null }]. onDone(): called after one account was deleted (retry the login/sign-up).
export function showDeviceFullDialog(accounts, onDone) {
  document.getElementById("device-full-overlay")?.remove();
  const overlay = el("div", { id: "device-full-overlay" }, "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;");
  const box = el("div", { role: "dialog", "aria-modal": "true" }, "background:#fff;border-radius:16px;width:100%;max-width:460px;max-height:90vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit;color:#111;");
  overlay.append(box);
  const close = () => overlay.remove();

  box.append(
    el("h2", { textContent: "This device already has 2 accounts" }, "margin:0 0 6px;font-size:20px;"),
    el("p", { textContent: "Borrowa allows up to 2 accounts per device. To continue, delete one of the accounts below. Deleting is permanent: the account, its listings and its profile are removed." }, "margin:0 0 14px;font-size:14px;line-height:1.5;color:#4b5563;")
  );
  const status = el("p", {}, "margin:12px 0 0;font-size:13.5px;font-weight:600;min-height:18px;");
  const list = el("div", {}, "display:flex;flex-direction:column;gap:10px;");
  box.append(list);

  accounts.forEach((acc) => {
    const row = el("div", {}, "border:1px solid #e5e7eb;border-radius:12px;padding:12px;");
    const label = acc.email
      ? el("div", { textContent: SHOW_FULL_EMAILS ? acc.email : maskEmail(acc.email) }, "font-weight:600;font-size:15px;word-break:break-all;")
      : el("div", { textContent: "Older account (email not recorded)" }, "font-weight:600;font-size:15px;");
    const delBtn = el("button", { type: "button", textContent: "Delete this account" }, BTN + "margin-top:8px;");
    const panel = el("div", {}, "display:none;margin-top:8px;");
    const emailIn = acc.email ? null : el("input", { type: "email", placeholder: "Email of this account", autocomplete: "off" }, INPUT);
    const pwIn = el("input", { type: "password", placeholder: "Password of this account", autocomplete: "current-password" }, INPUT);
    const confirm = el("button", { type: "button", textContent: "Delete permanently and continue" }, DANGER + "margin-top:10px;");
    const forgot = el("a", { href: "#", textContent: "Forgot its password?" }, "display:inline-block;margin-top:10px;margin-left:12px;font-size:13px;");
    panel.append(...(emailIn ? [emailIn] : []), pwIn, confirm, forgot);
    row.append(label, delBtn, panel);
    list.append(row);

    delBtn.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "block" : "none"; });
    forgot.addEventListener("click", async (e) => {
      e.preventDefault();
      const addr = acc.email || (emailIn && emailIn.value.trim());
      if (!addr) { status.style.color = "#b91c1c"; status.textContent = "Type that account's email first."; return; }
      try { await resetPassword(addr); status.style.color = "#065f46"; status.textContent = "If that account exists, a reset link is on its way. " + MAIL_NOTE; }
      catch (err) { status.style.color = "#b91c1c"; status.textContent = "Couldn't send the reset email. Try again shortly."; }
    });
    confirm.addEventListener("click", async () => {
      const addr = acc.email || (emailIn && emailIn.value.trim());
      if (!addr || !pwIn.value) { status.style.color = "#b91c1c"; status.textContent = "Enter the password" + (acc.email ? "" : " and email") + " of the account you want to delete."; return; }
      confirm.disabled = true; delBtn.disabled = true;
      status.style.color = "#4b5563"; status.textContent = "Deleting…";
      try {
        await deleteAccountOnThisDevice(addr, pwIn.value);
        status.style.color = "#065f46"; status.textContent = "Account deleted. Continuing…";
        close();
        await onDone();
      } catch (err) {
        const bad = ["auth/wrong-password", "auth/invalid-credential", "auth/user-not-found", "auth/invalid-email"].includes(err.code);
        status.style.color = "#b91c1c";
        status.textContent = bad ? "That email/password doesn't match an account. Nothing was deleted." : (err.message || "Couldn't delete the account.").replace("Firebase: ", "");
        confirm.disabled = false; delBtn.disabled = false;
      }
    });
  });

  const cancel = el("button", { type: "button", textContent: "Cancel" }, BTN + "margin-top:14px;");
  cancel.addEventListener("click", close);
  box.append(status, cancel, el("p", { textContent: "Can't get into either account? Contact an admin and ask them to release this device." }, "margin:12px 0 0;font-size:12.5px;color:#6b7280;"));
  document.body.append(overlay);
}
