import { CONFIG } from './config.js';
import * as store from './store.js';
import { grab, develop, toBlob, makeThumb, PREVIEW_FILTER } from './film.js';

const $ = (id) => document.getElementById(id);
const views = ['welcome', 'camera', 'gallery'];
const LS = { id: 'fc_guest_id', name: 'fc_guest_name', used: 'fc_used' };

// ---------- ธีมและข้อความ ----------
const root = document.documentElement.style;
for (const [k, v] of Object.entries(CONFIG.theme || {})) root.setProperty(`--${k}`, v);
document.title = `${CONFIG.coupleNames} · Film Camera`;
$('w-title').textContent = CONFIG.eventTitle;
{
  // ชื่อแบบลายเซ็นสองบรรทัด เหมือนโลโก้บนเว็บของบ่าวสาว
  const parts = CONFIG.coupleNames.split(/\s*&\s*/);
  if (parts.length === 2) {
    const l2 = document.createElement('span'); l2.className = 'l2'; l2.textContent = parts[1];
    $('w-names').append(`${parts[0]} &`, l2);
  } else $('w-names').textContent = CONFIG.coupleNames;
}
$('w-venue').textContent = CONFIG.eventVenue || '';
$('w-date').textContent = CONFIG.eventDate;
$('w-lead').textContent = CONFIG.welcomeText;
$('g-title').textContent = CONFIG.coupleNames;

// ---------- แขก ----------
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const guest = { id: localStorage.getItem(LS.id), name: localStorage.getItem(LS.name) || '' };
if (!guest.id) { guest.id = uuid(); localStorage.setItem(LS.id, guest.id); }
$('w-name').value = guest.name;

let settings = { maxShots: CONFIG.maxShots, revealAt: CONFIG.revealAt ? new Date(CONFIG.revealAt) : null };
let used = Number(localStorage.getItem(LS.used) || 0);
const left = () => Math.max(0, settings.maxShots - used);
const revealed = () => !settings.revealAt || Date.now() >= settings.revealAt.getTime();
const fmtDate = (d) => d.toLocaleString('th-TH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function paintCounter() {
  $('c-left').textContent = String(left()).padStart(2, '0');
  $('w-max').textContent = settings.maxShots;
  $('c-shutter').disabled = left() === 0;
  $('w-reveal').textContent = revealed()
    ? 'รูปของทุกคนรวมอยู่ในอัลบั้มเดียวกัน'
    : `อัลบั้มรวมจะ "ล้างฟิล์ม" เสร็จ ${fmtDate(settings.revealAt)}`;
}

// ---------- สลับหน้า ----------
let current = 'welcome';
function show(name) {
  current = name;
  for (const v of views) $(`v-${v}`).hidden = v !== name;
  if (name === 'camera') startCamera(); else stopCamera();
  if (name === 'gallery') openGallery();
  window.scrollTo(0, 0);
}

// ---------- กล้อง ----------
let stream = null;
let facing = 'environment';
const video = $('c-video');
video.style.filter = PREVIEW_FILTER[CONFIG.filmStyle === 'classic' || CONFIG.filmStyle === 'bw' ? CONFIG.filmStyle : 'ultramax'];

function finderMsg(html) {
  const m = $('c-msg');
  m.hidden = !html;
  if (html) m.innerHTML = html;
}

async function startCamera() {
  paintCounter();
  if (left() === 0) await refreshAllowance();
  if (current !== 'camera') return;
  if (left() === 0) return outOfFilm();
  finderMsg('');
  stopCamera();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    if (current !== 'camera') return stopCamera();
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    await video.play().catch(() => {});
    paintFlash();
  } catch (e) {
    console.warn('camera unavailable', e);
    stream = null;
    paintFlash();
    finderMsg(`<div>เปิดกล้องในหน้านี้ไม่ได้<br>กดปุ่มด้านล่างเพื่อถ่ายด้วยกล้องของเครื่องแทน<br><small>หรือเปิดลิงก์นี้ใน Safari / Chrome แล้วกดอนุญาตให้ใช้กล้อง</small></div><button class="btn" id="c-native">ถ่ายรูป</button>`);
    $('c-native').onclick = () => $('c-file').click();
  }
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  paintFlash();
}

