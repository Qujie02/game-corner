"use strict";

/* =====================================================================
   Mahjong · Motive der Steine

   Was auf einem Stein zu sehen ist. Diese Datei kennt keine Spielregeln und
   kein Spielfeld – sie gibt zu einer Steinart ein Stück Markup zurück, das
   in die Oberseite eines Steins passt.

   Echte Mahjong-Steine tragen keine Ziffern, sondern Bilder: gestapelte
   Bambusstäbe, Münzen, einen Vogel, chinesische Zahlzeichen. Das ist nicht
   nur schöner, es liest sich auch schneller – ein Blick auf drei Kreise
   genügt, während "3 筒" erst gelesen werden muss. Bei 144 Steinen macht
   das den Unterschied.

   Gezeichnet wird in einem festen Feld von 100 auf 135 Einheiten, dem
   Seitenverhältnis eines Steins.

   Zur Farbgebung: Gezeichnete Motive tragen ihre Farben selbst, und zwar
   nach dem Vorbild echter Sätze – die Münzen sind nicht einfarbig blau,
   sondern wechseln mit dem Wert, die Fünf Bambus trägt einen roten Stab.
   Das ist Schmuck, aber nicht nur: Zwei Steine gleichen Werts tragen
   dasselbe Farbmuster, und ein Muster erkennt das Auge schneller als eine
   Anzahl. Geschriebene Motive (萬, Winde, Drachen) nehmen ihre Farbe über
   `currentColor` aus dem Stylesheet, damit sie dort an einer Stelle steht.
   ===================================================================== */

/* Die Tinten eines Mahjongsatzes. Mehr Farben braucht es nicht, und weniger
   sähe nach Druckerei aus statt nach bemaltem Stein. */
const INK_BLAU  = "#17548f";
const INK_GRUEN = "#137038";
const INK_ROT   = "#bf2a1c";
const INK_GOLD  = "#d9a326";

/* Das Elfenbein der Steinoberseite. Aussparungen im Motiv sollen aussehen
   wie blanker Stein – reines Weiß wäre auf warmem Grund ein heller Fleck. */
const MOTIV_HELL  = "#fbf8ee";
const MOTIV_KANTE = "rgba(26,34,22,0.26)";

/** Rundet auf zwei Stellen; SVG-Werte mit zwölf Nachkommastellen sind nur
    lang, nicht genauer. */
function mz(n) {
  return Number(n.toFixed(2));
}

/** Rahmen um ein gezeichnetes Motiv. */
function motivSvg(inhalt) {
  return '<svg class="motiv" viewBox="0 0 100 135" ' +
         'preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + inhalt + "</svg>";
}

/* ---------------------------------------------------------------------
   Münzen (筒)

   Eine Münze ist ein Ring aus Farbe mit hellem Zwischenraum und farbigem
   Kern – so sehen die geprägten Münzen auf echten Steinen aus. Die
   Anordnungen sind die überlieferten: die Drei diagonal, die Sieben drei
   über vier.
   --------------------------------------------------------------------- */

function motivMuenzPunkt(cx, cy, r, farbe) {
  return `<circle cx="${cx}" cy="${cy}" r="${mz(r)}" fill="${farbe}" ` +
           `stroke="${MOTIV_KANTE}" stroke-width="${mz(r * 0.085)}"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${mz(r * 0.55)}" fill="${MOTIV_HELL}"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${mz(r * 0.28)}" fill="${farbe}"/>`;
}

/* [x, y, r] je Münze.

   Die Münzen sind so groß gesetzt, wie die Anordnung es hergibt: Zwischen
   zwei Nachbarn bleiben wenige Einheiten Luft, mehr nicht. Kleiner gezeichnet
   schwimmen sie im Feld, und ein Stein, auf dem viel Platz frei bleibt, sieht
   nach Platzhalter aus. */
