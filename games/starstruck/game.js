"use strict";

/* =====================================================================
   Starstruck · Spiellogik und Oberfläche
   ===================================================================== */

const MODES = {
  m1: {
    key: "m1", n: 8, k: 1, label: "Mittel", sub: "1 Stern · 8×8", short: "1★ Mittel",
    spec: { minProbes: 0, maxProbes: 0 },
  },
  h1: {
    key: "h1", n: 9, k: 1, label: "Schwer", sub: "1 Stern · 9×9", short: "1★ Schwer",
    spec: { minProbes: 1, maxProbes: 99 },
  },
  // Beide Zwei-Sterne-Stufen nutzen dasselbe Raster; sie unterscheiden sich
  // darin, wie oft man beim Lösen vorausdenken muss. Die Lücke bei 3 Runden
  // hält die beiden Stufen spürbar auseinander.
  m2: {
    key: "m2", n: 10, k: 2, label: "Mittel", sub: "2 Sterne · 10×10", short: "2★ Mittel",
    spec: { minProbes: 0, maxProbes: 2 },
  },
  h2: {
    key: "h2", n: 10, k: 2, label: "Schwer", sub: "2 Sterne · 10×10", short: "2★ Schwer",
    spec: { minProbes: 4, maxProbes: 99 },
  },
};
const MODE_ORDER = ["m1", "h1", "m2", "h2"];

const SAVE_KEY = "starstruckSave";
const STATS_KEY = "starstruckStats";
const SETTINGS_KEY = "starstruckSettings";
const POOL_KEY = "starstruckPool";

/* So viele fertige Rätsel hält der Vorrat je Stufe bereit. */
const POOL_TARGET = 5;

const CELL_MIN = 22;
const CELL_MAX = 62;

let game = null;
let settings = { autoCross: true, showErrors: true };
let timerInterval = null;
let elapsedSeconds = 0;
let cellElements = [];
let drag = null;
let generating = false;

/* Automatisch gesetzte Kreuze werden nicht schlagartig sichtbar, sondern
   laufen als Welle vom Stern nach außen. Hier sammeln sie sich, bis der
   nächste Durchlauf von render() sie einblendet. */
let pendingWave = [];

/* Tempo der Welle – kleiner heißt langsamer. Alle Zeiten leiten sich davon ab,
   damit sich das Gefühl an einer Stelle nachjustieren lässt. */
const WAVE_TEMPO = 0.45;
const WAVE_STEP_MS = Math.round(38 / WAVE_TEMPO);   // Verzögerung je Feld Abstand
const WAVE_POP_MS = Math.round(240 / WAVE_TEMPO);   // Einblenden eines Kreuzes
const WAVE_GLOW_MS = Math.round(400 / WAVE_TEMPO);  // Helligkeitsimpuls der Kachel
/* Weit entfernte Ausreißer sollen die Welle nicht endlos ausfransen lassen. */
const WAVE_MAX_STEPS = 10;

/* ---------------------------------------------------------------
   Speicher
   --------------------------------------------------------------- */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) settings = Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* nicht verfügbar */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* egal */ }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* egal */ }
  return {};
}

function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* egal */ }
}

function recordStat(modeKey, field, value) {
  const stats = loadStats();
  const entry = stats[modeKey] || { played: 0, won: 0, best: null };
  if (field === "played") entry.played += 1;
  if (field === "won") {
    entry.won += 1;
    if (entry.best === null || value < entry.best) entry.best = value;
  }
  stats[modeKey] = entry;
  saveStats(stats);
}

/*
 * Ein Spielstand je Sternzahl: eine angefangene Ein-Stern-Partie und eine
 * angefangene Zwei-Sterne-Partie können nebeneinander bestehen bleiben.
 */
const STAR_COUNTS = [1, 2];

function saveGame() {
  if (!game) return;
  const saves = loadSaves();
  saves[game.k] = {
    modeKey: game.modeKey,
    regionOf: Array.from(game.regionOf),
    solution: Array.from(game.solution),
    marks: Array.from(game.marks),
    autoMarks: Array.from(game.autoMarks),
    elapsedSeconds: elapsedSeconds,
    hintsUsed: game.hintsUsed,
  };
  writeSaves(saves);
}

/**
 * Gespeicherte Rätsel gehören zu einer bestimmten Brettgröße. Ändert sich die
 * einer Stufe (die schwere 2-Sterne-Stufe war zwischenzeitlich 12×12), passen
 * alte Einträge nicht mehr und würden ein unsinniges Brett erzeugen. Deshalb
 * wird beim Laden gegen die heutige Größe geprüft.
 */
function fitsMode(modeKey, puzzle) {
  const mode = MODES[modeKey];
  if (!mode || !puzzle) return false;
  return (
    Array.isArray(puzzle.regionOf) && puzzle.regionOf.length === mode.n * mode.n &&
    Array.isArray(puzzle.stars) && puzzle.stars.length === mode.n * mode.k
  );
}

