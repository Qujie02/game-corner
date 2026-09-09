"use strict";

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUIT_INFO = {
  "♠": { color: "black" },
  "♥": { color: "red" },
  "♦": { color: "red" },
  "♣": { color: "black" },
};
const SUITS_BY_DIFFICULTY = {
  1: ["♠"],
  2: ["♠", "♥"],
  4: ["♠", "♥", "♦", "♣"],
};
const NUM_COLUMNS = 10;
const TOTAL_CARDS = 104;

const BASE_CARD_W = 92;
const BASE_CARD_H = 128;
const BASE_GAP = 14;
const BASE_OFFSET_DOWN = 9;
const BASE_OFFSET_UP = 25;
const FLY_MS = 520;
const DRAG_THRESHOLD = 5;
const SIZE_STEP = 1.1;
/* Auf dem Handy müssen zehn Spalten auf 375 Pixel passen – dafür braucht es
   deutlich kleinere Karten, als man am Rechner je einstellen würde. */
const SIZE_MIN = 0.25;
const SIZE_MAX = 1.8;
/* Bis zu dieser Fensterbreite gilt die Handy-Ansicht – oder bis zu dieser
   Höhe, denn im Querformat ist ein Telefon breit, aber flach. */
const HANDY_BREITE = 720;
const HANDY_HOEHE = 520;

let sizeScale = 1;
/* Solange wahr, bestimmt das Fenster die Kartengröße. Wer +/− antippt,
   übernimmt selbst; "100%" gibt die Führung zurück. */
let autoGroesse = true;
let CARD_W = BASE_CARD_W;
let CARD_H = BASE_CARD_H;
let GAP = BASE_GAP;
let OFFSET_DOWN = BASE_OFFSET_DOWN;
let OFFSET_UP = BASE_OFFSET_UP;

const DIFFICULTY_LABELS = { 1: "Leicht", 2: "Mittel", 4: "Schwer" };

let state = null;
let currentDifficulty = 1;
/* Ob aussichtslose Blätter aussortiert werden sollen. */
let loesbarModus = false;
/* Aussortiert wird nur hier: Mit einer Farbe ist ohnehin praktisch jedes
   Blatt zu schaffen (gemessen 200 von 200), und vier Farben sollen schwer
   bleiben. Bei zwei Farben sind es 98 von 100 – die restlichen zwei fängt
   der Filter ab. */
const LOESBAR_GRAD = 2;
const cardElements = new Map();
const slotElements = [];
let drag = null;
let timerInterval = null;
let elapsedSeconds = 0;

function applySizeScale(scale) {
  sizeScale = Math.min(SIZE_MAX, Math.max(SIZE_MIN, scale));
  CARD_W = Math.round(BASE_CARD_W * sizeScale);
  CARD_H = Math.round(BASE_CARD_H * sizeScale);
  GAP = Math.round(BASE_GAP * sizeScale);
  OFFSET_DOWN = Math.round(BASE_OFFSET_DOWN * sizeScale);
  OFFSET_UP = Math.round(BASE_OFFSET_UP * sizeScale);
  document.documentElement.style.setProperty("--card-w", CARD_W + "px");
  document.documentElement.style.setProperty("--card-h", CARD_H + "px");
  document.documentElement.style.setProperty("--card-gap", GAP + "px");
  const resetBtn = document.getElementById("size-reset");
  if (resetBtn) resetBtn.textContent = Math.round(sizeScale * 100) + "%";
  if (state) render();
}

function handyAnsicht() {
  const d = document.documentElement;
  return d.clientWidth <= HANDY_BREITE || d.clientHeight <= HANDY_HOEHE;
}

/**
 * Wählt die Kartengröße so, dass alle zehn Spalten nebeneinander passen.
 *
 * Auf einem Telefon ist seitliches Schieben das Schlimmste, was man einem
 * Kartenspiel antun kann: Man verliert ständig die Übersicht, welche Spalte
 * gerade wohin gehört. Lieber kleine Karten und alles im Blick.
 */
function passeGroesseAnFenster() {
  if (!autoGroesse) return;

  // In einem verborgenen Tab meldet der Browser Breite und Höhe als Null.
  // Dann später noch einmal messen – sonst schrumpfen die Karten auf die
  // kleinstmögliche Größe und bleiben so, bis jemand den Regler anfasst.
  const d = document.documentElement;
  if (d.clientWidth === 0 || d.clientHeight === 0) {
    requestAnimationFrame(passeGroesseAnFenster);
    return;
  }

  if (!handyAnsicht()) { applySizeScale(1); return; }
  const rand = 2 * 8;   /* --frame-margin in der Handy-Ansicht */
  const nachBreite = (d.clientWidth - rand) / (NUM_COLUMNS * BASE_CARD_W + (NUM_COLUMNS - 1) * BASE_GAP);

  // Im Querformat ist nicht die Breite knapp, sondern die Höhe: Es soll eine
  // Spalte von etwa zehn Karten hineinpassen, ohne dass man scrollen muss.
  const kopf = hoeheVon("topbar");
  const fuss = hoeheVon("game-footer");
  const frei = d.clientHeight - kopf - fuss - 40;
  const nachHoehe = frei / (BASE_CARD_H + 9 * BASE_OFFSET_UP);

  applySizeScale(Math.min(nachBreite, nachHoehe));
}

