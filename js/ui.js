/**
 * ui.js — הממשק: סליידרים, כפתורים, מחוון החיים, והלולאה הראשית
 * ================================================================
 * זהו "המנצח על התזמורת": מחבר בין ליבת הסימולציה (lenia.js),
 * הרינדור (render.js), הקטלוג (catalog.js) ומפת הפאזה (phasemap.js).
 */

import { Lenia, classifyState, KERNEL_TYPES } from './lenia.js?v=9';
import { LeniaMulti } from './multi.js?v=9';
import { Renderer, PALETTES, CHANNEL_COLORS } from './render.js?v=9';
import { PhaseMap } from './phasemap.js?v=9';
import { CREATURES } from './creatures.js?v=9';
import * as catalog from './catalog.js?v=9';

/* ================= הגדרות כלליות ================= */

const DEFAULTS = { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1', boundary: 'torus' };
const HISTORY_LEN = 240;          // כמה פריימים אחורה זוכר גרף המסה
const STUDENT_KEY = 'lenia.student';

const $ = (id) => document.getElementById(id);

/* ================= מצב האפליקציה ================= */

let gridSize = 128;
let sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
let isMulti = false;               // האם אנחנו בעולם רב־ערוצי (צבעוני)
let currentMode = 'simple';        // הטאב הפעיל: 'simple' (עולם פשוט) / 'color' (צבעוני)
let brushChannel = 0;              // באיזה "חומר" (ערוץ) המברשת מציירת
let renderer;                      // נוצר ב‑init אחרי שה‑DOM מוכן
let phaseMap;
let running = true;
let speed = 1;                     // צעדי סימולציה לפריים (0.5 = צעד כל פריים שני)
let frameCount = 0;
let brushErase = false;
let brushSize = 4;
let soupDensity = 0.5;

/** היסטוריית מסה למחוון + גרף */
const massHistory = [];

/** מצב מוצג עם היסטרזיס — כדי שהתווית לא תרצד בין מצבים */
let shownState = 'void';
let pendingState = 'void';
let pendingFrames = 0;

/* ================= מחוון החיים ================= */

const STATE_INFO = {
  void:  { label: 'דעך 🕳️',  color: '#3b6cd9', bg: 'rgba(59,108,217,.15)', hint: 'הכול נמוג... נסו להגדיל את σ או לזרוע מרק חדש' },
  life:  { label: 'חיים! 🌱', color: '#34c776', bg: 'rgba(52,199,118,.15)', hint: 'יש יצורים חיים! שווה לשמור לקטלוג 📸' },
  chaos: { label: 'כאוס 🔥', color: '#e85042', bg: 'rgba(232,80,66,.15)', hint: 'הכול מתפוצץ לרעש. נסו להקטין את σ' },
};

/**
 * קביעת המצב הרגעי. בנוסף לסיווג הבסיסי (לפי מסה וכיסוי),
 * מזהים "דעיכה" מוקדם: מסה נמוכה שיורדת בעקביות — כדי שהילד
 * יקבל משוב כחול עוד לפני שהעולם ריק לגמרי.
 */
function computeState() {
  if (isMulti) {
    // בעולם צבעוני גלי המרדף מכסים שטח גדול באופן טבעי — לכן מסווגים
    // רק לפי מסה (כיסוי גבוה אינו "כאוס" כשמדובר באקולוגיה נודדת)
    if (sim.mass < 0.0012) return 'void';
    if (sim.mass > 0.30) return 'chaos';
    return 'life';
  }
  let s = classifyState(sim.mass, sim.coverage);
  if (s === 'life' && sim.mass < 0.03 && massHistory.length > 90) {
    const then = massHistory[massHistory.length - 90];
    if (then > 0 && sim.mass / then < 0.7) s = 'void';
  }
  return s;
}

/** עדכון האינדיקטור עם היסטרזיס של ~חצי שנייה */
function updateIndicator() {
  const s = computeState();
  if (s === pendingState) {
    pendingFrames++;
  } else {
    pendingState = s;
    pendingFrames = 0;
  }
  if (pendingFrames >= 15 && shownState !== pendingState) {
    shownState = pendingState;
  }
  const info = STATE_INFO[shownState];
  const el = $('lifeState');
  el.textContent = info.label;
  el.style.color = info.color;
  el.style.background = info.bg;
  el.style.borderColor = info.color;
  $('lifeHint').textContent = info.hint;
  $('massValue').textContent = `מסה: ${(sim.mass * 100).toFixed(2)}%`;
}

/** ציור גרף ה‑sparkline של המסה */
function drawSparkline() {
  const canvas = $('sparkline');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (massHistory.length < 2) return;

  // סקאלה אנכית מסתגלת: מינימום קטן כדי שגם יצור בודד (מסה ~0.5%) ייראה
  const maxMass = Math.max(0.015, ...massHistory) * 1.1;
  const color = STATE_INFO[shownState].color;

  ctx.beginPath();
  for (let i = 0; i < massHistory.length; i++) {
    const x = (i / (HISTORY_LEN - 1)) * W;
    const y = H - (massHistory[i] / maxMass) * (H - 3) - 1;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  // מילוי עדין מתחת לקו
  ctx.lineTo(((massHistory.length - 1) / (HISTORY_LEN - 1)) * W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = color + '33';
  ctx.fill();
}

/* ================= הלולאה הראשית ================= */

function frame() {
  frameCount++;
  if (running) {
    // מהירות: 0.5 = צעד כל פריים שני; 2/4 = כמה צעדים בפריים
    const steps = speed < 1 ? (frameCount % 2 === 0 ? 1 : 0) : speed;
    for (let i = 0; i < steps; i++) {
      sim.step();
      massHistory.push(sim.mass);
      if (massHistory.length > HISTORY_LEN) massHistory.shift();
    }
  }
  if (isMulti) renderer.drawMulti(sim.A);
  else renderer.draw(sim.A);
  // מסגרת "זכוכית" כשהעולם הוא אקווריום עם קירות
  if (!isMulti && sim.boundary === 'walls') {
    const ctx = renderer.ctx;
    ctx.strokeStyle = 'rgba(140, 200, 255, 0.8)';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, renderer.canvas.width - 6, renderer.canvas.height - 6);
  }
  updateIndicator();
  drawSparkline();
  // דגימת מפת הפאזה ברקע — רק בעולם חד־ערוצי (למפה אין משמעות בעולם צבעוני)
  if (!isMulti) {
    phaseMap.tick(running ? 3 : 8);
    phaseMap.draw(sim.mu, sim.sigma);
  }
  requestAnimationFrame(frame);
}

/* ================= חיווט הסליידרים ================= */

/** חיבור סליידר לפרמטר, עם תצוגת ערך חי */
function bindSlider(id, valueId, apply, format = (v) => v) {
  const slider = $(id);
  const label = $(valueId);
  const onInput = () => {
    const v = parseFloat(slider.value);
    label.textContent = format(v);
    apply(v);
  };
  slider.addEventListener('input', onInput);
  onInput();
}

function syncSlidersFromParams() {
  $('tSlider').value = sim.T;
  $('tValue').textContent = sim.T;
  if (isMulti) return; // בעולם צבעוני אין μ/σ/גרעין יחידים לסנכרן
  $('muSlider').value = sim.mu;
  $('sigmaSlider').value = sim.sigma;
  $('rSlider').value = sim.R;
  $('muValue').textContent = sim.mu.toFixed(3);
  $('sigmaValue').textContent = sim.sigma.toFixed(3);
  $('rValue').textContent = sim.R;
  $('kernelSelect').value = sim.kernelType;
  $('boundarySelect').value = sim.boundary;
  phaseMap.setKernelType(sim.kernelType);
}

/* ================= פופ־אפ עזרה (❓) ================= */

/**
 * מאגר ההסברים לכל סליידר/פקד. כל ערך: כותרת + גוף HTML.
 * נפתח בפופ־אפ בלחיצה על כפתור ה‑❓ הקטן שליד כל פקד.
 */
const HELP = {
  mu: {
    title: 'μ — צפיפות מועדפת',
    body: `<p>לכל תא יש "צפיפות חלומית" — כמו הדייסה של זהבה: לא ריק מדי, לא צפוף
      מדי, בדיוק באמצע. <strong>μ הוא המספר הזה.</strong> כל תא בודק כמה חיים יש
      בטבעת סביבו: אם התוצאה קרובה ל‑μ — הוא גדל, אחרת הוא נחלש.</p>
      <p>μ גבוה ⇐ היצורים אוהבים צפיפות ⇐ עולם דחוס. μ נמוך ⇐ עולם מאוורר ועדין.</p>
      <p class="help-try">💡 נסו: טענו את האורביום והזיזו את μ טיפ־טיפה. כמה רחוק
      תגיעו לפני שהוא מתפרק?</p>`,
  },
  sigma: {
    title: 'σ — גמישות החוק',
    body: `<p>σ קובע כמה <strong>סלחני</strong> החוק. דמיינו שופט: σ זעיר = שופט
      קפדן שמקבל רק "בדיוק μ!" — כמעט אף תא לא עומד בזה, והכול דועך 🕳️. σ ענק =
      שופט שמרשה הכול — הכול גדל בלי שליטה ומתפוצץ לרעש 🔥.</p>
      <p><strong>זה הסליידר החשוב ביותר במשחק.</strong> החיים מסתתרים ברצועה צרה
      באמצע — תראו אותה במפת אזור החיים.</p>
      <p class="help-try">💡 נסו: זרעו מרק וגררו את σ לאט מקצה לקצה. תרגישו איפה
      עובר הגבול בין קיפאון, חיים וכאוס.</p>`,
  },
  kernel: {
    title: '🔭 צורת המשקפיים',
    body: `<p>כל תא מסתכל על שכניו דרך "משקפיים" בצורת טבעות. μ ו‑σ הם
      <strong>חוזק</strong> החוק — הבורר הזה משנה את <strong>צורת הראייה</strong>
      עצמה, וזה משנה הכול: לכל משקפיים יש "כתב יד" משלהם.</p>
      <p>⭕ טבעת אחת ⇐ נקודות שמנמנות (והאורביום!) · 🌊 שתי טבעות ⇐ פסים גליים ·
      ✨ שלוש טבעות ⇐ אבק עדין · 🧭 טבעת עם רוח ⇐ כל העולם נסחף לכיוון אחד!</p>
      <p class="help-try">💡 יצור שנולד במשקפיים אחדות מתפרק באחרות — ומפת אזור
      החיים מתחלפת גם היא.</p>`,
  },
  R: {
    title: 'R — טווח ראייה',
    body: `<p>R הוא רדיוס הטבעת שדרכה כל תא רואה — עד כמה רחוק הוא מסתכל. R גדול ⇐
      יצורים גדולים, R קטן ⇐ יצורים קטנים וזריזים יותר.</p>
      <p class="help-try">💡 שימו לב: היצורים המפורסמים (כמו האורביום) נבנו בשביל
      R=13 בדיוק. אם תשנו R אחרי שטענתם אותם — הם יתפרקו. מרק אקראי עובד בכל R!</p>`,
  },
  T: {
    title: 'T — חלקוּת',
    body: `<p>בכל פריים העולם משתנה רק "צעד אחד חלקי T" — אז T הוא מידת הזהירות.
      T גדול ⇐ צעדים זעירים ⇐ תנועה חלקה ורגועה. T קטן ⇐ קפיצות גדולות ⇐ עולם
      עצבני שלא נרגע.</p>
      <p class="help-try">💡 נסו את "המושבה הרותחת 🫧" — אותו עולם כמו מרק רגיל,
      רק עם T=3. ההבדל מדהים.</p>`,
  },
  density: {
    title: 'צפיפות המרק',
    body: `<p>כשלוחצים 🥣 "מרק אקראי", העולם מתמלא בנקודות מקריות. הסליידר הזה
      קובע כמה צפוף הרעש הזה — הרבה נקודות או מעט.</p>
      <p class="help-try">💡 לפעמים מרק דליל דווקא מוליד יצורים יפים יותר ממרק
      צפוף. שווה לנסות את שניהם.</p>`,
  },
  boundary: {
    title: '🌍 צורת העולם',
    body: `<p>🍩 <strong>עולם עגול</strong>: אין קצה — מי שיוצא מצד אחד נכנס מהצד
      השני, כמו במשחק "נחש". יצורים יכולים לשחות לנצח.</p>
      <p>🧱 <strong>אקווריום</strong>: יש קירות אמיתיים. ליד הקיר תא רואה פחות
      שכנים — וקשה יותר לחיות שם. יצור ששוחה אל הקיר עלול להימחץ.</p>
      <p class="help-try">💡 טענו את "האקווריום 🐠" וצפו באורביום שוחה אל הפינה.</p>`,
  },
  // הסבר כללי לפאנל החוקים הצבעוני
  rules: {
    title: '🎨 חוקי העולם הצבעוני',
    body: `<p>בעולם צבעוני יש כמה "חומרים" (צבעים), ולכל חומר יכולים להיות חוקים
      שקושרים אותו לחומרים אחרים. כל שורה בפאנל היא <strong>חוק אחד</strong>:</p>
      <p>🟢 <strong>μ</strong> — באיזו צפיפות של החומר המשפיע החוק "מתעורר".<br>
      🟢 <strong>σ</strong> — כמה גמיש החוק (כמו בעולם הרגיל).<br>
      🟢 <strong>h</strong> — עוצמת ההשפעה: <strong>חיובי מעודד</strong> (עוזר
      לגדול), <strong>שלילי מדכא</strong> (הורג).</p>
      <p class="help-try">💡 גררו את h של חוק "מדכא" לכיוון האפס — ותראו את הטורף
      מפסיק לצוד. הכול חי ומגיב מיד!</p>`,
  },
};

/** פתיחת פופ־אפ העזרה עבור מפתח נתון */
function openHelp(key) {
  const h = HELP[key];
  if (!h) return;
  $('helpTitle').textContent = h.title;
  $('helpBody').innerHTML = h.body;
  $('helpDialog').showModal();
}

/* ================= קוביית הרב־תחומיות ================= */

/**
 * לכל תחום — איך לניה נוגעת בו, ו"נקודה למחשבה" לדיון בכיתה.
 * נפתח בלחיצה על אריח בקוביית התחומים שבתחתית העמוד.
 */
const SUBJECTS = [
  {
    emoji: '🔢', name: 'מתמטיקה',
    body: `<p>כל מה שאתם רואים על המסך הוא <strong>משוואה אחת</strong> שרצה שוב ושוב:
      קונבולוציה (סכום משוקלל של שכנים) ופעמון גאוסי. אין "קוד" ליצורים — יש נוסחה.</p>
      <p>זו דוגמה חיה ל<strong>התהוות (emergence)</strong>: מורכבות עשירה שנולדת מכללים
      פשוטים, אחד התחומים המרתקים במתמטיקה המודרנית.</p>
      <p class="help-try">🤔 למחשבה: איך ייתכן שנוסחה קצרה שאפשר לכתוב בשורה אחת
      יוצרת יצור ששוחה, נלחם ומתחלק? היכן ה"מידע" על היצור מסתתר?</p>`,
  },
  {
    emoji: '🧬', name: 'ביולוגיה',
    body: `<p>האורביום מתנהג כמו <strong>תא חי בודד</strong>: יש לו קרום (הקצה), הוא
      שומר על צורתו למרות הפרעות (הומאוסטזיס — בדיוק מה שמחוון המסה מודד!), ולפעמים
      אף מתחלק.</p>
      <p>עקרון "השמירה על האיזון" — לא ריק מדי, לא צפוף מדי — הוא הלב של כל תא חי
      בגופכם ברגע זה.</p>
      <p class="help-try">🤔 למחשבה: מה הופך משהו ל"חי"? האם אורביום ששומר על עצמו,
      נע ומגיב לסביבה — חי? ומה חסר לו?</p>`,
  },
  {
    emoji: '🌿', name: 'אקולוגיה',
    body: `<p>העולם הצבעוני "המרדף הגדול" הוא מודל <strong>טורף–נטרף</strong> אמיתי:
      הירוק (נטרף) חי בכוחות עצמו, האדום (טורף) ניזון ממנו והורג אותו.</p>
      <p>התוצאה — <strong>מחזורי אוכלוסייה</strong>: כשיש הרבה נטרף, הטורפים משגשגים,
      אוכלים יותר מדי, ואז קורסים בעצמם. בדיוק כמו שועלים וארנבות בטבע (משוואות
      לוטקה–וולטרה).</p>
      <p class="help-try">🤔 למחשבה: מה קורה אם הטורף חזק מדי? צפו — לרוב הוא הורג את
      כל המזון שלו... ואז מת בעצמו. מה זה מלמד על שיווי משקל בטבע?</p>`,
  },
  {
    emoji: '💻', name: 'מדעי המחשב',
    body: `<p>לניה היא <strong>אוטומט תאי</strong> — קרובת משפחה של "משחק החיים" של
      קונוויי (1970), אחד הרעיונות המכוננים של מדעי המחשב.</p>
      <p>זהו תחום שנקרא <strong>חיים מלאכותיים (Artificial Life)</strong>: לחקור חיים
      לא על ידי הסתכלות בטבע, אלא על ידי בנייתם מאפס בתוך המחשב.</p>
      <p class="help-try">🤔 למחשבה: אם אפשר "לחשב" חיים, האם המוח שלכם הוא בעצם
      מחשב? והאם מחשב יוכל אי־פעם להיות חי באמת?</p>`,
  },
  {
    emoji: '✨', name: 'פילוסופיה ותיאולוגיה',
    body: `<p>בעולם הזה נבראים "יצורים" מתוך <strong>חוק אחד</strong>, בלי שאיש צייר
      אותם. זה נוגע לשאלות עתיקות: האם צריך "מתכנן" כדי שייווצר סדר? או שסדר יכול
      לצוץ לבד מתוך כללים?</p>
      <p>ה"כוונון העדין" מרתק: החיים אפשריים רק ברצועה צרה מאוד של פרמטרים —
      "קצה הכאוס". יש שרואים בכך מטאפורה, ויש שרואים בכך שאלה עמוקה על היקום שלנו.</p>
      <p class="help-try">🤔 למחשבה: הכול כאן נקבע מראש על ידי חוק (דטרמיניזם) —
      ובכל זאת היצורים נראים כאילו יש להם "רצון". מה זה אומר על בחירה חופשית?</p>`,
  },
  {
    emoji: '⚛️', name: 'פיזיקה',
    body: `<p>מפת אזור החיים היא <strong>דיאגרמת מופעים (phase diagram)</strong> —
      בדיוק כמו זו שמתארת מים שהופכים לקרח או לאדים. יש "מופע" של דעיכה, מופע של
      כאוס, ורצועת מעבר ביניהם.</p>
      <p>"קצה הכאוס" הוא <strong>נקודה קריטית</strong> — כמו הרגע המדויק שבו חומר
      משנה מצב. שם, ורק שם, נוצרת המורכבות המעניינת.</p>
      <p class="help-try">🤔 למחשבה: למה דווקא ב"קצה" בין סדר לכאוס קורים הדברים
      המעניינים? האם גם המוח, החברה והמוזיקה חיים על קצה כזה?</p>`,
  },
  {
    emoji: '🧠', name: 'חקר המוח',
    body: `<p>העולם "הגחליליות" בנוי מ<strong>עידוד מקרוב ודיכוי מרחוק</strong> — בדיוק
      איך שנוירונים במוח עובדים: תא מעורר את שכניו הקרובים ומדכא את הרחוקים.</p>
      <p>אותו עיקרון יוצר את <strong>דפוסי טיורינג</strong> בטבע: פסי הזברה, כתמי
      הנמר, וצורות על קונכיות — כולם נולדים מהאיזון הזה בין עידוד לדיכוי.</p>
      <p class="help-try">🤔 למחשבה: אותו חוק פשוט מסביר גם דפוס על גב חיה וגם איך
      מחשבים דברים במוח. למה הטבע "ממחזר" את אותו רעיון שוב ושוב?</p>`,
  },
  {
    emoji: '🎨', name: 'אמנות',
    body: `<p>לניה היא <strong>אמנות גנרטיבית</strong>: יופי שנוצר לא על ידי אמן שמצייר
      כל פרט, אלא על ידי אלגוריתם שמגדל אותו. האמן בוחר את החוקים — היצירה מפתיעה גם
      אותו.</p>
      <p>פלטות הצבע, הפלואידיות של התנועה, ודוגמאות "שדה הגלים" — כולן שאלות של
      אסתטיקה שנפגשת עם מתמטיקה.</p>
      <p class="help-try">🤔 למחשבה: אם מחשב יצר משהו יפה שאף אחד לא תכנן במדויק —
      של מי היצירה? של מי שכתב את החוק, או של המקריות?</p>`,
  },
  {
    emoji: '🌍', name: 'פילוסופיה של המדע',
    body: `<p>לניה היא <strong>מודל</strong> — ייצוג פשוט של משהו מורכב. מדענים בונים
      מודלים כדי להבין את העולם, אבל מודל אף פעם אינו המציאות עצמה.</p>
      <p>היצורים כאן אינם "חיים אמיתיים", אבל הם מלמדים אותנו משהו אמיתי על מה שהחיים
      <em>יכולים</em> להיות — וזה בדיוק הכוח של מודל טוב.</p>
      <p class="help-try">🤔 למחשבה: מה מודל יכול ללמד אותנו שהמציאות עצמה לא?
      ומתי מודל "פשוט מדי" עלול דווקא להטעות אותנו?</p>`,
  },
];

/** בניית קוביית התחומים */
function renderSubjects() {
  const grid = $('subjectGrid');
  grid.innerHTML = '';
  SUBJECTS.forEach((s, i) => {
    const tile = document.createElement('button');
    tile.className = 'subject-tile';
    tile.innerHTML = `<span class="subject-emoji">${s.emoji}</span><span>${s.name}</span>`;
    tile.addEventListener('click', () => {
      $('helpTitle').textContent = `${s.emoji} לניה ו${s.name}`;
      $('helpBody').innerHTML = s.body;
      $('helpDialog').showModal();
    });
    grid.appendChild(tile);
  });
}

/* ================= שני העולמות (טאבים) ================= */

// לאיזה מצב שייך יצור/רשומה: עולם עם רשת חיבורים = 'color', אחרת 'simple'.
const entryMode = (x) => (x && x.multi ? 'color' : 'simple');

// היצור הפותח של כל מצב (מה שנטען כשעוברים לטאב)
const DEFAULT_CREATURE = { simple: 'orbium', color: 'hunt' };

/**
 * שיקוף מצב העולם הנוכחי בטאבים ובכפתורים — נקרא בכל טעינת עולם,
 * כדי שהטאב הפעיל תמיד יתאים למה שרץ בפועל (בלי לטעון מחדש).
 */
function updateModeUI() {
  currentMode = isMulti ? 'color' : 'simple';
  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.classList.toggle('active', tab.dataset.mode === currentMode);
  }
  // כפתור ההגרלה המתאים לכל מצב
  $('randomRulesBtn').hidden = isMulti;
  $('randomEcologyBtn').hidden = !isMulti;
  $('builtinTitle').textContent = isMulti ? 'אקולוגיות מוכנות' : 'יצורים מפורסמים';
}

/**
 * מעבר יזום בין הטאבים: טוען את היצור הפותח של המצב החדש
 * ומסנן מחדש את ספריית היצורים והגלריה למצב הזה.
 */
function switchMode(mode) {
  if (mode === currentMode) return;
  const id = DEFAULT_CREATURE[mode];
  const def = CREATURES.find((c) => c.id === id);
  if (def) loadCreatureIntoWorld(def); // מגדיר isMulti ומעדכן את הטאבים
  renderBuiltinCreatures();            // כעת מסונן לפי currentMode החדש
  renderGallery();
}

/* ================= עולם צבעוני (רב־ערוצי) ================= */

// שמות הערוצים ואימוג'י הצבע — תואמים בדיוק ל‑CHANNEL_COLORS ב‑render.js
// (0 = ירוק, 1 = אדום, 2 = כחול).
const CHANNEL_NAMES = ['ירוק', 'אדום', 'כחול'];
const CHANNEL_EMOJI = ['🟢', '🔴', '🔵'];

/**
 * כניסה/יציאה ממצב עולם צבעוני:
 * מסתיר את פקדי העולם היחיד (μ/σ/משקפיים/מפה) ומציג את פאנל
 * החוקים החי של העולם הצבעוני במקומם.
 */
function setMultiMode(on) {
  isMulti = on;
  $('singleRules').hidden = on;   // μ/σ/kernel/מפה
  $('multiRules').hidden = !on;   // פאנל החיבורים החי
  $('boundarySelect').disabled = on; // נשאר ב"עוד הגדרות", לכן מכובה ידנית
  $('multiNote').hidden = !on;
  $('channelPicker').hidden = !on;
  if (!on) brushChannel = 0;
}

/**
 * תיאור מילולי של חיבור, בעזרת צבעי הערוצים והכיוון:
 *   h>0 מעודד (→), h<0 מדכא (⊣), src===dst = "על עצמו".
 */
function connectionLabel(conn) {
  const s = CHANNEL_EMOJI[conn.src] ?? '⬜';
  const d = CHANNEL_EMOJI[conn.dst] ?? '⬜';
  const sName = CHANNEL_NAMES[conn.src] ?? `חומר ${conn.src + 1}`;
  const dName = CHANNEL_NAMES[conn.dst] ?? `חומר ${conn.dst + 1}`;
  if (conn.src === conn.dst) return `${s} ${sName} → על עצמו`;
  const arrow = conn.h >= 0 ? '→' : '⊣';
  const verb = conn.h >= 0 ? 'מעודד' : 'מדכא';
  return `${s} ${sName} ${arrow} ${d} ${dName} <small>(${verb})</small>`;
}

/** יצירת סליידר חוק בודד לפאנל הצבעוני (μ/σ/h של חיבור) */
function makeRuleSlider(label, value, min, max, step, onChange, fmt) {
  const wrap = document.createElement('label');
  wrap.className = 'rule-slider';
  const name = document.createElement('span');
  name.textContent = label;
  const out = document.createElement('output');
  out.textContent = fmt(value);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min; slider.max = max; slider.step = step;
  slider.value = value;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    out.textContent = fmt(v);
    onChange(v); // משנה ישירות את conn.mu/sigma/h — נכנס לתוקף מיד, בלי rebuild
  });
  wrap.append(name, slider, out);
  return wrap;
}

