import { CONFIG } from './config.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement.style;
for (const [k, v] of Object.entries(CONFIG.theme || {})) root.setProperty(`--${k}`, v);
$('a-names').textContent = CONFIG.coupleNames;

let pass = '';
let photos = [];

function paintStats() {
  $('a-count').textContent = photos.length;
  $('a-guests').textContent = new Set(photos.map((p) => p.guest_name || p.id)).size;
}

async function load() {
  photos = await store.adminList(pass);
  paintStats();
  $('a-grid').replaceChildren(...photos.map((p) => {
    const b = document.createElement('div');
    b.className = 'cell' + (p.hidden ? ' is-hidden' : '');
    b.title = p.guest_name || '';
    const img = new Image(); img.loading = 'lazy'; img.src = p.thumbUrl; img.alt = p.guest_name || '';
    const hide = document.createElement('button');
    hide.className = 'cell-act hide';
    const del = document.createElement('button');
    del.className = 'cell-act del'; del.textContent = 'ลบ'; del.setAttribute('aria-label', 'ลบรูปนี้');
    const paint = () => { hide.textContent = p.hidden ? 'แสดง' : 'ซ่อน'; b.classList.toggle('is-hidden', p.hidden); };
    paint();
    hide.onclick = async () => {
      hide.disabled = true;
      try { await store.adminSetHidden(pass, p.id, !p.hidden); p.hidden = !p.hidden; paint(); }
      catch (e) { alert('ทำรายการไม่สำเร็จ: ' + e.message); }
      hide.disabled = false;
    };
    del.onclick = async () => {
      if (!confirm(`ลบรูปนี้ถาวรใช่ไหม${p.guest_name ? ` (ของ ${p.guest_name})` : ''}\nลบแล้วกู้คืนไม่ได้`)) return;
      del.disabled = true;
      try {
        await store.adminDelete(pass, p.id);
        photos = photos.filter((x) => x.id !== p.id);
        b.remove();
        paintStats();
      } catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); del.disabled = false; }
    };
    b.append(img, hide, del);
    return b;
  }));
}

$('a-form').onsubmit = async (e) => {
  e.preventDefault();
  pass = $('a-pass').value;
  $('a-err').textContent = 'กำลังตรวจสอบ…';
  try {
    await load();
    $('a-login').hidden = true;
    $('a-main').hidden = false;
    drawQR();
  } catch (err) {
    $('a-err').textContent = err.message !== 'BAD_PASS' ? 'เชื่อมต่อไม่ได้: ' + err.message
      : store.isLive ? 'รหัสผ่านไม่ถูกต้อง'
      : 'ลิงก์นี้เป็นเวอร์ชันเก่าที่ยังไม่ได้เชื่อมที่เก็บรูป ให้เปิดจากลิงก์หลักของเว็บ';
  }
};
$('a-refresh').onclick = () => load().catch((e) => alert(e.message));

// ---------- ดาวน์โหลดทั้งหมด ----------
const safe = (s) => (s || 'guest').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
$('a-zip').onclick = async () => {
  const btn = $('a-zip');
  btn.disabled = true;
  const list = [...photos].reverse();   // เก่าสุดก่อน
  const SIZE = 150;
  const parts = Math.ceil(list.length / SIZE);
  let failed = 0;
  try {
    for (let part = 0; part < parts; part++) {
      const zip = new JSZip();
      const chunk = list.slice(part * SIZE, (part + 1) * SIZE);
      for (let i = 0; i < chunk.length; i++) {
        const p = chunk[i];
        const n = part * SIZE + i + 1;
        $('a-progress').textContent = `กำลังรวบรวมรูป ${n} / ${list.length}`;
        try {
          const blob = await (await fetch(p.fullUrl)).blob();
          zip.file(`${String(n).padStart(4, '0')}_${safe(p.guest_name)}.jpg`, blob, { date: new Date(p.created_at) });
        } catch { failed++; }
      }
      const out = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      saveBlob(out, `wedding-photos${parts > 1 ? `-${part + 1}of${parts}` : ''}.zip`);
    }
    $('a-progress').textContent = `เสร็จแล้ว ${list.length - failed} รูป` + (failed ? ` (โหลดไม่ได้ ${failed} รูป ลองกดอีกครั้ง)` : '');
  } finally {
    btn.disabled = false;
  }
};

// ---------- QR ----------
$('a-url').value = location.href.replace(/admin\.html.*$/, '');
function drawQR() {
  const c = $('a-qr'), ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const ink = CONFIG.theme?.ink || '#2b2622';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ink; ctx.textAlign = 'center';
  ctx.fillStyle = CONFIG.theme?.accent || ink;
  ctx.font = '400 170px "Mrs Saint Delafield", "Cormorant Garamond", serif';
  ctx.fillText(CONFIG.coupleNames, W / 2, 170);
  ctx.fillStyle = ink;
  ctx.font = '300 34px "Prompt", sans-serif';
  ctx.fillText('สแกนเพื่อเปิดกล้องฟิล์มของงาน', W / 2, 275);

  const qr = qrcode(0, 'M');
  qr.addData($('a-url').value || location.origin);
  qr.make();
  const n = qr.getModuleCount();
  const size = 640, cellSize = size / n, x0 = (W - size) / 2, y0 = 335;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr.isDark(r, col)) ctx.fillRect(x0 + col * cellSize, y0 + r * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
  }
  ctx.font = '300 30px "Prompt", sans-serif';
  ctx.fillStyle = CONFIG.theme?.soft || '#8a8172';
  ctx.fillText(`คนละ ${CONFIG.maxShots} รูป  ·  ดูรูปของทุกคนได้ในอัลบั้มรวม`, W / 2, 1060);
  ctx.font = '400 34px "Cormorant Garamond", serif';
  ctx.fillStyle = ink;
  ctx.fillText(CONFIG.eventDate || '', W / 2, 1125);
}
$('a-url').oninput = drawQR;
Promise.all(['170px "Mrs Saint Delafield"', '300 34px Prompt', '34px "Cormorant Garamond"'].map((f) => document.fonts.load(f, 'Say สแกน'))).then(drawQR).catch(() => {});
$('a-qrsave').onclick = () => $('a-qr').toBlob((b) => saveBlob(b, 'wedding-camera-qr.png'), 'image/png');