function hoeheVon(id) {
  const el = document.getElementById(id);
  return el ? el.offsetHeight : 0;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startTimer(initialSeconds) {
  stopTimer();
  elapsedSeconds = initialSeconds || 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    elapsedSeconds += 1;
    updateTimerDisplay();
    saveGameToStorage();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const el = document.getElementById("timer");
  if (el) el.textContent = formatTime(elapsedSeconds);
}

const SAVE_KEY = "spiderSolitaireSave";
const MODUS_KEY = "spiderSolitaireLoesbar";

function ladeModus() {
  try {
    return localStorage.getItem(MODUS_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function speichereModus() {
  try {
    localStorage.setItem(MODUS_KEY, loesbarModus ? "1" : "0");
  } catch (e) {
    /* Speicher nicht verfügbar, dann eben nur für diese Sitzung */
  }
}

/** Beschriftung eines Grades, im lösbaren Modus mit Zusatz. */
function gradName(difficulty, loesbar) {
  return DIFFICULTY_LABELS[difficulty] + (loesbar ? " · lösbar" : "");
}

function saveGameToStorage() {
  if (!state) return;
  const blob = {
    difficulty: currentDifficulty,
    loesbar: !!state.loesbar,
    columns: state.columns,
    stockGroups: state.stockGroups,
    completedSequences: state.completedSequences,
    foundations: state.foundations,
    moves: state.moves,
    undoCount: state.undoCount,
    history: state.history,
    elapsedSeconds: elapsedSeconds,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
  } catch (e) {
    /* storage full or unavailable, ignore */
  }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSavedGame() {
  localStorage.removeItem(SAVE_KEY);
}

function refreshContinueButton() {
  const btn = document.getElementById("continue-btn");
  if (!btn) return;
  const saved = loadSavedGame();
  btn.classList.toggle("hidden", !saved);
  if (saved) {
    document.getElementById("continue-meta").textContent =
      `${gradName(saved.difficulty, saved.loesbar)} · ${formatTime(saved.elapsedSeconds || 0)} · ${saved.moves} Züge`;
  }
}

function resumeGame() {
  const saved = loadSavedGame();
  if (!saved) return;

  currentDifficulty = saved.difficulty;

  cardElements.forEach((el) => el.remove());
  cardElements.clear();

  state = {
    loesbar: !!saved.loesbar,
    columns: saved.columns,
    stockGroups: saved.stockGroups,
    completedSequences: saved.completedSequences,
    foundations: saved.foundations,
    moves: saved.moves,
    undoCount: saved.undoCount,
    history: saved.history || [],
    selection: null,
  };

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  hideWin();
  ensureSlots();

  const labelEl = document.getElementById("difficulty-label");
  if (labelEl) labelEl.textContent = gradName(currentDifficulty, state.loesbar);

  startTimer(saved.elapsedSeconds || 0);
  render({ instant: true });
}

const STATS_KEY = "spiderSolitaireStats";

function defaultDifficultyStats() {
  return { played: 0, won: 0, totalDuration: 0, totalUndos: 0, totalMoves: 0, bestDuration: null };
}

/**
 * Liest die Statistiken.
 *
 * Lösbare und gemischte Blätter werden getrennt geführt. Wer nur lösbare
 * spielt, gewinnt fast immer – diese Quote soll die der gemischten Partien
 * nicht schönen. Ältere Stände liegen flach unter 1/2/4; sie gelten als
 * gemischt, denn den anderen Modus gab es damals noch nicht.
 */
function loadStats() {
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(STATS_KEY));
  } catch (e) {
    parsed = null;
  }
  const alt = parsed && (parsed["1"] || parsed["2"] || parsed["4"]) ? parsed : null;
  const satz = (quelle) => {
    const werte = {};
    [1, 2, 4].forEach((d) => {
      werte[d] = Object.assign(defaultDifficultyStats(), quelle && quelle[d]);
    });
    return werte;
  };
  return {
    zufall: satz(alt || (parsed && parsed.zufall)),
    loesbar: satz(parsed && parsed.loesbar),
  };
}

let stats = loadStats();
/* Welcher Satz gerade in der Tabelle steht. */
let statsAnsicht = "zufall";

function statistikSatz(loesbar) {
  return stats[loesbar ? "loesbar" : "zufall"];
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function recordGameStarted(difficulty, loesbar) {
  statistikSatz(loesbar)[difficulty].played += 1;
  saveStats();
  renderStatsTable();
}

function recordGameWon(difficulty, loesbar, durationSec, undosUsed, movesUsed) {
  const s = statistikSatz(loesbar)[difficulty];
  s.won += 1;
  s.totalDuration += durationSec;
  s.totalUndos += undosUsed;
  s.totalMoves += movesUsed;
  if (s.bestDuration === null || durationSec < s.bestDuration) s.bestDuration = durationSec;
  saveStats();
  renderStatsTable();
}

function renderStatsTable() {
  const body = document.getElementById("stats-table-body");
  if (!body) return;
  const cols = [1, 2, 4];
  const rows = [
    { label: "Gespielt", fn: (s) => String(s.played) },
    { label: "Gewonnen", fn: (s) => String(s.won) },
    { label: "Gewinnrate", fn: (s) => (s.played === 0 ? "–" : Math.round((s.won / s.played) * 100) + "%") },
    { label: "Ø Zeit", fn: (s) => (s.won === 0 ? "–" : formatTime(Math.round(s.totalDuration / s.won))) },
    { label: "Beste Zeit", fn: (s) => (s.bestDuration === null ? "–" : formatTime(s.bestDuration)) },
    { label: "Ø Züge", fn: (s) => (s.won === 0 ? "–" : Math.round(s.totalMoves / s.won)) },
    { label: "Ø Rückgängig", fn: (s) => (s.won === 0 ? "–" : (s.totalUndos / s.won).toFixed(1)) },
  ];
  const satz = stats[statsAnsicht];
  document.querySelectorAll(".stats-scope-btn").forEach((btn) => {
    btn.classList.toggle("aktiv", btn.dataset.scope === statsAnsicht);
  });
  body.innerHTML = rows
    .map((row) => {
      const cells = cols.map((c) => `<td>${row.fn(satz[c])}</td>`).join("");
      return `<tr><td class="stat-row-label">${row.label}</td>${cells}</tr>`;
    })
    .join("");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCard(suit, rankIndex) {
  return { suit, rank: rankIndex + 1, rankLabel: RANKS[rankIndex], faceUp: false, id: null };
}

function buildDeck(numSuits) {
  const suits = SUITS_BY_DIFFICULTY[numSuits];
  const copies = TOTAL_CARDS / (RANKS.length * suits.length);
  const deck = [];
  let idCounter = 0;
  for (let c = 0; c < copies; c++) {
    for (const suit of suits) {
      for (let r = 0; r < RANKS.length; r++) {
        const card = makeCard(suit, r);
        card.id = "c" + (idCounter++);
        deck.push(card);
      }
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Ein gemischtes Blatt – so, wie Spider normalerweise ausgeteilt wird. */
function mischeBlatt(numSuits) {
  const deck = buildDeck(numSuits);
  shuffle(deck);

  const columns = Array.from({ length: NUM_COLUMNS }, () => []);
  let cursor = 0;
  for (let col = 0; col < NUM_COLUMNS; col++) {
    const count = col < 4 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const card = deck[cursor++];
      card.faceUp = i === count - 1;
      columns[col].push(card);
    }
  }

  const stockCards = deck.slice(cursor);
  const stockGroups = [];
  while (stockCards.length > 0) {
    stockGroups.push(stockCards.splice(0, NUM_COLUMNS));
  }
  return { columns, stockGroups };
}

function newGame(numSuits) {
  currentDifficulty = numSuits;

  let blatt = null;
  let loesbar = loesbarModus && numSuits === LOESBAR_GRAD;
  if (loesbar) blatt = erzeugeLoesbaresBlatt(numSuits);
  if (!blatt) {
    // Kein aussortiertes Blatt gefunden – dann eben ein gewöhnliches. Lieber
    // ein Spiel, das startet, als eine Seite, die hängt.
    loesbar = false;
    blatt = mischeBlatt(numSuits);
  }
  const columns = blatt.columns;
  const stockGroups = blatt.stockGroups;

  state = {
    loesbar,
    columns,
    stockGroups,
    completedSequences: 0,
    foundations: [],
    moves: 0,
    undoCount: 0,
    history: [],
    selection: null,
  };

  recordGameStarted(numSuits, loesbar);

  cardElements.forEach((el) => el.remove());
  cardElements.clear();
  hideWin();
  ensureSlots();

  const labelEl = document.getElementById("difficulty-label");
  if (labelEl) labelEl.textContent = gradName(numSuits, loesbar);

  startTimer();
  render({ instant: true });
  saveGameToStorage();
}

function cloneStateForHistory() {
  return JSON.stringify({
    columns: state.columns,
    stockGroups: state.stockGroups,
    completedSequences: state.completedSequences,
    foundations: state.foundations,
    moves: state.moves,
  });
}

function pushHistory() {
  state.history.push(cloneStateForHistory());
  if (state.history.length > 200) state.history.shift();
}

function undo() {
  if (state.history.length === 0) return;
  const snap = JSON.parse(state.history.pop());
  state.columns = snap.columns;
  state.stockGroups = snap.stockGroups;
  state.completedSequences = snap.completedSequences;
  state.foundations = snap.foundations;
  state.moves = snap.moves;
  state.selection = null;
  state.undoCount += 1;
  syncCardElements();
  render();
  saveGameToStorage();
}

/**
 * Bringt die Kartenelemente wieder mit dem Spielstand in Deckung.
 *
 * Auf dem Tisch liegen nur die Karten der Spalten – der Stapel wird als
 * schlichter Stoß gezeichnet, seine Karten haben kein Element. Wer ein
 * Austeilen zurücknimmt, schickt zehn Karten zurück in den Stapel, und deren
 * Elemente müssen mit: `render` läuft nur über die Spalten und würde sie
 * unberührt liegen lassen, wo sie waren.
 *
 * Wer mitten in eine Ablege-Animation hinein zurücknimmt, hat außerdem Karten
 * mit `completing` vor sich. Die Animation endet unsichtbar, also weg damit,
 * sonst fehlen die Karten auf dem Tisch.
 */
function syncCardElements() {
  const liveIds = new Set();
  state.columns.forEach((col) => col.forEach((c) => liveIds.add(c.id)));
  cardElements.forEach((el, id) => {
    if (liveIds.has(id)) {
      el.classList.remove("completing");
    } else {
      el.remove();
      cardElements.delete(id);
    }
  });
}

function isSequenceMovable(column, startIndex) {
  for (let i = startIndex; i < column.length - 1; i++) {
    const cur = column[i];
    const next = column[i + 1];
    if (!cur.faceUp || !next.faceUp) return false;
    if (cur.suit !== next.suit) return false;
    if (cur.rank !== next.rank + 1) return false;
  }
  return true;
}

function canDropOn(destColumn, movingStack) {
  if (destColumn.length === 0) return true;
  const destTop = destColumn[destColumn.length - 1];
  const movingTop = movingStack[0];
  return destTop.rank === movingTop.rank + 1;
}

function getAllTableauMoves(columns) {
  const moves = [];
  for (let fromCol = 0; fromCol < NUM_COLUMNS; fromCol++) {
    const col = columns[fromCol];
    for (let idx = 0; idx < col.length; idx++) {
      if (!col[idx].faceUp) continue;
      if (!isSequenceMovable(col, idx)) continue;
      const movingStack = col.slice(idx);
      for (let toCol = 0; toCol < NUM_COLUMNS; toCol++) {
        if (toCol === fromCol) continue;
        if (canDropOn(columns[toCol], movingStack)) {
          moves.push({ fromCol, index: idx, toCol, movingStack });
        }
      }
    }
  }
  return moves;
}

function cloneColumns(columns) {
  return columns.map((col) => col.map((c) => Object.assign({}, c)));
}

function simulateTableauMove(columns, move) {
  const cols = cloneColumns(columns);
  const source = cols[move.fromCol];
  const dest = cols[move.toCol];
  const movingStack = source.splice(move.index);

  let flipped = false;
  if (source.length > 0 && !source[source.length - 1].faceUp) {
    source[source.length - 1].faceUp = true;
    flipped = true;
  }

  dest.push(...movingStack);

  let completed = false;
  if (dest.length >= 13) {
    const start = dest.length - 13;
    let ok = dest[start].rank === 13 && dest[dest.length - 1].rank === 1;
    for (let i = start; ok && i < dest.length - 1; i++) {
      if (!dest[i].faceUp || !dest[i + 1].faceUp) ok = false;
      else if (dest[i].suit !== dest[i + 1].suit || dest[i].rank !== dest[i + 1].rank + 1) ok = false;
    }
    if (ok) {
      dest.splice(start, 13);
      if (dest.length > 0 && !dest[dest.length - 1].faceUp) {
        dest[dest.length - 1].faceUp = true;
        flipped = true;
      }
      completed = true;
    }
  }

  return { columns: cols, flipped, completed };
}

function tableauStateKey(columns) {
  return columns
    .map((col) => col.map((c) => c.rank + c.suit + (c.faceUp ? "1" : "0")).join(","))
    .sort()
    .join("|");
}

function searchTableauProgress(columns) {
  const startKey = tableauStateKey(columns);
  const visited = new Set([startKey]);
  const queue = [{ columns, firstMove: null }];
  const MAX_STATES = 20000;
  const deadline = Date.now() + 400;
  let processed = 0;

  while (queue.length > 0) {
    if (processed++ > MAX_STATES || Date.now() > deadline) {
      return { status: "unknown" };
    }
    const { columns: cur, firstMove } = queue.shift();
    const moves = getAllTableauMoves(cur);
    for (const move of moves) {
      const effectiveFirstMove = firstMove || move;
      const sim = simulateTableauMove(cur, move);
      if (sim.flipped || sim.completed) {
        return { status: "yes", move: effectiveFirstMove };
      }
      const key = tableauStateKey(sim.columns);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ columns: sim.columns, firstMove: effectiveFirstMove });
      }
    }
  }
  return { status: "no" };
}

/* =====================================================================
   Aussichtslose Blätter aussortieren

   Ein Spider-Blatt ist entweder zu schaffen oder nicht – das entscheidet
   sich beim Mischen, lange bevor jemand klickt. Für den Modus "Nur lösbare
   Blätter" wird deshalb nicht am Blatt gedreht, sondern gemischt und
   geprüft: Findet sich ein Weg zum Sieg, kommt das Blatt aufs Spielfeld,
   sonst wird neu gemischt.

   Das Blatt bleibt damit ein gewöhnliches Zufallsblatt. Wer sich verspielt,
   hat sich verspielt – ausgeschlossen ist nur der Fall, dass es von Anfang
   an nichts zu holen gab.

   Gesucht wird der Weg nicht durch systematisches Absuchen aller Stellungen
   (der Raum ist zu groß), sondern durch schnelles Durchspielen: viele
   Partien nach einer Faustregel, mit einer Prise Zufall, bis eine davon
   aufgeht. Ein einziger gewonnener Durchlauf genügt als Beweis.
   ===================================================================== */

/* Gewichte der Faustregel. Sie sind gemessen, nicht geschätzt: Ein Bonus
   fürs Leerräumen einer Spalte etwa klang naheliegend, halbierte die
   Trefferquote aber – wer früh Spalten leert, verliert die Ablage, die er
   später zum Umsortieren braucht. */
const ZUG_GEWICHT = {
  folge: 10000,          // eine Folge schließen geht allem vor
  aufdecken: 600,        // eine verdeckte Karte umdrehen
  letzteVerdeckte: 250,  // ... und wenn es die letzte der Spalte ist, umso besser
  leert: 100,            // die Spalte bleibt leer zurück
  gleicheFarbe: 130,     // sauber auf die eigene Farbe legen
  fremdeFarbe: -70,      // auf eine fremde Farbe legen verbaut später
  aufLeere: 60,          // eine leere Spalte belegen
  koenigAufLeere: 170,   // ein König gehört dorthin
  zerreisst: -600,       // einen sauberen Lauf auseinanderreißen
  jeKarte: 6,            // größere Stapel zuerst bewegen
  austeilen: -120,       // austeilen, wenn nichts Besseres da ist
  rauschen: 250,         // Zufall, damit nicht jeder Durchlauf gleich endet
};

/* Nach so vielen Zügen gilt ein Durchlauf als verfahren. */
const DURCHLAUF_ZUEGE = 700;
/* So viele Züge ohne Aufdecken oder Folge, bevor abgebrochen wird. */
const DURCHLAUF_LEERLAUF = 40;

/** Der zusammenhängende Lauf oben auf der Spalte: gleiche Farbe, absteigend. */
function laufOben(col) {
  if (col.length === 0) return null;
  const oben = col[col.length - 1];
  if (!oben.faceUp) return null;
  let i = col.length - 1;
  while (i > 0) {
    const drunter = col[i - 1];
    if (!drunter.faceUp || drunter.suit !== oben.suit || drunter.rank !== col[i].rank + 1) break;
    i--;
  }
  return { start: i, suit: oben.suit, hoch: col[i].rank, tief: oben.rank };
}

/**
 * Spielt eine Partie nach der Faustregel durch.
 *
 * Bewertet wird ohne Probezug: Was ein Zug bringt, lässt sich den Karten
 * ansehen. Nur der gewählte Zug wird tatsächlich ausgeführt – bei mehreren
 * hundert Zügen je Durchlauf und mehreren tausend Durchläufen ist das der
 * Unterschied zwischen Sekunden und Minuten.
 */
function spielDurchlauf(startCols, stockGroups, startFertig) {
  const cols = startCols.map((col) => col.slice());
  let stockIndex = 0;
  let fertig = startFertig;
  let leerlauf = 0;

  for (let schritt = 0; schritt < DURCHLAUF_ZUEGE; schritt++) {
    if (fertig >= 8) return true;

    const laeufe = cols.map(laufOben);
    let bester = null;

    for (let von = 0; von < NUM_COLUMNS; von++) {
      const lauf = laeufe[von];
      if (!lauf) continue;
      const col = cols[von];
      let verdeckt = 0;
      for (let i = 0; i < col.length; i++) if (!col[i].faceUp) verdeckt++;

      for (let index = lauf.start; index < col.length; index++) {
        const karte = col[index];
        const laenge = col.length - index;

        for (let nach = 0; nach < NUM_COLUMNS; nach++) {
          if (nach === von) continue;
          const ziel = cols[nach];
          if (ziel.length === 0) {
            // Eine ganze Spalte auf eine leere umzuziehen ändert nichts.
            if (index === 0) continue;
          } else if (ziel[ziel.length - 1].rank !== karte.rank + 1) {
            continue;
          }

          let punkte = 0;
          if (karte.rank - laenge + 1 === 1) {
            const zielLauf = laeufe[nach];
            if (ziel.length === 0 && karte.rank === 13) punkte += ZUG_GEWICHT.folge;
            else if (zielLauf && zielLauf.suit === karte.suit && zielLauf.hoch === 13 &&
                     zielLauf.tief === karte.rank + 1) punkte += ZUG_GEWICHT.folge;
          }
          if (index > 0 && !col[index - 1].faceUp) {
            punkte += ZUG_GEWICHT.aufdecken + (verdeckt === 1 ? ZUG_GEWICHT.letzteVerdeckte : 0);
          }
          if (index === 0) punkte += ZUG_GEWICHT.leert;
          if (ziel.length === 0) {
            punkte += ZUG_GEWICHT.aufLeere + (karte.rank === 13 ? ZUG_GEWICHT.koenigAufLeere : 0);
          } else if (ziel[ziel.length - 1].suit === karte.suit) {
            punkte += ZUG_GEWICHT.gleicheFarbe;
          } else {
            punkte += ZUG_GEWICHT.fremdeFarbe;
          }
          if (index > 0 && col[index - 1].faceUp && col[index - 1].suit === karte.suit &&
              col[index - 1].rank === karte.rank + 1) {
            punkte += ZUG_GEWICHT.zerreisst;
          }
          punkte += laenge * ZUG_GEWICHT.jeKarte + Math.random() * ZUG_GEWICHT.rauschen;

          if (!bester || punkte > bester.punkte) bester = { von, index, nach, punkte };
        }
      }
    }

    let leereSpalte = false;
    for (let i = 0; i < NUM_COLUMNS; i++) if (cols[i].length === 0) { leereSpalte = true; break; }
    const darfAusteilen = stockIndex < stockGroups.length && !leereSpalte;
    const austeilenPunkte = ZUG_GEWICHT.austeilen + Math.random() * ZUG_GEWICHT.rauschen;

    if (darfAusteilen && (!bester || austeilenPunkte > bester.punkte || leerlauf > DURCHLAUF_LEERLAUF)) {
      for (let i = 0; i < NUM_COLUMNS; i++) {
        const karte = Object.assign({}, stockGroups[stockIndex][i], { faceUp: true });
        cols[i] = cols[i].concat([karte]);
      }
      stockIndex++;
      for (let i = 0; i < NUM_COLUMNS; i++) {
        const rest = suchFolgeAb(cols[i]);
        if (rest) { cols[i] = rest; fertig++; }
      }
      leerlauf = 0;
      continue;
    }

    if (!bester || leerlauf > DURCHLAUF_LEERLAUF) return false;

    const col = cols[bester.von];
    const stapel = col.slice(bester.index);
    const rest = col.slice(0, bester.index);
    const deckteAuf = rest.length > 0 && !rest[rest.length - 1].faceUp;
    if (deckteAuf) rest[rest.length - 1] = Object.assign({}, rest[rest.length - 1], { faceUp: true });
    cols[bester.von] = rest;
    cols[bester.nach] = cols[bester.nach].concat(stapel);

    const abgeraeumt = suchFolgeAb(cols[bester.nach]);
    if (abgeraeumt) { cols[bester.nach] = abgeraeumt; fertig++; leerlauf = 0; }
    else if (deckteAuf) leerlauf = 0;
    else leerlauf++;
  }
  return fertig >= 8;
}

/**
 * Gibt es von hier aus einen Weg zum Sieg?
 *
 * `true` ist ein Beweis – ein Durchlauf ist tatsächlich durchgekommen.
 * `false` heißt nur "in der Zeit keinen gefunden"; es kann trotzdem einen
 * geben. Für das Aussortieren reicht das: Was durchkommt, ist sicher
 * schaffbar.
 */
function findeGewinnweg(columns, stockGroups, fertig, budgetMs) {
  const ende = Date.now() + budgetMs;
  do {
    if (spielDurchlauf(columns, stockGroups, fertig)) return true;
  } while (Date.now() < ende);
  return false;
}

/* So lange wird je Blatt nach einem Gewinnweg gesucht, bevor es verworfen
   wird. Gemessen: Gemischte Zwei-Farben-Blätter geben ihren Weg im Mittel
   binnen dreizehn Millisekunden preis, neun von zehn binnen dreihundert.
   Länger zu suchen brächte kaum mehr Blätter durch, ließe das Spiel beim
   Start aber spürbar stocken – ein zäher Fall wird lieber neu gemischt. */
const PRUEF_BUDGET_MS = 800;
/* So oft wird höchstens neu gemischt. */
const MISCH_VERSUCHE = 40;

/**
 * Mischt, bis ein Blatt dabei ist, das sich nachweislich schaffen lässt.
 *
 * Gibt `null` zurück, wenn das nicht gelingt – dann nimmt der Aufrufer eben
 * ein gewöhnliches Blatt. Lieber ein Spiel, das startet, als eine Seite,
 * die hängt.
 */
function erzeugeLoesbaresBlatt(numSuits) {
  for (let versuch = 0; versuch < MISCH_VERSUCHE; versuch++) {
    const blatt = mischeBlatt(numSuits);
    if (findeGewinnweg(blatt.columns, blatt.stockGroups, 0, PRUEF_BUDGET_MS)) return blatt;
  }
  return null;
}

/* =====================================================================
   Zugcheck: Ist diese Stellung überhaupt noch zu gewinnen?

   Die Suche kennt alle Karten – auch die verdeckten und den Stapel. Damit
   beantwortet sie genau die Frage, die man sich in einer festgefahrenen
   Stellung stellt: Liegt es noch an mir, oder ist hier nichts mehr zu holen?

   Findet sie einen Weg, ist die Stellung sicher zu gewinnen. Läuft sie den
   gesamten erreichbaren Raum ab, ohne einen zu finden, ist sie sicher
   verloren. Reicht das Budget nicht, sagt sie das ehrlich – zu behaupten,
   etwas sei verloren, weil man zu kurz gesucht hat, wäre das Schlimmste.
   ===================================================================== */

const SUCHE_SCHEIBE = 25;
/* Obergrenze für die Menge gemerkter Stellungen – jede kostet Speicher, und
   ein Browser-Tab, der deswegen umkippt, hilft niemandem. */
const SUCHE_STELLUNGEN_MAX = 600000;

/* Farbindex für den kompakten Stellungsschlüssel. */
const FARB_INDEX = {};
Object.keys(SUIT_INFO).forEach((suit, i) => { FARB_INDEX[suit] = i; });

/**
 * Ein kurzer, eindeutiger Schlüssel für eine Stellung.
 *
 * Jede Karte wird zu einem Zeichen, jede Spalte zu einer Zeichenkette; die
 * Spalten werden sortiert, weil es für die Stellung keine Rolle spielt, in
 * welcher Spalte etwas liegt. Das ist der heißeste Pfad der Suche – ein
 * Schlüssel aus lesbaren Zahlen kostet ein Vielfaches.
 */
function suchSchluessel(cols, stockIndex) {
  const teile = new Array(cols.length);
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    let t = "";
    for (let j = 0; j < col.length; j++) {
      const k = col[j];
      t += String.fromCharCode(48 + k.rank * 8 + FARB_INDEX[k.suit] * 2 + (k.faceUp ? 1 : 0));
    }
    teile[i] = t;
  }
  teile.sort();
  return stockIndex + teile.join("|");
}

/**
 * Wendet einen Zug an, ohne das ganze Spielfeld zu kopieren.
 *
 * Kopiert werden nur die Spaltenliste und die beiden beteiligten Spalten;
 * die Karten selbst bleiben gemeinsam genutzt, weil sie nie verändert,
 * sondern beim Umdrehen ersetzt werden. Das ist der Unterschied zwischen
 * hundert Objektkopien je Stellung und zweien.
 */
function suchZug(cols, von, index, nach) {
  const neu = cols.slice();
  const quelle = cols[von].slice(0, index);
  if (quelle.length > 0 && !quelle[quelle.length - 1].faceUp) {
    quelle[quelle.length - 1] = Object.assign({}, quelle[quelle.length - 1], { faceUp: true });
  }
  neu[von] = quelle;
  neu[nach] = cols[nach].concat(cols[von].slice(index));
  return neu;
}

/** Nimmt eine fertige Folge vom Ende der Spalte; gibt die neue Spalte zurück. */
function suchFolgeAb(spalte) {
  if (spalte.length < 13) return null;
  const start = spalte.length - 13;
  if (spalte[start].rank !== 13 || spalte[spalte.length - 1].rank !== 1) return null;
  for (let i = start; i < spalte.length - 1; i++) {
    const a = spalte[i];
    const b = spalte[i + 1];
    if (!a.faceUp || !b.faceUp || a.suit !== b.suit || a.rank !== b.rank + 1) return null;
  }
  const rest = spalte.slice(0, start);
  if (rest.length > 0 && !rest[rest.length - 1].faceUp) {
    rest[rest.length - 1] = Object.assign({}, rest[rest.length - 1], { faceUp: true });
  }
  return rest;
}

/** Alle Stellungen, die aus dieser in einem Zug erreichbar sind. */
function gewinnNachfolger(knoten, stockGroups) {
  const cols = knoten.cols;
  const liste = [];

  for (let von = 0; von < NUM_COLUMNS; von++) {
    const col = cols[von];
    for (let index = col.length - 1; index >= 0; index--) {
      const karte = col[index];
      if (!karte.faceUp) break;
      if (index < col.length - 1) {
        const drauf = col[index + 1];
        if (karte.suit !== drauf.suit || karte.rank !== drauf.rank + 1) break;
      }
      for (let nach = 0; nach < NUM_COLUMNS; nach++) {
        if (nach === von) continue;
        const ziel = cols[nach];
        if (ziel.length === 0) {
          // Eine ganze Spalte auf eine leere umzuziehen ändert nichts.
          if (index === 0) continue;
        } else if (ziel[ziel.length - 1].rank !== karte.rank + 1) {
          continue;
        }

        const neu = suchZug(cols, von, index, nach);
        const rest = suchFolgeAb(neu[nach]);
        let fertig = knoten.fertig;
        if (rest) { neu[nach] = rest; fertig++; }
        const deckt = neu[von].length > 0 && !cols[von][index - 1].faceUp;
        liste.push({
          cols: neu,
          stockIndex: knoten.stockIndex,
          fertig: fertig,
          rang: (rest ? 1000 : 0) + (deckt ? 300 : 0) + (col.length - index) +
                (ziel.length > 0 && ziel[ziel.length - 1].suit === karte.suit ? 50 : 0),
        });
      }
    }
  }

  if (knoten.stockIndex < stockGroups.length) {
    let leer = false;
    for (let i = 0; i < NUM_COLUMNS; i++) if (cols[i].length === 0) { leer = true; break; }
    if (!leer) {
      const neu = cols.slice();
      let fertig = knoten.fertig;
      for (let i = 0; i < NUM_COLUMNS; i++) {
        const karte = Object.assign({}, stockGroups[knoten.stockIndex][i], { faceUp: true });
        neu[i] = cols[i].concat([karte]);
      }
      for (let i = 0; i < NUM_COLUMNS; i++) {
        const rest = suchFolgeAb(neu[i]);
        if (rest) { neu[i] = rest; fertig++; }
      }
      liste.push({ cols: neu, stockIndex: knoten.stockIndex + 1, fertig: fertig, rang: -100 });
    }
  }

  liste.sort((a, b) => b.rang - a.rang);
  return liste;
}

/**
 * Legt eine Absuche an, ohne sie zu starten.
 *
 * Der Fortschritt steckt im Rückgabewert, nicht in der Funktion. Damit kann
 * ein zweiter Klick dort weitermachen, wo der erste aufgehört hat, statt
 * dieselben dreihunderttausend Stellungen noch einmal abzulaufen – und wer
 * es wirklich wissen will, kommt durch mehrfaches Drücken weiter.
 */
function neueGewinnsuche(columns, stockGroups, fertig) {
  const wurzel = { cols: columns.map((col) => col.slice()), stockIndex: 0, fertig: fertig };
  return {
    stockGroups: stockGroups,
    gesehen: new Set([suchSchluessel(wurzel.cols, 0)]),
    stapel: [wurzel],
    /* Gesetzt, sobald das Ergebnis feststeht – danach ist nichts mehr zu tun. */
    stand: wurzel.fertig >= 8 ? "gewinn" : null,
  };
}

/**
 * Läuft eine Absuche eine Scheibe weit weiter.
 *
 * Gibt "gewinn" oder "verloren" zurück, sobald das feststeht, und `null`,
 * wenn die Scheibe zu Ende ist – dann geht es beim nächsten Aufruf weiter.
 * "unklar" heißt: Dieser Lauf ist am Speicherlimit und wird nichts mehr
 * liefern.
 */
function gewinnsucheScheibe(lauf, budgetMs) {
  if (lauf.stand) return lauf.stand;
  const ende = Date.now() + budgetMs;

  while (lauf.stapel.length > 0) {
    /* Der Speicher ist voll: Weitersuchen würde das Tab umbringen, also
       bleibt dieser Lauf endgültig ohne Ergebnis. */
    if (lauf.gesehen.size > SUCHE_STELLUNGEN_MAX) { lauf.stand = "unklar"; return "unklar"; }
    if (Date.now() > ende) return null;

    const kinder = gewinnNachfolger(lauf.stapel.pop(), lauf.stockGroups);
    // Rückwärts auf den Stapel, damit der beste Zug oben liegt.
    for (let i = kinder.length - 1; i >= 0; i--) {
      const kind = kinder[i];
      if (kind.fertig >= 8) { lauf.stand = "gewinn"; return "gewinn"; }
      const schluessel = suchSchluessel(kind.cols, kind.stockIndex);
      if (lauf.gesehen.has(schluessel)) continue;
      lauf.gesehen.add(schluessel);
      lauf.stapel.push(kind);
    }
  }
  lauf.stand = "verloren";
  return "verloren";
}

async function checkAndRemoveCompletedRun(colIndex) {
  const column = state.columns[colIndex];
  if (column.length < 13) return;
  const start = column.length - 13;
  for (let i = start; i < column.length - 1; i++) {
    const cur = column[i];
    const next = column[i + 1];
    if (!cur.faceUp || !next.faceUp) return;
    if (cur.suit !== next.suit) return;
    if (cur.rank !== next.rank + 1) return;
  }
  if (column[start].rank !== 13) return;
  if (column[column.length - 1].rank !== 1) return;

  const removed = column.slice(start);
  const suit = removed[0].suit;

  removed.forEach((c) => {
    const el = cardElements.get(c.id);
    if (el) el.classList.add("completing");
  });

  await delay(FLY_MS);

  /* Während der Animation kann zurückgenommen oder neu begonnen worden sein.
     Dann hängt `column` an keinem Spielstand mehr, und was hier noch
     abgeräumt würde, wäre eine erfundene Folge: Die Karten liegen wieder auf
     dem Tisch und würden trotzdem mitgezählt. Um die `completing`-Klasse
     kümmert sich `syncCardElements`. */
  if (state.columns[colIndex] !== column) return;

  column.splice(start, 13);
  if (column.length > 0) column[column.length - 1].faceUp = true;
  state.completedSequences += 1;
  state.foundations.push({ suit, color: SUIT_INFO[suit].color });

  removed.forEach((c) => {
    const el = cardElements.get(c.id);
    if (el) {
      el.remove();
      cardElements.delete(c.id);
    }
  });

  render();
  saveGameToStorage();
}

function checkWin() {
  return state.completedSequences >= 8;
}

function flashBlocked(elements) {
  elements.forEach((el) => {
    if (!el) return;
    el.classList.remove("blocked-flash");
    void el.offsetWidth;
    el.classList.add("blocked-flash");
    setTimeout(() => el.classList.remove("blocked-flash"), 480);
  });
}

async function dealFromStock() {
  if (state.stockGroups.length === 0) {
    flashBlocked([document.getElementById("stock-pile")]);
    return;
  }
  const emptyCols = [];
  state.columns.forEach((col, i) => {
    if (col.length === 0) emptyCols.push(i);
  });
  if (emptyCols.length > 0) {
    flashBlocked(emptyCols.map((i) => slotElements[i]));
    return;
  }
  pushHistory();
  const group = state.stockGroups.shift();
  for (let i = 0; i < NUM_COLUMNS; i++) {
    const card = group[i];
    card.faceUp = true;
    state.columns[i].push(card);
  }
  state.moves += 1;
  render();
  saveGameToStorage();

  // Eine ausgeteilte Karte kann eine Folge schließen. Ohne diese Prüfung bliebe
  // sie liegen: Auf ein Ass passt nichts mehr, es käme also nie ein Zug auf
  // diese Spalte, der sie bemerkt.
  for (let i = 0; i < NUM_COLUMNS; i++) await checkAndRemoveCompletedRun(i);

  if (checkWin()) {
    await delay(250);
    // Auch diese Pause lässt sich für ein Undo nutzen.
    if (checkWin()) showWin();
  }
}

async function attemptMove(fromCol, cardIndex, toCol) {
  if (fromCol === toCol) return false;
  const source = state.columns[fromCol];
  if (cardIndex < 0 || cardIndex >= source.length) return false;
  if (!source[cardIndex].faceUp) return false;
  if (!isSequenceMovable(source, cardIndex)) return false;

  const movingStack = source.slice(cardIndex);
  const dest = state.columns[toCol];
  if (!canDropOn(dest, movingStack)) return false;

  pushHistory();
  source.splice(cardIndex);
  if (source.length > 0) source[source.length - 1].faceUp = true;
  dest.push(...movingStack);
  state.moves += 1;

  render();
  saveGameToStorage();

  await checkAndRemoveCompletedRun(toCol);

  if (checkWin()) {
    await delay(250);
    // Auch diese Pause lässt sich für ein Undo nutzen.
    if (checkWin()) showWin();
  }
  return true;
}

function showWin() {
  stopTimer();
  clearSavedGame();
  recordGameWon(currentDifficulty, state.loesbar, elapsedSeconds, state.undoCount, state.moves);
  document.getElementById("win-text").textContent =
    `Alle 8 Farbfolgen entfernt in ${state.moves} Zügen, Zeit ${formatTime(elapsedSeconds)}.`;
  document.querySelectorAll(".win-diff-btn").forEach((btn) => {
    btn.classList.toggle("current", Number(btn.dataset.value) === currentDifficulty);
  });
  spawnConfetti();
  document.getElementById("win-overlay").classList.remove("hidden");
}

function hideWin() {
  document.getElementById("win-overlay").classList.add("hidden");
  document.getElementById("confetti-layer").innerHTML = "";
}

function spawnConfetti() {
  const layer = document.getElementById("confetti-layer");
  layer.innerHTML = "";
  const colors = ["#f2c94c", "#d1453b", "#3fae6a", "#4c8ff2", "#ffffff"];
  for (let i = 0; i < 70; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = 2.2 + Math.random() * 1.6 + "s";
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }
}

function bumpStat(id) {
  const el = document.getElementById(id);
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 220);
}

function ensureSlots() {
  const tableau = document.getElementById("tableau");
  if (slotElements.length > 0) return;
  for (let i = 0; i < NUM_COLUMNS; i++) {
    const slot = document.createElement("div");
    slot.className = "column-slot";
    slot.dataset.col = String(i);
    slot.style.top = "0px";
    slot.addEventListener("click", () => onColumnClick(i));
    tableau.appendChild(slot);
    slotElements.push(slot);
  }
}

function columnLayout(colIndex) {
  const column = state.columns[colIndex];
  const positions = [];
  let offset = 0;
  for (let i = 0; i < column.length; i++) {
    positions.push(offset);
    offset += column[i].faceUp ? OFFSET_UP : OFFSET_DOWN;
  }
  return { positions, totalHeight: offset };
}

function createCardElement(card) {
  const tableau = document.getElementById("tableau");
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = card.id;
  const colorClass = SUIT_INFO[card.suit].color;
  el.innerHTML = `
    <div class="card-deal">
      <div class="card-inner">
        <div class="card-face card-front ${colorClass}">
          <div class="card-corner top">${card.rankLabel}</div>
          <div class="card-center-suit">${card.suit}</div>
          <div class="card-corner bottom">${card.rankLabel}</div>
        </div>
        <div class="card-face card-back-face"></div>
      </div>
    </div>
  `;
  tableau.appendChild(el);
  cardElements.set(card.id, el);
  return el;
}

function setCardTransform(el, x, y, extra) {
  el.style.transform = extra ? `translate(${x}px, ${y}px) ${extra}` : `translate(${x}px, ${y}px)`;
  el.dataset.x = String(x);
  el.dataset.y = String(y);
}

function render(opts) {
  const instant = !!(opts && opts.instant);
  clearHintHighlight();
  let maxHeight = CARD_H;

  state.columns.forEach((column, colIndex) => {
    const { positions, totalHeight } = columnLayout(colIndex);
    maxHeight = Math.max(maxHeight, totalHeight + CARD_H - (column.length ? (column[column.length - 1].faceUp ? OFFSET_UP : OFFSET_DOWN) : 0));

    const x = colIndex * (CARD_W + GAP);

    const slot = slotElements[colIndex];
    slot.style.left = x + "px";
    slot.style.width = CARD_W + "px";
    slot.style.height = Math.max(CARD_H, totalHeight + (positions.length ? 20 : 0)) + "px";
    slot.classList.remove("drop-hover", "drop-invalid");

    column.forEach((card, cardIndex) => {
      let el = cardElements.get(card.id);
      if (!el) {
        el = createCardElement(card);
        el.classList.add("deal-in");
        el.style.setProperty("--deal-delay", (colIndex * 55) + "ms");
      }
      el.classList.toggle("face-down", !card.faceUp);
      el.dataset.col = String(colIndex);
      el.dataset.index = String(cardIndex);
      el.style.zIndex = String(cardIndex);

      const movable = card.faceUp && isSequenceMovable(column, cardIndex);
      el.classList.toggle("movable", movable);

      const isSelected =
        state.selection &&
        state.selection.col === colIndex &&
        cardIndex >= state.selection.index;
      el.classList.toggle("selected", !!isSelected);

      if (instant) {
        el.style.transition = "none";
      }
      setCardTransform(el, x, positions[cardIndex]);
      if (instant) {
        void el.offsetWidth;
        el.style.transition = "";
      }

      if (movable && !el.dataset.bound) {
        el.dataset.bound = "1";
        bindCardInteraction(el);
      }
    });
  });

  document.getElementById("tableau").style.height = maxHeight + "px";
  document.getElementById("tableau").style.width =
    NUM_COLUMNS * CARD_W + (NUM_COLUMNS - 1) * GAP + "px";

  const stockPile = document.getElementById("stock-pile");
  stockPile.classList.toggle("empty", state.stockGroups.length === 0);
  stockPile.innerHTML = "";
  const layers = state.stockGroups.length === 0 ? 0 : Math.min(state.stockGroups.length, 5);
  for (let i = 0; i < layers; i++) {
    const layer = document.createElement("div");
    layer.className = "stock-stack-layer";
    layer.style.transform = `translate(${i * -2}px, ${i * -2}px)`;
    stockPile.appendChild(layer);
  }
  const label = document.createElement("div");
  label.id = "stock-label";
  label.textContent = state.stockGroups.length === 0 ? "Leer" : `${state.stockGroups.length}x austeilen`;
  stockPile.appendChild(label);

  renderFoundations();

  const moveEl = document.getElementById("move-count");
  if (moveEl.textContent !== String(state.moves)) bumpStat("move-count");
  moveEl.textContent = String(state.moves);

  const compEl = document.getElementById("completed-count");
  if (compEl.textContent !== String(state.completedSequences)) bumpStat("completed-count");
  compEl.textContent = String(state.completedSequences);

  const stockEl = document.getElementById("stock-count");
  stockEl.textContent = String(state.stockGroups.length);

  document.getElementById("undo-btn").disabled = state.history.length === 0;
}

function renderFoundations() {
  const el = document.getElementById("foundations");
  el.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const slot = document.createElement("div");
    const f = state.foundations[i];
    if (f) {
      slot.className = `foundation-slot filled ${f.color}`;
      slot.textContent = f.suit;
    } else {
      slot.className = "foundation-slot";
    }
    el.appendChild(slot);
  }
}

function columnIndexFromClientX(clientX) {
  const tableau = document.getElementById("tableau");
  const rect = tableau.getBoundingClientRect();
  const relX = clientX - rect.left;
  const idx = Math.floor(relX / (CARD_W + GAP));
  if (idx < 0 || idx >= NUM_COLUMNS) return null;
  return idx;
}

function updateDropHighlight(colIndex, fromCol, movingStack) {
  slotElements.forEach((slot) => slot.classList.remove("drop-hover", "drop-invalid"));
  if (colIndex === null || colIndex === fromCol) return;
  const dest = state.columns[colIndex];
  const valid = canDropOn(dest, movingStack);
  slotElements[colIndex].classList.add(valid ? "drop-hover" : "drop-invalid");
}

function bindCardInteraction(el) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const colIndex = Number(el.dataset.col);
    const cardIndex = Number(el.dataset.index);
    const column = state.columns[colIndex];
    if (!column[cardIndex].faceUp || !isSequenceMovable(column, cardIndex)) return;

    drag = {
      pointerId: e.pointerId,
      col: colIndex,
      index: cardIndex,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      active: false,
      ids: column.slice(cardIndex).map((c) => c.id),
    };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      startDrag(drag, e);
    }

    const tableau = document.getElementById("tableau");
    const rect = tableau.getBoundingClientRect();
    const baseX = e.clientX - rect.left - drag.grabOffsetX;
    const baseY = e.clientY - rect.top - drag.grabOffsetY;

    drag.ids.forEach((id, i) => {
      const cardEl = cardElements.get(id);
      setCardTransform(cardEl, baseX, baseY + i * OFFSET_UP, "scale(1.04) rotate(1.5deg)");
    });

    const colIndex = columnIndexFromClientX(e.clientX);
    const movingStack = state.columns[drag.col].slice(drag.index);
    updateDropHighlight(colIndex, drag.col, movingStack);
    drag.dropCol = colIndex;
  });

  el.addEventListener("pointerup", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    finishInteraction(e);
  });

  el.addEventListener("pointercancel", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    cancelDrag();
    drag = null;
  });
}

