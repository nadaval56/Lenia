/**
 * creatures.js — ספריית היצורים הטעונים מראש
 * =============================================
 *
 * יצור = פרמטרים (μ, σ, R, T) + דפוס זריעה התחלתי (seed).
 * הדפוס הוא מטריצה קטנה של ערכים ב‑[0,1] שמונחת במרכז העולם.
 *
 * הערת אמת: יצורים בעלי שם כמו Orbium לא צצים באופן אמין מרעש אקראי —
 * הם דורשים את דפוס הזריעה המדויק שלהם. הדפוס של Orbium כאן הוא
 * הדפוס הקנוני מעבודתו של Bert Chan (ממציא Lenia), והוא אומת מספרית
 * מול המימוש הזה: הוא שוחה במסה יציבה לאורך 400+ צעדים
 * (ראו tests/verify.mjs).
 *
 * שימו לב: לכל יצור יש גם kernelType — צורת ה"משקפיים" שהוא חי בה.
 * יצור שנבנה לגרעין אחד מתפרק בגרעין אחר.
 */

import { decodeSeed } from './catalog.js?v=6';

/**
 * Orbium unicaudatus — "המדוזה השוחה", היצור המפורסם ביותר של Lenia.
 * דפוס 20×20 קנוני. שוחה באלכסון בקו ישר, עם "זנב" מהבהב.
 */
const ORBIUM_CELLS = [
  [0,0,0,0,0,0,0.1,0.14,0.1,0,0,0.03,0.03,0,0,0.3,0,0,0,0],
  [0,0,0,0,0,0.08,0.24,0.3,0.3,0.18,0.14,0.15,0.16,0.15,0.09,0.2,0,0,0,0],
  [0,0,0,0,0,0.15,0.34,0.44,0.46,0.38,0.18,0.14,0.11,0.13,0.19,0.18,0.45,0,0,0],
  [0,0,0,0,0.06,0.13,0.39,0.5,0.5,0.37,0.06,0,0,0,0.02,0.16,0.68,0,0,0],
  [0,0,0,0.11,0.17,0.17,0.33,0.4,0.38,0.28,0.14,0,0,0,0,0,0.18,0.42,0,0],
  [0,0,0.09,0.18,0.13,0.06,0.08,0.26,0.32,0.32,0.27,0,0,0,0,0,0,0.82,0,0],
  [0.27,0,0.16,0.12,0,0,0,0.25,0.38,0.44,0.45,0.34,0,0,0,0,0,0.22,0.17,0],
  [0,0.07,0.2,0.02,0,0,0,0.31,0.48,0.57,0.6,0.57,0,0,0,0,0,0,0.49,0],
  [0,0.59,0.19,0,0,0,0,0.2,0.57,0.69,0.76,0.76,0.49,0,0,0,0,0,0.36,0],
  [0,0.58,0.19,0,0,0,0,0,0.67,0.83,0.9,0.92,0.87,0.12,0,0,0,0,0.22,0.07],
  [0,0,0.46,0,0,0,0,0,0.7,0.93,1,1,1,0.61,0,0,0,0,0.18,0.11],
  [0,0,0.82,0,0,0,0,0,0.47,1,1,0.98,1,0.96,0.27,0,0,0,0.19,0.1],
  [0,0,0.46,0,0,0,0,0,0.25,1,1,0.84,0.92,0.97,0.54,0.14,0.04,0.1,0.21,0.05],
  [0,0,0,0.4,0,0,0,0,0.09,0.8,1,0.82,0.8,0.85,0.63,0.31,0.18,0.19,0.2,0.01],
  [0,0,0,0.36,0.1,0,0,0,0.05,0.54,0.86,0.79,0.74,0.72,0.6,0.39,0.28,0.24,0.13,0],
  [0,0,0,0.01,0.3,0.07,0,0,0.08,0.36,0.64,0.7,0.64,0.6,0.51,0.39,0.29,0.19,0.04,0],
  [0,0,0,0,0.1,0.24,0.14,0.1,0.15,0.29,0.45,0.53,0.52,0.46,0.4,0.31,0.21,0.08,0,0],
  [0,0,0,0,0,0.08,0.21,0.21,0.22,0.29,0.36,0.39,0.37,0.33,0.26,0.18,0.09,0,0,0],
  [0,0,0,0,0,0,0.03,0.13,0.19,0.22,0.24,0.24,0.23,0.18,0.13,0.05,0,0,0,0],
  [0,0,0,0,0,0,0,0,0.02,0.06,0.08,0.09,0.07,0.05,0.01,0,0,0,0,0],
];

