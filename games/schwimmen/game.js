"use strict";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const SUIT_COLOR = { "♠": "black", "♣": "black", "♥": "red", "♦": "red" };
const LIVES_START = 3;
const MAX_TURNS_PER_ROUND = 60;

const STATS_KEY = "schwimmenStats";
const SAVE_KEY = "schwimmenSave";

let state = null;
let stats = loadStats();
let inputLocked = false;
let dragState = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardKey(card) {
  return card.suit + card.rank;
}

/* ---------- Deck & scoring ---------- */

function cardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}

function buildShuffledDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handScore(hand) {
  if (hand.length === 3 && hand[0].rank === hand[1].rank && hand[1].rank === hand[2].rank) {
    if (hand[0].rank === "7") return { score: 33, isFeuer: true, isDreiAsse: false, label: "Feuer" };
    if (hand[0].rank === "A") return { score: 30.5, isFeuer: false, isDreiAsse: true, label: "Drei Asse" };
    return { score: 30.5, isFeuer: false, isDreiAsse: false, label: "Dreierpasch" };
  }
  const bySuit = {};
  hand.forEach((c) => {
    bySuit[c.suit] = (bySuit[c.suit] || 0) + cardValue(c.rank);
  });
  const score = Math.max(...Object.values(bySuit));
  return { score, isFeuer: false, isDreiAsse: false, label: null };
}

/* ---------- Bot AI ---------- */

function decideBotMove(hand, table) {
  const current = handScore(hand);
  let best = { type: "current", score: current.score, isFeuer: current.isFeuer };

  for (let hi = 0; hi < 3; hi++) {
    for (let ti = 0; ti < 3; ti++) {
      const trial = hand.slice();
      trial[hi] = table[ti];
      const info = handScore(trial);
      if (info.score > best.score) {
        best = { type: "swap1", score: info.score, isFeuer: info.isFeuer, handIndex: hi, tableIndex: ti };
      }
    }
  }

  const allInfo = handScore(table);
  if (allInfo.score > best.score) {
    best = { type: "swapAll", score: allInfo.score, isFeuer: allInfo.isFeuer };
  }

  if (best.isFeuer) return best;

  if (best.type === "current" || best.score <= current.score) {
    if (current.score < 15 && Math.random() < 0.6) {
      return { type: "schieben" };
    }
    return { type: "knock" };
  }

  const knockThreshold = 22 + (Math.random() * 6 - 3);
  if (current.score >= knockThreshold) {
    return { type: "knock" };
  }

  return best;
}

/* ---------- Stats ---------- */