// ---------- แฟลช ----------
// กล้องหลัง: เปิดไฟแฟลชของมือถือ (torch) ค้างไว้แป๊บเดียวตอนกดถ่าย ใช้ได้กับ Android Chrome และ iPhone ที่อัปเดต iOS ใหม่ ๆ
// กล้องหน้า: ไม่มีไฟ ใช้จอขาวสว่างเต็มจอส่องหน้าแทน แบบเดียวกับแฟลชกล้องหน้าของ iPhone
const FLASH_KEY = 'fc_flash';
let flashOn = localStorage.getItem(FLASH_KEY) === '1';
const track = () => stream?.getVideoTracks()[0] || null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function flashMode() {
  const t = track();
  if (!t) return 'none';
  let caps = {}, settings = {};
  try { caps = t.getCapabilities?.() || {}; } catch { /* เบราว์เซอร์เก่า */ }
  try { settings = t.getSettings?.() || {}; } catch { /* เบราว์เซอร์เก่า */ }
  if (caps.torch) return 'torch';
  const face = settings.facingMode || (facing === 'user' ? 'user' : '');
  if (face === 'environment') return navigator.mediaDevices.getSupportedConstraints?.().torch ? 'torch' : 'none';
  return 'screen'; // กล้องหน้า หรือกล้องโน้ตบุ๊ก
}
function paintFlash() {
  const b = $('c-flashbtn');
  b.hidden = !stream;
  b.classList.toggle('on', flashOn);
  b.setAttribute('aria-pressed', String(flashOn));
  b.setAttribute('aria-label', flashOn ? 'แฟลช: เปิด' : 'แฟลช: ปิด');
}
function toast(text) {
  const t = $('c-toast');
  t.hidden = true; void t.offsetWidth;
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2800);
}
function flashHint() {
  const m = flashMode();
  if (m === 'screen') return 'แฟลชกล้องหน้า: จอจะสว่างขาวช่วยส่องหน้าตอนถ่าย';
  if (m === 'none') return 'เครื่องนี้ไม่ให้เว็บเปิดไฟแฟลชกล้องหลัง\nสลับเป็นกล้องหน้าจะใช้จอสว่างช่วยแทน';
  return 'เปิดแฟลชแล้ว';
}
$('c-flashbtn').onclick = () => {
  flashOn = !flashOn;
  localStorage.setItem(FLASH_KEY, flashOn ? '1' : '0');
  paintFlash();
  toast(flashOn ? flashHint() : 'ปิดแฟลช');
};

// ความสว่างเฉลี่ยของภาพในช่องมอง ใช้รอให้กล้องปรับแสงหลังแฟลชติด
const probe = document.createElement('canvas');
probe.width = 24; probe.height = 32;
function frameLevel() {
  try {
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(video, 0, 0, probe.width, probe.height);
    const d = p.getImageData(0, 0, probe.width, probe.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return s / (d.length / 4);
  } catch { return 0; }
}
async function settle(minMs, maxMs) {
  const t0 = performance.now();
  let prev = frameLevel(), steady = 0;
  while (performance.now() - t0 < maxMs) {
    await wait(70);
    const cur = frameLevel();
    if (performance.now() - t0 >= minMs) {
      steady = Math.abs(cur - prev) <= Math.max(1.5, prev * 0.03) ? steady + 1 : 0;
      if (steady >= 2) break;
    }
    prev = cur;
  }
}
async function setTorch(on) {
  const t = track();
  if (!t) return;
  // ใส่ขนาดภาพเดิมไปด้วย ไม่งั้นบางเครื่องลดความละเอียดภาพเมื่อสั่งไฟ
  const { facingMode, deviceId, groupId, advanced, ...keep } = t.getConstraints();
  await t.applyConstraints({ ...keep, advanced: [{ torch: on }] });
}
/** เปิดไฟแฟลช รอกล้องปรับแสง แล้วคืนฟังก์ชันปิดไฟ */
async function fireFlash() {
  const m = flashMode();
  if (m === 'torch') {
    try {
      await setTorch(true);
      await settle(300, 1300);
    } catch (e) { console.warn('torch failed', e); }
    let off = false;
    return () => { if (!off) { off = true; setTorch(false).catch(() => {}); } };
  }
  if (m === 'screen') {
    const s = $('screen-flash');
    s.classList.add('on');
    await settle(220, 900);
    return () => s.classList.remove('on');
  }
  return null;
}
async function refreshAllowance() {
  settings = await store.loadSettings(guest.id);
  if (left() > 0) await store.unreject();
  paintCounter();
}
function outOfFilm() {
  stopCamera();
  finderMsg(`<div style="font-size:19px">ฟิล์มหมดม้วนแล้ว</div><div>ขอบคุณที่ช่วยเก็บความทรงจำให้เรานะ<br><small>อยากถ่ายเพิ่ม ขอฟิล์มจากบ่าวสาวได้ แล้วกดเช็กฟิล์มอีกครั้ง</small></div><button class="btn" id="c-see">ดูอัลบั้ม</button><button class="btn" id="c-recheck" style="border:0;text-decoration:underline">เช็กฟิล์มอีกครั้ง</button>`);
  $('c-see').onclick = () => show('gallery');
  $('c-recheck').onclick = async () => { await refreshAllowance(); if (left() > 0) { startCamera(); sync(); } };
}

let audio;
function click() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = audio.sampleRate * 0.09;
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3) * (i < n * 0.25 || i > n * 0.55 ? 1 : 0.15);
    const s = audio.createBufferSource(); s.buffer = buf;
    const g = audio.createGain(); g.gain.value = 0.5;
    s.connect(g).connect(audio.destination); s.start();
  } catch { /* ไม่มีเสียงก็ไม่เป็นไร */ }
  navigator.vibrate?.(30);
}

