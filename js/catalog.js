/**
 * catalog.js — הקטלוג האישי: "ספר המינים" של התלמיד
 * ====================================================
 *
 * כשהתלמיד מגלה יצור יציב, הוא שומר אותו כאן. הרשומות נשמרות
 * ב‑localStorage בלבד (100% מקומי, בלי שרת), וניתנות לייצוא/ייבוא
 * כקובץ JSON כדי שילדים ישתפו תגליות ביניהם.
 *
 * מבנה רשומה:
 * {
 *   id: "מזהה ייחודי",
 *   name: "שם שהילד נתן",
 *   params: { mu, sigma, R, T },
 *   seed: { w, h, b64 },           // מטריצת הזריעה, דחוסה: Uint8 → base64
 *   thumbnail: "data:image/jpeg...", // צילום מהקנבס
 *   discoveredBy: "שם התלמיד",
 *   date: "ISO date"
 * }
 */

const STORAGE_KEY = 'lenia.catalog.v1';

/* ---------- דחיסת seed: Float32 [0,1] → Uint8 → base64 ---------- */

/** קידוד: כל תא נדחס לבייט אחד (256 רמות מספיקות לזריעה) */
export function encodeSeed(seed) {
  const bytes = new Uint8Array(seed.w * seed.h);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.round(Math.min(1, Math.max(0, seed.cells[i])) * 255);
  }
  // המרה ל‑base64 בנתחים (btoa מוגבל באורך הארגומנטים)
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { w: seed.w, h: seed.h, b64: btoa(bin) };
}

/** פענוח: base64 → Uint8 → Float32 [0,1] */
export function decodeSeed(enc) {
  const bin = atob(enc.b64);
  const cells = new Float32Array(enc.w * enc.h);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = bin.charCodeAt(i) / 255;
  }
  return { w: enc.w, h: enc.h, cells };
}

/* ---------- פעולות הקטלוג ---------- */

/** טעינת כל הרשומות (מערך ריק אם אין או אם הנתונים פגומים) */
export function loadCatalog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/**
 * שמירת יצור חדש. זורק חריגה אם localStorage מלא —
 * הקורא אחראי להציג הודעה ידידותית.
 */
export function saveCreature({ name, params, seed, thumbnail, discoveredBy }) {
  const list = loadCatalog();
  const entry = {
    id: `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    name,
    params,
    seed: encodeSeed(seed),
    thumbnail,
    discoveredBy,
    date: new Date().toISOString(),
  };
  list.unshift(entry); // החדש ביותר ראשון
  persist(list);
  return entry;
}

export function deleteCreature(id) {
  persist(loadCatalog().filter((e) => e.id !== id));
}

export function getCatalogEntry(id) {
  return loadCatalog().find((e) => e.id === id) ?? null;
}

/* ---------- ייצוא / ייבוא JSON ---------- */

/** ייצוא הקטלוג כולו כקובץ JSON להורדה */
export function exportCatalog() {
  const data = JSON.stringify({ format: 'lenia-catalog', version: 1, creatures: loadCatalog() }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lenia-catalog-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * ייבוא קטלוג מקובץ JSON. רשומות מתווספות לקיימות (בלי כפילויות לפי id).
 * @returns {number} כמה רשומות חדשות נוספו
 * @throws אם הקובץ אינו קטלוג תקין
 */
export function importCatalog(jsonText) {
  const data = JSON.parse(jsonText);
  const incoming = data?.creatures;
  if (data?.format !== 'lenia-catalog' || !Array.isArray(incoming)) {
    throw new Error('not a lenia catalog');
  }
  const list = loadCatalog();
  const existing = new Set(list.map((e) => e.id));
  let added = 0;
  for (const e of incoming) {
    // בדיקת שדות מינימלית כדי לא לייבא זבל
    if (!e || typeof e.id !== 'string' || !e.params || !e.seed?.b64) continue;
    if (existing.has(e.id)) continue;
    list.push(e);
    existing.add(e.id);
    added++;
  }
  persist(list);
  return added;
}
