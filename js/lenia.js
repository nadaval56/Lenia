/**
 * lenia.js — ליבת הסימולציה של Lenia (אוטומט תאי רציף)
 * ====================================================
 *
 * מה קורה כאן? (הסבר למורה ולתלמיד הסקרן)
 * -----------------------------------------
 * העולם הוא רשת (grid) של תאים. לכל תא יש "כמות חיים" — מספר בין 0 (מת)
 * ל‑1 (מלא חיים). בכל פריים, כל תא:
 *
 *   1. מסתכל על השכנים שלו דרך "משקפיים" בצורת טבעת (הגרעין, Kernel)
 *      ומחשב כמה "צפוף" סביבו. לתוצאה קוראים הפוטנציאל U.
 *
 *   2. שואל את חוק הצמיחה: "האם הצפיפות U נעימה לי?"
 *      אם U קרוב ל‑μ (מיו) — התא גדל. אם U רחוק מ‑μ — התא מתכווץ.
 *      הפרמטר σ (סיגמא) קובע כמה "סלחני" החוק.
 *
 *   3. מתעדכן לאט (בקצב 1/T) כדי שהתנועה תהיה חלקה.
 *
 * מהשלושה האלה — בלי שום תכנות של "יצורים" — צצים יצורים שזזים,
 * מסתובבים ואפילו שוחים. זה כל הקסם.
 *
 * הקובץ הזה טהור (pure): אין כאן ציור למסך ואין כפתורים — רק מתמטיקה.
 * לכן אפשר להריץ אותו גם ב‑Node.js לבדיקות.
 */

/**
 * צורות הגרעין ("המשקפיים") הזמינות.
 *
 * בלניה המקורית של ברט צ'אן, המגוון העצום של מינים נובע בדיוק מכאן:
 * גרעינים בעלי מספר טבעות שונות יוצרים "פיזיקות" שונות לגמרי, ובכל אחת
 * חיים יצורים אחרים. כל טבעת מוגדרת ע"י מרכז (במרחק מנורמל), עובי,
 * ועוצמה יחסית (amp).
 *
 * שלוש הצורות כאן נבחרו אחרי סקר מספרי (ראו tests/) כך שלכל אחת
 * "כתב יד" מזוהה משלה במרק אקראי:
 *   ring1  → נקודות עגולות שמנמנות (הקלאסי; אורביום חי כאן)
 *   rings2 → פסים אלכסוניים גליים ב‑μ/σ גבוהים
 *   rings3 → אבק עדין של גרגרים זעירים
 */
export const KERNEL_TYPES = {
  ring1: {
    name: '⭕ טבעת אחת — הקלאסי',
    rings: [{ center: 0.5, width: 0.15, amp: 1 }],
  },
  rings2: {
    name: '🌊 שתי טבעות — הגלי',
    rings: [{ center: 0.25, width: 0.08, amp: 1 }, { center: 0.75, width: 0.08, amp: 1 }],
  },
  rings3: {
    name: '✨ שלוש טבעות — האבק',
    rings: [
      { center: 0.17, width: 0.06, amp: 1 },
      { center: 0.5, width: 0.06, amp: 0.7 },
      { center: 0.83, width: 0.06, amp: 0.4 },
    ],
  },
};