/**
 * בניית פאנל החוקים החי של העולם הצבעוני — קבוצה לכל חיבור.
 * העריכות משנות את sim.connections[i] ישירות; מכיוון ש‑step() קורא
 * את mu/sigma/h בכל פריים, ההשפעה מיידית ולא דורשת בנייה מחדש.
 */
function buildMultiRules() {
  const panel = $('multiRules');
  panel.innerHTML = '';
  const intro = document.createElement('p');
  intro.className = 'rules-intro';
  intro.innerHTML = '🎨 חוקי העולם הצבעוני — גררו כדי לכוונן חי '
    + '<button type="button" class="help-btn" data-help="rules" aria-label="הסבר על חוקי העולם הצבעוני">?</button>';
  panel.appendChild(intro);

  sim.connections.forEach((conn) => {
    const box = document.createElement('div');
    box.className = 'rule-conn';
    const title = document.createElement('div');
    title.className = 'rule-title';
    title.innerHTML = connectionLabel(conn);
    box.appendChild(title);
    box.appendChild(makeRuleSlider('μ', conn.mu, 0.05, 0.5, 0.005,
      (v) => { conn.mu = v; }, (v) => v.toFixed(3)));
    box.appendChild(makeRuleSlider('σ', conn.sigma, 0.01, 0.2, 0.005,
      (v) => { conn.sigma = v; }, (v) => v.toFixed(3)));
    box.appendChild(makeRuleSlider('h', conn.h, -1.5, 1.5, 0.05,
      (v) => {
        conn.h = v;
        // הכיוון (מעודד/מדכא) עלול להשתנות עם סימן h — מעדכנים כותרת
        title.innerHTML = connectionLabel(conn);
      }, (v) => v.toFixed(2)));
    panel.appendChild(box);
  });
}

