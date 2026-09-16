"use strict";

/* =====================================================================
   Wordle · Oberfläche

   Die Regeln stehen in ../wortraten/regeln.js, die Wörter daneben in
   woerter.js – beides teilt sich Wordle mit Quordle. Hier geht es um
   sechs Zeilen zu fünf Feldern, eine Tastatur darunter und den Stand
   der drei Tagesrätsel.

   Eine Sache weicht bewusst vom Vorbild ab: Getippt wird nicht stur von
   links nach rechts. Wer schon weiß, dass an dritter Stelle ein E steht,
   soll es dort hinschreiben können, ohne sich vorher zwei Buchstaben
   auszudenken. Dafür gibt es eine Schreibmarke, die sich anklicken und
   mit den Pfeiltasten verschieben lässt; getippt wird immer dort, und
   danach springt sie auf das nächste freie Feld.
   ===================================================================== */

/* Was dieses Spiel ausmacht; die Regeln selbst stehen in
   ../wortraten/regeln.js und gelten fuer Quordle genauso. */
const SPIEL = "wordle";
const VERSUCHE_MAX = 6;
const RAETSEL_PRO_TAG = 3;

const STATS_KEY = "wordleStats";
const VERLAUF_KEY = "wordleVerlauf";
const SPIEL_KEY = "wordleSpiel";

/* So lange bleibt eine Meldung stehen. */
const MELDUNG_MS = 2400;

/* Der Stand des Tages: die Rätsel mit ihren bisherigen Versuchen. */
let tag = null;
let runde = 0;
let raetsel = [];

/* Welches Rätsel gerade offen ist. Die Eingabezeile samt Schreibmarke
   steckt in ../wortraten/eingabe.js – Quordle tippt genauso. */
let aktuell = 0;
const eingabe = macheEingabezeile(WORTLAENGE);

let meldungTimer = null;
/* Läuft gerade die Aufdeck-Bewegung einer Zeile? Solange nimmt das Feld
   keine Eingaben an, sonst überholt der nächste Versuch die Animation. */
let deckeAuf = false;
/* Welche Zeile dabei noch verdeckt ist, oder -1. Ihre Farben und ihr
   Beitrag zur Tastatur kommen erst, wenn sich die Felder gedreht haben –
   sonst stünde die Antwort schon da, bevor die Bewegung anfängt. */
let verdeckteZeile = -1;

/* Gezählt wird in ../wortraten/statistik.js – Quordle führt dieselben
   Zahlen unter eigenen Schlüsseln, und die Tabelle sieht gleich aus. */
const statistik = macheStatistik(STATS_KEY, VERLAUF_KEY);

/* ---------------------------------------------------------------------
   Spielstand

   Gespeichert wird nur, was sich nicht ausrechnen lässt: das Datum, die
   Runde und je Rätsel die Liste der abgegebenen Versuche. Die Lösung
   selbst steht nicht im Speicher – sie ergibt sich aus Datum und Runde,
   und wer sie nachschlagen will, findet ohnehin einen Weg.
   --------------------------------------------------------------------- */

function speichereSpiel() {
  schreibSpeicher(SPIEL_KEY, {
    tag: tag,
    runde: runde,
    versuche: raetsel.map((r) => r.versuche),
  });
}

/** Baut die drei Rätsel des Tages auf, aus dem Speicher oder frisch. */
function ladeSpiel() {
  const gespeichert = liesSpeicher(SPIEL_KEY, null);
  tag = heutigerTag();
  runde = 0;

  /* Ein Spielstand von gestern ist wertlos: Das Datum bestimmt die Wörter. */
  if (gespeichert && gespeichert.tag === tag && typeof gespeichert.runde === "number") {
    runde = gespeichert.runde;
  }

  const woerter = woerterFuerTag(SPIEL, tag, runde, RAETSEL_PRO_TAG);
  raetsel = woerter.map((wort, i) => {
    let versuche = [];
    if (gespeichert && gespeichert.tag === tag && gespeichert.runde === runde &&
        Array.isArray(gespeichert.versuche) && Array.isArray(gespeichert.versuche[i])) {
      /* Nur übernehmen, was auch heute noch ein gültiger Versuch wäre –
         ein von Hand verbogener Speicher soll das Feld nicht zerlegen. */
      versuche = gespeichert.versuche[i].filter(
        (v) => typeof v === "string" && v.length === WORTLAENGE
      ).slice(0, VERSUCHE_MAX);
    }
    return { wort: wort, versuche: versuche };
  });
}