function validSave(saved) {
  if (!saved || !fitsMode(saved.modeKey, { regionOf: saved.regionOf, stars: saved.solution })) return null;
  const cells = MODES[saved.modeKey].n * MODES[saved.modeKey].n;
  if (!Array.isArray(saved.marks) || saved.marks.length !== cells) return null;
  if (!Array.isArray(saved.autoMarks) || saved.autoMarks.length !== cells) return null;
  return saved;
}

function loadSaves() {
  const out = {};
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw);
    // Älteres Format: ein einzelner Spielstand ohne Fächer.
    if (parsed && parsed.modeKey) {
      const one = validSave(parsed);
      if (one) out[MODES[one.modeKey].k] = one;
      return out;
    }
    for (let i = 0; i < STAR_COUNTS.length; i++) {
      const k = STAR_COUNTS[i];
      const one = validSave(parsed[k]);
      if (one && MODES[one.modeKey].k === k) out[k] = one;
    }
  } catch (e) { /* egal */ }
  return out;
}

function writeSaves(saves) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saves)); } catch (e) { /* egal */ }
}

function loadSave(starCount) {
  return loadSaves()[starCount] || null;
}

function clearSave(starCount) {
  const saves = loadSaves();
  delete saves[starCount];
  writeSaves(saves);
}

/* ---------------------------------------------------------------
   Rätselvorrat und Hintergrund-Rechner

   Eindeutige 2-Sterne-Rätsel zu finden dauert Sekunden bis Minuten. Deshalb
   liegt je Stufe ein kleiner Vorrat bereit: Beim Start wird ein fertiges
   Rätsel entnommen, und ein Worker rechnet während des Spielens Nachschub.
   --------------------------------------------------------------- */

let jobSeq = 0;
let fillRunning = false;
let fillTimer = null;
let fillWorker = null;
let lastActivity = 0;
let currentPaceName = null;

/*
 * Taktung des Hintergrund-Rechners. Die Erzeugung ist eine geschlossene
 * Rechenschleife und würde sonst dauerhaft einen Kern belegen.
 *
 * Bei einem Logikrätsel ist fast die gesamte Spielzeit Nachdenkzeit – spürbar
 * stören kann die Rechnung nur, während wirklich geklickt oder gewischt wird.
 * Deshalb drei Stufen statt eines harten Stopps.
 */
const PACE = {
  // Startbildschirm: niemand wartet auf eine flüssige Eingabe.
  idle: { workMs: 150, restMs: 40 },
  // Partie läuft, aber der Spieler überlegt gerade.
  thinking: { workMs: 30, restMs: 70 },
  // Der Spieler tippt oder wischt: Finger weg vom Prozessor.
  interacting: { paused: true },
  // Jemand wartet auf genau dieses Rätsel.
  urgent: { workMs: 0, restMs: 0 },
};

/* So lange nach der letzten Eingabe gilt der Spieler noch als aktiv. */
const ACTIVITY_QUIET_MS = 1200;

function noteActivity() {
  lastActivity = Date.now();
  applyPace();
}

function wantedPaceName() {
  if (!game || game.won) return "idle";
  return Date.now() - lastActivity < ACTIVITY_QUIET_MS ? "interacting" : "thinking";
}

/** Schickt die passende Taktung an einen laufenden Auffüll-Auftrag. */
function applyPace() {
  const name = wantedPaceName();
  if (name === currentPaceName) return;
  currentPaceName = name;
  if (fillWorker) fillWorker.postMessage({ type: "pace", pace: PACE[name] });
}

function emptyPool() {
  const pool = {};
  for (let i = 0; i < MODE_ORDER.length; i++) pool[MODE_ORDER[i]] = [];
  return pool;
}

function loadPool() {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const pool = emptyPool();
      for (let i = 0; i < MODE_ORDER.length; i++) {
        const key = MODE_ORDER[i];
        if (!Array.isArray(parsed[key])) continue;
        // Nur was zur heutigen Brettgröße passt, wird übernommen –
        // einzelne unbrauchbare Einträge kosten nicht den ganzen Vorrat.
        pool[key] = parsed[key].filter(function (puzzle) { return fitsMode(key, puzzle); });
      }
      return pool;
    }
  } catch (e) { /* egal */ }
  return emptyPool();
}

function savePool(pool) {
  try { localStorage.setItem(POOL_KEY, JSON.stringify(pool)); } catch (e) { /* egal */ }
}

function poolCounts() {
  const pool = loadPool();
  const out = {};
  for (let i = 0; i < MODE_ORDER.length; i++) out[MODE_ORDER[i]] = pool[MODE_ORDER[i]].length;
  return out;
}

function takeFromPool(modeKey) {
  const pool = loadPool();
  const puzzle = pool[modeKey].shift();
  if (puzzle) savePool(pool);
  return puzzle || null;
}

function addToPool(modeKey, puzzle) {
  const pool = loadPool();
  if (pool[modeKey].length >= POOL_TARGET) return;
  pool[modeKey].push(puzzle);
  savePool(pool);
}

/* Wie oft eine Stufe zuletzt erfolglos gerechnet wurde. Seltene Stufen sollen
   die Warteschlange nicht dauerhaft blockieren. */
const failStreak = {};

