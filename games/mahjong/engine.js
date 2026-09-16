"use strict";

/* =====================================================================
   Mahjong · Steine, Aufbauten und Regeln

   Diese Datei kennt kein DOM. Sie weiß, welche Steine es gibt, wie die
   Aufbauten aussehen, wann ein Stein frei liegt und wie ein Spiel entsteht,
   das sich auch lösen lässt. Die Oberfläche liegt in game.js.

   Koordinaten zählen in halben Steinen: Ein Stein an (x, y) belegt den
   Bereich [x, x+2) mal [y, y+2). Das kostet nichts und erlaubt die halben
   Versätze, ohne die kein Aufbau echt aussieht – der einzelne Stein oben auf
   der Schildkröte liegt genau zwischen vier anderen.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Steine

   Ein volles Mahjong-Spiel: 144 Steine, 72 Paare.

   34 Arten kommen viermal vor (drei Farben mit je neun Werten, vier Winde,
   drei Drachen). Dazu vier Blumen und vier Jahreszeiten, von denen ein
   echter Satz je ein Stück hat – abräumen ließe sich das nie. Ein Spiel
   nimmt deshalb aus jeder der beiden Gruppen zwei ausgewürfelte Bilder und
   legt sie doppelt hinein.
   --------------------------------------------------------------------- */

/* Die drei Farben. `mark` ist das chinesische Zeichen der Farbe; davor steht
   auf dem Stein die Zahl, weil sich Ziffern schneller vergleichen lassen. */
const FARBEN = [
  { art: "bambus", mark: "索", klasse: "bambus" },
  { art: "muenze", mark: "筒", klasse: "muenze" },
  { art: "zeichen", mark: "萬", klasse: "zeichen" },
];

const WINDE = [
  { art: "wind-ost", glyph: "東", name: "Ost" },
  { art: "wind-sued", glyph: "南", name: "Süd" },
  { art: "wind-west", glyph: "西", name: "West" },
  { art: "wind-nord", glyph: "北", name: "Nord" },
];

const DRACHEN = [
  { art: "drache-rot", glyph: "中", name: "Roter Drache", klasse: "drache-rot" },
  { art: "drache-gruen", glyph: "發", name: "Grüner Drache", klasse: "drache-gruen" },
  { art: "drache-weiss", glyph: "白", name: "Weißer Drache", klasse: "drache-weiss" },
];

const BLUMEN = [
  { art: "blume-pflaume", glyph: "梅", name: "Pflaumenblüte" },
  { art: "blume-orchidee", glyph: "蘭", name: "Orchidee" },
  { art: "blume-chrysantheme", glyph: "菊", name: "Chrysantheme" },
  { art: "blume-bambus", glyph: "竹", name: "Bambus" },
];

const JAHRESZEITEN = [
  { art: "zeit-fruehling", glyph: "春", name: "Frühling" },
  { art: "zeit-sommer", glyph: "夏", name: "Sommer" },
  { art: "zeit-herbst", glyph: "秋", name: "Herbst" },
  { art: "zeit-winter", glyph: "冬", name: "Winter" },
];

/**
 * Alle Steinarten, nach `art` ansprechbar.
 *
 * Zusammen passen ausschließlich Steine derselben Art – auch Blumen und
 * Jahreszeiten. Früher passte hier jede Blume zu jeder anderen, wie in
 * vielen Umsetzungen; auf dem Brett heißt das aber, dass zwei sichtbar
 * verschiedene Bilder ein Paar sind, und das liest niemand ab. Stattdessen
 * bringt ein Spiel von zwei Blumen je zwei Stück mit (siehe `bauePaare`).
 */
