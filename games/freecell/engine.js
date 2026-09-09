"use strict";

/* =====================================================================
   FreeCell · Regeln, Löser und Blattausgabe

   Diese Datei kennt kein DOM. Sie weiß, wie FreeCell funktioniert, kann ein
   Blatt durchrechnen und gibt nur Blätter aus, die auch aufgehen. Die
   Oberfläche liegt in game.js.

   Karten sind hier Zahlen von 0 bis 51: `farbe * 13 + wert - 1`. Das ist
   nicht schön zu lesen, aber der Löser schaut sich Hunderttausende
   Stellungen an, und jede Zahl, die kein Objekt ist, zahlt sich dort aus.
   Die Oberfläche bekommt daraus wieder Karten mit Namen.
   ===================================================================== */

const FARBEN = ["♠", "♥", "♦", "♣"];
/* Rot sind Herz und Karo – Index 1 und 2. */
const ROT = [false, true, true, false];
const WERTE = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "B", "D", "K"];

const SPALTEN = 8;
const KARTEN = 52;

/* Freie Zellen je Schwierigkeitsgrad. Der Aufbau bleibt gleich, nur der
   Zwischenspeicher schrumpft – das ist der Hebel, an dem FreeCell hängt. */
const ZELLEN_JE_GRAD = { leicht: 4, mittel: 3, schwer: 2 };
const GRAD_NAMEN = { leicht: "Leicht", mittel: "Mittel", schwer: "Schwer" };

function farbeVon(code) { return (code / 13) | 0; }
function wertVon(code) { return (code % 13) + 1; }
function istRot(code) { return ROT[farbeVon(code)]; }

/** Aus einer Kartenzahl das, was die Oberfläche braucht. */
function karteVon(code) {
  const f = farbeVon(code);
  const w = wertVon(code);
  return {
    code: code,
    id: "k" + code,
    suit: FARBEN[f],
    farbe: f,
    rot: ROT[f],
    wert: w,
    label: WERTE[w - 1],
  };
}

/* ---------------------------------------------------------------------
   Regeln
   --------------------------------------------------------------------- */

/** Darf `karte` auf `unten` gelegt werden? Absteigend, Farbe im Wechsel. */
function passtAufSpalte(karte, unten) {
  if (unten === undefined || unten === null) return true;   // leere Spalte
  return wertVon(karte) === wertVon(unten) - 1 && istRot(karte) !== istRot(unten);
}

/** Darf `karte` auf die Basis ihrer Farbe? `basen` hält je Farbe den Wert. */
function passtAufBasis(karte, basen) {
  return basen[farbeVon(karte)] === wertVon(karte) - 1;
}

/**
 * Ist das ab `index` eine bewegbare Folge? Absteigend, Farbe im Wechsel.
 *
 * FreeCell erlaubt eigentlich nur eine Karte je Zug. Eine Folge lässt sich
 * aber Karte für Karte über die Zellen umlagern – deshalb zählt sie als ein
 * Zug, solange genug Platz da ist. Das rechnet `hoechstensBewegbar`.
 */
function istFolge(spalte, index) {
  for (let i = index; i < spalte.length - 1; i++) {
    if (!passtAufSpalte(spalte[i + 1], spalte[i])) return false;
  }
  return true;
}

/**
 * Wie viele Karten lassen sich am Stück umlagern?
 *
 * Jede freie Zelle nimmt eine Karte auf, jede leere Spalte verdoppelt das
 * Ergebnis – dort lässt sich ein Teilstapel zwischenparken und wieder
 * abtragen. Wandert die Folge selbst in eine leere Spalte, zählt die nicht
 * mehr mit, sie ist ja das Ziel.
 */
function hoechstensBewegbar(freieZellen, leereSpalten, zielIstLeer) {
  const nutzbar = Math.max(0, leereSpalten - (zielIstLeer ? 1 : 0));
  return (freieZellen + 1) * Math.pow(2, nutzbar);
}

/* So viele Stellungen darf das Durchspielen einer Umlagerung ansehen.
   Gemessen reichen ein paar hundert; der Rest ist Sicherheitsgurt. */
const UMLAGER_KNOTEN = 3000;

