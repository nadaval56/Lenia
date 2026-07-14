/**
 * ui.js — הממשק: סליידרים, כפתורים, מחוון החיים, והלולאה הראשית
 * ================================================================
 * זהו "המנצח על התזמורת": מחבר בין ליבת הסימולציה (lenia.js),
 * הרינדור (render.js), הקטלוג (catalog.js) ומפת הפאזה (phasemap.js).
 */

import { Lenia, classifyState, KERNEL_TYPES } from './lenia.js?v=5';
import { LeniaMulti } from './multi.js?v=5';
import { Renderer, PALETTES, CHANNEL_COLORS } from './render.js?v=5';
import { PhaseMap } from './phasemap.js?v=5';
import { CREATURES } from './creatures.js?v=5';
import * as catalog from './catalog.js?v=5';

/* ================= הגדרות כלליות ================= */

const DEFAULTS = { mu: 0.15, sigma: 0.017, R: 13, T: 10, kernelType: 'ring1' };
const HISTORY_LEN = 240;          // כמה פריימים אחורה זוכר גרף המסה
const STUDENT_KEY = 'lenia.student';

const $ = (id) => document.getElementById(id);

/* ================= מצב האפליקציה ================= */

let gridSize = 128;
let sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
let isMulti = false;               // האם אנחנו בעולם רב־ערוצי (צבעוני)
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
  phaseMap.setKernelType(sim.kernelType);
}

/* ================= עולם צבעוני (רב־ערוצי) ================= */

const CHANNEL_NAMES = ['ירוק', 'אדום', 'כחול'];

/** כניסה/יציאה ממצב עולם צבעוני: מנטרל את פקדי העולם היחיד */
function setMultiMode(on) {
  isMulti = on;
  for (const id of ['muSlider', 'sigmaSlider', 'rSlider', 'kernelSelect']) {
    $(id).disabled = on;
  }
  document.querySelector('.phase-wrap').classList.toggle('disabled', on);
  $('multiNote').hidden = !on;
  $('channelPicker').hidden = !on;
  if (!on) brushChannel = 0;
}

/** בניית כפתורי בחירת "חומר" למברשת, לפי מספר הערוצים בעולם */
function buildChannelPicker(C) {
  const picker = $('channelPicker');
  picker.innerHTML = '';
  brushChannel = 0;
  for (let c = 0; c < C; c++) {
    const btn = document.createElement('button');
    const [r, g, b] = CHANNEL_COLORS[c % CHANNEL_COLORS.length];
    btn.textContent = CHANNEL_NAMES[c] ?? `חומר ${c + 1}`;
    btn.style.borderColor = `rgb(${r},${g},${b})`;
    if (c === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      brushChannel = c;
      if (brushErase) {
        brushErase = false;
        $('brushMode').textContent = '✏️ צייר';
      }
      picker.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === btn));
    });
    picker.appendChild(btn);
  }
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
    // איפוס מהעולם הצבעוני מחזיר לעולם הרגיל
    sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
    setMultiMode(false);
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
    sim = new LeniaMulti(gridSize, gridSize, multi);
    setMultiMode(true);
    buildChannelPicker(multi.C);
  } else {
    if (isMulti) {
      // חזרה לעולם רגיל מהעולם הצבעוני
      sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
      setMultiMode(false);
    }
    sim.setParams(params);
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
  setRunning(true);
  if (toastMsg) toast(toastMsg);
  else if (name) toast(`${name} שוחרר לעולם! 🌍`);
}

/** בניית כפתורי היצורים המובנים */
function renderBuiltinCreatures() {
  const container = $('builtinCreatures');
  container.innerHTML = '';
  for (const c of CREATURES) {
    const btn = document.createElement('button');
    btn.className = 'creature-btn';
    btn.innerHTML = `<strong>${c.name}</strong><small>${c.description}</small>`;
    btn.addEventListener('click', () => loadCreatureIntoWorld(c));
    container.appendChild(btn);
  }
}

/** רינדור גלריית הקטלוג האישי */
function renderGallery() {
  const gallery = $('gallery');
  const entries = catalog.loadCatalog();
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
        params: { kernelType: 'ring1', ...e.params },
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
          : { mu: sim.mu, sigma: sim.sigma, R: sim.R, T: sim.T, kernelType: sim.kernelType },
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
  syncSlidersFromParams();

  // פתיחה עם "וואו": האורביום שוחה מהשנייה הראשונה
  const orbium = CREATURES[0];
  if (orbium) loadCreatureIntoWorld({ params: orbium.params, seed: orbium.seed });

  setRunning(true);
  requestAnimationFrame(frame);
}

init();
