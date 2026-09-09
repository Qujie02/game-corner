"use strict";

/* =====================================================================
   Mahjong · Oberfläche

   Die Regeln stehen in engine.js. Hier geht es um Steine auf dem Schirm:
   ausrechnen, wie groß sie sein dürfen, sie hinlegen, Klicks deuten und
   sagen, wie es steht.

   Zwei Varianten teilen sich fast alles:

   "klassisch" – zwei freie Steine anklicken, die zusammenpassen.
   "vorrat"    – freie Steine wandern auf vier Plätze; was dort zusammenkommt,
                 geht weg. Damit lassen sich drei verschiedene halten und mit
                 dem vierten wieder ein Paar bilden. Sind alle vier belegt und
                 passt nichts zusammen, ist Schluss.
   ===================================================================== */

const STATS_KEY = "mahjongStats";
const SPIEL_KEY = "mahjongSpiel";
const MODUS_KEY = "mahjongModus";

const VORRAT_PLAETZE = 4;

/* Maße eines Steins, alle in Vielfachen der Breite bzw. Höhe. Ein Stein ist
   höher als breit, wie die echten.

   Gezeichnet wird schräg von links oben: Wer eine Ebene höher liegt, wird um
   (dx, dy) nach links oben verschoben. Damit ist der Versatz je Ebene
   gleichzeitig die Dicke eines Steins – eine Ebene höher heißt: einen Stein
   dicker. Beides muss deshalb dieselbe Zahl sein. Wären sie verschieden,
   würde unter jedem Stein ein Splitter der Oberseite darunter hervorschauen,
   und ein Stapel sähe aus wie leicht verrutschte Steine. */
const STEIN_VERHAELTNIS = 1.35;
const EBENE_DX = 0.18;
const EBENE_DY = 0.13;

/* Grenzen für die Steingröße. Unter zwanzig Pixeln ist nichts mehr zu
   erkennen, über hundert passt kein Aufbau mehr aufs Blatt. */
const STEIN_MIN = 20;
const STEIN_MAX = 100;
const ZOOM_SCHRITT = 1.12;

/* So lange leuchtet ein Hinweis. */
const HINWEIS_MS = 2600;
/* So lange fliegt ein weggeräumtes Paar. Muss zur Angabe in style.css passen. */
const WEG_MS = 320;

let spiel = null;
let steinElemente = new Map();
let vorratElemente = [];
let gewaehlteVariante = "klassisch";
let gewaehltesLayout = "schildkroete";
/* Solange wahr, bestimmt das Fenster die Steingröße. Wer +/− antippt,
   übernimmt selbst; "Passend" gibt die Führung zurück. */
let autoGroesse = true;
let zoomFaktor = 1;
/* Sollen nur die anhebbaren Steine hervorgehoben werden? Wenn nicht, liegen
   alle gleich im Licht – schwerer, aber das Bild ist ruhiger. */
let nurFreieMarkieren = true;
let masse = null;
let timerInterval = null;
let elapsedSeconds = 0;
let hinweisTimer = null;
let statsAnsicht = "klassisch";
/* Während ein Paar wegfliegt, wird nicht angenommen – sonst ließe sich ein
   Stein zweimal anklicken, bevor er verschwunden ist. */
let raeumtAb = false;

/* ---------------------------------------------------------------------
   Kleinkram
   --------------------------------------------------------------------- */

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Die Steine, die auf dem Tisch liegen – ohne die im Vorrat.
 *
 * Wer einen Stein ins Fach legt, nimmt ihn vom Tisch: Er darf seine Nachbarn
 * nicht mehr blockieren, sonst wäre der Vorrat kein Gewinn, sondern nur eine
 * Warteschlange. Alle Regelfragen laufen deshalb über diese Liste.
 */
function brettSteine() {
  if (spiel.vorrat.length === 0) return spiel.steine;
  return spiel.steine.filter((s) => spiel.vorrat.indexOf(s) === -1);
}

