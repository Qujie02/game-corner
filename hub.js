"use strict";

/* =====================================================================
   Game Corner · Statistiken über alle Spiele

   Jedes Spiel führt seine Zahlen selbst und legt sie unter einem eigenen
   Schlüssel im Browserspeicher ab. Die Formate unterscheiden sich, weil sie
   nacheinander entstanden sind – hier werden sie eingesammelt und auf eine
   gemeinsame Form gebracht: gespielt, gewonnen, Bestzeit.

   Gelesen wird nur; geschrieben wird ausschließlich beim Zurücksetzen.
   ===================================================================== */

const SPIELE = [
  { name: "Spider Solitaire", schluessel: "spiderSolitaireStats", form: "spider" },
  { name: "Schwimmen", schluessel: "schwimmenStats", form: "flach" },
  { name: "Minesweeper", schluessel: "minesweeperStats", form: "modi" },
  { name: "Puzzle", schluessel: "puzzleStats", form: "modi" },
  { name: "Starstruck", schluessel: "starstruckStats", form: "modi" },
  { name: "Mahjong", schluessel: "mahjongStats", form: "modi" },
  { name: "FreeCell", schluessel: "freecellStats", form: "modi" },
];

function lies(schluessel) {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? JSON.parse(roh) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Bringt die Zahlen eines Spiels auf die gemeinsame Form.
 *
 * "modi"   – ein Eintrag je Schwierigkeit oder Größe: { played, won, best }
 * "spider" – wie modi, nur heißt die Bestzeit dort bestDuration; außerdem
 *            liegen die Einträge dort eine Ebene tiefer, getrennt nach
 *            gemischten und lösbaren Blättern
 * "flach"  – ein einzelner Eintrag ohne Bestzeit
 *
 * Hier zählt die Summe über alles, was gespielt wurde – die Aufschlüsselung
 * steht auf der Startseite des jeweiligen Spiels.
 */
function fasseZusammen(eintrag) {
  const daten = lies(eintrag.schluessel);
  const summe = { gespielt: 0, gewonnen: 0, best: null };
  if (!daten) return summe;

  if (eintrag.form === "flach") {
    summe.gespielt = daten.played || 0;
    summe.gewonnen = daten.won || 0;
    return summe;
  }

  const bestFeld = eintrag.form === "spider" ? "bestDuration" : "best";
  addiere(daten, summe, bestFeld, 2);
  return summe;
}

/** Zählt alle { played, won, best }-Einträge zusammen, auch verschachtelte. */
function addiere(knoten, summe, bestFeld, tiefe) {
  for (const schluessel in knoten) {
    const e = knoten[schluessel];
    if (!e || typeof e !== "object") continue;
    if (typeof e.played === "number" || typeof e.won === "number") {
      summe.gespielt += e.played || 0;
      summe.gewonnen += e.won || 0;
      const best = e[bestFeld];
      if (typeof best === "number" && (summe.best === null || best < summe.best)) {
        summe.best = best;
      }
    } else if (tiefe > 0) {
      addiere(e, summe, bestFeld, tiefe - 1);
    }
  }
}

function formatiereZeit(sekunden) {
  if (sekunden === null) return "–";
  const m = Math.floor(sekunden / 60);
  const s = Math.round(sekunden % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function quote(gespielt, gewonnen) {
  if (!gespielt) return "–";
  return Math.round((gewonnen / gespielt) * 100) + " %";
}

function zeile(name, werte, klasse) {
  const tr = document.createElement("tr");
  if (klasse) tr.className = klasse;
  const th = document.createElement("th");
  th.textContent = name;
  tr.appendChild(th);
  for (let i = 0; i < werte.length; i++) {
    const td = document.createElement("td");
    td.textContent = werte[i];
    tr.appendChild(td);
  }
  return tr;
}

function zeigeStatistiken() {
  const koerper = document.getElementById("hub-stats-body");
  const tabelle = document.getElementById("hub-stats-table");
  const leer = document.getElementById("hub-stats-leer");
  koerper.innerHTML = "";

  let gesamtGespielt = 0, gesamtGewonnen = 0;
  for (let i = 0; i < SPIELE.length; i++) {
    const s = fasseZusammen(SPIELE[i]);
    gesamtGespielt += s.gespielt;
    gesamtGewonnen += s.gewonnen;
    koerper.appendChild(zeile(SPIELE[i].name, [
      String(s.gespielt),
      String(s.gewonnen),
      quote(s.gespielt, s.gewonnen),
      formatiereZeit(s.best),
    ]));
  }

  // Eine Gesamt-Bestzeit über verschiedene Spiele hinweg wäre sinnlos –
  // die Zeiten sind nicht vergleichbar.
  koerper.appendChild(zeile("Gesamt", [
    String(gesamtGespielt),
    String(gesamtGewonnen),
    quote(gesamtGespielt, gesamtGewonnen),
    "–",
  ], "gesamt"));

  const nichts = gesamtGespielt === 0 && gesamtGewonnen === 0;
  tabelle.classList.toggle("hidden", nichts);
  leer.classList.toggle("hidden", !nichts);
}

document.getElementById("hub-stats-reset").addEventListener("click", function () {
  if (!confirm("Die Statistiken aller Spiele wirklich zurücksetzen? Laufende Spielstände bleiben erhalten.")) return;
  for (let i = 0; i < SPIELE.length; i++) {
    try { localStorage.removeItem(SPIELE[i].schluessel); } catch (e) { /* egal */ }
  }
  zeigeStatistiken();
});

zeigeStatistiken();