function loadStats() {
  try {
    return Object.assign({ played: 0, won: 0 }, JSON.parse(localStorage.getItem(STATS_KEY)));
  } catch (e) {
    return { played: 0, won: 0 };
  }
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function recordGameStarted() {
  stats.played += 1;
  saveStats();
  renderStatsTable();
}

function recordGameResult(result) {
  if (result === "win") stats.won += 1;
  saveStats();
  renderStatsTable();
}

function renderStatsTable() {
  const body = document.getElementById("stats-table-body");
  if (!body) return;
  const winRate = stats.played === 0 ? "–" : Math.round((stats.won / stats.played) * 100) + "%";
  body.innerHTML = `
    <tr><td>Gespielt</td><td>${stats.played}</td></tr>
    <tr><td>Gewonnen</td><td>${stats.won}</td></tr>
    <tr><td>Gewinnrate</td><td>${winRate}</td></tr>
  `;
}

/* ---------- Save / resume ---------- */

function saveGame() {
  if (!state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore */
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
    const aliveCount = saved.players.filter((p) => p.alive).length;
    document.getElementById("continue-meta").textContent =
      `Runde ${saved.round} · ${aliveCount} Spieler noch im Rennen`;
  }
}

function resumeGame() {
  const saved = loadSavedGame();
  if (!saved) return;
  state = saved;
  state.players.forEach((p) => {
    if (p.hasActedThisRound === undefined) p.hasActedThisRound = true;
  });
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("showdown-panel").classList.add("hidden");

  if (state.phase === "showdown") {
    const stillAlive = state.players.filter((p) => p.alive);
    if (!state.players[0].alive) return showGameOver("lose");
    if (stillAlive.length === 1) return showGameOver("win");
    state.round += 1;
    state.dealerIndex = nextAliveIndex(state.dealerIndex);
    return startRound();
  }

  render();
  processTurn();
}

/* ---------- Game setup ---------- */

function newGame() {
  state = {
    players: [
      { name: "Du", isHuman: true, hand: [], lives: LIVES_START, alive: true },
      { name: "Computer 1", isHuman: false, hand: [], lives: LIVES_START, alive: true },
      { name: "Computer 2", isHuman: false, hand: [], lives: LIVES_START, alive: true },
    ],
    table: [],
    round: 1,
    dealerIndex: 0,
    turnQueue: [],
    phase: "playing",
    knockerIndex: null,
    globalSwimUsed: false,
    swimUsedBy: null,
    log: [],
    turnCounter: 0,
    schiebenStreak: 0,
    stockDeck: [],
    pendingGameOverResult: null,
  };
  recordGameStarted();
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("showdown-panel").classList.add("hidden");
  startRound();
}

function aliveIndices() {
  return state.players.map((p, i) => (p.alive ? i : null)).filter((x) => x !== null);
}

function rotateFrom(list, startIdx) {
  let pos = list.indexOf(startIdx);
  if (pos === -1) {
    for (let k = 0; k < state.players.length; k++) {
      const cand = (startIdx + k) % state.players.length;
      pos = list.indexOf(cand);
      if (pos !== -1) break;
    }
  }
  if (pos === -1) pos = 0;
  return list.slice(pos).concat(list.slice(0, pos));
}

function nextAliveIndex(from) {
  for (let k = 1; k <= state.players.length; k++) {
    const cand = (from + k) % state.players.length;
    if (state.players[cand].alive) return cand;
  }
  return from;
}

function addLog(text) {
  state.log.push(text);
  if (state.log.length > 8) state.log.shift();
}

async function startRound() {
  const alive = aliveIndices();
  const deck = buildShuffledDeck();
  alive.forEach((i) => {
    state.players[i].hand = deck.splice(0, 3);
    state.players[i].hasActedThisRound = false;
  });
  state.table = deck.splice(0, 3);
  state.stockDeck = deck;

  state.phase = "playing";
  state.knockerIndex = null;
  state.turnCounter = 0;
  state.schiebenStreak = 0;
  state.log = [];
  inputLocked = false;
  state.turnQueue = rotateFrom(alive, state.dealerIndex);

  addLog("Neue Runde ausgeteilt.");
  await maybeReshuffle789();

  const instant = checkInstantWin(alive);
  if (instant) {
    const label = instant.reason === "feuer" ? "Feuer" : instant.reason === "asse" ? "Drei Asse" : "Blitz (31)";
    addLog(`${state.players[instant.idx].name} hat sofort ${label}!`);
    saveGame();
    return doShowdown(instant.idx, instant.reason);
  }

  saveGame();
  render();
  processTurn();
}

function checkInstantWin(indices) {
  for (const i of indices) {
    if (handScore(state.players[i].hand).isFeuer) return { idx: i, reason: "feuer" };
  }
  for (const i of indices) {
    if (handScore(state.players[i].hand).isDreiAsse) return { idx: i, reason: "asse" };
  }
  for (const i of indices) {
    if (handScore(state.players[i].hand).score === 31) return { idx: i, reason: "blitz" };
  }
  return null;
}

/* ---------- Turn engine ---------- */

function isHumansTurn() {
  return (
    state &&
    (state.phase === "playing" || state.phase === "final-lap") &&
    state.turnQueue[0] === 0
  );
}

function processTurn() {
  if (!state || state.phase === "showdown" || state.phase === "gameover") return;
  inputLocked = false;

  if (state.turnQueue.length === 0) {
    if (state.phase === "final-lap") return doShowdown();
    return;
  }

  const idx = state.turnQueue[0];
  const player = state.players[idx];
  const lapNote = state.phase === "final-lap" ? " (letzte Runde)" : "";
  updateStatusText(player.isHuman ? `Du bist dran${lapNote}` : `${player.name} ist dran${lapNote}`);
  render();

  if (!player.isHuman) {
    inputLocked = true;
    setTimeout(() => runBotTurn(idx), 650 + Math.random() * 550);
  }
}

function updateStatusText(text) {
  const el = document.getElementById("status-text");
  if (el) el.textContent = text;
}

function bubbleIdForPlayer(idx) {
  if (idx === 0) return "player-bubble";
  return idx === 1 ? "opp0-bubble" : "opp1-bubble";
}

async function runBotTurn(idx) {
  if (!state || state.phase === "showdown" || state.phase === "gameover") return;
  const player = state.players[idx];
  const decision = decideBotMove(player.hand, state.table);
  if (decision.type === "knock" && (state.phase !== "playing" || !player.hasActedThisRound)) {
    decision.type = "schieben";
  }
  const bubbleId = bubbleIdForPlayer(idx);

  if (decision.type === "knock") {
    showBubble(bubbleId, "Klopft!");
    addLog(`${player.name} klopft.`);
    advanceAfterMove(idx, "knock");
    return;
  }

  if (decision.type === "schieben") {
    showBubble(bubbleId, "Schiebt!");
    addLog(`${player.name} schiebt.`);
    advanceAfterMove(idx, "schieben");
    return;
  }

  if (decision.type === "swap1") {
    const handCard = player.hand[decision.handIndex];
    const tableCard = state.table[decision.tableIndex];
    const rects = captureRects([cardKey(handCard), cardKey(tableCard)]);
    const tmp = state.table[decision.tableIndex];
    state.table[decision.tableIndex] = player.hand[decision.handIndex];
    player.hand[decision.handIndex] = tmp;
    addLog(`${player.name} tauscht eine Karte.`);
    render();
    playFlipAnimation(rects, 620);
    await delay(650);
    advanceAfterMove(idx, "swap1");
    return;
  }

  if (decision.type === "swapAll") {
    const keys = [...player.hand.map(cardKey), ...state.table.map(cardKey)];
    const rects = captureRects(keys);
    const tmp = state.table.slice();
    state.table = player.hand.slice();
    player.hand = tmp;
    addLog(`${player.name} tauscht alle drei Karten.`);
    render();
    playFlipAnimation(rects, 750);
    await delay(780);
    advanceAfterMove(idx, "swapAll");
  }
}

async function advanceAfterMove(idx, actionType) {
  state.turnCounter += 1;
  state.players[idx].hasActedThisRound = true;
  if (state.turnCounter > MAX_TURNS_PER_ROUND) {
    addLog("Keine Entscheidung nach vielen Zügen – Runde wird ausgewertet.");
    return doShowdown();
  }

  if (actionType === "schieben") {
    state.schiebenStreak += 1;
  } else {
    state.schiebenStreak = 0;
  }

  const info = handScore(state.players[idx].hand);
  if (info.isFeuer) {
    addLog(`${state.players[idx].name} hat Feuer!`);
    return doShowdown(idx, "feuer");
  }
  if (info.isDreiAsse) {
    addLog(`${state.players[idx].name} hat drei Asse!`);
    return doShowdown(idx, "asse");
  }
  if (info.score === 31) {
    addLog(`${state.players[idx].name} hat 31 – Blitz!`);
    return doShowdown(idx, "blitz");
  }

  await maybeReshuffle789();

  if (
    actionType === "schieben" &&
    state.phase === "playing" &&
    state.schiebenStreak >= aliveIndices().length
  ) {
    return reshuffleTableThenContinue(idx);
  }

  advanceQueue(idx, actionType);
}

function reshuffleTableCards() {
  if (state.stockDeck.length >= 3) {
    state.stockDeck.push(...state.table);
    for (let i = state.stockDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.stockDeck[i], state.stockDeck[j]] = [state.stockDeck[j], state.stockDeck[i]];
    }
    state.table = state.stockDeck.splice(0, 3);
  }
}