/** המרת מערך שורות ל‑seed בפורמט האחיד {w, h, cells} */
function seedFromRows(rows) {
  const h = rows.length, w = rows[0].length;
  const cells = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) cells[y * w + x] = rows[y][x];
  }
  return { w, h, cells };
}

/**
 * סיבוב seed ב‑180° — חוקי לניה איזוטרופיים (לא מבדילים כיוונים),
 * לכן יצור מסובב שוחה באותה צורה, רק לכיוון ההפוך.
 */
function rotate180(seed) {
  const { w, h, cells } = seed;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[(h - 1 - y) * w + (w - 1 - x)] = cells[y * w + x];
  }
  return { w, h, cells: out };
}

/**
 * הרכבת כמה seeds ללוח אחד גדול — לניסויים כמו התנגשות בין יצורים.
 * @param {number} w רוחב הלוח המורכב
 * @param {number} h גובה הלוח המורכב
 * @param {Array<{seed:object, x:number, y:number}>} placements מיקומי הפינות
 */
function compose(w, h, placements) {
  const cells = new Float32Array(w * h);
  for (const { seed, x: x0, y: y0 } of placements) {
    for (let y = 0; y < seed.h; y++) {
      for (let x = 0; x < seed.w; x++) {
        cells[(y0 + y) * w + (x0 + x)] = seed.cells[y * seed.w + x];
      }
    }
  }
  return { w, h, cells };
}

/**
 * יצירת "כתם רך" עגול — דיסק עם קצוות דוהים (כמו המברשת).
 * משמש כזרע של "הפרח הפורח": ב‑σ גמיש, כתם כזה פורח למושבה שלמה.
 */
function diskSeed(radius) {
  const s = 2 * radius + 1;
  const cells = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d2 = ((x - radius) ** 2 + (y - radius) ** 2) / (radius * radius);
      if (d2 <= 1) cells[y * s + x] = Math.exp(-d2 * 3);
    }
  }
  return { w: s, h: s, cells };
}

/**
 * "מקטע מושבה" — חתיכה של 36×36 ממושבת נקודות מיוצבת (נדגמה ממרק
 * שהתייצב במשך 600 דורות; ראו tests/round4). משמש בניסוי ההיבלעות.
 * מקודד בבסיס64 כמו בקטלוג (בייט אחד לתא).
 */
