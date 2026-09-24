"use strict";

/* =====================================================================
   Quordle · Oberfläche

   Vier Wörter gleichzeitig, neun Versuche für alle vier zusammen. Jeder
   Versuch wird in alle vier Felder eingetragen und dort einzeln bewertet.

   Daraus folgt der wichtigste Unterschied zu Wordle: Es gibt nur EINE
   Liste abgegebener Wörter, nicht vier. Ein Feld zeigt davon so viel, bis
   sein Wort gefallen ist – danach friert es ein und die restlichen Zeilen
   bleiben leer. Wie weit ein Feld ist, steht deshalb nirgends gespeichert,
   sondern wird aus der gemeinsamen Liste abgelesen.

   Die Regeln stehen in ../wortraten/regeln.js, die Wörter daneben in
   woerter.js, gezählt wird in statistik.js – alles drei teilt sich
   Quordle mit Wordle.
   ===================================================================== */

const SPIEL = "quordle";
const VERSUCHE_MAX = 9;
const FELDER_ANZAHL = 4;

const STATS_KEY = "quordleStats";
const VERLAUF_KEY = "quordleVerlauf";
const SPIEL_KEY = "quordleSpiel";
const SERIE_KEY = "quordleSerie";

const statistik = macheStatistik(STATS_KEY, VERLAUF_KEY, SERIE_KEY);

/* So lange bleibt eine Meldung stehen. */
const MELDUNG_MS = 2400;

/* Die Drehung beim Aufdecken. Die Farbe kommt nach der halben Drehung,
   wenn das Feld auf der Kante steht – DREH_MS/2 muss deshalb zur
   Animation in style.css passen. */
const DREH_MS = 480;
const DREH_ABSTAND = 170;

let tag = null;
/* Die vier gesuchten Wörter und die gemeinsame Liste der Versuche. */
let woerter = [];
let versuche = [];

/* Die Eingabezeile samt Schreibmarke steckt in ../wortraten/eingabe.js –
   Wordle tippt genauso. */
const eingabe = macheEingabezeile(WORTLAENGE);

let meldungTimer = null;
let deckeAuf = false;
/* Solange die Zeile noch nicht gedreht ist, zählt sie weder für die
   Farben noch für die Tastatur. */
let verdeckteZeile = -1;

/* ---------------------------------------------------------------------
   Stand ablesen

   Alles Folgende lässt sich aus `versuche` und `woerter` herleiten;
   gespeichert wird deshalb auch nur das.
   --------------------------------------------------------------------- */

/**
 * Nach dem wievielten Versuch ist Feld `i` gefallen?
 * Liefert die Zahl der Versuche bis einschließlich Treffer, sonst -1.
 */
function geloestNach(i) {
  const stelle = versuche.indexOf(woerter[i]);
  return stelle < 0 ? -1 : stelle + 1;
}

function istGeloest(i) {
  return geloestNach(i) >= 0;
}

/** So viele Zeilen zeigt Feld `i` – ein gelöstes Feld friert ein. */
function zeilenFuer(i) {
  const n = geloestNach(i);
  return n >= 0 ? n : versuche.length;
}

function alleGeloest() {
  for (let i = 0; i < FELDER_ANZAHL; i++) if (!istGeloest(i)) return false;
  return true;
}

function anzahlGeloest() {
  let n = 0;
  for (let i = 0; i < FELDER_ANZAHL; i++) if (istGeloest(i)) n++;
  return n;
}

function istFertig() {
  return alleGeloest() || versuche.length >= VERSUCHE_MAX;
}

/* ---------------------------------------------------------------------
   Spielstand
   --------------------------------------------------------------------- */

function speichereSpiel() {
  schreibSpeicher(SPIEL_KEY, { tag: tag, versuche: versuche });
}

function ladeSpiel() {
  const gespeichert = liesSpeicher(SPIEL_KEY, null);
  tag = heutigerTag();
  versuche = [];

  /* Ein Spielstand von gestern ist wertlos: Das Datum bestimmt die Wörter.
     Ein Stand aus der Zeit der Zusatzrunden trägt ein Feld `runde` – die
     Wörter dazu gibt es nicht mehr, also zählt er als nicht vorhanden. */
  if (gespeichert && gespeichert.tag === tag && !gespeichert.runde) {
    if (Array.isArray(gespeichert.versuche)) {
      /* Nur übernehmen, was auch heute ein gültiger Versuch wäre – ein von
         Hand verbogener Speicher soll das Feld nicht zerlegen. */
      versuche = gespeichert.versuche
        .filter((v) => typeof v === "string" && v.length === WORTLAENGE)
        .slice(0, VERSUCHE_MAX);
    }
  }

  woerter = woerterFuerTag(SPIEL, tag, 0, FELDER_ANZAHL);
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
  document.getElementById("tages-zeile").textContent = zeile;

  zeigeKarte();
  zeigeSerie();
  statistik.zeigeTabelle("stats-table-body");
}

