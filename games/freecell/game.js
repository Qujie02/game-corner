"use strict";

/* =====================================================================
   FreeCell · Oberfläche

   Die Regeln und der Löser stehen in engine.js. Hier geht es um Karten auf
   dem Schirm: ausrechnen, wie groß sie sein dürfen, sie hinlegen, Klicks
   deuten und sagen, wie es steht.

   Bewegt wird auf zwei Wegen, und beide müssen da sein: ziehen, weil Spider
   in dieser Sammlung gezogen wird und die Hand das von selbst versucht – und
   zwei Klicks, einer wählt, der zweite legt ab, weil das auf dem Telefon
   ruhiger ist. Wohin gelegt werden darf, leuchtet in beiden Fällen auf; bei
   acht Spalten, vier Ablagen und den Zellen ist das Suchen sonst der halbe
   Aufwand.

   Eine Folge zu verschieben ist in FreeCell kein eigener Zug, sondern
   mehrere: Die Karten wandern über die freien Zellen und leere Spalten. Wie
   viele am Stück gehen, rechnet `hoechstensBewegbar` – die Oberfläche
   verschiebt sie dann in einem Rutsch, weil das Karte für Karte anzuklicken
   nur Fleißarbeit wäre.
   ===================================================================== */

const STATS_KEY = "freecellStats";
const SPIEL_KEY = "freecellSpiel";
const GRAD_KEY = "freecellGrad";

/* Kartenmaße. Das Verhältnis ist dasselbe wie bei Spider, damit die Karten
   in der Sammlung gleich aussehen. */
const KARTE_VERHAELTNIS = 128 / 92;
const KARTE_MIN = 34;
const KARTE_MAX = 110;
/* Die Lücke zwischen zwei Spalten, als Anteil der Kartenbreite. */
const LUECKE_ANTEIL = 0.13;
/* Acht Spalten und sieben Lücken – daran hängt die Kartenbreite. */
const TISCH_EINHEITEN = 8 + 7 * LUECKE_ANTEIL;

/* Wie weit eine Karte unter der vorigen hervorschaut, als Anteil der
   Kartenhöhe: so viel wie möglich, so wenig wie nötig. */
const VERSATZ_MAX = 0.28;
const VERSATZ_MIN = 0.085;

const ZOOM_SCHRITT = 1.12;

/* So lange leuchtet ein Hinweis. */
const HINWEIS_MS = 2800;

let spiel = null;
let kartenElemente = new Map();
let zellenPlaetze = [];
let basenPlaetze = [];
let spaltenElemente = [];
let gewaehlterGrad = "leicht";
let autoGroesse = true;
let zoomFaktor = 1;
let masse = null;
let timerInterval = null;
let elapsedSeconds = 0;
let hinweisTimer = null;
/* Läuft gerade eine Blattausgabe? Ein zweiter Klick soll sie nicht doppeln. */
let teiltAus = false;
/* Das laufende Ziehen, oder `null`. */
let zieh = null;
/* Gerade wurde gezogen. Der Browser schickt nach dem Loslassen trotzdem noch
   einen Klick, und der würde den Zug ein zweites Mal deuten. */
let zogGerade = false;
/* Und nach kurzer Zeit ist das Merkzeichen wieder wertlos: Kommt der Klick
   nicht, darf es nicht liegenbleiben und irgendwann einen echten Klick
   verschlucken. */
const NACHKLAPP_MS = 350;

/* So weit muss der Zeiger wandern, bevor aus einem Klick ein Ziehen wird. */
const ZIEH_SCHWELLE = 5;

/* ---------------------------------------------------------------------
   Kleinkram
   --------------------------------------------------------------------- */

function formatiereZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = sekunden % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function handyAnsicht() {
  return window.innerWidth <= 820 || window.innerHeight <= 560;
}

function leereSpalten() {
  let n = 0;
  for (let i = 0; i < spiel.spalten.length; i++) if (spiel.spalten[i].length === 0) n++;
  return n;
}

function freieZellen() { return spiel.zellenAnzahl - spiel.zellen.length; }

/* ---------------------------------------------------------------------
   Statistiken
   --------------------------------------------------------------------- */

function ladeStats() {
  try {
    const roh = localStorage.getItem(STATS_KEY);
    if (roh) return JSON.parse(roh);
  } catch (e) { /* egal */ }
  return {};
}

function speichereStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* egal */ }
}

function statsEintrag(stats, grad) {
  if (!stats[grad]) stats[grad] = { played: 0, won: 0, best: null };
  return stats[grad];
}

function merkeGestartet(grad) {
  const stats = ladeStats();
  statsEintrag(stats, grad).played += 1;
  speichereStats(stats);
}

function merkeGewonnen(grad, sekunden) {
  const stats = ladeStats();
  const e = statsEintrag(stats, grad);
  e.won += 1;
  if (e.best === null || sekunden < e.best) e.best = sekunden;
  speichereStats(stats);
}

function zeigeStatsTabelle() {
  const stats = ladeStats();
  const grade = ["leicht", "mittel", "schwer"];
  const zeilen = [
    ["Gespielt", (e) => String(e.played)],
    ["Gewonnen", (e) => String(e.won)],
    ["Quote", (e) => (e.played ? Math.round((e.won / e.played) * 100) + " %" : "–")],
    ["Bestzeit", (e) => (e.best === null ? "–" : formatiereZeit(e.best))],
  ];
  document.getElementById("stats-table-body").innerHTML = zeilen.map(([label, fn]) => {
    const zellen = grade.map((g) => {
      const e = stats[g] || { played: 0, won: 0, best: null };
      return `<td>${fn(e)}</td>`;
    }).join("");
    return `<tr><td class="stat-row-label">${label}</td>${zellen}</tr>`;
  }).join("");
}

/* ---------------------------------------------------------------------
   Spielstand sichern

   Ein Abbild ist eine Handvoll Zahlen – Spalten, Zellen, Ablagen. Damit
   passen auch hundert Züge Vorgeschichte bequem in den Browserspeicher.
   --------------------------------------------------------------------- */

function abbild() {
  return {
    s: spiel.spalten.map((c) => c.join(",")).join("|"),
    z: spiel.zellen.join(","),
    b: spiel.basen.join(","),
    n: spiel.zuege,
  };
}

function stelleHer(bild) {
  spiel.spalten = bild.s.split("|").map((t) => (t ? t.split(",").map(Number) : []));
  spiel.zellen = bild.z ? bild.z.split(",").map(Number) : [];
  spiel.basen = bild.b.split(",").map(Number);
  spiel.zuege = bild.n;
  spiel.gewaehlt = null;
}

function merkeSchritt() {
  spiel.verlauf.push(abbild());
  if (spiel.verlauf.length > 400) spiel.verlauf.shift();
}

function speichereSpiel() {
  if (!spiel) return;
  try {
    localStorage.setItem(SPIEL_KEY, JSON.stringify({
      grad: spiel.grad,
      stand: abbild(),
      verlauf: spiel.verlauf,
      sekunden: elapsedSeconds,
    }));
  } catch (e) { /* voller Speicher soll das Spiel nicht anhalten */ }
}

function ladeSpiel() {
  try {
    const roh = localStorage.getItem(SPIEL_KEY);
    if (!roh) return null;
    const d = JSON.parse(roh);
    if (!d || !d.stand || !ZELLEN_JE_GRAD[d.grad]) return null;
    return d;
  } catch (e) { return null; }
}