function startDrag(d) {
  d.active = true;
  const el = cardElements.get(d.ids[0]);
  const rect = el.getBoundingClientRect();
  d.grabOffsetX = drag.startX - rect.left;
  d.grabOffsetY = drag.startY - rect.top;
  d.ids.forEach((id, i) => {
    const cardEl = cardElements.get(id);
    cardEl.classList.add("dragging-active");
    cardEl.style.zIndex = String(600 + i);
  });
}

function cancelDrag() {
  slotElements.forEach((slot) => slot.classList.remove("drop-hover", "drop-invalid"));
  if (drag && drag.active) {
    drag.ids.forEach((id) => {
      const cardEl = cardElements.get(id);
      cardEl.classList.remove("dragging-active");
    });
  }
  render();
}

function finishInteraction(e) {
  const wasActive = drag.active;
  const fromCol = drag.col;
  const cardIndex = drag.index;
  const dropCol = drag.dropCol;
  const ids = drag.ids;

  slotElements.forEach((slot) => slot.classList.remove("drop-hover", "drop-invalid"));

  if (!wasActive) {
    drag = null;
    onCardClick(fromCol, cardIndex);
    return;
  }

  ids.forEach((id) => {
    const cardEl = cardElements.get(id);
    cardEl.classList.remove("dragging-active");
  });
  drag = null;

  if (dropCol !== null && dropCol !== undefined && dropCol !== fromCol) {
    attemptMove(fromCol, cardIndex, dropCol).then((moved) => {
      if (!moved) render();
    });
  } else {
    render();
  }
}