const MOTIV_KREISE = {
  2: [[50, 38, 20], [50, 97, 20]],
  3: [[24, 33, 17], [50, 67, 17], [76, 101, 17]],
  4: [[29, 42, 19], [71, 42, 19], [29, 92, 19], [71, 92, 19]],
  5: [[28, 38, 16], [72, 38, 16], [50, 67, 16], [28, 96, 16], [72, 96, 16]],
  6: [[30, 33, 15.5], [70, 33, 15.5], [30, 67, 15.5],
      [70, 67, 15.5], [30, 101, 15.5], [70, 101, 15.5]],
  7: [[22, 26, 12], [50, 39, 12], [78, 52, 12],
      [30, 82, 14], [70, 82, 14], [30, 112, 14], [70, 112, 14]],
  8: [[31, 27, 11.5], [69, 27, 11.5], [31, 55, 11.5], [69, 55, 11.5],
      [31, 83, 11.5], [69, 83, 11.5], [31, 111, 11.5], [69, 111, 11.5]],
  9: [[24, 33, 12.2], [50, 33, 12.2], [76, 33, 12.2],
      [24, 67, 12.2], [50, 67, 12.2], [76, 67, 12.2],
      [24, 101, 12.2], [50, 101, 12.2], [76, 101, 12.2]],
};

/* Die Farbe je Münze, in der Reihenfolge oben. Echte Sätze bemalen die
   Münzen unterschiedlich – die Fünf hat einen roten Kern, die Neun drei
   Reihen in drei Farben. Das hält 144 Steine auseinander. */
const MOTIV_KREIS_FARBEN = {
  2: [INK_GRUEN, INK_BLAU],
  3: [INK_BLAU, INK_GRUEN, INK_ROT],
  4: [INK_BLAU, INK_GRUEN, INK_GRUEN, INK_BLAU],
  5: [INK_BLAU, INK_GRUEN, INK_ROT, INK_GRUEN, INK_BLAU],
  6: [INK_GRUEN, INK_GRUEN, INK_BLAU, INK_BLAU, INK_BLAU, INK_BLAU],
  7: [INK_GRUEN, INK_GRUEN, INK_GRUEN, INK_ROT, INK_ROT, INK_ROT, INK_ROT],
  8: [INK_BLAU, INK_BLAU, INK_BLAU, INK_BLAU,
      INK_GRUEN, INK_GRUEN, INK_GRUEN, INK_GRUEN],
  9: [INK_GRUEN, INK_GRUEN, INK_GRUEN, INK_ROT, INK_ROT, INK_ROT,
      INK_BLAU, INK_BLAU, INK_BLAU],
};

function motivMuenze(wert) {
  if (wert === 1) {
    /* Die Eins ist eine einzelne große Münze: konzentrische Ringe in allen
       drei Tinten, wie das Loch einer Kupfermünze mit Prägerand. */
    return motivSvg(
      `<circle cx="50" cy="67" r="33" fill="${INK_BLAU}" stroke="${MOTIV_KANTE}" stroke-width="2.4"/>` +
      `<circle cx="50" cy="67" r="27" fill="${MOTIV_HELL}"/>` +
      `<circle cx="50" cy="67" r="22" fill="${INK_GRUEN}"/>` +
      `<circle cx="50" cy="67" r="15.5" fill="${MOTIV_HELL}"/>` +
      `<circle cx="50" cy="67" r="10" fill="${INK_ROT}"/>` +
      `<circle cx="50" cy="67" r="3.6" fill="${MOTIV_HELL}"/>`
    );
  }
  const liste = MOTIV_KREISE[wert];
  const farben = MOTIV_KREIS_FARBEN[wert];
  return motivSvg(liste.map((k, i) =>
    motivMuenzPunkt(k[0], k[1], k[2], farben[i])).join(""));
}

/* ---------------------------------------------------------------------
   Bambus (索)

   Ein Stab ist ein Rohr mit zwei Knoten, verdickten Enden und einem
   Lichtstreifen auf der linken Seite – ohne den wirkt er flach wie ein
   Balken. Die Eins trägt keinen Stab, sondern den Vogel; so ist es
   überliefert, und sie ist damit auf einen Blick von allen zu unterscheiden.
   --------------------------------------------------------------------- */