/* ================= מחוללי אקראיות (🎲) ================= */

/** מספר אקראי אחיד בטווח [lo, hi] */
function randRange(lo, hi) { return lo + Math.random() * (hi - lo); }

/**
 * ג'נרוט תצורת אקולוגיה אקראית. הטיה לכיוון "מעניין": מבטיחים
 * לפחות חיבור עצמי מעודד אחד ולפחות חיבור מדכא אחד — המתכון
 * המינימלי לדינמיקה חיה במקום קיפאון או התפוצצות.
 */
function makeRandomEcology() {
  const C = Math.random() < 0.5 ? 2 : 3;
  const R = 8 + Math.floor(Math.random() * 6);   // 8..13
  const T = 8 + Math.floor(Math.random() * 5);   // 8..12
  const connections = [];

  // כל חומר מקבל חיבור עצמי מעודד — כך אין "צבע מת" שאפשר לצייר בו
  // אבל אין לו שום חוק. כל צבע שקיים בבורר המברשת הוא חומר אמיתי.
  for (let c = 0; c < C; c++) {
    connections.push({ src: c, dst: c, mu: randRange(0.10, 0.30), sigma: randRange(0.02, 0.06), h: randRange(0.5, 1) });
  }
  // חובה: חיבור מדכא בין שני חומרים שונים (מישהו שמפריע למישהו)
  let a = Math.floor(Math.random() * C), b = (a + 1 + Math.floor(Math.random() * (C - 1))) % C;
  connections.push({ src: a, dst: b, mu: randRange(0.10, 0.35), sigma: randRange(0.02, 0.08), h: -randRange(0.3, 1), unit: Math.random() < 0.5 });
  // עוד 1..C חיבורים חופשיים בין חומרים שונים (יחסים מפתיעים)
  const extra = 1 + Math.floor(Math.random() * C);
  for (let i = 0; i < extra; i++) {
    const src = Math.floor(Math.random() * C);
    const dst = (src + 1 + Math.floor(Math.random() * (C - 1))) % C; // dst ≠ src
    connections.push({ src, dst, mu: randRange(0.10, 0.35), sigma: randRange(0.02, 0.08), h: randRange(-1, 1), unit: Math.random() < 0.4 });
  }
  return { C, R, T, connections };
}

