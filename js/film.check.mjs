// แปลงภาพจากกล้องให้เป็นโทนฟิล์ม
//   ultramax = สีแบบ Kodak UltraMax 400: อุ่นอมเหลืองทอง เขียวอมมะกอก ฟ้าอมเขียวน้ำทะเล ดำไม่สนิท เกรนละเอียด
//   classic  = โทนอุ่นแบบเวอร์ชันแรก
//   bw       = ขาวดำอมน้ำตาล
// ทุกแบบมีเกรน ขอบมืด แสงรั่ว และวันที่สีส้ม
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

// ---------- สีฟิล์ม ----------
// แต่ละแบบคือฟังก์ชันรับสี r,g,b (0..1) แล้วคืนสีใหม่ ใช้สร้างตารางสี 3 มิติครั้งเดียว
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x) => x * x * (3 - 2 * x);
// น้ำหนักแบบระฆังรอบมุมสี (องศา) ใช้เลือกปรับเฉพาะช่วงสี
function bump(h, center, width) {
  let d = Math.abs(h - center);
  if (d > 180) d = 360 - d;
  return d >= width ? 0 : smooth(1 - d / width);
}

function ultramax(r, g, b) {
  let R = r, G = g, B = b;
  // 1) ปรับตามช่วงสี: เขียวเอียงไปทางมะกอก ฟ้าเอียงไปทางเขียวน้ำทะเลและจางลง
  //    ส่วนผิวคน ชมพู ม่วง ชดเชยไว้ไม่ให้เหลืองหรือส้มเกินเมื่อโดนโทนอุ่นในข้อ 2
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), c = mx - mn;
  if (c > 1e-4) {
    let h;
    if (mx === R) h = 60 * (((G - B) / c) % 6);
    else if (mx === G) h = 60 * ((B - R) / c + 2);
    else h = 60 * ((R - G) / c + 4);
    if (h < 0) h += 360;
    const s = c / mx;
    const green = bump(h, 108, 60), blue = bump(h, 214, 46), violet = bump(h, 280, 40), pink = bump(h, 335, 25), red = bump(h, 357, 22);
    const skin = bump(h, 24, 24) * clamp((0.85 - s) / 0.25);
    const dh = -16 * green - 8 * blue * (0.4 + 0.6 * mx) - 8 * violet - 5 * pink - 4 * skin;
    if (dh) {
      // หมุนสีโดยคงความสด/ความสว่างแบบ HSV
      h = (h + dh + 360) % 360;
      const C = mx * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = mx - C, k = Math.floor(h / 60) % 6;
      [R, G, B] = k === 0 ? [C, X, 0] : k === 1 ? [X, C, 0] : k === 2 ? [0, C, X] : k === 3 ? [0, X, C] : k === 4 ? [X, 0, C] : [C, 0, X];
      R += m; G += m; B += m;
    }
    // ความสด: ลด/เพิ่มรอบค่าความสว่าง (ภาพไม่สว่างขึ้นหรือมืดลง) ฟ้าสว่างลดมาก ฟ้าเข้ม (เช่นสูทกรมท่า) ลดน้อย
    const ks = 1 - 0.36 * green - 0.32 * blue * (0.35 + 0.65 * mx) - 0.1 * violet - 0.12 * skin + 0.06 * red;
    const l = 0.299 * R + 0.587 * G + 0.114 * B;
    R = clamp(l + (R - l) * ks); G = clamp(l + (G - l) * ks); B = clamp(l + (B - l) * ks);
    // ท้องฟ้าสว่างขึ้นนิด ให้ดูโปร่งแบบฟิล์ม
    const lift = 0.07 * blue * mx;
    R += (1 - R) * lift; G += (1 - G) * lift; B += (1 - B) * lift;
  }

  // 2) เส้นโค้งโทนแบบฟิล์ม: คอนทราสต์ช่วงกลาง ดำยกขึ้น ช่วงกลางอมเหลืองทอง ขาวนวลอมครีม
  const tone = (x, black, white, mid) => {
    const t = clamp(x + 0.36 * (smooth(clamp(x)) - x));
    return black + (white - black) * t + mid * 4 * t * (1 - t);
  };
  return [tone(R, 0.05, 0.99, 0.012), tone(G, 0.048, 0.969, 0), tone(B, 0.034, 0.925, -0.045)];
}

// โทนอุ่นแบบเวอร์ชันแรก (เผื่ออยากกลับไปใช้)
function classicCurve(x) {
  x = smooth(x) * 0.55 + x * 0.45;
  return 0.06 + x * 0.92;
}
function classic(r, g, b) {
  const R = classicCurve(r) * 1.05 + 0.015, G = classicCurve(g) + 0.005, B = classicCurve(b) * 0.9 + 0.03;
  const l = 0.299 * R + 0.587 * G + 0.114 * B;
  return [l + (R - l) * 0.88, l + (G - l) * 0.88, l + (B - l) * 0.88];
}
function bw(r, g, b) {
  const R = classicCurve(r) * 1.05 + 0.015, G = classicCurve(g) + 0.005, B = classicCurve(b) * 0.9 + 0.03;
  const l = 0.299 * R + 0.587 * G + 0.114 * B;
  return [l * 1.03 + 0.016, l * 0.99 + 0.004, l * 0.93];
}