function formatiereZeit(sekunden) {
  const m = Math.floor(sekunden / 60);
  const s = sekunden % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function handyAnsicht() {
  return window.innerWidth <= 720 || window.innerHeight <= 520;
}

/* ---------------------------------------------------------------------
   Statistiken

   Ein Eintrag je Variante und Aufbau: { played, won, best }. Dieselbe Form
   wie bei den anderen Spielen der Sammlung, damit hub.js sie ohne
   Sonderfall einsammeln kann.
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

function statsEintrag(stats, variante, layout) {
  if (!stats[variante]) stats[variante] = {};
  if (!stats[variante][layout]) stats[variante][layout] = { played: 0, won: 0, best: null };
  return stats[variante][layout];
}

function merkeGestartet(variante, layout) {
  const stats = ladeStats();
  statsEintrag(stats, variante, layout).played += 1;
  speichereStats(stats);
}

function merkeGewonnen(variante, layout, sekunden) {
  const stats = ladeStats();
  const e = statsEintrag(stats, variante, layout);
  e.won += 1;
  if (e.best === null || sekunden < e.best) e.best = sekunden;
  speichereStats(stats);
}

function zeigeStatsTabelle() {
  const stats = ladeStats();
  const kopf = document.getElementById("stats-head-row");
  const koerper = document.getElementById("stats-table-body");
  const layouts = Object.keys(LAYOUTS);

  kopf.innerHTML = "<th></th>" + layouts.map((k) => `<th>${LAYOUTS[k].name}</th>`).join("");

  const zeilen = [
    ["Gespielt", (e) => String(e.played)],
    ["Gewonnen", (e) => String(e.won)],
    ["Quote", (e) => (e.played ? Math.round((e.won / e.played) * 100) + " %" : "–")],
    ["Bestzeit", (e) => (e.best === null ? "–" : formatiereZeit(e.best))],
  ];

  koerper.innerHTML = zeilen.map(([label, fn]) => {
    const zellen = layouts.map((layout) => {
      const e = (stats[statsAnsicht] && stats[statsAnsicht][layout]) ||
                { played: 0, won: 0, best: null };
      return `<td>${fn(e)}</td>`;
    }).join("");
    return `<tr><td class="stat-row-label">${label}</td>${zellen}</tr>`;
  }).join("");

  document.querySelectorAll(".stats-scope-btn").forEach((btn) => {
    btn.classList.toggle("aktiv", btn.dataset.scope === statsAnsicht);
  });
}

/* ---------------------------------------------------------------------
   Gespeichertes Spiel
   --------------------------------------------------------------------- */

function packe() {
  return {
    variante: spiel.variante,
    layout: spiel.layout,
    arten: spiel.steine.map((s) => s.art).join(","),
    weg: spiel.steine.map((s) => (s.weg ? "1" : "0")).join(""),
    vorrat: spiel.vorrat.map((s) => s.id).join(","),
    paare: spiel.paare,
    mischen: spiel.mischen,
  };
}

function speichereSpiel() {
  if (!spiel) return;
  try {
    localStorage.setItem(SPIEL_KEY, JSON.stringify({
      stand: packe(),
      verlauf: spiel.verlauf,
      sekunden: elapsedSeconds,
    }));
  } catch (e) { /* voller Speicher soll das Spiel nicht anhalten */ }
}

function ladeSpiel() {
  try {
    const roh = localStorage.getItem(SPIEL_KEY);
    if (!roh) return null;
    const daten = JSON.parse(roh);
    if (!daten || !daten.stand || !LAYOUTS[daten.stand.layout]) return null;
    return daten;
  } catch (e) { return null; }
}

function loescheSpiel() {
  try { localStorage.removeItem(SPIEL_KEY); } catch (e) { /* egal */ }
}

function ladeModus() {
  try {
    const roh = localStorage.getItem(MODUS_KEY);
    if (!roh) return;
    const m = JSON.parse(roh);
    if (m && (m.variante === "klassisch" || m.variante === "vorrat")) gewaehlteVariante = m.variante;
    if (m && LAYOUTS[m.layout]) gewaehltesLayout = m.layout;
    if (m && typeof m.nurFrei === "boolean") nurFreieMarkieren = m.nurFrei;
  } catch (e) { /* egal */ }
}

function speichereModus() {
  try {
    localStorage.setItem(MODUS_KEY, JSON.stringify({
      variante: gewaehlteVariante,
      layout: gewaehltesLayout,
      nurFrei: nurFreieMarkieren,
    }));
  } catch (e) { /* egal */ }
}

/* ---------------------------------------------------------------------
   Spielstand

   `verlauf` sammelt kleine Abbilder statt ganzer Steinlisten: welche Art auf
   welchem Platz liegt, was weg ist, was im Vorrat liegt. Ein Abbild wiegt so
   rund ein Kilobyte statt zehn – wichtig, weil der Stand auch in den
   Browserspeicher wandert, und der ist schnell voll.
   --------------------------------------------------------------------- */

function abbild() {
  return {
    a: spiel.steine.map((s) => s.art).join(","),
    w: spiel.steine.map((s) => (s.weg ? "1" : "0")).join(""),
    v: spiel.vorrat.map((s) => s.id).join(","),
    p: spiel.paare,
    m: spiel.mischen,
  };
}

function merkeSchritt() {
  spiel.verlauf.push(abbild());
  if (spiel.verlauf.length > 150) spiel.verlauf.shift();
}

function stelleHer(bild) {
  const arten = bild.a.split(",");
  spiel.steine.forEach((s, i) => {
    s.art = arten[i];
    s.weg = bild.w[i] === "1";
  });
  const nachId = new Map(spiel.steine.map((s) => [s.id, s]));
  spiel.vorrat = bild.v ? bild.v.split(",").map((id) => nachId.get(id)).filter(Boolean) : [];
  spiel.paare = bild.p;
  spiel.mischen = bild.m;
  spiel.gewaehlt = null;
}

/* ---------------------------------------------------------------------
   Größe und Lage

   Alles ist linear in der Steinbreite: Wird der Stein doppelt so breit, wird
   das Brett doppelt so groß. Deshalb wird einmal mit Breite 1 gemessen und
   danach nur noch skaliert – kein Suchen, kein Probieren.
   --------------------------------------------------------------------- */

function messeBrett(steine, w) {
  const h = w * STEIN_VERHAELTNIS;
  const dx = w * EBENE_DX;
  const dy = h * EBENE_DY;
  let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
  steine.forEach((s) => {
    const l = s.x * w / 2 - s.z * dx;
    const t = s.y * h / 2 - s.z * dy;
    if (l < minL) minL = l;
    if (t < minT) minT = t;
    /* Rechts und unten steht die Seitenwand über die Oberseite hinaus. */
    if (l + w + dx > maxR) maxR = l + w + dx;
    if (t + h + dy > maxB) maxB = t + h + dy;
  });
  return { w, h, dx, dy, minL, minT, breite: maxR - minL, hoehe: maxB - minT };
}

/** Wie viel Platz das Brett hat – Fenster minus Kopf, Fuß und Vorratsleiste. */
function freierPlatz() {
  const kopf = document.getElementById("topbar");
  const fuss = document.getElementById("game-footer");
  const vorrat = document.getElementById("vorrat-leiste");
  const rand = handyAnsicht() ? 16 : 56;
  const vorratHoehe = vorrat.classList.contains("hidden")
    ? 0
    : vorrat.offsetHeight + (handyAnsicht() ? 10 : 18);
  return {
    breite: Math.max(160, window.innerWidth - (handyAnsicht() ? 12 : 28)),
    hoehe: Math.max(160, window.innerHeight - kopf.offsetHeight - fuss.offsetHeight
                         - vorratHoehe - rand),
  };
}

/** Schreibt die gerechneten Maße ins Stylesheet und an das Brett. */
function schreibeMasse() {
  const wurzel = document.documentElement;
  wurzel.style.setProperty("--stein-w", masse.w.toFixed(2) + "px");
  wurzel.style.setProperty("--stein-h", masse.h.toFixed(2) + "px");
  wurzel.style.setProperty("--ebene-dx", masse.dx.toFixed(2) + "px");
  wurzel.style.setProperty("--ebene-dy", masse.dy.toFixed(2) + "px");

  const brett = document.getElementById("brett");
  brett.style.width = masse.breite.toFixed(1) + "px";
  brett.style.height = masse.hoehe.toFixed(1) + "px";
}

/**
 * Setzt die Steingröße neu.
 *
 * Gerechnet wird mehrfach, weil sich die Größe selbst in die Rechnung
 * einmischt: Die Vorratsleiste zeigt Steine in derselben Größe, ist also
 * genau so hoch wie ein Stein – und sie steht in dem Platz, der dem Brett
 * bleibt. Größere Steine machen die Leiste höher und dem Brett damit
 * weniger Platz. Ein einziger Durchgang rechnet mit der Leiste von vorher
 * und liefert Steine, die zusammen mit der neuen Leiste nicht mehr passen;
 * die Seite fängt dann an zu scrollen.
 *
 * Nach dem zweiten Durchgang bewegt sich nichts mehr, der dritte ist nur
 * Sicherheitsgurt.
 */
function passeGroesseAn() {
  if (!spiel) return;
  const roh = messeBrett(spiel.steine, 1);
  let letzte = 0;

  for (let durchgang = 0; durchgang < 3; durchgang++) {
    const platz = freierPlatz();
    const passend = Math.min(platz.breite / roh.breite, platz.hoehe / roh.hoehe);
    const w = Math.max(STEIN_MIN, Math.min(STEIN_MAX,
      (autoGroesse ? passend : passend * zoomFaktor)));
    masse = messeBrett(spiel.steine, w);
    schreibeMasse();
    if (Math.abs(w - letzte) < 0.5) break;
    letzte = w;
  }

  const brett = document.getElementById("brett");
  spiel.steine.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (!el || el.parentElement !== brett) return;
    setzeLage(el, s);
  });

  document.getElementById("size-reset").textContent =
    autoGroesse ? "Passend" : Math.round(zoomFaktor * 100) + "%";
}

