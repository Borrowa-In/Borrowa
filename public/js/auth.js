import { auth, db, ADMIN_EMAIL, DEV_MODE } from "./firebase-config.js";
import { forgetPushOnThisDevice } from "./push.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteField, serverTimestamp,
  collection, query, where, getDocs, deleteDoc, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { bindDevice, claimEmailKey, isUnlimitedDevice, markDeviceUnlimited, getDeviceId, normalizeEmail } from "./device.js";
import { recordLoginIp, isIpBanned, resetIpCache } from "./ip-guard.js";

// List of automatic administrator emails. Sourced from firebase-config.js's
// ADMIN_EMAIL so there's exactly one place to change it (kept as a list here
// since syncAdminPrivileges() below checks membership, and this leaves room
// to add more auto-admin emails later).
const ADMIN_EMAILS = [ADMIN_EMAIL];

// Records the current IP on the user's profile and, if it's on the admin
// ban list, signs them straight back out. Called right after every
// sign-up/login, and again on every page load via guardPage/guardAdminPage
// so a session that was already open when the ban was applied gets kicked
// out on its next request too — not just future logins.
async function enforceIpGate(user) {
  if (!user || DEV_MODE || isUnlimitedDevice()) return;
  const ip = await recordLoginIp(user.uid);
  if (ip && await isIpBanned(ip)) {
    await signOut(auth);
    throw new Error("This device/network has been blocked by an admin and can't access Borrowa.");
  }
}

// Accounts registered on the admin's "unlimited device" (testers/{uid}, see firestore.rules).
const testerUids = new Set();
export function isTester(user) { return !!user && testerUids.has(user.uid); }
async function loadTester(user) {
  if (testerUids.has(user.uid)) return;
  try { if ((await getDoc(doc(db, "testers", user.uid))).exists()) testerUids.add(user.uid); } catch (e) {}
}

export async function syncAdminPrivileges(user) {
  if (!user || !user.email) return false;
  const email = user.email.toLowerCase();
  await loadTester(user);
  if (ADMIN_EMAILS.includes(email)) markDeviceUnlimited(user); // flags THIS browser as the admin's unlimited device
  
  // Ensure the user profile exists in the Firestore `users` collection on every auth sync/login
  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        name: user.displayName || email.split("@")[0],
        building: "General",
        createdAt: serverTimestamp(),
      });
    }
    // Emails are private: keep them in userPrivate, and scrub any legacy public copy.
    const privRef = doc(db, "userPrivate", user.uid);
    if (!(await getDoc(privRef)).exists()) await setDoc(privRef, { email: user.email });
    if (userSnap.exists() && userSnap.data().email !== undefined) {
      await updateDoc(userRef, { email: deleteField() });
    }
  } catch (e) {
    console.error("Error ensuring user profile exists:", e);
  }
  
  if (ADMIN_EMAILS.includes(email)) {
    try {
      await setDoc(doc(db, "admins", user.uid), {
        email: user.email,
        autoGranted: true,
        updatedAt: serverTimestamp()
      }, { merge: true });
      return true;
    } catch (e) {
      console.error("Error syncing admin privileges:", e);
    }
  }
  
  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    return adminSnap.exists();
  } catch (e) {
    return false;
  }
}

export async function isAdminUser(user) {
  return await syncAdminPrivileges(user);
}

// "+" aliases (me+2@gmail.com) all land in one inbox, so they could be used to
// mass-produce accounts. firestore.rules refuses them too; this gives a friendly message first.
export function hasPlusAlias(email) {
  if (DEV_MODE || isUnlimitedDevice()) return false; // dev / admin device: me+1@gmail.com etc. are fine
  return /^[^@]*\+[^@]*@/.test(String(email || ""));
}

// Admins skip verification (the permanent admin address isn't a real inbox).
export function needsVerification(user, isAdmin = false) {
  if (!user || isAdmin || DEV_MODE || testerUids.has(user.uid)) return false; // dev: no verification needed
  return user.emailVerified !== true;
}

// Sends Firebase's verification link. Firebase rate-limits repeats, so errors
// like auth/too-many-requests are passed through for the UI to explain.
export async function sendVerification(user) {
  const u = user || auth.currentUser;
  if (!u) throw new Error("Please log in first.");
  await sendEmailVerification(u, { url: new URL("home.html", window.location.href).href });
}

// After clicking the link in their inbox, the member taps "I've verified".
// Reload the user and force a fresh ID token so firestore.rules sees email_verified = true.
export async function refreshVerification() {
  const u = auth.currentUser;
  if (!u) return false;
  await u.reload();
  await u.getIdToken(true);
  return u.emailVerified === true;
}

