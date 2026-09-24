"use strict";

/* =====================================================================
   Serie · Tage in Folge

   Wie viele Tage hintereinander man das Tagespensum geschafft hat. Was
   das Pensum ist, entscheidet jedes Spiel selbst – bei Wordle alle drei
   Rätsel, bei Quordle das eine, bei Starstruck beide Tagesrätsel. Hier
   steht nur das Zählen.

   Gezählt werden Tage, nicht Partien: Wer an einem Tag dreimal gewinnt,
   hat einen Tag in der Serie, nicht drei.

   Gespeichert wird der zuletzt geschaffte Tag und zwei Zahlen. Ob die
   Serie noch läuft, ergibt sich daraus erst beim Lesen: Liegt der letzte
   Tag weiter zurück als gestern, ist sie gerissen. Das muss so herum
   sein – niemand öffnet ein Spiel um Mitternacht, damit ein Zähler
   zurückgesetzt wird.
   ===================================================================== */

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Der Tag davor, als "2026-09-21".
 *
 * Gerechnet wird über die Mittagszeit: Ein Tag ist bei der Umstellung auf
 * Winterzeit 25 Stunden lang, und 24 Stunden vor Mitternacht läge dann
 * noch im selben Tag.
 */
function tagDavor(tag) {
  const t = new Date(tag + "T12:00:00");
  const d = new Date(t.getTime() - TAG_MS);
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

/** Das heutige Datum als "2026-09-22" – nach Ortszeit, nicht nach UTC. */
function heutigerTagSerie(datum) {
  const d = datum || new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function macheSerie(schluessel) {

  function lade() {
    try {
      const roh = localStorage.getItem(schluessel);
      if (roh) {
        const s = JSON.parse(roh);
        if (s && typeof s.aktuell === "number" && typeof s.best === "number") return s;
      }
    } catch (e) { /* egal */ }
    return { letzterTag: null, aktuell: 0, best: 0 };
  }

  return {
    /**
     * Hält fest, dass das Tagespensum an `tag` geschafft ist.
     *
     * Mehrfach am selben Tag aufgerufen ändert nichts – der Aufrufer muss
     * also nicht wissen, ob er heute schon gemeldet hat.
     */
    merkeTagGeschafft: function (tag) {
      const s = lade();
      if (s.letzterTag === tag) return;
      s.aktuell = s.letzterTag === tagDavor(tag) ? s.aktuell + 1 : 1;
      s.letzterTag = tag;
      if (s.aktuell > s.best) s.best = s.aktuell;
      try { localStorage.setItem(schluessel, JSON.stringify(s)); } catch (e) { /* egal */ }
    },

    /**
     * Der Stand, bezogen auf `heute`.
     *
     * `aktuell` ist null, sobald der letzte geschaffte Tag weiter
     * zurückliegt als gestern: Die Serie läuft dann nicht mehr, auch wenn
     * die gespeicherte Zahl noch dasteht.
     */
    stand: function (heute) {
      const s = lade();
      const laeuft = s.letzterTag === heute || s.letzterTag === tagDavor(heute);
      return {
        aktuell: laeuft ? s.aktuell : 0,
        best: s.best,
        heuteGeschafft: s.letzterTag === heute,
      };
    },

    zuruecksetzen: function () {
      try { localStorage.removeItem(schluessel); } catch (e) { /* egal */ }
    },
  };
}
