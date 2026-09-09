"use strict";

/* =====================================================================
   Service Worker

   Damit die Sammlung als App auf dem Startbildschirm liegt und auch ohne
   Netz startet. Der Code aller Spiele wird bei der Installation abgelegt –
   zusammen keine 500 Kilobyte; die Puzzle-Bilder bleiben ausgenommen, die
   sind zu zweit über zwanzig Megabyte groß.

   Ausgeliefert wird aus dem Speicher, und parallel wird im Hintergrund die
   neue Fassung geholt: Nach dem Hochladen einer Änderung sieht man sie also
   beim übernächsten Aufruf. Das ist der Preis dafür, dass die App sofort
   startet und ohne Netz funktioniert – und deutlich angenehmer, als bei
   jeder Änderung eine Versionsnummer pflegen zu müssen.

   VERSION braucht nur eine neue Zeichenkette, wenn Dateien wegfallen oder
   umziehen: Dann wird der alte Speicher beim Aktivieren weggeräumt.
   ===================================================================== */

const VERSION = "game-corner-v1";

/* Was ohne Netz da sein muss. Pfade relativ zu dieser Datei, damit es auch
   funktioniert, wenn die Sammlung in einem Unterordner liegt. */
const SCHALE = [
  "./",
  "./index.html",
  "./hub.css",
  "./hub.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",

  "./games/spider/index.html",
  "./games/spider/style.css",
  "./games/spider/game.js",

  "./games/schwimmen/index.html",
  "./games/schwimmen/style.css",
  "./games/schwimmen/game.js",

  "./games/starstruck/index.html",
  "./games/starstruck/style.css",
  "./games/starstruck/game.js",
  "./games/starstruck/engine.js",
  "./games/starstruck/worker.js",

  "./games/minesweeper/index.html",
  "./games/minesweeper/style.css",
  "./games/minesweeper/game.js",
  "./games/minesweeper/engine.js",

  "./games/freecell/index.html",
  "./games/freecell/style.css",
  "./games/freecell/game.js",
  "./games/freecell/engine.js",

  "./games/mahjong/index.html",
  "./games/mahjong/style.css",
  "./games/mahjong/game.js",
  "./games/mahjong/engine.js",
  "./games/mahjong/motive.js",

  "./games/puzzle/index.html",
  "./games/puzzle/style.css",
  "./games/puzzle/game.js",
  "./games/puzzle/engine.js",
  "./games/puzzle/bilder/bilder.js",
];

/* Auf dem eigenen Rechner wird zuerst das Netz gefragt: Beim Entwickeln
   will man die Datei sehen, die gerade auf der Platte liegt, nicht die von
   vorhin. Die Ablage bleibt trotzdem gefüllt, damit sich der Offline-Betrieb
   auch lokal ausprobieren lässt. */
const ENTWICKLUNG = ["localhost", "127.0.0.1", "[::1]"].indexOf(self.location.hostname) >= 0;

/* Größer als das wird nichts nachträglich gespeichert. Ein einzelnes
   Puzzlemotiv wiegt bis zu fünfzehn Megabyte – das gehört nicht in den
   Speicher eines Telefons. */
const NACHLADE_GRENZE = 2 * 1024 * 1024;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((speicher) => speicher.addAll(SCHALE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const anfrage = e.request;
  if (anfrage.method !== "GET") return;
  if (new URL(anfrage.url).origin !== self.location.origin) return;

  if (ENTWICKLUNG) {
    e.respondWith(fetch(anfrage).catch(() => caches.match(anfrage, { ignoreSearch: true })));
    return;
  }

  e.respondWith(
    caches.match(anfrage, { ignoreSearch: true }).then((treffer) => {
      const ausDemNetz = fetch(anfrage).then((antwort) => {
        if (antwort && antwort.ok && antwort.type === "basic") {
          const laenge = Number(antwort.headers.get("content-length") || 0);
          // Größenlose Antworten dürfen durch, wenn sie schon abgelegt waren –
          // sonst fiele ausgerechnet die Auffrischung der Schale weg.
          if (treffer || (laenge > 0 && laenge <= NACHLADE_GRENZE)) {
            const kopie = antwort.clone();
            caches.open(VERSION).then((speicher) => speicher.put(anfrage, kopie));
          }
        }
        return antwort;
      });

      if (treffer) {
        // Der Abruf läuft weiter und legt die neue Fassung ab; ausgeliefert
        // wird sofort aus dem Speicher.
        e.waitUntil(ausDemNetz.catch(() => {}));
        return treffer;
      }

      return ausDemNetz.catch(() => {
        // Ohne Netz und ohne Ablage: Seitenaufrufe landen auf der Übersicht,
        // damit man nicht in einer Fehlerseite feststeckt.
        if (anfrage.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