/**
 * בדיקה חבויה מהירה: מריצים ~60 צעדים על רשת קטנה ומחזירים true אם
 * המצב "חי" (לא נמוג ולא רווי). מסנן חלק גדול מהגלגולים המתים.
 */
function ecologyLives(config) {
  const test = new LeniaMulti(48, 48, config);
  test.soup(0.3, 0.6);
  for (let i = 0; i < 60; i++) test.step();
  return classifyState(test.mass, test.coverage) === 'life';
}

/** כפתור "🎲 אקולוגיה אקראית": מגריל עולם צבעוני חדש ומאפשר לכוונן */
function doRandomEcology() {
  let config = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    config = makeRandomEcology();
    if (ecologyLives(config)) break; // מצאנו אחת שנראית חיה — עוצרים
  }
  loadCreatureIntoWorld({
    multi: config,
    soup: { density: 0.3, fraction: 0.6 },
    toastMsg: 'אקולוגיה חדשה! 🎲 כוונו את הסליידרים, או גלגלו שוב עד שאחת תחיה 🌱',
  });
}

/** כפתור "🎲 הגרל חוקים" (עולם חד־ערוצי): גרעין אקראי + μ/σ ברצועת החיים */
function doRandomRules() {
  // אם אנחנו בעולם צבעוני — חוזרים קודם לעולם רגיל
  if (isMulti) {
    sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
    setMultiMode(false);
  }
  const types = Object.keys(KERNEL_TYPES);
  const kt = types[Math.floor(Math.random() * types.length)];
  // בוחרים נקודת (μ,σ) שהמפה כבר סימנה כ"חיים" עבור הגרעין הזה
  const life = phaseMap.randomLifeParams(kt) ?? { mu: 0.15, sigma: 0.03 };
  sim.setParams({ ...DEFAULTS, kernelType: kt, mu: +life.mu.toFixed(3), sigma: +life.sigma.toFixed(3) });
  syncSlidersFromParams();
  sim.clear();
  sim.soup(soupDensity);
  massHistory.length = 0;
  setRunning(true);
  toast(`הגרלנו חוקים! 🎲 ${KERNEL_TYPES[kt].name}`);
}

