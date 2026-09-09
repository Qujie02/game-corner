"use strict";

/* =====================================================================
   Minesweeper · Brett-Erzeugung und Logik-Löser

   Der Löser zieht ausschließlich sichere Schlüsse. Was er allein damit
   vollständig aufdecken kann, ist ohne Raten lösbar – genau das prüft der
   Generator für die entsprechenden Spielstufen nach.
   ===================================================================== */

/* Feldzustände im Löser */
const UNKNOWN = 0, SAFE_OPEN = 1, KNOWN_MINE = 2;

function sleep(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

function buildNeighbors(rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          list.push(nr * cols + nc);
        }
      }
      out.push(list);
    }
  }
  return out;
}

/** Streut die Fundstellen zufällig, lässt das Startfeld samt Nachbarn frei. */
function scatterMines(rows, cols, mines, safeIndex, nb) {
  const total = rows * cols;
  const mine = new Uint8Array(total);
  const gesperrt = new Uint8Array(total);
  gesperrt[safeIndex] = 1;
  for (let i = 0; i < nb[safeIndex].length; i++) gesperrt[nb[safeIndex][i]] = 1;

  const pool = [];
  for (let i = 0; i < total; i++) if (!gesperrt[i]) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const anzahl = Math.min(mines, pool.length);
  for (let i = 0; i < anzahl; i++) mine[pool[i]] = 1;
  return mine;
}

function countMinesAround(mine, nb, idx) {
  let n = 0;
  const list = nb[idx];
  for (let i = 0; i < list.length; i++) if (mine[list[i]]) n++;
  return n;
}

/* ---------------------------------------------------------------
   Logik-Löser

   Er spielt das Brett nach: aufdecken, was sicher ist, markieren, was
   sicher eine Fundstelle ist – und zwar nur über Schlüsse, die ein
   Mensch ohne Wahrscheinlichkeitsabwägung ziehen kann.
   --------------------------------------------------------------- */

/** Deckt ab einem Feld auf und breitet sich über leere Felder aus. */
function floodOpen(state, mine, nb, counts, start) {
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (state[cur] !== UNKNOWN) continue;
    state[cur] = SAFE_OPEN;
    if (counts[cur] !== 0) continue;
    const list = nb[cur];
    for (let i = 0; i < list.length; i++) {
      if (state[list[i]] === UNKNOWN) stack.push(list[i]);
    }
  }
}

/**
 * Spielt das Brett rein logisch nach und protokolliert dabei, womit.
 *
 * Zurück kommt nicht nur, ob es aufgeht, sondern auch wie anspruchsvoll es
 * dabei zugeht:
 *
 *   einfach – Schritte, für die eine einzelne Zahl genügt ("hier sind schon
 *             alle Fundstellen markiert, der Rest ist frei"). Die zieht man
 *             im Vorbeigehen, ohne hinzusehen.
 *   tief    – Schritte, an denen das nicht mehr weiterhilft und man zwei
 *             Zahlen gegeneinander halten muss (der klassische "1-2"-Schluss)
 *             oder die Gesamtzahl der Fundstellen heranzieht.
 *
 * Genau diese zweite Zahl unterscheidet ein Brett, das man herunterklickt,
 * von einem, an dem man sitzt.
 */
function analysiereBrett(rows, cols, mine, nb, counts, startIndex, totalMines) {
  const total = rows * cols;
  const state = new Uint8Array(total);
  floodOpen(state, mine, nb, counts, startIndex);

  let markiert = 0;
  let einfach = 0;
  let tief = 0;

  for (;;) {
    let fortschritt = false;

    // Regel 1 · Zahl direkt auswerten
    for (let i = 0; i < total; i++) {
      if (state[i] !== SAFE_OPEN) continue;
      const n = counts[i];
      const list = nb[i];
      let offen = 0, minen = 0;
      for (let j = 0; j < list.length; j++) {
        if (state[list[j]] === UNKNOWN) offen++;
        else if (state[list[j]] === KNOWN_MINE) minen++;
      }
      if (!offen) continue;

      if (n === minen) {
        // Alle Fundstellen sind gefunden – der Rest ist sicher.
        for (let j = 0; j < list.length; j++) {
          if (state[list[j]] === UNKNOWN) floodOpen(state, mine, nb, counts, list[j]);
        }
        fortschritt = true;
        einfach++;
      } else if (n - minen === offen) {
        // Alle übrigen Nachbarn müssen Fundstellen sein.
        for (let j = 0; j < list.length; j++) {
          if (state[list[j]] === UNKNOWN) { state[list[j]] = KNOWN_MINE; markiert++; }
        }
        fortschritt = true;
        einfach++;
      }
    }
    if (fortschritt) continue;

    // Regel 2 · Teilmengen zweier Zahlen vergleichen
    if (subsetRule(state, nb, counts, total)) { tief++; continue; }

    // Regel 3 · Gesamtzahl der Fundstellen ausnutzen
    let unbekannt = 0;
    for (let i = 0; i < total; i++) if (state[i] === UNKNOWN) unbekannt++;
    const uebrig = totalMines - markiert;
    if (unbekannt > 0 && uebrig === 0) {
      for (let i = 0; i < total; i++) {
        if (state[i] === UNKNOWN) floodOpen(state, mine, nb, counts, i);
      }
      tief++;
      continue;
    }
    if (unbekannt > 0 && uebrig === unbekannt) {
      for (let i = 0; i < total; i++) if (state[i] === UNKNOWN) { state[i] = KNOWN_MINE; markiert++; }
      tief++;
      continue;
    }

    break;
  }

  let loesbar = true;
  for (let i = 0; i < total; i++) {
    if (!mine[i] && state[i] !== SAFE_OPEN) { loesbar = false; break; }
  }
  return { loesbar: loesbar, einfach: einfach, tief: tief };
}

