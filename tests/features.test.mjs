import fs from "node:fs";
import assert from "node:assert/strict";
const rules = fs.readFileSync("config/firestore.rules", "utf8");
const dev = fs.readFileSync("config/firestore.dev.rules", "utf8");
const rat = fs.readFileSync("public/js/ratings.js", "utf8");

// ratings: pure summarize() pulled out of the module (the file imports Firebase from a CDN)
const src = rat.slice(rat.indexOf("export function summarize"), rat.indexOf("export async function loadRatingSummary")).replace("export ", "");
const summarize = new Function(src + "; return summarize;")();
assert.deepEqual(summarize([]), { count: 0, avg: 0 });
assert.deepEqual(summarize([{ score: 5 }, { score: 4 }, { score: 9 }, { score: 0 }]), { count: 2, avg: 4.5 });
console.log("ok - rating summary ignores out-of-range scores");

const rb = rules.slice(rules.indexOf("match /ratings/"), rules.indexOf("match /pushTokens/"));
assert.ok(rb.includes("rid == request.resource.data.itemId + '_' + request.auth.uid"), "one rating per rater per item");
assert.ok(rb.includes("rateeId != request.auth.uid"), "no self-rating");
assert.ok(rb.includes("allow update: if false"), "ratings are immutable");
assert.ok(rb.includes("createdAt == request.time"), "server time");
console.log("ok - ratings rules");

assert.ok(/'item', 'user', 'request', 'loan'/.test(rules), "loan disputes allowed as report kind");
assert.ok(rules.includes("kind != 'loan'") && rules.includes("claimedBy', null) == request.auth.uid"), "only lender/borrower can dispute");
const mod = rules.slice(rules.indexOf("allow read: if isModerator()"), rules.indexOf("allow update: if isModerator()"));
assert.ok(mod.includes("['item', 'user', 'request']") && !mod.includes("loan"), "moderators cannot see loan disputes");
console.log("ok - dispute rules");

assert.ok(rules.includes("'createdAt', 'urgent']") && rules.includes("get('urgent', false) is bool"), "urgent flag validated");
assert.ok(fs.readFileSync("functions/push.js", "utf8").includes("req.urgent"), "urgent push wording");
assert.ok(dev.includes("match /ratings/") && dev.includes("'loan'"), "dev rules regenerated");
console.log("ok - urgent requests + dev rules");

for (const f of ["public/impact.html", "public/js/dispute.js"]) assert.ok(fs.existsSync(f), f);
console.log("features tests passed");
