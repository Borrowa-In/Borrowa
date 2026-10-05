import { computeStats, CAPS, POINTS, MIN_LOAN_MS } from "../public/js/points.js";
import assert from "node:assert/strict";
const NOW = 1_000_000_000_000, H = 3600_000, MIN = 60_000;
const users = ["A","B","C","D","E"].map((id) => ({ id, name: id }));
const pts = (r, uid) => (r.ranked.find((m) => m.uid === uid) || { points: 0 }).points;
const item = (o) => ({ id: Math.random()+"", status: "available", claims: [], completedBy: [], ...o });
const claim = (uid, ago) => ({ uid, name: uid, amount: 1, claimedAt: NOW - ago });
const done = (uid, ago) => ({ uid, at: NOW - ago });
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("honest exchange: lender and borrower both score", () => {
  const r = computeStats({ users, items: [item({ userId: "A", claims: [claim("B", 3*H)], completedBy: [done("B", 1*H)] })] }, NOW);
  assert.equal(pts(r, "A"), POINTS.lend + POINTS.lentOut);
  assert.equal(pts(r, "B"), POINTS.borrow);
});
t("borrowing with no lender confirmation scores NOTHING (old exploit)", () => {
  const r = computeStats({ users, items: [item({ userId: "A", claims: [claim("B", 3*H)] })] }, NOW);
  assert.equal(pts(r, "B"), 0); assert.equal(pts(r, "A"), POINTS.lend);
});
t("returned too fast (under min loan) scores nothing", () => {
  const r = computeStats({ users, items: [item({ userId: "A", claims: [claim("B", 10*MIN)], completedBy: [done("B", 9*MIN)] })] }, NOW);
  assert.equal(pts(r, "B"), 0);
});
t("future-dated confirmation is ignored until that time really arrives", () => {
  const r = computeStats({ users, items: [item({ userId: "A", claims: [claim("B", 1*MIN)], completedBy: [{ uid: "B", at: NOW + 3*H }] })] }, NOW);
  assert.equal(pts(r, "B"), 0);
});
t("same pair across 30 items still scores once", () => {
  const items = Array.from({ length: 30 }, () => item({ userId: "A", claims: [claim("B", 5*H)], completedBy: [done("B", 2*H)] }));
  const r = computeStats({ users, items }, NOW);
  assert.equal(pts(r, "B"), POINTS.borrow);
  assert.equal(pts(r, "A"), CAPS.lent * POINTS.lend + POINTS.lentOut);
});
t("self-borrow never scores", () => {
  const r = computeStats({ users, items: [item({ userId: "A", claims: [claim("A", 5*H)], completedBy: [done("A", 2*H)] })] }, NOW);
  assert.equal(pts(r, "A"), POINTS.lend);
});
t("junk completedBy entries for people who never borrowed do nothing", () => {
  const r = computeStats({ users, items: [item({ userId: "A", completedBy: [done("B", 2*H), done("C", 2*H)] })] }, NOW);
  assert.equal(pts(r, "B"), 0); assert.equal(pts(r, "C"), 0);
});
t("10 empty listings can no longer buy Gold", () => {
  const items = Array.from({ length: 10 }, () => item({ userId: "A" }));
  assert.ok(pts(computeStats({ users, items }, NOW), "A") <= CAPS.lent * POINTS.lend);
});
t("spamming 'I can lend this' on 50 requests scores nothing", () => {
  const requests = Array.from({ length: 50 }, (_, i) => ({ id: "r"+i, userId: "B", status: "open", offeredBy: ["A"] }));
  const r = computeStats({ users, requests }, NOW);
  assert.equal(pts(r, "A"), 0);
});
t("requester can't credit someone who never offered", () => {
  const r = computeStats({ users, requests: [{ id: "r", userId: "B", status: "fulfilled", offeredBy: ["C"], fulfilledBy: "A" }] }, NOW);
  assert.equal(pts(r, "A"), 0);
});
t("genuine fulfilled request credits helper and requester", () => {
  const r = computeStats({ users, requests: [{ id: "r", userId: "B", status: "fulfilled", offeredBy: ["A","C"], fulfilledBy: "A" }] }, NOW);
  assert.equal(pts(r, "A"), POINTS.helped);
  assert.equal(pts(r, "B"), POINTS.request + POINTS.requestFulfilled);
  assert.equal(pts(r, "C"), 0);
});
t("same helper+requester pair only counts once", () => {
  const requests = Array.from({ length: 5 }, (_, i) => ({ id: "r"+i, userId: "B", status: "fulfilled", offeredBy: ["A"], fulfilledBy: "A" }));
  assert.equal(pts(computeStats({ users, requests }, NOW), "A"), POINTS.helped);
});
t("swapping items back and forth between two accounts earns once, not twice", () => {
  const items = [
    item({ userId: "A", claims: [claim("B", 5*H)], completedBy: [done("B", 2*H)] }),
    item({ userId: "B", claims: [claim("A", 5*H)], completedBy: [done("A", 2*H)] }),
  ];
  const r = computeStats({ users, items }, NOW);
  assert.equal(pts(r, "A") + pts(r, "B"), 2*POINTS.lend + POINTS.lentOut + POINTS.borrow);
  const rev = computeStats({ users, items: [...items].reverse() }, NOW);
  assert.deepEqual(rev.ranked.map((m) => [m.uid, m.points]).sort(), r.ranked.map((m) => [m.uid, m.points]).sort());
});
t("banning a fake account removes the points it handed out", () => {
  const items = [item({ userId: "A", claims: [claim("B", 5*H)], completedBy: [done("B", 2*H)] })];
  const before = computeStats({ users, items }, NOW);
  const after = computeStats({ users: users.map((u) => u.id === "B" ? { ...u, banned: true } : u), items }, NOW);
  assert.equal(pts(before, "A"), POINTS.lend + POINTS.lentOut);
  assert.equal(pts(after, "A"), POINTS.lend);
  assert.ok(!after.ranked.some((m) => m.uid === "B"));
});
t("a ring of 40 fake accounts is bounded by the caps (can't exceed the theoretical max)", () => {
  const ring = Array.from({ length: 40 }, (_, i) => ({ id: "F"+i, name: "F"+i }));
  const items = [];
  ring.forEach((a, i) => ring.forEach((b, j) => { if (i !== j) items.push(item({ userId: a.id, claims: [claim(b.id, 5*H)], completedBy: [done(b.id, 2*H)] })); }));
  const r = computeStats({ users: ring, items }, NOW);
  const max = CAPS.lent*POINTS.lend + CAPS.lentOut*POINTS.lentOut + CAPS.borrowed*POINTS.borrow + CAPS.helped*POINTS.helped + CAPS.requests*(POINTS.request+POINTS.requestFulfilled);
  r.ranked.forEach((m) => assert.ok(m.points <= max));
  console.log("   ring member points:", r.ranked[0].points, "| absolute per-account ceiling:", max);
});
t("an admin-given custom rank id is kept; junk rank values are ignored", () => {
  const us = [{ id: "A", name: "A", rank: "c_legend1" }, { id: "B", name: "B", rank: "c_x" }, { id: "C", name: "C", rank: "<b>hax</b>" }, { id: "D", name: "D", rank: "gold" }];
  const r = computeStats({ users: us, items: [] }, NOW);
  const ar = (id) => (r.ranked.find((m) => m.uid === id) || {}).assignedRank;
  assert.equal(ar("A"), "c_legend1"); assert.equal(ar("D"), "gold");
  assert.equal(ar("B"), undefined); assert.equal(ar("C"), undefined);
});
console.log(`\n${n} tests passed`);