function loescheSpiel() {
  try { localStorage.removeItem(SPIEL_KEY); } catch (e) { /* egal */ }
}

function ladeGrad() {
  try {
    const g = localStorage.getItem(GRAD_KEY);
    if (g && ZELLEN_JE_GRAD[g]) gewaehlterGrad = g;
  } catch (e) { /* egal */ }
}

function speichereGrad() {
  try { localStorage.setItem(GRAD_KEY, gewaehlterGrad); } catch (e) { /* egal */ }
}

/* ---------------------------------------------------------------------
   Größe und Lage

   Die Kartenbreite hängt an der Fensterbreite: Acht Spalten müssen
   nebeneinander passen, ob am Rechner oder auf dem Telefon. Die Höhe regelt
   nicht die Kartengröße, sondern der Versatz – wird eine Spalte lang,
   schieben sich die Karten enger übereinander, statt dass alles kleiner
   wird. Karten, die bei jedem Zug ihre Größe ändern, sind nicht zu ertragen.

   Und der Versatz wird nur kleiner, nie wieder größer: Sonst zappelte das
   ganze Tableau bei jedem Zug, der eine Spalte kürzt.

   Alles wird in Koordinaten innerhalb von `#feld` gerechnet. Die Karten
   liegen dort alle nebeneinander im Baum und werden per `transform`
   verschoben – dadurch fliegen sie von Platz zu Platz, statt zu springen.
   --------------------------------------------------------------------- */

function freierPlatz() {
  const kopf = document.getElementById("topbar");
  const fuss = document.getElementById("game-footer");
  const rand = handyAnsicht() ? 20 : 46;
  return {
    breite: Math.max(200, window.innerWidth - (handyAnsicht() ? 12 : 30)),
    hoehe: Math.max(200, window.innerHeight - kopf.offsetHeight - fuss.offsetHeight - rand),
  };
}

/** Die x-Koordinate der Spalte `s` – und damit auch der Felder darüber. */
function spaltenX(s) { return s * (masse.w + masse.luecke); }
function zelleX(i) { return spaltenX(i); }
/** Die Ablagen sitzen rechts, also auf den letzten vier Spalten. */
function basisX(f) { return spaltenX(SPALTEN - 4 + f); }

function passeGroesseAn() {
  if (!spiel) return;
  const platz = freierPlatz();

  const passend = platz.breite / TISCH_EINHEITEN;
  const w = Math.max(KARTE_MIN, Math.min(KARTE_MAX,
    autoGroesse ? passend : passend * zoomFaktor));
  const h = w * KARTE_VERHAELTNIS;
  const luecke = Math.max(3, w * LUECKE_ANTEIL);
  const titelHoehe = handyAnsicht() ? 12 : 15;
  const obenY = titelHoehe + 3;
  const tableauY = obenY + h + luecke + (handyAnsicht() ? 6 : 12);

  let laengste = 1;
  for (let i = 0; i < spiel.spalten.length; i++) {
    if (spiel.spalten[i].length > laengste) laengste = spiel.spalten[i].length;
  }
  const fuerTableau = Math.max(h, platz.hoehe - tableauY);
  let versatz = h * VERSATZ_MAX;
  if (laengste > 1) versatz = Math.min(versatz, (fuerTableau - h) / (laengste - 1));
  versatz = Math.max(versatz, h * VERSATZ_MIN);
  if (spiel.versatz !== null) versatz = Math.min(versatz, spiel.versatz);
  spiel.versatz = versatz;

  masse = {
    w: w, h: h, luecke: luecke, versatz: versatz,
    titelHoehe: titelHoehe, obenY: obenY, tableauY: tableauY,
    breite: SPALTEN * w + (SPALTEN - 1) * luecke,
  };

  const wurzel = document.documentElement;
  wurzel.style.setProperty("--card-w", w.toFixed(2) + "px");
  wurzel.style.setProperty("--card-h", h.toFixed(2) + "px");
  wurzel.style.setProperty("--card-gap", luecke.toFixed(2) + "px");
  wurzel.style.setProperty("--stapel-versatz", versatz.toFixed(2) + "px");

  document.getElementById("size-reset").textContent =
    autoGroesse ? "Passend" : Math.round(zoomFaktor * 100) + "%";

  legeKarten();
}

/* ---------------------------------------------------------------------
   Zeichnen
   --------------------------------------------------------------------- */

/** Schiebt eine Karte an ihren Platz. `extra` hängt sich an, etwa der Griff. */
function setzeKartenLage(el, x, y, extra) {
  el.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)" +
                       (extra ? " " + extra : "");
}

/** Der Inhalt einer Karte: Ecke, Farbzeichen, Ecke. */
function baueKarte(code) {
  const k = karteVon(code);
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.code = String(code);
  el.innerHTML =
    `<div class="card-front ${k.rot ? "red" : "black"}">` +
    `<div class="card-corner top">${k.label}${k.suit}</div>` +
    `<div class="card-center-suit">${k.suit}</div>` +
    `<div class="card-corner bottom">${k.label}${k.suit}</div>` +
    `</div>`;
  bindeZiehen(el, code);
  return el;
}

function baueFeld() {
  const feld = document.getElementById("feld");
  feld.innerHTML = "";
  kartenElemente.clear();
  zellenPlaetze = [];
  basenPlaetze = [];
  spaltenElemente = [];

  /* Beschriftung der beiden Gruppen. Bei vier Zellen füllen sie die Reihe
     genau aus, und acht gleich große Kästen nebeneinander sehen sonst aus
     wie acht Zellen. */
  const titelLinks = document.createElement("span");
  titelLinks.className = "gruppe-titel links";
  titelLinks.textContent = "Freie Zellen";
  feld.appendChild(titelLinks);

  const titelRechts = document.createElement("span");
  titelRechts.className = "gruppe-titel rechts";
  titelRechts.textContent = "Ablagen";
  feld.appendChild(titelRechts);

  function bauePlatz(klasse, titel, marke) {
    const p = document.createElement("div");
    p.className = "platz " + klasse;
    p.title = titel;
    const m = document.createElement("span");
    m.className = "platz-marke";
    m.textContent = marke;
    p.appendChild(m);
    p._marke = m;
    feld.appendChild(p);
    return p;
  }

  for (let i = 0; i < spiel.zellenAnzahl; i++) {
    const p = bauePlatz("zelle", "Freie Zelle", "");
    p.dataset.index = String(i);
    zellenPlaetze.push(p);
  }
  for (let f = 0; f < 4; f++) {
    const p = bauePlatz("basis", "Ablage " + FARBEN[f], FARBEN[f]);
    p.dataset.index = String(f);
    basenPlaetze.push(p);
  }
  for (let s = 0; s < SPALTEN; s++) {
    const sp = document.createElement("div");
    sp.className = "spalte";
    sp.dataset.index = String(s);
    feld.appendChild(sp);
    spaltenElemente.push(sp);
  }

  /* Die Karten zuletzt, damit sie über den Hinterlegungen liegen. */
  for (let code = 0; code < KARTEN; code++) {
    const el = baueKarte(code);
    feld.appendChild(el);
    kartenElemente.set(code, el);
  }
}

