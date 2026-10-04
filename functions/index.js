// Borrowa backend (Firebase Cloud Functions, 2nd gen, Node 22).
//
//  1. Leaderboard + home stats  -> keeps ONE small document (leaderboard/top)
//     up to date, so pages read a single doc instead of downloading every
//     item, request and user on every visit.
//  2. checkIp                   -> tells the browser its real IP (read from
//     the request on the server, so it can't be faked) and whether it's banned.
//
//  3. Phone push notifications -> data-only Firebase Cloud Messaging pushes (see the
//     "Phone push" section at the bottom and ./push.js).
//
// Scoring lives in ./points.js, a generated copy of ../public/js/points.js (run
// `npm run sync-points` after changing the browser version).
const { onDocumentWritten, onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { computeStats } = require("./points");
const push = require("./push");

admin.initializeApp();
const db = admin.firestore();

const REGION = "us-central1";
const MAX_MEMBERS = 1000;      // keeps the summary doc far below Firestore's 1 MiB limit
const MIN_GAP_MS = 20 * 1000;  // don't rebuild more than once per 20s, however busy the site is

async function docs(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function buildSummary() {
  const [items, requests, users] = await Promise.all([docs("items"), docs("borrowRequests"), docs("users")]);
  const stats = computeStats({ items, requests, users });
  return {
    ranked: stats.ranked.slice(0, MAX_MEMBERS),
    totals: stats.totals,
    home: stats.home,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function rebuild({ force = false } = {}) {
  const ref = db.doc("leaderboard/top");
  if (!force) {
    const cur = await ref.get();
    const last = cur.exists && cur.get("updatedAt");
    if (last && Date.now() - last.toMillis() < MIN_GAP_MS) return false; // the scheduled sweep catches up
  }
  await ref.set(await buildSummary());
  return true;
}

// Rebuild whenever the data behind the leaderboard changes...
const watch = (path) => onDocumentWritten({ document: path, region: REGION }, () => rebuild());
exports.onItemWrite = watch("items/{id}");
exports.onRequestWrite = watch("borrowRequests/{id}");
exports.onUserWrite = watch("users/{id}");

// ...and once every 10 minutes regardless, so changes that landed inside the
// 20s throttle window never stay stale for long.
exports.sweepLeaderboard = onSchedule({ schedule: "every 10 minutes", region: REGION }, () => rebuild({ force: true }));

// Real-IP lookup + ban check. Replaces the browser calling a third-party
// "what's my IP" site. Also records the IP on the member's profile.
exports.checkIp = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const fwd = request.rawRequest.headers["x-forwarded-for"];
  const ip = (typeof fwd === "string" ? fwd.split(",")[0] : request.rawRequest.ip || "").trim();
  if (!ip) throw new HttpsError("internal", "Could not determine IP.");
  const [banSnap] = await Promise.all([
    db.doc(`bannedIPs/${ip}`).get(),
    db.doc(`userIps/${request.auth.uid}`).set({ ip, updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
  ]);
  return { ip, banned: banSnap.exists };
});


// ---- Listing expiry + due-date reminders (hourly) ------------------------
// Requires the Blaze plan. Listings carry `expiresAt` (food 2h, others 5 days).
// Reminders go to borrowers ~24h before `dueAt` as in-app notifications.
// Server-side writes bypass firestore.rules, so no extra rules are needed.
async function note(recipientId, data) {
  await db.collection("notifications").add({
    recipientId, read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(), ...data,
  });
}

exports.expireListings = onSchedule({ schedule: "every 60 minutes", region: REGION }, async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection("items").where("expiresAt", "<=", now).limit(300).get();
  for (const d of snap.docs) {
    const it = d.data();
    if (it.status === "claimed") continue;           // keep loans that are in progress
    await note(it.userId, { type: "listing_expired", itemId: d.id, itemTitle: it.title || "" });
    await d.ref.delete();
  }
});

exports.dueReminders = onSchedule({ schedule: "every 60 minutes", region: REGION }, async () => {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 31 * 864e5);
  const soon = Date.now() + 24 * 36e5;
  const snap = await db.collection("items").where("claimedAt", ">", since).limit(500).get();
  for (const d of snap.docs) {
    for (const c of d.get("claims") || []) {
      const due = c.dueAt && c.dueAt.toMillis ? c.dueAt.toMillis() : 0;
      if (!due || due > soon || due < Date.now() - 7 * 864e5) continue;
      const key = `${d.id}_${c.uid}_${due}`;
      const mark = db.doc(`reminders/${key}`);
      if ((await mark.get()).exists) continue;
      await mark.set({ at: admin.firestore.FieldValue.serverTimestamp() });
      await note(c.uid, { type: "due_reminder", itemId: d.id, itemTitle: d.get("title") || "",
        dueLabel: new Date(due).toDateString() });
    }
  }
});


// ---- Email OTP (optional) ------------------------------------------------
// The code is hashed in `emailOtps/{uid}` (no client access: rules deny it) and
// the email is queued in `mail`, which the "Trigger Email from Firestore"
// extension sends. Codes last 10 minutes, 5 wrong tries, 60s between sends.
const crypto = require("crypto");
const hashCode = (uid, code) => crypto.createHash("sha256").update(uid + ":" + code).digest("hex");

exports.sendEmailOtp = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const { uid, token } = request.auth;
  if (!token.email) throw new HttpsError("failed-precondition", "No email on account.");
  if (token.email_verified) return { alreadyVerified: true };
  const ref = db.doc(`emailOtps/${uid}`);
  const old = await ref.get();
  if (old.exists && Date.now() - old.get("sentAt") < 60000) {
    throw new HttpsError("resource-exhausted", "Please wait a minute before asking for another code.");
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await ref.set({ hash: hashCode(uid, code), sentAt: Date.now(), expiresAt: Date.now() + 600000, tries: 0 });
  await db.collection("mail").add({
    to: token.email,
    message: {
      subject: `${code} is your Borrowa verification code`,
      text: `Your Borrowa verification code is ${code}. It expires in 10 minutes. If you didn't sign up, ignore this email.`,
    },
  });
  return { sent: true };
});

exports.verifyEmailOtp = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = request.auth.uid;
  const code = String((request.data || {}).code || "").trim();
  const ref = db.doc(`emailOtps/${uid}`);
  const snap = await ref.get();
  if (!snap.exists || Date.now() > snap.get("expiresAt")) throw new HttpsError("deadline-exceeded", "That code expired. Ask for a new one.");
  if (snap.get("tries") >= 5) { await ref.delete(); throw new HttpsError("resource-exhausted", "Too many wrong tries. Ask for a new code."); }
  if (!/^\d{6}$/.test(code) || hashCode(uid, code) !== snap.get("hash")) {
    await ref.update({ tries: admin.firestore.FieldValue.increment(1) });
    throw new HttpsError("invalid-argument", "Wrong code.");
  }
  await admin.auth().updateUser(uid, { emailVerified: true });
  await ref.delete();
  return { verified: true };
});