function setzeLage(el, s) {
  el.style.left = (s.x * masse.w / 2 - s.z * masse.dx - masse.minL).toFixed(1) + "px";
  el.style.top = (s.y * masse.h / 2 - s.z * masse.dy - masse.minT).toFixed(1) + "px";
  /*
     Malreihenfolge: Wer näher am Betrachter liegt, wird später gezeichnet.

     Die Blickachse dieser Schrägansicht steckt im Versatz: Ein Stein eine
     Ebene höher erscheint um (dx, dy) verschoben, also liegt die Achse in
     Richtung (dx, dy, 1). Die Tiefe eines Steins ist seine Länge entlang
     dieser Achse – ein Schritt nach rechts, nach vorn oder nach oben bringt
     ihn näher, und zwar in genau diesem Verhältnis.

     Eine Reihenfolge nach Ebene, dann Reihe, dann Spalte sieht bei geraden
     Gittern gleich aus, lässt bei versetzten Steinen aber Widersprüche zu:
     Ein Stein kann dann über einem liegen, der über einem dritten liegt, der
     wieder über dem ersten liegt. Die Tiefe ist eine Zahl und kennt keine
     Kreise – deshalb wird gerechnet und nicht sortiert.

     Die Ebene wiegt bewusst schwerer als Reihe und Spalte: Steine, die sich
     überhaupt überdecken können, liegen höchstens einen Stein auseinander,
     und ein Stein weiter oben ist immer der vordere.
  */
  const tiefe = s.z +
    (s.x * EBENE_DX + s.y * EBENE_DY * STEIN_VERHAELTNIS) / 2;
  el.style.zIndex = String(Math.round(tiefe * 1000));
  /* Die Ebene steht auch dem Stylesheet zur Verfügung: Je höher der Stein
     liegt, desto weiter wirft er seinen Schatten. Ohne diesen Unterschied
     sieht ein Stapel aus wie ein Muster – der Versatz allein verrät die
     Höhe nicht, wenn alle Steine gleich hell sind. */
  el.style.setProperty("--z", String(s.z));
}