/**
 * Die Stufe mit dem kleinsten Vorrat. Bei Gleichstand kommen die schnellen
 * Stufen zuerst – sonst blockiert ein minutenlanger 2-Sterne-Auftrag den
 * Aufbau des Grundvorrats. Erfolglose Anläufe zählen wie vorhandene Rätsel,
 * damit die Reihe rotiert.
 */
function neediestMode() {
  const counts = poolCounts();
  let best = null, bestRank = Infinity;
  for (let i = 0; i < MODE_ORDER.length; i++) {
    const key = MODE_ORDER[i];
    if (counts[key] >= POOL_TARGET) continue;
    const rank = counts[key] + (failStreak[key] || 0);
    if (
      rank < bestRank ||
      (rank === bestRank && best !== null && MODES[key].k < MODES[best].k)
    ) { bestRank = rank; best = key; }
  }
  return best;
}

/**
 * Stufen mit gleicher Brettgröße und Sternzahl. Ein Rätsel, das hier die
 * Wunschtiefe verfehlt, ist dort womöglich genau richtig.
 */
function siblingSpecs(modeKey) {
  const mode = MODES[modeKey];
  const out = [];
  for (let i = 0; i < MODE_ORDER.length; i++) {
    const other = MODES[MODE_ORDER[i]];
    if (other.key === modeKey || other.n !== mode.n || other.k !== mode.k) continue;
    out.push({
      modeKey: other.key,
      minProbes: other.spec.minProbes,
      maxProbes: other.spec.maxProbes,
    });
  }
  return out;
}

/**
 * Fordert ein Rätsel an. Jeder Auftrag bekommt einen eigenen Worker, damit
 * ein dringender Start einen laufenden Hintergrund-Auftrag nicht verwirft.
 * Dringende Anfragen dürfen zur Not ein Rätsel liefern, das die Wunschtiefe
 * verfehlt – in den Vorrat kommen nur Treffer.
 */
function requestPuzzle(modeKey, urgent) {
  const mode = MODES[modeKey];
  const spec = {
    minProbes: mode.spec.minProbes,
    maxProbes: mode.spec.maxProbes,
    strict: !urgent,
    siblings: siblingSpecs(modeKey),
  };
  const budget = urgent
    ? (mode.k === 2 ? 10000 : 6000)
    : (mode.k === 2 ? 120000 : 20000);

  return new Promise(function (resolve) {
    let w = null;
    try { w = new Worker("worker.js"); } catch (e) { w = null; }

    if (!w) {
      // Ohne Worker (etwa beim Öffnen per file://) im Hauptthread rechnen.
      // Dort sind kurze Scheiben Pflicht, sonst friert die Seite ein.
      pacer.set({ workMs: 12, restMs: 0 });
      spec.onBonus = function (bonusMode, cand) {
        addToPool(bonusMode, {
          regionOf: Array.from(cand.regionOf),
          stars: cand.stars,
          probeRounds: cand.probeRounds,
        });
      };
      generatePuzzle(mode.n, mode.k, spec, Math.min(budget, 20000)).then(function (p) {
        resolve(p ? { regionOf: Array.from(p.regionOf), stars: p.stars, probeRounds: p.probeRounds } : null);
      });
      return;
    }

    if (!urgent) {
      fillWorker = w;
      currentPaceName = null;
      applyPace();
    }

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      clearTimeout(guard);
      w.terminate();
      if (fillWorker === w) fillWorker = null;
      resolve(value);
    }
    const guard = setTimeout(function () { finish(null); }, budget + 20000);

    w.onmessage = function (e) {
      const msg = e.data;
      if (msg && msg.type === "bonus") {
        // Nebenprodukt für eine andere Stufe – der Auftrag läuft weiter.
        addToPool(msg.modeKey, {
          regionOf: msg.regionOf,
          stars: msg.stars,
          probeRounds: msg.probeRounds,
        });
        return;
      }
      finish(msg && msg.ok
        ? { regionOf: msg.regionOf, stars: msg.stars, probeRounds: msg.probeRounds }
        : null);
    };
    w.onerror = function () { finish(null); };
    w.postMessage({
      id: ++jobSeq,
      modeKey: modeKey,
      n: mode.n,
      k: mode.k,
      spec: spec,
      budget: budget,
      pace: urgent ? PACE.urgent : PACE[wantedPaceName()],
    });
  });
}

function scheduleFill(delay) {
  if (fillTimer) clearTimeout(fillTimer);
  fillTimer = setTimeout(fillLoop, delay === undefined ? 900 : delay);
}

async function fillLoop() {
  if (fillRunning) return;
  fillRunning = true;
  try {
    for (;;) {
      const modeKey = neediestMode();
      if (!modeKey) break;
      const puzzle = await requestPuzzle(modeKey, false);
      if (puzzle) {
        addToPool(modeKey, puzzle);
        failStreak[modeKey] = 0;
      } else {
        failStreak[modeKey] = (failStreak[modeKey] || 0) + 1;
      }
      // Kurz durchatmen, damit der Rechner nicht dauerhaft unter Volllast läuft.
      await new Promise(function (r) { setTimeout(r, 600); });
    }
  } finally {
    fillRunning = false;
  }
}