/**
 * Schiebt Hinterlegungen und Karten an ihre Plätze.
 *
 * Jede Karte bekommt eine Lage, auch die, die unter einer Ablagenkarte
 * begraben liegt – so ist das Bild allein aus dem Spielstand bestimmt und
 * hängt nicht davon ab, wo eine Karte vorher lag.
 */
function legeKarten() {
  if (!masse) return;
  /* Mitten im Ziehen hängen Karten an der Maus. Sie jetzt zurückzulegen
     würde sie dem Zeiger aus der Hand reißen. */
  if (zieh && zieh.aktiv) return;

  const feld = document.getElementById("feld");
  let unten = masse.tableauY + masse.h;

  zellenPlaetze.forEach((p, i) => {
    p.style.left = zelleX(i).toFixed(1) + "px";
    p.style.top = masse.obenY.toFixed(1) + "px";
  });
  basenPlaetze.forEach((p, f) => {
    p.style.left = basisX(f).toFixed(1) + "px";
    p.style.top = masse.obenY.toFixed(1) + "px";
  });

  spiel.spalten.forEach((spalte, s) => {
    const sl = spaltenElemente[s];
    const hoehe = masse.h + Math.max(0, spalte.length - 1) * masse.versatz;
    sl.style.left = spaltenX(s).toFixed(1) + "px";
    sl.style.top = masse.tableauY.toFixed(1) + "px";
    sl.style.height = hoehe.toFixed(1) + "px";
    if (masse.tableauY + hoehe > unten) unten = masse.tableauY + hoehe;

    spalte.forEach((code, i) => {
      const el = kartenElemente.get(code);
      setzeKartenLage(el, spaltenX(s), masse.tableauY + i * masse.versatz);
      el.style.zIndex = String(10 + i);
    });
  });

  spiel.zellen.forEach((code, i) => {
    const el = kartenElemente.get(code);
    setzeKartenLage(el, zelleX(i), masse.obenY);
    el.style.zIndex = "40";
  });

  const aufDemTisch = new Set();
  spiel.spalten.forEach((c) => c.forEach((code) => aufDemTisch.add(code)));
  spiel.zellen.forEach((code) => aufDemTisch.add(code));
  for (let code = 0; code < KARTEN; code++) {
    if (aufDemTisch.has(code)) continue;
    /* Alles Übrige liegt auf einer Ablage – nach Wert gestapelt, damit die
       höchste Karte oben liegt. */
    const el = kartenElemente.get(code);
    setzeKartenLage(el, basisX(farbeVon(code)), masse.obenY);
    el.style.zIndex = String(wertVon(code));
  }

  feld.style.width = masse.breite.toFixed(1) + "px";
  feld.style.height = (unten + 4).toFixed(1) + "px";
}

/**
 * Welche Karten gehören zur Auswahl?
 *
 * Bei einer Spalte ist das die angeklickte Karte und alles darunter, bei
 * einer Zelle die einzelne Karte.
 */
function auswahlKarten() {
  const gw = spiel.gewaehlt;
  if (!gw) return [];
  if (gw.art === "zelle") {
    const code = spiel.zellen[gw.index];
    return code === undefined ? [] : [code];
  }
  return spiel.spalten[gw.index].slice(gw.tiefe);
}

/**
 * Setzt Klassen: was beweglich ist, was gewählt ist, wohin es darf.
 *
 * Die Karten selbst werden nicht neu gebaut – sonst wäre jede Bewegung ohne
 * Übergang, und die Auswahl blinkte bei jedem Zug auf.
 */
function zeichne() {
  const auswahl = new Set(auswahlKarten());

  kartenElemente.forEach((el) => {
    el.classList.remove("beweglich", "gewaehlt", "zielbar", "verwehrt");
  });

  spiel.spalten.forEach((spalte, s) => {
    spaltenElemente[s].classList.toggle("belegt", spalte.length > 0);
    spalte.forEach((code, i) => {
      const el = kartenElemente.get(code);
      if (istFolge(spalte, i)) el.classList.add("beweglich");
      if (auswahl.has(code)) el.classList.add("gewaehlt");
    });
  });

  zellenPlaetze.forEach((p, i) => {
    const code = spiel.zellen[i];
    p.classList.toggle("belegt", code !== undefined);
    if (code === undefined) return;
    const el = kartenElemente.get(code);
    el.classList.add("beweglich");
    if (auswahl.has(code)) el.classList.add("gewaehlt");
  });

  basenPlaetze.forEach((p, f) => {
    const belegt = spiel.basen[f] > 0;
    p.classList.toggle("belegt", belegt);
    p._marke.classList.toggle("hidden", belegt);
  });

  zeigeZiele();

  const fertig = spiel.basen.reduce((a, b) => a + b, 0);
  setzeWert("zug-count", String(spiel.zuege));
  setzeWert("basis-count", String(fertig));
  setzeWert("frei-count", String(freieZellen()));
  document.getElementById("grad-label").textContent =
    GRAD_NAMEN[spiel.grad] + (handyAnsicht() ? "" : " · " + spiel.zellenAnzahl + " Zellen");
  document.getElementById("undo-btn").disabled = spiel.verlauf.length === 0;
}

/** Hebt hervor, wohin die Auswahl darf. */
function zeigeZiele() {
  zellenPlaetze.forEach((p) => p.classList.remove("moeglich"));
  basenPlaetze.forEach((p) => p.classList.remove("moeglich"));
  spaltenElemente.forEach((p) => p.classList.remove("moeglich"));

  const karten = auswahlKarten();
  if (karten.length === 0) return;
  const kopf = karten[0];

  if (karten.length === 1) {
    for (let i = 0; i < spiel.zellenAnzahl; i++) {
      if (spiel.zellen[i] === undefined) { zellenPlaetze[i].classList.add("moeglich"); break; }
    }
    if (passtAufBasis(kopf, spiel.basen)) {
      basenPlaetze[farbeVon(kopf)].classList.add("moeglich");
    }
  }

  for (let s = 0; s < SPALTEN; s++) {
    if (spiel.gewaehlt.art === "spalte" && spiel.gewaehlt.index === s) continue;
    if (!darfDorthin(karten, s)) continue;
    const c = spiel.spalten[s];
    if (c.length === 0) {
      spaltenElemente[s].classList.add("moeglich");
    } else {
      /* Bei einer belegten Spalte deckt der Stapel die Hinterlegung ganz ab –
         die Markierung muss also auf die Karte, auf die man legen würde.
         Sonst sieht man bei einer vollen Spalte überhaupt nicht, dass sie ein
         Ziel ist. */
      kartenElemente.get(c[c.length - 1]).classList.add("zielbar");
    }
  }
}

/* Ergebnisse des Durchspielens, solange die Stellung dieselbe ist. Ohne das
   liefe die Suche bei jeder Mausbewegung neu. */
let umlagerCache = { schluessel: null, treffer: null };

/**
 * Darf die Auswahl in Spalte `s`?
 *
 * Zwei Stufen. Erst die Formel: Sie zählt freie Zellen und leere Spalten und
 * ist blitzschnell – wenn sie den Zug erlaubt, ist er erlaubt.
 *
 * Sagt sie nein, heißt das noch nichts, denn sie ist nur eine untere
 * Schranke: Eine Zwischenkarte lässt sich auch auf einer passenden anderen
 * Spalte parken, und davon weiß die Formel nichts. Dann wird durchgespielt.
 * Gemessen war die Formel allein in zehn von 15.085 Mehrkartenzügen zu
 * streng – und genau die probiert man als Spieler, weil sie möglich
 * aussehen.
 */