function zeigeSerie() {
  const stand = statistik.serie(tag);
  document.getElementById("serie-aktuell").textContent = String(stand.aktuell);
  document.getElementById("serie-best").textContent = String(stand.best);

  let hinweis;
  if (stand.heuteGeschafft) {
    hinweis = "Heute geschafft – morgen geht es weiter.";
  } else if (istFertig()) {
    hinweis = "Heute nicht geschafft – morgen fängt eine neue Serie an.";
  } else if (stand.aktuell > 0) {
    hinweis = "Alle vier Wörter finden, dann wächst die Serie.";
  } else {
    hinweis = "Alle vier Wörter an einem Tag finden startet eine Serie.";
  }
  document.getElementById("serie-hinweis").textContent = hinweis;

  document.getElementById("serie").classList.toggle("ist-aktiv", stand.aktuell > 0);
}

function zeigeKarte() {
  const karte = document.getElementById("spiel-karte");
  const geloest = anzahlGeloest();
  let zustand, unterzeile;

  if (alleGeloest()) {
    zustand = "gewonnen";
    unterzeile = "Alle vier in " + versuche.length + " Zügen";
  } else if (istFertig()) {
    zustand = "verloren";
    unterzeile = geloest + " von 4 gefunden · nicht geschafft";
  } else if (versuche.length > 0) {
    zustand = "laeuft";
    unterzeile = geloest + " von 4 gefunden · " +
      (VERSUCHE_MAX - versuche.length) + " Versuche übrig";
  } else {
    zustand = "offen";
    unterzeile = VERSUCHE_MAX + " Versuche für vier Wörter";
  }

  karte.className = "spiel-karte ist-" + zustand;
  karte.querySelector(".karte-zeichen").textContent =
    { gewonnen: "✓", verloren: "✕", laeuft: "▶", offen: "▞" }[zustand];
  document.getElementById("karte-sub").textContent = unterzeile;

  /* Vier Punkte zeigen auf einen Blick, welche Felder schon stehen. */
  const punkte = document.getElementById("karte-punkte");
  punkte.innerHTML = "";
  for (let i = 0; i < FELDER_ANZAHL; i++) {
    const p = document.createElement("span");
    p.className = "karte-punkt" + (istGeloest(i) ? " ist-geloest" : "");
    punkte.appendChild(p);
  }
}

/* ---------------------------------------------------------------------
   Spielbildschirm
   --------------------------------------------------------------------- */

function oeffneSpiel() {
  eingabe.leeren();
  deckeAuf = false;
  verdeckteZeile = -1;

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("versuch-max").textContent = String(VERSUCHE_MAX);
  document.getElementById("geloest-max").textContent = String(FELDER_ANZAHL);

  baueBretter();
  baueTastatur();
  passeGroesseAn();
  /* Und noch einmal im nächsten Bild: Beim Wechsel der Bildschirme
     steht das Layout mitunter erst danach, und dann wäre eben mit
     Nullen gerechnet worden. */
  requestAnimationFrame(passeGroesseAn);
  zeichne();
  meldung("");
}

function baueBretter() {
  const wrap = document.getElementById("bretter");
  wrap.innerHTML = "";
  for (let b = 0; b < FELDER_ANZAHL; b++) {
    const brett = document.createElement("div");
    brett.className = "brett";
    brett.dataset.brett = String(b);
    for (let z = 0; z < VERSUCHE_MAX; z++) {
      const zeile = document.createElement("div");
      zeile.className = "zeile";
      zeile.dataset.brett = String(b);
      zeile.dataset.zeile = String(z);
      for (let s = 0; s < WORTLAENGE; s++) {
        const feld = document.createElement("div");
        feld.className = "feld";
        feld.dataset.brett = String(b);
        feld.dataset.zeile = String(z);
        feld.dataset.spalte = String(s);
        /* Geklickt wird auf die Spalte, nicht auf ein bestimmtes Feld:
           Die Schreibmarke gilt für alle vier Bretter zugleich, also ist
           nur die Stelle im Wort von Belang. */
        feld.addEventListener("click", function () {
          if (deckeAuf || istFertig()) return;
          if (z !== zeilenFuer(b) || istGeloest(b)) return;
          eingabe.setzeMarke(s);
          zeichne();
        });
        zeile.appendChild(feld);
      }
      brett.appendChild(zeile);
    }
    wrap.appendChild(brett);
  }
}