/** Holt ein Rätsel – bevorzugt aus dem Vorrat, sonst wird gerechnet. */
async function obtainPuzzle(modeKey) {
  const ready = takeFromPool(modeKey);
  if (ready) {
    scheduleFill();
    return ready;
  }
  const puzzle = await requestPuzzle(modeKey, true);
  scheduleFill();
  return puzzle;
}

/* ---------------------------------------------------------------
   Uhr
   --------------------------------------------------------------- */

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startTimer(initial) {
  stopTimer();
  elapsedSeconds = initial || 0;
  updateTimer();
  timerInterval = setInterval(() => {
    elapsedSeconds += 1;
    updateTimer();
    saveGame();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimer() {
  const el = document.getElementById("timer");
  if (el) el.textContent = formatTime(elapsedSeconds);
}

/* ---------------------------------------------------------------
   Brett aufbauen
   --------------------------------------------------------------- */

function buildBoard() {
  const n = game.n;
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.setProperty("--n", n);
  cellElements = new Array(n * n);

  const painted = colorRegions(n, game.regionOf);
  const colors = painted.colors;
  game.colors = colors;
  game.regionNames = painted.names;
  game.units = null;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.idx = String(idx);
      cell.style.background = colors[game.regionOf[idx]];

      const g = game.regionOf[idx];
      if (r === 0 || game.regionOf[idx - n] !== g) cell.classList.add("edge-top");
      if (r === n - 1 || game.regionOf[idx + n] !== g) cell.classList.add("edge-bottom");
      if (c === 0 || game.regionOf[idx - 1] !== g) cell.classList.add("edge-left");
      if (c === n - 1 || game.regionOf[idx + 1] !== g) cell.classList.add("edge-right");

      const mark = document.createElement("span");
      mark.className = "mark";
      cell.appendChild(mark);

      board.appendChild(cell);
      cellElements[idx] = cell;
    }
  }
  fitBoard();
}

function fitBoard() {
  if (!game) return;
  const wrap = document.getElementById("board-wrap");
  const rect = wrap.getBoundingClientRect();
  // Direkt nach dem Einblenden des Spielbildschirms kann der Bereich noch
  // ohne Maße dastehen. Dann lieber später messen, als das Brett auf die
  // Mindestgröße zu schrumpfen.
  if (rect.width < 60 || rect.height < 60) {
    requestAnimationFrame(fitBoard);
    return;
  }
  const avail = Math.min(rect.width - 24, rect.height - 24);
  const size = Math.floor(avail / game.n);
  const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, size));
  document.documentElement.style.setProperty("--cell", cell + "px");
  // Die Kontur des Sterns soll auf kleinen wie großen Brettern gleich wirken.
  document.documentElement.style.setProperty("--outline", (cell * 0.022).toFixed(2) + "px");
}

/* ---------------------------------------------------------------
   Darstellung
   --------------------------------------------------------------- */

function renderCell(idx) {
  const cell = cellElements[idx];
  if (!cell) return;
  const v = game.marks[idx];
  cell.classList.toggle("is-star", v === STAR);
  cell.classList.toggle("is-dot", v === DOT);
  cell.querySelector(".mark").textContent = v === STAR ? "★" : v === DOT ? "✕" : "";
}

function render() {
  for (let i = 0; i < game.n * game.n; i++) renderCell(i);
  updateErrors();
  updateCounters();
  flushWave();
}

/**
 * Blendet die frisch gesetzten Automatik-Kreuze als Welle ein: Je weiter ein
 * Feld vom auslösenden Stern entfernt ist, desto später erscheint es.
 * Der Spielzustand ist zu diesem Zeitpunkt längst vollständig – die Welle ist
 * reine Darstellung und beeinflusst weder Undo noch Siegprüfung.
 */
function flushWave() {
  if (!pendingWave.length) return;
  const entries = pendingWave;
  pendingWave = [];

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  const n = game.n;
  for (let i = 0; i < entries.length; i++) {
    const cell = cellElements[entries[i].idx];
    if (!cell) continue;
    const mark = cell.querySelector(".mark");
    if (!mark || !mark.animate) continue;

    const a = entries[i].idx, b = entries[i].origin;
    // Kreisförmige Ausbreitung: diagonale Nachbarn kommen minimal nach den
    // geraden, dadurch wirkt es wie eine Welle statt wie wachsende Quadrate.
    const dist = Math.hypot(((a / n) | 0) - ((b / n) | 0), (a % n) - (b % n));
    const delay = Math.round(Math.min(dist, WAVE_MAX_STEPS) * WAVE_STEP_MS);

    mark.animate(
      [
        // Der Höhenausgleich aus dem Stylesheet muss hier mitgeführt werden,
        // sonst würde die Animation ihn überschreiben.
        { transform: "translateY(-0.04em) scale(0.2)", opacity: 0 },
        { transform: "translateY(-0.04em) scale(1.18)", opacity: 1, offset: 0.65 },
        { transform: "translateY(-0.04em) scale(1)", opacity: 1 },
      ],
      { duration: WAVE_POP_MS, delay: delay, easing: "ease-out", fill: "backwards" }
    );

    cell.animate(
      [
        { filter: "brightness(1)" },
        { filter: "brightness(1.5)", offset: 0.3 },
        { filter: "brightness(1)" },
      ],
      { duration: WAVE_GLOW_MS, delay: delay, easing: "ease-out" }
    );
  }
}

