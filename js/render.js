/**
 * render.js — ציור העולם לקנבס + פלטות צבע
 * ==========================================
 *
 * הרעיון: ערך התא A ∈ [0,1] ממופה לצבע דרך "טבלת חיפוש" (LUT) של 256
 * צבעים שמחושבת מראש לכל פלטה. בכל פריים כותבים את הפיקסלים ל‑ImageData
 * קטן (בגודל הרשת) ואז מותחים אותו לקנבס הגדול עם החלקה (smoothing) —
 * ככה מקבלים מראה אורגני רך בלי לשלם על רינדור ברזולוציה גבוהה.
 */

/** אינטרפולציה לינארית בין שני צבעי [r,g,b] */
function lerpColor(c0, c1, t) {
  return [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
  ];
}

/** בניית LUT של 256 צבעים ממדרגות צבע (color stops) */
function buildLUT(stops) {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // מציאת שתי המדרגות שהערך נופל ביניהן
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].t) k++;
    const s0 = stops[k], s1 = stops[k + 1];
    const local = (t - s0.t) / (s1.t - s0.t || 1);
    const [r, g, b] = lerpColor(s0.c, s1.c, Math.min(1, Math.max(0, local)));
    lut[i * 3] = r; lut[i * 3 + 1] = g; lut[i * 3 + 2] = b;
  }
  return lut;
}

/** הפלטות הזמינות — שם בעברית + מדרגות צבע */
export const PALETTES = {
  bio: {
    name: 'ביולוגי 🌿',
    stops: [
      { t: 0.0, c: [8, 12, 24] },     // רקע כחול-לילה עמוק
      { t: 0.25, c: [10, 60, 60] },
      { t: 0.55, c: [30, 160, 90] },  // ירוק חי
      { t: 0.8, c: [150, 230, 100] },
      { t: 1.0, c: [250, 255, 220] }, // שיא צהבהב-לבן
    ],
  },
  thermal: {
    name: 'תרמי 🔥',
    stops: [
      { t: 0.0, c: [10, 10, 35] },
      { t: 0.3, c: [40, 40, 130] },
      { t: 0.6, c: [200, 80, 30] },
      { t: 0.85, c: [255, 180, 40] },
      { t: 1.0, c: [255, 255, 210] },
    ],
  },
  ocean: {
    name: 'אוקיינוס 🌊',
    stops: [
      { t: 0.0, c: [4, 10, 20] },
      { t: 0.4, c: [10, 70, 130] },
      { t: 0.7, c: [40, 170, 200] },
      { t: 1.0, c: [220, 250, 255] },
    ],
  },
  mono: {
    name: 'מונוכרום ⬜',
    stops: [
      { t: 0.0, c: [10, 10, 12] },
      { t: 1.0, c: [245, 245, 250] },
    ],
  },
};

/** צבעי הערוצים בעולמות רב־ערוציים (RGB) */
export const CHANNEL_COLORS = [
  [70, 230, 140],   // ערוץ 0: ירוק — "הנטרף"
  [255, 95, 70],    // ערוץ 1: אדום-כתום — "הטורף"
  [90, 150, 255],   // ערוץ 2: כחול
];

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas הקנבס המוצג למשתמש
   * @param {number} gridW רוחב הרשת בתאים
   * @param {number} gridH גובה הרשת בתאים
   */
  constructor(canvas, gridW, gridH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setGridSize(gridW, gridH);
    this.setPalette('bio');
  }

  /** התאמה לגודל רשת חדש (למשל כשמחליפים רזולוציה) */
  setGridSize(gridW, gridH) {
    this.gridW = gridW;
    this.gridH = gridH;
    // קנבס עזר קטן בגודל הרשת — עליו כותבים פיקסל-לתא
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = gridW;
    this.offscreen.height = gridH;
    this.offCtx = this.offscreen.getContext('2d');
    this.imageData = this.offCtx.createImageData(gridW, gridH);
    // אלפא אטום פעם אחת — בכל פריים מעדכנים רק RGB
    const px = this.imageData.data;
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
  }

  setPalette(key) {
    this.paletteKey = key in PALETTES ? key : 'bio';
    this.lut = buildLUT(PALETTES[this.paletteKey].stops);
  }

  /**
   * ציור עולם רב־ערוצי: כל ערוץ בצבע משלו, ערבוב חיבורי (additive).
   * ערוץ 0 = ירוק (הנטרף), ערוץ 1 = אדום־כתום (הטורף), ערוץ 2 = כחול.
   * @param {Float32Array[]} channels מערך רשתות, אחת לכל ערוץ
   */
  drawMulti(channels) {
    const px = this.imageData.data;
    const n = channels[0].length;
    for (let i = 0; i < n; i++) {
      let r = 8, g = 12, b = 24; // רקע כחול-לילה כמו בפלטה הביולוגית
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][i];
        if (v === 0) continue;
        const col = CHANNEL_COLORS[c % CHANNEL_COLORS.length];
        r += col[0] * v; g += col[1] * v; b += col[2] * v;
      }
      const j = i * 4;
      px[j] = r > 255 ? 255 : r;
      px[j + 1] = g > 255 ? 255 : g;
      px[j + 2] = b > 255 ? 255 : b;
    }
    this.offCtx.putImageData(this.imageData, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * ציור פריים: רשת A → פיקסלים → מתיחה לקנבס עם החלקה.
   * @param {Float32Array} A מצב הרשת, ערכים ב‑[0,1]
   */
  draw(A) {
    const px = this.imageData.data;
    const lut = this.lut;
    for (let i = 0; i < A.length; i++) {
      // המרה לאינדקס 0..255 בטבלת הצבעים
      const v = (A[i] * 255) | 0;
      const j = i * 4, k = v * 3;
      px[j] = lut[k]; px[j + 1] = lut[k + 1]; px[j + 2] = lut[k + 2];
    }
    this.offCtx.putImageData(this.imageData, 0, 0);

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;   // ההחלקה נותנת את המראה האורגני
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** צילום תמונה ממוזערת (לקטלוג) */
  thumbnail(size = 96) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(this.offscreen, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.75);
  }
}
