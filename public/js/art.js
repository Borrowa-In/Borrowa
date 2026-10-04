// Vector pictures for item cards. Pure inline SVG (shapes and curves, no image files), so they
// stay sharp at any size or screen and can never "tear up" or go blurry. Purely decorative:
// nothing here reads or changes any data.
const S = "stroke-linecap='round' stroke-linejoin='round'";

const ART = {
  bike: `<circle cx='32' cy='60' r='20' fill='none' stroke='#374151' stroke-width='4'/><circle cx='88' cy='60' r='20' fill='none' stroke='#374151' stroke-width='4'/>
    <path d='M32 60 L50 32 H76 L88 60 M50 32 L60 60 H32 M60 60 L76 32 M44 26 H56 M72 26 L76 32 L80 24 H90' fill='none' stroke='#4b5563' stroke-width='4' ${S}/>
    <circle cx='60' cy='60' r='5' fill='#9ca3af'/>`,
  camera: `<rect x='18' y='30' width='84' height='52' rx='9' fill='#374151'/><rect x='38' y='20' width='28' height='14' rx='4' fill='#4b5563'/>
    <circle cx='60' cy='56' r='21' fill='#1f2937'/><circle cx='60' cy='56' r='15' fill='#475569'/><circle cx='60' cy='56' r='8' fill='#0f172a'/><circle cx='54' cy='50' r='3' fill='#94a3b8'/>
    <rect x='80' y='36' width='13' height='7' rx='2' fill='#9ca3af'/>`,
  ladder: `<path d='M40 8 L26 84 M80 8 L94 84' stroke='#9ca3af' stroke-width='6' ${S}/>
    <path d='M37 26 H83 M34 42 H86 M31 58 H89 M28 74 H92' stroke='#6b7280' stroke-width='5' ${S}/>`,
  game: `<rect x='14' y='22' width='92' height='58' rx='6' fill='#2563eb'/><rect x='22' y='30' width='76' height='42' rx='4' fill='#fbbf24'/>
    <circle cx='42' cy='51' r='9' fill='#ef4444'/><circle cx='64' cy='44' r='7' fill='#22c55e'/><rect x='72' y='50' width='16' height='16' rx='3' fill='#fff'/>
    <circle cx='77' cy='55' r='2' fill='#111'/><circle cx='83' cy='61' r='2' fill='#111'/>`,
  mixer: `<path d='M34 40 H90 Q96 40 96 46 V56 H34 Z' fill='#9ca3af'/><rect x='46' y='24' width='36' height='18' rx='8' fill='#cbd5e1'/>
    <path d='M30 56 H100 V66 Q100 74 92 74 H38 Q30 74 30 66 Z' fill='#6b7280'/><path d='M48 44 Q50 76 64 76 Q78 76 80 44 Z' fill='#e5e7eb' stroke='#9ca3af' stroke-width='2'/>
    <rect x='56' y='12' width='8' height='14' rx='3' fill='#6b7280'/>`,
  washer: `<rect x='34' y='34' width='40' height='46' rx='8' fill='#facc15'/><rect x='42' y='22' width='24' height='16' rx='4' fill='#374151'/>
    <path d='M74 50 Q92 46 94 66 Q96 80 86 84' fill='none' stroke='#374151' stroke-width='4' ${S}/><rect x='42' y='46' width='24' height='10' rx='3' fill='#fde68a'/>
    <circle cx='44' cy='82' r='5' fill='#374151'/><circle cx='64' cy='82' r='5' fill='#374151'/>`,
  drill: `<path d='M20 30 H74 Q84 30 84 40 V46 H20 Z' fill='#16a34a'/><rect x='84' y='34' width='14' height='8' fill='#6b7280'/><rect x='98' y='37' width='14' height='2.5' fill='#9ca3af'/>
    <path d='M34 46 H56 L52 80 Q51 84 46 84 H42 Q37 84 37 80 Z' fill='#15803d'/><rect x='14' y='48' width='6' height='14' rx='2' fill='#374151'/>`,
  book: `<rect x='24' y='54' width='72' height='16' rx='3' fill='#2563eb'/><rect x='30' y='38' width='62' height='16' rx='3' fill='#f59e0b'/>
    <rect x='22' y='22' width='66' height='16' rx='3' fill='#16a34a'/><rect x='30' y='28' width='24' height='3' rx='1.5' fill='#bbf7d0'/><rect x='38' y='60' width='30' height='3' rx='1.5' fill='#bfdbfe'/>`,
  chair: `<path d='M40 14 H80 L84 52 H36 Z' fill='#b45309'/><rect x='30' y='52' width='60' height='12' rx='4' fill='#d97706'/>
    <path d='M38 64 L32 88 M82 64 L88 88 M50 64 V86 M70 64 V86' stroke='#92400e' stroke-width='5' ${S}/>`,
  shirt: `<path d='M44 14 Q60 26 76 14 L100 28 L90 44 L82 38 V82 H38 V38 L30 44 L20 28 Z' fill='#3b82f6'/><path d='M44 14 Q60 26 76 14' fill='none' stroke='#1d4ed8' stroke-width='3'/>`,
  laptop: `<rect x='26' y='20' width='68' height='44' rx='5' fill='#374151'/><rect x='31' y='25' width='58' height='34' rx='2' fill='#60a5fa'/>
    <path d='M14 68 H106 L100 78 H20 Z' fill='#9ca3af'/>`,
  box: `<path d='M60 14 L100 32 V68 L60 86 L20 68 V32 Z' fill='#d6a35c'/><path d='M60 14 L100 32 L60 50 L20 32 Z' fill='#e8bd7e'/><path d='M60 50 V86' stroke='#b9822f' stroke-width='3'/>
    <rect x='52' y='56' width='16' height='5' rx='2' fill='#b9822f' transform='rotate(24 60 58)'/>`,
};