function tableIsSevenEightNine() {
  const ranks = state.table.map((c) => c.rank);
  return ["7", "8", "9"].every((r) => ranks.includes(r));
}

async function reshuffleTableCardsAnimated() {
  const tableEl = document.getElementById("table-cards");
  const oldCards = [...tableEl.children];
  oldCards.forEach((el, i) => {
    el.style.animationDelay = i * 35 + "ms";
    el.classList.add("reshuffle-out");
  });
  await delay(240 + Math.max(0, oldCards.length - 1) * 35);

  reshuffleTableCards();
  render();

  const newCards = [...document.getElementById("table-cards").children];
  newCards.forEach((el, i) => {
    el.style.animationDelay = i * 60 + "ms";
    el.classList.add("reshuffle-in");
  });
  await delay(300 + Math.max(0, newCards.length - 1) * 60);
}

async function maybeReshuffle789() {
  let guard = 0;
  while (tableIsSevenEightNine() && guard < 10) {
    addLog("7, 8, 9 in der Mitte – Tischkarten werden neu gemischt!");
    await reshuffleTableCardsAnimated();
    guard++;
  }
}

async function reshuffleTableThenContinue(idx) {
  addLog("Alle haben geschoben – neue Tischkarten!");
  await reshuffleTableCardsAnimated();
  await maybeReshuffle789();
  state.schiebenStreak = 0;
  advanceQueue(idx, "schieben");
}