/* ---------------------------------------------------------------------
   Zeichnen
   --------------------------------------------------------------------- */

function baueSteinElement(s) {
  const el = document.createElement("div");
  el.className = "stein";
  el.dataset.id = s.id;
  el.addEventListener("click", () => aufStein(s));
  return el;
}

/**
 * Legt Motiv und Beschriftung auf einen Stein.
 *
 * Der Stein selbst ist nur der Körper; das Bild sitzt auf der Oberseite, die
 * als eigenes Element darin liegt. So kann `zeichne` die Klassen des Steins
 * frei überschreiben, ohne das Motiv wegzuwerfen.
 */
function schreibeStein(el, s) {
  const a = STEIN_ARTEN[s.art];
  el.innerHTML = `<span class="stein-face">${steinMotiv(s.art)}</span>`;
  el.title = a.name;
  /* Klassen für Auswahl und Zustand setzt `zeichne`; hier nur die Gruppe. */
  el.dataset.klasse = a.klasse;
  /* Die Blumen tragen je eine eigene Farbe – die hängt am Stylesheet. */
  el.dataset.art = s.art;
}

function baueBrett() {
  const brett = document.getElementById("brett");
  brett.innerHTML = "";
  steinElemente.clear();
  spiel.steine.forEach((s) => {
    const el = baueSteinElement(s);
    schreibeStein(el, s);
    brett.appendChild(el);
    steinElemente.set(s.id, el);
  });

  const plaetze = document.getElementById("vorrat-plaetze");
  plaetze.innerHTML = "";
  vorratElemente = [];
  for (let i = 0; i < VORRAT_PLAETZE; i++) {
    const platz = document.createElement("div");
    platz.className = "vorrat-platz";
    plaetze.appendChild(platz);
    vorratElemente.push(platz);
  }
  const mitVorrat = spiel.variante === "vorrat";
  document.getElementById("vorrat-leiste").classList.toggle("hidden", !mitVorrat);
  document.getElementById("board").classList.toggle("ohne-vorrat", !mitVorrat);
}

/**
 * Bringt Steine und Anzeigen auf den Stand des Spiels.
 *
 * Die Elemente werden nicht neu gebaut, nur ihre Klassen gesetzt – sonst
 * würde jede Bewegung die Übergänge abschneiden.
 */
