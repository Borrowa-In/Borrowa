// An inline colour + gradient picker that lives ON the page (no pop-up and no browser colour
// dialog): preset gradients, colour chips to choose what you are editing, swatches, hue /
// saturation / lightness sliders, a hex box and a gradient-angle slider.
//
//   const studio = createColorStudio(rootEl, {
//     slots: [{ key: "bg", label: "Background" }, { key: "bg2", label: "Second colour" }, ...],
//     values: { bg: "#ffffff", bg2: "#e6f6ec" },
//     angle: 160,                                  // omit / null to hide the angle slider
//     gradientToggle: { slot: "bg2", label: "Use a gradient", on: true },   // optional
//     presets: [{ name, values: { bg, bg2 }, angle }],                      // optional
//     onChange: ({ values, angle, gradientOn }) => {},
//   });
//   studio.set({ values, angle, gradientOn });  studio.get();
import { SWATCHES, safeHex, normalizeHex, clampAngle, hexToHsl, hslToHex, gradientCss } from "./rank-style.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createColorStudio(root, opts) {
  const slots = opts.slots || [];
  const toggle = opts.gradientToggle || null;
  const hasAngle = opts.angle !== undefined && opts.angle !== null;
  const state = {
    values: {},
    angle: hasAngle ? clampAngle(opts.angle) : null,
    gradientOn: toggle ? toggle.on !== false : true,
  };
  slots.forEach((s) => { state.values[s.key] = safeHex((opts.values || {})[s.key]) || "#ffffff"; });
  let active = slots[0] ? slots[0].key : null;
  let hsl = active ? hexToHsl(state.values[active]) : { h: 0, s: 0, l: 100 };

  root.classList.add("cs");
  root.innerHTML = `
    ${opts.presets && opts.presets.length ? `<div class="cs-label">Quick gradients</div>
    <div class="cs-presets" role="group" aria-label="Quick gradients">${opts.presets.map((p, i) => `
      <button type="button" class="cs-preset" data-preset="${i}" title="${esc(p.name)}">
        <span class="cs-preset-chip" style="background:${gradientCss((p.values && (p.values.bg || p.values.c1)) || p.c1, (p.values && (p.values.bg2 || p.values.c2)) || p.c2, p.angle || 135)}"></span>
        <span class="cs-preset-name">${esc(p.name)}</span>
      </button>`).join("")}</div>` : ""}
    ${toggle ? `<label class="cs-toggle"><input type="checkbox" class="cs-gradient-on" /> <span>${esc(toggle.label || "Use a gradient")}</span></label>` : ""}
    <div class="cs-label">Pick what to colour</div>
    <div class="cs-slots" role="group" aria-label="Colours">${slots.map((s) => `
      <button type="button" class="cs-slot" data-slot="${esc(s.key)}">
        <span class="cs-dot"></span><span class="cs-slot-name">${esc(s.label)}</span>
      </button>`).join("")}</div>
    <div class="cs-editor">
      <div class="cs-swatches" role="group" aria-label="Swatches">${SWATCHES.map((c) => `<button type="button" class="cs-swatch" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>
      <label class="cs-row"><span>Hue</span><input type="range" class="cs-h" min="0" max="360" step="1" /></label>
      <label class="cs-row"><span>Strength</span><input type="range" class="cs-s" min="0" max="100" step="1" /></label>
      <label class="cs-row"><span>Light</span><input type="range" class="cs-l" min="0" max="100" step="1" /></label>
      <label class="cs-row"><span>Hex</span><input type="text" class="cs-hex" maxlength="7" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="#14632f" /></label>
    </div>
    ${hasAngle ? `<label class="cs-row cs-angle-row"><span>Angle</span><input type="range" class="cs-angle" min="0" max="360" step="5" /><output class="cs-angle-out"></output></label>` : ""}
  `;

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => Array.from(root.querySelectorAll(sel));
  const hexIn = $(".cs-hex"), hIn = $(".cs-h"), sIn = $(".cs-s"), lIn = $(".cs-l");
  const angleIn = $(".cs-angle"), angleOut = $(".cs-angle-out"), gOn = $(".cs-gradient-on");

  const emit = () => { if (typeof opts.onChange === "function") opts.onChange(get()); };
  const get = () => ({ values: { ...state.values }, angle: state.angle, gradientOn: state.gradientOn });

  function slotVisible(key) { return !(toggle && key === toggle.slot && !state.gradientOn); }

  function paint() {
    // chips
    $$(".cs-slot").forEach((b) => {
      const k = b.dataset.slot;
      b.hidden = !slotVisible(k);
      b.classList.toggle("active", k === active);
      b.setAttribute("aria-pressed", k === active ? "true" : "false");
      b.querySelector(".cs-dot").style.background = state.values[k];
    });
    // swatch highlight
    $$(".cs-swatch").forEach((b) => b.classList.toggle("on", b.dataset.color === state.values[active]));
    // sliders + tracks
    hIn.value = hsl.h; sIn.value = hsl.s; lIn.value = hsl.l;
    const mid = hslToHex(hsl.h, hsl.s, 50);
    hIn.style.background = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";
    sIn.style.background = `linear-gradient(90deg,${hslToHex(hsl.h, 0, hsl.l)},${hslToHex(hsl.h, 100, hsl.l)})`;
    lIn.style.background = `linear-gradient(90deg,#000,${mid},#fff)`;
    if (document.activeElement !== hexIn) hexIn.value = state.values[active] || "";
    hexIn.classList.remove("bad");
    if (gOn) gOn.checked = state.gradientOn;
    if (angleIn) {
      angleIn.value = state.angle; angleOut.textContent = state.angle + "°";
      const row = $(".cs-angle-row"); if (row) row.hidden = !state.gradientOn && !!toggle;
    }
  }

  function setActive(key) {
    if (!slots.some((s) => s.key === key) || !slotVisible(key)) return;
    active = key; hsl = hexToHsl(state.values[active]); paint();
  }
  function setActiveColor(hex, fromSlider = false) {
    const h = safeHex(hex); if (!h || !active) return;
    state.values[active] = h;
    if (!fromSlider) hsl = hexToHsl(h);
    paint(); emit();
  }

  root.addEventListener("click", (e) => {
    const slot = e.target.closest(".cs-slot"); if (slot) { setActive(slot.dataset.slot); return; }
    const sw = e.target.closest(".cs-swatch"); if (sw) { setActiveColor(sw.dataset.color); return; }
    const pre = e.target.closest(".cs-preset");
    if (pre) {
      const p = opts.presets[Number(pre.dataset.preset)]; if (!p) return;
      const v = p.values || { [slots[0].key]: p.c1, [(slots[1] || slots[0]).key]: p.c2 };
      Object.keys(v).forEach((k) => { const c = safeHex(v[k]); if (c && k in state.values) state.values[k] = c; });
      if (hasAngle && p.angle !== undefined) state.angle = clampAngle(p.angle);
      if (p.text && "text" in state.values) state.values.text = safeHex(p.text) || state.values.text;
      if (toggle) state.gradientOn = true;
      hsl = hexToHsl(state.values[active]); paint(); emit();
    }
  });
  const fromSliders = () => { hsl = { h: Number(hIn.value), s: Number(sIn.value), l: Number(lIn.value) }; setActiveColor(hslToHex(hsl.h, hsl.s, hsl.l), true); };
  [hIn, sIn, lIn].forEach((el) => el.addEventListener("input", fromSliders));
  hexIn.addEventListener("input", () => {
    const h = normalizeHex(hexIn.value);
    if (h) { hexIn.classList.remove("bad"); setActiveColor(h); } else hexIn.classList.add("bad");
  });
  hexIn.addEventListener("blur", () => { hexIn.value = state.values[active] || ""; hexIn.classList.remove("bad"); });
  if (angleIn) angleIn.addEventListener("input", () => { state.angle = clampAngle(angleIn.value); paint(); emit(); });
  if (gOn) gOn.addEventListener("change", () => {
    state.gradientOn = gOn.checked;
    if (!slotVisible(active)) { active = slots[0].key; hsl = hexToHsl(state.values[active]); }
    paint(); emit();
  });

  function set(next = {}) {
    if (next.values) slots.forEach((s) => { const c = safeHex(next.values[s.key]); if (c) state.values[s.key] = c; });
    if (hasAngle && next.angle !== undefined && next.angle !== null) state.angle = clampAngle(next.angle);
    if (toggle && next.gradientOn !== undefined) state.gradientOn = !!next.gradientOn;
    if (!slotVisible(active)) active = slots[0].key;
    hsl = hexToHsl(state.values[active]); paint();
  }

  paint();
  return { set, get, setActive };
}