function motivStab(cx, cy, hoehe, breite, farbe, dreh) {
  const c = farbe || INK_GRUEN;
  const x = cx - breite / 2;
  const y = cy - hoehe / 2;
  /* Die Enden sind nur leicht verdickt: Mehr Wulst, und aus dem Bambusrohr
     wird eine Garnrolle. */
  const kappe = breite * 0.54;
  const dreht = dreh ? ` transform="rotate(${dreh} ${cx} ${cy})"` : "";
  return `<g${dreht}>` +
    `<rect x="${mz(x)}" y="${mz(y)}" width="${mz(breite)}" height="${mz(hoehe)}" ` +
      `rx="${mz(breite * 0.42)}" fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${mz(breite * 0.08)}"/>` +
    /* Glanzkante: das Rohr ist rund, die linke Seite fängt das Licht. */
    `<rect x="${mz(x + breite * 0.18)}" y="${mz(y + hoehe * 0.1)}" ` +
      `width="${mz(breite * 0.19)}" height="${mz(hoehe * 0.8)}" ` +
      `rx="${mz(breite * 0.095)}" fill="#ffffff" opacity="0.32"/>` +
    /* Knoten: zwei Querstriche im oberen und unteren Drittel. */
    `<rect x="${mz(x)}" y="${mz(cy - hoehe * 0.2)}" width="${mz(breite)}" ` +
      `height="${mz(hoehe * 0.045)}" fill="rgba(12,22,12,0.36)"/>` +
    `<rect x="${mz(x)}" y="${mz(cy + hoehe * 0.14)}" width="${mz(breite)}" ` +
      `height="${mz(hoehe * 0.045)}" fill="rgba(12,22,12,0.36)"/>` +
    /* Enden: leicht verdickt, wie abgeschnittenes Rohr. */
    `<ellipse cx="${mz(cx)}" cy="${mz(y)}" rx="${mz(kappe)}" ry="${mz(breite * 0.24)}" ` +
      `fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${mz(breite * 0.07)}"/>` +
    `<ellipse cx="${mz(cx)}" cy="${mz(y + hoehe)}" rx="${mz(kappe)}" ry="${mz(breite * 0.24)}" ` +
      `fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${mz(breite * 0.07)}"/>` +
    "</g>";
}

/* [x, y, höhe, breite, farbe, drehung] je Stab.

   Zwei Bedingungen ziehen hier gegeneinander. Die Stäbe sollen dick sein –
   ein schmaler Stab ist kein Rohr, sondern ein Strich, und aus dem Motiv
   wird ein Strichcode. Zugleich muss zwischen den Reihen Luft bleiben:
   Stehen zwei Stäbe fast aneinander, liest sie das Auge auf einem kleinen
   Stein als einen langen – und aus der Zwei wird eine Eins.

   Die Maße unten sind das Ergebnis: so breit, wie der waagerechte Abstand
   zulässt, und so kurz, dass zwischen zwei Reihen ein Stababstand bleibt.

   Rot sind die Stäbe, die auch in echten Sätzen rot sind: die Mitte der
   Fünf, der einzelne Stab über der Sieben und die Mittelreihe der Neun. */
