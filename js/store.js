// ที่เก็บรูป: ถ้าใส่ค่า Supabase ใน config.js จะใช้ของจริง ไม่งั้นเป็นโหมดทดลอง (เก็บในเครื่อง)
import { CONFIG } from './config.js';

const BUCKET = 'photos';
export const isLive = !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const sb = isLive ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: false } }) : null;

// ---------- IndexedDB เล็ก ๆ : ม้วนฟิล์มของเครื่องนี้ ----------
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('film-camera', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('roll', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('roll', mode);
    const out = fn(t.objectStore('roll'));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const roll = {
  put: (rec) => tx('readwrite', (s) => s.put(rec)),
  del: (id) => tx('readwrite', (s) => s.delete(id)),
  all: async () => ((await tx('readonly', (s) => s.getAll())) || []).sort((a, b) => b.created_at.localeCompare(a.created_at)),
};

// ---------- ตั้งค่า (ค่าบน Supabase ชนะค่าใน config.js) ----------
export async function loadSettings() {
  const s = { maxShots: CONFIG.maxShots, revealAt: CONFIG.revealAt ? new Date(CONFIG.revealAt) : null };
  if (isLive) {
    try {
      const { data } = await sb.from('app_settings').select('max_shots,reveal_at').eq('id', 1).single();
      if (data) {
        s.maxShots = data.max_shots;
        s.revealAt = data.reveal_at ? new Date(data.reveal_at) : null;
      }
    } catch { /* ออฟไลน์ ใช้ค่าในไฟล์ */ }
  }
  return s;
}

const pub = (kind, id) => `${CONFIG.supabaseUrl}/storage/v1/object/public/${BUCKET}/${kind}/${id}.jpg`;
const liveRow = (r) => ({ id: r.id, guest_name: r.guest_name, created_at: r.created_at, hidden: !!r.hidden, thumbUrl: pub('thumb', r.id), fullUrl: pub('full', r.id) });
const urlCache = new Map();
function localRow(r) {
  if (!urlCache.has(r.id)) urlCache.set(r.id, { t: URL.createObjectURL(r.thumb), f: URL.createObjectURL(r.full) });
  const u = urlCache.get(r.id);
  return { id: r.id, guest_name: r.guest_name, created_at: r.created_at, hidden: !!r.hidden, uploaded: r.uploaded, thumbUrl: u.t, fullUrl: u.f };
}

export async function myPhotos() {
  return (await roll.all()).map(localRow);
}

/** ส่งรูปที่ยังค้างในเครื่องขึ้นแกลเลอรีรวม คืน 'limit' ถ้าเซิร์ฟเวอร์บอกว่าฟิล์มหมด */
let flushing = null;
export function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  const pending = (await roll.all()).filter((r) => !r.uploaded && !r.rejected).reverse();
  let result = 'ok';
  for (const r of pending) {
    if (!isLive) { r.uploaded = true; await roll.put(r); continue; }
    try {
      for (const kind of ['full', 'thumb']) {
        const { error } = await sb.storage.from(BUCKET).upload(`${kind}/${r.id}.jpg`, r[kind], { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error && !/exists|duplicate/i.test(error.message || '')) throw error;
      }
      const { error } = await sb.from('photos').insert({ id: r.id, guest_id: r.guest_id, guest_name: r.guest_name });
      if (error) {
        if (/FILM_LIMIT/.test(error.message || '')) { r.rejected = true; await roll.put(r); result = 'limit'; continue; }
        if (error.code !== '23505') throw error;   // 23505 = เคยส่งแล้ว
      }
      r.uploaded = true;
      await roll.put(r);
    } catch (e) {
      console.warn('upload failed, will retry', e);
      return 'retry';
    }
  }
  return result;
}

export async function pendingCount() {
  return (await roll.all()).filter((r) => !r.uploaded && !r.rejected).length;
}

/** แกลเลอรีรวม เรียงใหม่สุดก่อน */
export async function listPhotos(offset = 0, limit = 60) {
  if (!isLive) return (await myPhotos()).filter((p) => !p.hidden).slice(offset, offset + limit);
  const { data, error } = await sb.from('photos').select('id,guest_name,created_at')
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return data.map(liveRow);
}

// ---------- สำหรับบ่าวสาว ----------
export async function adminList(pass) {
  if (!isLive) {
    if (pass !== CONFIG.demoAdminPass) throw new Error('BAD_PASS');
    return myPhotos();
  }
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.rpc('admin_list_photos', { p_pass: pass }).range(from, from + 999);
    if (error) throw new Error(/BAD_PASS/.test(error.message) ? 'BAD_PASS' : error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all.map(liveRow);
}

export async function adminSetHidden(pass, id, hidden) {
  if (!isLive) {
    const rec = (await roll.all()).find((r) => r.id === id);
    if (rec) { rec.hidden = hidden; await roll.put(rec); }
    return;
  }
  const { error } = await sb.rpc('admin_set_hidden', { p_pass: pass, p_id: id, p_hidden: hidden });
  if (error) throw new Error(error.message);
}

/** ลบรูปถาวร: ลบรายการในฐานข้อมูลก่อน (ต้องใช้รหัส) แล้วลบไฟล์ */
export async function adminDelete(pass, id) {
  if (!isLive) { await roll.del(id); return; }
  const { error } = await sb.rpc('admin_delete_photo', { p_pass: pass, p_id: id });
  if (error) throw new Error(/BAD_PASS/.test(error.message) ? 'BAD_PASS' : error.message);
  const { error: e2 } = await sb.storage.from(BUCKET).remove([`full/${id}.jpg`, `thumb/${id}.jpg`]);
  if (e2) console.warn('file cleanup failed', e2);   // รูปหายจากอัลบั้มแล้ว ไฟล์ค้างไม่กระทบ
}
