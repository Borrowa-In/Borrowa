// The ONE place that decides who earns what. No imports on purpose, so it can
// be unit-tested in Node and shared by the browser (ranks.js) and, optionally,
// the Cloud Function (functions/points.js is a copy of this file).
//
// Why points are built this way (the old rules could be farmed):
//   * Borrowing used to score the moment you tapped "Borrow", with nobody
//     else's say-so, and without limit. Now a borrow only scores once the
//     LENDER confirms it came back ("Mark as Returned" -> items.completedBy),
//     and not until at least MIN_LOAN_MS after the borrow.
//   * Every PAIR of people scores once in total (not once per direction),
//     however many items they swap. Farming N points needs ~N different people.
//   * Listing was worth +10 each (a Gold rank from 10 empty listings). It is
//     now a small bonus; the real points come from completed exchanges.
//   * Offers used to score just for tapping "I can lend this". Now the
//     requester must pick who actually helped (borrowRequests.fulfilledBy).
//   * Every category is capped, so one account has a hard ceiling on points.
//   * Anything involving a banned account stops counting, so banning a fake
//     ring also removes the points they handed each other.
export const RANK_KEYS = ["none", "bronze", "silver", "gold", "platinum", "diamond"];

export const CAPS = { lent: 5, requests: 5, lentOut: 20, borrowed: 20, helped: 20 };
export const POINTS = { lend: 2, lentOut: 8, borrow: 8, helped: 6, requestFulfilled: 3, request: 1 };
export const MIN_LOAN_MS = 15 * 60 * 1000;   // a loan must last at least this long to count
const FUTURE_SKEW_MS = 2 * 60 * 1000;        // clock slack when checking "not in the future"

// Accepts a Firestore Timestamp, Date, number, or { seconds } and returns millis (or null).
export function toMs(t) {
  if (t === null || t === undefined) return null;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number" && Number.isFinite(t)) return t;
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return null;
}

// Earliest valid-looking confirmation time for a borrower on this item.
function confirmedAt(done, uid) {
  let best = Infinity;
  done.forEach((d) => { if (d && d.uid === uid) { const t = toMs(d.at); if (t !== null && t < best) best = t; } });
  return best === Infinity ? 0 : best;
}