const STEIN_ARTEN = (() => {
  const arten = {};
  FARBEN.forEach((farbe) => {
    for (let wert = 1; wert <= 9; wert++) {
      const art = farbe.art + "-" + wert;
      arten[art] = {
        art: art,
        gruppe: farbe.art,
        klasse: farbe.klasse,
        zahl: String(wert),
        mark: farbe.mark,
        name: wert + " " + { bambus: "Bambus", muenze: "Münzen", zeichen: "Zeichen" }[farbe.art],
      };
    }
  });
  WINDE.forEach((wind) => {
    arten[wind.art] = { art: wind.art, gruppe: "wind",
                        klasse: "wind", glyph: wind.glyph, name: wind.name };
  });
  DRACHEN.forEach((d) => {
    arten[d.art] = { art: d.art, gruppe: "drache",
                     klasse: d.klasse, glyph: d.glyph, name: d.name };
  });
  BLUMEN.forEach((b) => {
    arten[b.art] = { art: b.art, gruppe: "blume",
                     klasse: "blume", glyph: b.glyph, name: b.name };
  });
  JAHRESZEITEN.forEach((j) => {
    arten[j.art] = { art: j.art, gruppe: "jahreszeit",
                     klasse: "jahreszeit", glyph: j.glyph, name: j.name };
  });
  return arten;
})();

/**
 * Zwei Arten aus einer Gruppe, jede als Paar gleicher Steine.
 *
 * Ein echter Satz hat von jeder Blume nur ein Stück – für zwei Paare aus
 * gleichen Bildern reichen also nicht alle vier. Welche zwei mitspielen,
 * würfelt jedes Spiel neu aus; über mehrere Runden kommen so trotzdem alle
 * acht Bilder vor.
 */
function waehleDoppelpaare(gruppe, zufall) {
  const erste = Math.floor(zufall() * gruppe.length);
  /* Die zweite aus den übrigen drei: Der Index überspringt die erste, statt
     bei einem Treffer neu zu würfeln – das hat kein schlechtestes Ende. */
  let zweite = Math.floor(zufall() * (gruppe.length - 1));
  if (zweite >= erste) zweite += 1;
  return [[gruppe[erste].art, gruppe[erste].art],
          [gruppe[zweite].art, gruppe[zweite].art]];
}

/**
 * Die 72 Paare, aus denen ein Spiel besteht.
 *
 * Die vierfachen Arten geben je zwei Paare gleicher Steine. Blumen und
 * Jahreszeiten kommen mit zwei ausgewürfelten Bildern zu je zwei Stück –
 * siehe `waehleDoppelpaare`.
 */
function bauePaare(zufall) {
  const rnd = zufall || Math.random;
  const paare = [];
  Object.keys(STEIN_ARTEN).forEach((art) => {
    const stein = STEIN_ARTEN[art];
    if (stein.gruppe === "blume" || stein.gruppe === "jahreszeit") return;
    paare.push([art, art]);
    paare.push([art, art]);
  });
  waehleDoppelpaare(BLUMEN, rnd).forEach((p) => paare.push(p));
  waehleDoppelpaare(JAHRESZEITEN, rnd).forEach((p) => paare.push(p));
  return paare;
}

/**
 * Passen diese zwei Steine zusammen?
 *
 * Gleiches Bild, sonst nichts – auch bei Blumen und Jahreszeiten. Zwei
 * Steine, die zusammengehören, sehen deshalb immer gleich aus.
 */
function passt(a, b) {
  if (!a || !b || a === b) return false;
  return a.art === b.art;
}

/* ---------------------------------------------------------------------
   Aufbauten

   Jede Ebene wird als Zeichenbild beschrieben: ein '#' ist ein Stein, alles
   andere ist Luft. Ein Zeichen entspricht einem ganzen Stein, also zwei
   halben Schritten – `x0`/`y0` legen fest, wo das Bild beginnt. Steine auf
   halben Positionen stehen in `punkte`, weil sie sich im Raster nicht
   ausdrücken lassen.

   `versatz` verschiebt einzelne Reihen um halbe Steine nach rechts. Ohne das
   liegt alles in einem starren Gitter, und ein Haufen Mahjongsteine sieht
   nicht so aus: Reihen sitzen gegeneinander versetzt, obere Ebenen liegen
   zwischen den Steinen darunter. Für die Regeln ändert das nichts – geräumt
   wird nach links und rechts, und wer in einer Reihe liegt, bleibt es auch.

   Ablesbar bleibt es so auch nach einem Jahr, und ein verrutschter Stein
   fällt beim Draufschauen auf.
   --------------------------------------------------------------------- */

