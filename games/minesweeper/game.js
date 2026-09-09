"use strict";

/* =====================================================================
   Minesweeper · Spiellogik und Oberfläche

   Sechs Stufen: je Mittel, Schwer und Extrem, einmal klassisch und einmal
   mit der Zusage, dass sich das Brett ohne Raten lösen lässt. Die
   Fundstellen werden erst nach dem ersten Klick verteilt – nur dann lässt
   sich überhaupt zusichern, dass dieser Klick sicher ist.

   Extrem unterscheidet sich nicht durch Größe, sondern durch `tiefe`: So
   viele Schritte muss ein Brett verlangen, die sich nicht aus einer
   einzelnen Zahl ergeben, sondern erst aus dem Vergleich zweier Zahlen.

   Ein zufällig gestreutes Brett kommt auf etwa sieben solcher Stellen bei
   über hundert Klicks – der Rest ist Abarbeiten, und daran ändert ein
   größeres Feld nichts, es wird nur länger. Achtzig geforderte Stellen auf
   dem kleineren Brett drehen das Verhältnis um: Rund jede dritte
   Entscheidung verlangt dann, zwei Zahlen gegeneinander zu halten.

   Solche Bretter findet man nicht durch Würfeln, sie sind zu selten. Der
   Generator sucht sie (siehe makeDeepBoard) und braucht dafür ein paar
   Sekunden – die einzige Stelle im Spiel, an der man kurz wartet.
   ===================================================================== */

const MODES = {
  km: { key: "km", group: "classic", label: "Mittel", rows: 16, cols: 16, mines: 40, noGuess: false },
  kh: { key: "kh", group: "classic", label: "Schwer", rows: 16, cols: 24, mines: 75, noGuess: false },
  ke: { key: "ke", group: "classic", label: "Extrem", rows: 16, cols: 30, mines: 112, noGuess: false, tiefe: 80 },
  nm: { key: "nm", group: "noguess", label: "Mittel", rows: 16, cols: 16, mines: 40, noGuess: true },
  nh: { key: "nh", group: "noguess", label: "Schwer", rows: 16, cols: 24, mines: 75, noGuess: true },
  ne: { key: "ne", group: "noguess", label: "Extrem", rows: 16, cols: 30, mines: 112, noGuess: true, tiefe: 80 },
};
const MODE_ORDER = ["km", "kh", "ke", "nm", "nh", "ne"];
const GROUP_LABEL = { classic: "Klassisch", noguess: "Ohne Raten" };

const SAVE_KEY = "minesweeperSave";
const STATS_KEY = "minesweeperStats";

const CELL_MIN = 16;
const CELL_MAX = 44;
/* Beim Zoomen darf das Feld kleiner und größer werden als die Automatik
   von sich aus wählt – sonst hätte das Mausrad auf großen Brettern nach
   einer Stufe nichts mehr zu tun. */
const ZOOM_MIN = 10;
const ZOOM_MAX = 96;
const ZOOM_SCHRITT = 1.12;

/* Müssen zu den Werten in style.css passen. */
const BOARD_GAP = 2;
const BOARD_PAD = 8;
const BOARD_BORDER = 1;

/* Feldzustand */
const HIDDEN = 0, OPEN = 1, FLAG = 2;

let game = null;
let cellElements = [];
let timerInterval = null;
let elapsedSeconds = 0;
let fitRetry = null;
let vorbereitend = false;   // während das Brett gewürfelt wird
/* Mausrad-Zoom als Faktor auf die selbst berechnete Feldgröße. */
let zoomFaktor = 1;
/* Gezoomt wird nur bei gedrückter Leertaste: Das Rad allein liegt zu nah an
   der mittleren Maustaste, mit der die umliegenden Felder geöffnet werden. */
let leertasteGedrueckt = false;

/* ---------------------------------------------------------------
   Speicher
   --------------------------------------------------------------- */

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