function advanceQueue(idx, actionType) {
  if (state.phase === "playing") {
    state.turnQueue.shift();
    if (actionType === "knock") {
      state.knockerIndex = idx;
      const alive = aliveIndices();
      state.turnQueue = rotateFrom(alive, idx).slice(1);
      state.phase = "final-lap";
      if (state.turnQueue.length === 0) {
        saveGame();
        return doShowdown();
      }
    } else {
      state.turnQueue.push(idx);
    }
  } else if (state.phase === "final-lap") {
    state.turnQueue.shift();
    if (state.turnQueue.length === 0) {
      saveGame();
      return doShowdown();
    }
  }

  saveGame();
  processTurn();
}

/* ---------- Showdown ---------- */

function doShowdown(winnerIdx, winReason) {
  state.phase = "showdown";
  const alive = aliveIndices();
  const scored = alive.map((i) => ({ i, ...handScore(state.players[i].hand) }));

  let loserIndices;
  if (winReason === "asse") {
    loserIndices = alive.filter((i) => i !== winnerIdx);
  } else if (winnerIdx !== undefined && winnerIdx !== null) {
    const others = scored.filter((s) => s.i !== winnerIdx);
    const minScore = Math.min(...others.map((s) => s.score));
    loserIndices = others.filter((s) => s.score === minScore).map((s) => s.i);
  } else {
    const minScore = Math.min(...scored.map((s) => s.score));
    loserIndices = scored.filter((s) => s.score === minScore).map((s) => s.i);
  }

  const swamThisRound = [];
  const eliminatedThisRound = [];

  loserIndices.forEach((i) => {
    const p = state.players[i];
    p.lives -= 1;
    if (p.lives <= 0) {
      if (!state.globalSwimUsed) {
        state.globalSwimUsed = true;
        state.swimUsedBy = i;
        p.lives = 1;
        swamThisRound.push(i);
        addLog(`${p.name} verliert das letzte Leben, darf aber einmalig schwimmen.`);
      } else {
        p.lives = 0;
        p.alive = false;
        eliminatedThisRound.push(i);
        addLog(`${p.name} scheidet aus.`);
      }
    } else {
      addLog(`${p.name} verliert ein Leben.`);
    }
  });

  render();
  renderShowdown({ scored, loserIndices, swamThisRound, eliminatedThisRound, winnerIdx, winReason });
  saveGame();
}