const MOTIV_STAEBE = {
  2: [[50, 34, 46, 22], [50, 100, 46, 22]],
  3: [[50, 34, 46, 20], [29, 100, 46, 20], [71, 100, 46, 20]],
  4: [[29, 34, 46, 20], [71, 34, 46, 20], [29, 100, 46, 20], [71, 100, 46, 20]],
  /* Die Fünf ist ein Kreuz: vier Ecken und ein roter Stab in der Mitte. */
  5: [[28, 32, 38, 18], [72, 32, 38, 18], [50, 67, 38, 18, INK_ROT],
      [28, 102, 38, 18], [72, 102, 38, 18]],
  6: [[29, 28, 32, 17], [71, 28, 32, 17], [29, 67, 32, 17],
      [71, 67, 32, 17], [29, 106, 32, 17], [71, 106, 32, 17]],
  7: [[50, 24, 30, 17, INK_ROT],
      [26, 70, 30, 16], [50, 70, 30, 16], [74, 70, 30, 16],
      [26, 106, 30, 16], [50, 106, 30, 16], [74, 106, 30, 16]],
  /* Die Acht steht als Sanduhr: vier Stäbe nach rechts geneigt, vier nach
     links. Das ist die auffälligste Anordnung des Satzes – und die einzige,
     bei der die Stäbe einander berühren dürfen, weil die Neigung sie ohnehin
     unterscheidbar macht. */
  8: [[20, 42, 40, 13, null, 14], [40, 42, 40, 13, null, 14],
      [60, 42, 40, 13, null, 14], [80, 42, 40, 13, null, 14],
      [20, 95, 40, 13, null, -14], [40, 95, 40, 13, null, -14],
      [60, 95, 40, 13, null, -14], [80, 95, 40, 13, null, -14]],
  /* Die Neun trägt die Mittelreihe in Rot – drei gleiche Reihen wären von
     der Sechs kaum zu trennen. */
  9: [[26, 28, 32, 17], [50, 28, 32, 17], [74, 28, 32, 17],
      [26, 67, 32, 17, INK_ROT], [50, 67, 32, 17, INK_ROT], [74, 67, 32, 17, INK_ROT],
      [26, 106, 32, 17], [50, 106, 32, 17], [74, 106, 32, 17]],
};

/** Der Vogel des Einer-Bambus: Sperling mit Haube, auf den Schwanz gestützt. */
function motivVogel() {
  return motivSvg(
    /* Zwei Bambusblätter oben links füllen die Ecke, die der Vogel frei
       lässt – ohne sie sitzt das Bild schief im Stein. */
    `<path d="M6 40 C14 26 28 18 42 20 C34 34 20 42 6 40 Z" fill="currentColor" opacity="0.45"/>` +
    /* Schwanzfedern, nach unten links auslaufend. */
    `<path d="M46 84 C36 98 23 110 9 121 C22 120 33 115 42 107 L53 95 Z" ` +
      `fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.3"/>` +
    `<path d="M53 92 C47 105 39 116 30 127 C42 124 51 117 58 106 Z" ` +
      `fill="currentColor" opacity="0.7"/>` +
    /* Körper. */
    `<path d="M39 66 C39 45 52 30 68 32 C81 34 85 49 78 63 C71 78 60 91 48 99 ` +
      `C40 93 38 80 39 66 Z" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.5"/>` +
    /* Flügel: eine hellere Fläche mit zwei Federstrichen. */
    `<path d="M47 57 C58 54 69 61 73 72 C67 84 57 93 48 97 C41 87 42 69 47 57 Z" ` +
      `fill="${MOTIV_HELL}" opacity="0.34"/>` +
    `<path d="M51 65 C59 65 66 71 69 79" stroke="${MOTIV_KANTE}" stroke-width="1.2" fill="none"/>` +
    `<path d="M49 76 C57 76 63 82 66 89" stroke="${MOTIV_KANTE}" stroke-width="1.2" fill="none"/>` +
    /* Haube. */
    `<path d="M61 21 C62 12 67 6 74 4" stroke="currentColor" stroke-width="3.2" ` +
      `fill="none" stroke-linecap="round"/>` +
    `<path d="M69 20 C73 13 79 9 86 8" stroke="currentColor" stroke-width="2.6" ` +
      `fill="none" stroke-linecap="round"/>` +
    /* Kopf, Schnabel, Auge. */
    `<circle cx="67" cy="33" r="14" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.5"/>` +
    `<path d="M79 27 L97 34 L79 41 Z" fill="${INK_ROT}" stroke="${MOTIV_KANTE}" stroke-width="1"/>` +
    `<circle cx="70" cy="30" r="4.4" fill="${MOTIV_HELL}"/>` +
    `<circle cx="71" cy="30" r="2" fill="#1d2418"/>`
  );
}