/**
 * בניית כפתורי בחירת "חומר" למברשת. מציגים רק חומרים שיש להם חוק
 * (מופיעים באיזשהו חיבור) — כדי שלא יהיה צבע שאפשר לצייר בו אבל אין
 * לו שום התנהגות.
 */
function buildChannelPicker(config) {
  const picker = $('channelPicker');
  picker.innerHTML = '';
  // אילו ערוצים משתתפים בכלל בחוקים (כמקור או כיעד)
  const used = new Set();
  for (const conn of config.connections) { used.add(conn.src); used.add(conn.dst); }
  const channels = [...Array(config.C).keys()].filter((c) => used.has(c));
  brushChannel = channels[0] ?? 0;
  picker.hidden = channels.length < 2; // חומר אחד — אין מה לבחור
  channels.forEach((c, i) => {
    const btn = document.createElement('button');
    const [r, g, b] = CHANNEL_COLORS[c % CHANNEL_COLORS.length];
    btn.textContent = CHANNEL_NAMES[c] ?? `חומר ${c + 1}`;
    btn.style.borderColor = `rgb(${r},${g},${b})`;
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      brushChannel = c;
      if (brushErase) {
        brushErase = false;
        $('brushMode').textContent = '✏️ צייר';
      }
      picker.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === btn));
    });
    picker.appendChild(btn);
  });
}

