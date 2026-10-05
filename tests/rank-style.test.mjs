import assert from "node:assert";
import * as R from "../public/js/rank-style.js";

const ok = (name, fn) => { fn(); console.log("ok - " + name); };

ok("hex helpers accept short and long forms, reject junk", () => {
  assert.equal(R.normalizeHex("#ABC"), "#aabbcc");
  assert.equal(R.normalizeHex("14632f"), "#14632f");
  assert.equal(R.normalizeHex("url(x)"), "");
  assert.equal(R.safeHex("#14632F"), "#14632f");
  assert.equal(R.safeHex("red;background:url(x)"), "");
});
ok("hsl <-> hex round trip stays within 1 step", () => {
  for (const h of ["#14632f", "#ff7e5f", "#2193b0", "#8e2de2", "#ffffff", "#000000"]) {
    const { h: H, s, l } = R.hexToHsl(h);
    const back = R.hexToRgb(R.hslToHex(H, s, l)), want = R.hexToRgb(h);
    assert.ok(Math.abs(back.r - want.r) <= 3 && Math.abs(back.g - want.g) <= 3 && Math.abs(back.b - want.b) <= 3, h);
  }
});
ok("gradient css is only built from clean values", () => {
  assert.equal(R.gradientCss("#112233", "#445566", 90), "linear-gradient(90deg,#112233,#445566)");
  assert.equal(R.gradientCss("#112233", "", 90), "#112233");
  assert.equal(R.gradientCss("#112233", "#112233", 90), "#112233");
  assert.equal(R.gradientCss("bad", "#445566"), "#ffffff");
  assert.equal(R.gradientCss("#112233", "#445566", 9999), "linear-gradient(360deg,#112233,#445566)");
  assert.equal(R.gradientCss("#112233", "#445566", "x);evil"), "linear-gradient(135deg,#112233,#445566)");
});
ok("contrast picks readable text", () => {
  assert.equal(R.contrastText("#ffffff", "#f3f4f6"), "#111827");
  assert.equal(R.contrastText("#0f2027", "#2c5364"), "#ffffff");
});
ok("rank config cleaner drops bad ids, names, colours and caps the list", () => {
  const cfg = R.cleanRankConfig({
    overrides: { gold: { c1: "#ffd700", c2: "#fff2a8", angle: 45 }, hacker: { c1: "#000000" }, silver: { c1: "javascript:alert(1)" } },
    custom: [
      { id: "c_abc123", name: "  Legend <b>X</b>  ", icon: "👑", min: "150", c1: "#8e2de2", c2: "#f368a8", angle: 120 },
      { id: "c_abc123", name: "Dup", c1: "#000000" },
      { id: "nope", name: "Bad id", c1: "#000000" },
      { id: "c_zzz999", name: "", c1: "#000000" },
      { id: "c_manual1", name: "Helper", icon: "", min: null, c1: "#14632f" },
      ...Array.from({ length: 40 }, (_, i) => ({ id: "c_gen" + String(i).padStart(3, "0"), name: "G" + i, c1: "#123456" })),
    ],
  });
  assert.deepEqual(Object.keys(cfg.overrides).sort(), ["gold"]);
  assert.equal(cfg.overrides.gold.c2, "#fff2a8");
  assert.equal(cfg.custom[0].name, "Legend bX/b");
  assert.ok(!/[<>&"']/.test(cfg.custom[0].name));
  assert.equal(cfg.custom[0].min, 150);
  assert.equal(cfg.custom[1].min, null);
  assert.equal(cfg.custom[1].icon, "⭐");
  assert.ok(cfg.custom.length <= R.MAX_CUSTOM_RANKS);
  assert.ok(!cfg.custom.some((c) => c.id === "nope"));
});
ok("tierLook produces gradient badge, readable text, border and glow", () => {
  const look = R.tierLook(R.cleanRankStyle({ c1: "#8e2de2", c2: "#f368a8", angle: 120 }));
  assert.match(look.bg, /^linear-gradient\(120deg,#8e2de2,#f368a8\)$/);
  assert.ok(/^#[0-9a-f]{6}$/.test(look.border) && /^#/.test(look.color));
  assert.match(look.glow, /rgba\(142,45,226,0\.34\)/);
});
ok("new rank ids match the pattern the cleaner and points.js accept", () => {
  for (let i = 0; i < 50; i++) assert.match(R.newRankId(), /^c_[a-z0-9]{6}$/);
});
ok("post background css uses a gradient only when a second colour is set", () => {
  assert.equal(R.postBgCss({ bg: "#ffffff" }), "#ffffff");
  assert.equal(R.postBgCss({ bg: "#ffffff", bg2: "#e6f6ec", angle: 160 }), "linear-gradient(160deg,#ffffff,#e6f6ec)");
  assert.equal(R.postBgCss(null, "x"), "x");
});
console.log("rank-style tests passed");