/**
 * Lässt sich diese Folge wirklich umlagern? Nicht gerechnet, durchgespielt.
 *
 * `hoechstensBewegbar` ist nur eine untere Schranke. Die Formel zählt freie
 * Zellen und leere Spalten – sie kennt aber den dritten Platz nicht, auf dem
 * man eine Karte zwischenlagern kann: eine passende Spalte. Zwei Karten auf
 * eine leere Spalte zu bringen geht auch ohne freie Zelle, wenn die obere
 * derweil auf einer anderen Spalte Platz findet.
 *
 * Gemessen an 15.085 Mehrkartenzügen war die Formel zehnmal zu streng und
 * keinmal zu lax. Zehn von fünfzehntausend klingt wenig – nur probiert man
 * als Spieler genau die Züge, die möglich aussehen, und bekommt dann ein
 * "geht nicht" für einen Zug, den man von Hand ausführen könnte.
 *
 * Bewegt werden nur Karten der Folge selbst. Damit bleibt am Ende alles
 * außer Quelle und Ziel unverändert – genau das bedeutet ein Zug mit
 * mehreren Karten. Geparkt wird in Zellen, auf leeren Spalten und auf jeder
 * passenden Spalte.
 *
 * `false` heißt "im Budget nicht gezeigt". Da die Formel vorgeschaltet
 * bleibt, betrifft das nur die ohnehin verzwickten Fälle.
 */
function kannUmlagern(spalten, zellen, zellenAnzahl, von, tiefe, nach, knotenMax) {
  const folge = spalten[von].slice(tiefe);
  const k = folge.length;
  if (k === 0) return false;
  const zielSp = spalten[nach];
  if (!passtAufSpalte(folge[0], zielSp[zielSp.length - 1])) return false;
  if (k === 1) return true;

  const budget = knotenMax || UMLAGER_KNOTEN;
  const menge = new Set(folge);
  const gesehen = new Set();
  let knoten = 0;
  /* Die Rekursionstiefe muss begrenzt sein, nicht nur die Zahl der
     Stellungen: Ein Ast kann sonst tausende Ebenen tief laufen und den
     Aufrufstapel sprengen. Gemessen braucht eine Umlagerung von drei Karten
     sieben Züge; sechs Züge je Karte plus Zuschlag ist reichlich. */
  const tiefeMax = 6 * k + 6;

  function schluessel(sp, ze) {
    let t = "";
    for (let i = 0; i < sp.length; i++) {
      const c = sp[i];
      for (let j = 0; j < c.length; j++) t += String.fromCharCode(48 + c[j]);
      t += "|";
    }
    const zs = ze.slice().sort((a, b) => a - b);
    for (let i = 0; i < zs.length; i++) t += String.fromCharCode(48 + zs[i]);
    return t;
  }

  function fertig(sp) {
    const z = sp[nach];
    if (z.length < k) return false;
    for (let i = 0; i < k; i++) if (z[z.length - k + i] !== folge[i]) return false;
    return sp[von].length === tiefe;
  }

  function versuch(sp, ze, ebene) {
    if (++knoten > budget) return false;
    if (fertig(sp)) return true;
    if (ebene > tiefeMax) return false;
    const s = schluessel(sp, ze);
    if (gesehen.has(s)) return false;
    gesehen.add(s);

    /* Nur Karten der Folge werden angefasst – von einer Spalte oben oder aus
       einer Zelle. */
    const quellen = [];
    for (let i = 0; i < sp.length; i++) {
      const c = sp[i];
      if (c.length && menge.has(c[c.length - 1])) {
        quellen.push({ ausZelle: -1, spalte: i, karte: c[c.length - 1] });
      }
    }
    for (let i = 0; i < ze.length; i++) {
      if (menge.has(ze[i])) quellen.push({ ausZelle: i, spalte: -1, karte: ze[i] });
    }

    for (let n = 0; n < quellen.length; n++) {
      const q = quellen[n];

      if (q.ausZelle === -1 && ze.length < zellenAnzahl) {
        const sp2 = sp.slice();
        sp2[q.spalte] = sp[q.spalte].slice(0, -1);
        if (versuch(sp2, ze.concat([q.karte]), ebene + 1)) return true;
      }

      for (let t = 0; t < sp.length; t++) {
        if (q.ausZelle === -1 && t === q.spalte) continue;
        const ziel = sp[t];
        if (!passtAufSpalte(q.karte, ziel[ziel.length - 1])) continue;
        const sp2 = sp.slice();
        if (q.ausZelle === -1) sp2[q.spalte] = sp[q.spalte].slice(0, -1);
        sp2[t] = ziel.concat([q.karte]);
        let ze2 = ze;
        if (q.ausZelle !== -1) { ze2 = ze.slice(); ze2.splice(q.ausZelle, 1); }
        if (versuch(sp2, ze2, ebene + 1)) return true;
      }
    }
    return false;
  }

  return versuch(spalten.map((c) => c.slice()), zellen.slice(), 0);
}

