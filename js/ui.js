/**
 * ui.js — הממשק: סליידרים, כפתורים, מחוון החיים, והלולאה הראשית
 * ================================================================
 * זהו "המנצח על התזמורת": מחבר בין ליבת הסימולציה (lenia.js),
 * הרינדור (render.js), הקטלוג (catalog.js) ומפת הפאזה (phasemap.js).
 */

import { Lenia, classifyState } from './lenia.js';
import { Renderer, PALETTES } from './render.js';
import { PhaseMap } from './phasemap.js';
import { CREATURES } from './creatures.js';
import * as catalog from './catalog.js';

/* ================= הגדרות כלליות ================= */

const DEFAULTS = { mu: 0.15, sigma: 0.017, R: 13, T: 10 };
const HISTORY_LEN = 240;          // כמה פריימים אחורה זוכר גרף המסה
const STUDENT_KEY = 'lenia.student';

const $ = (id) => document.getElementById(id);

/* ================= מצב האפליקציה ================= */

let gridSize = 128;
let sim = new Lenia(gridSize, gridSize, { ...DEFAULTS });
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
  renderer.draw(sim.A);
  updateIndicator();
  drawSparkline();
  // דגימת מפת הפאזה ברקע — בנתח זמן קטן שלא מפריע לאנימציה
  phaseMap.tick(running ? 3 : 8);
  phaseMap.draw(sim.mu, sim.sigma);
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
  $('muSlider').value = sim.mu;
  $('sigmaSlider').value = sim.sigma;
  $('rSlider').value = sim.R;
  $('tSlider').value = sim.T;
  $('muValue').textContent = sim.mu.toFixed(3);
  $('sigmaValue').textContent = sim.sigma.toFixed(3);
  $('rValue').textContent = sim.R;
  $('tValue').textContent = sim.T;
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

  const paint = (e) => {
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor(((e.clientX - rect.left) / rect.width) * sim.W);
    const gy = Math.floor(((e.clientY - rect.top) / rect.height) * sim.H);
    sim.brush(gx, gy, brushSize, brushErase ? 0 : 1);
  };

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drawing) { paint(e); e.preventDefault(); }
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
}

/* ================= מפת הפאזה: לחיצה קובעת פרמטרים ================= */

function setupPhaseMapInput() {
  const canvas = $('phaseMap');
  let dragging = false;
  const apply = (e) => {
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
 * @param {{params:object, seed?:object, soup?:{density:number}, name?:string}} entry
 * יצור רגיל מגיע עם seed (דפוס קבוע); "ניסוי מרק" (כמו המושבה הרותחת)
 * מגיע עם soup — ואז זורעים רעש אקראי טרי בכל הפעלה.
 */
function loadCreatureIntoWorld({ params, seed, soup, name }) {
  sim.setParams(params);
  sim.clear();
  if (seed) sim.placeSeed(seed);
  if (soup) sim.soup(soup.density);
  massHistory.length = 0;
  syncSlidersFromParams();
  setRunning(true);
  if (name) toast(`${name} שוחרר לעולם! 🌍`);
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
      loadCreatureIntoWorld({ params: e.params, seed: catalog.decodeSeed(e.seed), name: e.name });
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
        params: { mu: sim.mu, sigma: sim.sigma, R: sim.R, T: sim.T },
        seed,
        thumbnail: renderer.thumbnail(),
        discoveredBy: student,
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
  const params = { mu: sim.mu, sigma: sim.sigma, R: sim.R, T: sim.T };
  sim = new Lenia(size, size, params);
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