function statsFor(modeKey) {
  const s = loadStats();
  return s[modeKey] || { played: 0, won: 0, best: null };
}

function recordPlayed(modeKey) {
  const s = loadStats();
  const e = s[modeKey] || { played: 0, won: 0, best: null };
  e.played += 1;
  s[modeKey] = e;
  saveStats(s);
}

function recordWon(modeKey, seconds) {
  const s = loadStats();
  const e = s[modeKey] || { played: 0, won: 0, best: null };
  e.won += 1;
  if (e.best === null || seconds < e.best) e.best = seconds;
  s[modeKey] = e;
  saveStats(s);
}

function saveGame() {
  if (!game || game.over) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      modeKey: game.modeKey,
      placed: game.placed,
      mine: Array.from(game.mine),
      state: Array.from(game.state),
      schonVerloren: !!game.schonVerloren,
      elapsedSeconds: elapsedSeconds,
    }));
  } catch (e) { /* egal */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (!s) return null;
    const mode = MODES[s.modeKey];
    // Ändert sich eine Stufe, passt ein alter Stand nicht mehr dazu.
    if (!mode) return null;
    const cells = mode.rows * mode.cols;
    if (!Array.isArray(s.mine) || s.mine.length !== cells) return null;
    if (!Array.isArray(s.state) || s.state.length !== cells) return null;
    return s;
  } catch (e) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* egal */ }
}

