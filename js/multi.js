/**
 * multi.js — לניה רב־ערוצית: עולם עם כמה "חומרים" צבעוניים
 * ============================================================
 *
 * ההרחבה הגדולה של Lenia (על פי עבודתו של ברט צ'אן): במקום ערך יחיד
 * לכל תא, יש C ערוצים — כאילו בעולם חיים כמה "חומרים כימיים" שונים
 * (אצלנו: אדום, ירוק, כחול). כל ערוץ מציית לחוק צמיחה משלו, אבל —
 * וזה הקסם — ערוצים יכולים להשפיע זה על זה: "הירוק גדל איפה שהאדום
 * צפוף", "הכחול נחלש ליד הירוק", וכן הלאה.
 *
 * כל השפעה כזו נקראת "חיבור" (connection):
 *     { src, dst, mu, sigma, h, unit }
 *   - src   : על איזה ערוץ מסתכלים (דרך גרעין הטבעת הרגיל)
 *   - dst   : על איזה ערוץ משפיעים
 *   - mu, sigma : חוק הצמיחה של החיבור הזה (כמו בעולם הרגיל)
 *   - h     : עוצמת ההשפעה. חיובי = מעודד, שלילי = מדכא
 *   - unit  : אם true, הצמיחה נמדדת בסולם [0,1] במקום (-1,1] —
 *             שימושי לדיכוי חד־כיווני ("רק מזיק, אף פעם לא עוזר")
 *
 * העדכון של כל ערוץ הוא סכום כל החיבורים שמצביעים אליו:
 *     A_dst += (1/T) · Σ h_k · G_k(K ∗ A_src)      ואז clamp ל‑[0,1]
 *
 * מתוך רשת חיבורים פשוטה כזו נולדות התנהגויות "אקולוגיות": רדיפות,
 * הימנעויות, וטריטוריות — בלי שאף אחד תכנת אותן.
 */

import { buildKernel, KERNEL_TYPES, seededRandom } from './lenia.js?v=5';

export class LeniaMulti {
  /**
   * @param {number} width רוחב הרשת
   * @param {number} height גובה הרשת
   * @param {{C:number, R:number, T:number, connections:Array}} config תצורת העולם
   */
  constructor(width, height, config) {
    this.W = width;
    this.H = height;
    this.C = config.C;
    this.T = config.T ?? 10;
    this.R = config.R ?? 10;
    this.connections = config.connections;
    this.config = config;

    /** מצב העולם: מערך רשתות, אחת לכל ערוץ */
    this.A = [];
    /** מאגרי הפרש (כמה כל ערוץ ישתנה בצעד הנוכחי) */
    this.D = [];
    for (let c = 0; c < this.C; c++) {
      this.A.push(new Float32Array(width * height));
      this.D.push(new Float32Array(width * height));
    }

    // הגרעין משותף לכל החיבורים (טבעת קלאסית) — ההבדלים בין חיבורים
    // הם ב"חוק" (mu, sigma, h), לא בצורת הראייה.
    const R = this.R;
    this.PW = width + 2 * R;
    this.PH = height + 2 * R;
    this.UP = new Float32Array(this.PW * this.PH);
    this.kernel = buildKernel(R, KERNEL_TYPES.ring1.rings);
    this.pdelta = new Int32Array(this.kernel.dx.length);
    for (let k = 0; k < this.kernel.dx.length; k++) {
      // היסטים הפוכי־סימן, כמו במנוע החד־ערוצי (ראו lenia.js)
      this.pdelta[k] = -(this.kernel.dy[k] * this.PW + this.kernel.dx[k]);
    }

    this.mass = 0;              // מסה ממוצעת על פני כל הערוצים
    this.massPerChannel = new Array(this.C).fill(0);
    this.coverage = 0;          // חלק התאים שבהם ערוץ כלשהו פעיל
    this.generation = 0;
  }