function darfDorthin(karten, s) {
  const ziel = spiel.spalten[s];
  if (!passtAufSpalte(karten[0], ziel[ziel.length - 1])) return false;
  if (karten.length === 1) return true;
  if (karten.length <= hoechstensBewegbar(freieZellen(), leereSpalten(), ziel.length === 0)) {
    return true;
  }

  const gw = spiel.gewaehlt;
  if (!gw || gw.art !== "spalte") return false;   // aus einer Zelle kommt immer nur eine Karte

  const schluessel = standSchluessel();
  if (umlagerCache.schluessel !== schluessel) {
    umlagerCache = { schluessel: schluessel, treffer: new Map() };
  }
  const frage = gw.index + ":" + gw.tiefe + ">" + s;
  if (umlagerCache.treffer.has(frage)) return umlagerCache.treffer.get(frage);

  const geht = kannUmlagern(spiel.spalten, spiel.zellen, spiel.zellenAnzahl,
                            gw.index, gw.tiefe, s);
  umlagerCache.treffer.set(frage, geht);
  return geht;
}

function setzeWert(id, wert) {
  const el = document.getElementById(id);
  if (el.textContent === wert) return;
  el.textContent = wert;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 190);
}

/* ---------------------------------------------------------------------
   Anfassen und Ziehen

   Nach dem Vorbild von Spider, und zwar bis in die Kleinigkeiten, weil sich
   das dort gut anfühlt:

   Wohin eine Karte fällt, entscheidet die Stelle, nicht das getroffene
   Element. Wer über einer Spalte loslässt, legt in dieser Spalte ab – auch
   weit unter dem Stapel, wo überhaupt keine Karte mehr liegt. Alles andere
   ist unnötig streng: Man zielt auf die Spalte, nicht auf den Rand eines
   Kastens.

   Fällt die Karte nicht, fliegt sie zurück. Das kostet keinen Code – die
   Karten liegen alle im selben Kasten und werden per `transform` geschoben,
   also führt jedes Neuzeichnen die Karte weich an ihren Platz.
   --------------------------------------------------------------------- */

function bindeZiehen(el, code) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    /* Jedes neue Aufsetzen löscht das Merkzeichen für den Nachklapp-Klick.
       Der Zeitablauf allein genügt nicht: Bleibt der Klick nach einem Ziehen
       aus, verschluckte das Merkzeichen sonst den nächsten echten Klick,
       wenn er schnell genug kommt. */
    zogGerade = false;
    if (!spiel || zieh) return;

    const ort = findeKarte(code);
    if (!ort) return;                        // liegt auf einer Ablage
    if (ort.art === "spalte" && !istFolge(spiel.spalten[ort.index], ort.tiefe)) return;

    zieh = {
      zeigerId: e.pointerId,
      code: code,
      ort: ort,
      codes: ort.art === "zelle" ? [code] : spiel.spalten[ort.index].slice(ort.tiefe),
      startX: e.clientX,
      startY: e.clientY,
      aktiv: false,
      ziel: null,
    };
    /* Die Zeigererfassung hält die Bewegungen bei dieser Karte, auch wenn
       der Zeiger sie verlässt. Sie kann fehlschlagen – dann wird eben nur
       gezogen, solange der Zeiger über der Karte bleibt; einen Abbruch der
       ganzen Behandlung ist das nicht wert. */
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* dann ohne */ }
  });

  el.addEventListener("pointermove", (e) => {
    if (!zieh || zieh.zeigerId !== e.pointerId) return;

    if (!zieh.aktiv) {
      if (Math.abs(e.clientX - zieh.startX) < ZIEH_SCHWELLE &&
          Math.abs(e.clientY - zieh.startY) < ZIEH_SCHWELLE) return;
      starteZiehen();
    }

    const rect = document.getElementById("feld").getBoundingClientRect();
    const x = e.clientX - rect.left - zieh.griffX;
    const y = e.clientY - rect.top - zieh.griffY;
    zieh.codes.forEach((c, i) => {
      setzeKartenLage(kartenElemente.get(c), x, y + i * zieh.versatz,
                      "scale(1.04) rotate(1.5deg)");
    });

    zieh.ziel = zielAusPunkt(e.clientX, e.clientY);
    hebeZielHervor(zieh.ziel);
  });

  el.addEventListener("pointerup", (e) => {
    if (!zieh || zieh.zeigerId !== e.pointerId) return;
    beendeZiehen();
  });

  el.addEventListener("pointercancel", (e) => {
    if (!zieh || zieh.zeigerId !== e.pointerId) return;
    brichZiehenAb();
  });

  el.addEventListener("click", (e) => {
    /* Der Klick nach einem Ziehen ist schon erledigt. */
    e.stopPropagation();
    if (zogGerade) { zogGerade = false; return; }
    aufKarte(code);
  });
}

function starteZiehen() {
  zieh.aktiv = true;

  const erste = kartenElemente.get(zieh.codes[0]);
  const r = erste.getBoundingClientRect();
  zieh.griffX = zieh.startX - r.left;
  zieh.griffY = zieh.startY - r.top;
  /* Beim Ziehen fächern die Karten so weit auf, wie sie es in einer kurzen
     Spalte täten – so sieht der Griff immer gleich aus. */
  zieh.versatz = masse.h * VERSATZ_MAX;

  /* Die Auswahl setzen, damit die möglichen Ziele mit derselben Rechnung
     leuchten wie beim Klicken. */
  spiel.gewaehlt = zieh.ort.art === "zelle"
    ? { art: "zelle", index: zieh.ort.index }
    : { art: "spalte", index: zieh.ort.index, tiefe: zieh.ort.tiefe };
  zeichne();

  zieh.codes.forEach((c, i) => {
    const k = kartenElemente.get(c);
    k.classList.add("zieht");
    k.style.zIndex = String(600 + i);
  });
}

/**
 * Welches Ziel liegt an dieser Stelle?
 *
 * Gerechnet wird aus der Stelle im Feld, nicht aus dem getroffenen Element:
 * Die Spalte ergibt sich aus x, und alles unterhalb der oberen Reihe gehört
 * zum Tableau – gleich, ob dort noch eine Karte liegt.
 */
function zielAusPunkt(clientX, clientY) {
  if (!masse) return null;
  const rect = document.getElementById("feld").getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const spalte = Math.floor(x / (masse.w + masse.luecke));
  if (spalte < 0 || spalte >= SPALTEN) return null;
  /* Ein Griff daneben soll nicht in der Nachbarspalte landen. */
  if (x > masse.breite + masse.w * 0.5) return null;

  /* Die obere Reihe reicht genau so weit, wie ihre Felder reichen. Alles
     darunter gehört zum Tableau – auch die Lücke davor. Läge die Grenze auf
     halbem Weg, landete eine Folge, die knapp über der ersten Karte einer
     Spalte losgelassen wird, in einer Zelle: "geht nicht", weil in eine
     Zelle nur eine Karte passt. */
  if (y < masse.obenY + masse.h) {
    if (spalte < spiel.zellenAnzahl) return { art: "zelle", index: spalte };
    if (spalte >= SPALTEN - 4) return { art: "basis", index: spalte - (SPALTEN - 4) };
    return null;
  }
  return { art: "spalte", index: spalte };
}