function istFertig(r) {
  if (r.versuche.length === 0) return false;
  if (r.versuche[r.versuche.length - 1] === r.wort) return true;
  return r.versuche.length >= VERSUCHE_MAX;
}

function istGewonnen(r) {
  return r.versuche.length > 0 && r.versuche[r.versuche.length - 1] === r.wort;
}

/* ---------------------------------------------------------------------
   Startbildschirm
   --------------------------------------------------------------------- */

function zeigeStartbildschirm() {
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");

  const datum = new Date();
  const wochentage = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  let zeile = wochentage[datum.getDay()] + ", " +
    String(datum.getDate()).padStart(2, "0") + "." +
    String(datum.getMonth() + 1).padStart(2, "0") + "." + datum.getFullYear();
  if (runde > 0) zeile += " · Zusatzrunde " + runde;
  document.getElementById("tages-zeile").textContent = zeile;

  zeigeRaetselListe();
  statistik.zeigeTabelle("stats-table-body");
}

function zeigeRaetselListe() {
  const liste = document.getElementById("raetsel-liste");
  liste.innerHTML = "";

  for (let i = 0; i < raetsel.length; i++) {
    const r = raetsel[i];
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "raetsel-karte";
    knopf.dataset.nr = String(i);

    let zustand, unterzeile;
    if (istGewonnen(r)) {
      zustand = "gewonnen";
      unterzeile = "Gelöst in " + r.versuche.length + " " + (r.versuche.length === 1 ? "Zug" : "Zügen");
    } else if (istFertig(r)) {
      zustand = "verloren";
      unterzeile = "Nicht geschafft · " + r.wort;
    } else if (r.versuche.length > 0) {
      zustand = "laeuft";
      unterzeile = r.versuche.length + " von " + VERSUCHE_MAX + " Versuchen";
    } else {
      zustand = "offen";
      unterzeile = VERSUCHE_MAX + " Versuche";
    }
    knopf.classList.add("ist-" + zustand);

    const zeichen = { gewonnen: "✓", verloren: "✕", laeuft: "▶", offen: "▦" }[zustand];
    knopf.innerHTML =
      "<span class=\"raetsel-zeichen\">" + zeichen + "</span>" +
      "<span class=\"raetsel-text\">" +
        "<span class=\"raetsel-titel\">Rätsel " + (i + 1) + "</span>" +
        "<span class=\"raetsel-sub\">" + unterzeile + "</span>" +
      "</span>";

    knopf.addEventListener("click", function () { oeffneRaetsel(i); });
    liste.appendChild(knopf);
  }
}

/* ---------------------------------------------------------------------
   Spielbildschirm
   --------------------------------------------------------------------- */

function oeffneRaetsel(nr) {
  aktuell = nr;
  eingabe.leeren();
  deckeAuf = false;
  verdeckteZeile = -1;

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("versuch-max").textContent = String(VERSUCHE_MAX);

  baueWechsel();
  baueBrett();
  baueTastatur();
  passeGroesseAn();
  /* Und noch einmal im nächsten Bild: Beim Wechsel der Bildschirme
     steht das Layout mitunter erst danach, und dann wäre eben mit
     Nullen gerechnet worden. */
  requestAnimationFrame(passeGroesseAn);
  zeichne();
  meldung("");
}

/** Die drei Schaltflächen oben, mit denen man zwischen den Rätseln wechselt. */
function baueWechsel() {
  const leiste = document.getElementById("raetsel-wechsel");
  leiste.innerHTML = "";
  for (let i = 0; i < raetsel.length; i++) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "wechsel-knopf";
    knopf.textContent = String(i + 1);
    knopf.title = "Rätsel " + (i + 1);
    if (i === aktuell) knopf.classList.add("aktiv");
    if (istGewonnen(raetsel[i])) knopf.classList.add("ist-gewonnen");
    else if (istFertig(raetsel[i])) knopf.classList.add("ist-verloren");
    knopf.addEventListener("click", function () {
      if (i !== aktuell) oeffneRaetsel(i);
    });
    leiste.appendChild(knopf);
  }
}

function baueBrett() {
  const brett = document.getElementById("board");
  brett.innerHTML = "";
  for (let z = 0; z < VERSUCHE_MAX; z++) {
    const zeile = document.createElement("div");
    zeile.className = "zeile";
    zeile.dataset.zeile = String(z);
    for (let s = 0; s < WORTLAENGE; s++) {
      const feld = document.createElement("div");
      feld.className = "feld";
      feld.dataset.zeile = String(z);
      feld.dataset.spalte = String(s);
      /* Nur die laufende Zeile reagiert auf Klicks; welche das ist, weiß
         erst `zeichne`, deshalb hängt der Zuhörer an jedem Feld. */
      feld.addEventListener("click", function () {
        const r = raetsel[aktuell];
        if (deckeAuf || istFertig(r)) return;
        if (z !== r.versuche.length) return;
        eingabe.setzeMarke(s);
        zeichne();
      });
      zeile.appendChild(feld);
    }
    brett.appendChild(zeile);
  }
}

