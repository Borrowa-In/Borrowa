// Account-abuse limits that are free and honest about their limits:
//  1. A device may hold up to 2 accounts (a family phone or a mistaken first signup is fine).
//  2. When an admin bans someone, the devices they used are blocked too, so a banned
//     person can't just sign up again on the same phone/browser. This is the main benefit.
//  3. Gmail dot-tricks (a.b@gmail.com vs ab@gmail.com) are treated as the same email.
// When a 3rd account tries to use a full device, the error carries the list of accounts on it
// (e.accounts) so login.html can ask the person to delete one (js/device-full.js).
// Limit: incognito, another browser or cleared site data gives a fresh device ID.
import { db, ADMIN_EMAIL, DEV_MODE } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, arrayUnion, getDocs, query, collection, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const MAX_ACCOUNTS_PER_DEVICE = 2;

// "Unlimited device": the admin's own browser. When the permanent admin signs in on a
// browser, that browser's device record is flagged `unlimited` (only an admin can write
// that flag - see firestore.rules). Accounts created or used on a flagged device then get:
// no 2-accounts cap, no email-verification requirement, no "+"/dotted-email refusal,
// no IP gate and no new-account posting cap. The real enforcement is in firestore.rules;
// the localStorage flag below only switches off the matching client-side pre-checks.
const UNLIMITED_FLAG = "borrowa_unlimited";
export function isUnlimitedDevice() {
  try { return localStorage.getItem(UNLIMITED_FLAG) === "1"; } catch (e) { return false; }
}
export async function markDeviceUnlimited(user) {
  if (!user || (user.email || "").toLowerCase() !== ADMIN_EMAIL) return;
  if (isUnlimitedDevice()) return;
  try {
    const ref = doc(db, "devices", getDeviceId());
    const snap = await getDoc(ref);
    if (snap.exists()) await updateDoc(ref, { unlimited: true });
    else await setDoc(ref, { uids: [], banned: false, unlimited: true, createdAt: serverTimestamp() });
    localStorage.setItem(UNLIMITED_FLAG, "1");
  } catch (e) { console.warn("Couldn't flag this device as unlimited:", e); }
}

function readCookie() { const m = document.cookie.match(/(?:^|; )borrowa_device=([A-Za-z0-9-]{20,64})/); return m ? m[1] : null; }
export function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem("borrowa_device"); } catch (e) {}
  id = id || readCookie();
  if (!id || !/^[A-Za-z0-9-]{20,64}$/.test(id)) id = crypto.randomUUID();
  try { localStorage.setItem("borrowa_device", id); } catch (e) {}
  document.cookie = `borrowa_device=${id}; max-age=63072000; path=/; SameSite=Lax`;
  return id;
}

function fail(code, msg) { const e = new Error(msg); e.code = code; return e; }

export async function bindDevice(user) {
  if (DEV_MODE) return; // dev: unlimited accounts per device
  if (!user || (user.email || "").toLowerCase() === ADMIN_EMAIL) return;
  const ref = doc(db, "devices", getDeviceId());
  const snap = await getDoc(ref);
  try {
    const myEmail = (user.email || "").toLowerCase();
    const emailPath = `emails.${user.uid}`;
    if (!snap.exists()) { await setDoc(ref, { uids: [user.uid], emails: { [user.uid]: myEmail }, banned: false, createdAt: serverTimestamp() }); return; }
    const d = snap.data();
    if (d.banned) throw fail("device-banned", "This device has been blocked by an admin.");
    if (d.unlimited) {
      // Admin's device: register this account as a tester (lifts verification / post caps)
      // and add it to the device list so banning the device still covers it.
      try { localStorage.setItem(UNLIMITED_FLAG, "1"); } catch (e) {}
      await setDoc(doc(db, "testers", user.uid), { deviceId: getDeviceId() });
      if (!(d.uids || []).includes(user.uid)) await updateDoc(ref, { uids: arrayUnion(user.uid), [emailPath]: myEmail });
      return;
    }
    if ((d.uids || []).includes(user.uid)) {
      // Older device records didn't store emails: fill this account's in (best effort, never blocks login).
      if (!(d.emails || {})[user.uid]) { try { await updateDoc(ref, { [emailPath]: myEmail }); } catch (e) {} }
      return;
    }
    if ((d.uids || []).length >= MAX_ACCOUNTS_PER_DEVICE) {
      const err = fail("device-taken", `This device already has the maximum of ${MAX_ACCOUNTS_PER_DEVICE} Borrowa accounts. Delete one of them to continue.`);
      err.accounts = d.uids.map((uid) => ({ uid, email: (d.emails || {})[uid] || null }));
      throw err;
    }
    await updateDoc(ref, { uids: arrayUnion(user.uid), [emailPath]: myEmail });
  } catch (e) {
    if (e.code === "device-banned" || e.code === "device-taken") throw e;
    // Say WHY (e.g. "permission-denied" means the latest firestore.rules are not published yet).
    console.error("Device registration failed:", e);
    const why = e && e.code ? ` (${String(e.code).replace(/[^a-z-]/gi, "").slice(0, 40)})` : "";
    throw fail("device-taken", `Couldn't register this device${why}. Please try again.`);
  }
}

// Admin: block / unblock every device an account has used.
export async function setDevicesBanned(uid, banned) {
  const snap = await getDocs(query(collection(db, "devices"), where("uids", "array-contains", uid)));
  await Promise.all(snap.docs.map((d) => updateDoc(d.ref, { banned })));
  return snap.size;
}

// ---- Gmail-style duplicate emails ----
export function normalizeEmail(email) {
  let [local, domain] = String(email || "").toLowerCase().trim().split("@");
  if (!domain) return "";
  if (domain === "gmail.com" || domain === "googlemail.com") { domain = "gmail.com"; local = local.split("+")[0].replace(/\./g, ""); }
  return (local + "@" + domain).replace(/[^a-z0-9@._-]/g, "_");
}
// Claims the normalized email for this user. Throws if another account already holds it.
export async function claimEmailKey(user, { strict }) {
  if (DEV_MODE || isUnlimitedDevice()) return; // dev / admin device: duplicate or dotted Gmail allowed
  const ref = doc(db, "emailKeys", normalizeEmail(user.email));
  const snap = await getDoc(ref);
  if (snap.exists()) {
    if (snap.data().uid !== user.uid && strict) throw fail("email-duplicate", "That email is already registered (Gmail ignores dots, so a.b@ and ab@ are the same inbox).");
    return;
  }
  try { await setDoc(ref, { uid: user.uid }); } catch (e) { if (strict) throw fail("email-duplicate", "That email is already registered."); }
}