/** Darf die gezogene Auswahl dort hin? */
function zielErlaubt(ziel) {
  if (!ziel) return false;
  const karten = auswahlKarten();
  if (karten.length === 0) return false;
  if (ziel.art === "zelle") {
    return karten.length === 1 && spiel.zellen[ziel.index] === undefined;
  }
  if (ziel.art === "basis") {
    return karten.length === 1 && farbeVon(karten[0]) === ziel.index &&
           passtAufBasis(karten[0], spiel.basen);
  }
  if (spiel.gewaehlt.art === "spalte" && spiel.gewaehlt.index === ziel.index) return false;
  return darfDorthin(karten, ziel.index);
}

function hebeZielHervor(ziel) {
  raeumeZielHervor();
  if (!ziel) return;

  /* Über der eigenen Spalte wird nichts markiert. Dort loszulassen heißt
     zurücklegen, und das ist kein Fehler – es rot anzustreichen behauptet,
     ein erlaubter Zug sei verboten. Beim Aufnehmen fährt der Zeiger aber
     zwangsläufig zuerst über die eigene Spalte. */
  if (ziel.art === "spalte" && spiel.gewaehlt &&
      spiel.gewaehlt.art === "spalte" && spiel.gewaehlt.index === ziel.index) return;

  const erlaubt = zielErlaubt(ziel);

  if (ziel.art === "spalte") {
    const c = spiel.spalten[ziel.index];
    if (c.length > 0) {
      /* Auch hier: die Karte markieren, nicht die verdeckte Hinterlegung. */
      const k = kartenElemente.get(c[c.length - 1]);
      if (k) k.classList.add(erlaubt ? "zielbar" : "verwehrt");
      spaltenElemente[ziel.index].classList.add(erlaubt ? "ueber" : "ueber-nein");
      return;
    }
  }

  const el = ziel.art === "spalte" ? spaltenElemente[ziel.index]
           : ziel.art === "zelle" ? zellenPlaetze[ziel.index]
           : basenPlaetze[ziel.index];
  if (!el) return;
  el.classList.add(erlaubt ? "ueber" : "ueber-nein");
}

function raeumeZielHervor() {
  const weg = (el) => el.classList.remove("ueber", "ueber-nein");
  spaltenElemente.forEach(weg);
  zellenPlaetze.forEach(weg);
  basenPlaetze.forEach(weg);
  kartenElemente.forEach((el) => el.classList.remove("verwehrt"));
}

function beendeZiehen() {
  const aktiv = zieh.aktiv;
  const codes = zieh.codes;
  const ziel = zieh.ziel;
  zieh = null;

  if (!aktiv) return;        // nur getippt – den Klick macht der Browser

  merkeNachklapp();
  codes.forEach((c) => kartenElemente.get(c).classList.remove("zieht"));
  raeumeZielHervor();

  const zuegeVorher = spiel.zuege;
  if (zielErlaubt(ziel)) {
    if (ziel.art === "zelle") aufZelle(ziel.index);
    else if (ziel.art === "basis") aufBasis(ziel.index);
    else aufSpalte(ziel.index);
  }
  /* Ging der Zug nicht, fliegen die Karten zurück – das erledigt das
     Neuzeichnen von selbst, weil die Lage per `transform` gesetzt wird. */
  if (spiel.zuege === zuegeVorher) spiel.gewaehlt = null;
  passeGroesseAn();
  zeichne();
}

function brichZiehenAb() {
  const aktiv = zieh.aktiv;
  const codes = zieh.codes;
  zieh = null;
  if (!aktiv) return;
  merkeNachklapp();
  codes.forEach((c) => kartenElemente.get(c).classList.remove("zieht"));
  raeumeZielHervor();
  spiel.gewaehlt = null;
  passeGroesseAn();
  zeichne();
}

/** Merkt vor, dass der nächste Klick nur der Nachklapp des Ziehens ist. */
function merkeNachklapp() {
  zogGerade = true;
  setTimeout(() => { zogGerade = false; }, NACHKLAPP_MS);
}

/* ---------------------------------------------------------------------
   Spielen
   --------------------------------------------------------------------- */

function loescheHinweis() {
  clearTimeout(hinweisTimer);
  kartenElemente.forEach((el) => el.classList.remove("hinweis"));
  zellenPlaetze.forEach((p) => p.classList.remove("hinweis"));
  basenPlaetze.forEach((p) => p.classList.remove("hinweis"));
  spaltenElemente.forEach((p) => p.classList.remove("hinweis"));
}

function blitze(codes) {
  codes.forEach((code) => {
    const el = kartenElemente.get(code);
    if (!el) return;
    el.classList.remove("daneben");
    void el.offsetWidth;
    el.classList.add("daneben");
    setTimeout(() => el.classList.remove("daneben"), 460);
  });
}

/** Wo liegt diese Karte gerade? */
function findeKarte(code) {
  const z = spiel.zellen.indexOf(code);
  if (z !== -1) return { art: "zelle", index: z };
  for (let s = 0; s < SPALTEN; s++) {
    const i = spiel.spalten[s].indexOf(code);
    if (i !== -1) return { art: "spalte", index: s, tiefe: i };
  }
  return null;   // liegt auf einer Ablage
}

/**
 * Ein Klick auf eine Karte.
 *
 * Liegt schon etwas in der Hand, ist jeder Klick auf eine andere Karte ein
 * Ablegen an deren Ort – gleich, welche Karte des Stapels man trifft. Auch
 * das ist von Spider übernommen: Man zielt auf die Spalte, nicht auf die
 * eine richtige Karte darin.
 */
function aufKarte(code) {
  if (!spiel) return;
  loescheHinweis();
  const ort = findeKarte(code);

  if (spiel.gewaehlt) {
    const eigene = auswahlKarten();
    if (eigene.indexOf(code) !== -1) { spiel.gewaehlt = null; zeichne(); return; }
    if (!ort) { aufBasis(farbeVon(code)); return; }        // Karte liegt auf einer Ablage
    if (ort.art === "zelle") { aufZelle(ort.index); return; }
    aufSpalte(ort.index);
    return;
  }

  if (!ort) return;                     // auf der Ablage: da geht nichts mehr

  if (ort.art === "zelle") {
    spiel.gewaehlt = { art: "zelle", index: ort.index };
    zeichne();
    return;
  }

  if (!istFolge(spiel.spalten[ort.index], ort.tiefe)) {
    blitze([code]);
    return;
  }
  spiel.gewaehlt = { art: "spalte", index: ort.index, tiefe: ort.tiefe };
  zeichne();
}

/** Ein Klick auf eine Stelle im Feld, an der keine Karte liegt. */
function aufStelle(ziel) {
  if (!spiel) return;
  loescheHinweis();
  if (!ziel) { spiel.gewaehlt = null; zeichne(); return; }
  if (ziel.art === "zelle") aufZelle(ziel.index);
  else if (ziel.art === "basis") aufBasis(ziel.index);
  else aufSpalte(ziel.index);
}

function aufZelle(i) {
  if (!spiel) return;
  loescheHinweis();
  if (!spiel.gewaehlt) {
    if (spiel.zellen[i] !== undefined) aufKarte(spiel.zellen[i]);
    return;
  }
  const karten = auswahlKarten();
  if (karten.length !== 1 || spiel.zellen[i] !== undefined) { blitze(karten); return; }
  fuehreZugAus(() => {
    entferneAuswahl();
    spiel.zellen.push(karten[0]);
  });
}