export const LOOKS = { ultramax, classic, bw };
const N = 33; // จุดต่อช่องสีในตาราง (ทุก ๆ 8 ระดับ แล้วเฉลี่ยระหว่างจุด)
const luts = {};
function lutFor(style) {
  const key = LOOKS[style] ? style : 'ultramax';
  if (luts[key]) return luts[key];
  const f = LOOKS[key], lut = new Float32Array(N * N * N * 3);
  let i = 0;
  for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) {
    const o = f(r / (N - 1), g / (N - 1), b / (N - 1));
    lut[i++] = clamp(o[0]) * 255; lut[i++] = clamp(o[1]) * 255; lut[i++] = clamp(o[2]) * 255;
  }
  return (luts[key] = lut);
}

// ---------- เกรน ----------
// สุ่มลายเกรนไว้ครั้งเดียว เบลอนิด ๆ ให้เม็ดจับกลุ่มแบบฟิล์ม แล้วสุ่มตำแหน่งใช้ในแต่ละรูป
const GS = 512, GM = GS - 1;
let tile = null;
function grainTile() {
  if (tile) return tile;
  const n = GS * GS, a = new Float32Array(n), t = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.random() + Math.random() + Math.random() - 1.5;
  for (let y = 0; y < GS; y++) {
    for (let x = 0; x < GS; x++) {
      const i = y * GS + x;
      t[i] = a[i] * 0.6 + 0.1 * (a[y * GS + ((x + GM) & GM)] + a[y * GS + ((x + 1) & GM)] +
        a[((y + GM) & GM) * GS + x] + a[((y + 1) & GM) * GS + x]);
    }
  }
  let ss = 0;
  for (let i = 0; i < n; i++) ss += t[i] * t[i];
  const k = 1 / Math.sqrt(ss / n);
  for (let i = 0; i < n; i++) t[i] *= k;
  return (tile = t);
}

function grade(ctx, w, h, style) {
  const lut = lutFor(style), gt = grainTile();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const sc = (N - 1) / 255, S1 = 3, S2 = N * 3, S3 = N * N * 3, top = N - 2;
  const chroma = style === 'bw' ? 0 : 0.3;
  const ox = (Math.random() * GS) | 0, oy = (Math.random() * GS) | 0;
  const cx = (Math.random() * GS) | 0, cy = (Math.random() * GS) | 0;
  let i = 0;
  for (let y = 0; y < h; y++) {
    const rowL = ((y + oy) & GM) * GS, rowC = ((y + cy) & GM) * GS;
    for (let x = 0; x < w; x++, i += 4) {
      // อ่านตารางสีแบบเฉลี่ย 8 จุดรอบ ๆ (trilinear)
      const fr = d[i] * sc, fg = d[i + 1] * sc, fb = d[i + 2] * sc;
      let r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
      if (r0 > top) r0 = top;
      if (g0 > top) g0 = top;
      if (b0 > top) b0 = top;
      const dr = fr - r0, dg = fg - g0, db = fb - b0;
      const k = r0 * S3 + g0 * S2 + b0 * S1;
      const o = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const p = k + c;
        const c00 = lut[p] + (lut[p + S1] - lut[p]) * db;
        const c01 = lut[p + S2] + (lut[p + S2 + S1] - lut[p + S2]) * db;
        const c10 = lut[p + S3] + (lut[p + S3 + S1] - lut[p + S3]) * db;
        const c11 = lut[p + S3 + S2] + (lut[p + S3 + S2 + S1] - lut[p + S3 + S2]) * db;
        const c0 = c00 + (c01 - c00) * dg, c1 = c10 + (c11 - c10) * dg;
        o[c] = c0 + (c1 - c0) * dr;
      }
      // เกรน: ชัดในเงา บางลงในส่วนสว่าง มีเม็ดสีปนนิด ๆ แบบฟิล์มสี
      const l = (o[0] * 0.3 + o[1] * 0.59 + o[2] * 0.11) / 255;
      const amp = 6.2 - 3.6 * l;
      const nl = gt[rowL + ((x + ox) & GM)] * amp;
      const nc = gt[rowC + ((x + cx) & GM)] * amp * chroma;
      d[i] = o[0] + nl + nc;
      d[i + 1] = o[1] + nl;
      d[i + 2] = o[2] + nl - nc;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function overlays(ctx, w, h, opts) {
  // ขอบมืด
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(25,14,0,0.34)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // แสงรั่ว สุ่มประมาณ 1 ใน 3 รูป
  if (opts.leak ?? Math.random() < 0.34) {
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
  grade(ctx, OUT_W, OUT_H, opts.style === 'color' ? 'ultramax' : opts.style);
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