/**
 * בניית הגרעין (Kernel) — ה"משקפיים" של כל תא.
 *
 * הגרעין בנוי מטבעות: תא לא מושפע מעצמו (המרכז=0) ולא ממי שרחוק מדי
 * (r>R), אלא ממי שנמצא בטבעות סביבו.
 *
 * לכל היסט (dx,dy) בתוך רדיוס R:
 *     r = sqrt(dx² + dy²) / R                     ← מרחק מנורמל ל‑[0,1]
 *     K(r) = Σᵢ ampᵢ · exp( -((r - centerᵢ)²) / (2 · widthᵢ²) )
 *
 * (בגרעין הקלאסי יש טבעת אחת: center=0.5, width=0.15 — פעמון גאוסיאני
 * סביב חצי הרדיוס.)
 *
 * בסוף מנרמלים כך שסכום כל המשקולות = 1, כדי ש‑U יישאר בסקאלה של A
 * (ממוצע משוקלל של השכנים) ולא יגדל כשמגדילים את R.
 *
 * אופטימיזציה: במקום לחשב את הטבעות מחדש בכל פריים, מחשבים פעם אחת
 * רשימה "דלילה" (sparse) של ההיסטים שמשקלם אינו זניח.
 *
 * @param {number} R רדיוס הגרעין בתאים
 * @param {Array<{center:number,width:number,amp:number}>} rings הטבעות
 * @returns {{dx: Int16Array, dy: Int16Array, w: Float32Array}} רשימת היסטים ומשקולות
 */
export function buildKernel(R, rings = KERNEL_TYPES.ring1.rings) {
  const dxs = [], dys = [], ws = [];
  let sum = 0;

  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const r = Math.sqrt(dx * dx + dy * dy) / R;
      if (r === 0 || r > 1) continue; // לא אני עצמי, ולא רחוק מדי
      let w = 0;
      for (const ring of rings) {
        const d = r - ring.center;
        w += ring.amp * Math.exp(-(d * d) / (2 * ring.width * ring.width));
      }
      if (w < 1e-3) continue; // משקל זניח — לא שווה את זמן החישוב
      dxs.push(dx); dys.push(dy); ws.push(w);
      sum += w;
    }
  }

  // נרמול: Σ K = 1
  const w = new Float32Array(ws.length);
  for (let i = 0; i < ws.length; i++) w[i] = ws[i] / sum;

  return { dx: Int16Array.from(dxs), dy: Int16Array.from(dys), w };
}

/**
 * פונקציית הצמיחה (Growth) — "חוק החיים" של העולם.
 *
 *     G(U) = 2 · exp( -((U - μ)²) / (2σ²) ) - 1        ← טווח (-1, 1]
 *
 * זהו פעמון גאוסיאני שמרכזו ב‑μ:
 *   - כש‑U == μ בדיוק  → G = +1  (צמיחה מקסימלית)
 *   - כש‑U רחוק מ‑μ    → G ≈ -1  (דעיכה)
 *   - הרוחב σ קובע כמה סטייה מ‑μ עדיין נסלחת.
 *
 * זה בדיוק "קצה הכאוס": אם σ קטן מדי — כמעט אף תא לא מרוצה והכול נמוג.
 * אם σ גדול מדי — כולם מרוצים תמיד והכול מתפוצץ לרעש.
 * חיים מתקיימים רק ברצועה הצרה שבאמצע.
 */
export function growth(U, mu, sigma) {
  const d = U - mu;
  return 2 * Math.exp(-(d * d) / (2 * sigma * sigma)) - 1;
}

/**
 * המחלקה המרכזית: עולם Lenia אחד.
 * מחזיקה את הרשת A (ערכי [0,1] ב‑Float32Array) ויודעת לקדם אותה בצעד.
 */
export class Lenia {
  /**
   * @param {number} width  רוחב הרשת בתאים
   * @param {number} height גובה הרשת בתאים
   * @param {{mu:number, sigma:number, R:number, T:number}} params פרמטרים
   */
  constructor(width, height, params = {}) {
    this.W = width;
    this.H = height;
    /** מצב העולם: לכל תא ערך ב‑[0,1] */
    this.A = new Float32Array(width * height);
    /** הפוטנציאל U — נשמר כמאגר קבוע כדי לא להקצות זיכרון בכל פריים */
    this.U = new Float32Array(width * height);

    this.mu = params.mu ?? 0.15;
    this.sigma = params.sigma ?? 0.017;
    this.T = params.T ?? 10;
    this.kernelType = params.kernelType ?? 'ring1';
    this.R = 0;                 // ייקבע ב‑setRadius
    this.setRadius(params.R ?? 13);

    /** סטטיסטיקות שמתעדכנות בכל צעד (למחוון החיים) */
    this.mass = 0;      // המסה הכוללת = ממוצע ערכי כל התאים
    this.coverage = 0;  // איזה חלק מהרשת "פעיל" (מעל סף נמוך)
    this.generation = 0;
  }