/** Kurzform: Lässt sich das Brett ab dem Startfeld ohne Raten lösen? */
function solveLogically(rows, cols, mine, nb, counts, startIndex, totalMines) {
  return analysiereBrett(rows, cols, mine, nb, counts, startIndex, totalMines).loesbar;
}

/**
 * Zwei benachbarte Zahlen vergleichen: Liegen die offenen Nachbarn der einen
 * vollständig in denen der anderen, lässt sich über die Differenz oft
 * eindeutig schließen. Das ist der klassische "1-2"-Schluss.
 */
function subsetRule(state, nb, counts, total) {
  // Offene Nachbarn und Restbedarf je Zahl einmal einsammeln
  const zellen = [];
  for (let i = 0; i < total; i++) {
    if (state[i] !== SAFE_OPEN) continue;
    const list = nb[i];
    const offen = [];
    let minen = 0;
    for (let j = 0; j < list.length; j++) {
      if (state[list[j]] === UNKNOWN) offen.push(list[j]);
      else if (state[list[j]] === KNOWN_MINE) minen++;
    }
    if (offen.length) zellen.push({ idx: i, offen: offen, bedarf: counts[i] - minen });
  }

  for (let a = 0; a < zellen.length; a++) {
    for (let b = 0; b < zellen.length; b++) {
      if (a === b) continue;
      const A = zellen[a], B = zellen[b];
      if (A.offen.length >= B.offen.length) continue;

      // Liegt A ganz in B?
      let enthalten = true;
      for (let i = 0; i < A.offen.length; i++) {
        if (B.offen.indexOf(A.offen[i]) < 0) { enthalten = false; break; }
      }
      if (!enthalten) continue;

      const rest = [];
      for (let i = 0; i < B.offen.length; i++) {
        if (A.offen.indexOf(B.offen[i]) < 0) rest.push(B.offen[i]);
      }
      if (!rest.length) continue;

      const differenz = B.bedarf - A.bedarf;
      if (differenz === 0) {
        for (let i = 0; i < rest.length; i++) if (state[rest[i]] === UNKNOWN) state[rest[i]] = SAFE_OPEN;
        return true;
      }
      if (differenz === rest.length) {
        for (let i = 0; i < rest.length; i++) if (state[rest[i]] === UNKNOWN) state[rest[i]] = KNOWN_MINE;
        return true;
      }
    }
  }
  return false;
}

/* ---------------------------------------------------------------
   Erzeugung
   --------------------------------------------------------------- */

function computeCounts(rows, cols, mine, nb) {
  const counts = new Uint8Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) counts[i] = countMinesAround(mine, nb, i);
  return counts;
}

/** Ein klassisches Brett: zufällig verteilt, erster Klick sicher. */
function makeClassicBoard(rows, cols, mines, startIndex) {
  const nb = buildNeighbors(rows, cols);
  const mine = scatterMines(rows, cols, mines, startIndex, nb);
  return { rows: rows, cols: cols, mines: mines, start: startIndex, mine: mine };
}

/**
 * Sucht ein Brett, das nicht nur lösbar ist, sondern auch etwas verlangt.
 *
 * `noGuess`   – nur Bretter nehmen, die sich vollständig herleiten lassen.
 * `zielTiefe` – so viele Schritte sollen echtes Nachdenken verlangen, statt
 *               sich aus einer einzelnen Zahl zu ergeben.
 *
 * Reines Würfeln kommt hier nicht weit: Bretter mit vielen nicht-trivialen
 * Schlüssen sind so selten, dass man sie in der verfügbaren Zeit nicht
 * findet. Stattdessen wird ein brauchbares Brett gesucht und danach
 * schrittweise verbessert – jeweils eine einzelne Fundstelle versetzen und
 * die Änderung behalten, wenn sie nicht schlechter ist. Gleichstand wird
 * mitgenommen, sonst bleibt die Suche auf der ersten Ebene hängen, die sie
 * erreicht.
 */