/* Die Tastatur baut ../wortraten/eingabe.js; Wordle braucht keine
   geteilten Tasten, deshalb null Ecken. */
function baueTastatur() {
  baueBildschirmtastatur(document.getElementById("keyboard"), 0,
    function (b) { eingabe.tippe(b); zeichne(); },
    pruefeVersuch,
    function () { eingabe.loesche(); zeichne(); });
}

/**
 * Rechnet aus, wie groß ein Feld sein darf.
 *
 * Sechs Zeilen zu fünf Feldern, darüber die Statuszeile und darunter die
 * Tastatur – das ist viel für ein flaches Fenster. Statt die Kantenlänge
 * in Vielfachen der Fensterhöhe zu schätzen, wird der wirklich freie
 * Platz gemessen und aufgeteilt. Beides ist gedeckelt: unter 28 Pixeln
 * ist nichts mehr zu lesen – dann wird lieber gescrollt –, über 54 sieht
 * es am großen Schirm albern aus.
 */
/* Zuletzt gesetzte Kantenlänge – siehe die Schwelle weiter unten. */
let zuletztKante = 0;

function passeGroesseAn() {
  const bereich = document.getElementById("spielfeld");
  /* Beide Maße prüfen: Ein Fenster, das gerade nichts zeichnet, meldet
     mitunter null Breite bei brauchbarer Höhe – dann käme hier die
     kleinstmögliche Kantenlänge heraus und das Feld bliebe so stehen. */
  if (!bereich.clientHeight || !bereich.clientWidth) return;

  const stil = getComputedStyle(bereich);
  const hoehe = bereich.clientHeight -
    parseFloat(stil.paddingTop) - parseFloat(stil.paddingBottom);
  const breite = bereich.clientWidth -
    parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
  const luecke = parseFloat(stil.rowGap) || 12;

  const frei = hoehe -
    document.getElementById("status-text").offsetHeight -
    document.getElementById("keyboard").offsetHeight -
    2 * luecke;

  /* Zwischen den Feldern liegen elf Prozent einer Kantenlänge – siehe
     --luecke in style.css. */
  const ausHoehe = frei / (VERSUCHE_MAX + (VERSUCHE_MAX - 1) * 0.11);
  const ausBreite = breite / (WORTLAENGE + (WORTLAENGE - 1) * 0.11);

  const kante = Math.max(28, Math.min(54, ausHoehe, ausBreite));
  if (Math.abs(kante - zuletztKante) < 0.6) return;
  zuletztKante = kante;
  document.documentElement.style.setProperty("--feld", kante.toFixed(1) + "px");
}

/* ---------------------------------------------------------------------
   Zeichnen
   --------------------------------------------------------------------- */

function zeichne() {
  const r = raetsel[aktuell];
  const zeileNr = r.versuche.length;
  const fertig = istFertig(r);

  const felder = document.getElementById("board").getElementsByClassName("feld");
  for (let i = 0; i < felder.length; i++) {
    const feld = felder[i];
    const z = Number(feld.dataset.zeile);
    const s = Number(feld.dataset.spalte);

    feld.className = "feld";
    if (z < r.versuche.length) {
      const wort = r.versuche[z];
      feld.textContent = wort[s];
      if (z !== verdeckteZeile) feld.classList.add("ist-" + bewerteVersuch(wort, r.wort)[s]);
    } else if (z === zeileNr && !fertig) {
      feld.textContent = eingabe.zeichen[s];
      feld.classList.add("ist-aktiv");
      if (eingabe.zeichen[s]) feld.classList.add("ist-gefuellt");
      if (s === eingabe.marke) feld.classList.add("ist-marke");
    } else {
      feld.textContent = "";
    }
  }

  const gezeigt = verdeckteZeile >= 0 ? r.versuche.slice(0, verdeckteZeile) : r.versuche;
  const stand = tastaturStand(gezeigt, r.wort);
  const tasten = document.getElementById("keyboard").getElementsByClassName("taste");
  for (let i = 0; i < tasten.length; i++) {
    const b = tasten[i].dataset.buchstabe;
    tasten[i].classList.remove("ist-richtig", "ist-dabei", "ist-fehlt");
    if (b && stand[b]) tasten[i].classList.add("ist-" + stand[b]);
  }

  document.getElementById("versuch-nr").textContent = String(r.versuche.length);

  /* Erst wenn die Zeile fertig gedreht ist, darf man dem Feld ansehen, dass
     die Partie vorbei ist: Eine Tastatur, die schon ausgraut, waehrend die
     Buchstaben noch fliegen, verraet den Ausgang zu frueh. */
  const vorbei = fertig && verdeckteZeile < 0;
  document.getElementById("result-btn").classList.toggle("hidden", !vorbei);
  document.getElementById("keyboard").classList.toggle("ist-aus", vorbei);
}

