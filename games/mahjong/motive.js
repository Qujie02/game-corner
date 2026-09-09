"use strict";

/* =====================================================================
   Mahjong · Motive der Steine

   Was auf einem Stein zu sehen ist. Diese Datei kennt keine Spielregeln und
   kein Spielfeld – sie gibt zu einer Steinart ein Stück Markup zurück, das
   in die Oberseite eines Steins passt.

   Echte Mahjong-Steine tragen keine Ziffern, sondern Bilder: gestapelte
   Bambusstäbe, Kreise, einen Vogel, chinesische Zahlzeichen. Das ist nicht
   nur schöner, es liest sich auch schneller – ein Blick auf drei Kreise
   genügt, während "3 筒" erst gelesen werden muss. Bei 144 Steinen macht
   das den Unterschied.

   Gezeichnet wird in einem festen Feld von 100 auf 135 Einheiten, dem
   Seitenverhältnis eines Steins. Die Farbe kommt über `currentColor` aus
   dem Stylesheet, damit die Farben der Gruppen an einer Stelle stehen.
   ===================================================================== */

/* Akzentfarben, die nicht aus der Gruppenfarbe kommen: das Rot der
   Sonderstäbe (5 und 7 Bambus tragen in echten Sätzen einen roten Stab)
   und das Kernrot der Kreise. */
const MOTIV_ROT = "#cc2a1c";
/* Das Weiß der Steinoberseite – Aussparungen im Motiv sollen aussehen wie
   blanker Stein, nicht wie eine weiße Farbe darauf. */
const MOTIV_HELL = "#ffffff";
const MOTIV_KANTE = "rgba(16,32,24,0.4)";

/** Rahmen um ein gezeichnetes Motiv. */
function motivSvg(inhalt) {
  return '<svg class="motiv" viewBox="0 0 100 135" ' +
         'preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + inhalt + "</svg>";
}

/* ---------------------------------------------------------------------
   Kreise (筒)

   Ein Ring aus der Gruppenfarbe, weißer Kern, kleiner Punkt in der Mitte –
   so sehen die Münzen auf echten Steinen aus. Die Anordnungen sind die
   überlieferten: die Drei diagonal, die Sieben drei über vier.
   --------------------------------------------------------------------- */