const LAYOUTS = {
  schildkroete: {
    name: "Schildkröte",
    hinweis: "Der Klassiker: 144 Steine in fünf Ebenen",
    ebenen: [
      {
        x0: 0, y0: 0,
        /* Die vier inneren Reihen sitzen um einen halben Stein versetzt. Die
           beiden Mittelreihen bleiben, wo sie sind – an ihnen sitzen Kopf und
           Schwanz, und die sollen nicht auf Lücke stehen. */
        versatz: [0, 1, 1, 0, 0, 1, 1, 0],
        zeilen: [
          " ############ ",
          "   ########   ",
          "  ##########  ",
          " ############ ",
          " ############ ",
          "  ##########  ",
          "   ########   ",
          " ############ ",
        ],
        /* Kopf und Schwanz sitzen mittig zwischen den Reihen. */
        punkte: [[0, 7], [26, 7], [28, 7]],
      },
      /* Die oberen Ebenen liegen überall auf Lücke: Der `versatz` je Reihe ist
         so gewählt, dass er die Parität der Reihe darunter kippt. Damit sitzt
         jeder Stein mittig über zwei Steinen – nie halb daneben, nie exakt
         darauf. Der letzte Stein liegt mittig über vier. */
      { x0: 8, y0: 2, versatz: [0, 0, 1, 1, 0, 0],
        zeilen: ["######", "######", "######", "######", "######", "######"] },
      { x0: 10, y0: 4, versatz: [1, 0, 0, 1], zeilen: ["####", "####", "####", "####"] },
      { x0: 13, y0: 6, zeilen: ["##", "##"] },
      { punkte: [[14, 7]] },
    ],
  },

  pyramide: {
    name: "Pyramide",
    hinweis: "Fünf Stufen, jede eine Reihe kleiner",
    ebenen: [
      { x0: 0, y0: 0, versatz: [0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: ["#########", "#########", "#########", "#########",
                 "#########", "#########", "#########", "#########"] },
      /* Jede Stufe kippt die Parität der Reihe darunter und liegt damit
         mittig über zwei Steinen. */
      { x0: 2, y0: 2, versatz: [0, 1, 0, 1, 0, 1],
        zeilen: ["#######", "#######", "#######", "#######", "#######", "#######"] },
      { x0: 4, y0: 4, versatz: [0, 1, 0, 1], zeilen: ["#####", "#####", "#####", "#####"] },
      { x0: 6, y0: 6, versatz: [0, 1], zeilen: ["###", "###"] },
      /* Die Spitze: zwei Steine je Reihe, jeder mittig über zwei. */
      { punkte: [[7, 6], [9, 6], [8, 8], [10, 8]] },
    ],
  },

  festung: {
    name: "Festung",
    hinweis: "Mauern mit Innenhof und vier Türmen",
    /* Alle Ebenen sind gleich versetzt: So stehen die Steine im Verband wie
       Mauerwerk, und die Türme bleiben trotzdem senkrecht. */
    ebenen: [
      {
        x0: 0, y0: 0,
        versatz: [0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: [
          "############",
          "############",
          "############",
          "####    ####",
          "####    ####",
          "############",
          "############",
          "############",
        ],
      },
      {
        x0: 0, y0: 0,
        versatz: [0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: [
          "############",
          "#          #",
          "#          #",
          "#          #",
          "#          #",
          "#          #",
          "#          #",
          "############",
        ],
      },
      {
        x0: 0, y0: 0,
        versatz: [0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: [
          "#          #",
          "#          #",
          "#          #",
          "            ",
          "            ",
          "#          #",
          "#          #",
          "#          #",
        ],
      },
      {
        x0: 0, y0: 0,
        versatz: [0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: [
          "#          #",
          "#          #",
          "            ",
          "            ",
          "            ",
          "            ",
          "#          #",
          "#          #",
        ],
      },
    ],
  },

  katze: {
    name: "Katze",
    hinweis: "Sitzende Katze, zwei Ebenen",
    ebenen: [
      {
        x0: 0, y0: 0,
        versatz: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
        zeilen: [
          " ##       ## ",
          " ####   #### ",
          " ########### ",
          "#############",
          "#############",
          " ########### ",
          "  #########  ",
          " ########### ",
          " ########### ",
          "#############",
          "#############",
          "#### ### ####",
        ],
      },
      /* Die obere Ebene liegt auf der Brust, jede Reihe mittig über zwei
         Steinen der Reihe darunter. */
      { x0: 8, y0: 14, versatz: [0, 1, 0, 1],
        zeilen: ["####", "####", "####", "####"] },
    ],
  },
};

/**
 * Rechnet ein Zeichenbild in Positionen um.
 *
 * Gibt eine Liste von `{ x, y, z }` in halben Steinen zurück, von unten nach
 * oben – die Reihenfolge zählt fürs Zeichnen, weil obere Steine über unteren
 * liegen müssen.
 */
function layoutPositionen(layout) {
  const positionen = [];
  layout.ebenen.forEach((ebene, z) => {
    if (ebene.zeilen) {
      ebene.zeilen.forEach((zeile, j) => {
        const vx = (ebene.versatz && ebene.versatz[j]) || 0;
        for (let i = 0; i < zeile.length; i++) {
          if (zeile[i] !== "#") continue;
          positionen.push({ x: ebene.x0 + vx + 2 * i, y: ebene.y0 + 2 * j, z: z });
        }
      });
    }
    if (ebene.punkte) {
      ebene.punkte.forEach((p) => positionen.push({ x: p[0], y: p[1], z: z }));
    }
  });
  return positionen;
}

/** Anzahl Steine eines Aufbaus. Muss 144 sein, sonst geht das Spiel nicht auf. */
function layoutGroesse(layout) { return layoutPositionen(layout).length; }

/* ---------------------------------------------------------------------
   Freiliegende Steine

   Ein Stein lässt sich nehmen, wenn nichts auf ihm liegt und er nach links
   oder nach rechts herausrutschen kann. Nach vorn oder hinten geht nichts –
   so sind die Regeln, und daran hängt der ganze Reiz.
   --------------------------------------------------------------------- */

/** Überdecken sich zwei Steine in der Tiefe (also in y)? */
function reihenUeberlappen(a, b) { return Math.abs(a.y - b.y) < 2; }

/**
 * Liegt auf `stein` etwas drauf?
 *
 * Es genügt, dass ein Stein der Ebene darüber irgendeinen Teil der Fläche
 * bedeckt – auch ein halb versetzter.
 */
function hatDrauf(stein, steine) {
  for (let i = 0; i < steine.length; i++) {
    const s = steine[i];
    if (s.weg || s === stein) continue;
    if (s.z !== stein.z + 1) continue;
    if (Math.abs(s.x - stein.x) < 2 && Math.abs(s.y - stein.y) < 2) return true;
  }
  return false;
}

/**
 * Ist die Seite blockiert? `richtung` ist -1 für links, +1 für rechts.
 *
 * Blockiert ist sie, wenn ein Stein derselben Ebene den Streifen daneben
 * berührt. Ein Stein zwei Breiten entfernt lässt den Streifen frei und
 * blockiert deshalb nicht.
 */
function seiteBlockiert(stein, steine, richtung) {
  for (let i = 0; i < steine.length; i++) {
    const s = steine[i];
    if (s.weg || s === stein) continue;
    if (s.z !== stein.z) continue;
    if (!reihenUeberlappen(s, stein)) continue;
    const abstand = (s.x - stein.x) * richtung;
    if (abstand > 0 && abstand < 4) return true;
  }
  return false;
}

/** Lässt sich dieser Stein nehmen? */
function istFrei(stein, steine) {
  if (stein.weg) return false;
  if (hatDrauf(stein, steine)) return false;
  return !seiteBlockiert(stein, steine, -1) || !seiteBlockiert(stein, steine, 1);
}

/** Alle Steine, die gerade frei liegen. */
function freieSteine(steine) {
  const frei = [];
  for (let i = 0; i < steine.length; i++) {
    if (istFrei(steine[i], steine)) frei.push(steine[i]);
  }
  return frei;
}

/** Ein passendes Paar unter den freien Steinen, oder `null`. */
function freiesPaar(steine) {
  const frei = freieSteine(steine);
  for (let i = 0; i < frei.length; i++) {
    for (let j = i + 1; j < frei.length; j++) {
      if (passt(frei[i], frei[j])) return [frei[i], frei[j]];
    }
  }
  return null;
}

/* ---------------------------------------------------------------------
   Spiele erzeugen, die aufgehen

   Gemischt wird nicht das Spielfeld, sondern der Weg dorthin: Vom vollen
   Aufbau wird Paar für Paar abgeräumt, und erst beim Abräumen wird
   entschieden, welche Steine das waren. Weil bei jedem Schritt nur wirklich
   freie Plätze genommen werden, ist die umgekehrte Reihenfolge eine
   Lösung – der Beweis entsteht beim Bauen und muss nicht gesucht werden.

   Verspielen kann man sich trotzdem: Wer die falschen zwei von vier gleichen
   Steinen nimmt, verbaut sich den Rest. Genau dafür gibt es das Mischen.
   --------------------------------------------------------------------- */

/**
 * Verteilt Steinarten auf Plätze, sodass sich alles abräumen lässt.
 *
 * `plaetze` sind Positionen ohne Belegung, `paare` die zu verteilenden
 * Paare. Gibt `null` zurück, wenn kein Weg gefunden wurde – bei geraden
 * Platzzahlen kommt das nicht vor, aber ein stiller Fehlschlag wäre
 * schlimmer als einer, der sich zeigt.
 */
function verteileLoesbar(plaetze, paare, zufall) {
  const steine = plaetze.map((p) => ({ x: p.x, y: p.y, z: p.z, art: null, weg: false }));
  const uebrig = paare.slice();
  mische(uebrig, zufall);

  for (let schritt = 0; schritt < paare.length; schritt++) {
    const frei = freieSteine(steine);
    if (frei.length < 2) return null;
    /* Zwei verschiedene freie Plätze für das nächste Paar. */
    const a = frei[Math.floor(zufall() * frei.length)];
    let b = a;
    while (b === a) b = frei[Math.floor(zufall() * frei.length)];

    const paar = uebrig.pop();
    a.art = paar[0];
    b.art = paar[1];
    a.weg = true;
    b.weg = true;
  }

  steine.forEach((s) => { s.weg = false; });
  return steine;
}

/** Fisher-Yates, mit austauschbarer Zufallsquelle. */
function mische(arr, zufall) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    const h = arr[i];
    arr[i] = arr[j];
    arr[j] = h;
  }
}

/**
 * Baut ein neues Spiel auf dem gewählten Aufbau.
 *
 * Die Steine kommen mit fortlaufender `id`, damit die Oberfläche ihre
 * Elemente wiederfindet, und in Zeichenreihenfolge – untere Ebenen zuerst.
 */
function erzeugeSpiel(layoutName, zufall) {
  const layout = LAYOUTS[layoutName];
  if (!layout) throw new Error("Unbekannter Aufbau: " + layoutName);
  const plaetze = layoutPositionen(layout);
  const rnd = zufall || Math.random;
  const paare = bauePaare(rnd);
  if (plaetze.length !== paare.length * 2) {
    throw new Error("Aufbau " + layoutName + " hat " + plaetze.length +
                    " Plätze, gebraucht werden " + paare.length * 2);
  }

  /* Ein Fehlschlag ist bei diesen Aufbauten nicht zu erwarten; falls doch,
     hilft ein neuer Versuch, weil die Auswahl zufällig ist. */
  for (let versuch = 0; versuch < 50; versuch++) {
    const steine = verteileLoesbar(plaetze, paare, rnd);
    if (steine) {
      steine.forEach((s, i) => { s.id = "s" + i; });
      return steine;
    }
  }
  throw new Error("Kein lösbarer Aufbau gefunden: " + layoutName);
}

/**
 * Mischt die noch liegenden Steine neu – wieder so, dass es aufgeht.
 *
 * Gebraucht wird das, wenn sich jemand festgespielt hat. Die Plätze bleiben,
 * nur die Steinarten werden neu verteilt; damit ist die Stellung ab hier
 * wieder sicher zu schaffen.
 *
 * `false` heißt: Aus diesen Plätzen lässt sich überhaupt kein lösbares Bild
 * mehr bauen – was übrig ist, gibt es nicht mehr her. Das kommt vor: Ein
 * einzelner Turm etwa gibt immer nur einen Stein frei, und ein Paar braucht
 * zwei. Dann hilft nur Zurücknehmen oder ein neues Spiel.
 */
function mischeUebrige(steine, zufall) {
  const liegend = steine.filter((s) => !s.weg);
  if (liegend.length < 2) return false;

  const paare = [];
  /* Aus den vorhandenen Arten wieder Paare bilden – gleiche Art heißt:
     gehört zueinander. Ungerade kann keine Art sein, weil immer nur passende
     Paare vom Tisch gehen – aber ein stiller Fehlschlag wäre schlimmer als
     einer, der sich zeigt. */
  const nachSchluessel = {};
  liegend.forEach((s) => {
    if (!nachSchluessel[s.art]) nachSchluessel[s.art] = [];
    nachSchluessel[s.art].push(s.art);
  });
  const schluessel = Object.keys(nachSchluessel);
  for (let i = 0; i < schluessel.length; i++) {
    const liste = nachSchluessel[schluessel[i]];
    if (liste.length % 2 !== 0) return false;
    for (let j = 0; j < liste.length; j += 2) paare.push([liste[j], liste[j + 1]]);
  }

  const plaetze = liegend.map((s) => ({ x: s.x, y: s.y, z: s.z }));
  const rnd = zufall || Math.random;
  /* Das Verteilen wählt zufällig und kann sich verrennen. Beim Aufbau eines
     ganzen Spiels fällt das nie auf, weil ein voller Aufbau reichlich freie
     Plätze hat; bei einem halb abgeräumten Tisch schon. Also mehrere Anläufe,
     bevor aufgegeben wird. */
  for (let versuch = 0; versuch < 60; versuch++) {
    const neu = verteileLoesbar(plaetze, paare, rnd);
    if (neu) {
      liegend.forEach((s, i) => { s.art = neu[i].art; });
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------------
   Steht es noch gut?

   Beim Klassiker ist die Frage einfach: Gibt es ein passendes Paar unter den
   freien Steinen? Wenn nicht, geht nichts mehr.

   Bei der Vorrat-Variante kommt der Vorrat dazu. Passt ein freier Stein zu
   einem im Vorrat, geht es weiter. Sonst braucht es einen leeren Platz, um
   überhaupt etwas aufnehmen zu können.
   --------------------------------------------------------------------- */

/** Gibt es im Klassiker noch einen Zug? */
function klassischZugMoeglich(steine) { return freiesPaar(steine) !== null; }

/**
 * Gibt es in der Vorrat-Variante noch einen Zug?
 *
 * `vorrat` ist die Liste der abgelegten Steine, `plaetze` die Zahl der
 * Slots.
 */
function vorratZugMoeglich(steine, vorrat, plaetze) {
  const frei = freieSteine(steine);
  if (frei.length === 0) return false;
  for (let i = 0; i < frei.length; i++) {
    for (let j = 0; j < vorrat.length; j++) {
      if (passt(frei[i], vorrat[j])) return true;
    }
  }
  return vorrat.length < plaetze;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STEIN_ARTEN, LAYOUTS, bauePaare, passt, layoutPositionen, layoutGroesse,
    istFrei, freieSteine, freiesPaar, erzeugeSpiel, mischeUebrige,
    klassischZugMoeglich, vorratZugMoeglich, hatDrauf, seiteBlockiert,
  };
}