/* ================= פעולות ================= */

function setRunning(v) {
  running = v;
  $('playBtn').textContent = running ? '⏸️ עצור' : '▶️ הפעל';
  $('playBtn').classList.toggle('primary', !running);
}

function doSoup() {
  sim.soup(soupDensity);
  massHistory.length = 0;
  setRunning(true);
  toast('זרענו מרק אקראי! 🥣 עכשיו נראה אם ייוולדו חיים...');
}

function doClear() {
  sim.clear();
  massHistory.length = 0;
}

function doReset() {
  if (isMulti) {
    // בעולם צבעוני "איפוס" = מרק טרי לאותה אקולוגיה (נשארים באותו מצב)
    sim.clear();
    sim.soup(0.3, 0.6);
    massHistory.length = 0;
    setRunning(true);
    toast('זרענו מרק חדש לאקולוגיה 🥣');
    return;
  }
  sim.setParams({ ...DEFAULTS });
  syncSlidersFromParams();
  toast('הפרמטרים חזרו לברירת המחדל ♻️');
}

function doStep() {
  setRunning(false);
  sim.step();
  massHistory.push(sim.mass);
  if (massHistory.length > HISTORY_LEN) massHistory.shift();
}

/** הודעה קטנה וידידותית שנעלמת לבד */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ================= מברשת (עכבר + מגע) ================= */

function setupBrush() {
  const canvas = $('world');
  let drawing = false;
  let wasRunning = false;

  const paint = (e) => {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - rect.left) / rect.width) * sim.W);
    const gy = Math.floor(((e.clientY - rect.top) / rect.height) * sim.H);
    sim.brush(gx, gy, brushSize, brushErase ? 0 : 1, brushChannel);
  };

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    // בזמן ציור העולם "עוצר את נשימתו" — אחרת הקצה של הקו מתחיל
    // לדעוך עוד לפני שמסיימים לצייר (תא מלא נמוג תוך ~T פריימים).
    // כשמרימים את האצבע, הציור מתעורר לחיים בבת אחת.
    wasRunning = running;
    if (running) setRunning(false);
    paint(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drawing) { paint(e); e.preventDefault(); }
  });
  const stop = () => {
    if (drawing && wasRunning) setRunning(true);
    drawing = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}

/* ================= מפת הפאזה: לחיצה קובעת פרמטרים ================= */

