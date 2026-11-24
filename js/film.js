// แปลงภาพจากกล้องให้เป็นโทนฟิล์ม: สีอุ่น ดำไม่สนิท เกรน ขอบมืด แสงรั่ว และวันที่สีส้ม
export const OUT_W = 1080;
export const OUT_H = 1440;

function coverDraw(ctx, src, sw, sh, w, h, mirror) {
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}

// ตารางโทนสีต่อช่องสี คำนวณครั้งเดียว
const LUT = (() => {
  const r = new Uint8ClampedArray(256), g = new Uint8ClampedArray(256), b = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    x = x * x * (3 - 2 * x) * 0.55 + x * 0.45;      // คอนทราสต์แบบ S อ่อน ๆ
    const lifted = 0.06 + x * 0.92;                 // ดำไม่สนิท ขาวไม่จ้า
    r[i] = (lifted * 1.05 + 0.015) * 255;           // อุ่นขึ้น
    g[i] = (lifted * 1.0 + 0.005) * 255;
    b[i] = (lifted * 0.9 + 0.03) * 255;             // เงาอมฟ้าเขียวนิด ๆ
  }
  return { r, g, b };
})();

function grade(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const sat = 0.88;
  for (let i = 0; i < d.length; i += 4) {
    let r = LUT.r[d[i]], g = LUT.g[d[i + 1]], b = LUT.b[d[i + 2]];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const n = (Math.random() - 0.5) * 26 * (1 - l / 400);   // เกรน ชัดในเงามากกว่า
    d[i] = l + (r - l) * sat + n;
    d[i + 1] = l + (g - l) * sat + n;
    d[i + 2] = l + (b - l) * sat + n;
  }
  ctx.putImageData(img, 0, 0);
}

function overlays(ctx, w, h, opts) {
  // ขอบมืด
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(20,10,0,0.42)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // แสงรั่ว สุ่มประมาณ 1 ใน 3 รูป
  if (Math.random() < 0.34) {
    const left = Math.random() < 0.5;
    const x = left ? 0 : w;
    const y = h * (0.15 + Math.random() * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, w * (0.45 + Math.random() * 0.3));
    g.addColorStop(0, 'rgba(255,120,40,0.55)');
    g.addColorStop(0.5, 'rgba(255,60,30,0.18)');
    g.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (opts.dateStamp) {
    const t = opts.date || new Date();
    const p = (n) => String(n).padStart(2, '0');
    const text = `'${p(t.getFullYear() % 100)} ${p(t.getMonth() + 1)} ${p(t.getDate())}`;
    ctx.font = `700 ${Math.round(w * 0.042)}px "Courier New", ui-monospace, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(255,90,0,0.9)';
    ctx.shadowBlur = w * 0.012;
    ctx.fillStyle = '#ffa23a';
    ctx.fillText(text, w - w * 0.06, h - w * 0.065);
    ctx.shadowBlur = 0;
  }
}

/** src = <video> หรือ <img>/ImageBitmap, คืน canvas ขนาด 1080x1440 ที่แต่งโทนแล้ว */
export function develop(src, opts = {}) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const c = document.createElement('canvas');
  c.width = OUT_W; c.height = OUT_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  coverDraw(ctx, src, sw, sh, OUT_W, OUT_H, !!opts.mirror);
  grade(ctx, OUT_W, OUT_H);
  overlays(ctx, OUT_W, OUT_H, opts);
  return c;
}

export function toBlob(canvas, quality = 0.82) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', quality));
}

export function makeThumb(canvas, w = 360) {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round((w * canvas.height) / canvas.width);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return toBlob(c, 0.7);
}