function meldung(text, art) {
  const feld = document.getElementById("status-text");
  clearTimeout(meldungTimer);
  if (!text) {
    feld.innerHTML = "&nbsp;";
    feld.className = "is-empty";
    return;
  }
  feld.textContent = text;
  feld.className = art === "gut" ? "ist-gut" : "ist-hinweis";
  meldungTimer = setTimeout(function () {
    feld.innerHTML = "&nbsp;";
    feld.className = "is-empty";
  }, MELDUNG_MS);
}

/** Lässt die laufende Zeile kurz wackeln – die Meldung allein übersieht man. */
function ruettle() {
  const r = raetsel[aktuell];
  const zeile = document.querySelector('#board .zeile[data-zeile="' + r.versuche.length + '"]');
  if (!zeile) return;
  zeile.classList.remove("ruettelt");
  /* Ein Lesezugriff auf das Layout erzwingt den Neustart der Animation;
     ohne ihn fasst der Browser Entfernen und Hinzufügen zusammen. */
  void zeile.offsetWidth;
  zeile.classList.add("ruettelt");
}

/* ---------------------------------------------------------------------
   Eingabe
   --------------------------------------------------------------------- */

function pruefeVersuch() {
  const r = raetsel[aktuell];
  if (deckeAuf || istFertig(r)) return;

  const wort = eingabe.wort();
  if (!eingabe.istVoll()) {
    meldung("Da fehlen noch Buchstaben.");
    ruettle();
    return;
  }
  if (r.versuche.indexOf(wort) >= 0) {
    meldung(wort + " hattest du schon.");
    ruettle();
    return;
  }
  if (!istErlaubtesWort(wort)) {
    meldung(wort + " steht nicht auf der Wortliste.");
    ruettle();
    return;
  }

  if (r.versuche.length === 0) statistik.merkeGestartet();
  r.versuche.push(wort);
  eingabe.leeren();
  speichereSpiel();

  deckeAuf = true;
  verdeckteZeile = r.versuche.length - 1;
  zeichne();
  zeigeAufdeckung(verdeckteZeile, function () {
    deckeAuf = false;
    baueWechsel();
    if (istFertig(r)) {
      const gewonnen = istGewonnen(r);
      statistik.merkeBeendet(gewonnen, r.versuche.length);
      zeigeEnde(gewonnen);
    }
  });
}

/**
 * Dreht die Felder einer Zeile nacheinander um und meldet sich danach.
 *
 * Die Farbe kommt erst nach der halben Drehung, wenn das Feld auf der
 * Kante steht – DREH_MS/2 muss deshalb zur Animation in style.css passen.
 */
const DREH_MS = 480;
const DREH_ABSTAND = 170;

function zeigeAufdeckung(zeileNr, fertig) {
  const zeile = document.querySelector('#board .zeile[data-zeile="' + zeileNr + '"]');
  const r = raetsel[aktuell];
  if (!zeile) { verdeckteZeile = -1; zeichne(); fertig(); return; }

  const befund = bewerteVersuch(r.versuche[zeileNr], r.wort);
  const felder = zeile.getElementsByClassName("feld");
  for (let s = 0; s < felder.length; s++) {
    (function (feld, verzug, art) {
      setTimeout(function () { feld.classList.add("dreht"); }, verzug);
      setTimeout(function () { feld.classList.add("ist-" + art); }, verzug + DREH_MS / 2);
    })(felder[s], s * DREH_ABSTAND, befund[s]);
  }

  setTimeout(function () {
    verdeckteZeile = -1;
    zeichne();
    fertig();
  }, (felder.length - 1) * DREH_ABSTAND + DREH_MS + 60);
}

/* ---------------------------------------------------------------------
   Auswertung
   --------------------------------------------------------------------- */