const BY_TITLE = [
  [/bike|bicycle|cycle|scooter/, "bike"],
  [/camera|dslr|lens|gopro|tripod/, "camera"],
  [/ladder|step ?stool/, "ladder"],
  [/board ?game|chess|cards?|puzzle|monopoly|ludo|carrom/, "game"],
  [/mixer|blender|grinder|kitchen|cooker|oven|toaster/, "mixer"],
  [/pressure|washer|cleaner|vacuum|hose/, "washer"],
  [/drill|screw|hammer|tool|saw|wrench|spanner|plier/, "drill"],
  [/book|novel|notes|textbook|guide|comic/, "book"],
  [/laptop|computer|tablet|ipad|monitor|keyboard|phone|charger/, "laptop"],
];
const BY_CATEGORY = { Furniture: "chair", Electronics: "laptop", Books: "book", Clothing: "shirt", Misc: "box" };
const TINT = { bike: "#e8f5ec", camera: "#eef2f7", ladder: "#f1f5f2", game: "#fff4e0", mixer: "#f1f5f9", washer: "#fffbe6",
  drill: "#e9f7ee", book: "#eaf1ff", chair: "#fdf0e1", shirt: "#eaf2ff", laptop: "#eef3fb", box: "#fbf1e1" };

export function artKey(item) {
  const t = String((item && item.title) || "").toLowerCase();
  const hit = BY_TITLE.find(([re]) => re.test(t));
  return hit ? hit[1] : BY_CATEGORY[item && item.category] || "box";
}

export function artSvg(key, size = 120) {
  const body = ART[key] || ART.box;
  return `<svg viewBox="0 0 120 90" width="${size}" height="${Math.round(size * 0.75)}" role="img" aria-hidden="true" focusable="false">${body}</svg>`;
}

// The picture tile shown at the top of an item card.
export function itemArtHtml(item) {
  const key = artKey(item);
  return `<div class="item-art" style="background:${TINT[key] || "#eef6f0"}">${artSvg(key, 132)}</div>`;
}