/* Die Tastatur baut ../wortraten/eingabe.js. Vier Ecken je Taste, eine
   für jedes Brett – in derselben Anordnung wie die Bretter selbst, damit
   man sie ohne Erklärung zuordnen kann. */
function baueTastatur() {
  baueBildschirmtastatur(document.getElementById("keyboard"), FELDER_ANZAHL,
    function (b) { eingabe.tippe(b); zeichne(); },
    pruefeVersuch,
    function () { eingabe.loesche(); zeichne(); });
}

/* ---------------------------------------------------------------------
   Zeichnen
   --------------------------------------------------------------------- */

function zeichne() {
  const fertig = istFertig();

  for (let b = 0; b < FELDER_ANZAHL; b++) {
    const gezeigt = zeilenFuer(b);
    const brettGeloest = istGeloest(b);
    const brett = document.querySelector('.brett[data-brett="' + b + '"]');
    brett.classList.toggle("ist-geloest", brettGeloest);

    const felder = brett.getElementsByClassName("feld");
    for (let n = 0; n < felder.length; n++) {
      const feld = felder[n];
      const z = Number(feld.dataset.zeile);
      const s = Number(feld.dataset.spalte);

      feld.className = "feld";
      if (z < gezeigt) {
        const wort = versuche[z];
        feld.textContent = wort[s];
        if (z !== verdeckteZeile) feld.classList.add("ist-" + bewerteVersuch(wort, woerter[b])[s]);
      } else if (z === gezeigt && !brettGeloest && !fertig) {
        feld.textContent = eingabe.zeichen[s];
        feld.classList.add("ist-aktiv");
        if (eingabe.zeichen[s]) feld.classList.add("ist-gefuellt");
        if (s === eingabe.marke) feld.classList.add("ist-marke");
      } else {
        feld.textContent = "";
      }
    }
  }

  zeichneTastatur();

  document.getElementById("versuch-nr").textContent = String(versuche.length);
  document.getElementById("geloest-nr").textContent = String(
    verdeckteZeile >= 0 ? zaehleGeloestBis(verdeckteZeile) : anzahlGeloest()
  );

  /* Erst wenn die Zeile fertig gedreht ist, darf man dem Feld ansehen,
     dass die Partie vorbei ist. */
  const vorbei = fertig && verdeckteZeile < 0;
  document.getElementById("result-btn").classList.toggle("hidden", !vorbei);
  document.getElementById("keyboard").classList.toggle("ist-aus", vorbei);
}

/** Wie viele Felder waren nach `n` Versuchen gelöst? */
function zaehleGeloestBis(n) {
  let z = 0;
  for (let i = 0; i < FELDER_ANZAHL; i++) {
    const g = geloestNach(i);
    if (g >= 0 && g <= n) z++;
  }
  return z;
}

/**
 * Färbt die Tastatur.
 *
 * Jede Taste trägt vier Ecken, eine je Brett – auch ein längst gelöstes
 * behält seine Farben. Sie wegzulassen wäre naheliegend, weil das Brett
 * nichts mehr beiträgt; eine leere Ecke neben drei bunten sieht aber nach
 * fehlender Auskunft aus und nicht nach erledigt.
 */