function motivBambus(wert) {
  if (wert === 1) return motivVogel();
  return motivSvg(MOTIV_STAEBE[wert].map((s) =>
    motivStab(s[0], s[1], s[2], s[3], s[4], s[5])).join(""));
}

/* ---------------------------------------------------------------------
   Zeichen (萬)

   Hier bleibt Schrift das Richtige: oben das chinesische Zahlzeichen, unten
   das 萬 der Farbe. Genau so stehen sie auf echten Steinen – die Zahl in
   Blau, das 萬 in Rot. Zwei Farben auf einem Stein sind schneller erkannt
   als eine.
   --------------------------------------------------------------------- */

const MOTIV_ZAHLZEICHEN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function motivZeichen(wert) {
  return '<span class="motiv-text">' +
           `<span class="motiv-zahl">${MOTIV_ZAHLZEICHEN[wert]}</span>` +
           '<span class="motiv-suit">萬</span>' +
         "</span>";
}

/* ---------------------------------------------------------------------
   Winde, Drachen, Blumen, Jahreszeiten
   --------------------------------------------------------------------- */

/* Der Buchstabe unter dem Wind. Vier ähnlich gebaute Zeichen sind der
   häufigste Fehlgriff; die Himmelsrichtung darunter klärt das sofort. */
const MOTIV_WIND_KUERZEL = {
  "wind-ost": "O", "wind-sued": "S", "wind-west": "W", "wind-nord": "N",
};

function motivWind(art, glyph) {
  return '<span class="motiv-text">' +
           `<span class="motiv-glyph">${glyph}</span>` +
           `<span class="motiv-mini">${MOTIV_WIND_KUERZEL[art]}</span>` +
         "</span>";
}

/** Der weiße Drache: der leere blaue Rahmen, wie auf echten Steinen. */
function motivWeisserDrache() {
  return motivSvg(
    `<rect x="16" y="24" width="68" height="87" rx="7" fill="none" ` +
      `stroke="currentColor" stroke-width="6.5"/>` +
    `<rect x="27" y="35" width="46" height="65" rx="3.5" fill="none" ` +
      `stroke="currentColor" stroke-width="2" opacity="0.7"/>`
  );
}

/* Die Blumen: gezeichnet, nicht geschrieben. Jede trägt nur ihr eigenes
   Bild – ein Eckzeichen für die Gruppe stand hier einmal, als noch jede
   Blume zu jeder passte. Nach heutiger Regel passen nur gleiche Bilder
   zusammen (siehe `passt` in engine.js), und ein gemeinsames Zeichen auf
   Steinen, die nicht zusammengehören, führt in die Irre.

   Die Grundfarbe kommt je Blume aus dem Stylesheet; Staubblätter und Stiele
   bringen ihre eigene mit. */