/* ---------- Rendering ---------- */

function livesToHearts(n) {
  if (n <= 0) return "—";
  return "♥".repeat(n);
}

function cardEl(card, opts) {
  opts = opts || {};
  const el = document.createElement("div");
  const classes = ["card"];
  if (opts.faceDown) classes.push("back");
  else classes.push(SUIT_COLOR[card.suit]);
  if (opts.small) classes.push("small");
  if (opts.selectable) classes.push("selectable");
  if (opts.selected) classes.push("selected");
  if (opts.className) classes.push(opts.className);
  el.className = classes.join(" ");
  el.dataset.card = cardKey(card);
  if (!opts.faceDown) {
    el.innerHTML = `
      <div class="card-corner top">${card.rank}</div>
      <div class="card-center-suit">${card.suit}</div>
      <div class="card-corner bottom">${card.rank}</div>
    `;
  }
  return el;
}

/* ---------- Flying-swap animation (FLIP technique) ---------- */

function captureRects(keys) {
  const rects = {};
  keys.forEach((key) => {
    const el = document.querySelector(`.card[data-card="${CSS.escape(key)}"]`);
    if (el) rects[key] = el.getBoundingClientRect();
  });
  return rects;
}

function playFlipAnimation(oldRects, duration) {
  duration = duration || 380;
  Object.keys(oldRects).forEach((key) => {
    const el = document.querySelector(`.card[data-card="${CSS.escape(key)}"]`);
    if (!el) return;
    const newRect = el.getBoundingClientRect();
    const old = oldRects[key];
    const dx = old.left + old.width / 2 - (newRect.left + newRect.width / 2);
    const dy = old.top + old.height / 2 - (newRect.top + newRect.height / 2);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.zIndex = "80";
    void el.offsetWidth;
    el.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.transform = "";
    setTimeout(() => {
      el.style.transition = "";
      el.style.zIndex = "";
    }, duration + 30);
  });
}

function showBubble(elId, text) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

function renderOpponent(idx, prefix) {
  const p = state.players[idx];
  const nameEl = document.getElementById(`${prefix}-name`);
  nameEl.textContent = p.name + (p.alive ? "" : " (ausgeschieden)");

  const handEl = document.getElementById(`${prefix}-hand`);
  handEl.innerHTML = "";
  if (p.alive) {
    for (let i = 0; i < 3; i++) {
      handEl.appendChild(cardEl(p.hand[i], { faceDown: true, small: true }));
    }
  }

  const livesEl = document.getElementById(`${prefix}-lives`);
  livesEl.textContent = livesToHearts(p.lives);
  livesEl.classList.toggle("swam-heart", state.swimUsedBy === idx);

  updateKnockTag(`${prefix}-knock-tag`, idx);
}

function updateKnockTag(elId, idx) {
  const el = document.getElementById(elId);
  if (!el) return;
  const show = state.phase === "final-lap" && state.knockerIndex === idx;
  el.classList.toggle("hidden", !show);
}