  /** החלפת רדיוס — דורשת בנייה מחדש של הגרעין (פעולה חד־פעמית, לא בכל פריים) */
  setRadius(R) {
    if (R === this.R) return;
    this.R = R;
    this._rebuildKernel();
  }

  /** החלפת צורת הגרעין ("המשקפיים") — ראו KERNEL_TYPES */
  setKernelType(type) {
    if (!(type in KERNEL_TYPES) || type === this.kernelType) return;
    this.kernelType = type;
    this._rebuildKernel();
  }

  /** בנייה מחדש של הגרעין ומבני העזר של הקונבולוציה המהירה */
  _rebuildKernel() {
    this.kernel = buildKernel(this.R, KERNEL_TYPES[this.kernelType].rings);

    // מבני עזר לקונבולוציה המהירה (ראו הסבר ב‑step):
    // מאגר "מרופד" — הרשת עם שוליים ברוחב R מכל צד, כך שפיזור תרומות
    // מתא שקרוב לקצה לא צריך בדיקות עטיפה בלולאה הפנימית.
    const R = this.R;
    this.PW = this.W + 2 * R;
    this.PH = this.H + 2 * R;
    this.UP = new Float32Array(this.PW * this.PH);
    // ההיסטים כאינדקסים ליניאריים במאגר המרופד.
    // הגרעין סימטרי (w תלוי רק במרחק), לכן פיזור מ‑A[src] לכיוון +Δ
    // שקול לאיסוף של A[dst+Δ] — התוצאה זהה לקונבולוציה מהנוסחה.
    const { dx, dy } = this.kernel;
    this.pdelta = new Int32Array(dx.length);
    for (let k = 0; k < dx.length; k++) this.pdelta[k] = dy[k] * this.PW + dx[k];
  }

  /** עדכון פרמטרים מהסליידרים */
  setParams({ mu, sigma, R, T, kernelType } = {}) {
    if (mu !== undefined) this.mu = mu;
    if (sigma !== undefined) this.sigma = sigma;
    if (T !== undefined) this.T = T;
    if (kernelType !== undefined) this.setKernelType(kernelType);
    if (R !== undefined) this.setRadius(R);
  }

  /**
   * צעד סימולציה אחד — הלב של הכול. שני שלבים:
   *
   * שלב 1: קונבולוציה. לכל תא מחשבים את הפוטנציאל
   *     U = K ∗ A
   * כלומר: סכום משוקלל של השכנים לפי משקולות הטבעת.
   * הגבולות טורואידליים (wrap-around): מי שיוצא מימין נכנס משמאל,
   * כמו במשחק "נחש" — לעולם אין קיר.
   *
   * שלב 2: צמיחה ועדכון. לכל תא:
   *     A_new = clamp( A + (1/T) · G(U), 0, 1 )
   *
   * טריק ביצועים מרכזי: במקום ש**כל** תא "יאסוף" מכל שכניו (גם כשרובם
   * מתים), כל תא **חי** "מפזר" את התרומה שלו לשכנים. תא שערכו 0 לא תורם
   * כלום — אז מדלגים עליו לגמרי. כשיש יצור בודד על רשת ריקה זה מהיר
   * פי ~50, כי רק ~1% מהתאים חיים. התוצאה זהה מתמטית, כי הגרעין סימטרי.
   *
   * את העטיפה הטורואידלית פותרים עם מאגר "מרופד" (UP): מפזרים בלי
   * בדיקות גבול לתוך שוליים ברוחב R, ובסוף "מקפלים" את השוליים חזרה
   * לצד השני של העולם — מי שיצא מימין נכנס משמאל.
   */
  step() {
    const { A, U, W, H, R, PW, UP, pdelta } = this;
    const kw = this.kernel.w;
    const nk = pdelta.length;
    UP.fill(0);

    // --- שלב 1א: פיזור — כל תא חי תורם לטבעת סביבו ---
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const prow = (y + R) * PW + R; // אותה שורה, בקואורדינטות המרופדות
      for (let x = 0; x < W; x++) {
        const v = A[row + x];
        if (v === 0) continue;       // תא מת לא תורם — הדילוג הגדול
        const base = prow + x;
        for (let k = 0; k < nk; k++) UP[base + pdelta[k]] += kw[k] * v;
      }
    }

