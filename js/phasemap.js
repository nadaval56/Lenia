/**
 * phasemap.js — מפת הפאזה μ–σ: "מפת אזור החיים"
 * ================================================
 *
 * לוח קטן שבו הציר האופקי הוא μ והאנכי σ, ונקודה מסמנת איפה אנחנו.
 * הרקע צבוע לפי מה שקורה למרק אקראי בכל צירוף (μ,σ):
 * כחול = נמוג, ירוק = חיים, אדום = כאוס/רוויה.
 *
 * הערת אמת חשובה: אין כאן דיאגרמה "אמיתית" מוכנה מראש שהומצאה ביד —
 * הרצועה נמדדת בדגימה חיה: לכל תא במפה מריצים מיקרו־סימולציה קטנה
 * (רשת 48×48) עם מרק אקראי קבוע, ובודקים מה שרד אחרי 150 צעדים.
 * הדגימה רצה ברקע בנתחים קטנים כדי לא לתקוע את האנימציה הראשית,
 * והתוצאה נשמרת ב‑localStorage כדי לא לחשב מחדש בכל טעינה.
 *
 * לכל צורת גרעין ("משקפיים") יש מפה משלה — כי החלפת הגרעין משנה את
 * הפיזיקה, וגם את מיקום רצועת החיים.
 *
 * זהו קירוב: המפה נדגמת בקנה מידה קבוע (R=8 לגרעין הקלאסי, R=10
 * למרובי־הטבעות שדורשים רזולוציה עדינה יותר), בעוד שהסימולציה הראשית
 * רצה ב‑R שהמשתמש בחר. Lenia כמעט חסרת־סקאלה, אז הרצועה דומה — אבל
 * לא זהה. לכן המפה מסומנת בממשק כ"קירוב", ומחוון המסה (לא המפה) הוא
 * האות האמין ל"האם אני בחיים".
 *
 * המפות מגיעות עם ערכים "אפויים מראש" (BAKED) שחושבו על ידי אותו קוד
 * בדיוק ב‑Node.js (tests/bake-phasemap.mjs) — כדי שהמפה תופיע מיד.
 * תא שערכו חסר (null) נדגם חי ברקע.
 */

import { Lenia, classifyState, seededRandom, KERNEL_TYPES } from './lenia.js?v=5';

/** תצורת הדגימה — שינוי כאן מאלץ דגימה מחדש (דרך מפתח המטמון) */
const CONFIG = {
  cols: 15, rows: 11,          // רזולוציית המפה
  muMin: 0.10, muMax: 0.35,    // תואם לטווחי הסליידרים
  sigMin: 0.005, sigMax: 0.10,
  gridSize: 48, T: 10,         // המיקרו־סימולציה
  steps: 150,
  soupDensity: 0.5, soupFraction: 0.6, soupSeed: 7,
};

/** רדיוס המיקרו־סימולציה לכל גרעין: טבעות דקות צריכות R גדול מעט יותר */
const SAMPLE_R = { ring1: 8, rings2: 10, rings3: 10, wind: 10 };

/**
 * תוצאות אפויות מראש (v=void, l=life, c=chaos), אינדקס = cy*cols+cx
 * (σ עולה עם cy). חושבו על ידי tests/bake-phasemap.mjs שמריץ בדיוק את
 * הקוד שלמטה. תאים אלה נחשבים "ידועים"; הדגימה החיה משלימה רק חוסרים.
 */
const BAKED = {
  ring1: 'lvvvvvvvvvvvvvvlllllvvvvvvvvvvllllllccvvvvvvvlllllllcccvvvvvllllllcccccvvvvllllllccccccvvvllllcccccccccvvlllccccccccccvvlllcccccccccccvllccccccccccccclcccccccccccccc',
  rings2: 'lvvvvvvvvvvvvvvlllllvvvvvvvvvvlllllllvlvvvvvvlllllllcclvvvvvllllllccccvvvvvlllllccccccvvvvlllllcccccccvvvllllccccccccvvvlllccccccccccvvlllccccccccccvvllccccccccccccv',
  rings3: 'lllvvvvvvvvvvvvlllllllvvvvvvvvllllllllllvvvvvlllllllcclvvvvvllllllcccclvvvvlllllccccccvvvvlllllcccccccvvvllllccccccccvvvllllcccccccccvvlllccccccccccvvllccccccccccccv',
  wind: 'vvvvvvvvvvvvvvvllvvvvvvvvvvvvvllllvvvvvvvvvvvllllllvvvvvvvvvllllllcclvvvvvvlllllcccccvvvvvllllccccccclvvvlllccccccccccvvllcccccccccccvvllccccccccccccvlcccccccccccccv',
};

const STATE_BY_CHAR = { v: 'void', l: 'life', c: 'chaos' };
const COLORS = {
  void: 'rgba(59, 108, 217, 0.55)',
  life: 'rgba(52, 199, 118, 0.75)',
  chaos: 'rgba(232, 80, 66, 0.65)',
  unknown: 'rgba(120, 120, 140, 0.15)',
};

export class PhaseMap {
  /** @param {HTMLCanvasElement} canvas הקנבס של המפה */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = CONFIG;
    const n = CONFIG.cols * CONFIG.rows;