function zeichneTastatur() {
  const staende = [];
  for (let b = 0; b < FELDER_ANZAHL; b++) {
    /* Während eine Zeile noch dreht, zählt sie hier noch nicht mit. */
    const bis = verdeckteZeile >= 0
      ? Math.min(verdeckteZeile, zeilenFuer(b))
      : zeilenFuer(b);
    staende.push(tastaturStand(versuche.slice(0, bis), woerter[b]));
  }

  const tasten = document.getElementById("keyboard").getElementsByClassName("taste");
  for (let i = 0; i < tasten.length; i++) {
    const b = tasten[i].dataset.buchstabe;
    if (!b) continue;
    const ecken = tasten[i].getElementsByTagName("i");
    let alleFehlen = true;
    for (let e = 0; e < ecken.length; e++) {
      const stand = staende[e][b];
      ecken[e].className = stand ? "ist-" + stand : "";
      if (stand !== "fehlt") alleFehlen = false;
    }
    /* Ist ein Buchstabe in allen vier Feldern raus, tritt die ganze Taste
       zurück – das ist die Auskunft, die man am häufigsten braucht. */
    tasten[i].classList.toggle("ist-erledigt", alleFehlen);
  }
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

/** Lässt die laufenden Zeilen kurz wackeln – die Meldung allein übersieht man. */
function ruettle() {
  for (let b = 0; b < FELDER_ANZAHL; b++) {
    if (istGeloest(b)) continue;
    const zeile = document.querySelector(
      '.zeile[data-brett="' + b + '"][data-zeile="' + zeilenFuer(b) + '"]');
    if (!zeile) continue;
    zeile.classList.remove("ruettelt");
    /* Ein Lesezugriff auf das Layout erzwingt den Neustart der Animation. */
    void zeile.offsetWidth;
    zeile.classList.add("ruettelt");
  }
}

/* ---------------------------------------------------------------------
   Größe und Anordnung

   Vier Bretter zu neun Zeilen brauchen viel Platz, und wie man sie am
   besten hinstellt, hängt vom Fenster ab: Am breiten Schirm stehen alle
   vier nebeneinander – dann ist nur eine Brettzeile hoch, und die Felder
   werden deutlich größer. Auf dem Telefon wären zwanzig Felder
   nebeneinander unlesbar, dort ist das Quadrat richtig.

   Statt eines festen Umschaltpunkts wird beides durchgerechnet und die
   Anordnung genommen, die die größeren Felder ergibt. Bei Gleichstand
   gewinnt die erste – die Reihe.
   --------------------------------------------------------------------- */

const ANORDNUNGEN = [
  { spalten: 4, zeilen: 1 },
  { spalten: 2, zeilen: 2 },
];

/* Abstand zwischen zwei Brettern, in Kantenlängen. */
const BRETT_LUECKE = 0.5;

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
     --luecke in style.css –, zwischen den Brettern BRETT_LUECKE. */
  let beste = null;
  for (let i = 0; i < ANORDNUNGEN.length; i++) {
    const a = ANORDNUNGEN[i];
    const spalten = a.spalten * (WORTLAENGE + (WORTLAENGE - 1) * 0.11) +
      (a.spalten - 1) * BRETT_LUECKE;
    const zeilen = a.zeilen * (VERSUCHE_MAX + (VERSUCHE_MAX - 1) * 0.11) +
      (a.zeilen - 1) * BRETT_LUECKE;
    const kante = Math.min(frei / zeilen, breite / spalten);
    if (!beste || kante > beste.kante) beste = { kante: kante, a: a };
  }

  const kante = Math.max(20, Math.min(48, beste.kante));
  const wrap = document.getElementById("bretter");
  const anordnung = "repeat(" + beste.a.spalten + ", auto)";

  /* Die Anordnung gehört mit in den Vergleich: Sie kann umspringen,
     während die Kantenlänge gleich bleibt – etwa wenn beide Varianten am
     oberen Deckel liegen. */
  if (Math.abs(kante - zuletztKante) < 0.6 && wrap.style.gridTemplateColumns === anordnung) return;
  zuletztKante = kante;

  document.documentElement.style.setProperty("--feld", kante.toFixed(1) + "px");
  wrap.style.gridTemplateColumns = anordnung;

  /* Die Ecken der Tasten stehen für die vier Bretter und müssen deshalb
     genauso angeordnet sein wie diese – nebeneinander vier Streifen, im
     Quadrat vier Viertel. Sonst zeigt die Tastatur auf die falschen. */
  document.getElementById("game-screen")
    .classList.toggle("bretter-reihe", beste.a.zeilen === 1);
}

/* ---------------------------------------------------------------------
   Eingabe
   --------------------------------------------------------------------- */

function pruefeVersuch() {
  if (deckeAuf || istFertig()) return;

  const wort = eingabe.wort();
  if (!eingabe.istVoll()) {
    meldung("Da fehlen noch Buchstaben.");
    ruettle();
    return;
  }
  if (versuche.indexOf(wort) >= 0) {
    meldung(wort + " hattest du schon.");
    ruettle();
    return;
  }
  if (!istErlaubtesWort(wort)) {
    meldung(wort + " steht nicht auf der Wortliste.");
    ruettle();
    return;
  }

  if (versuche.length === 0) statistik.merkeGestartet();
  versuche.push(wort);
  eingabe.leeren();
  speichereSpiel();

  deckeAuf = true;
  verdeckteZeile = versuche.length - 1;
  zeichne();
  zeigeAufdeckung(verdeckteZeile, function () {
    deckeAuf = false;
    if (istFertig()) {
      const gewonnen = alleGeloest();
      statistik.merkeBeendet(gewonnen, versuche.length);
      if (gewonnen) statistik.merkeTagGeschafft(tag);
      zeigeEnde(gewonnen);
    }
  });
}

/**
 * Dreht die Felder einer Zeile um – in allen vier Brettern zugleich,
 * damit man die Bewertungen nebeneinander liest und nicht viermal
 * hintereinander wartet.
 */