function motivKreis(cx, cy, r, farbe) {
  const c = farbe || "currentColor";
  /* Ring, weißer Zwischenraum, roter Kern – die Münzen echter Steine sind
     mehrfarbig, und der rote Punkt macht sie auch klein noch erkennbar. */
  const kern = farbe === MOTIV_ROT ? "currentColor" : MOTIV_ROT;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${(r * 0.11).toFixed(2)}"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${(r * 0.46).toFixed(2)}" fill="${MOTIV_HELL}"/>` +
         `<circle cx="${cx}" cy="${cy}" r="${(r * 0.2).toFixed(2)}" fill="${kern}"/>`;
}

/* [x, y, r] je Kreis. Der einzelne Kreis der Eins ist groß und mehrfach
   geringt, wie das Loch einer Münze. */
const MOTIV_KREISE = {
  2: [[50, 43, 17], [50, 92, 17]],
  3: [[26, 37, 15], [50, 67, 15], [74, 97, 15]],
  4: [[31, 45, 16], [69, 45, 16], [31, 89, 16], [69, 89, 16]],
  5: [[29, 41, 14], [71, 41, 14], [50, 67, 14], [29, 93, 14], [71, 93, 14]],
  6: [[31, 36, 14], [69, 36, 14], [31, 67, 14], [69, 67, 14], [31, 98, 14], [69, 98, 14]],
  7: [[24, 29, 11], [50, 41, 11], [76, 53, 11], [31, 84, 13], [69, 84, 13], [31, 112, 13], [69, 112, 13]],
  8: [[32, 29, 10], [68, 29, 10], [32, 54, 10], [68, 54, 10],
      [32, 79, 10], [68, 79, 10], [32, 104, 10], [68, 104, 10]],
  9: [[26, 36, 12], [50, 36, 12], [74, 36, 12], [26, 67, 12], [50, 67, 12],
      [74, 67, 12], [26, 98, 12], [50, 98, 12], [74, 98, 12]],
};

function motivMuenze(wert) {
  if (wert === 1) {
    /* Die Eins ist eine einzelne große Münze: drei Ringe und ein roter Kern. */
    return motivSvg(
      `<circle cx="50" cy="67" r="30" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="3"/>` +
      `<circle cx="50" cy="67" r="22" fill="${MOTIV_HELL}"/>` +
      `<circle cx="50" cy="67" r="15" fill="currentColor"/>` +
      `<circle cx="50" cy="67" r="8" fill="${MOTIV_HELL}"/>` +
      `<circle cx="50" cy="67" r="4" fill="${MOTIV_ROT}"/>`
    );
  }
  const liste = MOTIV_KREISE[wert];
  /* Die Fünf trägt ihre Mitte in Rot – dieselbe Auszeichnung wie beim
     Bambus, damit sich Fünf und Sechs nicht verwechseln. */
  const rotIndex = wert === 5 ? 2 : -1;
  return motivSvg(liste.map((k, i) =>
    motivKreis(k[0], k[1], k[2], i === rotIndex ? MOTIV_ROT : null)).join(""));
}

/* ---------------------------------------------------------------------
   Bambus (索)

   Ein Stab ist ein Rohr mit zwei Knoten und verdickten Enden. Die Eins
   trägt keinen Stab, sondern den Vogel – so ist es überliefert, und sie ist
   damit auf einen Blick von allen anderen zu unterscheiden.
   --------------------------------------------------------------------- */

function motivStab(cx, cy, hoehe, breite, farbe, dreh) {
  const c = farbe || "currentColor";
  const x = cx - breite / 2;
  const y = cy - hoehe / 2;
  /* Die Enden sind nur leicht verdickt: Mehr Wulst, und aus dem Bambusrohr
     wird eine Garnrolle. */
  const kappe = breite * 0.56;
  const dreht = dreh ? ` transform="rotate(${dreh} ${cx} ${cy})"` : "";
  return `<g${dreht}>` +
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${breite}" height="${hoehe}" ` +
      `rx="${(breite * 0.4).toFixed(1)}" fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${(breite * 0.09).toFixed(2)}"/>` +
    /* Knoten: zwei Querstriche im oberen und unteren Drittel. */
    `<rect x="${x.toFixed(1)}" y="${(cy - hoehe * 0.20).toFixed(1)}" width="${breite}" height="${(hoehe * 0.04).toFixed(1)}" fill="${MOTIV_KANTE}"/>` +
    `<rect x="${x.toFixed(1)}" y="${(cy + hoehe * 0.15).toFixed(1)}" width="${breite}" height="${(hoehe * 0.04).toFixed(1)}" fill="${MOTIV_KANTE}"/>` +
    /* Enden: leicht verdickt, wie abgeschnittenes Rohr. */
    `<ellipse cx="${cx}" cy="${y.toFixed(1)}" rx="${kappe.toFixed(1)}" ry="${(breite * 0.26).toFixed(1)}" fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${(breite * 0.08).toFixed(2)}"/>` +
    `<ellipse cx="${cx}" cy="${(y + hoehe).toFixed(1)}" rx="${kappe.toFixed(1)}" ry="${(breite * 0.26).toFixed(1)}" fill="${c}" stroke="${MOTIV_KANTE}" stroke-width="${(breite * 0.08).toFixed(2)}"/>` +
    "</g>";
}

/* [x, y, höhe, breite, farbe, drehung] je Stab.

   Zwischen den Reihen muss Luft bleiben: Stehen zwei Stäbe fast aneinander,
   liest sie das Auge auf einem kleinen Stein als einen langen – und aus der
   Zwei wird eine Eins. Deshalb sind die Stäbe kürzer, als der Platz erlaubt:
   zwei Reihen mit 40 Einheiten Höhe, drei Reihen mit 28. */