function unitsOfGame() {
  if (!game.units) game.units = buildUnits(game.n, game.regionOf, game.regionNames);
  return game.units;
}

/** Sterne, die sich berühren oder eine Einheit überfüllen. */
function findErrors() {
  const bad = new Set();
  if (!settings.showErrors) return bad;
  const n = game.n, k = game.k;
  const nb = neighborTable(n);
  for (let i = 0; i < n * n; i++) {
    if (game.marks[i] !== STAR) continue;
    for (let j = 0; j < nb[i].length; j++) {
      if (game.marks[nb[i][j]] === STAR) { bad.add(i); bad.add(nb[i][j]); }
    }
  }
  const units = unitsOfGame();
  for (let u = 0; u < units.length; u++) {
    const cells = units[u].cells;
    const stars = [];
    for (let i = 0; i < cells.length; i++) if (game.marks[cells[i]] === STAR) stars.push(cells[i]);
    if (stars.length > k) for (let i = 0; i < stars.length; i++) bad.add(stars[i]);
  }
  return bad;
}

function updateErrors() {
  const bad = findErrors();
  for (let i = 0; i < game.n * game.n; i++) {
    cellElements[i].classList.toggle("is-error", bad.has(i));
  }
}

function updateCounters() {
  let stars = 0;
  for (let i = 0; i < game.n * game.n; i++) if (game.marks[i] === STAR) stars++;
  document.getElementById("star-count").textContent = String(stars);
  document.getElementById("star-total").textContent = String(game.n * game.k);
}

/* ---------------------------------------------------------------
   Züge
   --------------------------------------------------------------- */

/* Zeile, Spalte und Farbfeld, zu denen ein Feld gehört – als Index in units. */
function unitIndicesOfCell(idx) {
  const n = game.n;
  return [(idx / n) | 0, n + (idx % n), 2 * n + game.regionOf[idx]];
}

function unitIsFull(unitIndex) {
  const cells = unitsOfGame()[unitIndex].cells;
  let stars = 0;
  for (let i = 0; i < cells.length; i++) if (game.marks[cells[i]] === STAR) stars++;
  return stars >= game.k;
}

/** Setzt ein automatisches Kreuz und merkt es sich als solches. */
function markAuto(j, changes, origin) {
  changes.push({ idx: j, from: game.marks[j], to: DOT, auto: game.autoMarks[j] });
  game.marks[j] = DOT;
  game.autoMarks[j] = 1;
  pendingWave.push({ idx: j, origin: origin });
}

/**
 * Nach einem neuen Stern: Nachbarfelder abhaken – und wenn dieser Stern eine
 * Zeile, Spalte oder ein Farbfeld vollgemacht hat, auch den Rest davon.
 */
function addAutoCrosses(idx, changes) {
  const nb = neighborTable(game.n)[idx];
  for (let i = 0; i < nb.length; i++) {
    if (game.marks[nb[i]] === UNK) markAuto(nb[i], changes, idx);
  }
  const units = unitsOfGame();
  const own = unitIndicesOfCell(idx);
  for (let u = 0; u < own.length; u++) {
    if (!unitIsFull(own[u])) continue;
    const cells = units[own[u]].cells;
    for (let i = 0; i < cells.length; i++) {
      if (game.marks[cells[i]] === UNK) markAuto(cells[i], changes, idx);
    }
  }
}

/** Trägt ein automatisches Kreuz noch, oder ist sein Grund entfallen? */
function autoCrossSupported(j) {
  const nb = neighborTable(game.n)[j];
  for (let i = 0; i < nb.length; i++) if (game.marks[nb[i]] === STAR) return true;
  const own = unitIndicesOfCell(j);
  for (let u = 0; u < own.length; u++) if (unitIsFull(own[u])) return true;
  return false;
}

/** Nach dem Entfernen eines Sterns: alle Kreuze aufräumen, deren Grund wegfiel. */
function removeUnsupportedAutoCrosses(idx, changes) {
  const units = unitsOfGame();
  const candidates = new Set(neighborTable(game.n)[idx]);
  const own = unitIndicesOfCell(idx);
  for (let u = 0; u < own.length; u++) {
    const cells = units[own[u]].cells;
    for (let i = 0; i < cells.length; i++) candidates.add(cells[i]);
  }
  candidates.forEach(function (j) {
    if (!game.autoMarks[j] || game.marks[j] !== DOT) return;
    if (autoCrossSupported(j)) return;
    changes.push({ idx: j, from: DOT, to: UNK, auto: 1 });
    game.marks[j] = UNK;
    game.autoMarks[j] = 0;
  });
}