function aufBasis(f) {
  if (!spiel) return;
  loescheHinweis();
  if (!spiel.gewaehlt) return;
  const karten = auswahlKarten();
  if (karten.length !== 1 || farbeVon(karten[0]) !== f ||
      !passtAufBasis(karten[0], spiel.basen)) {
    blitze(karten);
    return;
  }
  fuehreZugAus(() => {
    entferneAuswahl();
    spiel.basen[f] = wertVon(karten[0]);
  });
}

function aufSpalte(s) {
  if (!spiel) return;
  loescheHinweis();
  if (!spiel.gewaehlt) {
    const spalte = spiel.spalten[s];
    if (spalte.length) aufKarte(spalte[spalte.length - 1]);
    return;
  }
  if (spiel.gewaehlt.art === "spalte" && spiel.gewaehlt.index === s) {
    spiel.gewaehlt = null;
    zeichne();
    return;
  }
  const karten = auswahlKarten();
  if (!darfDorthin(karten, s)) { blitze(karten); return; }
  fuehreZugAus(() => {
    entferneAuswahl();
    for (let i = 0; i < karten.length; i++) spiel.spalten[s].push(karten[i]);
  });
}

/** Nimmt die gewählten Karten von ihrem Platz weg. */
function entferneAuswahl() {
  const gw = spiel.gewaehlt;
  if (gw.art === "zelle") spiel.zellen.splice(gw.index, 1);
  else spiel.spalten[gw.index].length = gw.tiefe;
}

/**
 * Führt einen Zug aus: merken, ändern, nachsehen.
 *
 * Von selbst wird hier nichts abgelegt. Es gab einmal ein automatisches
 * Aufräumen – Karten, die unten nachweislich nicht mehr gebraucht werden,
 * wanderten allein auf ihre Ablage. Bequem, aber es nimmt einem das Spiel
 * aus der Hand: Auf einmal liegen Karten oben, die man nicht dorthin gelegt
 * hat. Jede Karte geht jetzt nur, wenn man sie schickt.
 */
function fuehreZugAus(aenderung) {
  merkeSchritt();
  aenderung();
  spiel.gewaehlt = null;
  spiel.zuege += 1;
  passeGroesseAn();
  zeichne();
  speichereSpiel();
  pruefeStand();
}

function pruefeStand() {
  const fertig = spiel.basen.reduce((a, b) => a + b, 0);
  if (fertig === KARTEN) { zeigeEnde(true); return; }
  if (!zugMoeglich(spiel.spalten, spiel.zellen, spiel.basen, spiel.zellenAnzahl)) {
    zeigeEnde(false);
  }
}

/* Budget für den Hinweis. Bei diesem Wert antwortet er meist in einem
   Wimpernschlag; der ungünstigste gemessene Fall lag bei etwa einer Sekunde,
   und so lange darf ein Knopf denken. */
const HINWEIS_KNOTEN = 40000;

/**
 * Zeigt einen Zug, der weiterhilft – und zwar wirklich.
 *
 * Gefragt wird der Löser. Er gibt nicht einen Zug zurück, sondern den ganzen
 * Weg zum Sieg; der wird aufbewahrt. Solange die Stellung zu einem Schritt
 * dieses Plans passt, kommt der nächste Zug daraus – ohne neue Suche und, was
 * wichtiger ist, ohne im Kreis zu laufen.
 *
 * Wer vom Plan abweicht, bekommt beim nächsten Druck einen neuen. Und wer
 * einen Zug zurücknimmt, landet wieder auf einem früheren Schritt des alten
 * Plans – deshalb wird die ganze Liste der Zwischenstände durchsucht und
 * nicht nur der nächste erwartet.
 *
 * Die erste Fassung riet nach Faustregeln: erst auf die Ablage, dann aus den
 * Zellen, dann irgendetwas im Tableau. Das sah vernünftig aus, war es aber
 * nicht – wer ihr hundertzwanzig Züge lang folgte, hatte eine Karte abgelegt
 * und die übrigen einundfünfzig hin- und hergeschoben. Sie bleibt als
 * Notnagel für Stellungen, in denen der Löser nichts findet.
 */
function sucheHinweis() {
  /* Erst das Offensichtliche: Liegt ein Ass frei, gehört es nach oben.
     Das ist nicht nur bequem, sondern nötig. Der Löser räumt intern immer
     zuerst alle gefahrlosen Basiszüge ab und rechnet von dort weiter – seine
     Zugbeschreibungen passen also auf ein aufgeräumtes Brett. Das Spiel legt
     von selbst nichts ab, also ist das Brett das oft nicht, und dann zeigte
     der Hinweis auf Spalten, deren oberste Karte in seiner Rechnung längst
     abgelegt war. */
  const sofort = offenerBasiszug();
  if (sofort) return sofort;

  const jetzt = standSchluessel();

  if (spiel.plan) {
    const i = spiel.plan.staende.indexOf(jetzt);
    if (i !== -1 && i < spiel.plan.zuege.length) return uebersetzeZug(spiel.plan.zuege[i]);
  }

  const ergebnis = suche(spiel.spalten, spiel.zellen, spiel.basen,
                         spiel.zellenAnzahl, HINWEIS_KNOTEN);
  if (!ergebnis.gewonnen || ergebnis.zuege.length === 0) {
    spiel.plan = null;
    return sucheHinweisNachFaustregel();
  }

  /* Den Plan einmal durchrechnen und die Zwischenstände merken, damit sich
     später wiedererkennen lässt, wo im Plan man steht. */
  const staende = [jetzt];
  let sp = spiel.spalten, ze = spiel.zellen, ba = spiel.basen;
  for (let i = 0; i < ergebnis.zuege.length; i++) {
    const nach = wendeZugAn(sp, ze, ba, ergebnis.zuege[i]);
    sp = nach.spalten; ze = nach.zellen; ba = nach.basen;
    staende.push(schluesselVon(sp, ze, ba));
  }
  spiel.plan = { zuege: ergebnis.zuege, staende: staende };
  return uebersetzeZug(ergebnis.zuege[0]);
}

/**
 * Der gefahrlose Basiszug, der gerade offensteht – oder `null`.
 *
 * Dieselbe Regel, mit der der Löser intern aufräumt: eine Karte, die unten
 * nachweislich nicht mehr als Unterlage gebraucht wird.
 */
function offenerBasiszug() {
  for (let i = 0; i < spiel.zellen.length; i++) {
    const k = spiel.zellen[i];
    if (sicherAufBasis(k, spiel.basen)) {
      return { karten: [k], ziel: { art: "basis", index: farbeVon(k) } };
    }
  }
  for (let s = 0; s < SPALTEN; s++) {
    const c = spiel.spalten[s];
    if (c.length === 0) continue;
    const oben = c[c.length - 1];
    if (sicherAufBasis(oben, spiel.basen)) {
      return { karten: [oben], ziel: { art: "basis", index: farbeVon(oben) } };
    }
  }
  return null;
}

/** Ein kurzer Schlüssel für eine Stellung – zum Wiedererkennen im Plan. */
function schluesselVon(spalten, zellen, basen) {
  return spalten.map((c) => c.join(",")).join("|") + "/" +
         zellen.slice().sort((a, b) => a - b).join(",") + "/" + basen.join(",");
}