// items: [{ id, userId, status, claims[], completedBy[] ... }]
// requests: [{ id, userId, status, offeredBy[], fulfilledBy ... }]
// users: [{ id, name, email, banned, rank }]
export function computeStats({ items = [], requests = [], users = [] }, now = Date.now()) {
  const members = new Map();
  const get = (uid) => {
    if (!uid || uid === "anonymous") return null;
    if (!members.has(uid)) {
      members.set(uid, {
        uid, name: "", assignedRank: null,
        lent: 0, requests: 0,
        lentTo: new Set(),        // distinct borrowers who returned something to me
        borrowedFrom: new Set(),  // distinct lenders I returned something to
        helpedFor: new Set(),     // distinct requesters I was chosen to help
        helpedBy: new Set(),      // distinct helpers my fulfilled requests credited
      });
    }
    return members.get(uid);
  };

  users.forEach((u) => {
    const m = get(u.id);
    if (m) {
      m.name = u.name || (u.email || "").split("@")[0] || "";
      m.assignedRank = RANK_KEYS.includes(u.rank) ? u.rank : null;
    }
  });
  const banned = new Set(users.filter((u) => u.banned).map((u) => u.id));
  const ok = (uid) => uid && !banned.has(uid);

  const participants = new Set();
  const helpPairs = [];
  let completedBorrows = 0, activeBorrows = 0, openRequests = 0;
  const candidates = []; // confirmed exchanges, de-duplicated by pair after the loop

  items.forEach((item) => {
    if (item.status === "claimed") activeBorrows += 1;
    if (item.userId) participants.add(item.userId);
    const lender = get(item.userId);
    if (lender) {
      lender.lent += 1;
      if (!lender.name && item.userName) lender.name = item.userName;
      if (!lender.name && item.userEmail) lender.name = item.userEmail.split("@")[0];
    }

    const claims = Array.isArray(item.claims) ? item.claims : [];
    const done = Array.isArray(item.completedBy) ? item.completedBy : [];

    // earliest claim time per borrower
    const firstClaim = new Map();
    claims.forEach((c) => {
      if (!c || !c.uid) return;
      participants.add(c.uid);
      const t = toMs(c.claimedAt);
      if (t !== null && (!firstClaim.has(c.uid) || t < firstClaim.get(c.uid))) firstClaim.set(c.uid, t);
      if (!firstClaim.has(c.uid)) firstClaim.set(c.uid, null);
    });

    firstClaim.forEach((claimMs, uid) => {
      if (uid === item.userId || claimMs === null) return;       // never your own item
      // Did the lender confirm this borrower returned it, at a believable time?
      const confirmed = done.some((d) => {
        if (!d || d.uid !== uid) return false;
        const at = toMs(d.at);
        return at !== null && at <= now + FUTURE_SKEW_MS && at - claimMs >= MIN_LOAN_MS;
      });
      if (!confirmed) return;
      if (!ok(item.userId) || !ok(uid)) return;                  // banned accounts don't count
      const c = claims.find((x) => x && x.uid === uid && x.name);
      candidates.push({ lender: item.userId, borrower: uid, at: confirmedAt(done, uid), borrowerName: c ? String(c.name).slice(0, 60) : "" });
    });
  });

  // Each pair of people scores once, whichever direction came first. Sorting
  // by time (then id) makes this identical no matter what order Firestore
  // returned the documents in.
  candidates.sort((a, b) => a.at - b.at || (a.lender + a.borrower < b.lender + b.borrower ? -1 : 1));
  const pairSeen = new Set();
  candidates.forEach((c) => {
    const key = [c.lender, c.borrower].sort().join("|");
    if (pairSeen.has(key)) return;
    pairSeen.add(key);
    completedBorrows += 1;
    const l = get(c.lender), b = get(c.borrower);
    if (l) l.lentTo.add(c.borrower);
    if (b) {
      b.borrowedFrom.add(c.lender);
      if (!b.name && c.borrowerName) b.name = c.borrowerName;
    }
  });

  requests.forEach((r) => {
    const status = r.status || "open";
    if (status === "open") openRequests += 1;
    if (r.userId) participants.add(r.userId);
    const asker = get(r.userId);
    if (asker) {
      asker.requests += 1;
      if (!asker.name && r.userName) asker.name = r.userName;
    }
    // Credit only when the requester named a helper who really offered.
    const helper = r.fulfilledBy;
    if (
      status === "fulfilled" && helper && helper !== r.userId &&
      Array.isArray(r.offeredBy) && r.offeredBy.includes(helper) &&
      ok(helper) && ok(r.userId)
    ) {
      const h = get(helper);
      helpPairs.push({ asker: r.userId, helper, at: toMs(r.createdAt) || 0 });
    }
  });

  helpPairs.sort((a, b) => a.at - b.at || (a.asker + a.helper < b.asker + b.helper ? -1 : 1));
  const helpSeen = new Set();
  helpPairs.forEach((p) => {
    const key = [p.asker, p.helper].sort().join("|");
    if (helpSeen.has(key)) return;
    helpSeen.add(key);
    const a = get(p.asker), h = get(p.helper);
    if (a) a.helpedBy.add(p.helper);
    if (h) h.helpedFor.add(p.asker);
  });

  const list = [];
  members.forEach((m) => {
    const lent = Math.min(m.lent, CAPS.lent);
    const reqs = Math.min(m.requests, CAPS.requests);
    const lentOut = Math.min(m.lentTo.size, CAPS.lentOut);
    const borrowed = Math.min(m.borrowedFrom.size, CAPS.borrowed);
    const offers = Math.min(m.helpedFor.size, CAPS.helped);
    const fulfilled = Math.min(m.helpedBy.size, reqs);
    const points = lent * POINTS.lend + lentOut * POINTS.lentOut + borrowed * POINTS.borrow +
      offers * POINTS.helped + fulfilled * POINTS.requestFulfilled + reqs * POINTS.request;
    list.push({
      uid: m.uid, name: m.name || "Neighbor", assignedRank: m.assignedRank,
      lent, lentOut, borrowed, offers, points,
    });
  });

  const ranked = list
    .filter((m) => !banned.has(m.uid) && (m.points > 0 || m.assignedRank))
    .sort((a, b) => b.points - a.points || (b.lent + b.borrowed + b.offers) - (a.lent + a.borrowed + a.offers));

  return {
    ranked,
    totals: { items: items.length, borrows: completedBorrows, members: ranked.length, requests: requests.length },
    home: { items: items.length, borrows: activeBorrows, members: participants.size, requests: openRequests },
  };
}