    // --- שלב 1ב: קיפול השוליים (העטיפה הטורואידלית) ---
    // קודם אופקית: עמודות שגלשו שמאלה/ימינה חוזרות מהצד השני,
    const PH = this.PH;
    for (let py = 0; py < PH; py++) {
      const prow = py * PW;
      for (let px = 0; px < R; px++) {
        UP[prow + px + W] += UP[prow + px];               // גלש שמאלה → צד ימין
      }
      for (let px = PW - R; px < PW; px++) {
        UP[prow + px - W] += UP[prow + px];               // גלש ימינה → צד שמאל
      }
    }
    // ואז אנכית: שורות שגלשו למעלה/למטה חוזרות מהצד השני.
    for (let py = 0; py < R; py++) {
      const src = py * PW, dst = (py + H) * PW;
      for (let px = R; px < R + W; px++) UP[dst + px] += UP[src + px];
    }
    for (let py = PH - R; py < PH; py++) {
      const src = py * PW, dst = (py - H) * PW;
      for (let px = R; px < R + W; px++) UP[dst + px] += UP[src + px];
    }

    // --- שלב 2: צמיחה + עדכון + איסוף סטטיסטיקות ---
    const invT = 1 / this.T;
    const mu = this.mu;
    const inv2s2 = 1 / (2 * this.sigma * this.sigma); // מחושב פעם אחת מחוץ ללולאה
    let mass = 0, active = 0;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const prow = (y + R) * PW + R;
      for (let x = 0; x < W; x++) {
        const u = UP[prow + x];                          // U = K ∗ A של התא
        U[row + x] = u;                                  // נשמר גם לעיון/בדיקות
        const d = u - mu;
        const g = 2 * Math.exp(-(d * d) * inv2s2) - 1;   // G(U) בטווח (-1,1]
        let a = A[row + x] + invT * g;                   // עדכון הדרגתי בקצב 1/T
        if (a < 0) a = 0; else if (a > 1) a = 1;         // clamp לטווח [0,1]
        A[row + x] = a;
        mass += a;
        if (a > 0.05) active++;
      }
    }
    const n = W * H;
    this.mass = mass / n;
    this.coverage = active / n;
    this.generation++;
  }

  /** ניקוי מלא — עולם ריק */
  clear() {
    this.A.fill(0);
    this.mass = 0;
    this.coverage = 0;
    this.generation = 0;
  }

  /**
   * "מרק אקראי" — ממלא אזור מרכזי ברעש אקראי.
   * זו דרך הגילוי העיקרית: זורעים רעש ורואים אם משהו שורד.
   *
   * @param {number} density  צפיפות: הסתברות שתא יקבל ערך (0..1)
   * @param {number} fraction איזה חלק מהרשת למלא במרכז (ברירת מחדל 60%)
   * @param {() => number} rand מחולל אקראיות (ניתן להחלפה לזרע קבוע בבדיקות)
   */
  soup(density = 0.5, fraction = 0.6, rand = Math.random) {
    const { A, W, H } = this;
    const w = Math.floor(W * fraction), h = Math.floor(H * fraction);
    const x0 = (W - w) >> 1, y0 = (H - h) >> 1;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        A[y * W + x] = rand() < density ? rand() : 0;
      }
    }
  }

  /**
   * מברשת — ציור (או מחיקה) של כתם רך בעולם.
   * הכתם גאוסיאני כדי שהקצוות יהיו נעימים ולא מרובעים.
   *
   * @param {number} cx מרכז X בתאים
   * @param {number} cy מרכז Y בתאים
   * @param {number} radius רדיוס המברשת בתאים
   * @param {number} value 1=ציור חיים, 0=מחיקה
   */
  brush(cx, cy, radius, value = 1) {
    const { A, W, H } = this;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = (dx * dx + dy * dy) / (radius * radius);
        if (d2 > 1) continue;
        const strength = Math.exp(-d2 * 3); // דעיכה רכה לקצוות
        // עטיפה טורואידלית גם בציור
        const x = ((cx + dx) % W + W) % W;
        const y = ((cy + dy) % H + H) % H;
        const i = y * W + x;
        if (value > 0.5) {
          A[i] = Math.max(A[i], strength);          // ציור: מוסיפים חיים
        } else {
          A[i] = Math.min(A[i], 1 - strength);      // מחיקה: מורידים חיים
        }
      }
    }
  }

  /**
   * הנחת "זרע" (דפוס התחלתי של יצור) במרכז העולם.
   * @param {{w:number, h:number, cells:ArrayLike<number>}} seed ערכים ב‑[0,1]
   */
  placeSeed(seed) {
    const { A, W, H } = this;
    const x0 = (W - seed.w) >> 1, y0 = (H - seed.h) >> 1;
    for (let y = 0; y < seed.h; y++) {
      for (let x = 0; x < seed.w; x++) {
        const gx = ((x0 + x) % W + W) % W;
        const gy = ((y0 + y) % H + H) % H;
        A[gy * W + gx] = seed.cells[y * seed.w + x];
      }
    }
  }

  /**
   * חיתוך התיבה החוסמת (bounding box) של כל מה שחי כרגע —
   * משמש לשמירת יצור לקטלוג בלי לשמור את כל העולם הריק שסביבו.
   * @returns {{w:number, h:number, cells:Float32Array} | null} null אם העולם ריק
   */
  cropAlive(threshold = 0.01, margin = 2) {
    const { A, W, H } = this;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (A[y * W + x] > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
    maxX = Math.min(W - 1, maxX + margin); maxY = Math.min(H - 1, maxY + margin);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const cells = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        cells[y * w + x] = A[(minY + y) * W + (minX + x)];
      }
    }
    return { w, h, cells };
  }
}