export async function signUp({ name, email, password, building }) {
  if (hasPlusAlias(email)) {
    throw new Error("Please use your normal email address without a \"+\" in it.");
  }
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  try { await bindDevice(cred.user); await claimEmailKey(cred.user, { strict: true }); }
  catch (e) {
    if (["device-taken", "device-banned", "email-duplicate"].includes(e.code)) await cred.user.delete().catch(() => {});
    throw e;
  }
  try {
    await setDoc(doc(db, "users", cred.user.uid), {
      name: name || email.split("@")[0],
      building: building || "",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "userPrivate", cred.user.uid), { email: cred.user.email });
  } catch (e) {
    console.error("Error creating user profile:", e);
  }
  
  // Provision admin rights if email matches the auto-admin list
  await syncAdminPrivileges(cred.user);
  if (!DEV_MODE && !testerUids.has(cred.user.uid)) try { await sendVerification(cred.user); } catch (e) { console.warn("Couldn't send verification email:", e); }
  resetIpCache();
  await enforceIpGate(cred.user);
  return cred.user;
}

export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try { await bindDevice(cred.user); await claimEmailKey(cred.user, { strict: false }); }
  catch (e) { if (e.code === "device-taken" || e.code === "device-banned") await signOut(auth); throw e; }
  // Ensure user document and admin privileges are synced on login
  await syncAdminPrivileges(cred.user);
  resetIpCache();
  await enforceIpGate(cred.user);
  return cred.user;
}

export async function logOut() {
  await forgetPushOnThisDevice();
  return await signOut(auth);
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

const GUEST_KEY = "borrowaGuest";
export function enterGuestMode() { sessionStorage.setItem(GUEST_KEY, "1"); }
export function isGuest() { return sessionStorage.getItem(GUEST_KEY) === "1"; }

export function guardPage(onAuth) {
  onAuthStateChanged(auth, (user) => {
    if (!user && !isGuest()) {
      // Not logged in and never clicked "continue as guest" — bounce to
      // the landing page instead of letting the protected page render.
      window.location.href = "index.html";
      return;
    }
    // Show the page straight away. The IP-ban check now runs in the
    // background (it's cached, see ip-guard.js) instead of holding up every
    // page change; if it finds a ban it signs the person out and redirects.
    if (onAuth) onAuth(user);
    if (user) {
      enforceIpGate(user).catch(() => {
        window.location.href = "login.html?blocked=ip";
      });
    }
  });
}

export function guardAdminPage(onAdmin) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html?next=admin.html";
    } else {
      try {
        await enforceIpGate(user);
      } catch (e) {
        window.location.href = "login.html?blocked=ip";
        return;
      }
      const authorized = await isAdminUser(user);
      if (!authorized) {
        window.location.href = "home.html";
      } else if (onAdmin) {
        onAdmin(user);
      }
    }
  });
}

// Always resolves the same way whether or not the email exists, so the form
// can't be used to find out who has an account.
export async function resetPassword(email) {
  try { await sendPasswordResetEmail(auth, String(email || "").trim()); }
  catch (e) { if (e.code === "auth/invalid-email" || e.code === "auth/too-many-requests") throw e; }
}


async function callFn(name, data) {
  const [{ getFunctions, httpsCallable }, { getApp }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
  ]);
  return (await httpsCallable(getFunctions(getApp(), "us-central1"), name)(data)).data;
}
export const requestEmailOtp = () => callFn("sendEmailOtp", {});
export async function verifyEmailOtp(code) {
  await callFn("verifyEmailOtp", { code: String(code).trim() });
  return refreshVerification();   // pulls a fresh token so firestore.rules sees email_verified
}


// Used by the "this device is full" dialog (js/device-full.js). The person proves they own an
// account on this device by entering its password, then that account is deleted for good:
// its slot on the device, its listings, its profile and its sign-in. (Chats and old requests
// are left as they are.) Everything that can fail is done BEFORE the sign-in is removed.
export async function deleteAccountOnThisDevice(email, password) {
  email = String(email || "").trim();
  if (email.toLowerCase() === ADMIN_EMAIL) throw new Error("The admin account can't be deleted here.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const user = cred.user;
  const uid = user.uid;
  try {
    // 1. Free the slot on this device.
    const ref = doc(db, "devices", getDeviceId());
    const snap = await getDoc(ref);
    if (snap.exists() && (snap.data().uids || []).includes(uid)) {
      await updateDoc(ref, { uids: arrayRemove(uid), [`emails.${uid}`]: deleteField() });
    }
    // 2. Remove their listings (and photos), then the records that identify them. Profile last:
    //    the security rules look at it for the other deletes.
    const items = await getDocs(query(collection(db, "items"), where("userId", "==", uid)));
    await Promise.allSettled(items.docs.flatMap((d) => [deleteDoc(doc(db, "itemPhotos", d.id)), deleteDoc(d.ref)]));
    await Promise.allSettled([
      deleteDoc(doc(db, "emailKeys", normalizeEmail(user.email))),
      deleteDoc(doc(db, "testers", uid)),
    ]);
    await Promise.allSettled([deleteDoc(doc(db, "userPrivate", uid))]);
    await Promise.allSettled([deleteDoc(doc(db, "users", uid))]);
  } catch (e) {
    await signOut(auth).catch(() => {});
    throw new Error("Couldn't free this device. Please try again.");
  }
  await deleteUser(user);
}