function setupPhaseMapInput() {
  const canvas = $('phaseMap');
  let dragging = false;
  const apply = (e) => {
    if (isMulti) return; // למפה אין משמעות בעולם הצבעוני
    const { mu, sigma } = phaseMap.paramsAt(e.clientX, e.clientY);
    sim.setParams({ mu: +mu.toFixed(3), sigma: +sigma.toFixed(3) });
    syncSlidersFromParams();
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    apply(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { apply(e); e.preventDefault(); } });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
}

/* ================= יצורים: טעינה, שמירה, גלריה ================= */

/**
 * טעינת יצור או ניסוי לעולם.
 * @param {{params:object, seed?:object, soup?:{density:number}, brush?:number,
 *          toastMsg?:string, name?:string}} entry
 * יצור רגיל מגיע עם seed (דפוס קבוע); "ניסוי מרק" (כמו המושבה הרותחת)
 * מגיע עם soup — רעש אקראי טרי בכל הפעלה; ניסוי בלי שניהם (כמו חממת
 * הציורים) משאיר עולם ריק. brush מכוון את גודל המברשת, toastMsg מחליף
 * את הודעת ברירת המחדל.
 */
function loadCreatureIntoWorld({ params, seed, soup, brush, toastMsg, name, multi }) {
  if (multi) {
    // עולם צבעוני: מנוע רב־ערוצי עם רשת החיבורים של הניסוי
    // משכפלים את התצורה כדי שכיוונון חי לא יזהם את הגדרות היצור
    // המקוריות (חשוב במיוחד ליצורים מובנים ולטעינה חוזרת).
    const cfg = structuredClone(multi);
    sim = new LeniaMulti(gridSize, gridSize, cfg);
    setMultiMode(true);
    buildChannelPicker(cfg);
    buildMultiRules(); // פאנל החוקים החי מותאם לחיבורים של העולם הזה
  } else {
    if (isMulti) {
      // חזרה לעולם רגיל מעולם מיוחד
      sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
      setMultiMode(false);
    }
    // יצור שלא הגדיר צורת עולם מקבל טורוס — כדי שקירות לא "יידבקו"
    sim.setParams({ boundary: 'torus', ...params });
  }
  sim.clear();
  if (seed) sim.placeSeed(seed);
  if (soup) sim.soup(soup.density, soup.fraction);
  if (brush) {
    brushSize = brush;
    $('brushSlider').value = brush;
    $('brushValue').textContent = brush;
    if (brushErase) {
      brushErase = false;
      $('brushMode').textContent = '✏️ צייר';
    }
  }
  massHistory.length = 0;
  syncSlidersFromParams();
  updateModeUI();  // הטאב הפעיל תמיד משקף את העולם שרץ
  setRunning(true);
  if (toastMsg) toast(toastMsg);
  else if (name) toast(`${name} שוחרר לעולם! 🌍`);
}

/** בניית כפתורי היצורים המובנים — רק אלה של המצב הפעיל */
function renderBuiltinCreatures() {
  const container = $('builtinCreatures');
  container.innerHTML = '';
  for (const c of CREATURES.filter((c) => entryMode(c) === currentMode)) {
    const btn = document.createElement('button');
    btn.className = 'creature-btn';
    btn.innerHTML = `<strong>${c.name}</strong><small>${c.description}</small>`;
    btn.addEventListener('click', () => loadCreatureIntoWorld(c));
    container.appendChild(btn);
  }
}

/** רינדור גלריית הקטלוג האישי — רק תגליות של המצב הפעיל */
function renderGallery() {
  const gallery = $('gallery');
  const entries = catalog.loadCatalog().filter((e) => entryMode(e) === currentMode);
  gallery.innerHTML = '';
  $('emptyGallery').style.display = entries.length ? 'none' : 'block';

  for (const e of entries) {
    const card = document.createElement('div');
    card.className = 'card';

    const img = document.createElement('img');
    img.src = e.thumbnail;
    img.alt = e.name;

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = e.name;

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const date = new Date(e.date).toLocaleDateString('he-IL');
    meta.textContent = `התגלה ע"י ${e.discoveredBy || 'אנונימי'} · ${date}`;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '🐣 שחרר לעולם';
    loadBtn.addEventListener('click', () => {
      // רשומות ישנות (מלפני בורר הגרעינים) לא שמרו kernelType — ברירת מחדל ring1
      loadCreatureIntoWorld({
        params: { kernelType: 'ring1', boundary: 'torus', ...e.params },
        seed: catalog.decodeSeed(e.seed),
        name: e.name,
        multi: e.multi,
      });
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '🗑️';
    delBtn.title = 'מחיקה';
    delBtn.addEventListener('click', () => {
      if (confirm(`למחוק את "${e.name}" מהקטלוג?`)) {
        catalog.deleteCreature(e.id);
        renderGallery();
      }
    });

    actions.append(loadBtn, delBtn);
    card.append(img, title, meta, actions);
    gallery.appendChild(card);
  }
}

/** דיאלוג שמירת יצור */
function setupSaveDialog() {
  const dialog = $('saveDialog');
  $('saveBtn').addEventListener('click', () => {
    const seed = sim.cropAlive();
    if (!seed) {
      toast('העולם ריק — אין יצור לשמור 🤷');
      return;
    }
    $('creatureName').value = '';
    $('studentName').value = localStorage.getItem(STUDENT_KEY) ?? '';
    dialog.showModal();
  });

  $('cancelSave').addEventListener('click', () => dialog.close());

  $('confirmSave').addEventListener('click', (e) => {
    e.preventDefault();
    const seed = sim.cropAlive();
    if (!seed) { dialog.close(); return; }
    const name = $('creatureName').value.trim() || 'יצור ללא שם';
    const student = $('studentName').value.trim();
    localStorage.setItem(STUDENT_KEY, student);
    try {
      catalog.saveCreature({
        name,
        params: isMulti
          ? { R: sim.R, T: sim.T }  // בעולם צבעוני החוקים נמצאים ב-multi
          : { mu: sim.mu, sigma: sim.sigma, R: sim.R, T: sim.T, kernelType: sim.kernelType, boundary: sim.boundary },
        seed,
        thumbnail: renderer.thumbnail(),
        discoveredBy: student,
        multi: isMulti ? sim.config : undefined,
      });
      toast(`"${name}" נשמר לספר המינים! 📖`);
      renderGallery();
    } catch {
      toast('אופס — אין מקום באחסון. נסו למחוק יצורים ישנים 🧹');
    }
    dialog.close();
  });
}

/** ייצוא/ייבוא JSON */
function setupImportExport() {
  $('exportBtn').addEventListener('click', () => {
    if (!catalog.loadCatalog().length) { toast('הקטלוג ריק — אין מה לייצא'); return; }
    catalog.exportCatalog();
  });
  $('importInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const added = catalog.importCatalog(await file.text());
      toast(added ? `יובאו ${added} יצורים חדשים! 🎉` : 'לא נמצאו יצורים חדשים בקובץ');
      renderGallery();
    } catch {
      toast('הקובץ אינו קטלוג לניה תקין 😕');
    }
    e.target.value = '';
  });
}