function render() {
  if (!state) return;

  document.getElementById("round-count").textContent = state.round;
  const lifeCountEl = document.getElementById("life-count");
  lifeCountEl.textContent = livesToHearts(state.players[0].lives);
  lifeCountEl.classList.toggle("swam-heart", state.swimUsedBy === 0);
  updateKnockTag("player-knock-tag", 0);

  renderOpponent(1, "opp0");
  renderOpponent(2, "opp1");

  const humanTurn = isHumansTurn() && !inputLocked;

  const tableEl = document.getElementById("table-cards");
  tableEl.innerHTML = "";
  state.table.forEach((c) => {
    const el = cardEl(c, {});
    tableEl.appendChild(el);
  });

  const handEl = document.getElementById("player-hand");
  handEl.innerHTML = "";
  state.players[0].hand.forEach((c, hi) => {
    const el = cardEl(c, { selectable: humanTurn });
    if (humanTurn) bindHandCardDrag(el, hi);
    handEl.appendChild(el);
  });

  document.getElementById("swap-all-btn").disabled = !humanTurn;
  const knockBtn = document.getElementById("knock-btn");
  const playerCanKnock = state.players[0].hasActedThisRound;
  knockBtn.disabled = !humanTurn || state.phase !== "playing" || !playerCanKnock;
  knockBtn.title = !playerCanKnock ? "Beim ersten Zug dieser Runde darf noch nicht geklopft werden" : "";
  document.getElementById("schieben-btn").disabled = !humanTurn;

  document.getElementById("event-log").textContent = state.log.slice(-3).join(" · ");
}

function renderShowdown(info) {
  const { scored, loserIndices, swamThisRound, eliminatedThisRound, winnerIdx, winReason } = info;
  const title = document.getElementById("showdown-title");
  if (winnerIdx !== undefined && winnerIdx !== null) {
    const winner = state.players[winnerIdx];
    if (winReason === "feuer") {
      title.textContent = winner.isHuman
        ? "🔥 Feuer! Du gewinnst die Runde sofort."
        : `🔥 Feuer! ${winner.name} gewinnt die Runde sofort.`;
    } else if (winReason === "asse") {
      title.textContent = winner.isHuman
        ? "🅰️ Drei Asse! Du gewinnst die Runde sofort – alle anderen verlieren ein Leben."
        : `🅰️ Drei Asse! ${winner.name} gewinnt die Runde sofort – alle anderen verlieren ein Leben.`;
    } else {
      title.textContent = winner.isHuman
        ? "⚡ Blitz! Du hast 31 und gewinnst die Runde sofort."
        : `⚡ Blitz! ${winner.name} hat 31 und gewinnt die Runde sofort.`;
    }
  } else {
    title.textContent = "Runde beendet";
  }

  const results = document.getElementById("showdown-results");
  results.innerHTML = "";

  scored.forEach((s) => {
    const p = state.players[s.i];
    const card = document.createElement("div");
    card.className = "result-card" + (eliminatedThisRound.includes(s.i) ? " eliminated" : "");

    const nameEl = document.createElement("div");
    nameEl.className = "result-name";
    nameEl.textContent = p.name + (s.i === 0 ? " (Du)" : "");
    card.appendChild(nameEl);

    const handRow = document.createElement("div");
    handRow.className = "result-hand";
    p.hand.forEach((c) => {
      let cls = "";
      if (s.i === winnerIdx) cls = "winner-card";
      else if (loserIndices.includes(s.i)) cls = "loser-card";
      handRow.appendChild(cardEl(c, { small: true, className: cls }));
    });
    card.appendChild(handRow);

    const scoreEl = document.createElement("div");
    scoreEl.className = "result-score";
    scoreEl.textContent = s.isFeuer
      ? "Feuer 🔥"
      : s.label === "Dreierpasch" || s.label === "Drei Asse"
      ? "30,5"
      : String(s.score);
    card.appendChild(scoreEl);

    let note = "";
    if (s.i === winnerIdx) {
      note =
        winReason === "feuer"
          ? "🔥 Feuer – gewinnt automatisch"
          : winReason === "asse"
          ? "🅰️ Drei Asse – gewinnt automatisch"
          : "⚡ Blitz (31) – gewinnt automatisch";
    }
    else if (swamThisRound.includes(s.i)) note = "💧 Letztes Leben – darf einmalig schwimmen!";
    else if (eliminatedThisRound.includes(s.i)) note = "❌ Ausgeschieden";
    else if (loserIndices.includes(s.i)) note = "−1 Leben";

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.className = "result-note";
      noteEl.textContent = note;
      card.appendChild(noteEl);
    }

    results.appendChild(card);
  });

  const nextBtn = document.getElementById("next-round-btn");
  const stillAlive = state.players.filter((p) => p.alive);
  if (!state.players[0].alive) {
    state.pendingGameOverResult = "lose";
    nextBtn.textContent = "Weiter";
  } else if (stillAlive.length === 1) {
    state.pendingGameOverResult = "win";
    nextBtn.textContent = "Weiter";
  } else {
    state.pendingGameOverResult = null;
    nextBtn.textContent = "Nächste Runde";
  }

  document.getElementById("showdown-panel").classList.remove("hidden");
}

