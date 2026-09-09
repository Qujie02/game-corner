"use strict";

/* =====================================================================
   Starstruck · Hintergrund-Rechner

   Erzeugt Rätsel in einem eigenen Thread. Die Oberfläche steuert über
   "pace"-Nachrichten, wie viel Rechenzeit er sich nehmen darf – auch
   mitten in einem laufenden Auftrag, damit angefangene Arbeit nicht
   verloren geht.
   ===================================================================== */

importScripts("engine.js");

self.onmessage = function (e) {
  const msg = e.data;

  if (msg.type === "pace") {
    pacer.set(msg.pace);
    return;
  }

  pacer.set(msg.pace);

  // Funktionen überstehen postMessage nicht – der Rückkanal für nebenbei
  // abgefallene Rätsel wird deshalb hier ergänzt.
  const spec = Object.assign({}, msg.spec, {
    onBonus: function (modeKey, cand) {
      self.postMessage({
        type: "bonus",
        modeKey: modeKey,
        regionOf: Array.from(cand.regionOf),
        stars: cand.stars,
        probeRounds: cand.probeRounds,
      });
    },
  });

  generatePuzzle(msg.n, msg.k, spec, msg.budget).then(
    function (puzzle) {
      if (!puzzle) {
        self.postMessage({ id: msg.id, ok: false });
        return;
      }
      self.postMessage({
        id: msg.id,
        ok: true,
        modeKey: msg.modeKey,
        regionOf: Array.from(puzzle.regionOf),
        stars: puzzle.stars,
        probeRounds: puzzle.probeRounds,
      });
    },
    function (err) {
      self.postMessage({ id: msg.id, ok: false, error: String(err) });
    }
  );
};