/* ---------------------------------------------------------------
   Uhr
   --------------------------------------------------------------- */

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startTimer(initial) {
  stopTimer();
  elapsedSeconds = initial || 0;
  updateTimer();
  timerInterval = setInterval(function () {
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
   Brett
   --------------------------------------------------------------- */

let neighbors = null;

function newGame(modeKey) {
  const mode = MODES[modeKey];
  game = {
    modeKey: modeKey,
    rows: mode.rows,
    cols: mode.cols,
    mines: mode.mines,
    noGuess: mode.noGuess,
    placed: false,
    mine: new Uint8Array(mode.rows * mode.cols),
    state: new Uint8Array(mode.rows * mode.cols),
    over: false,
    won: false,
    hitIndex: -1,
    /* Einmal hineingetreten, bleibt die Partie verloren – auch wenn man
       weiterspielt und das Brett am Ende doch noch aufräumt. */
    schonVerloren: false,
  };
  zoomFaktor = 1;
  neighbors = buildNeighbors(mode.rows, mode.cols);
}

function countAround(idx) {
  const nb = neighbors[idx];
  let n = 0;
  for (let i = 0; i < nb.length; i++) if (game.mine[nb[i]]) n++;
  return n;
}

function flagsAround(idx) {
  const nb = neighbors[idx];
  let n = 0;
  for (let i = 0; i < nb.length; i++) if (game.state[nb[i]] === FLAG) n++;
  return n;
}

function countFlags() {
  let n = 0;
  for (let i = 0; i < game.state.length; i++) if (game.state[i] === FLAG) n++;
  return n;
}

/* ---------------------------------------------------------------
   Aufdecken
   --------------------------------------------------------------- */

function revealFrom(idx) {
  const stack = [idx];
  while (stack.length) {
    const cur = stack.pop();
    if (game.state[cur] !== HIDDEN) continue;
    game.state[cur] = OPEN;
    if (game.mine[cur]) continue;
    if (countAround(cur) !== 0) continue;
    const nb = neighbors[cur];
    for (let i = 0; i < nb.length; i++) {
      if (game.state[nb[i]] === HIDDEN) stack.push(nb[i]);
    }
  }
}

/**
 * Der erste Klick legt das Brett fest. Im Modus ohne Raten wird so lange
 * neu gewürfelt, bis sich das Ergebnis vollständig herleiten lässt.
 */
async function prepareBoard(startIndex) {
  const partie = game;
  vorbereitend = true;
  let board = null;
  const mode = MODES[game.modeKey];
  if (game.noGuess || mode.tiefe) {
    setStatus("Brett wird vorbereitet …");
    // Auf Extrem wird das Brett nicht nur gewürfelt, sondern schrittweise
    // verbessert – das dauert im Mittel zwei Sekunden. Das Budget ist die
    // Notbremse für langsamere Rechner, nicht der Normalfall.
    //
    // So lange muss die Zeile sich rühren, sonst sieht sie aus, als hinge sie.
    let letzterPunkt = 0;
    let punkte = 0;
    board = await makeDeepBoard(game.rows, game.cols, game.mines, startIndex, {
      noGuess: game.noGuess,
      zielTiefe: mode.tiefe || 0,
      timeBudgetMs: 8000,
      onProgress: function () {
        const jetzt = Date.now();
        if (jetzt - letzterPunkt < 300) return;
        letzterPunkt = jetzt;
        punkte = (punkte + 1) % 4;
        setStatus("Brett wird vorbereitet " + "·".repeat(punkte + 1));
      },
    });
  }
  if (game !== partie) { vorbereitend = false; return; }
  if (!board) {
    // Klassisch ohne Anspruch an die Tiefe – und Rückfall, falls die Suche
    // erfolglos bleibt.
    board = makeClassicBoard(game.rows, game.cols, game.mines, startIndex);
  }
  game.mine.set(board.mine);
  game.placed = true;
  vorbereitend = false;
  setStatus("");
  startTimer(0);
  recordPlayed(game.modeKey);
}

async function reveal(idx) {
  if (!game || game.over || vorbereitend) return;
  if (game.state[idx] !== HIDDEN) return;

  if (!game.placed) {
    // Während des Wartens auf das Brett kann eine neue Partie begonnen worden
    // sein – dann gehört dieser Klick nicht mehr zum aktuellen Spiel.
    const partie = game;
    await prepareBoard(idx);
    if (game !== partie || game.over || game.state[idx] !== HIDDEN) return;
  }

  if (game.mine[idx]) {
    game.state[idx] = OPEN;
    game.hitIndex = idx;
    endGame(false);
    return;
  }

  revealFrom(idx);
  render();
  checkWin();
  saveGame();
}

/**
 * Mittlere Maustaste: Sind rund um eine Zahl bereits so viele Markierungen
 * gesetzt, wie die Zahl angibt, werden alle übrigen Nachbarn aufgedeckt.
 * Steckt eine Markierung falsch, geht das schief – wie im Original.
 */
function chord(idx) {
  if (!game || game.over || vorbereitend) return;
  if (game.state[idx] !== OPEN || game.mine[idx]) return;
  const zahl = countAround(idx);
  if (zahl === 0 || flagsAround(idx) !== zahl) {
    flashCell(idx);
    return;
  }

  const nb = neighbors[idx];
  const zuOeffnen = [];
  for (let i = 0; i < nb.length; i++) {
    if (game.state[nb[i]] === HIDDEN) zuOeffnen.push(nb[i]);
  }
  if (!zuOeffnen.length) return;

  for (let i = 0; i < zuOeffnen.length; i++) {
    if (game.mine[zuOeffnen[i]]) {
      game.state[zuOeffnen[i]] = OPEN;
      game.hitIndex = zuOeffnen[i];
      endGame(false);
      return;
    }
  }
  for (let i = 0; i < zuOeffnen.length; i++) revealFrom(zuOeffnen[i]);
  render();
  checkWin();
  saveGame();
}

function toggleFlag(idx) {
  if (!game || game.over || vorbereitend) return;
  if (game.state[idx] === OPEN) return;
  game.state[idx] = game.state[idx] === FLAG ? HIDDEN : FLAG;
  render();
  saveGame();
}

/* ---------------------------------------------------------------
   Spielende
   --------------------------------------------------------------- */

function checkWin() {
  if (game.over) return;
  let versteckt = 0;
  for (let i = 0; i < game.state.length; i++) {
    if (game.state[i] !== OPEN && !game.mine[i]) versteckt++;
  }
  if (versteckt === 0) endGame(true);
}

function endGame(won) {
  game.over = true;
  game.won = won;
  stopTimer();
  clearSave();

  if (!won) game.schonVerloren = true;

  if (won) {
    // Wer nach einem Fehltritt weitergespielt hat, gewinnt die Partie nicht
    // mehr zurück: Sie ist bereits als verloren verbucht und bleibt es.
    if (!game.schonVerloren) recordWon(game.modeKey, elapsedSeconds);
    for (let i = 0; i < game.mine.length; i++) {
      if (game.mine[i] && game.state[i] !== FLAG) game.state[i] = FLAG;
    }
    render();
    victorySweep();
  } else {
    render();
  }
  showEnd(won);
}

/* ---------------------------------------------------------------
   Darstellung
   --------------------------------------------------------------- */

function buildBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.setProperty("--cols", game.cols);
  cellElements = new Array(game.rows * game.cols);

  for (let i = 0; i < game.rows * game.cols; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.idx = String(i);
    const mark = document.createElement("span");
    mark.className = "mark";
    cell.appendChild(mark);
    board.appendChild(cell);
    cellElements[i] = cell;
  }
  fitBoard();
}

function fitBoard() {
  if (!game) return;
  const wrap = document.getElementById("board-wrap");
  const rect = wrap.getBoundingClientRect();
  // Vor dem ersten Layout hat der Bereich noch keine Maße. Der Timer greift
  // auch dann, wenn gerade kein Bild aufgebaut wird.
  if (rect.width < 60 || rect.height < 60) {
    if (!fitRetry) {
      fitRetry = setTimeout(function () { fitRetry = null; fitBoard(); }, 60);
    }
    return;
  }
  // Abstände, Innenrand und Rahmen gehören mit in die Rechnung, sonst wird
  // das Brett zu groß und läuft über seinen Bereich hinaus.
  const chrome = 2 * (BOARD_PAD + BOARD_BORDER);
  const platzX = rect.width - 24 - chrome - (game.cols - 1) * BOARD_GAP;
  const platzY = rect.height - 24 - chrome - (game.rows - 1) * BOARD_GAP;
  const size = Math.floor(Math.min(platzX / game.cols, platzY / game.rows));
  const passend = Math.max(CELL_MIN, Math.min(CELL_MAX, size));
  const cell = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(passend * zoomFaktor)));
  document.documentElement.style.setProperty("--cell", cell + "px");
}

