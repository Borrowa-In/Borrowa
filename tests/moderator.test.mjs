// Moderator rank: shared rank keys stay in sync, the rank can be restyled, and the rules only let
// moderators do review-only updates. (Rules are checked as text here, not executed.)
import assert from "node:assert/strict";
import fs from "node:fs";
import { RANK_KEYS, computeStats } from "../public/js/points.js";
import { createRequire } from "node:module";
const { RANK_KEYS: FN_KEYS } = createRequire(import.meta.url)("../functions/points.js");
import { cleanRankConfig, BASE_RANK_KEYS } from "../public/js/rank-style.js";

assert.ok(RANK_KEYS.includes("moderator") && FN_KEYS.includes("moderator"));
assert.deepEqual(RANK_KEYS, FN_KEYS);
console.log("ok - moderator is a valid assigned rank in the browser and functions copies");

const stats = computeStats({ items: [], requests: [], users: [{ id: "u1", name: "Asha", rank: "moderator" }, { id: "u2", name: "Ravi", rank: "bogus" }] });
const asha = stats.ranked.find((m) => m.uid === "u1");
assert.equal(asha && asha.assignedRank, "moderator");
assert.ok(!stats.ranked.find((m) => m.uid === "u2"));
console.log("ok - a moderator keeps the rank, a made-up rank is ignored");

assert.ok(BASE_RANK_KEYS.includes("moderator"));
const cfg = cleanRankConfig({ overrides: { moderator: { c1: "#112233", c2: "#445566", angle: 90 } }, custom: [] });
assert.equal(cfg.overrides.moderator.c1, "#112233");
console.log("ok - main admin can restyle the moderator gradient");

const rules = fs.readFileSync(new URL("../config/firestore.rules", import.meta.url), "utf8");
assert.match(rules, /function isModerator\(\)/);
assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.get\('rank', ''\) == 'moderator'/);
const upd = rules.slice(rules.indexOf("allow update: if isModerator()"));
assert.match(upd, /hasOnly\(\['status', 'modVerdict', 'modNote', 'modBy', 'modByName', 'modAt'\]\)/);
assert.match(upd, /modVerdict in \['violation', 'false'\]/);
assert.match(upd, /status == 'checked'/);
assert.match(upd, /kind in \['item', 'user', 'request'\]/);
assert.match(upd, /reporterId != request\.auth\.uid/);
// moderators never get delete, and never read chat reports
assert.ok(!/allow [a-z, ]*delete[a-z, ]*: if isModerator/.test(rules));
const read = rules.slice(rules.indexOf("allow read: if isModerator()"), rules.indexOf("allow update: if isModerator()"));
assert.match(read, /kind in \['item', 'user', 'request'\]/);
// users.rank is still admin-only, so nobody can make themselves a moderator
assert.match(rules, /affectedKeys\(\)\.hasOnly\(\['name', 'building', 'publicKey'\]\)/);
console.log("ok - rules: review-only update, no delete, no chat reports, rank not self-editable");
console.log("moderator tests passed");