function zeichne() {
  const brett = document.getElementById("brett");
  const frei = new Set(freieSteine(brettSteine()).map((s) => s.id));

  spiel.steine.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (!el) return;
    const fach = spiel.vorrat.indexOf(s);

    if (fach !== -1) {
      /* Der Stein liegt im Fach: aus dem Brett heraus und dorthin. */
      const platz = vorratElemente[fach];
      if (el.parentElement !== platz) {
        el.style.left = "";
        el.style.top = "";
        el.style.zIndex = "";
        platz.appendChild(el);
      }
      el.className = "stein " + el.dataset.klasse;
      return;
    }

    if (s.weg) {
      /* Ausgeblendet wird da, wo der Stein gerade liegt – auch wenn das ein
         Vorratsfach ist. Ihn vorher aufs Brett zurückzusetzen sähe aus wie
         ein Sprung; aufgeräumt wird nach dem Flug. */
      el.className = "stein " + el.dataset.klasse + " weg";
      return;
    }

    if (el.parentElement !== brett) {
      brett.appendChild(el);
      setzeLage(el, s);
    }
    el.className = "stein " + el.dataset.klasse;
    el.classList.add(frei.has(s.id) ? "frei" : "verbaut");
    if (spiel.gewaehlt === s) el.classList.add("gewaehlt");
  });

  vorratElemente.forEach((platz, i) => {
    /* Der letzte freie Platz wird hervorgehoben: Danach muss ein Paar
       zusammenkommen, sonst ist Schluss. */
    platz.classList.toggle("letzter",
      spiel.variante === "vorrat" && i === VORRAT_PLAETZE - 1 &&
      spiel.vorrat.length === VORRAT_PLAETZE - 1);
  });

  const uebrig = spiel.steine.filter((s) => !s.weg).length;
  setzeWert("uebrig-count", String(uebrig));
  setzeWert("paar-count", String(spiel.paare));
  setzeWert("misch-count", String(spiel.mischen));
  /* Auf dem Handy nur der Aufbau: "Vorrat · Schildkröte" schiebt die Zeile
     aus dem Bild, und welche Variante läuft, sagt die Vorratsleiste. */
  document.getElementById("modus-label").textContent = handyAnsicht()
    ? LAYOUTS[spiel.layout].name
    : (spiel.variante === "vorrat" ? "Vorrat" : "Klassisch") + " · " + LAYOUTS[spiel.layout].name;

  document.getElementById("undo-btn").disabled = spiel.verlauf.length === 0;
}

/**
 * Stellt ein, welche Steine hervorgehoben werden.
 *
 * Zwei Bilder desselben Spiels: Entweder liegen nur die anhebbaren Steine im
 * Licht und der Rest tritt zurück – das führt beim Suchen –, oder alle Steine
 * sind gleich hell. Dann sieht der Tisch aus wie ein echter Stapel, und wo es
 * weitergeht, muss man selbst sehen.
 *
 * Am Zustand des Steins ändert das nichts: Anheben lässt sich in beiden
 * Fällen nur, was frei liegt.
 */
function setzeMarkierung() {
  document.getElementById("brett").classList.toggle("nur-frei", nurFreieMarkieren);
  const btn = document.getElementById("markier-btn");
  btn.setAttribute("aria-pressed", nurFreieMarkieren ? "true" : "false");
  document.getElementById("markier-text").textContent =
    nurFreieMarkieren ? "Nur freie" : "Alle Steine";
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
   Spielen
   --------------------------------------------------------------------- */

function loescheHinweis() {
  clearTimeout(hinweisTimer);
  steinElemente.forEach((el) => el.classList.remove("hinweis"));
}

function blitze(steine) {
  steine.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (!el) return;
    el.classList.remove("daneben");
    void el.offsetWidth;
    el.classList.add("daneben");
    setTimeout(() => el.classList.remove("daneben"), 440);
  });
}

async function aufStein(s) {
  if (!spiel || raeumtAb || s.weg) return;
  loescheHinweis();

  if (spiel.vorrat.indexOf(s) !== -1) return;   // liegt schon im Fach

  if (!istFrei(s, brettSteine())) {
    blitze([s]);
    return;
  }

  if (spiel.variante === "vorrat") await legeInVorrat(s);
  else await waehleKlassisch(s);
}

/** Klassisch: erster Klick wählt, zweiter räumt ab oder wählt neu. */
async function waehleKlassisch(s) {
  if (spiel.gewaehlt === s) {
    spiel.gewaehlt = null;
    zeichne();
    return;
  }
  if (spiel.gewaehlt && passt(spiel.gewaehlt, s)) {
    const a = spiel.gewaehlt;
    spiel.gewaehlt = null;
    merkeSchritt();
    await raeumeAb([a, s]);
    return;
  }
  if (spiel.gewaehlt) blitze([spiel.gewaehlt, s]);
  spiel.gewaehlt = s;
  zeichne();
}

/**
 * Vorrat: Der Stein wandert auf einen freien Platz.
 *
 * Passt er zu einem, der dort schon liegt, gehen beide sofort weg – deshalb
 * kann im Vorrat nie ein Paar liegen, und "alle vier belegt" heißt immer
 * "vier verschiedene".
 */