function onCardClick(colIndex, cardIndex) {
  const column = state.columns[colIndex];
  if (!column[cardIndex].faceUp) return;

  if (state.selection && state.selection.col === colIndex && state.selection.index === cardIndex) {
    state.selection = null;
    render();
    return;
  }

  if (state.selection) {
    const sel = state.selection;
    state.selection = null;
    attemptMove(sel.col, sel.index, colIndex).then((moved) => {
      if (!moved) render();
    });
    return;
  }

  if (!isSequenceMovable(column, cardIndex)) return;
  state.selection = { col: colIndex, index: cardIndex };
  render();
}

function onColumnClick(colIndex) {
  if (!state.selection) return;
  const sel = state.selection;
  state.selection = null;
  attemptMove(sel.col, sel.index, colIndex).then((moved) => {
    if (!moved) render();
  });
}

let hintClearTimer = null;

function clearHintHighlight() {
  slotElements.forEach((s) => s.classList.remove("hint-target"));
  const stockPile = document.getElementById("stock-pile");
  if (stockPile) stockPile.classList.remove("hint-target");
}

function scheduleHintClear(matchSelection) {
  clearTimeout(hintClearTimer);
  hintClearTimer = setTimeout(() => {
    clearHintHighlight();
    if (
      state &&
      state.selection &&
      matchSelection &&
      state.selection.col === matchSelection.col &&
      state.selection.index === matchSelection.index
    ) {
      state.selection = null;
      render();
    }
  }, 5000);
}

