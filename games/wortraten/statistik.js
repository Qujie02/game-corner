"use strict";

/* =====================================================================
   Worträtsel · Statistik

   Wordle und Quordle führen dieselben Zahlen, nur unter anderen
   Schlüsseln. Deshalb steht das Zählen hier einmal; `macheStatistik`
   liefert je Spiel ein eigenes Exemplar.

   Zwei Schlüssel, weil es zwei Leser gibt: Die Übersicht der Sammlung
   sammelt played/won/best ein und kommt mit nichts anderem zurecht –
   dort liegt nur das. Alles Weitere steht im Verlauf, einer Liste
   beendeter Partien, aus der sich wenigste, meiste und durchschnittliche
   Zugzahl rechnen lassen, auch für die letzten zehn.
   ===================================================================== */

/* So viele Partien stehen in der Statistik unter "Letzte 10". */
const LETZTE_N = 10;

/* Mehr als ein paar hundert Partien braucht niemand nachzuschlagen. */
const VERLAUF_MAX = 300;

function liesSpeicher(schluessel, ersatz) {
  try {
    const roh = localStorage.getItem(schluessel);
    if (roh) return JSON.parse(roh);
  } catch (e) { /* egal */ }
  return ersatz;
}

function schreibSpeicher(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch (e) { /* egal */ }
}

function macheStatistik(statsSchluessel, verlaufSchluessel) {

  function ladeVerlauf() {
    const v = liesSpeicher(verlaufSchluessel, []);
    return Array.isArray(v) ? v : [];
  }

  function hubZahlen() {
    const stats = liesSpeicher(statsSchluessel, {});
    if (!stats.taeglich) stats.taeglich = { played: 0, won: 0, best: null };
    return stats;
  }

  return {
    /** Zählt eine begonnene Partie – beim ersten angenommenen Versuch. */
    merkeGestartet: function () {
      const stats = hubZahlen();
      stats.taeglich.played += 1;
      schreibSpeicher(statsSchluessel, stats);
    },

    /**
     * Schreibt eine beendete Partie fort.
     *
     * `best` bleibt leer: Die Übersicht der Sammlung zeigt in dieser
     * Spalte eine Bestzeit, und geraten wird nicht auf Zeit. Was hier
     * zählt, ist die Zugzahl – die steht im Verlauf.
     */
    merkeBeendet: function (gewonnen, zuege) {
      const stats = hubZahlen();
      if (gewonnen) stats.taeglich.won += 1;
      schreibSpeicher(statsSchluessel, stats);

      const verlauf = ladeVerlauf();
      verlauf.push({ g: gewonnen ? 1 : 0, z: zuege });
      while (verlauf.length > VERLAUF_MAX) verlauf.shift();
      schreibSpeicher(verlaufSchluessel, verlauf);
    },

    zuruecksetzen: function () {
      try {
        localStorage.removeItem(statsSchluessel);
        localStorage.removeItem(verlaufSchluessel);
      } catch (e) { /* egal */ }
    },

    /** Füllt die Tabelle mit den Spalten "Alle" und "Letzte 10". */
    zeigeTabelle: function (koerperId) {
      const verlauf = ladeVerlauf();
      const spalten = [verlauf, verlauf.slice(-LETZTE_N)];

      const zeilen = [
        ["Gespielt", (p) => String(p.length)],
        ["Gewonnen", (p) => String(p.filter((x) => x.g).length)],
        ["Quote", (p) => (p.length
          ? Math.round((p.filter((x) => x.g).length / p.length) * 100) + " %"
          : "–")],
        ["Wenigste Züge", (p) => zahlOderStrich(zugzahlen(p).min)],
        ["Meiste Züge", (p) => zahlOderStrich(zugzahlen(p).max)],
        ["Ø Züge", (p) => {
          const s = zugzahlen(p).schnitt;
          return s === null ? "–" : s.toFixed(1).replace(".", ",");
        }],
      ];

      document.getElementById(koerperId).innerHTML = zeilen.map(function (eintrag) {
        const felder = spalten.map((p) => "<td>" + eintrag[1](p) + "</td>").join("");
        return "<tr><td class=\"stat-row-label\">" + eintrag[0] + "</td>" + felder + "</tr>";
      }).join("");
    },
  };
}

/** Wenigste, meiste und durchschnittliche Zugzahl über die Siege einer Liste. */
function zugzahlen(partien) {
  const siege = partien.filter((p) => p.g).map((p) => p.z);
  if (siege.length === 0) return { min: null, max: null, schnitt: null };
  let min = siege[0], max = siege[0], summe = 0;
  for (let i = 0; i < siege.length; i++) {
    if (siege[i] < min) min = siege[i];
    if (siege[i] > max) max = siege[i];
    summe += siege[i];
  }
  return { min: min, max: max, schnitt: summe / siege.length };
}

function zahlOderStrich(wert) {
  return wert === null ? "–" : String(wert);
}