function standSchluessel() {
  return schluesselVon(spiel.spalten, spiel.zellen, spiel.basen);
}

/**
 * Macht aus der Zugbeschreibung des Lösers Karten und ein Ziel.
 *
 * Der Löser zählt Karten von unten – "die letzten drei dieser Spalte" –,
 * die Oberfläche denkt in Tiefen. Hier wird umgerechnet.
 */
function uebersetzeZug(zug) {
  const karten = zug.art === "zelle"
    ? [spiel.zellen[zug.index]]
    : spiel.spalten[zug.index].slice(spiel.spalten[zug.index].length - zug.anzahl);
  return { karten: karten, ziel: zug.ziel };
}

function sucheHinweisNachFaustregel() {
  const kandidaten = [];

  for (let s = 0; s < SPALTEN; s++) {
    const c = spiel.spalten[s];
    if (!c.length) continue;
    const karte = c[c.length - 1];
    if (passtAufBasis(karte, spiel.basen)) {
      kandidaten.push({ rang: 1000, karten: [karte], ziel: { art: "basis", index: farbeVon(karte) } });
    }
  }
  for (let i = 0; i < spiel.zellen.length; i++) {
    const karte = spiel.zellen[i];
    if (passtAufBasis(karte, spiel.basen)) {
      kandidaten.push({ rang: 1000, karten: [karte], ziel: { art: "basis", index: farbeVon(karte) } });
    }
    for (let s = 0; s < SPALTEN; s++) {
      const ziel = spiel.spalten[s];
      if (ziel.length && passtAufSpalte(karte, ziel[ziel.length - 1])) {
        kandidaten.push({ rang: 700, karten: [karte], ziel: { art: "spalte", index: s } });
      }
    }
  }
  for (let q = 0; q < SPALTEN; q++) {
    const von = spiel.spalten[q];
    for (let t = 0; t < von.length; t++) {
      if (!istFolge(von, t)) continue;
      const karten = von.slice(t);
      const raeumtLeer = t === 0;
      for (let s = 0; s < SPALTEN; s++) {
        if (s === q) continue;
        const ziel = spiel.spalten[s];
        if (!passtAufSpalte(karten[0], ziel[ziel.length - 1])) continue;
        if (ziel.length === 0 && raeumtLeer) continue;
        if (karten.length > hoechstensBewegbar(freieZellen(), leereSpalten(), ziel.length === 0) &&
            !kannUmlagern(spiel.spalten, spiel.zellen, spiel.zellenAnzahl, q, t, s)) continue;
        kandidaten.push({
          rang: (raeumtLeer ? 500 : 0) + (ziel.length ? 300 : 100) + karten.length,
          karten: karten, ziel: { art: "spalte", index: s },
        });
      }
      break;   // nur die längste Folge je Spalte
    }
  }

  if (kandidaten.length === 0) return null;
  kandidaten.sort((a, b) => b.rang - a.rang);
  return kandidaten[0];
}

function zeigeHinweis() {
  if (!spiel) return;
  loescheHinweis();
  const zug = sucheHinweis();
  if (!zug) {
    meldeAmKnopf("hint-btn", '<span class="icon">✗</span>Kein Zug frei', "result-bad");
    return;
  }
  zug.karten.forEach((code) => {
    const el = kartenElemente.get(code);
    if (el) el.classList.add("hinweis");
  });
  if (zug.ziel.art === "basis") {
    basenPlaetze[zug.ziel.index].classList.add("hinweis");
  } else if (zug.ziel.art === "zelle") {
    /* Der Löser nennt keinen bestimmten Platz – der erste freie tut es. */
    for (let i = 0; i < spiel.zellenAnzahl; i++) {
      if (spiel.zellen[i] === undefined) { zellenPlaetze[i].classList.add("hinweis"); break; }
    }
  } else {
    spaltenElemente[zug.ziel.index].classList.add("hinweis");
  }
  hinweisTimer = setTimeout(loescheHinweis, HINWEIS_MS);
}

function nimmZurueck() {
  if (!spiel || spiel.verlauf.length === 0) return;
  loescheHinweis();
  stelleHer(spiel.verlauf.pop());
  passeGroesseAn();
  zeichne();
  speichereSpiel();
  versteckeEnde();
  if (!timerInterval) starteTimer(elapsedSeconds);
}

function meldeAmKnopf(id, html, klasse) {
  const btn = document.getElementById(id);
  if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
  clearTimeout(btn._timer);
  btn.classList.remove("result-ok", "result-bad");
  btn.classList.add(klasse);
  btn.innerHTML = html;
  btn._timer = setTimeout(() => {
    btn.classList.remove("result-ok", "result-bad");
    btn.innerHTML = btn.dataset.originalHtml;
  }, 2400);
}

/* ---------------------------------------------------------------------
   Blatt ausgeben

   Bei "Leicht" ist das eine Sache von Millisekunden. Bei "Schwer" mit zwei
   Zellen fällt die Mehrheit der Blätter durch, und das Rechnen dauert –
   deshalb läuft es in Scheiben mit einer Notiz auf dem Schirm, statt die
   Seite einzufrieren.
   --------------------------------------------------------------------- */

const AUSGABE_KNOTEN = 60000;
const AUSGABE_ZEIT_MAX = 12000;

function zeigeDealHinweis(an) {
  document.getElementById("deal-hinweis").classList.toggle("hidden", !an);
}

/**
 * Sucht in Scheiben ein lösbares Blatt und meldet es über `fertig`.
 *
 * Meldet `null`, wenn in der Zeit keines gefunden wurde – der Aufrufer nimmt
 * dann ein gewöhnliches Blatt und sagt das auch.
 */
function gibBlattAus(grad, fertig) {
  const zellen = ZELLEN_JE_GRAD[grad];
  const ende = Date.now() + AUSGABE_ZEIT_MAX;

  function scheibe() {
    const bis = Date.now() + 90;
    do {
      const spalten = teileAus(mischeCodes(Math.random));
      if (istLoesbar(spalten, zellen, AUSGABE_KNOTEN)) { fertig(spalten); return; }
    } while (Date.now() < bis);

    if (Date.now() > ende) { fertig(null); return; }
    setTimeout(scheibe, 0);
  }

  scheibe();
}

/* ---------------------------------------------------------------------
   Anfang und Ende
   --------------------------------------------------------------------- */

function neuesSpiel(grad) {
  if (teiltAus) return;
  teiltAus = true;
  gewaehlterGrad = grad;
  speichereGrad();
  versteckeEnde();
  stoppeTimer();
  zeigeDealHinweis(true);

  gibBlattAus(grad, (spalten) => {
    zeigeDealHinweis(false);
    teiltAus = false;
    const notfall = !spalten;
    if (notfall) spalten = teileAus(mischeCodes(Math.random));

    spiel = {
      grad: grad,
      zellenAnzahl: ZELLEN_JE_GRAD[grad],
      spalten: spalten,
      zellen: [],
      basen: [0, 0, 0, 0],
      zuege: 0,
      verlauf: [],
      gewaehlt: null,
      versatz: null,
      plan: null,
    };
    merkeGestartet(grad);
    autoGroesse = true;
    zoomFaktor = 1;
    baueFeld();
    passeGroesseAn();
    zeichne();
    starteTimer(0);
    speichereSpiel();
    if (notfall) {
      meldeAmKnopf("hint-btn", '<span class="icon">!</span>Ungeprüftes Blatt', "result-bad");
    }
  });
}