function flashButtonResult(btn, html, resultClass, durationMs) {
  if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
  btn.classList.remove("result-ok", "result-bad", "result-unknown");
  btn.classList.add(resultClass);
  btn.innerHTML = html;
  clearTimeout(btn._resultTimer);
  btn._resultTimer = setTimeout(() => {
    btn.classList.remove("result-ok", "result-bad", "result-unknown");
    btn.innerHTML = btn.dataset.originalHtml;
  }, durationMs);
}

/* Wie das Budget des Zugchecks verteilt wird.

   Die beiden Stufen sind nicht gleich viel wert, und das ist gemessen:

   Das Durchspielen beweist einen Gewinn. Findet es einen, dann meist binnen
   Millisekunden – aber nicht immer: Die Verteilung hat einen langen
   Schwanz, Wege tauchen auch noch nach Sekunden auf. Zeit ist hier gut
   angelegt.

   Das Absuchen beweist das Gegenteil, aber nur, wenn es den ganzen
   erreichbaren Raum abläuft. Bei rund zwei Dutzend Nachfolgern je Stellung
   geht das ausschließlich zum Schluss: Ist der Stapel leer und die Stellung
   festgefahren, steht der Beweis nach etwa einer Sekunde. Mitten im Spiel
   läuft die Suche in jedes Budget hinein, ohne fertig zu werden – zwölf
   Sekunden reichen für ein paar hunderttausend Stellungen, gebraucht würden
   unfassbar viel mehr.

   Deshalb laufen beide abwechselnd, Scheibe um Scheibe, und teilen sich die
   Zeit. Ein festgefahrenes Endspiel ist damit nach knapp zwei Sekunden als
   verloren bewiesen, und ein Gewinnweg muss nicht warten, bis eine Absuche
   ihr Budget verbraucht hat, die ohnehin nicht fertig wird.

   Vorher lief es nacheinander, mit 600 ms fürs Durchspielen und 12 s fürs
   Absuchen – also fast die ganze Zeit für die Stufe, die mitten im Spiel
   nichts liefern kann. Von vier Stellungen, die damit "Ausgang offen"
   ergaben, waren alle vier gewinnbar; das Durchspielen fand den Weg nach 0,3
   bis 2,8 Sekunden, sobald es weitersuchen durfte. */