function zeigeAufdeckung(zeileNr, fertig) {
  const zeilen = [];
  for (let b = 0; b < FELDER_ANZAHL; b++) {
    /* Ein Brett, das vorher schon stand, deckt nichts mehr auf. */
    if (istGeloest(b) && geloestNach(b) <= zeileNr) {
      const z = document.querySelector(
        '.zeile[data-brett="' + b + '"][data-zeile="' + zeileNr + '"]');
      if (z && geloestNach(b) === zeileNr + 1) zeilen.push({ brett: b, el: z });
      continue;
    }
    const z = document.querySelector(
      '.zeile[data-brett="' + b + '"][data-zeile="' + zeileNr + '"]');
    if (z) zeilen.push({ brett: b, el: z });
  }

  if (zeilen.length === 0) {
    verdeckteZeile = -1;
    zeichne();
    fertig();
    return;
  }

  for (let i = 0; i < zeilen.length; i++) {
    const befund = bewerteVersuch(versuche[zeileNr], woerter[zeilen[i].brett]);
    const felder = zeilen[i].el.getElementsByClassName("feld");
    for (let s = 0; s < felder.length; s++) {
      (function (feld, verzug, art) {
        setTimeout(function () { feld.classList.add("dreht"); }, verzug);
        setTimeout(function () { feld.classList.add("ist-" + art); }, verzug + DREH_MS / 2);
      })(felder[s], s * DREH_ABSTAND, befund[s]);
    }
  }

  setTimeout(function () {
    verdeckteZeile = -1;
    zeichne();
    zeigeKarte();
    fertig();
  }, (WORTLAENGE - 1) * DREH_ABSTAND + DREH_MS + 60);
}

/* ---------------------------------------------------------------------
   Auswertung
   --------------------------------------------------------------------- */

function zeigeEnde(gewonnen) {
  document.getElementById("end-title").textContent = gewonnen ? "Geschafft!" : "Vorbei";
  document.getElementById("end-text").textContent = gewonnen
    ? "Alle vier Wörter in " + versuche.length + " " +
      (versuche.length === 1 ? "Zug" : "Zügen") + " gefunden."
    : anzahlGeloest() + " von vier Wörtern gefunden – für den Rest hat es nicht gereicht.";

  /* Alle vier Wörter zeigen, auch die gefundenen: Am Ende will man das
     Bild vollständig sehen. */
  const liste = document.getElementById("end-woerter");
  liste.innerHTML = "";
  for (let i = 0; i < FELDER_ANZAHL; i++) {
    const zeile = document.createElement("div");
    zeile.className = "end-wort" + (istGeloest(i) ? " ist-geloest" : " ist-verpasst");
    const marke2 = document.createElement("span");
    marke2.className = "end-wort-marke";
    marke2.textContent = istGeloest(i) ? "✓" : "✕";
    const text = document.createElement("span");
    text.textContent = woerter[i];
    const zug = document.createElement("span");
    zug.className = "end-wort-zug";
    zug.textContent = istGeloest(i) ? geloestNach(i) + ". Zug" : "verpasst";
    zeile.appendChild(marke2);
    zeile.appendChild(text);
    zeile.appendChild(zug);
    liste.appendChild(zeile);
  }

  const schicht = document.getElementById("confetti-layer");
  schicht.innerHTML = "";
  document.getElementById("end-overlay").classList.remove("hidden");
  if (gewonnen) setTimeout(function () { streueKonfetti(schicht); }, 120);
}

/* ---------------------------------------------------------------------
   Knöpfe und Tasten
   --------------------------------------------------------------------- */

document.getElementById("spiel-karte").addEventListener("click", oeffneSpiel);


document.getElementById("stats-reset").addEventListener("click", function () {
  if (!confirm("Die Quordle-Statistik wirklich zurücksetzen? Das laufende Rätsel bleibt erhalten.")) return;
  statistik.zuruecksetzen();
  statistik.zeigeTabelle("stats-table-body");
});

document.getElementById("game-title").addEventListener("click", zeigeStartbildschirm);
document.getElementById("end-uebersicht").addEventListener("click", zeigeStartbildschirm);
document.getElementById("result-btn").addEventListener("click", function () {
  zeigeEnde(alleGeloest());
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

  const ueberlagert = !document.getElementById("end-overlay").classList.contains("hidden");
  if (e.key === "Escape") {
    e.preventDefault();
    if (ueberlagert) document.getElementById("end-overlay").classList.add("hidden");
    else zeigeStartbildschirm();
    return;
  }
  if (ueberlagert || deckeAuf || istFertig()) return;

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