    // מפה נפרדת לכל צורת גרעין. אתחול: מטמון מקומי → אפוי → לא ידוע
    this.maps = {};
    for (const type of Object.keys(KERNEL_TYPES)) {
      const cells = new Array(n).fill(null);
      const baked = BAKED[type] ?? '';
      if (baked.length === n) {
        for (let i = 0; i < n; i++) cells[i] = STATE_BY_CHAR[baked[i]] ?? null;
      }
      try {
        const cached = JSON.parse(localStorage.getItem(this.cacheKey(type)) ?? 'null');
        if (Array.isArray(cached) && cached.length === n) {
          for (let i = 0; i < n; i++) cells[i] = STATE_BY_CHAR[cached[i]] ?? cells[i];
        }
      } catch { /* מטמון פגום — מתעלמים */ }
      this.maps[type] = cells;
    }

    this.type = 'ring1';
    // מצב הדוגם המצטבר (רץ בנתחים קטנים בכל פריים)
    this.sampleIndex = 0;
    this.currentSim = null;
    this.stepsDone = 0;
  }

  cacheKey(type) {
    return `lenia.phasemap.${type}.g${CONFIG.gridSize}r${SAMPLE_R[type]}s${CONFIG.steps}.v1`;
  }

  /** החלפת צורת הגרעין — עוברים למפה של הגרעין החדש */
  setKernelType(type) {
    if (!(type in this.maps) || type === this.type) return;
    this.type = type;
    this.sampleIndex = 0;   // הדוגם יתחיל לסרוק את המפה החדשה
    this.currentSim = null;
  }

  /** ערכי (μ,σ) של תא במפה */
  cellParams(index) {
    const { cols, rows, muMin, muMax, sigMin, sigMax } = this.cfg;
    const cx = index % cols, cy = Math.floor(index / cols);
    return {
      mu: muMin + ((cx + 0.5) / cols) * (muMax - muMin),
      sigma: sigMin + ((cy + 0.5) / rows) * (sigMax - sigMin),
    };
  }

  /**
   * קידום הדגימה החיה בתקציב זמן קצוב (מילישניות).
   * נקרא מהלולאה הראשית בכל פריים. דוגם רק תאים חסרים (null) במפה
   * הנוכחית; כשאין כאלה — לא עושה כלום.
   */
  tick(budgetMs = 3) {
    const cells = this.maps[this.type];
    const total = cells.length;
    const deadline = performance.now() + budgetMs;
    const { gridSize, T, steps, soupDensity, soupFraction, soupSeed } = this.cfg;

    while (performance.now() < deadline) {
      // מציאת התא החסר הבא
      while (this.sampleIndex < total && cells[this.sampleIndex] !== null) this.sampleIndex++;
      if (this.sampleIndex >= total) {
        this.persist();
        return; // המפה הנוכחית שלמה
      }
      if (!this.currentSim) {
        const { mu, sigma } = this.cellParams(this.sampleIndex);
        this.currentSim = new Lenia(gridSize, gridSize, {
          mu, sigma, R: SAMPLE_R[this.type], T, kernelType: this.type,
        });
        this.currentSim.soup(soupDensity, soupFraction, seededRandom(soupSeed));
        this.stepsDone = 0;
      }
      // מקדמים כמה צעדים שנכנסים בתקציב
      while (this.stepsDone < steps && performance.now() < deadline) {
        this.currentSim.step();
        this.stepsDone++;
      }
      if (this.stepsDone >= steps) {
        cells[this.sampleIndex] = classifyState(this.currentSim.mass, this.currentSim.coverage);
        this.currentSim = null;
        this.sampleIndex++;
      }
    }
  }

  /** שמירת המפה הנוכחית במטמון המקומי */
  persist() {
    try {
      const chars = this.maps[this.type].map((s) => (s ?? 'v')[0]);
      localStorage.setItem(this.cacheKey(this.type), JSON.stringify(chars));
    } catch { /* אין מקום — לא נורא */ }
  }

  /** המרת נקודת לחיצה על המפה לערכי (μ,σ) — מאפשר "לטייל" במפה באצבע */
  paramsAt(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (px - rect.left) / rect.width));
    const fy = Math.min(1, Math.max(0, (py - rect.top) / rect.height));
    const { muMin, muMax, sigMin, sigMax } = this.cfg;
    return {
      mu: muMin + fx * (muMax - muMin),
      sigma: sigMax - fy * (sigMax - sigMin), // ציר y הפוך: σ גבוה למעלה
    };
  }

  /** ציור המפה + נקודת המיקום הנוכחי */
  draw(currentMu, currentSigma) {
    const { ctx, canvas } = this;
    const { cols, rows, muMin, muMax, sigMin, sigMax } = this.cfg;
    const cells = this.maps[this.type];
    const W = canvas.width, H = canvas.height;
    const cw = W / cols, ch = H / rows;

    ctx.fillStyle = '#0c1020';
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < cells.length; i++) {
      const cx = i % cols, cy = Math.floor(i / cols);
      ctx.fillStyle = COLORS[cells[i] ?? 'unknown'];
      // σ גבוה מצויר למעלה, לכן הופכים את ציר y
      ctx.fillRect(cx * cw + 0.5, (rows - 1 - cy) * ch + 0.5, cw - 1, ch - 1);
    }

    // הנקודה: איפה אנחנו עכשיו
    const fx = (currentMu - muMin) / (muMax - muMin);
    const fy = 1 - (currentSigma - sigMin) / (sigMax - sigMin);
    const x = Math.min(W - 4, Math.max(4, fx * W));
    const y = Math.min(H - 4, Math.max(4, fy * H));
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }
}
