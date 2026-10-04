// Phone push notifications (Firebase Cloud Messaging).
//
// How it fits together
//   - sw.js (the service worker) shows notifications while the site is closed.
//   - This file asks permission (only after a tap), gets this phone's FCM token and
//     saves it in Firestore `pushTokens/{token}` so the Cloud Functions know where to send.
//   - functions/index.js sends the pushes (new listings, requests, offers, borrows,
//     reminders, chat messages).
//
// Everything is switched off until VAPID_PUBLIC_KEY is set in firebase-config.js, and in
// local dev mode, so the rest of the site is never affected.
import { app, auth, db, DEV_MODE, VAPID_PUBLIC_KEY } from "./firebase-config.js";
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Loaded only when needed, so ordinary page loads stay light.
const MESSAGING_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
const LS_STATE = "borrowa.push.v1";          // { token, uid, broadcast, at } for THIS device
const LS_DISMISS = "borrowa.push.dismissed"; // when the home-page prompt was last dismissed
const REASK_AFTER_MS = 14 * 864e5;
const REFRESH_EVERY_MS = 24 * 36e5;

export const PUSH_CONFIGURED = Boolean(VAPID_PUBLIC_KEY) && !DEV_MODE;

// ---- tiny safe wrappers around localStorage (can throw in private mode) ----
function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

// ---- what can this device do? ----
export function pushSupport() {
  if (!PUSH_CONFIGURED) return { ok: false, reason: "off" };
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  // iPhones only allow web push for sites added to the Home Screen (iOS 16.4+).
  // In a normal Safari tab the Push API does not even exist, so check this first.
  if (ios && !standalone) return { ok: false, reason: "ios-install", ios, standalone };
  const hasApis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!hasApis) return { ok: false, reason: "unsupported", ios, standalone };
  return { ok: true, reason: "ok", ios, standalone };
}

export function pushPermission() {
  return "Notification" in window ? Notification.permission : "unsupported";
}

// Is this device currently set up for the signed-in member?
export function pushState() {
  const s = lsGet(LS_STATE);
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const on = pushPermission() === "granted" && Boolean(s && s.token && uid && s.uid === uid);
  return { on, broadcast: s ? s.broadcast !== false : true };
}

function platformLabel() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

async function fetchToken() {
  // Relative to the page, so it works on a sub-path such as user.github.io/repo/.
  const reg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
  await navigator.serviceWorker.ready;
  const { getMessaging, getToken } = await import(MESSAGING_URL);
  return getToken(getMessaging(app), { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg });
}

async function saveToken(user, token, broadcast) {
  await setDoc(doc(db, "pushTokens", token), {
    uid: user.uid,
    token,
    broadcast: Boolean(broadcast),
    platform: platformLabel(),
    updatedAt: serverTimestamp(),
  });
  lsSet(LS_STATE, { token, uid: user.uid, broadcast: Boolean(broadcast), at: Date.now() });
}

export function supportMessage(sup) {
  if (sup.reason === "ios-install") {
    return "On iPhone, alerts work once Borrowa is on your Home Screen: tap the Share button, choose \u201CAdd to Home Screen\u201D, open Borrowa from there, then turn alerts on. (Needs iOS 16.4 or newer.)";
  }
  return "This browser can\u2019t show phone alerts. On Android use Chrome; on iPhone add Borrowa to your Home Screen.";
}

// ---- actions ----
// Must be called straight from a tap/click: browsers only show the permission box then.
export async function enablePush(broadcast = true) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in first.");
  const sup = pushSupport();
  if (!sup.ok) throw new Error(supportMessage(sup));

  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error("Alerts are blocked for Borrowa. Open your browser\u2019s site settings, allow Notifications, then try again.");
  }
  if (permission !== "granted") throw new Error("No problem. You can turn alerts on any time.");

  let token;
  try { token = await fetchToken(); }
  catch (e) {
    console.warn("[push] token error:", e);
    throw new Error("Couldn\u2019t set up alerts on this device. Check your connection and try again.");
  }
  if (!token) throw new Error("Couldn\u2019t set up alerts on this device. Please try again.");
  await saveToken(user, token, broadcast);
  lsDel(LS_DISMISS);
  return true;
}

export async function disablePush() {
  const s = lsGet(LS_STATE);
  lsDel(LS_STATE);
  if (s && s.token) { try { await deleteDoc(doc(db, "pushTokens", s.token)); } catch (e) { /* already gone */ } }
  try {
    const { getMessaging, deleteToken } = await import(MESSAGING_URL);
    await deleteToken(getMessaging(app));
  } catch (e) { /* not subscribed */ }
}

// "Also tell me about new listings and requests" on/off. Personal alerts
// (someone borrowed my item, messages, reminders) stay on either way.
export async function setBroadcast(on) {
  const s = lsGet(LS_STATE);
  if (!s || !s.token) return;
  await setDoc(doc(db, "pushTokens", s.token), { broadcast: Boolean(on), updatedAt: serverTimestamp() }, { merge: true });
  lsSet(LS_STATE, { ...s, broadcast: Boolean(on) });
}