/**
 * Darf diese Karte gefahrlos auf die Basis?
 *
 * Die Frage ist nicht, ob sie passt, sondern ob sie unten noch gebraucht
 * wird. Gebraucht wird sie nur als Unterlage für die nächstkleinere Karte
 * der jeweils anderen Couleur. Liegen beide Farben der Gegenfarbe schon
 * mindestens einen Wert darunter auf ihrer Basis, kann das nicht mehr
 * passieren – dann ist der Zug nie ein Fehler.
 *
 * Asse und Zweien fallen von selbst darunter.
 */
function sicherAufBasis(karte, basen) {
  if (basen[farbeVon(karte)] !== wertVon(karte) - 1) return false;
  const w = wertVon(karte);
  if (w <= 2) return true;
  const gegen = istRot(karte) ? [0, 3] : [1, 2];
  return basen[gegen[0]] >= w - 1 && basen[gegen[1]] >= w - 1;
}

/* ---------------------------------------------------------------------
   Blatt austeilen
   --------------------------------------------------------------------- */

function mischeCodes(zufall) {
  const deck = [];
  for (let i = 0; i < KARTEN; i++) deck.push(i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    const h = deck[i];
    deck[i] = deck[j];
    deck[j] = h;
  }
  return deck;
}

/** Teilt reihum aus: die ersten vier Spalten bekommen sieben Karten, der Rest sechs. */
function teileAus(deck) {
  const spalten = [];
  for (let i = 0; i < SPALTEN; i++) spalten.push([]);
  for (let i = 0; i < deck.length; i++) spalten[i % SPALTEN].push(deck[i]);
  return spalten;
}

/* ---------------------------------------------------------------------
   Der Löser

   Gesucht wird mit Bestensuche: Aus allen bekannten Stellungen wird immer
   die aussichtsreichste weiterverfolgt. Reine Tiefensuche verläuft sich in
   FreeCell – gemessen fand sie bei vier Zellen nur sieben von zwanzig
   Blättern, obwohl praktisch jedes lösbar ist. Sie läuft eben so lange
   geradeaus, wie sie kann, und geradeaus ist hier fast immer falsch.

   Wie aussichtsreich eine Stellung ist, sagt `bewerte`: je kleiner, desto
   besser. Der wichtigste Posten ist nicht, wie viel schon oben liegt,
   sondern wie tief die Karten begraben sind, die als nächste hochmüssen –
   daran entscheidet sich ein Blatt.

   Drei Dinge machen es machbar:

   Gefahrlose Basiszüge werden vor jeder Verzweigung ausgeführt, nicht als
   Alternative angeboten. Sie können nie schaden, also gibt es keinen Grund,
   den Fall "ich lasse sie liegen" mitzudurchsuchen.

   Folgen werden am Stück verschoben, so weit die freien Zellen und leeren
   Spalten das erlauben. Das ändert nichts am erreichbaren Raum – eine Folge
   umzulagern sind mehrere Einzelzüge –, macht die Wege dorthin aber viel
   kürzer.

   Und Stellungen werden wiedererkannt. Dabei zählt nicht, in welcher Spalte
   etwas liegt und in welcher Zelle: acht Spalten sind untereinander
   austauschbar, Zellen ohnehin. Der Schlüssel sortiert beides, und damit
   fallen die vielen Umbenennungen derselben Stellung zusammen.
   --------------------------------------------------------------------- */

