"use strict";

/* =====================================================================
   Worträtsel · Die Eingabezeile

   Wordle und Quordle tippen auf dieselbe Weise, und zwar anders als das
   Vorbild: nicht stur von links nach rechts. Wer schon weiß, dass an
   dritter Stelle ein E steht, soll es dort hinschreiben können, ohne
   sich vorher zwei Buchstaben auszudenken.

   Daraus folgen zwei Regeln, die zusammengehören:

   - Nach einem Buchstaben rückt die Marke auf das nächste freie Feld,
     und wenn rechts keins mehr frei ist, läuft sie vorne wieder um.
     So füllt man die Lücken um einen gesetzten Buchstaben herum auf.
   - Die Rücktaste trägt genauso wieder ab: erst nach links, dann im
     Umlauf. Ohne den zweiten Durchgang bliebe sie an der ersten Stelle
     stehen und täte nichts mehr, während rechts noch Buchstaben stehen.

   Beides stand vorher in beiden Spielen gleichlautend herum. Hier steht
   es einmal; die Spiele lesen `zeichen` und `marke` und zeichnen selbst.
   ===================================================================== */

function macheEingabezeile(laenge) {

  const zeile = {
    laenge: laenge,
    zeichen: new Array(laenge).fill(""),
    marke: 0,
  };

  /** Das nächste leere Feld ab `von` – erst nach rechts, dann von vorn. */
  function naechstesLeer(von) {
    for (let s = von; s < laenge; s++) if (!zeile.zeichen[s]) return s;
    for (let s = 0; s < von; s++) if (!zeile.zeichen[s]) return s;
    return -1;
  }

  /** Das nächste gefüllte Feld links von `von`, sonst das letzte überhaupt. */
  function vorigesGefuellt(von) {
    for (let s = von - 1; s >= 0; s--) if (zeile.zeichen[s]) return s;
    for (let s = laenge - 1; s > von; s--) if (zeile.zeichen[s]) return s;
    return -1;
  }

  zeile.wort = function () {
    return zeile.zeichen.join("");
  };

  zeile.istVoll = function () {
    return zeile.wort().length === laenge;
  };

  zeile.leeren = function () {
    zeile.zeichen = new Array(laenge).fill("");
    zeile.marke = 0;
  };

  zeile.setzeMarke = function (s) {
    if (s >= 0 && s < laenge) zeile.marke = s;
  };

  zeile.bewegeMarke = function (richtung) {
    const ziel = zeile.marke + richtung;
    if (ziel < 0 || ziel >= laenge) return;
    zeile.marke = ziel;
  };

  zeile.tippe = function (buchstabe) {
    zeile.zeichen[zeile.marke] = buchstabe;
    const naechste = naechstesLeer(zeile.marke + 1);
    /* Ist alles voll, bleibt die Marke stehen: Der nächste Tastendruck
       überschreibt dann denselben Buchstaben, statt irgendwohin zu
       springen. Daran erkennt `schreibeUmschrift` auch den Platzmangel. */
    if (naechste >= 0) zeile.marke = naechste;
  };

  zeile.loesche = function () {
    if (zeile.zeichen[zeile.marke]) {
      zeile.zeichen[zeile.marke] = "";
    } else {
      const ziel = vorigesGefuellt(zeile.marke);
      if (ziel < 0) return;
      zeile.marke = ziel;
      zeile.zeichen[zeile.marke] = "";
    }
    /* Ist die Zeile wieder leer, fängt man von vorn an. Eine Schreibmarke,
       die mitten im Nichts stehenbleibt, hat nichts mehr zu bewahren. */
    if (zeile.zeichen.every((b) => !b)) zeile.marke = 0;
  };

  /** Löscht nur das Feld unter der Marke, ohne sie zu bewegen (Entf). */
  zeile.loescheHier = function () {
    zeile.zeichen[zeile.marke] = "";
  };

  /**
   * Schreibt eine ausgeschriebene Form – AE, OE, UE oder SS – als Ganzes
   * und meldet, ob das gelungen ist.
   *
   * Ist nur noch ein Feld frei, wird gar nichts geschrieben: Das zweite
   * Zeichen würde sonst das erste gleich wieder überschreiben, und aus Ä
   * wird stillschweigend ein E.
   */
  zeile.schreibeUmschrift = function (paar) {
    const vorher = zeile.marke;
    const alt = zeile.zeichen[vorher];
    zeile.tippe(paar[0]);
    if (zeile.marke === vorher) {
      zeile.zeichen[vorher] = alt;
      return false;
    }
    zeile.tippe(paar[1]);
    return true;
  };

  return zeile;
}