/* So viele Verbesserungsschritte werden mindestens gegangen, auch wenn die
   Zeit schon abgelaufen ist. In einem Hintergrund-Tab streckt der Browser
   die Atempausen auf etwa eine Sekunde; ohne diese Untergrenze wäre das
   Zeitbudget verbraucht, bevor überhaupt gerechnet wurde – und man bekäme
   ein flaches Brett, ohne es zu merken. */
const VERBESSERN_MINDESTENS = 2000;

/* Dasselbe für die Anlaufphase: Ein Brett, das sich ohne Raten lösen lässt,
   ist bei dieser Dichte nur etwa jedes hundertste. Gäbe die Suche vorher auf,
   fiele das Spiel stillschweigend auf ein gewöhnliches Brett zurück – und die
   Zusage "ohne Raten" wäre nichts mehr wert. */
const ANLAUF_MINDESTENS = 4000;

/* Nach so vielen Bewertungen wird kurz an den Browser abgegeben. Alle
   zwanzig Millisekunden wäre feiner, kostet in einem Hintergrund-Tab aber
   das Vielfache: Dort streckt der Browser jede dieser Pausen auf etwa eine
   Sekunde. */
const ATEMPAUSE = 150;
async function makeDeepBoard(rows, cols, mines, startIndex, opts) {
  const o = opts || {};
  const nb = buildNeighbors(rows, cols);
  const total = rows * cols;
  const deadline = performance.now() + (o.timeBudgetMs || 15000);
  const zielTiefe = o.zielTiefe || 0;

  // Das Startfeld und seine Nachbarn bleiben frei – auch beim Verbessern.
  const gesperrt = new Uint8Array(total);
  gesperrt[startIndex] = 1;
  for (let i = 0; i < nb[startIndex].length; i++) gesperrt[nb[startIndex][i]] = 1;

  let versuche = 0;
  let atempause = 0;

  function bewerte(mine) {
    versuche++;
    const counts = computeCounts(rows, cols, mine, nb);
    return analysiereBrett(rows, cols, mine, nb, counts, startIndex, mines);
  }

  function ergebnis(mine, tief) {
    return {
      rows: rows, cols: cols, mines: mines, start: startIndex,
      mine: mine.slice(), tief: tief, tries: versuche,
    };
  }

  // ---- Anlauf: irgendein Brett, das die harten Bedingungen erfüllt -------
  let mine = null;
  let tief = -1;
  let anlaeufe = 0;
  while (performance.now() < deadline || anlaeufe < ANLAUF_MINDESTENS) {
    anlaeufe++;
    const kandidat = scatterMines(rows, cols, mines, startIndex, nb);
    const wertung = bewerte(kandidat);
    if (!o.noGuess || wertung.loesbar) { mine = kandidat; tief = wertung.tief; break; }
    if (++atempause % ATEMPAUSE === 0) { if (o.onProgress) o.onProgress(versuche); await sleep(0); }
  }
  if (!mine) return null;

  let bestes = ergebnis(mine, tief);
  if (tief >= zielTiefe) return bestes;

  // ---- Verbessern: eine Fundstelle nach der anderen versetzen -----------
  const minenListe = [];
  const freieListe = [];
  for (let i = 0; i < total; i++) {
    if (mine[i]) minenListe.push(i);
    else if (!gesperrt[i]) freieListe.push(i);
  }

  let schritte = 0;
  while (performance.now() < deadline || schritte < VERBESSERN_MINDESTENS) {
    schritte++;
    const a = Math.floor(Math.random() * minenListe.length);
    const b = Math.floor(Math.random() * freieListe.length);
    const von = minenListe[a];
    const nach = freieListe[b];

    mine[von] = 0;
    mine[nach] = 1;
    const wertung = bewerte(mine);
    const erlaubt = (!o.noGuess || wertung.loesbar) && wertung.tief >= tief;

    if (erlaubt) {
      tief = wertung.tief;
      minenListe[a] = nach;
      freieListe[b] = von;
      if (tief > bestes.tief) {
        bestes = ergebnis(mine, tief);
        if (tief >= zielTiefe) return bestes;
      }
    } else {
      mine[von] = 1;
      mine[nach] = 0;
    }

    if (++atempause % ATEMPAUSE === 0) { if (o.onProgress) o.onProgress(versuche); await sleep(0); }
  }
  return bestes;
}

/** Nur für Messungen: wie oft muss gewürfelt werden? */
function noGuessAttemptStats(rows, cols, mines, startIndex, maxTries) {
  const nb = buildNeighbors(rows, cols);
  for (let t = 1; t <= maxTries; t++) {
    const mine = scatterMines(rows, cols, mines, startIndex, nb);
    const counts = computeCounts(rows, cols, mine, nb);
    if (solveLogically(rows, cols, mine, nb, counts, startIndex, mines)) return t;
  }
  return -1;
}