function zeigeEnde(gewonnen) {
  const r = raetsel[aktuell];
  document.getElementById("end-title").textContent = gewonnen ? "Geschafft!" : "Vorbei";
  document.getElementById("end-text").textContent = gewonnen
    ? "Rätsel " + (aktuell + 1) + " in " + r.versuche.length + " " +
      (r.versuche.length === 1 ? "Zug" : "Zügen") + " gelöst."
    : "Sechs Versuche, und das Wort ist es nicht geworden.";
  document.getElementById("end-wort").textContent = "Gesucht war: " + r.wort;

  const leiste = document.getElementById("end-raetsel");
  leiste.innerHTML = "";
  for (let i = 0; i < raetsel.length; i++) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "end-mode-btn";
    knopf.textContent = "Rätsel " + (i + 1);
    if (istFertig(raetsel[i])) knopf.classList.add("ist-fertig");
    knopf.addEventListener("click", function () { oeffneRaetsel(i); });
    leiste.appendChild(knopf);
  }

  const uebersicht = document.createElement("button");
  uebersicht.type = "button";
  uebersicht.className = "end-mode-btn";
  uebersicht.textContent = "Übersicht";
  uebersicht.addEventListener("click", zeigeStartbildschirm);
  leiste.appendChild(uebersicht);

  const schicht = document.getElementById("confetti-layer");
  schicht.innerHTML = "";
  document.getElementById("end-overlay").classList.remove("hidden");
  if (gewonnen) setTimeout(function () { streueKonfetti(schicht); }, 120);
}

/* ---------------------------------------------------------------------
   Knöpfe und Tasten
   --------------------------------------------------------------------- */

document.getElementById("neue-raetsel").addEventListener("click", function () {
  const angefangen = raetsel.some((r) => r.versuche.length > 0 && !istFertig(r));
  if (angefangen && !confirm("Es läuft noch ein Rätsel. Trotzdem drei neue ziehen?")) return;
  runde += 1;
  raetsel = woerterFuerTag(SPIEL, tag, runde, RAETSEL_PRO_TAG).map((wort) => ({ wort: wort, versuche: [] }));
  speichereSpiel();
  zeigeStartbildschirm();
});

document.getElementById("stats-reset").addEventListener("click", function () {
  if (!confirm("Die Wordle-Statistik wirklich zurücksetzen? Die laufenden Rätsel bleiben erhalten.")) return;
  statistik.zuruecksetzen();
  statistik.zeigeTabelle("stats-table-body");
});

document.getElementById("game-title").addEventListener("click", zeigeStartbildschirm);
document.getElementById("result-btn").addEventListener("click", function () {
  zeigeEnde(istGewonnen(raetsel[aktuell]));
});
document.getElementById("end-back").addEventListener("click", function () {
  document.getElementById("end-overlay").classList.add("hidden");
});

/* Neu vermessen, wann immer sich etwas gerührt haben könnte.

   Zwei Auslöser, absichtlich nebeneinander: window.resize feuert beim
   Wechsel vom Start- zum Spielbildschirm nicht, weil das Fenster dabei
   gleich groß bleibt; ein Beobachter am Bereich selbst bekommt das mit.
   Umgekehrt gibt es Umgebungen, in denen der Beobachter schweigt – dann
   trägt das Fenster-Ereignis. Doppelte Aufrufe kosten nichts, die
   Schwelle in passeGroesseAn fängt sie ab. */
function vermesseNeu() {
  if (!document.getElementById("game-screen").classList.contains("hidden")) passeGroesseAn();
}

window.addEventListener("resize", vermesseNeu);
if (window.ResizeObserver) {
  new ResizeObserver(vermesseNeu).observe(document.getElementById("spielfeld"));
}

document.addEventListener("keydown", function (e) {
  if (document.getElementById("game-screen").classList.contains("hidden")) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  /* Die Auswertung liegt über dem Feld – dort soll nur Escape wirken. */
  const ueberlagert = !document.getElementById("end-overlay").classList.contains("hidden");
  if (e.key === "Escape") {
    e.preventDefault();
    if (ueberlagert) document.getElementById("end-overlay").classList.add("hidden");
    else zeigeStartbildschirm();
    return;
  }
  if (ueberlagert || deckeAuf || istFertig(raetsel[aktuell])) return;

  if (deuteTaste(e, eingabe, {
    abgeben: pruefeVersuch,
    kleinPlatz: function (paar) {
      meldung("Für " + paar + " ist kein Platz mehr.");
      ruettle();
    },
  })) {
    e.preventDefault();
    zeichne();
  }
});

/* ---------------------------------------------------------------------
   Los
   --------------------------------------------------------------------- */

ladeSpiel();
zeigeStartbildschirm();