/** Setzt ein Feld und pflegt die automatischen Kreuze. Sammelt alle Änderungen. */
function setCell(idx, value, changes) {
  const prev = game.marks[idx];
  if (prev === value) return;
  changes.push({ idx: idx, from: prev, to: value, auto: game.autoMarks[idx] });
  game.marks[idx] = value;
  game.autoMarks[idx] = 0;

  if (value === STAR && settings.autoCross) addAutoCrosses(idx, changes);
  // Auch bei abgeschalteter Automatik aufräumen, sonst blieben früher
  // gesetzte Kreuze ohne Grund stehen.
  if (prev === STAR) removeUnsupportedAutoCrosses(idx, changes);
}

function nextValue(v) {
  return v === UNK ? DOT : v === STAR ? UNK : STAR;
}

function applyMove(changes) {
  if (!changes.length) return;
  game.history.push(changes);
  if (game.history.length > 400) game.history.shift();
  hideHint();
  render();
  saveGame();
  checkWin();
}

function undo() {
  if (!game || !game.history.length) return;
  const changes = game.history.pop();
  for (let i = changes.length - 1; i >= 0; i--) {
    game.marks[changes[i].idx] = changes[i].from;
    game.autoMarks[changes[i].idx] = changes[i].auto;
  }
  hideHint();
  render();
  saveGame();
}

/* ---------------------------------------------------------------
   Eingabe (Klicken und Wischen)
   --------------------------------------------------------------- */

function cellIndexFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return -1;
  const cell = el.closest(".cell");
  if (!cell) return -1;
  return Number(cell.dataset.idx);
}

function onPointerDown(e) {
  if (!game || game.won) return;
  noteActivity();
  const idx = cellIndexFromPoint(e.clientX, e.clientY);
  if (idx < 0) return;
  e.preventDefault();

  const target = e.button === 2 ? prevValue(game.marks[idx]) : nextValue(game.marks[idx]);
  const changes = [];
  setCell(idx, target, changes);
  drag = { paint: target, changes: changes, touched: new Set([idx]), lastX: e.clientX, lastY: e.clientY };
  render();
}

function prevValue(v) {
  return v === UNK ? STAR : v === STAR ? DOT : UNK;
}

function paintAt(x, y) {
  const idx = cellIndexFromPoint(x, y);
  if (idx < 0 || drag.touched.has(idx)) return false;
  drag.touched.add(idx);
  if (game.marks[idx] === drag.paint) return false;
  setCell(idx, drag.paint, drag.changes);
  return true;
}

function onPointerMove(e) {
  if (!drag) return;
  noteActivity();
  // Zwischenpunkte abtasten, sonst überspringt ein schneller Wischer Felder.
  const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell")) || 40;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (cell / 3)));
  let changed = false;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (paintAt(drag.lastX + dx * t, drag.lastY + dy * t)) changed = true;
  }
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  if (changed) render();
}

function onPointerUp() {
  if (!drag) return;
  const changes = drag.changes;
  drag = null;
  applyMove(changes);
}

/* ---------------------------------------------------------------
   Hinweis und Prüfen
   --------------------------------------------------------------- */

function showHint(text, idx, kind) {
  const el = document.getElementById("hint-text");
  el.textContent = text;
  el.classList.remove("hidden");
  clearHighlights();
  if (idx >= 0) cellElements[idx].classList.add(kind === "wrong" ? "is-wrong" : "is-hint");
  // Die Hinweiszeile nimmt dem Brett Höhe weg – sonst ragt es darüber hinaus.
  fitBoard();
}

function hideHint() {
  document.getElementById("hint-text").classList.add("hidden");
  clearHighlights();
  fitBoard();
}

function clearHighlights() {
  if (!cellElements.length) return;
  for (let i = 0; i < cellElements.length; i++) {
    if (cellElements[i]) cellElements[i].classList.remove("is-hint", "is-wrong");
  }
}

/** Erstes Feld, das der Lösung widerspricht. */
function firstMistake() {
  const solution = new Set(game.solution);
  for (let i = 0; i < game.n * game.n; i++) {
    if (game.marks[i] === STAR && !solution.has(i)) return { idx: i, kind: "star" };
  }
  for (let i = 0; i < game.n * game.n; i++) {
    if (game.marks[i] === DOT && solution.has(i)) return { idx: i, kind: "dot" };
  }
  return null;
}

function onCheck() {
  if (!game || game.won) return;
  const bad = firstMistake();
  if (!bad) {
    showHint("Bis hierher ist alles richtig.", -1, "hint");
    return;
  }
  const where = cellName(bad.idx);
  if (bad.kind === "star") showHint("Der Stern auf " + where + " gehört nicht zur Lösung.", bad.idx, "wrong");
  else showHint("Auf " + where + " steht ein Kreuz, dort gehört aber ein Stern hin.", bad.idx, "wrong");
}

function cellName(idx) {
  return "Zeile " + (Math.floor(idx / game.n) + 1) + " / Spalte " + ((idx % game.n) + 1);
}