// Call BEFORE signing out so a shared phone stops getting the previous member's alerts.
export async function forgetPushOnThisDevice() {
  const s = lsGet(LS_STATE);
  lsDel(LS_STATE);
  if (s && s.token) { try { await deleteDoc(doc(db, "pushTokens", s.token)); } catch (e) { /* ignore */ } }
}

// On page load for a signed-in member who already enabled alerts on this device:
// tokens can rotate, so quietly re-save it (at most once a day).
export async function refreshPushToken(user) {
  if (!user || !pushSupport().ok || pushPermission() !== "granted") return;
  const s = lsGet(LS_STATE);
  if (!s || s.uid !== user.uid) return;                 // never auto-enrol someone who didn't ask
  if (Date.now() - (s.at || 0) < REFRESH_EVERY_MS) return;
  try {
    const token = await fetchToken();
    if (token) await saveToken(user, token, s.broadcast !== false);
  } catch (e) { console.warn("[push] refresh failed:", e); }
}

// ---- UI ----
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  kids.forEach((k) => k && n.append(k));
  return n;
}

// The "Phone alerts" box shown inside the bell panel.
export function renderPushControls(onChange) {
  if (!PUSH_CONFIGURED) return null;
  const box = el("div", { class: "push-box" });
  const sup = pushSupport();

  const paint = () => {
    box.replaceChildren(el("div", { class: "push-title", text: "\u{1F4F1} Phone alerts" }));
    const msg = el("p", { class: "push-msg", role: "status", "aria-live": "polite" });
    const done = () => { if (onChange) onChange(); paint(); };

    if (!sup.ok) {
      box.append(el("p", { class: "push-text", text: supportMessage(sup) }));
      return;
    }
    if (pushPermission() === "denied") {
      box.append(el("p", { class: "push-text", text: "Alerts are blocked for Borrowa. Allow Notifications in your browser\u2019s site settings, then reopen this panel." }));
      return;
    }

    const st = pushState();
    if (!st.on) {
      box.append(
        el("p", { class: "push-text", text: "Get a notification on this phone when someone posts something to borrow, asks for help, or borrows your item \u2014 even when Borrowa is closed." }),
        el("button", {
          type: "button", class: "btn btn-primary btn-sm push-btn", text: "Turn on phone alerts",
          onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true; b.textContent = "Setting up\u2026";
            try { await enablePush(true); done(); }
            catch (err) { b.disabled = false; b.textContent = "Turn on phone alerts"; msg.textContent = err.message; }
          },
        }),
        msg,
      );
      return;
    }

    const cb = el("input", { type: "checkbox", id: "push-broadcast" });
    cb.checked = st.broadcast;
    cb.addEventListener("change", async () => {
      cb.disabled = true;
      try { await setBroadcast(cb.checked); msg.textContent = ""; }
      catch (err) { cb.checked = !cb.checked; msg.textContent = "Couldn\u2019t save that. Please try again."; }
      cb.disabled = false;
    });
    box.append(
      el("p", { class: "push-text push-on", text: "\u2705 On for this phone." }),
      el("label", { class: "push-check", for: "push-broadcast" }, cb, el("span", { text: "Also tell me about new listings and requests" })),
      el("button", {
        type: "button", class: "btn btn-outline btn-sm push-btn", text: "Turn off",
        onclick: async (e) => { e.currentTarget.disabled = true; await disablePush(); done(); },
      }),
      msg,
    );
  };
  paint();
  return box;
}

// A friendly one-time card on the Browse page asking if they want alerts.
export function mountPushPrompt() {
  if (!PUSH_CONFIGURED || document.getElementById("push-prompt")) return;
  const grid = document.getElementById("item-grid");
  if (!grid || !auth.currentUser) return;
  if (!pushSupport().ok && pushSupport().reason !== "ios-install") return;
  if (pushPermission() === "denied" || pushState().on) return;
  const dismissedAt = lsGet(LS_DISMISS);
  if (dismissedAt && Date.now() - dismissedAt < REASK_AFTER_MS) return;

  const sup = pushSupport();
  const card = el("div", { id: "push-prompt", class: "push-prompt", role: "region", "aria-label": "Phone alerts" });
  const msg = el("p", { class: "push-msg", role: "status", "aria-live": "polite" });
  const close = () => card.remove();

  card.append(
    el("div", { class: "push-prompt-text" },
      el("strong", { text: "\u{1F514} Never miss a borrow" }),
      el("span", { text: sup.ok
        ? "Get a phone alert when neighbours post something or ask for help \u2014 even when Borrowa is closed."
        : supportMessage(sup) }),
    ),
    el("div", { class: "push-prompt-actions" },
      sup.ok ? el("button", {
        type: "button", class: "btn btn-primary btn-sm", text: "Turn on alerts",
        onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = "Setting up\u2026";
          try { await enablePush(true); close(); }
          catch (err) { b.disabled = false; b.textContent = "Turn on alerts"; msg.textContent = err.message; }
        },
      }) : null,
      el("button", {
        type: "button", class: "btn btn-outline btn-sm", text: sup.ok ? "Not now" : "Got it",
        onclick: () => { lsSet(LS_DISMISS, Date.now()); close(); },
      }),
    ),
    msg,
  );
  grid.parentNode.insertBefore(card, grid);
}