const MOTIV_STAEBE = {
  2: [[50, 36, 42, 15], [50, 99, 42, 15]],
  3: [[50, 36, 42, 14], [31, 99, 42, 14], [69, 99, 42, 14]],
  4: [[31, 36, 42, 14], [69, 36, 42, 14], [31, 99, 42, 14], [69, 99, 42, 14]],
  /* Die Fünf ist ein Kreuz: vier Ecken und ein roter Stab in der Mitte. */
  5: [[28, 36, 40, 13], [72, 36, 40, 13], [50, 67, 40, 13, MOTIV_ROT],
      [28, 99, 40, 13], [72, 99, 40, 13]],
  6: [[30, 30, 30, 12], [70, 30, 30, 12], [30, 67, 30, 12],
      [70, 67, 30, 12], [30, 104, 30, 12], [70, 104, 30, 12]],
  7: [[50, 26, 26, 12, MOTIV_ROT],
      [26, 71, 30, 12], [50, 71, 30, 12], [74, 71, 30, 12],
      [26, 106, 30, 12], [50, 106, 30, 12], [74, 106, 30, 12]],
  /* Die Acht steht als Sanduhr: vier Stäbe nach rechts geneigt, vier nach
     links. Das ist die auffälligste Anordnung des Satzes. */
  8: [[24, 42, 38, 11, null, 20], [41, 42, 38, 11, null, 20],
      [59, 42, 38, 11, null, 20], [76, 42, 38, 11, null, 20],
      [24, 95, 38, 11, null, -20], [41, 95, 38, 11, null, -20],
      [59, 95, 38, 11, null, -20], [76, 95, 38, 11, null, -20]],
  9: [[26, 30, 30, 12], [50, 30, 30, 12], [74, 30, 30, 12],
      [26, 67, 30, 12], [50, 67, 30, 12], [74, 67, 30, 12],
      [26, 104, 30, 12], [50, 104, 30, 12], [74, 104, 30, 12]],
};

/** Der Vogel des Einer-Bambus. */
function motivVogel() {
  return motivSvg(
    /* Schwanz nach unten links, Körper schräg, Kopf oben rechts. */
    `<path d="M40 78 L12 118 L28 121 L50 96 Z" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.6"/>` +
    `<ellipse cx="48" cy="66" rx="20" ry="27" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.6" transform="rotate(-22 48 66)"/>` +
    `<ellipse cx="53" cy="63" rx="9" ry="18" fill="${MOTIV_HELL}" opacity="0.45" transform="rotate(-26 53 63)"/>` +
    `<circle cx="62" cy="35" r="14" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.6"/>` +
    `<path d="M75 31 L92 38 L75 43 Z" fill="${MOTIV_ROT}" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>` +
    `<circle cx="66" cy="32" r="3.6" fill="${MOTIV_HELL}"/>` +
    `<circle cx="66" cy="32" r="1.6" fill="#231d12"/>` +
    /* Ein Bambusblatt als Sitzstange. */
    `<path d="M52 100 Q68 106 78 118" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
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
   das 萬 der Farbe. Genau so stehen sie auf echten Steinen, und zwei
   übereinander gesetzte Zeichen sind gut zu unterscheiden – anders als
   Ziffern, die alle gleich breit und gleich hoch sind.
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
    `<rect x="17" y="26" width="66" height="83" rx="6" fill="none" stroke="currentColor" stroke-width="6"/>` +
    `<rect x="27" y="36" width="46" height="63" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>`
  );
}

/* Die Blumen: gezeichnet, nicht geschrieben. Alle vier passen zueinander,
   deshalb tragen sie dasselbe Eckzeichen 花 – sonst müsste man sich vier
   Bilder als Gruppe merken. */

function motivPflaume() {
  const blaetter = [];
  for (let i = 0; i < 5; i++) {
    const winkel = (-90 + i * 72) * Math.PI / 180;
    const cx = 50 + Math.cos(winkel) * 21;
    const cy = 60 + Math.sin(winkel) * 21;
    blaetter.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15" ` +
                  `fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.4"/>`);
  }
  return motivSvg(
    blaetter.join("") +
    `<circle cx="50" cy="60" r="9" fill="#f3c94b" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>` +
    `<path d="M50 82 Q46 106 34 120" stroke="#5a4523" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<path d="M46 104 Q60 100 68 108" stroke="#3f6b32" stroke-width="4" fill="none" stroke-linecap="round"/>`
  );
}