/**
 * סיווג "מצב העולם" למחוון החיים — הלב הפדגוגי של הכלי.
 *
 * שלושה מצבים, לפי המסה (mass) והכיסוי (coverage):
 *   - 'void'  (ריק/דעיכה): המסה שאפה לאפס — החוק קפדני מדי, הכול נמוג.
 *   - 'chaos' (כאוס): הדפוס התפשט ומילא את העולם — החוק סלחני מדי.
 *   - 'life'  (חיים!): יש מסה, אבל היא מקומית ויציבה — יצור חי.
 *
 * הספים כוילו בניסויים מספריים (הרצות "מרק" על פני טווח הפרמטרים):
 * יצור בודד כמו Orbium נותן מסה ~0.005 וכיסוי ~1%,
 * מושבת נקודות יציבות נותנת מסה ~0.15–0.26,
 * ואילו "מבוך" כאוטי רווי מטפס למסה 0.3–0.5 וכיסוי 35%+.
 */
export function classifyState(mass, coverage) {
  if (mass < 0.0012) return 'void';
  if (mass > 0.28 || coverage > 0.4) return 'chaos';
  return 'life';
}

/**
 * מחולל אקראיות עם זרע (mulberry32) — כדי שבדיקות ומפת הפאזה
 * יהיו דטרמיניסטיות (אותו זרע ⇒ אותו "מרק").
 */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