const LOESER_KNOTEN = 40000;

function loeserSchluessel(spalten, zellen, basen) {
  const teile = new Array(spalten.length);
  for (let i = 0; i < spalten.length; i++) {
    const c = spalten[i];
    let t = "";
    for (let j = 0; j < c.length; j++) t += String.fromCharCode(48 + c[j]);
    teile[i] = t;
  }
  teile.sort();
  const zs = zellen.slice().sort((a, b) => a - b);
  let z = "";
  for (let i = 0; i < zs.length; i++) z += String.fromCharCode(48 + zs[i]);
  return String.fromCharCode(48 + basen[0], 48 + basen[1], 48 + basen[2], 48 + basen[3]) +
         z + "|" + teile.join("/");
}

/** Führt alle gefahrlosen Basiszüge aus. Gibt die neue Stellung zurück. */
function raeumeGefahrlosAb(spalten, zellen, basen) {
  let sp = spalten, ze = zellen, ba = basen, kopiert = false;

  for (;;) {
    let quelle = -1, ausZelle = -1;
    for (let i = 0; i < ze.length; i++) {
      if (sicherAufBasis(ze[i], ba)) { ausZelle = i; break; }
    }
    if (ausZelle === -1) {
      for (let i = 0; i < sp.length; i++) {
        const c = sp[i];
        if (c.length && sicherAufBasis(c[c.length - 1], ba)) { quelle = i; break; }
      }
    }
    if (ausZelle === -1 && quelle === -1) break;

    if (!kopiert) {
      sp = sp.map((c) => c.slice());
      ze = ze.slice();
      ba = ba.slice();
      kopiert = true;
    }
    const karte = ausZelle !== -1 ? ze.splice(ausZelle, 1)[0] : sp[quelle].pop();
    ba[farbeVon(karte)] = wertVon(karte);
  }

  return { spalten: sp, zellen: ze, basen: ba };
}

/**
 * Wie schlecht steht diese Stellung? Kleiner ist besser.
 *
 * Die Gewichte sind gemessen, nicht geschätzt. Entscheidend ist der letzte
 * Posten: Wie viele Karten liegen auf denen, die als nächste hochmüssen.
 * Ohne ihn läuft die Suche in Stellungen, in denen viel oben liegt und der
 * Rest hoffnungslos verbaut ist.
 */
function bewerte(spalten, zellen, basen) {
  let h = (52 - (basen[0] + basen[1] + basen[2] + basen[3])) * 3;
  h += zellen.length * 2;

  for (let i = 0; i < spalten.length; i++) {
    const c = spalten[i];
    if (c.length === 0) { h -= 4; continue; }
    /* Jeder Bruch in der Spalte ist Arbeit, die noch kommt. */
    for (let j = 0; j < c.length - 1; j++) {
      if (!passtAufSpalte(c[j + 1], c[j])) h += 1;
    }
  }

  for (let f = 0; f < 4; f++) {
    if (basen[f] >= 13) continue;
    const gesucht = f * 13 + basen[f];      // die nächste Karte dieser Farbe
    for (let i = 0; i < spalten.length; i++) {
      const c = spalten[i];
      const idx = c.indexOf(gesucht);
      if (idx !== -1) { h += 2 * (c.length - 1 - idx); break; }
    }
  }
  return h;
}

/**
 * Alle Stellungen, die aus dieser in einem Zug erreichbar sind.
 *
 * Ein Zug ist hier auch das Umlagern einer ganzen Folge – für den Löser
 * dasselbe wie mehrere Einzelzüge, nur eine Ebene statt fünf.
 */