function motivPflaume() {
  const blaetter = [];
  const glanz = [];
  for (let i = 0; i < 5; i++) {
    const winkel = (-90 + i * 72) * Math.PI / 180;
    blaetter.push(`<circle cx="${mz(50 + Math.cos(winkel) * 21)}" ` +
                  `cy="${mz(60 + Math.sin(winkel) * 21)}" r="16" ` +
                  `fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.3"/>`);
    /* Ein heller Fleck außen auf jedem Blatt gibt der Blüte Tiefe. */
    glanz.push(`<circle cx="${mz(50 + Math.cos(winkel) * 25)}" ` +
               `cy="${mz(60 + Math.sin(winkel) * 25)}" r="7.5" ` +
               `fill="${MOTIV_HELL}" opacity="0.3"/>`);
  }
  /* Staubblätter: fünf kurze Striche aus der Mitte. */
  const staub = [];
  for (let i = 0; i < 5; i++) {
    const w = (-54 + i * 72) * Math.PI / 180;
    staub.push(`<line x1="50" y1="60" x2="${mz(50 + Math.cos(w) * 14)}" ` +
               `y2="${mz(60 + Math.sin(w) * 14)}" stroke="${INK_GOLD}" ` +
               `stroke-width="1.8" stroke-linecap="round"/>`);
  }
  return motivSvg(
    `<path d="M50 78 C48 98 42 112 30 122" stroke="#6b4a24" stroke-width="4.2" ` +
      `fill="none" stroke-linecap="round"/>` +
    `<path d="M45 103 C56 98 66 102 72 110" stroke="#4a7a34" stroke-width="3.6" ` +
      `fill="none" stroke-linecap="round"/>` +
    blaetter.join("") + glanz.join("") + staub.join("") +
    `<circle cx="50" cy="60" r="8" fill="${INK_GOLD}" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>`
  );
}

function motivOrchidee() {
  return motivSvg(
    /* Drei geschwungene Blätter – die Orchidee erkennt man am Blatt, nicht
       an der Blüte. Sie sind als Flächen gezeichnet, nicht als Striche:
       Ein Strich gleicher Dicke von oben bis unten sieht aus wie ein Kabel,
       ein Blatt läuft spitz zu. */
    `<path d="M14 130 C4 96 14 58 40 34 C22 62 16 96 22 130 Z" fill="currentColor"/>` +
    `<path d="M62 132 C86 100 84 56 66 30 C74 62 72 100 54 132 Z" ` +
      `fill="currentColor" opacity="0.8"/>` +
    `<path d="M34 132 C38 100 42 74 48 50 C50 78 46 108 42 132 Z" ` +
      `fill="currentColor" opacity="0.62"/>` +
    /* Die Blüte: vier Blätter um ein goldenes Herz. */
    `<ellipse cx="26" cy="32" rx="17" ry="8" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.2" transform="rotate(-26 26 32)"/>` +
    `<ellipse cx="74" cy="32" rx="17" ry="8" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.2" transform="rotate(26 74 32)"/>` +
    `<ellipse cx="38" cy="12" rx="8" ry="15" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.2" transform="rotate(-16 38 12)"/>` +
    `<ellipse cx="62" cy="12" rx="8" ry="15" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.2" transform="rotate(16 62 12)"/>` +
    `<ellipse cx="50" cy="42" rx="13" ry="11" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.2"/>` +
    `<circle cx="50" cy="32" r="8.5" fill="${INK_GOLD}" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>`
  );
}

function motivChrysantheme() {
  /* Zwei Kränze: lange Blätter außen, kurze innen. Ein einzelner Kranz sieht
     aus wie ein Zahnrad. */
  const aussen = [];
  for (let i = 0; i < 16; i++) {
    aussen.push(`<ellipse cx="50" cy="36" rx="5" ry="22" fill="currentColor" ` +
                `stroke="${MOTIV_KANTE}" stroke-width="0.9" ` +
                `transform="rotate(${mz(i * 22.5)} 50 58)"/>`);
  }
  const innen = [];
  for (let i = 0; i < 10; i++) {
    innen.push(`<ellipse cx="50" cy="45" rx="4.5" ry="13" fill="currentColor" ` +
               `opacity="0.75" transform="rotate(${mz(18 + i * 36)} 50 58)"/>`);
  }
  return motivSvg(
    `<path d="M50 88 C49 106 44 118 35 126" stroke="#3f6b32" stroke-width="4" ` +
      `fill="none" stroke-linecap="round"/>` +
    `<path d="M48 106 C58 100 68 104 74 112" stroke="#3f6b32" stroke-width="3.4" ` +
      `fill="none" stroke-linecap="round"/>` +
    aussen.join("") + innen.join("") +
    `<circle cx="50" cy="58" r="10" fill="${INK_GOLD}" stroke="${MOTIV_KANTE}" stroke-width="1.3"/>`
  );
}