const ZUGCHECK_BUDGET_MS = 15000;
/* Jeder weitere Druck auf denselben Knopf sucht länger – wer ein zweites Mal
   drückt, will die Antwort und nicht die schnelle Runde –, bis hierhin. */
const ZUGCHECK_BUDGET_MAX_MS = 45000;

/** Spielt eine Scheibe lang Durchläufe; `true`, sobald einer durchkommt. */
function durchspielScheibe(columns, stockGroups, fertig, budgetMs) {
  const ende = Date.now() + budgetMs;
  do {
    if (spielDurchlauf(columns, stockGroups, fertig)) return true;
  } while (Date.now() < ende);
  return false;
}

/**
 * Lässt beide Suchen abwechselnd laufen und meldet, was zuerst feststeht:
 * "gewinn", "verloren" oder – wenn das Budget aufgeht, ohne dass eine von
 * beiden etwas beweisen konnte – "unklar".
 *
 * Zwischen den Scheiben gibt die Funktion den Faden frei, damit die Seite
 * bedienbar bleibt. Wer diese Lücke nutzt und weiterspielt, bekommt "abbruch"
 * statt einer Antwort auf eine Stellung, die es nicht mehr gibt.
 */
function starteZugcheck(columns, stockGroups, fertig, lauf, budgetMs, verworfen, melde) {
  const ende = Date.now() + budgetMs;
  /* Ist der Speicher der Absuche voll, geht nur noch das Durchspielen. */
  let absuchen = true;

  function scheibe() {
    if (verworfen()) { melde("abbruch"); return; }
    if (durchspielScheibe(columns, stockGroups, fertig, SUCHE_SCHEIBE)) { melde("gewinn"); return; }
    if (absuchen) {
      const stand = gewinnsucheScheibe(lauf, SUCHE_SCHEIBE);
      if (stand === "gewinn" || stand === "verloren") { melde(stand); return; }
      if (stand === "unklar") absuchen = false;
    }
    if (Date.now() > ende) { melde("unklar"); return; }
    setTimeout(scheibe, 0);
  }

  scheibe();
}

