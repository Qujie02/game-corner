"use strict";

/* =====================================================================
   Anmeldung des Service Workers

   Wo die Sammlung liegt, steht schon im Manifest-Verweis der Seite – aus
   dessen Adresse wird das Wurzelverzeichnis abgeleitet. So funktioniert
   dieselbe Datei aus dem Hauptverzeichnis wie aus games/spider/, ohne dass
   irgendwo ein Pfad doppelt gepflegt werden muss.

   Ohne HTTPS gibt es keinen Service Worker – dann läuft alles wie vorher,
   nur eben ohne Installation und ohne Offline-Betrieb. Auf localhost gilt
   das nicht, dort läuft er: So lässt sich die Installation ausprobieren,
   ohne etwas hochzuladen. Damit er beim Entwickeln nicht die vorige Fassung
   ausliefert, arbeitet er dort netz-zuerst – siehe sw.js.
   ===================================================================== */

(function () {
  if (!("serviceWorker" in navigator)) return;

  const verweis = document.querySelector('link[rel="manifest"]');
  if (!verweis) return;
  const wurzel = new URL(".", verweis.href).href;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register(wurzel + "sw.js", { scope: wurzel }).catch(function () {
      /* Kein Netz, keine Berechtigung, kein HTTPS – das Spiel läuft trotzdem. */
    });
  });
})();