/* Umlaute sind auf der Tastatur des Rechners nur einen Griff entfernt –
   wer sie tippt, meint die ausgeschriebene Form und bekommt sie auch. */
const UMSCHRIFT = { "Ä": "AE", "Ö": "OE", "Ü": "UE", "ß": "SS" };

/**
 * Deutet einen Tastendruck und ruft den passenden Handgriff auf.
 *
 * Liefert true, wenn die Taste verbraucht wurde – dann soll der Aufrufer
 * das Standardverhalten des Browsers unterbinden und neu zeichnen.
 */
function deuteTaste(e, zeile, handgriffe) {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;

  if (e.key === "Enter") { handgriffe.abgeben(); return true; }
  if (e.key === "Backspace") { zeile.loesche(); return true; }
  if (e.key === "Delete") { zeile.loescheHier(); return true; }
  if (e.key === "ArrowLeft") { zeile.bewegeMarke(-1); return true; }
  if (e.key === "ArrowRight") { zeile.bewegeMarke(1); return true; }
  if (e.key === "Home") { zeile.setzeMarke(0); return true; }
  if (e.key === "End") { zeile.setzeMarke(zeile.laenge - 1); return true; }

  const gross = e.key.length === 1 ? e.key.toUpperCase() : "";
  if (UMSCHRIFT[gross]) {
    if (!zeile.schreibeUmschrift(UMSCHRIFT[gross])) {
      handgriffe.kleinPlatz(UMSCHRIFT[gross]);
    }
    return true;
  }
  if (gross >= "A" && gross <= "Z") {
    zeile.tippe(gross);
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------------
   Kleinkram, den sich beide Spiele teilen
   --------------------------------------------------------------------- */

/* Die Zeilen der Tastatur. QWERTZ, aber ohne Umlaute – die werden
   ausgeschrieben, ein eigenes Ä bräuchte niemand. */
const TASTATUR_ZEILEN = [
  ["Q", "W", "E", "R", "T", "Z", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Y", "X", "C", "V", "B", "N", "M", "BACK"],
];

/**
 * Baut die Bildschirmtastatur in `behaelter`.
 *
 * Der Name ist absichtlich lang: Die Spiele haben ihre eigene, kurze
 * Hülle namens baueTastatur, und beide leben im selben Namensraum.
 *
 * `beiBuchstabe` bekommt den Buchstaben, `beiEingabe` und `beiRuecktaste`
 * nichts. Die Buchstabentasten bekommen zusätzlich `ecken` leere Felder
 * für den Befund – Wordle braucht keines, Quordle vier.
 */
function baueBildschirmtastatur(behaelter, ecken, beiBuchstabe, beiEingabe, beiRuecktaste) {
  behaelter.innerHTML = "";
  for (let z = 0; z < TASTATUR_ZEILEN.length; z++) {
    const zeile = document.createElement("div");
    zeile.className = "tasten-zeile";
    for (let i = 0; i < TASTATUR_ZEILEN[z].length; i++) {
      const name = TASTATUR_ZEILEN[z][i];
      const taste = document.createElement("button");
      taste.type = "button";
      taste.className = "taste";

      if (name === "ENTER") {
        taste.classList.add("breit");
        /* Zwei Beschriftungen, das Stylesheet wählt: Auf dem Telefon ist
           kein Platz für das Wort, dort steht das Zeichen. */
        taste.innerHTML = "<span class=\"lang\">Eingabe</span><span class=\"kurz\">↵</span>";
        taste.addEventListener("click", beiEingabe);
      } else if (name === "BACK") {
        taste.classList.add("breit");
        taste.textContent = "⌫";
        taste.addEventListener("click", beiRuecktaste);
      } else {
        taste.dataset.buchstabe = name;
        if (ecken > 0) {
          const feld = document.createElement("span");
          feld.className = "ecken";
          for (let e = 0; e < ecken; e++) feld.appendChild(document.createElement("i"));
          taste.appendChild(feld);
          const text = document.createElement("span");
          text.className = "taste-text";
          text.textContent = name;
          taste.appendChild(text);
        } else {
          taste.textContent = name;
        }
        taste.addEventListener("click", function () { beiBuchstabe(name); });
      }
      zeile.appendChild(taste);
    }
    behaelter.appendChild(zeile);
  }
}

/** Streut Konfetti in die angegebene Schicht. */
function streueKonfetti(schicht) {
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
