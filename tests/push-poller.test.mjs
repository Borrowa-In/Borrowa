import assert from "node:assert";
import { poll } from "../scripts/push-poller.mjs";

const T = (m) => ({ toMillis: () => m });
const Timestamp = { fromMillis: (m) => T(m) };
const cols = {};
const put = (path, data) => { const [c, ...rest] = path.split("/"); const key = path.slice(0, path.lastIndexOf("/")); (cols[key] ||= {})[path.split("/").pop()] = data; };
const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => data, get: (k) => (data ? data[k] : undefined) });
function query(name, filters = [], order = null, lim = 1e9, after = null) {
  const q = {
    where: (f, op, v) => query(name, [...filters, [f, op, v]], order, lim, after),
    orderBy: (f, dir) => query(name, filters, [f, dir], lim, after),
    limit: (n) => query(name, filters, order, n, after),
    startAfter: (d) => query(name, filters, order, lim, d),
    async get() {
      let rows = Object.entries(cols[name] || {}).filter(([, d]) => filters.every(([f, op, v]) => {
        const x = d[f]; const xv = x && x.toMillis ? x.toMillis() : x; const vv = v && v.toMillis ? v.toMillis() : v;
        return op === "==" ? x === v : op === ">" ? xv > vv : false;
      }));
      if (order && order[0] !== "__name__") rows.sort((a, b) => (ms(a[1][order[0]]) - ms(b[1][order[0]])) * (order[1] === "desc" ? -1 : 1));
      if (after) rows = [];
      rows = rows.slice(0, lim);
      const docs = rows.map(([id, d]) => snapDoc(id, d));
      return { docs, size: docs.length };
    },
  };
  return q;
}
const ms = (t) => (t && t.toMillis ? t.toMillis() : t || 0);
const store = {};
const db = {
  collection: (n) => query(n),
  doc: (p) => ({ path: p, async get() { return snapDoc(p.split("/").pop(), store[p] ?? (cols[p.slice(0, p.lastIndexOf("/"))] || {})[p.split("/").pop()]); },
                 async set(v) { store[p] = v; } }),
  batch: () => ({ delete: (r) => deleted.push(r.path), commit: async () => {} }),
};
const deleted = [], sent = [];
const messaging = { async sendEachForMulticast(m) { sent.push(m); return { successCount: m.tokens.filter((t) => t !== "tDead").length, responses: m.tokens.map((t) => t === "tDead" ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true }) }; } };
const log = () => {};
const run = (nowMs) => poll({ db, messaging, Timestamp, nowMs, log });

put("pushTokens/tAsha", { token: "tAsha", uid: "asha", broadcast: true });
put("pushTokens/tRavi", { token: "tRavi", uid: "ravi", broadcast: true });
put("pushTokens/tDead", { token: "tDead", uid: "ravi", broadcast: true });
put("pushTokens/tMeera", { token: "tMeera", uid: "meera", broadcast: false });
put("borrowRequests/old", { userId: "meera", title: "Old", offerCount: 1, createdAt: T(10) });
put("items/oldItem", { userId: "asha", title: "Old item", createdAt: T(10) });

// 1. first run only saves a baseline
let r = await run(1_000_000);
assert.equal(r.first, true); assert.equal(sent.length, 0);
console.log("ok - first run sends nothing (no flood of old posts)");

// 2. activity happens
put("items/i1", { userId: "asha", title: "Drill", pickupLocation: "Block B", createdAt: T(1_100_000) });
put("items/i1b", { userId: "asha", title: "Saw", createdAt: T(1_100_001) });
put("borrowRequests/old", { userId: "meera", title: "Old", offerCount: 2, createdAt: T(10) });
put("notifications/n1", { recipientId: "meera", type: "item_claimed", itemTitle: "Drill", claimedByName: "Ravi", createdAt: T(1_100_002) });
put("chats/c1", { participants: ["asha", "meera"], participantNames: { asha: "Asha" }, lastMessageAt: T(1_100_003) });
put("chats/c1/messages", {}); cols["chats/c1/messages"] = { m1: { senderId: "asha", createdAt: T(1_100_003) } };
r = await run(1_200_000);
const to = (i) => sent[i].tokens.sort().join(",");
console.log("sent batches:", sent.map((s) => s.data.kind + "->" + s.tokens.join("/")));
assert.equal(sent.filter((s) => s.data.kind === "item").length, 1, "one blast per poster per run");
assert.equal(to(sent.findIndex((s) => s.data.kind === "item")), "tDead,tRavi", "poster excluded, opted-out excluded");
const byKind = (k) => sent.find((s) => s.data.kind === k);
assert.deepEqual(byKind("borrowed").tokens, ["tMeera"]);
assert.deepEqual(byKind("offer").tokens, ["tMeera"]);
assert.deepEqual(byKind("chat").tokens, ["tMeera"]);
assert.match(byKind("chat").data.body, /Asha/);
assert.ok(!JSON.stringify(byKind("chat")).includes("cipher"));
assert.deepEqual(deleted, ["pushTokens/tDead"]);
console.log("ok - listing, borrowed, offer and chat alerts go to the right phones; dead token removed");

// 3. running again with nothing new sends nothing (even with the overlap window)
sent.length = 0;
r = await run(1_230_000);
assert.equal(sent.length, 0);
console.log("ok - no duplicates on the next run");
console.log("push poller tests passed");