let busy = false;
async function capture(src, mirror, withFlash = false) {
  if (busy || left() === 0) return;
  busy = true;
  const shutter = $('c-shutter');
  let lightOff = null;
  try {
    if (withFlash) {
      shutter.classList.add('firing');
      lightOff = await fireFlash();
      if (src === video && (current !== 'camera' || !stream || !video.videoWidth)) return; // ออกจากกล้องระหว่างรอแฟลช ไม่เสียฟิล์ม
    }
    click();
    const frame = grab(src, mirror); // เก็บภาพทันทีตอนไฟยังสว่าง แล้วค่อยปิดไฟ
    lightOff?.();
    const f = $('c-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // ให้จอดับแฟลชก่อนเริ่มล้างรูป
    const canvas = develop(frame, { dateStamp: CONFIG.dateStamp, style: CONFIG.filmStyle });
    const [full, thumb] = await Promise.all([toBlob(canvas), makeThumb(canvas)]);
    const rec = { id: uuid(), guest_id: guest.id, guest_name: guest.name, created_at: new Date().toISOString(), full, thumb, uploaded: false };
    await store.roll.put(rec);
    used += 1; localStorage.setItem(LS.used, used);
    paintCounter();
    const last = $('c-last');
    last.src = URL.createObjectURL(thumb); last.hidden = false;
    last.classList.remove('pop'); void last.offsetWidth; last.classList.add('pop');
    if (left() === 0) setTimeout(outOfFilm, 900);
    sync();
  } catch (e) {
    console.error(e);
    alert('ถ่ายรูปนี้ไม่สำเร็จ ลองอีกครั้งนะ (ไม่เสียฟิล์ม)');
  } finally {
    lightOff?.();
    shutter.classList.remove('firing');
    busy = false;
  }
}

$('c-shutter').onclick = () => {
  if (stream && video.videoWidth) capture(video, facing === 'user', flashOn);
  else $('c-file').click();
};
$('c-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  try { await img.decode(); await capture(img, false); } finally { URL.revokeObjectURL(img.src); }
};
$('c-flip').onclick = async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  await startCamera();
  if (flashOn && stream) toast(flashHint());
};
$('c-back').onclick = () => show('welcome');
$('c-gallery').onclick = () => show('gallery');
$('c-last').onclick = () => { tab = 'mine'; show('gallery'); };

// ---------- ส่งรูปขึ้นอัลบั้มรวม ----------
async function sync() {
  const paint = async (extra) => {
    const n = await store.pendingCount();
    $('c-status').textContent = n ? `กำลังส่ง ${n} รูป${extra || ''}` : (used ? 'ส่งครบแล้ว ✓' : '');
  };
  await paint();
  const r = await store.flush();
  if (r === 'limit') { used = settings.maxShots; localStorage.setItem(LS.used, used); paintCounter(); }
  await paint(r === 'retry' ? '\nรอสัญญาณเน็ต' : '');
}
window.addEventListener('online', sync);
setInterval(() => { if (navigator.onLine) sync(); }, 30000);

// ---------- อัลบั้ม ----------
let tab = 'all';
let items = [];
let poll = null;
const PAGE = 60;