function renderCell(i) {
  const cell = cellElements[i];
  if (!cell) return;
  const mark = cell.querySelector(".mark");
  const st = game.state[i];

  cell.className = "cell";
  mark.textContent = "";

  if (st === FLAG) {
    cell.classList.add("is-flag");
    mark.textContent = "◆";
    // Nach einer Niederlage zeigt sich, welche Markierung danebenlag.
    if (game.over && !game.won && !game.mine[i]) cell.classList.add("is-wrong");
    return;
  }

  if (st !== OPEN) {
    // Nach einer Niederlage werden die übrigen Fundstellen aufgedeckt.
    if (game.over && !game.won && game.mine[i]) {
      cell.classList.add("is-open", "is-mine");
      mark.textContent = "◈";
    }
    return;
  }

  cell.classList.add("is-open");
  if (game.mine[i]) {
    cell.classList.add("is-mine");
    if (i === game.hitIndex) cell.classList.add("is-hit");
    mark.textContent = "◈";
    return;
  }
  const n = countAround(i);
  if (n > 0) {
    mark.textContent = String(n);
    cell.classList.add("n" + n);
  }
}

function render() {
  for (let i = 0; i < game.state.length; i++) renderCell(i);
  updateCounters();
}

function updateCounters() {
  const sicher = game.rows * game.cols - game.mines;
  let offen = 0;
  for (let i = 0; i < game.state.length; i++) {
    if (game.state[i] === OPEN && !game.mine[i]) offen++;
  }
  document.getElementById("open-total").textContent = String(sicher);
  document.getElementById("open-count").textContent = String(offen);
  document.getElementById("mine-total").textContent = String(game.mines);
  document.getElementById("flag-count").textContent = String(countFlags());
}

