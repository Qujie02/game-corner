"use strict";

/* =====================================================================
   Worträtsel · Gemeinsame Regeln

   Wordle und Quordle raten dasselbe: fünf Buchstaben, grün, gelb, grau.
   Sie unterscheiden sich nur darin, wie viele Wörter gleichzeitig laufen
   und wie viele Versuche man hat. Deshalb liegt hier, was beide teilen –
   samt der Wortliste in woerter.js, die mit über fünfzig Kilobyte nicht
   zweimal im Speicher und im Offline-Vorrat liegen soll.

   Was sich je Spiel unterscheidet, steht nicht hier, sondern wird
   übergeben: die Zahl der Rätsel, die Zahl der Versuche, der Name.
   ===================================================================== */

const WORTLAENGE = 5;

/* Alles, was als Versuch durchgeht. Ein Set, weil bei jedem Rateversuch
   nachgeschlagen wird und es an die achttausend Einträge sind.

   Die Zusatzwörter stehen in woerter.js als ein langer Text – das spart
   Dateigröße. Zerlegt wird er genau einmal, hier beim Laden. */
const ERLAUBTE_WOERTER = (function () {
  const menge = new Set();
  for (let i = 0; i < LOESUNGSWOERTER.length; i++) menge.add(LOESUNGSWOERTER[i]);
  const zusatz = ZUSATZWOERTER.split(/\s+/);
  for (let i = 0; i < zusatz.length; i++) {
    if (zusatz[i]) menge.add(zusatz[i]);
  }
  return menge;
})();

function istErlaubtesWort(wort) {
  return ERLAUBTE_WOERTER.has(wort);
}

/* ---------------------------------------------------------------------
   Zufall, der sich wiederholen lässt

   Math.random() wäre hier falsch: Wer die Seite neu lädt, soll dieselben
   Rätsel vorfinden. Also eine kleine Rechenvorschrift, die aus einer
   Zeichenkette immer dieselbe Zahlenfolge macht – bekannt als mulberry32,
   ein paar Zeilen und für diesen Zweck mehr als gut genug.
   --------------------------------------------------------------------- */