function starteSpiel(grad) {
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  neuesSpiel(grad);
}

function setzeSpielFort() {
  const d = ladeSpiel();
  if (!d) return;
  spiel = {
    grad: d.grad,
    zellenAnzahl: ZELLEN_JE_GRAD[d.grad],
    spalten: [],
    zellen: [],
    basen: [0, 0, 0, 0],
    zuege: 0,
    verlauf: d.verlauf || [],
    gewaehlt: null,
    versatz: null,
    plan: null,
  };
  stelleHer(d.stand);
  gewaehlterGrad = d.grad;
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  autoGroesse = true;
  zoomFaktor = 1;
  baueFeld();
  passeGroesseAn();
  zeichne();
  versteckeEnde();
  starteTimer(d.sekunden || 0);
}

function zurueckZurAuswahl() {
  stoppeTimer();
  versteckeEnde();
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  zeigeStatsTabelle();
  zeigeFortsetzen();
}

function starteTimer(startSekunden) {
  stoppeTimer();
  elapsedSeconds = startSekunden;
  document.getElementById("timer").textContent = formatiereZeit(elapsedSeconds);
  timerInterval = setInterval(() => {
    elapsedSeconds += 1;
    document.getElementById("timer").textContent = formatiereZeit(elapsedSeconds);
    if (elapsedSeconds % 10 === 0) speichereSpiel();
  }, 1000);
}

function stoppeTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function versteckeEnde() {
  const o = document.getElementById("end-overlay");
  o.classList.add("hidden");
  o.classList.remove("ist-verloren");
  document.getElementById("confetti-layer").innerHTML = "";
}

function zeigeEnde(gewonnen) {
  stoppeTimer();
  const o = document.getElementById("end-overlay");
  o.classList.remove("hidden");
  o.classList.toggle("ist-verloren", !gewonnen);

  document.getElementById("end-title").innerHTML = gewonnen
    ? 'Geschafft! <span class="win-suits">♠ ♥ ♦ ♣</span>'
    : "Festgefahren";
  document.getElementById("end-text").textContent = gewonnen
    ? `Alle 52 Karten abgelegt – ${GRAD_NAMEN[spiel.grad]} mit ${spiel.zellenAnzahl} Zellen, ` +
      `in ${formatiereZeit(elapsedSeconds)} und ` +
      `${spiel.zuege} ${spiel.zuege === 1 ? "Zug" : "Zügen"}.`
    : "Kein erlaubter Zug mehr übrig. Das Blatt war zu schaffen – " +
      "nimm ein paar Züge zurück und probiere einen anderen Weg.";
  document.getElementById("end-label").textContent = gewonnen ? "Nächste Runde:" : "Neu anfangen:";
  document.getElementById("end-undo-btn").classList.toggle("hidden",
    gewonnen || spiel.verlauf.length === 0);

  if (gewonnen) {
    merkeGewonnen(spiel.grad, elapsedSeconds);
    loescheSpiel();
    setTimeout(streueKonfetti, 120);
  }
}

function streueKonfetti() {
  const schicht = document.getElementById("confetti-layer");
  const farben = ["#f2c94c", "#eef3ef", "#3fae6a", "#d1453b", "#5aa9e6"];
  for (let i = 0; i < 90; i++) {
    const st = document.createElement("div");
    st.className = "confetti-piece";
    st.style.left = Math.random() * 100 + "%";
    st.style.background = farben[Math.floor(Math.random() * farben.length)];
    st.style.animationDuration = (1.9 + Math.random() * 1.6) + "s";
    st.style.animationDelay = (Math.random() * 0.5) + "s";
    schicht.appendChild(st);
  }
}

function zeigeFortsetzen() {
  const btn = document.getElementById("continue-btn");
  const d = ladeSpiel();
  if (!d) { btn.classList.add("hidden"); return; }
  const basen = d.stand.b.split(",").map(Number);
  const fertig = basen.reduce((a, b) => a + b, 0);
  document.getElementById("continue-meta").textContent =
    GRAD_NAMEN[d.grad] + " · " + fertig + "/52 abgelegt · " +
    d.stand.n + " Züge · " + formatiereZeit(d.sekunden || 0);
  btn.classList.remove("hidden");
}

/* ---------------------------------------------------------------------
   Verdrahtung
   --------------------------------------------------------------------- */

document.querySelectorAll(".start-btn").forEach((btn) => {
  btn.addEventListener("click", () => starteSpiel(btn.dataset.grad));
});

document.querySelectorAll(".end-grad-btn").forEach((btn) => {
  btn.addEventListener("click", () => neuesSpiel(btn.dataset.grad));
});

document.getElementById("stats-reset").addEventListener("click", () => {
  speichereStats({});
  zeigeStatsTabelle();
});

document.getElementById("continue-btn").addEventListener("click", setzeSpielFort);
document.getElementById("game-title").addEventListener("click", zurueckZurAuswahl);
document.getElementById("hint-btn").addEventListener("click", zeigeHinweis);
document.getElementById("undo-btn").addEventListener("click", nimmZurueck);
document.getElementById("new-game-btn").addEventListener("click", () => {
  neuesSpiel(spiel ? spiel.grad : gewaehlterGrad);
});
document.getElementById("end-undo-btn").addEventListener("click", nimmZurueck);
document.getElementById("end-start-btn").addEventListener("click", zurueckZurAuswahl);

document.getElementById("size-down").addEventListener("click", () => {
  autoGroesse = false;
  zoomFaktor /= ZOOM_SCHRITT;
  passeGroesseAn();
});
document.getElementById("size-up").addEventListener("click", () => {
  autoGroesse = false;
  zoomFaktor *= ZOOM_SCHRITT;
  passeGroesseAn();
});
document.getElementById("size-reset").addEventListener("click", () => {
  autoGroesse = true;
  zoomFaktor = 1;
  passeGroesseAn();
});

/* Ein Klick irgendwo im Feld gilt für die Stelle, nicht für das getroffene
   Element: unter dem Stapel einer Spalte ebenso wie auf ihrer Karte. */
document.getElementById("feld").addEventListener("click", (e) => {
  if (!spiel) return;
  e.stopPropagation();
  if (zogGerade) { zogGerade = false; return; }
  aufStelle(zielAusPunkt(e.clientX, e.clientY));
});

/* Daneben geklickt: Auswahl aufheben, sonst klebt sie. */
document.getElementById("board").addEventListener("click", () => {
  if (!spiel || !spiel.gewaehlt) return;
  spiel.gewaehlt = null;
  zeichne();
});

window.addEventListener("resize", () => {
  if (!spiel) return;
  if (autoGroesse) passeGroesseAn();
  zeichne();
});

document.addEventListener("keydown", (e) => {
  if (!spiel || document.getElementById("game-screen").classList.contains("hidden")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); nimmZurueck(); }
  else if (e.key === "h") zeigeHinweis();
  else if (e.key === "Escape" && spiel.gewaehlt) { spiel.gewaehlt = null; zeichne(); }
});

ladeGrad();
zeigeStatsTabelle();
zeigeFortsetzen();