/** Kurzes Aufblitzen, wenn ein Zug nicht möglich ist. */
function flashCell(idx) {
  const cell = cellElements[idx];
  if (!cell || !cell.animate) return;
  cell.animate(
    [{ filter: "brightness(1)" }, { filter: "brightness(1.6)", offset: 0.4 }, { filter: "brightness(1)" }],
    { duration: 260, easing: "ease-out" }
  );
}

/**
 * Siegesanimation: Die Fundstellen leuchten der Reihe nach von der Mitte
 * nach außen auf – danach erscheint die Auswertung.
 */
function victorySweep() {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mitteR = (game.rows - 1) / 2, mitteC = (game.cols - 1) / 2;

  for (let i = 0; i < game.mine.length; i++) {
    if (!game.mine[i]) continue;
    const cell = cellElements[i];
    if (!cell || !cell.animate) continue;
    const r = Math.floor(i / game.cols), c = i % game.cols;
    const delay = reduced ? 0 : Math.round(Math.hypot(r - mitteR, c - mitteC) * 55);

    cell.querySelector(".mark").animate(
      [
        { transform: "scale(0.4)", opacity: 0.2 },
        { transform: "scale(1.35)", opacity: 1, offset: 0.55 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 520, delay: delay, easing: "ease-out", fill: "backwards" }
    );
    cell.animate(
      [
        { filter: "brightness(1)" },
        { filter: "brightness(1.85)", offset: 0.35 },
        { filter: "brightness(1)" },
      ],
      { duration: 700, delay: delay, easing: "ease-out" }
    );
  }
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

function showEnd(won) {
  const overlay = document.getElementById("end-overlay");
  const mode = MODES[game.modeKey];
  overlay.classList.toggle("is-loss", !won);
  document.getElementById("end-title").textContent = won ? "Geschafft!" : "Erwischt";
  document.getElementById("end-text").textContent = won
    ? (game.schonVerloren
        ? "Brett gelöst – gewertet bleibt die Partie aber als verloren."
        : GROUP_LABEL[mode.group] + " · " + mode.label + " in " + formatTime(elapsedSeconds))
    : "Eine Fundstelle zu früh erwischt. Nach " + formatTime(elapsedSeconds) + " ist Schluss.";

  document.getElementById("result-btn").classList.remove("hidden");
  // Weiterspielen gibt es nur nach einem Fehltritt – nach dem Sieg ist nichts
  // mehr fortzusetzen.
  document.getElementById("continue-loss-btn").classList.toggle("hidden", won);

  // Bei einem Sieg darf die Welle erst durchlaufen.
  setTimeout(function () {
    overlay.classList.remove("hidden");
    if (won) launchConfetti();
  }, won ? 900 : 350);
}

function setStatus(text) {
  const el = document.getElementById("status-text");
  // Ein geschütztes Leerzeichen hält die Zeile exakt so hoch wie mit Text.
  // Sonst rückt das Brett beim Ausblenden um ein paar Pixel nach – genau der
  // Sprung, der beim ersten Klick auffiel.
  el.textContent = text || " ";
  el.classList.toggle("is-empty", !text);
}

/* ---------------------------------------------------------------
   Eingabe
   --------------------------------------------------------------- */

function cellIndexFrom(target) {
  const cell = target.closest ? target.closest(".cell") : null;
  return cell ? Number(cell.dataset.idx) : -1;
}

function onMouseDown(e) {
  if (!game) return;
  const idx = cellIndexFrom(e.target);
  if (idx < 0) return;
  e.preventDefault();

  if (e.button === 0) reveal(idx);
  else if (e.button === 2) toggleFlag(idx);
  else if (e.button === 1) chord(idx);
}

/* Auf Touchgeräten ersetzt langes Drücken den Rechtsklick. */
let touchTimer = null;
let touchIndex = -1;

function onTouchStart(e) {
  if (!game || e.touches.length !== 1) return;
  const idx = cellIndexFrom(e.target);
  if (idx < 0) return;
  touchIndex = idx;
  touchTimer = setTimeout(function () {
    touchTimer = null;
    toggleFlag(idx);
  }, 420);
}

function onTouchEnd(e) {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
    if (touchIndex >= 0) {
      // Kurzes Tippen: aufdecken, oder auf einer fertigen Zahl die Nachbarn.
      if (game.state[touchIndex] === OPEN) chord(touchIndex);
      else reveal(touchIndex);
      e.preventDefault();
    }
  }
  touchIndex = -1;
}

/* ---------------------------------------------------------------
   Bildschirme
   --------------------------------------------------------------- */

function showGameScreen(modeKey) {
  const mode = MODES[modeKey];
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("result-btn").classList.add("hidden");
  document.getElementById("mode-label").textContent =
    (mode.group === "noguess" ? "✓ " : "") + mode.label;
}

function startNew(modeKey) {
  const key = MODES[modeKey] ? modeKey : (game ? game.modeKey : "km");
  stopTimer();
  vorbereitend = false;
  newGame(key);
  showGameScreen(key);
  buildBoard();
  render();
  elapsedSeconds = 0;
  updateTimer();
  setStatus(MODES[key].noGuess
    ? "Der erste Klick ist sicher – danach ist das Brett ohne Raten lösbar."
    : "Der erste Klick ist immer sicher.");
}

function resumeGame() {
  const saved = loadSave();
  if (!saved) return;
  stopTimer();
  vorbereitend = false;
  newGame(saved.modeKey);
  game.placed = saved.placed;
  game.mine.set(saved.mine);
  game.state.set(saved.state);
  game.schonVerloren = !!saved.schonVerloren;
  showGameScreen(saved.modeKey);
  buildBoard();
  render();
  setStatus("");
  startTimer(saved.elapsedSeconds || 0);
}

/**
 * Nach einem Fehltritt weitermachen.
 *
 * Die Partie bleibt als verloren gewertet – auch beim zweiten und dritten
 * Mal, denn `schonVerloren` wird nur gesetzt, nie zurückgenommen. Das
 * getroffene Feld wird markiert: Dass dort eine Fundstelle liegt, hat man ja
 * gerade gesehen, und ohne Markierung tritt man beim Aufräumen erneut hinein.
 */
function weiterspielen() {
  if (!game || !game.over || game.won) return;
  if (game.hitIndex >= 0) game.state[game.hitIndex] = FLAG;
  game.hitIndex = -1;
  game.over = false;
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("result-btn").classList.add("hidden");
  render();
  startTimer(elapsedSeconds);
  saveGame();
}

function backToStart() {
  stopTimer();
  saveGame();
  game = null;
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  refreshStartScreen();
}

function refreshStartScreen() {
  const zeilen = [
    ["Gespielt", function (e) { return String(e.played); }],
    ["Gewonnen", function (e) { return String(e.won); }],
    ["Bestzeit", function (e) { return e.best === null ? "–" : formatTime(e.best); }],
  ];

  const tabellen = document.querySelectorAll(".stats-table");
  for (let t = 0; t < tabellen.length; t++) {
    const gruppe = tabellen[t].dataset.group;
    const modi = MODE_ORDER.filter(function (k) { return MODES[k].group === gruppe; });
    const body = tabellen[t].querySelector("tbody");
    body.innerHTML = "";
    for (let i = 0; i < zeilen.length; i++) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = zeilen[i][0];
      tr.appendChild(th);
      for (let m = 0; m < modi.length; m++) {
        const td = document.createElement("td");
        td.textContent = zeilen[i][1](statsFor(modi[m]));
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  const saved = loadSave();
  const btn = document.getElementById("continue-btn");
  if (saved && MODES[saved.modeKey]) {
    const mode = MODES[saved.modeKey];
    let offen = 0;
    for (let i = 0; i < saved.state.length; i++) if (saved.state[i] === OPEN) offen++;
    btn.classList.remove("hidden");
    document.getElementById("continue-meta").textContent =
      GROUP_LABEL[mode.group] + " · " + mode.label + " · " +
      formatTime(saved.elapsedSeconds || 0) + " · " + offen + " Felder offen";
  } else {
    btn.classList.add("hidden");
  }
}

/* ---------------------------------------------------------------
   Verdrahtung
   --------------------------------------------------------------- */

function init() {
  refreshStartScreen();

  const startButtons = document.querySelectorAll(".start-btn");
  for (let i = 0; i < startButtons.length; i++) {
    startButtons[i].addEventListener("click", function () { startNew(this.dataset.mode); });
  }
  const endButtons = document.querySelectorAll(".end-mode-btn");
  for (let i = 0; i < endButtons.length; i++) {
    endButtons[i].addEventListener("click", function () { startNew(this.dataset.mode); });
  }

  document.getElementById("continue-btn").addEventListener("click", resumeGame);
  document.getElementById("continue-loss-btn").addEventListener("click", weiterspielen);
  document.getElementById("restart-btn").addEventListener("click", function () { startNew(null); });
  document.getElementById("back-btn").addEventListener("click", backToStart);
  // Der Titel im Kopf führt ebenfalls zurück auf die Übersicht.
  document.getElementById("game-title").addEventListener("click", backToStart);
  document.getElementById("stats-reset").addEventListener("click", function () {
    saveStats({});
    refreshStartScreen();
  });

  document.getElementById("end-back").addEventListener("click", function () {
    document.getElementById("end-overlay").classList.add("hidden");
  });
  document.getElementById("result-btn").addEventListener("click", function () {
    document.getElementById("end-overlay").classList.remove("hidden");
  });

  const board = document.getElementById("board");
  board.addEventListener("mousedown", onMouseDown);
  board.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // Der Browser scrollt sonst beim Klick mit der mittleren Maustaste.
  board.addEventListener("auxclick", function (e) { e.preventDefault(); });
  board.addEventListener("touchstart", onTouchStart, { passive: true });
  board.addEventListener("touchend", onTouchEnd);

  window.addEventListener("resize", fitBoard);

  // Leertaste halten und drehen zoomt. Ohne die Taste bleibt das Rad, was es
  // war – wer die mittlere Maustaste zum Öffnen benutzt, dreht sonst
  // versehentlich am Brett.
  document.getElementById("board-wrap").addEventListener("wheel", function (e) {
    if (!leertasteGedrueckt) return;
    e.preventDefault();
    const richtung = e.deltaY < 0 ? ZOOM_SCHRITT : 1 / ZOOM_SCHRITT;
    zoomFaktor = Math.max(0.4, Math.min(4, zoomFaktor * richtung));
    fitBoard();
  }, { passive: false });

  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space") return;
    // Liegt der Fokus auf einem Knopf, gehört die Leertaste dorthin.
    const ziel = document.activeElement;
    if (ziel && /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(ziel.tagName)) return;
    leertasteGedrueckt = true;
    // Sonst springt die Seite beim Halten nach unten.
    e.preventDefault();
  });

  document.addEventListener("keyup", function (e) {
    if (e.code === "Space") leertasteGedrueckt = false;
  });

  // Wer mit gedrückter Taste das Fenster wechselt, käme sonst nie wieder heraus.
  window.addEventListener("blur", function () { leertasteGedrueckt = false; });
}

document.addEventListener("DOMContentLoaded", init);