function loeserNachfolger(spalten, zellen, basen, zellenAnzahl) {
  const liste = [];
  let leer = 0;
  for (let i = 0; i < spalten.length; i++) if (spalten[i].length === 0) leer++;
  const frei = zellenAnzahl - zellen.length;

  /* Aus den Zellen heraus */
  for (let i = 0; i < zellen.length; i++) {
    const karte = zellen[i];
    if (passtAufBasis(karte, basen)) {
      const ba = basen.slice();
      ba[farbeVon(karte)] = wertVon(karte);
      const ze = zellen.slice();
      ze.splice(i, 1);
      liste.push({ spalten: spalten, zellen: ze, basen: ba,
                   zug: { art: "zelle", index: i, anzahl: 1,
                          ziel: { art: "basis", index: farbeVon(karte) } } });
    }
    for (let s = 0; s < spalten.length; s++) {
      const ziel = spalten[s];
      if (!passtAufSpalte(karte, ziel[ziel.length - 1])) continue;
      const sp = spalten.slice();
      sp[s] = ziel.concat([karte]);
      const ze = zellen.slice();
      ze.splice(i, 1);
      liste.push({ spalten: sp, zellen: ze, basen: basen,
                   zug: { art: "zelle", index: i, anzahl: 1,
                          ziel: { art: "spalte", index: s } } });
    }
  }

  /* Von den Spalten */
  for (let q = 0; q < spalten.length; q++) {
    const von = spalten[q];
    if (von.length === 0) continue;
    const oben = von[von.length - 1];

    if (passtAufBasis(oben, basen)) {
      const ba = basen.slice();
      ba[farbeVon(oben)] = wertVon(oben);
      const sp = spalten.slice();
      sp[q] = von.slice(0, -1);
      liste.push({ spalten: sp, zellen: zellen, basen: ba,
                   zug: { art: "spalte", index: q, anzahl: 1,
                          ziel: { art: "basis", index: farbeVon(oben) } } });
    }

    if (frei > 0) {
      const sp = spalten.slice();
      sp[q] = von.slice(0, -1);
      liste.push({ spalten: sp, zellen: zellen.concat([oben]), basen: basen,
                   zug: { art: "spalte", index: q, anzahl: 1,
                          ziel: { art: "zelle" } } });
    }

    /* Wie lang ist die Folge oben auf dieser Spalte? */
    let start = von.length - 1;
    while (start > 0 && passtAufSpalte(von[start], von[start - 1])) start--;
    const folge = von.length - start;

    for (let laenge = 1; laenge <= folge; laenge++) {
      const kopf = von[von.length - laenge];
      const raeumtLeer = laenge === von.length;
      for (let s = 0; s < spalten.length; s++) {
        if (s === q) continue;
        const ziel = spalten[s];
        const zielLeer = ziel.length === 0;
        /* Eine ganze Spalte in eine leere umzuziehen ändert nichts. */
        if (zielLeer && raeumtLeer) continue;
        if (!passtAufSpalte(kopf, ziel[ziel.length - 1])) continue;
        if (laenge > hoechstensBewegbar(frei, leer, zielLeer)) continue;
        const sp = spalten.slice();
        sp[q] = von.slice(0, von.length - laenge);
        sp[s] = ziel.concat(von.slice(von.length - laenge));
        liste.push({ spalten: sp, zellen: zellen, basen: basen,
                     zug: { art: "spalte", index: q, anzahl: laenge,
                            ziel: { art: "spalte", index: s } } });
      }
    }
  }

  return liste;
}

/* Ein kleiner Haufen für die Bestensuche. Ein sortiertes Feld wäre bequemer
   zu lesen, kostet aber bei zehntausenden Einträgen zu viel. */
function haufenRein(haufen, eintrag) {
  haufen.push(eintrag);
  let i = haufen.length - 1;
  while (i > 0) {
    const eltern = (i - 1) >> 1;
    if (haufen[eltern].h <= haufen[i].h) break;
    const t = haufen[eltern]; haufen[eltern] = haufen[i]; haufen[i] = t;
    i = eltern;
  }
}

function haufenRaus(haufen) {
  const kopf = haufen[0];
  const letzte = haufen.pop();
  if (haufen.length > 0) {
    haufen[0] = letzte;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let k = i;
      if (l < haufen.length && haufen[l].h < haufen[k].h) k = l;
      if (r < haufen.length && haufen[r].h < haufen[k].h) k = r;
      if (k === i) break;
      const t = haufen[k]; haufen[k] = haufen[i]; haufen[i] = t;
      i = k;
    }
  }
  return kopf;
}

