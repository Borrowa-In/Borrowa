// Photos without Firebase Storage: shrink the picture in the browser with a
// canvas, re-encode it as a small WebP/JPEG, and keep the result as a text
// string (data URL) inside the listing itself. Viewers render it directly.
// Target is ~45 KB so a page full of listings stays light; firestore.rules cap it at 90 KB.
export const MAX_PHOTO_CHARS = 90000;
const TARGET_CHARS = 60000;

export async function compressPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Please choose an image file.");
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (e) { throw new Error("That image couldn't be read. Try a JPG or PNG."); }
  let side = 560, quality = 0.72, out = "";
  for (let i = 0; i < 12; i++) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);   // flatten transparency
    g.drawImage(bmp, 0, 0, c.width, c.height);
    out = c.toDataURL("image/webp", quality);
    if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", quality); // older Safari
    if (out.length <= TARGET_CHARS) break;
    quality = Math.max(0.4, quality - 0.08);
    if (quality <= 0.5) side = Math.round(side * 0.85);
  }
  bmp.close && bmp.close();
  if (out.length > MAX_PHOTO_CHARS) throw new Error("That photo is too detailed to shrink enough. Try another one.");
  return out;
}