/** Macht aus Text eine 32-Bit-Zahl (FNV-1a). */
function saatAusText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Liefert eine Funktion, die nacheinander Zahlen in [0,1) ausgibt. */
function zufallsfolge(saat) {
  let z = saat >>> 0;
  return function () {
    z = (z + 0x6D2B79F5) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Das heutige Datum als "2026-09-16" – nach Ortszeit, nicht nach UTC. */
function heutigerTag(datum) {
  const d = datum || new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

/**
 * Die Wörter eines Tages für ein Spiel.
 *
 * `spiel` geht in die Saat ein, damit Wordle und Quordle am selben Tag
 * nicht dieselben Wörter ziehen – sonst hätte, wer morgens Wordle spielt,
 * mittags im Quordle nichts mehr zu raten.
 *
 * `runde` ist der Schalter für den Knopf "Neue Rätsel": Bei 0 kommt das
 * echte Tagesrätsel, jede weitere Zahl ergibt einen anderen Satz zum
 * selben Datum. Dadurch bleibt auch ein nachgeschobener Satz
 * reproduzierbar – ein neu geladener Browser findet dieselben Wörter vor.
 *
 * Gezogen wird ohne Zurücklegen: Zwei gleiche Wörter nebeneinander wären
 * ein müder Witz.
 */
function woerterFuerTag(spiel, tag, runde, anzahl) {
  const naechste = zufallsfolge(saatAusText(spiel + "#" + tag + "#" + (runde || 0)));
  const gezogen = [];
  while (gezogen.length < anzahl) {
    const wort = LOESUNGSWOERTER[Math.floor(naechste() * LOESUNGSWOERTER.length)];
    if (gezogen.indexOf(wort) < 0) gezogen.push(wort);
  }
  return gezogen;
}

/* ---------------------------------------------------------------------
   Bewertung
   --------------------------------------------------------------------- */

/**
 * Vergleicht einen Versuch mit der Lösung und liefert je Stelle
 * "richtig", "dabei" oder "fehlt".
 *
 * Zwei Durchgänge, und die Reihenfolge ist wichtig: Erst werden alle
 * Treffer an der richtigen Stelle vergeben und die zugehörigen Buchstaben
 * aus dem Vorrat der Lösung gestrichen, danach erst die gelben. Sonst
 * bekäme bei Lösung TANNE und Versuch NEBEL das erste N ein Gelb, obwohl
 * beide N der Lösung schon anderweitig vergeben sind.
 */
function bewerteVersuch(versuch, loesung) {
  const ergebnis = new Array(WORTLAENGE).fill("fehlt");
  const vorrat = {};

  for (let i = 0; i < WORTLAENGE; i++) {
    if (versuch[i] === loesung[i]) {
      ergebnis[i] = "richtig";
    } else {
      vorrat[loesung[i]] = (vorrat[loesung[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < WORTLAENGE; i++) {
    if (ergebnis[i] === "richtig") continue;
    const b = versuch[i];
    if (vorrat[b] > 0) {
      ergebnis[i] = "dabei";
      vorrat[b] -= 1;
    }
  }

  return ergebnis;
}

/* Welcher Befund ist der bessere? Ein Buchstabe, der einmal grün war,
   darf auf der Tastatur nie wieder gelb oder grau werden. */
const RANG = { fehlt: 1, dabei: 2, richtig: 3 };

/**
 * Der Stand der Tastatur nach allen bisherigen Versuchen:
 * ein Objekt Buchstabe → "richtig" | "dabei" | "fehlt".
 */
function tastaturStand(versuche, loesung) {
  const stand = {};
  for (let i = 0; i < versuche.length; i++) {
    const wort = versuche[i];
    const befund = bewerteVersuch(wort, loesung);
    for (let j = 0; j < WORTLAENGE; j++) {
      const b = wort[j];
      if (!stand[b] || RANG[befund[j]] > RANG[stand[b]]) stand[b] = befund[j];
    }
  }
  return stand;
}

/* ---------------------------------------------------------------------
   Harter Modus

   Wer will, bindet sich an die eigenen Hinweise: Ein grüner Buchstabe
   muss an seiner Stelle bleiben, ein gelber muss wieder vorkommen – aber
   nicht dort, wo er schon als falsch gesetzt gemeldet wurde –, und ein
   grauer darf gar nicht auftauchen.

   Der Haken sind doppelte Buchstaben. "Grau" heißt nach der Bewertung
   weiter oben nicht "kommt nicht vor", sondern "kommt nicht noch einmal
   vor": Bei Lösung KATER und Versuch EBENE wird das erste E gelb, die
   beiden anderen werden grau. Wer daraus ein Verbot des Buchstabens E
   machte, würde von da an jedes Wort ablehnen, das die Lösung überhaupt
   noch treffen kann.

   Deshalb wird gezählt statt verboten. Jeder Versuch liefert für jeden
   Buchstaben eine Untergrenze – grün und gelb zusammen – und, wo ein Grau
   dabei war, zusätzlich eine Obergrenze. Aus mehreren Versuchen bleibt
   die schärfste Grenze stehen.
   --------------------------------------------------------------------- */

/** Für die Meldungen: 1 → "einmal", 2 → "zweimal", … */
const MALE = ["null", "einmal", "zweimal", "dreimal", "viermal", "fünfmal"];

/**
 * Was die bisherigen Versuche über die Lösung verraten, gebündelt als
 * Auflagen für den nächsten Versuch.
 *
 * `fest` hält je Stelle den grünen Buchstaben, `verbotenAn` je Buchstabe
 * die Stellen, an denen er gelb war, `mindestens` und `hoechstens` die
 * Zahl der Vorkommen.
 */
function harteAuflagen(versuche, loesung) {
  const fest = new Array(WORTLAENGE).fill("");
  const verbotenAn = {};
  const mindestens = {};
  const hoechstens = {};

  for (let i = 0; i < versuche.length; i++) {
    const wort = versuche[i];
    const befund = bewerteVersuch(wort, loesung);
    /* Je Versuch getrennt zählen: Die Grenzen ergeben sich aus einem
       einzelnen Befund, nicht aus der Summe aller. */
    const bestaetigt = {};
    const grau = {};

    for (let j = 0; j < WORTLAENGE; j++) {
      const b = wort[j];
      if (befund[j] === "richtig") {
        fest[j] = b;
        bestaetigt[b] = (bestaetigt[b] || 0) + 1;
      } else if (befund[j] === "dabei") {
        bestaetigt[b] = (bestaetigt[b] || 0) + 1;
        if (!verbotenAn[b]) verbotenAn[b] = {};
        verbotenAn[b][j] = true;
      } else {
        grau[b] = true;
      }
    }

    for (const b in bestaetigt) {
      if (mindestens[b] === undefined || bestaetigt[b] > mindestens[b]) {
        mindestens[b] = bestaetigt[b];
      }
    }
    for (const b in grau) {
      const grenze = bestaetigt[b] || 0;
      if (hoechstens[b] === undefined || grenze < hoechstens[b]) {
        hoechstens[b] = grenze;
      }
    }
  }

  return {
    fest: fest,
    verbotenAn: verbotenAn,
    mindestens: mindestens,
    hoechstens: hoechstens,
  };
}

/**
 * Prüft ein Wort gegen die Auflagen.
 *
 * Liefert den ersten Verstoß als fertigen Satz – oder null, wenn das Wort
 * durchgeht. Nur der erste: Wer drei Hinweise auf einmal vorgehalten
 * bekommt, liest keinen davon.
 */
function verstossImHartenModus(wort, auflagen) {
  for (let j = 0; j < WORTLAENGE; j++) {
    if (auflagen.fest[j] && wort[j] !== auflagen.fest[j]) {
      return "An Stelle " + (j + 1) + " muss ein " + auflagen.fest[j] + " stehen.";
    }
  }

  const zahl = {};
  for (let j = 0; j < WORTLAENGE; j++) zahl[wort[j]] = (zahl[wort[j]] || 0) + 1;

  for (const b in auflagen.mindestens) {
    const soll = auflagen.mindestens[b];
    if ((zahl[b] || 0) >= soll) continue;
    return soll === 1
      ? b + " muss vorkommen."
      : b + " muss " + MALE[soll] + " vorkommen.";
  }

  for (const b in auflagen.hoechstens) {
    const darf = auflagen.hoechstens[b];
    if ((zahl[b] || 0) <= darf) continue;
    return darf === 0
      ? b + " kommt nicht vor."
      : b + " kommt höchstens " + MALE[darf] + " vor.";
  }

  for (let j = 0; j < WORTLAENGE; j++) {
    const stellen = auflagen.verbotenAn[wort[j]];
    if (stellen && stellen[j]) {
      return "An Stelle " + (j + 1) + " steht kein " + wort[j] + ".";
    }
  }

  return null;
}