function motivBambusBlume() {
  return motivSvg(
    /* Zwei Halme unterschiedlicher Höhe, dazu drei Blätter. Die Halme sind
       breiter als die Stäbe der Bambusfarbe – sonst verwechselt man den
       Blumenstein mit einem Zwei-Bambus. */
    `<rect x="30" y="24" width="16" height="102" rx="7" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.3"/>` +
    `<rect x="32.4" y="34" width="5" height="82" rx="2.5" fill="#ffffff" opacity="0.3"/>` +
    `<rect x="30" y="56" width="16" height="4" fill="rgba(12,22,12,0.34)"/>` +
    `<rect x="30" y="92" width="16" height="4" fill="rgba(12,22,12,0.34)"/>` +
    `<rect x="57" y="48" width="13" height="78" rx="6" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.1" opacity="0.85"/>` +
    `<rect x="57" y="86" width="13" height="3.5" fill="rgba(12,22,12,0.3)"/>` +
    `<path d="M38 48 C22 42 10 28 5 10 C27 17 38 31 38 48 Z" fill="currentColor"/>` +
    `<path d="M46 34 C64 27 78 14 85 2 C67 9 50 19 46 34 Z" fill="currentColor" opacity="0.9"/>` +
    `<path d="M66 66 C83 61 93 49 98 34 C81 39 68 51 66 66 Z" fill="currentColor" opacity="0.8"/>`
  );
}

const MOTIV_BLUMEN = {
  "blume-pflaume": motivPflaume,
  "blume-orchidee": motivOrchidee,
  "blume-chrysantheme": motivChrysantheme,
  "blume-bambus": motivBambusBlume,
};

/* Die Jahreszeiten waren einmal nur vier Schriftzeichen – und vier Zeichen,
   die man nicht liest, sind vier gleiche Steine. Gezeichnet sind sie auf
   einen Blick auseinanderzuhalten, und sie passen zu den Blumen, die
   ebenfalls Bilder tragen. */

function motivFruehling() {
  return motivSvg(
    `<path d="M50 130 C50 106 49 82 53 58" stroke="currentColor" stroke-width="7" ` +
      `fill="none" stroke-linecap="round"/>` +
    /* Zwei Keimblätter, gegenständig – das Bild eines Spross. */
    `<path d="M50 106 C26 102 8 84 4 56 C34 58 50 78 50 106 Z" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.3"/>` +
    `<path d="M53 82 C77 78 93 60 96 32 C68 34 53 54 53 82 Z" fill="currentColor" ` +
      `opacity="0.84" stroke="${MOTIV_KANTE}" stroke-width="1.3"/>` +
    /* Knospe: die Spitze, die im Frühling aufgeht. */
    `<ellipse cx="54" cy="26" rx="14" ry="20" fill="#e8639a" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.3"/>` +
    `<ellipse cx="49" cy="21" rx="5" ry="10" fill="${MOTIV_HELL}" opacity="0.45"/>`
  );
}

function motivSommer() {
  /* Sonne mit Strahlen über einer Wasserlinie. */
  const strahlen = [];
  for (let i = 0; i < 12; i++) {
    strahlen.push(`<line x1="50" y1="26" x2="50" y2="13" stroke="currentColor" ` +
                  `stroke-width="4.4" stroke-linecap="round" ` +
                  `transform="rotate(${mz(i * 30)} 50 58)"/>`);
  }
  return motivSvg(
    strahlen.join("") +
    `<circle cx="50" cy="58" r="24" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.4"/>` +
    `<circle cx="42" cy="50" r="9" fill="${MOTIV_HELL}" opacity="0.34"/>` +
    `<path d="M12 110 C24 102 34 118 46 110 C58 102 68 118 88 108" ` +
      `stroke="${INK_BLAU}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.75"/>` +
    `<path d="M12 124 C24 116 34 132 46 124 C58 116 68 132 88 122" ` +
      `stroke="${INK_BLAU}" stroke-width="3.2" fill="none" stroke-linecap="round" opacity="0.45"/>`
  );
}