// ---- Phone push (Firebase Cloud Messaging) -------------------------------
// Needs the Blaze plan. Tokens live in `pushTokens/{token}` { uid, token, broadcast, ... },
// written by the browser (public/js/push.js). Messages are DATA-ONLY so public/sw.js decides
// how to show them. Chat text is end-to-end encrypted, so chat pushes never contain it.
const BROADCAST_GAP_MS = 5 * 60 * 1000; // one "new listing/request" blast per member per 5 min

async function allTokenDocs(query) {
  const out = [];
  let last = null;
  for (;;) {
    let q = query.orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.docs.forEach((d) => out.push({ token: d.get("token") || d.id, uid: d.get("uid") }));
    if (snap.size < 1000) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

async function sendToTokens(tokens, message) {
  let sent = 0;
  for (const part of push.chunk(tokens)) {
    let res;
    try {
      res = await admin.messaging().sendEachForMulticast({
        tokens: part,
        data: message.data,
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
        android: { priority: "high" },
      });
    } catch (e) {
      console.error("[push] send failed:", e.code || e.message);
      continue;
    }
    sent += res.successCount;
    const dead = push.deadTokens(part, res.responses);
    if (dead.length) {
      const batch = db.batch();
      dead.forEach((t) => batch.delete(db.doc(`pushTokens/${t}`)));
      await batch.commit().catch((e) => console.error("[push] cleanup failed:", e.message));
    }
  }
  return sent;
}

async function pushToBroadcast(message, excludeUid) {
  const docs = await allTokenDocs(db.collection("pushTokens").where("broadcast", "==", true));
  return sendToTokens(push.pickTokens(docs, { excludeUid }), message);
}

async function pushToMember(uid, message) {
  if (!uid) return 0;
  const docs = await allTokenDocs(db.collection("pushTokens").where("uid", "==", uid));
  return sendToTokens(push.pickTokens(docs), message);
}

// Returns true if this member may trigger a broadcast now (and records it).
async function broadcastAllowed(kind, uid) {
  if (!uid) return false;
  const ref = db.doc(`pushThrottle/${kind}_${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const at = snap.exists ? snap.get("at") : 0;
    if (Date.now() - at < BROADCAST_GAP_MS) return false;
    tx.set(ref, { at: Date.now() });
    return true;
  });
}

exports.pushOnItem = onDocumentCreated({ document: "items/{id}", region: REGION }, async (event) => {
  const item = event.data && event.data.data();
  if (!item || !(await broadcastAllowed("item", item.userId))) return;
  await pushToBroadcast(push.itemMessage(item, event.params.id), item.userId);
});

exports.pushOnRequest = onDocumentCreated({ document: "borrowRequests/{id}", region: REGION }, async (event) => {
  const req = event.data && event.data.data();
  if (!req || !(await broadcastAllowed("request", req.userId))) return;
  await pushToBroadcast(push.requestMessage(req, event.params.id), req.userId);
});

exports.pushOnOffer = onDocumentUpdated({ document: "borrowRequests/{id}", region: REGION }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (!((after.offerCount || 0) > (before.offerCount || 0)) || !after.userId) return;
  await pushToMember(after.userId, push.offerMessage(after, event.params.id));
});

exports.pushOnNotification = onDocumentCreated({ document: "notifications/{id}", region: REGION }, async (event) => {
  const n = event.data && event.data.data();
  if (!n || !n.recipientId) return;
  await pushToMember(n.recipientId, push.notificationMessage(n, event.params.id));
});

exports.pushOnChatMessage = onDocumentCreated({ document: "chats/{chatId}/messages/{id}", region: REGION }, async (event) => {
  const msg = event.data && event.data.data();
  if (!msg || !msg.senderId) return;
  const chat = await db.doc(`chats/${event.params.chatId}`).get();
  const other = ((chat.exists && chat.get("participants")) || []).find((u) => u !== msg.senderId);
  if (!other) return;
  const sender = await db.doc(`users/${msg.senderId}`).get();
  await pushToMember(other, push.chatMessage(sender.exists ? sender.get("name") : "", event.params.chatId));
});