function showGameOver(result) {
  clearSavedGame();
  recordGameResult(result);
  document.getElementById("gameover-title").textContent = result === "win" ? "Gewonnen! 🎉" : "Verloren";
  document.getElementById("gameover-text").textContent =
    result === "win"
      ? "Du bist die letzte verbliebene Person am Tisch."
      : "Du hast alle Leben verloren.";
  document.getElementById("showdown-panel").classList.add("hidden");
  document.getElementById("gameover-overlay").classList.remove("hidden");
}

/* ---------- Human interaction (drag & drop) ---------- */

function findTableCardIndexUnderPoint(x, y) {
  const cards = [...document.querySelectorAll("#table-cards .card")];
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
  }
  return null;
}

function updateDropHighlight(idx) {
  document.querySelectorAll("#table-cards .card").forEach((el, i) => {
    el.classList.toggle("drop-target", i === idx);
  });
}

function bindHandCardDrag(el, handIndex) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || inputLocked || !isHumansTurn()) return;
    const rect = el.getBoundingClientRect();
    // rect's center is rotation-independent (a rotated rectangle's bounding
    // box is always centered on its true centroid), so anchor the grab
    // point to that center instead of the skewed rotated corner. This must
    // be captured here at pointerdown time, using THIS event's coordinates
    // — not lazily on the first pointermove, which would use the
    // already-moved cursor position and cancel the offset out to zero.
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    dragState = {
      el,
      handIndex,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabDX: e.clientX - centerX,
      grabDY: e.clientY - centerY,
      width: el.offsetWidth,
      height: el.offsetHeight,
      active: false,
      moved: false,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragState || dragState.el !== el || dragState.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (!dragState.active) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      startHandCardDrag(dragState);
    }

    // Position the card purely via a translate relative to its own
    // container's top-left corner (same model as Spider's tableau drag),
    // so the fanned resting rotation never enters the math.
    const parentRect = el.parentElement.getBoundingClientRect();
    const centerX = e.clientX - dragState.grabDX;
    const centerY = e.clientY - dragState.grabDY;
    const localX = centerX - parentRect.left - dragState.width / 2;
    const localY = centerY - parentRect.top - dragState.height / 2;
    el.style.transform = `translate(${localX}px, ${localY}px) scale(1.08)`;

    updateDropHighlight(findTableCardIndexUnderPoint(e.clientX, e.clientY));
  });

  el.addEventListener("pointerup", (e) => {
    if (!dragState || dragState.el !== el || dragState.pointerId !== e.pointerId) return;
    finishDrag(e);
  });

  el.addEventListener("pointercancel", () => {
    if (!dragState || dragState.el !== el) return;
    dragState = null;
    updateDropHighlight(null);
    render();
  });
}