/* ================= החלפת רזולוציה ================= */

function setGridSize(size) {
  if (size === gridSize) return;
  gridSize = size;
  if (isMulti) {
    sim = new LeniaMulti(size, size, sim.config);
  } else {
    const params = { mu: sim.mu, sigma: sim.sigma, R: sim.R, T: sim.T, kernelType: sim.kernelType };
    sim = new Lenia(size, size, params);
  }
  renderer.setGridSize(size, size);
  massHistory.length = 0;
  doSoup();
}

/* ================= אתחול ================= */

function init() {
  const canvas = $('world');
  // רזולוציית תצוגה קבועה — ההחלקה בזמן המתיחה עושה את העבודה
  canvas.width = 640;
  canvas.height = 640;

  renderer = new Renderer(canvas, gridSize, gridSize);
  phaseMap = new PhaseMap($('phaseMap'));

  // סליידרים ראשיים
  bindSlider('muSlider', 'muValue', (v) => sim.setParams({ mu: v }), (v) => v.toFixed(3));
  bindSlider('sigmaSlider', 'sigmaValue', (v) => sim.setParams({ sigma: v }), (v) => v.toFixed(3));
  bindSlider('rSlider', 'rValue', (v) => sim.setParams({ R: Math.round(v) }), (v) => Math.round(v));
  bindSlider('tSlider', 'tValue', (v) => sim.setParams({ T: Math.round(v) }), (v) => Math.round(v));
  bindSlider('brushSlider', 'brushValue', (v) => { brushSize = v; }, (v) => Math.round(v));
  bindSlider('densitySlider', 'densityValue', (v) => { soupDensity = v; }, (v) => `${Math.round(v * 100)}%`);

  // כפתורים ראשיים
  $('playBtn').addEventListener('click', () => setRunning(!running));
  $('stepBtn').addEventListener('click', doStep);
  $('soupBtn').addEventListener('click', doSoup);
  $('clearBtn').addEventListener('click', doClear);
  $('resetBtn').addEventListener('click', doReset);

  // כפתורי ההגרלה (🎲)
  $('randomRulesBtn').addEventListener('click', doRandomRules);
  $('randomEcologyBtn').addEventListener('click', doRandomEcology);

  // טאבים: מעבר בין העולם הפשוט לצבעוני
  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  }

  // פופ־אפ עזרה: לחיצה על כל כפתור ❓ בעמוד (גם כאלה שנבנים דינמית)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.help-btn');
    if (btn) { e.preventDefault(); openHelp(btn.dataset.help); }
  });
  $('helpClose').addEventListener('click', () => $('helpDialog').close());

  // מהירות
  for (const btn of document.querySelectorAll('[data-speed]')) {
    btn.addEventListener('click', () => {
      speed = parseFloat(btn.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  }

  // מברשת: ציור/מחיקה
  $('brushMode').addEventListener('click', () => {
    brushErase = !brushErase;
    $('brushMode').textContent = brushErase ? '🧽 מחק' : '✏️ צייר';
  });

  // בורר צורת העולם (טורוס / אקווריום)
  $('boundarySelect').addEventListener('change', (e) => {
    sim.setParams({ boundary: e.target.value });
    toast(e.target.value === 'walls'
      ? 'העולם קיבל קירות! 🧱 שימו לב מה קורה ליצורים ליד הזכוכית'
      : 'העולם עגול שוב 🍩 — מי שיוצא מצד אחד חוזר מהשני');
  });

  // בורר צורת הגרעין ("המשקפיים")
  const kernelSelect = $('kernelSelect');
  for (const [key, k] of Object.entries(KERNEL_TYPES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = k.name;
    kernelSelect.appendChild(opt);
  }
  kernelSelect.addEventListener('change', () => {
    sim.setParams({ kernelType: kernelSelect.value });
    phaseMap.setKernelType(kernelSelect.value);
    toast('משקפיים חדשים! 🔭 פיזיקה חדשה — זרעו מרק ובדקו מה חי כאן');
  });

  // פלטות צבע
  const paletteSelect = $('paletteSelect');
  for (const [key, p] of Object.entries(PALETTES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.name;
    paletteSelect.appendChild(opt);
  }
  paletteSelect.addEventListener('change', () => renderer.setPalette(paletteSelect.value));

  // רזולוציה
  $('resolutionSelect').addEventListener('change', (e) => setGridSize(parseInt(e.target.value, 10)));

  // הסיפור: פתוח בביקור הראשון; אחרי שנסגר פעם — נשאר סגור בפעמים הבאות
  const story = $('storyBox');
  if (localStorage.getItem('lenia.storyClosed')) story.removeAttribute('open');
  story.addEventListener('toggle', () => {
    if (!story.open) localStorage.setItem('lenia.storyClosed', '1');
  });

  setupBrush();
  setupPhaseMapInput();
  setupSaveDialog();
  setupImportExport();
  renderBuiltinCreatures();
  renderGallery();
  renderSubjects();
  syncSlidersFromParams();

  // פתיחה עם "וואו": האורביום שוחה מהשנייה הראשונה
  const orbium = CREATURES[0];
  if (orbium) loadCreatureIntoWorld({ params: orbium.params, seed: orbium.seed });

  setRunning(true);
  requestAnimationFrame(frame);
}

init();