async function legeInVorrat(s) {
  const partner = spiel.vorrat.find((v) => passt(v, s));

  if (!partner && spiel.vorrat.length >= VORRAT_PLAETZE) {
    blitze([s]);
    return;
  }

  merkeSchritt();

  if (partner) {
    spiel.vorrat = spiel.vorrat.filter((v) => v !== partner);
    zeichne();
    await raeumeAb([partner, s]);
    return;
  }

  spiel.vorrat.push(s);
  zeichne();
  speichereSpiel();
  pruefeStand();
}

/** Nimmt ein Paar vom Tisch, mit Flug. */
async function raeumeAb(paar) {
  raeumtAb = true;
  paar.forEach((s) => {
    s.weg = true;
    spiel.vorrat = spiel.vorrat.filter((v) => v !== s);
  });
  spiel.paare += 1;
  zeichne();
  await delay(WEG_MS);
  /* Zurück an den Platz auf dem Brett – unsichtbar, aber dort, wo ein Undo
     ihn wieder braucht. Bliebe er im Fach, läge er dem nächsten Stein im
     Weg. */
  paar.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (el && el.parentElement !== document.getElementById("brett")) {
      document.getElementById("brett").appendChild(el);
      setzeLage(el, s);
    }
  });
  raeumtAb = false;
  speichereSpiel();
  pruefeStand();
}

/**
 * Steht es noch gut?
 *
 * Gewonnen ist, wenn nichts mehr liegt. Festgefahren ist, wenn kein Zug mehr
 * geht – im Klassiker also kein passendes Paar frei liegt, in der
 * Vorrat-Variante zusätzlich, wenn alle Plätze belegt sind und nichts
 * zusammenpasst.
 */
function pruefeStand() {
  const uebrig = spiel.steine.filter((s) => !s.weg).length;
  if (uebrig === 0) { zeigeEnde(true); return; }

  const geht = spiel.variante === "vorrat"
    ? vorratZugMoeglich(brettSteine(), spiel.vorrat, VORRAT_PLAETZE)
    : klassischZugMoeglich(spiel.steine);

  if (!geht) zeigeEnde(false);
}

function zeigeHinweis() {
  loescheHinweis();
  if (!spiel) return;

  let ziele = null;

  if (spiel.variante === "vorrat") {
    /* Erst schauen, ob etwas zu einem Stein im Fach passt – das ist der Zug,
       der wirklich etwas bringt. */
    const frei = freieSteine(brettSteine());
    for (const s of frei) {
      if (spiel.vorrat.some((v) => passt(v, s))) { ziele = [s]; break; }
    }
    if (!ziele && spiel.vorrat.length < VORRAT_PLAETZE) {
      const paar = freiesPaar(brettSteine());
      if (paar) ziele = paar;
    }
  } else {
    ziele = freiesPaar(spiel.steine);
  }

  if (!ziele) {
    meldeAmKnopf("hint-btn", '<span class="icon">✗</span>Kein Zug frei', "result-bad");
    return;
  }

  ziele.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (el) el.classList.add("hinweis");
  });
  hinweisTimer = setTimeout(loescheHinweis, HINWEIS_MS);
}

function mischeNeu() {
  if (!spiel) return;
  loescheHinweis();
  merkeSchritt();
  /* Der Vorrat kommt zurück auf den Tisch: Steine im Fach sollen mitgemischt
     werden, sonst bliebe der Vorrat mit vier Steinen stehen, die nirgends
     mehr einen Partner haben. */
  spiel.vorrat = [];
  spiel.gewaehlt = null;

  if (!mischeUebrige(spiel.steine)) {
    spiel.verlauf.pop();
    meldeAmKnopf("misch-btn", '<span class="icon">✗</span>Geht nicht mehr', "result-bad");
    zeichne();
    return;
  }

  spiel.mischen += 1;
  spiel.steine.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (el && !s.weg) schreibeStein(el, s);
  });
  zeichne();
  speichereSpiel();
  laufWeiter();
  meldeAmKnopf("misch-btn", '<span class="icon">✓</span>Neu verteilt', "result-ok");
}

function nimmZurueck() {
  if (!spiel || spiel.verlauf.length === 0) return;
  loescheHinweis();
  const bild = spiel.verlauf.pop();
  stelleHer(bild);
  spiel.steine.forEach((s) => {
    const el = steinElemente.get(s.id);
    if (el) schreibeStein(el, s);
  });
  zeichne();
  passeGroesseAn();
  speichereSpiel();
  laufWeiter();
}

/**
 * Nach Zurücknehmen oder Mischen geht es weiter: Meldung weg, Uhr wieder an.
 *
 * Die Uhr steht, weil das Ende angezeigt wurde. Sie hier zu starten und
 * nicht in den Knopf-Handlern zu wiederholen, deckt auch Strg+Z ab – sonst
 * läuft ein wiederbelebtes Spiel ohne Zeit weiter.
 */
function laufWeiter() {
  versteckeEnde();
  if (!timerInterval) starteTimer(elapsedSeconds);
}