  /** קונבולוציה של ערוץ יחיד אל המאגר המרופד (פיזור מתאים חיים) */
  _convolve(src) {
    const { W, H, R, PW, UP, pdelta } = this;
    const A = this.A[src];
    const kw = this.kernel.w;
    const nk = pdelta.length;
    UP.fill(0);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const prow = (y + R) * PW + R;
      for (let x = 0; x < W; x++) {
        const v = A[row + x];
        if (v === 0) continue;
        const base = prow + x;
        for (let k = 0; k < nk; k++) UP[base + pdelta[k]] += kw[k] * v;
      }
    }
    // קיפול השוליים הטורואידליים (זהה למנוע החד־ערוצי)
    const PH = this.PH;
    for (let py = 0; py < PH; py++) {
      const prow = py * PW;
      for (let px = 0; px < R; px++) UP[prow + px + W] += UP[prow + px];
      for (let px = PW - R; px < PW; px++) UP[prow + px - W] += UP[prow + px];
    }
    for (let py = 0; py < R; py++) {
      const s = py * PW, d = (py + H) * PW;
      for (let px = R; px < R + W; px++) UP[d + px] += UP[s + px];
    }
    for (let py = PH - R; py < PH; py++) {
      const s = py * PW, d = (py - H) * PW;
      for (let px = R; px < R + W; px++) UP[d + px] += UP[s + px];
    }
  }

  /** צעד סימולציה אחד: כל החיבורים, ואז עדכון כל הערוצים יחד */
  step() {
    const { W, H, R, PW, UP, C } = this;
    for (let c = 0; c < C; c++) this.D[c].fill(0);

    // כל חיבור: קונבולוציה על ערוץ המקור, צמיחה, צבירה לערוץ היעד
    for (const conn of this.connections) {
      this._convolve(conn.src);
      const D = this.D[conn.dst];
      const inv2s2 = 1 / (2 * conn.sigma * conn.sigma);
      const { mu, h, unit } = conn;
      for (let y = 0; y < H; y++) {
        const row = y * W;
        const prow = (y + R) * PW + R;
        for (let x = 0; x < W; x++) {
          const d = UP[prow + x] - mu;
          const g = Math.exp(-(d * d) * inv2s2);     // פעמון [0,1]
          // בסולם רגיל: 2g-1 בטווח (-1,1]. בסולם unit: g בטווח [0,1]
          D[row + x] += h * (unit ? g : 2 * g - 1);
        }
      }
    }

    // עדכון כל הערוצים + סטטיסטיקות
    const invT = 1 / this.T;
    const n = W * H;
    let total = 0, active = 0;
    for (let c = 0; c < C; c++) {
      const A = this.A[c], D = this.D[c];
      let mass = 0;
      for (let i = 0; i < n; i++) {
        let a = A[i] + invT * D[i];
        if (a < 0) a = 0; else if (a > 1) a = 1;
        A[i] = a;
        mass += a;
      }
      this.massPerChannel[c] = mass / n;
      total += mass;
    }
    // כיסוי: תא נחשב פעיל אם ערוץ כלשהו מעל הסף
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < C; c++) {
        if (this.A[c][i] > 0.05) { active++; break; }
      }
    }
    this.mass = total / (n * C);
    this.coverage = active / n;
    this.generation++;
  }

  /** בעולם צבעוני רק T ניתן לשינוי חי — שאר החוקים הם רשת החיבורים */
  setParams({ T } = {}) {
    if (T !== undefined) this.T = T;
  }

  clear() {
    for (const A of this.A) A.fill(0);
    this.mass = 0;
    this.coverage = 0;
    this.massPerChannel.fill(0);
    this.generation = 0;
  }

  /**
   * מרק אקראי רב־ערוצי: כל ערוץ מקבל כתמים משלו, כך שהעולם מתחיל
   * כפסיפס צבעוני שממנו האקולוגיה מתארגנת.
   */
  soup(density = 0.5, fraction = 0.6, rand = Math.random) {
    const { W, H, C } = this;
    const w = Math.floor(W * fraction), h = Math.floor(H * fraction);
    const x0 = (W - w) >> 1, y0 = (H - h) >> 1;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        // כל תא "שייך" לערוץ אקראי אחד — נקודת פתיחה מופרדת יפה
        const c = Math.floor(rand() * C);
        if (rand() < density) this.A[c][y * W + x] = rand();
      }
    }
  }

  /** מברשת לערוץ מסוים (ציור בצבע שנבחר, או מחיקת כל הערוצים) */
  brush(cx, cy, radius, value = 1, channel = 0) {
    const { W, H, C } = this;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = (dx * dx + dy * dy) / (radius * radius);
        if (d2 > 1) continue;
        const strength = Math.exp(-d2 * 3);
        const x = ((cx + dx) % W + W) % W;
        const y = ((cy + dy) % H + H) % H;
        const i = y * W + x;
        if (value > 0.5) {
          this.A[channel][i] = Math.max(this.A[channel][i], strength);
        } else {
          // מחיקה מוחקת את כל הערוצים — "מחק" אמיתי
          for (let c = 0; c < C; c++) this.A[c][i] = Math.min(this.A[c][i], 1 - strength);
        }
      }
    }
  }

  /** הנחת זרע רב־ערוצי {w, h, channels:[cells,...]} במרכז */
  placeSeed(seed) {
    const { W, H, C } = this;
    const x0 = (W - seed.w) >> 1, y0 = (H - seed.h) >> 1;
    for (let c = 0; c < Math.min(C, seed.channels.length); c++) {
      for (let y = 0; y < seed.h; y++) {
        for (let x = 0; x < seed.w; x++) {
          const gx = ((x0 + x) % W + W) % W;
          const gy = ((y0 + y) % H + H) % H;
          this.A[c][gy * W + gx] = seed.channels[c][y * seed.w + x];
        }
      }
    }
  }

  /** חיתוך התיבה החוסמת של כל מה שחי, בכל הערוצים יחד */
  cropAlive(threshold = 0.01, margin = 2) {
    const { W, H, C } = this;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        for (let c = 0; c < C; c++) {
          if (this.A[c][y * W + x] > threshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            break;
          }
        }
      }
    }
    if (maxX < 0) return null;
    minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
    maxX = Math.min(W - 1, maxX + margin); maxY = Math.min(H - 1, maxY + margin);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const channels = [];
    for (let c = 0; c < C; c++) {
      const cells = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          cells[y * w + x] = this.A[c][(minY + y) * W + (minX + x)];
        }
      }
      channels.push(cells);
    }
    return { w, h, channels };
  }
}

export { seededRandom };