function motivHerbst() {
  /* Ein fallendes Blatt mit Rippe und Adern. */
  const adern = [
    "M50 104 L30 84", "M50 104 L70 84",
    "M50 82 L28 62", "M50 82 L72 62",
    "M50 60 L33 44", "M50 60 L67 44",
  ].map((d) => `<path d="${d}" stroke="${MOTIV_HELL}" stroke-width="2" ` +
                `fill="none" opacity="0.42" stroke-linecap="round"/>`).join("");
  return motivSvg(
    `<path d="M50 110 C48 120 44 126 38 130" stroke="#6b4a24" stroke-width="4" ` +
      `fill="none" stroke-linecap="round"/>` +
    `<path d="M50 12 C76 32 88 60 76 86 C68 104 58 114 50 112 ` +
      `C42 114 32 104 24 86 C12 60 24 32 50 12 Z" fill="currentColor" ` +
      `stroke="${MOTIV_KANTE}" stroke-width="1.4"/>` +
    `<path d="M50 112 L50 26" stroke="${MOTIV_HELL}" stroke-width="2.6" ` +
      `fill="none" opacity="0.5" stroke-linecap="round"/>` +
    adern
  );
}

function motivWinter() {
  /* Schneeflocke: sechs Arme mit je zwei Paar Widerhaken. */
  const arme = [];
  for (let i = 0; i < 6; i++) {
    arme.push(
      `<g transform="rotate(${mz(i * 60)} 50 67)">` +
        `<line x1="50" y1="67" x2="50" y2="14" stroke="currentColor" ` +
          `stroke-width="5" stroke-linecap="round"/>` +
        `<line x1="50" y1="26" x2="39" y2="15" stroke="currentColor" ` +
          `stroke-width="3.6" stroke-linecap="round"/>` +
        `<line x1="50" y1="26" x2="61" y2="15" stroke="currentColor" ` +
          `stroke-width="3.6" stroke-linecap="round"/>` +
        `<line x1="50" y1="44" x2="41" y2="35" stroke="currentColor" ` +
          `stroke-width="3" stroke-linecap="round"/>` +
        `<line x1="50" y1="44" x2="59" y2="35" stroke="currentColor" ` +
          `stroke-width="3" stroke-linecap="round"/>` +
      "</g>");
  }
  return motivSvg(
    arme.join("") +
    `<circle cx="50" cy="67" r="8.5" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>` +
    `<circle cx="50" cy="67" r="3.4" fill="${MOTIV_HELL}" opacity="0.55"/>`
  );
}

const MOTIV_JAHRESZEITEN = {
  "zeit-fruehling": motivFruehling,
  "zeit-sommer": motivSommer,
  "zeit-herbst": motivHerbst,
  "zeit-winter": motivWinter,
};

/**
 * Das Motiv einer Steinart als Markup für die Oberseite.
 *
 * Rückgabe ist immer ein einzelnes Element – eine Zeichnung oder ein
 * Textblock.
 */
function steinMotiv(art) {
  const a = STEIN_ARTEN[art];

  if (a.gruppe === "muenze") return motivMuenze(Number(a.zahl));
  if (a.gruppe === "bambus") return motivBambus(Number(a.zahl));
  if (a.gruppe === "zeichen") return motivZeichen(Number(a.zahl));
  if (a.gruppe === "wind") return motivWind(a.art, a.glyph);

  if (a.gruppe === "drache") {
    if (a.art === "drache-weiss") return motivWeisserDrache();
    return `<span class="motiv-text"><span class="motiv-glyph gross">${a.glyph}</span></span>`;
  }

  if (a.gruppe === "blume") return MOTIV_BLUMEN[a.art]();

  return MOTIV_JAHRESZEITEN[a.art]();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { steinMotiv };
}