/** Kurze Rückmeldung am Knopf, wie beim Zugcheck in Spider. */
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
   Anfang und Ende
   --------------------------------------------------------------------- */

function neuesSpiel(variante, layout) {
  spiel = {
    variante: variante,
    layout: layout,
    steine: erzeugeSpiel(layout),
    vorrat: [],
    paare: 0,
    mischen: 0,
    verlauf: [],
    gewaehlt: null,
  };
  merkeGestartet(variante, layout);
  autoGroesse = true;
  zoomFaktor = 1;
  baueBrett();
  passeGroesseAn();
  zeichne();
  versteckeEnde();
  starteTimer(0);
  speichereSpiel();
}

function starteSpiel(variante, layout) {
  gewaehlteVariante = variante;
  gewaehltesLayout = layout;
  speichereModus();
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  neuesSpiel(variante, layout);
}

function setzeSpielFort() {
  const daten = ladeSpiel();
  if (!daten) return;
  const stand = daten.stand;

  spiel = {
    variante: stand.variante === "vorrat" ? "vorrat" : "klassisch",
    layout: stand.layout,
    steine: erzeugeSpiel(stand.layout),
    vorrat: [],
    paare: stand.paare || 0,
    mischen: stand.mischen || 0,
    verlauf: daten.verlauf || [],
    gewaehlt: null,
  };
  /* Die Plätze kommen aus dem Aufbau, die Belegung aus dem Stand. */
  stelleHer({ a: stand.arten, w: stand.weg, v: stand.vorrat,
              p: spiel.paare, m: spiel.mischen });

  gewaehlteVariante = spiel.variante;
  gewaehltesLayout = spiel.layout;
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  autoGroesse = true;
  zoomFaktor = 1;
  baueBrett();
  passeGroesseAn();
  zeichne();
  versteckeEnde();
  starteTimer(daten.sekunden || 0);
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
  const overlay = document.getElementById("end-overlay");
  overlay.classList.add("hidden");
  overlay.classList.remove("ist-verloren");
  document.getElementById("confetti-layer").innerHTML = "";
}

function zeigeEnde(gewonnen) {
  stoppeTimer();
  const overlay = document.getElementById("end-overlay");
  overlay.classList.remove("hidden");
  overlay.classList.toggle("ist-verloren", !gewonnen);

  const uebrig = spiel.steine.filter((s) => !s.weg).length;
  document.getElementById("end-title").textContent = gewonnen ? "Geschafft!" : "Festgefahren";
  document.getElementById("end-text").textContent = gewonnen
    ? `Alle 144 Steine abgeräumt – in ${formatiereZeit(elapsedSeconds)}` +
      (spiel.mischen ? `, mit ${spiel.mischen}× Mischen.` : ", ohne einmal zu mischen.")
    : `Hier geht nichts mehr: ${uebrig} Steine liegen noch, aber kein Paar kommt frei. ` +
      `Zurücknehmen oder neu mischen hilft weiter.`;

  document.getElementById("end-undo-btn").classList.toggle("hidden",
    gewonnen || spiel.verlauf.length === 0);
  document.getElementById("end-misch-btn").classList.toggle("hidden", gewonnen);

  if (gewonnen) {
    merkeGewonnen(spiel.variante, spiel.layout, elapsedSeconds);
    loescheSpiel();
    setTimeout(streueKonfetti, 120);
  }
}

function streueKonfetti() {
  const schicht = document.getElementById("confetti-layer");
  const farben = ["#f2c94c", "#eef3ef", "#3faE6a", "#d1453b", "#5aa9e6"];
  for (let i = 0; i < 90; i++) {
    const stueck = document.createElement("div");
    stueck.className = "confetti-piece";
    stueck.style.left = Math.random() * 100 + "%";
    stueck.style.background = farben[Math.floor(Math.random() * farben.length)];
    stueck.style.animationDuration = (1.9 + Math.random() * 1.6) + "s";
    stueck.style.animationDelay = (Math.random() * 0.5) + "s";
    schicht.appendChild(stueck);
  }
}

/* ---------------------------------------------------------------------
   Startbildschirm
   --------------------------------------------------------------------- */

/**
 * Zeichnet eine kleine Vorschau eines Aufbaus.
 *
 * Gespeist aus denselben Daten wie das Spielfeld – so kann die Vorschau
 * nicht irgendwann etwas anderes zeigen als das, was dann kommt.
 */
