// FREE phone-push sender (no Blaze plan, no card).
//
// Cloud Functions need a paid plan, but Firebase Cloud Messaging itself is free. This script
// does the same job as the `pushOn...` functions: every few minutes a GitHub Actions job runs
// it, it looks for anything new since the last run, and sends FCM pushes to the phones that
// turned alerts on. It reuses the tested message builders in functions/push.js.
//
// Needs one secret in the GitHub repo: FIREBASE_SERVICE_ACCOUNT (see docs/FREE_PUSH.md).
// Do NOT also deploy the pushOn... Cloud Functions, or people would get every alert twice.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const push = require("../functions/push.js");

const MAX_BROADCASTS_PER_RUN = 5;   // new-listing / new-request blasts per run
const MAX_PERSONAL_PER_RUN = 100;   // direct alerts (borrowed, reminders, offers, chat) per run
const KEEP_SENT = 300;              // remembered ids so a re-scan never sends twice
const OVERLAP_MS = 60 * 1000;       // look back a little in case clocks differ

async function tokenDocs(db, field, value) {
  const out = [];
  let last = null;
  for (;;) {
    let q = db.collection("pushTokens").where(field, "==", value).orderBy("__name__").limit(1000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    snap.docs.forEach((d) => out.push({ token: d.get("token") || d.id, uid: d.get("uid") }));
    if (snap.size < 1000) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

async function send(db, messaging, tokens, message) {
  let sent = 0;
  for (const part of push.chunk(tokens)) {
    let res;
    try {
      res = await messaging.sendEachForMulticast({
        tokens: part,
        data: message.data,
        webpush: { headers: { Urgency: "high", TTL: "86400" } },
        android: { priority: "high" },
      });
    } catch (e) { console.error("[push] send failed:", e.code || e.message); continue; }
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

const toBroadcast = async (db, messaging, message, excludeUid) =>
  send(db, messaging, push.pickTokens(await tokenDocs(db, "broadcast", true), { excludeUid }), message);

const toMember = async (db, messaging, uid, message) =>
  uid ? send(db, messaging, push.pickTokens(await tokenDocs(db, "uid", uid)), message) : 0;

const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);

// One pass. `db`/`messaging` are injected so tests can run it without Firebase.
export async function poll({ db, messaging, Timestamp, nowMs = Date.now(), log = console.log }) {
  const stateRef = db.doc("pushState/poller");
  const stateSnap = await stateRef.get();

  // Remember how many offers each request had, to spot new ones.
  const offerSnap = await db.collection("borrowRequests").where("offerCount", ">", 0).limit(500).get();
  const offerNow = {};
  offerSnap.docs.forEach((d) => { offerNow[d.id] = d.get("offerCount") || 0; });

  // First ever run: start from "now" so nobody is flooded with old posts.
  if (!stateSnap.exists) {
    await stateRef.set({ since: nowMs, offers: offerNow, sent: [] });
    log("First run: baseline saved, nothing sent.");
    return { sent: 0, first: true };
  }

  const state = stateSnap.data();
  const alreadySent = new Set(state.sent || []);
  const prevOffers = state.offers || {};
  const since = Timestamp.fromMillis(Math.max(0, (state.since || nowMs) - OVERLAP_MS));
  const newlySent = [];
  let total = 0, broadcasts = 0, personal = 0;
  const posters = new Set();
  const once = (key) => { if (alreadySent.has(key)) return false; alreadySent.add(key); newlySent.push(key); return true; };

  const fresh = (name, field = "createdAt") =>
    db.collection(name).where(field, ">", since).orderBy(field).limit(100).get();

  // New listings and requests -> everyone who opted in (one blast per poster per run).
  for (const [coll, kind, build] of [["items", "item", push.itemMessage], ["borrowRequests", "request", push.requestMessage]]) {
    for (const d of (await fresh(coll)).docs) {
      const data = d.data();
      if (!once(`${kind}:${d.id}`)) continue;
      const who = `${kind}:${data.userId}`;
      if (!data.userId || posters.has(who) || broadcasts >= MAX_BROADCASTS_PER_RUN) continue;
      posters.add(who); broadcasts++;
      total += await toBroadcast(db, messaging, build(data, d.id), data.userId);
    }
  }

  // New in-app notifications (borrowed, due reminder, expired) -> that member.
  for (const d of (await fresh("notifications")).docs) {
    const n = d.data();
    if (!n.recipientId || !once(`note:${d.id}`) || personal++ >= MAX_PERSONAL_PER_RUN) continue;
    total += await toMember(db, messaging, n.recipientId, push.notificationMessage(n, d.id));
  }

  // Someone offered to lend -> the person who asked.
  for (const d of offerSnap.docs) {
    const count = offerNow[d.id];
    const r = d.data();
    if (count > (prevOffers[d.id] || 0) && r.userId && personal++ < MAX_PERSONAL_PER_RUN) {
      total += await toMember(db, messaging, r.userId, push.offerMessage(r, d.id));
    }
  }

  // New chat messages -> the other person. The text is encrypted, so only the sender name is used.
  for (const c of (await fresh("chats", "lastMessageAt")).docs) {
    const chat = c.data();
    const last = await db.collection(`chats/${c.id}/messages`).orderBy("createdAt", "desc").limit(1).get();
    const m = last.docs[0];
    if (!m || ms(m.get("createdAt")) < since.toMillis()) continue;
    const senderId = m.get("senderId");
    const other = (chat.participants || []).find((u) => u !== senderId);
    if (!senderId || !other || !once(`chat:${c.id}:${m.id}`) || personal++ >= MAX_PERSONAL_PER_RUN) continue;
    const sender = await db.doc(`users/${senderId}`).get();
    const name = (chat.participantNames && chat.participantNames[senderId]) || (sender.exists ? sender.get("name") : "");
    total += await toMember(db, messaging, other, push.chatMessage(name, c.id));
  }

  await stateRef.set({
    since: nowMs,
    offers: offerNow,
    sent: [...(state.sent || []), ...newlySent].slice(-KEEP_SENT),
  });
  log(`Done: ${total} push(es) delivered.`);
  return { sent: total, first: false };
}

// ---- entry point (skipped when imported by the tests) ----
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const admin = (await import("firebase-admin")).default;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.error("FIREBASE_SERVICE_ACCOUNT secret is missing. See docs/FREE_PUSH.md."); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  await poll({ db: admin.firestore(), messaging: admin.messaging(), Timestamp: admin.firestore.Timestamp });
}