function istGewonnen(basen) {
  return basen[0] === 13 && basen[1] === 13 && basen[2] === 13 && basen[3] === 13;
}

/**
 * Wendet einen beschriebenen Zug an, samt der gefahrlosen Basiszüge danach.
 *
 * Die Stellung wird nicht verändert, sondern eine neue zurückgegeben.
 * Dieselbe Beschreibung, die `suche` ausgibt, geht hier wieder hinein – so
 * kann die Oberfläche einen ganzen Plan vorausrechnen, ohne die Regeln
 * noch einmal zu kennen.
 */
function wendeZugAn(spalten, zellen, basen, zug) {
  let sp = spalten.slice();
  let ze = zellen.slice();
  const ba = basen.slice();

  let karten;
  if (zug.art === "zelle") {
    karten = [ze[zug.index]];
    ze.splice(zug.index, 1);
  } else {
    const c = sp[zug.index];
    karten = c.slice(c.length - zug.anzahl);
    sp[zug.index] = c.slice(0, c.length - zug.anzahl);
  }

  if (zug.ziel.art === "basis") ba[farbeVon(karten[0])] = wertVon(karten[0]);
  else if (zug.ziel.art === "zelle") ze = ze.concat(karten);
  else sp[zug.ziel.index] = sp[zug.ziel.index].concat(karten);

  return raeumeGefahrlosAb(sp, ze, ba);
}

/**
 * Sucht einen Weg zum Sieg und gibt ihn ganz zurück.
 *
 * `{ gewonnen, zuege }` – `zuege` ist die vollständige Folge von der
 * übergebenen Stellung bis zum letzten Ass. Jeder Knoten merkt sich, woher
 * er kam; am Ziel wird die Kette zurückgelaufen.
 *
 * Den ganzen Weg zurückzugeben und nicht nur den ersten Zug ist nicht
 * Bequemlichkeit, sondern nötig: Sucht man nach jedem Zug neu, findet die
 * Suche jedes Mal einen anderen gültigen Gewinnweg, und der kann mit dem
 * Rückzug des eben gemachten Zuges beginnen. Beides ist richtig, zusammen
 * läuft man im Kreis – gemessen: vierhundert Züge, elf Karten abgelegt. Ein
 * Plan, dem man folgt, läuft dagegen immer vorwärts.
 *
 * `gewonnen: false` heißt: Im Rahmen des Budgets kein Weg gefunden. Das ist
 * nicht dasselbe wie verloren, und wird auch nicht so genannt.
 */
function suche(spalten, zellen, basen, zellenAnzahl, knotenMax) {
  const budget = knotenMax || LOESER_KNOTEN;
  const start = raeumeGefahrlosAb(spalten.map((c) => c.slice()), zellen.slice(), basen.slice());
  if (istGewonnen(start.basen)) return { gewonnen: true, zuege: [] };

  const gesehen = new Set([loeserSchluessel(start.spalten, start.zellen, start.basen)]);
  const haufen = [];
  haufenRein(haufen, {
    h: bewerte(start.spalten, start.zellen, start.basen), z: start, vorher: null, zug: null,
  });
  let knoten = 0;

  while (haufen.length > 0) {
    if (++knoten > budget) return { gewonnen: false, zuege: [] };
    const eintrag = haufenRaus(haufen);

    if (istGewonnen(eintrag.z.basen)) {
      const zuege = [];
      for (let e = eintrag; e && e.zug; e = e.vorher) zuege.push(e.zug);
      zuege.reverse();
      return { gewonnen: true, zuege: zuege };
    }

    const z = eintrag.z;
    const kinder = loeserNachfolger(z.spalten, z.zellen, z.basen, zellenAnzahl);
    for (let i = 0; i < kinder.length; i++) {
      const k = kinder[i];
      const nach = raeumeGefahrlosAb(k.spalten, k.zellen, k.basen);
      const schluessel = loeserSchluessel(nach.spalten, nach.zellen, nach.basen);
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      haufenRein(haufen, {
        h: bewerte(nach.spalten, nach.zellen, nach.basen), z: nach,
        vorher: eintrag, zug: k.zug,
      });
    }
  }
  return { gewonnen: false, zuege: [] };
}