function onHint() {
  if (!game || game.won) return;
  const bad = firstMistake();
  if (bad) {
    const where = cellName(bad.idx);
    showHint(
      bad.kind === "star"
        ? "Erst aufräumen: Der Stern auf " + where + " ist falsch."
        : "Erst aufräumen: Das Kreuz auf " + where + " ist falsch.",
      bad.idx,
      "wrong"
    );
    return;
  }

  // Nur die bereits richtig gesetzten Markierungen als bekannt annehmen.
  const grid = Uint8Array.from(game.marks);
  const step = logicNextStep(game.n, game.k, unitsOfGame(), grid);

  if (step && !step.contradiction) {
    game.hintsUsed++;
    const where = cellName(step.idx);
    showHint(
      (step.val === STAR ? "Stern auf " + where + ": " : "Kreuz auf " + where + ": ") + step.reason,
      step.idx,
      "hint"
    );
    saveGame();
    return;
  }

  // Sollte nicht vorkommen – zur Sicherheit direkt aus der Lösung zeigen.
  const solution = new Set(game.solution);
  for (let i = 0; i < game.n * game.n; i++) {
    if (game.marks[i] === UNK && solution.has(i)) {
      game.hintsUsed++;
      showHint("Auf " + cellName(i) + " gehört ein Stern.", i, "hint");
      saveGame();
      return;
    }
  }
  showHint("Es gibt nichts mehr abzuleiten.", -1, "hint");
}

/* ---------------------------------------------------------------
   Gewonnen?
   --------------------------------------------------------------- */

function isSolved() {
  const n = game.n, k = game.k;
  const solution = new Set(game.solution);
  let stars = 0;
  for (let i = 0; i < n * n; i++) {
    if (game.marks[i] !== STAR) continue;
    stars++;
    if (!solution.has(i)) return false;
  }
  return stars === n * k;
}

function checkWin() {
  if (game.won || !isSolved()) return;
  game.won = true;
  stopTimer();
  clearSave(game.k);
  recordStat(game.modeKey, "won", elapsedSeconds);

  const mode = MODES[game.modeKey];
  document.getElementById("win-text").textContent =
    mode.short + " in " + formatTime(elapsedSeconds) +
    (game.hintsUsed ? " · " + game.hintsUsed + (game.hintsUsed === 1 ? " Hinweis" : " Hinweise") : " · ohne Hinweise");
  document.getElementById("win-overlay").classList.remove("hidden");
  document.getElementById("result-btn").classList.remove("hidden");
  launchConfetti();
  applyPace();
}

function launchConfetti() {
  const layer = document.getElementById("confetti-layer");
  layer.innerHTML = "";
  const colors = ["#f2c94c", "#f2994a", "#6fcf97", "#56ccf2", "#bb6bd9"];
  for (let i = 0; i < 60; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = Math.random() * 100 + "%";
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = (Math.random() * 0.7).toFixed(2) + "s";
    bit.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + "s";
    layer.appendChild(bit);
  }
}

/* ---------------------------------------------------------------
   Spiel starten
   --------------------------------------------------------------- */

function showLoading(show, text) {
  const overlay = document.getElementById("loading-overlay");
  overlay.classList.toggle("hidden", !show);
  if (text) document.getElementById("loading-text").textContent = text;
}

async function startGame(modeKey) {
  if (generating) return;
  generating = true;
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("win-overlay").classList.add("hidden");
  stopTimer();

  const counts = poolCounts();
  const instant = counts[modeKey] > 0;
  if (!instant) {
    showLoading(true, "Der Vorrat ist noch leer – das Rätsel wird gerade berechnet …");
    // Ein Frame Pause, damit die Ladeanzeige wirklich erscheint.
    await new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); });
  }

  const puzzle = await obtainPuzzle(modeKey);
  generating = false;
  showLoading(false);

  if (!puzzle) {
    backToStart();
    showStartNotice("Es ließ sich gerade kein Rätsel erzeugen. Bitte gleich noch einmal versuchen.");
    return;
  }

  installPuzzle(modeKey, puzzle.regionOf, puzzle.stars, null);
  recordStat(modeKey, "played");
  startTimer(0);
  saveGame();
}

function installPuzzle(modeKey, regionOf, solution, saved) {
  const mode = MODES[modeKey];
  game = {
    modeKey: modeKey,
    n: mode.n,
    k: mode.k,
    regionOf: Int16Array.from(regionOf),
    solution: Array.from(solution),
    marks: new Uint8Array(mode.n * mode.n),
    autoMarks: new Uint8Array(mode.n * mode.n),
    history: [],
    hintsUsed: saved ? saved.hintsUsed || 0 : 0,
    won: false,
    units: null,
    colors: null,
    regionNames: null,
  };
  if (saved) {
    game.marks.set(saved.marks);
    game.autoMarks.set(saved.autoMarks);
  }
  pendingWave = [];
  document.getElementById("difficulty-label").textContent = mode.label;
  document.getElementById("title-stars").textContent = mode.k === 2 ? "★★" : "★";
  const screen = document.getElementById("game-screen");
  screen.classList.remove("mode-1", "mode-2");
  screen.classList.add("mode-" + mode.k);
  document.getElementById("result-btn").classList.add("hidden");
  hideHint();
  buildBoard();
  render();
  applyPace();
}

function resumeGame(starCount) {
  const saved = loadSave(starCount);
  if (!saved || !MODES[saved.modeKey]) return;
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  installPuzzle(saved.modeKey, saved.regionOf, saved.solution, saved);
  startTimer(saved.elapsedSeconds || 0);
}