const COLONY_PATCH = decodeSeed({
  w: 36, h: 36,
  b64: 'AAAAAAD/AAD1/wAAAAAAAAAAAAD/AAAA//8AAAAAAAAAAAD/AAAAAAD/////8AAAAAAAAAAAAP//AAD//wAAAAAAAAAAAP//AAAAAAD/////AAAAAAAAAAAA////////AAAAAAAAAAAAAP//AAAAAAAA//8AAAAAAAAAAAD//wAA//8AAAAAAAAAAAAAAP//AAAAAAAAAAAAAAAAAAAAAP//AAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAA/wAAAAAAAAAAAAAAJAAAAAAAAAAAAAAAAAAAAAAAAP8AAAD/4AAAAAAAAAAAAAD/AAAAAAAAAAAAAAAAAAAAAAAAAP//AP//AAAAAAAAAAAA////AAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAAAAAAAAD/////AAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAP//AP//AAAAAAAA//+rAP//AAAAAAAAAAAAAAAAAAAAAAAAAP8AAAD/AAAAAAAA/8kAAAD//wAAAAAAAAAAAAAAAAAAAAAAxP8AAP//AAAAAAAA//8AAAAA/wAAAAAAAAAAAAAAAAAAAAAA//8A+v8AAAAAAAAAAP//AAAA//8AAAAAAAAAAAAAAAAAAAAA/1IA//8AAAAAAAAAAAAA///////rAAAAAAAAAAAAAAAAAAD//wAA/wAAAAAAAAAAAAAAAAAA//////////8AAAAAAAAAAAD/AAAA/wAAAAAAAAAAAAAAAAAAAAD///8AAPr//wAAAAAAAP//AAAA/wAAAAAAAAAAAAAAAAAAAAD//wAAAADE//8AAAAAAP//AAAA/wAAAAAAAAAAAAAAAAAAAAAA//8AAAAA//8AAAAAAP///////wAAAAAAAAAAAAAAAAAAAAAAAP//AAD//wAAAAAAAAAA////AAAAAAAA/wAAAAAAAAAAAAAAAAD/////AAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+wAAAA/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8AAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAAA9/8AAAAAAAAAAAAAAAAAAAAAAAAA//////8AAAAAAAD//wAA//8AAAAAAAAA//////8AAAD/////8gAA+v9KAAAAAAAA/////wAAAAAAAAD//zgArf//////////AAAAAP//AAAAAAAAAP//KwAAAAAAAAD/AAAAAAD/////////AAAAXv8AAAAAAAAAAAAAAAAAAAAAAAD/PQAAAP///wAAAFn//////60AAAAAAAAAAAAAAAAAAAAAAAD//7gA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////QgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////RwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

const ORBIUM_SEED = seedFromRows(ORBIUM_CELLS);

/**
 * רשימת היצורים והניסויים המובנים.
 * כל רשומה: name, description (טיפ לילד), params (כולל kernelType),
 * ואחד מ: seed (דפוס קבוע) / soup (מרק אקראי טרי) / כלום (עולם ריק).
 */
export const CREATURES = [
  {
    id: 'orbium',
    name: 'אורביום — המדוזה השוחה',
    description: 'היצור המפורסם של לניה. שוחה באלכסון בקו ישר. נסו להזיז מעט את σ ותראו מה קורה לו!',
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1' },
    seed: ORBIUM_SEED,
  },
  {
    id: 'collision',
    name: 'ההתנגשות 💥',
    description: 'שני אורביומים שוחים זה מול זה. חכו בסבלנות למפגש... לפעמים שניהם מתאדים, ולפעמים נולד משהו חדש — תלוי בגודל העולם!',
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1' },
    // אחד רגיל ואחד מסובב 180° — כך הם שוחים בדיוק אחד לקראת השני.
    // המרווח ביניהם (48 תאים באלכסון) אומת מספרית: הם מתנגשים ומתאיידים.
    seed: compose(68, 68, [
      { seed: ORBIUM_SEED, x: 0, y: 0 },
      { seed: rotate180(ORBIUM_SEED), x: 48, y: 48 },
    ]),
  },
  {
    id: 'school',
    name: 'הלהקה 🐠',
    description: 'שלושה אורביומים שוחים יחד במבנה, כמו להקת דגים. הם לעולם לא יתנגשו — כולם שוחים באותה מהירות בדיוק, לאותו כיוון.',
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1' },
    // שלושה עותקים באותו כיוון — מהירות זהה ⇒ המרחק ביניהם נשמר לנצח.
    // המרווח (34 תאים באלכסון) אומת: מסה קבועה של פי 3 לאורך 900+ דורות.
    seed: compose(88, 88, [
      { seed: ORBIUM_SEED, x: 0, y: 0 },
      { seed: ORBIUM_SEED, x: 34, y: 34 },
      { seed: ORBIUM_SEED, x: 68, y: 68 },
    ]),
  },
  {
    id: 'absorption',
    name: 'ההיבלעות 🌀',
    description: 'אורביום שוחה לעבר מושבה מתפשטת. מי ינצח — השחיין הבודד או ההמון? שימו לב לרגע שבו הוא הופך לחלק מהם...',
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1' },
    // אורביום בפינה, מקטע מושבה בהמשך מסלול השחייה שלו. אומת: המושבה
    // מתפשטת, האורביום שוחה לתוכה ונבלע (התנועה צונחת מ~80 ל~3).
    seed: compose(84, 84, [
      { seed: ORBIUM_SEED, x: 0, y: 0 },
      { seed: COLONY_PATCH, x: 48, y: 48 },
    ]),
  },
  {
    id: 'flower',
    name: 'הפרח הפורח 🌸',
    description: 'מכתם עגול אחד קטן... פורח עולם שלם! כש‑σ גמיש יותר, גם התחלה צנועה מצליחה לצמוח.',
    params: { mu: 0.15, sigma: 0.03, R: 13, T: 10, kernelType: 'ring1' },
    seed: diskSeed(8),
  },
  {
    id: 'boiling',
    name: 'המושבה הרותחת 🫧',
    description: 'מרק שלא נרדם! כשהזמן T קטן, העולם נשאר רותח ומשתנה לנצח. כל לחיצה — עולם חדש.',
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 3, kernelType: 'ring1' },
    // בלי seed קבוע: הניסוי הזה נזרע ממרק אקראי טרי בכל הפעלה.
    soup: { density: 0.5 },
  },
  {
    id: 'greenhouse',
    name: 'חממת הציורים 🎨',
    description: 'עולם ריק עם חוק סלחני במיוחד — כל מה שתציירו באצבע (בקו עבה!) יקום לתחייה ויפרח. נסו לצייר לב.',
    params: { mu: 0.15, sigma: 0.035, R: 13, T: 10, kernelType: 'ring1' },
    // בלי seed ובלי מרק — העולם נשאר ריק ומחכה לציור של הילד.
    // המברשת מוגדלת אוטומטית ל‑9: קווים דקים מדי מתים גם כאן (נבדק).
    brush: 9,
    toastMsg: 'העולם מחכה לכם — ציירו באצבע, וכשתרימו אותה הציור יתעורר לחיים! 🎨',
  },
  {
    id: 'waves',
    name: 'שדה הגלים 🌊',
    description: 'משקפיים חדשים = עולם חדש! עם גרעין של שתי טבעות, המרק קופא לדוגמת פסים מסתלסלת כמו טביעת אצבע — במקום נקודות. המחוון יגיד "כאוס" כי העולם רווי, אבל תראו כמה סדר יש בו!',
    params: { mu: 0.28, sigma: 0.06, R: 13, T: 10, kernelType: 'rings2' },
    soup: { density: 0.5 },
  },
  {
    id: 'river',
    name: 'הנהר הזורם 🧭',
    description: 'משקפיים עם "רוח": כל תא רואה חזק יותר לכיוון אחד — וכל העולם נסחף לאט באלכסון, כמו נהר של יצורים. צפו בסבלנות (או בטורבו 🐇) ותראו שהכול באמת זז!',
    params: { mu: 0.15, sigma: 0.03, R: 13, T: 10, kernelType: 'wind' },
    // אומת: הדפוס כולו נסחף ~2-3 תאים לכל 100 צעדים לכיוון הרוח,
    // ונשאר חי ונע גם אחרי 1,500 דורות.
    soup: { density: 0.5 },
  },
  {
    id: 'aquarium',
    name: 'האקווריום 🐠',
    description: 'אותו אורביום — אבל הפעם לעולם יש קירות אמיתיים במקום להיות עגול. עקבו אחריו עד הפינה... ליד זכוכית קשה לראות שכנים, וקשה לחיות. (אפשר להציל אותו? נסו לצייר לידו אוכל!)',
    // אומת: האורביום שוחה לפינה, נצמד אליה ~500 דורות תוך שחיקה
    // איטית (מסה 75→56), ולבסוף מתאדה. הקירות גובים מחיר.
    params: { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1', boundary: 'walls' },
    seed: ORBIUM_SEED,
  },
  {
    id: 'fireflies',
    name: 'הגחליליות ✨',
    description: 'עולם עם שתי משקפיים בו־זמנית: עידוד מקרוב ודיכוי מרחוק. התוצאה — שדה של ניצוצות שנדלקים ונכבים בלי סוף, ואף פעם לא נרגע. אומת שהוא מרצד גם אחרי 1,500 דורות!',
    // ריבוי-גרעינים בערוץ אחד: המנגנון של דפוסי טיורינג. תנועה
    // מתמשכת ~60 שנמדדה לאורך 1,500+ דורות.
    multi: {
      C: 1, T: 10,
      connections: [
        { src: 0, dst: 0, mu: 0.15, sigma: 0.03, h: 1, R: 5 },
        { src: 0, dst: 0, mu: 0.25, sigma: 0.12, h: -0.8, R: 14, unit: true },
      ],
    },
    soup: { density: 0.5, fraction: 0.7 },
  },
  {
    id: 'breathing',
    name: 'העולם הנושם 🫁',
    description: 'הקשיבו לגרף המסה: העולם כולו מתכווץ ומתרחב במחזוריות, כמו ריאות. שילוב של צמיחה מהירה מקרוב ובלימה מרחוק יוצר פעימה שלא נגמרת.',
    // אומת: תנודות מסה של ±6-10% במחזור של ~9 צעדים, יציב 3,000+
    // דורות על פני זרעים וגדלים שונים.
    multi: {
      C: 1, T: 3,
      connections: [
        { src: 0, dst: 0, mu: 0.15, sigma: 0.025, h: 1.2, R: 6 },
        { src: 0, dst: 0, mu: 0.18, sigma: 0.04, h: -1, R: 16, unit: true },
      ],
    },
    soup: { density: 0.5, fraction: 0.7 },
  },
  {
    id: 'hunt',
    name: 'המרדף הגדול 🦊 (עולם צבעוני!)',
    description: 'שני חומרים: ירוק שחי בכוחות עצמו, ואדום שיכול לגדול רק איפה שיש ירוק — אבל הורג אותו. התוצאה: מרדף אינסופי של גלים. שימו לב איך האוכלוסיות עולות ויורדות במחזורים, כמו בטבע!',
    // עולם רב־ערוצי: הפרמטרים כאן הם רשת ה"חיבורים" בין החומרים.
    // אומת: שני המינים שורדים 3,000+ דורות עם תנועה מתמשכת (~160)
    // ומחזורי אוכלוסייה אמיתיים, על פני זרעים וגדלי רשת שונים.
    multi: {
      C: 2, R: 10, T: 10,
      connections: [
        // הנטרף (ירוק): חיים עצמאיים לפי חוק לניה רגיל
        { src: 0, dst: 0, mu: 0.15, sigma: 0.025, h: 1, unit: false },
        // הטורף (אדום): גדל איפה שיש ירוק בצפיפות הנכונה — ודועך בלעדיו
        { src: 0, dst: 1, mu: 0.10, sigma: 0.03, h: 1, unit: false },
        // הטורף מדכא את הנטרף איפה שהוא נמצא (השפעה חד־כיוונית)
        { src: 1, dst: 0, mu: 0.10, sigma: 0.1, h: -0.8, unit: true },
      ],
    },
    soup: { density: 0.6, fraction: 0.7 },
  },
];

/** איתור יצור מובנה לפי מזהה */
export function getCreature(id) {
  return CREATURES.find((c) => c.id === id) ?? null;
}