function startHandCardDrag(d) {
  d.active = true;
  d.moved = true;
  const el = d.el;
  el.classList.add("dragging");
  el.style.transition = "none";
  el.style.left = "0px";
  el.style.top = "0px";
  el.style.bottom = "auto";
  el.style.marginLeft = "0px";
  el.style.transformOrigin = "50% 50%";
  el.style.zIndex = "600";
}

function finishDrag(e) {
  const { el, handIndex, moved, pointerId } = dragState;
  try {
    el.releasePointerCapture(pointerId);
  } catch (err) {
    /* ignore */
  }

  if (!moved) {
    dragState = null;
    return;
  }

  const targetIndex = findTableCardIndexUnderPoint(e.clientX, e.clientY);
  updateDropHighlight(null);
  dragState = null;

  if (targetIndex === null) {
    render();
    return;
  }

  performHumanSingleSwap(handIndex, targetIndex);
}

async function performHumanSingleSwap(handIndex, tableIndex) {
  inputLocked = true;
  const handCard = state.players[0].hand[handIndex];
  const tableCard = state.table[tableIndex];
  const rects = captureRects([cardKey(handCard), cardKey(tableCard)]);

  const tmp = state.table[tableIndex];
  state.table[tableIndex] = state.players[0].hand[handIndex];
  state.players[0].hand[handIndex] = tmp;
  addLog("Du tauschst eine Karte.");

  render();
  playFlipAnimation(rects);
  await delay(380);
  advanceAfterMove(0, "swap1");
}

/* ---------- Wiring ---------- */

document.getElementById("start-btn").addEventListener("click", newGame);
/**
 * Zurück auf die Übersicht dieses Spiels. Der Stand bleibt erhalten, man kann
 * ihn über "Spiel fortsetzen" wieder aufnehmen.
 */
function backToStart() {
  saveGame();
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  renderStatsTable();
  refreshContinueButton();
}

document.getElementById("continue-btn").addEventListener("click", resumeGame);
document.getElementById("game-title").addEventListener("click", backToStart);
document.getElementById("new-game-btn").addEventListener("click", newGame);
document.getElementById("gameover-restart-btn").addEventListener("click", newGame);

document.getElementById("swap-all-btn").addEventListener("click", async () => {
  if (!isHumansTurn() || inputLocked) return;
  inputLocked = true;
  const keys = [...state.players[0].hand.map(cardKey), ...state.table.map(cardKey)];
  const rects = captureRects(keys);

  const tmp = state.table.slice();
  state.table = state.players[0].hand.slice();
  state.players[0].hand = tmp;
  addLog("Du tauschst alle drei Karten.");

  render();
  playFlipAnimation(rects, 750);
  await delay(780);
  advanceAfterMove(0, "swapAll");
});

document.getElementById("knock-btn").addEventListener("click", () => {
  if (!isHumansTurn() || inputLocked || state.phase !== "playing" || !state.players[0].hasActedThisRound) return;
  inputLocked = true;
  showBubble("player-bubble", "Klopft!");
  addLog("Du klopfst.");
  advanceAfterMove(0, "knock");
});

document.getElementById("schieben-btn").addEventListener("click", () => {
  if (!isHumansTurn() || inputLocked) return;
  inputLocked = true;
  showBubble("player-bubble", "Schiebt!");
  addLog("Du schiebst.");
  advanceAfterMove(0, "schieben");
});

document.getElementById("next-round-btn").addEventListener("click", () => {
  document.getElementById("showdown-panel").classList.add("hidden");
  if (state.pendingGameOverResult) {
    showGameOver(state.pendingGameOverResult);
  } else {
    state.round += 1;
    state.dealerIndex = nextAliveIndex(state.dealerIndex);
    startRound();
  }
});

document.getElementById("stats-reset").addEventListener("click", () => {
  if (!confirm("Statistik wirklich zurücksetzen?")) return;
  stats = { played: 0, won: 0 };
  saveStats();
  renderStatsTable();
});

renderStatsTable();
refreshContinueButton();