/**
 * Der Zugcheck beantwortet die Frage, die man sich in einer festgefahrenen
 * Stellung stellt: Ist hier überhaupt noch etwas zu holen?
 *
 * Er kennt alle Karten, auch die verdeckten und den Stapel – das ist Absicht,
 * anders ließe sich die Frage gar nicht beantworten.
 *
 * Jede Stellung ist gewonnen oder verloren, daran gibt es nichts zu deuten.
 * Beweisen lassen sich aber nicht beide Seiten gleich gut: Ein Gewinn ist
 * bewiesen, sobald ein Durchlauf durchkommt. Eine Niederlage ist erst
 * bewiesen, wenn der ganze erreichbare Raum abgelaufen ist – und der ist
 * mitten im Spiel so groß, dass das in keinem Browser durchläuft.
 *
 * Darum drei Stufen: kurz durchspielen, kurz absuchen, lange durchspielen.
 * Bleibt am Ende alles offen, sagt der Knopf genau das und sucht beim
 * nächsten Druck weiter, statt von vorn anzufangen. Zu behaupten, etwas sei
 * verloren, weil man zu kurz gesucht hat, wäre das Schlimmste.
 */
/* Ein angefangenes Absuchen wird aufbewahrt, zusammen mit der Stellung, zu
   der es gehört. Fällt ein Zug, passt der Schlüssel nicht mehr und der Lauf
   wird stillschweigend verworfen – so braucht es dafür keinen Haken in jedem
   Zug, jedem Undo und jedem neuen Spiel. */
let zugcheckLauf = null;

/** Der Absuch-Lauf zur aktuellen Stellung; legt ihn bei Bedarf neu an. */
function holeZugcheckLauf() {
  const schluessel = suchSchluessel(state.columns, 0) + "/" +
    state.stockGroups.length + "/" + state.completedSequences;
  if (!zugcheckLauf || zugcheckLauf.schluessel !== schluessel) {
    zugcheckLauf = {
      schluessel: schluessel,
      lauf: neueGewinnsuche(state.columns, state.stockGroups, state.completedSequences),
      versuche: 0,
    };
  }
  zugcheckLauf.versuche++;
  return zugcheckLauf;
}