function baueVorschau(layoutName) {
  const layout = LAYOUTS[layoutName];
  const steine = layoutPositionen(layout);
  const kasten = document.createElement("span");
  kasten.className = "layout-vorschau";

  const breiteZiel = 84, hoeheZiel = 60;
  const roh = messeBrett(steine, 1);
  const w = Math.min(breiteZiel / roh.breite, hoeheZiel / roh.hoehe);
  const m = messeBrett(steine, w);
  /* Mittig im Kasten, damit schmale Aufbauten nicht links kleben. */
  const versatzX = (breiteZiel - m.breite) / 2;
  const versatzY = (hoeheZiel - m.hoehe) / 2;

  steine.forEach((s) => {
    const i = document.createElement("i");
    i.style.left = (s.x * m.w / 2 - s.z * m.dx - m.minL + versatzX).toFixed(1) + "px";
    i.style.top = (s.y * m.h / 2 - s.z * m.dy - m.minT + versatzY).toFixed(1) + "px";
    i.style.width = Math.max(1.5, m.w - 0.5).toFixed(1) + "px";
    i.style.height = Math.max(2, m.h - 0.5).toFixed(1) + "px";
    i.style.zIndex = String(s.z * 10000 + s.y * 100 + s.x);
    kasten.appendChild(i);
  });
  return kasten;
}

function baueLayoutAuswahl() {
  const gitter = document.getElementById("layout-grid");
  gitter.innerHTML = "";
  Object.keys(LAYOUTS).forEach((key) => {
    const btn = document.createElement("button");
    btn.className = "layout-btn";
    btn.type = "button";
    btn.title = LAYOUTS[key].hinweis;
    btn.appendChild(baueVorschau(key));
    const titel = document.createElement("span");
    titel.className = "layout-btn-title";
    titel.textContent = LAYOUTS[key].name;
    btn.appendChild(titel);
    btn.addEventListener("click", () => starteSpiel(gewaehlteVariante, key));
    gitter.appendChild(btn);
  });
}

function zeigeFortsetzen() {
  const btn = document.getElementById("continue-btn");
  const daten = ladeSpiel();
  if (!daten) { btn.classList.add("hidden"); return; }
  const stand = daten.stand;
  const uebrig = (stand.weg.match(/0/g) || []).length;
  document.getElementById("continue-meta").textContent =
    (stand.variante === "vorrat" ? "Vorrat" : "Klassisch") + " · " +
    LAYOUTS[stand.layout].name + " · " + uebrig + " Steine übrig · " +
    formatiereZeit(daten.sekunden || 0);
  btn.classList.remove("hidden");
}

function setzeVarianteAnzeige() {
  document.querySelectorAll(".variante-btn").forEach((btn) => {
    btn.classList.toggle("aktiv", btn.dataset.variante === gewaehlteVariante);
  });
}

/* ---------------------------------------------------------------------
   Verdrahtung
   --------------------------------------------------------------------- */

document.querySelectorAll(".variante-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    gewaehlteVariante = btn.dataset.variante;
    speichereModus();
    setzeVarianteAnzeige();
  });
});

document.querySelectorAll(".stats-scope-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    statsAnsicht = btn.dataset.scope;
    zeigeStatsTabelle();
  });
});

document.getElementById("stats-reset").addEventListener("click", () => {
  speichereStats({});
  zeigeStatsTabelle();
});

document.getElementById("continue-btn").addEventListener("click", setzeSpielFort);
document.getElementById("game-title").addEventListener("click", zurueckZurAuswahl);
document.getElementById("markier-btn").addEventListener("click", () => {
  nurFreieMarkieren = !nurFreieMarkieren;
  setzeMarkierung();
  speichereModus();
});
document.getElementById("hint-btn").addEventListener("click", zeigeHinweis);
document.getElementById("misch-btn").addEventListener("click", mischeNeu);
document.getElementById("undo-btn").addEventListener("click", nimmZurueck);
document.getElementById("new-game-btn").addEventListener("click", () => {
  neuesSpiel(spiel ? spiel.variante : gewaehlteVariante, spiel ? spiel.layout : gewaehltesLayout);
});

document.getElementById("end-again-btn").addEventListener("click", () => {
  neuesSpiel(spiel.variante, spiel.layout);
});
document.getElementById("end-undo-btn").addEventListener("click", nimmZurueck);
document.getElementById("end-misch-btn").addEventListener("click", mischeNeu);
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

window.addEventListener("resize", () => {
  if (!spiel) return;
  if (autoGroesse) passeGroesseAn();
  /* Die Modus-Beschriftung hängt an der Fensterbreite. */
  zeichne();
});

document.addEventListener("keydown", (e) => {
  if (!spiel || document.getElementById("game-screen").classList.contains("hidden")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); nimmZurueck(); }
  else if (e.key === "h") zeigeHinweis();
  else if (e.key === "Escape" && spiel.gewaehlt) { spiel.gewaehlt = null; zeichne(); }
});

ladeModus();
setzeMarkierung();
setzeVarianteAnzeige();
baueLayoutAuswahl();
zeigeStatsTabelle();
zeigeFortsetzen();
