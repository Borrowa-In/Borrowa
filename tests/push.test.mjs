import push from "../functions/push.js";
import assert from "node:assert/strict";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("chunk splits into groups of at most 500", () => {
  const list = Array.from({ length: 1201 }, (_, i) => i);
  const parts = push.chunk(list);
  assert.deepEqual(parts.map((p) => p.length), [500, 500, 201]);
  assert.deepEqual(push.chunk([]), []);
  assert.deepEqual(push.chunk([1, 2, 3], 2), [[1, 2], [3]]);
});
t("pickTokens removes duplicates, blanks and the excluded member", () => {
  const out = push.pickTokens([
    { token: "a", uid: "u1" }, { token: "a", uid: "u1" }, { token: "b", uid: "me" },
    { token: "", uid: "u2" }, { uid: "u3" }, { token: "c", uid: "u2" }, null,
  ], { excludeUid: "me" });
  assert.deepEqual(out, ["a", "c"]);
});
t("deadTokens finds only permanently-bad tokens", () => {
  const dead = push.deadTokens(["a", "b", "c", "d"], [
    { success: true },
    { success: false, error: { code: "messaging/registration-token-not-registered" } },
    { success: false, error: { code: "messaging/internal-error" } },
    { success: false, error: { code: "messaging/invalid-registration-token" } },
  ]);
  assert.deepEqual(dead, ["b", "d"]);
});
t("buildMessage is data-only, flat strings, with limits", () => {
  const m = push.buildMessage({ kind: "item", title: "x".repeat(200), body: "y".repeat(500), url: "home.html", tag: "t" });
  assert.equal(Object.keys(m).join(), "data");
  Object.values(m.data).forEach((v) => assert.equal(typeof v, "string"));
  assert.ok(m.data.title.length <= 60 && m.data.body.length <= 140);
});
t("clean strips control characters and extra spaces", () => {
  assert.equal(push.clean("  a\n\n b\t\u0000c  ", 50), "a b c");
});
t("safeUrl only allows relative pages on our own site", () => {
  assert.equal(push.safeUrl("requests.html"), "requests.html");
  assert.equal(push.safeUrl("chat.html?id=abc"), "chat.html?id=abc");
  for (const bad of ["https://evil.com", "//evil.com", "/abs.html", "javascript:alert(1)", "..\\x", ""]) {
    assert.equal(push.safeUrl(bad), "home.html", bad);
  }
});
t("item and request messages use the right page and text", () => {
  const i = push.itemMessage({ title: "Drill", pickupLocation: "Block B" }, "i1").data;
  assert.equal(i.url, "home.html"); assert.match(i.body, /Drill/); assert.match(i.body, /Block B/);
  const r = push.requestMessage({ title: "Ladder", building: "Tower 2" }, "r1").data;
  assert.equal(r.url, "requests.html"); assert.match(r.body, /Ladder/);
  assert.equal(push.requestMessage({ title: "Ladder" }, "r2").data.body, "Ladder");
});
t("offer message goes to the requests page", () => {
  const o = push.offerMessage({ title: "Ladder" }, "r1").data;
  assert.equal(o.url, "requests.html"); assert.match(o.body, /Ladder/);
});
t("notification messages cover borrowed, due reminder and expiry", () => {
  assert.match(push.notificationMessage({ type: "item_claimed", claimedByName: "Asha", itemTitle: "Drill" }, "n1").data.body, /Asha borrowed Drill/);
  assert.match(push.notificationMessage({ type: "due_reminder", itemTitle: "Drill", dueLabel: "Mon Oct 05 2026" }, "n2").data.body, /return Drill by Mon/);
  assert.match(push.notificationMessage({ type: "listing_expired", itemTitle: "Drill" }, "n3").data.body, /Drill/);
});
t("chat message is generic and never contains message content", () => {
  const m = push.chatMessage("Asha", "item1_a_b").data;
  assert.equal(m.body, "New message from Asha");
  assert.equal(m.url, "chat.html?id=item1_a_b");
  assert.equal(push.chatMessage("", "c1").data.body, "New message from a neighbour");
  assert.ok(!("cipher" in m) && !("iv" in m));
});
t("chat id with odd characters is URL-encoded", () => {
  assert.equal(push.chatMessage("A", "req-x y&z").data.url, "chat.html?id=req-x%20y%26z");
});
console.log(`\n${n} push tests passed`);