function runDeadlockCheck() {
  const btn = document.getElementById("deadlock-btn");
  if (btn._sucht) return;          // eine Suche reicht; ein zweiter Klick wartet
  btn._sucht = true;
  if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
  /* Wird während eines angezeigten Ergebnisses gedrückt – der übliche Weg,
     um weitersuchen zu lassen –, würde dessen Timer mitten in der neuen
     Suche die Beschriftung zurücksetzen. */
  clearTimeout(btn._resultTimer);
  btn.classList.remove("result-ok", "result-bad", "result-unknown");
  btn.innerHTML = '<span class="icon">⏳</span>Prüfe…';

  // Die Suche darf mehrere Sekunden dauern. Ein mitlaufender Zähler zeigt,
  // dass gerechnet wird – sonst sieht der Knopf aus, als hätte er sich
  // aufgehängt.
  const start = Date.now();
  const ticker = setInterval(() => {
    const sekunden = Math.round((Date.now() - start) / 1000);
    btn.innerHTML = '<span class="icon">⏳</span>Prüfe… ' + sekunden + ' s';
  }, 500);

  const fertigMelden = (html, klasse, dauer) => {
    clearInterval(ticker);
    btn._sucht = false;
    flashButtonResult(btn, html, klasse, dauer);
  };

  /* Die Stellung hat sich während der Suche geändert: kein Ergebnis, nur
     zurück auf Anfang. Beides zählt mit, denn ein Zug erhöht `moves` und ein
     Undo `undoCount`. */
  const stellungsmarke = () => state.moves + ":" + state.undoCount;
  const marke = stellungsmarke();
  const abbrechen = () => {
    clearInterval(ticker);
    btn._sucht = false;
    btn.innerHTML = btn.dataset.originalHtml;
  };

  setTimeout(() => {
    // Kein Zug und kein Stapel: Da braucht es keine Suche.
    if (state.completedSequences < 8 && state.stockGroups.length === 0 &&
        getAllTableauMoves(state.columns).length === 0) {
      fertigMelden('<span class="icon">✗</span>Nicht mehr zu gewinnen', "result-bad", 6000);
      return;
    }

    const spalten = state.columns;
    const stapel = state.stockGroups;
    const fertig = state.completedSequences;
    const eintrag = holeZugcheckLauf();
    const budget = Math.min(ZUGCHECK_BUDGET_MS * eintrag.versuche, ZUGCHECK_BUDGET_MAX_MS);

    starteZugcheck(spalten, stapel, fertig, eintrag.lauf, budget,
                   () => stellungsmarke() !== marke, (stand) => {
      if (stand === "abbruch") {
        abbrechen();
      } else if (stand === "gewinn") {
        fertigMelden('<span class="icon">✓</span>Noch zu gewinnen', "result-ok", 5000);
      } else if (stand === "verloren") {
        fertigMelden('<span class="icon">✗</span>Nicht mehr zu gewinnen', "result-bad", 6000);
      } else {
        fertigMelden('<span class="icon">?</span>Offen – nochmal sucht weiter',
                     "result-unknown", 7000);
      }
    });
  }, 30);
}

function applyHintSuggestion(move) {
  state.selection = { col: move.fromCol, index: move.index };
  render();
  slotElements[move.toCol].classList.add("hint-target");
  scheduleHintClear(state.selection);
}

/**
 * Ein Zug, der zwei Läufe derselben Farbe zusammenlegt.
 *
 * Kostenlos ist er, weil der ganze obere Lauf umzieht – es wird nichts
 * auseinandergerissen – und weil er auf die eigene Farbe geht: Der
 * zusammengelegte Lauf bleibt als Ganzes beweglich. Solche Züge verringern
 * die Zahl der Bruchstücke und können deshalb nicht im Kreis führen.
 */
function sucheFreieSortierung(columns) {
  for (let von = 0; von < NUM_COLUMNS; von++) {
    const lauf = laufOben(columns[von]);
    if (!lauf) continue;
    for (let nach = 0; nach < NUM_COLUMNS; nach++) {
      if (nach === von) continue;
      const ziel = columns[nach];
      if (ziel.length === 0) continue;
      const oben = ziel[ziel.length - 1];
      if (oben.faceUp && oben.suit === lauf.suit && oben.rank === lauf.hoch + 1) {
        return { fromCol: von, index: lauf.start, toCol: nach };
      }
    }
  }
  return null;
}

/**
 * "Bester Zug" ist bewusst nicht allwissend.
 *
 * Er sieht nur, was auch der Spieler sieht, und sucht nach dem Nächstliegenden:
 * eine Folge schließen, eine verdeckte Karte aufdecken, oder zwei Läufe
 * derselben Farbe kostenlos zusammenlegen. Deshalb schlägt er auch dann noch
 * etwas vor, wenn die Partie längst verloren ist – ob sie das ist, beantwortet
 * der Zugcheck.
 *
 * Und wenn sich nichts aufdecken und nichts sortieren lässt, empfiehlt er
 * nichts. Ein Zug, der nur Karten hin und her schiebt, ist kein Hinweis.
 */
function runHint() {
  const btn = document.getElementById("hint-btn");
  clearHintHighlight();
  if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
  btn.innerHTML = '<span class="icon">⏳</span>Denke nach…';

  setTimeout(() => {
    // Aufdecken oder eine Folge schließen – notfalls über ein paar Zwischenzüge.
    const outcome = searchTableauProgress(state.columns);
    if (outcome.status === "yes") {
      applyHintSuggestion(outcome.move);
      flashButtonResult(btn, '<span class="icon">💡</span>Vorschlag markiert', "result-ok", 3000);
      return;
    }

    // Sonst wenigstens aufräumen, wenn es nichts kostet.
    const sortieren = sucheFreieSortierung(state.columns);
    if (sortieren) {
      applyHintSuggestion(sortieren);
      flashButtonResult(btn, '<span class="icon">💡</span>Zusammenlegen', "result-ok", 3000);
      return;
    }

    if (state.stockGroups.length > 0 && !state.columns.some((c) => c.length === 0)) {
      document.getElementById("stock-pile").classList.add("hint-target");
      flashButtonResult(btn, '<span class="icon">💡</span>Karten austeilen', "result-ok", 3000);
      scheduleHintClear(null);
      return;
    }

    flashButtonResult(btn, '<span class="icon">–</span>Nichts aufzudecken', "result-unknown", 4000);
  }, 30);
}

function startGame(numSuits) {
  currentDifficulty = numSuits;
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  newGame(numSuits);
}

document.querySelectorAll(".start-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    startGame(Number(btn.dataset.value));
  });
});

loesbarModus = ladeModus();
statsAnsicht = loesbarModus ? "loesbar" : "zufall";

const modusSchalter = document.getElementById("loesbar-check");
if (modusSchalter) {
  modusSchalter.checked = loesbarModus;
  modusSchalter.addEventListener("change", () => {
    loesbarModus = modusSchalter.checked;
    speichereModus();
    statsAnsicht = loesbarModus ? "loesbar" : "zufall";
    renderStatsTable();
  });
}

document.querySelectorAll(".stats-scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    statsAnsicht = btn.dataset.scope;
    renderStatsTable();
  });
});
/**
 * Zurück auf die Übersicht dieses Spiels. Der Stand bleibt erhalten, man kann
 * ihn über "Spiel fortsetzen" wieder aufnehmen.
 */
function backToStart() {
  stopTimer();
  saveGameToStorage();
  hideWin();
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  renderStatsTable();
  refreshContinueButton();
}

document.getElementById("continue-btn").addEventListener("click", resumeGame);
document.getElementById("game-title").addEventListener("click", backToStart);

document.getElementById("new-game-btn").addEventListener("click", () => {
  newGame(currentDifficulty);
});
document.querySelectorAll(".win-diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    hideWin();
    newGame(Number(btn.dataset.value));
  });
});
document.getElementById("undo-btn").addEventListener("click", undo);
document.getElementById("stock-pile").addEventListener("click", dealFromStock);
document.getElementById("deadlock-btn").addEventListener("click", runDeadlockCheck);
document.getElementById("hint-btn").addEventListener("click", runHint);

document.getElementById("size-up").addEventListener("click", () => {
  autoGroesse = false;
  applySizeScale(sizeScale * SIZE_STEP);
});
document.getElementById("size-down").addEventListener("click", () => {
  autoGroesse = false;
  applySizeScale(sizeScale / SIZE_STEP);
});
document.getElementById("size-reset").addEventListener("click", () => {
  autoGroesse = true;
  passeGroesseAnFenster();
});

/* Drehen des Telefons ändert die Breite – dann passt die Größe neu. */
window.addEventListener("resize", passeGroesseAnFenster);

document.getElementById("stats-reset").addEventListener("click", () => {
  if (!confirm("Alle Statistiken wirklich zurücksetzen?")) return;
  const leer = () => ({ 1: defaultDifficultyStats(), 2: defaultDifficultyStats(), 4: defaultDifficultyStats() });
  stats = { zufall: leer(), loesbar: leer() };
  saveStats();
  renderStatsTable();
});

passeGroesseAnFenster();
renderStatsTable();
refreshContinueButton();