function cell(p) {
  const b = document.createElement('button');
  b.className = 'cell';
  const img = new Image();
  img.loading = 'lazy'; img.alt = p.guest_name ? `รูปโดย ${p.guest_name}` : 'รูปจากงาน';
  img.src = p.thumbUrl;
  b.append(img);
  if (p.uploaded === false) { const w = document.createElement('span'); w.className = 'wait'; w.textContent = p.rejected ? 'เกินจำนวน' : 'รอส่ง'; b.append(w); }
  b.onclick = () => openLightbox(p);
  return b;
}
function renderGrid(emptyText) {
  const g = $('g-grid');
  g.replaceChildren(...items.map(cell));
  $('g-empty').hidden = items.length > 0;
  $('g-empty').textContent = emptyText;
}
async function paintSyncNote() {
  const note = $('g-sync');
  const n = tab === 'mine' ? await store.pendingCount() : 0;
  note.hidden = !n;
  if (!n) return;
  note.replaceChildren(
    `ยังส่งขึ้นอัลบั้มรวมไม่ได้ ${n} รูป รูปยังอยู่ในเครื่อง ไม่หาย`,
    Object.assign(document.createElement('small'), { textContent: store.lastError ? `สาเหตุ: ${store.lastError}` : (navigator.onLine ? '' : 'ไม่มีสัญญาณเน็ต') }),
    Object.assign(document.createElement('button'), { className: 'pill', textContent: 'ลองส่งอีกครั้ง', onclick: async (e) => {
      e.target.disabled = true; e.target.textContent = 'กำลังส่ง…';
      await sync(); loadGallery();
    } }),
  );
}
async function loadGallery(append = false) {
  $('g-sync').hidden = true;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
  $('g-more').hidden = true;
  try {
    if (tab === 'mine') {
      items = await store.myPhotos();
      renderGrid('ยังไม่มีรูปของคุณ\nกดปุ่ม "กล้อง" เพื่อเริ่มถ่าย');
      return paintSyncNote();
    }
    if (!revealed()) {
      items = [];
      return renderGrid(`กำลังล้างฟิล์ม…\nอัลบั้มรวมจะเปิดให้ดูพร้อมกัน\n${fmtDate(settings.revealAt)}\n\nระหว่างนี้ดูรูปของคุณได้ที่แท็บ "ของฉัน"`);
    }
    const page = await store.listPhotos(append ? items.length : 0, PAGE);
    items = append ? items.concat(page.filter((p) => !items.some((i) => i.id === p.id))) : page;
    renderGrid('ยังไม่มีรูปในอัลบั้ม\nมาเป็นคนแรกที่ถ่ายกันเถอะ');
    $('g-more').hidden = page.length < PAGE;
  } catch (e) {
    console.warn(e);
    if (!items.length) renderGrid('โหลดอัลบั้มไม่ได้ ลองเช็กสัญญาณเน็ตแล้วเปิดใหม่อีกครั้ง');
  }
}
function openGallery() {
  loadGallery();
  clearInterval(poll);
  // เช็กรูปใหม่ทุก 20 วินาที เฉพาะตอนยังอยู่หน้าแรกของอัลบั้ม
  poll = setInterval(() => {
    if (current !== 'gallery') return clearInterval(poll);
    if (tab === 'all' && items.length <= PAGE && $('lightbox').hidden && !document.hidden) loadGallery();
  }, 20000);
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => { tab = t.dataset.tab; items = []; loadGallery(); }));
$('g-more').onclick = () => loadGallery(true);
$('g-back').onclick = () => show('welcome');
$('g-cam').onclick = () => enterCamera();

// ---------- ดูรูปใหญ่ ----------
let lbPhoto = null;
function openLightbox(p) {
  lbPhoto = p;
  $('lb-img').src = p.fullUrl;
  $('lb-cap').textContent = p.guest_name || '';
  $('lightbox').hidden = false;
}
$('lb-close').onclick = () => { $('lightbox').hidden = true; $('lb-img').src = ''; };
$('lightbox').onclick = (e) => { if (e.target.id === 'lightbox') $('lb-close').onclick(); };
$('lb-save').onclick = async () => {
  try {
    const blob = await (await fetch(lbPhoto.fullUrl)).blob();
    const file = new File([blob], `wedding-${lbPhoto.id.slice(0, 8)}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    if (e.name !== 'AbortError') alert('บันทึกไม่สำเร็จ ลองกดค้างที่รูปแล้วเลือกบันทึกแทนนะ');
  }
};

// ---------- เริ่ม ----------
function nameOk() {
  const ok = $('w-name').value.trim().length > 0;
  $('w-start').disabled = !ok;
  return ok;
}
function enterCamera() {
  if (!nameOk()) {
    if (current !== 'welcome') show('welcome');
    $('w-name-hint').hidden = false;
    $('w-name').focus();
    return;
  }
  guest.name = $('w-name').value.trim().slice(0, 40);
  localStorage.setItem(LS.name, guest.name);
  show('camera');
}
$('w-name').addEventListener('input', () => { if (nameOk()) $('w-name-hint').hidden = true; });
$('w-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') enterCamera(); });
$('w-start').onclick = enterCamera;
nameOk();
$('w-gallery').onclick = () => show('gallery');

(async () => {
  paintCounter();
  const mine = await store.roll.all().catch(() => []);
  used = Math.max(used, mine.length);
  await refreshAllowance();
  if (current === 'camera' && left() === 0) outOfFilm();
  sync();
})();