function backToStart() {
  stopTimer();
  game = null;
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("win-overlay").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  showStartNotice("");
  refreshStartScreen();
  applyPace();
}

/* ---------------------------------------------------------------
   Startbildschirm
   --------------------------------------------------------------- */

function showStartNotice(text) {
  const el = document.getElementById("start-notice");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

/** Vorrats-Anzeige an den Stufen-Schaltflächen und in der Statuszeile. */
function refreshStartScreen() {
  const stats = loadStats();
  const rows = [
    ["Gespielt", (e) => String(e.played)],
    ["Gewonnen", (e) => String(e.won)],
    ["Bestzeit", (e) => (e.best === null ? "–" : formatTime(e.best))],
  ];

  const tables = document.querySelectorAll(".stats-table");
  for (let t = 0; t < tables.length; t++) {
    const starCount = Number(tables[t].dataset.stars);
    const modes = MODE_ORDER.filter((key) => MODES[key].k === starCount);
    const body = tables[t].querySelector("tbody");
    body.innerHTML = "";
    for (let i = 0; i < rows.length; i++) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = rows[i][0];
      tr.appendChild(th);
      for (let m = 0; m < modes.length; m++) {
        const td = document.createElement("td");
        const entry = stats[modes[m]] || { played: 0, won: 0, best: null };
        td.textContent = rows[i][1](entry);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  const saves = loadSaves();
  const buttons = document.querySelectorAll(".continue-btn");
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const saved = saves[Number(btn.dataset.stars)];
    if (saved && MODES[saved.modeKey]) {
      btn.classList.remove("hidden");
      btn.querySelector(".continue-btn-sub").textContent =
        MODES[saved.modeKey].label + " · " + formatTime(saved.elapsedSeconds || 0);
    } else {
      btn.classList.add("hidden");
    }
  }

}

/* ---------------------------------------------------------------
   Verdrahtung
   --------------------------------------------------------------- */

function syncSettingsUI() {
  document.getElementById("opt-autocross").checked = settings.autoCross;
  document.getElementById("opt-errors").checked = settings.showErrors;
}

function init() {
  loadSettings();
  syncSettingsUI();
  refreshStartScreen();
  scheduleFill(600);

  const startButtons = document.querySelectorAll(".start-btn");
  for (let i = 0; i < startButtons.length; i++) {
    startButtons[i].addEventListener("click", () => startGame(startButtons[i].dataset.mode));
  }
  const winButtons = document.querySelectorAll(".win-diff-btn");
  for (let i = 0; i < winButtons.length; i++) {
    winButtons[i].addEventListener("click", () => startGame(winButtons[i].dataset.mode));
  }

  const continueButtons = document.querySelectorAll(".continue-btn");
  for (let i = 0; i < continueButtons.length; i++) {
    continueButtons[i].addEventListener("click", function () {
      resumeGame(Number(this.dataset.stars));
    });
  }
  // Der Spielstand bleibt erhalten: Auf dem Startbildschirm lässt sich die
  // angefangene Partie über "Spiel fortsetzen" zurückholen.
  document.getElementById("new-game-btn").addEventListener("click", backToStart);
  // Der Titel im Kopf führt ebenfalls zurück auf die Übersicht.
  document.getElementById("game-title").addEventListener("click", backToStart);
  document.getElementById("undo-btn").addEventListener("click", undo);
  // Nach dem Sieg lässt sich das fertige Brett ansehen und die Auswertung
  // jederzeit zurückholen.
  document.getElementById("win-back").addEventListener("click", function () {
    document.getElementById("win-overlay").classList.add("hidden");
  });
  document.getElementById("result-btn").addEventListener("click", function () {
    document.getElementById("win-overlay").classList.remove("hidden");
  });
  document.getElementById("hint-btn").addEventListener("click", onHint);
  document.getElementById("check-btn").addEventListener("click", onCheck);

  document.getElementById("stats-reset").addEventListener("click", () => {
    saveStats({});
    refreshStartScreen();
  });

  const panel = document.getElementById("settings-panel");
  document.getElementById("settings-btn").addEventListener("click", () => panel.classList.remove("hidden"));
  document.getElementById("settings-close").addEventListener("click", () => panel.classList.add("hidden"));
  panel.addEventListener("click", (e) => { if (e.target === panel) panel.classList.add("hidden"); });

  document.getElementById("opt-autocross").addEventListener("change", (e) => {
    settings.autoCross = e.target.checked; saveSettings();
  });
  document.getElementById("opt-errors").addEventListener("change", (e) => {
    settings.showErrors = e.target.checked; saveSettings(); if (game) render();
  });

  const board = document.getElementById("board");
  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("resize", fitBoard);
  // Nach der letzten Eingabe muss die Taktung von selbst wieder anziehen.
  setInterval(applyPace, 500);
  document.addEventListener("keydown", (e) => {
    noteActivity();
    if (e.key === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    if (e.key === "Escape") panel.classList.add("hidden");
  });
}

document.addEventListener("DOMContentLoaded", init);