function motivOrchidee() {
  return motivSvg(
    `<path d="M26 120 Q16 78 34 42" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M52 122 Q74 88 66 44" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M40 122 Q44 84 50 58" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="38" cy="30" rx="13" ry="7" fill="currentColor" transform="rotate(-32 38 30)"/>` +
    `<ellipse cx="62" cy="30" rx="13" ry="7" fill="currentColor" transform="rotate(32 62 30)"/>` +
    `<ellipse cx="50" cy="22" rx="7" ry="12" fill="currentColor"/>` +
    `<circle cx="50" cy="34" r="7" fill="#f3c94b" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>`
  );
}

function motivChrysantheme() {
  const blaetter = [];
  for (let i = 0; i < 14; i++) {
    const grad = i * (360 / 14);
    blaetter.push(`<ellipse cx="50" cy="38" rx="6" ry="22" fill="currentColor" ` +
                  `stroke="${MOTIV_KANTE}" stroke-width="1" transform="rotate(${grad.toFixed(1)} 50 60)"/>`);
  }
  return motivSvg(
    blaetter.join("") +
    `<circle cx="50" cy="60" r="11" fill="#f3c94b" stroke="${MOTIV_KANTE}" stroke-width="1.4"/>` +
    `<path d="M50 92 Q48 110 40 122" stroke="#3f6b32" stroke-width="4" fill="none" stroke-linecap="round"/>`
  );
}

function motivBambusBlume() {
  return motivSvg(
    `<rect x="36" y="22" width="12" height="100" rx="5" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.4"/>` +
    `<rect x="36" y="52" width="12" height="4" fill="${MOTIV_KANTE}"/>` +
    `<rect x="36" y="86" width="12" height="4" fill="${MOTIV_KANTE}"/>` +
    `<rect x="58" y="46" width="9" height="76" rx="4" fill="currentColor" stroke="${MOTIV_KANTE}" stroke-width="1.2"/>` +
    `<rect x="58" y="80" width="9" height="3" fill="${MOTIV_KANTE}"/>` +
    `<path d="M42 44 Q20 34 12 16 Q34 20 42 40 Z" fill="currentColor"/>` +
    `<path d="M48 34 Q70 26 82 12 Q74 34 50 42 Z" fill="currentColor"/>` +
    `<path d="M62 62 Q84 56 94 42 Q88 64 66 70 Z" fill="currentColor"/>`
  );
}

const MOTIV_BLUMEN = {
  "blume-pflaume": motivPflaume,
  "blume-orchidee": motivOrchidee,
  "blume-chrysantheme": motivChrysantheme,
  "blume-bambus": motivBambusBlume,
};

/**
 * Das Motiv einer Steinart als Markup für die Oberseite.
 *
 * Rückgabe ist immer ein einzelnes Element – eine Zeichnung oder ein
 * Textblock. Blumen und Jahreszeiten bekommen zusätzlich ihr Eckzeichen,
 * weil sie nur innerhalb ihrer Gruppe zusammenpassen.
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

  if (a.gruppe === "blume") {
    return MOTIV_BLUMEN[a.art]() + '<span class="motiv-ecke">花</span>';
  }

  /* Jahreszeiten: das Zeichen ist markant genug, dazu das Eckzeichen 季. */
  return `<span class="motiv-text"><span class="motiv-glyph gross">${a.glyph}</span></span>` +
         '<span class="motiv-ecke">季</span>';
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { steinMotiv };
}