/**
 * Lässt sich dieses Blatt gewinnen? Für die Blattausgabe, also von vorn.
 *
 * `true` heißt ja, und zwar bewiesen. `false` heißt nur "im Budget nicht
 * gefunden" – das Blatt wird dann verworfen, und das ist der einzige Schaden.
 */
function istLoesbar(startSpalten, zellenAnzahl, knotenMax) {
  return suche(startSpalten, [], [0, 0, 0, 0], zellenAnzahl, knotenMax).gewonnen;
}

/* ---------------------------------------------------------------------
   Lösbare Blätter ausgeben

   Gemischt wird ein gewöhnliches Blatt, dann rechnet der Löser es durch.
   Was er nicht schafft, wird verworfen und neu gemischt. Das Blatt bleibt
   damit ein Zufallsblatt – ausgeschlossen ist nur der Fall, dass von Anfang
   an nichts zu holen war.

   Bei vier Zellen fällt fast nichts durch. Bei zwei Zellen ist es die
   Mehrheit, und genau das macht "Schwer" aus: Die Blätter, die übrig
   bleiben, sind hart, aber keines ist unmöglich.
   --------------------------------------------------------------------- */

const MISCH_VERSUCHE = { leicht: 30, mittel: 60, schwer: 400 };

/**
 * Mischt, bis ein Blatt dabei ist, das sich nachweislich schaffen lässt.
 *
 * Gibt `null` zurück, wenn das nicht gelingt – dann nimmt der Aufrufer eben
 * ein gewöhnliches Blatt. Lieber ein Spiel, das startet, als eine Seite,
 * die hängt.
 */
function erzeugeLoesbaresBlatt(grad, zufall, knotenMax) {
  const zellen = ZELLEN_JE_GRAD[grad];
  const rnd = zufall || Math.random;
  const versuche = MISCH_VERSUCHE[grad] || 60;
  for (let i = 0; i < versuche; i++) {
    const spalten = teileAus(mischeCodes(rnd));
    if (istLoesbar(spalten, zellen, knotenMax)) return spalten;
  }
  return null;
}

/* ---------------------------------------------------------------------
   Steht noch ein Zug offen?
   --------------------------------------------------------------------- */

/**
 * Gibt es überhaupt noch einen erlaubten Zug?
 *
 * Gemeint ist der einzelne Zug, den die Regeln kennen: auf eine Basis, auf
 * eine Spalte, in eine Zelle. Eine Folge zu verschieben braucht immer auch
 * einen Einzelzug – wenn keiner geht, geht keiner.
 */
function zugMoeglich(spalten, zellen, basen, zellenAnzahl) {
  for (let i = 0; i < zellen.length; i++) {
    if (passtAufBasis(zellen[i], basen)) return true;
    for (let s = 0; s < spalten.length; s++) {
      if (passtAufSpalte(zellen[i], spalten[s][spalten[s].length - 1])) return true;
    }
  }
  for (let q = 0; q < spalten.length; q++) {
    const von = spalten[q];
    if (von.length === 0) continue;
    const karte = von[von.length - 1];
    if (passtAufBasis(karte, basen)) return true;
    if (zellen.length < zellenAnzahl) return true;
    for (let s = 0; s < spalten.length; s++) {
      if (s === q) continue;
      const ziel = spalten[s];
      if (ziel.length === 0 && von.length === 1) continue;
      if (passtAufSpalte(karte, ziel[ziel.length - 1])) return true;
    }
  }
  return false;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FARBEN, WERTE, SPALTEN, KARTEN, ZELLEN_JE_GRAD, GRAD_NAMEN,
    farbeVon, wertVon, istRot, karteVon,
    passtAufSpalte, passtAufBasis, istFolge, hoechstensBewegbar, kannUmlagern, sicherAufBasis,
    mischeCodes, teileAus, istLoesbar, suche, wendeZugAn, istGewonnen, erzeugeLoesbaresBlatt, zugMoeglich,
    raeumeGefahrlosAb, loeserNachfolger, LOESER_KNOTEN,
  };
}
