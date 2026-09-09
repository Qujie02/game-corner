"use strict";

/* =====================================================================
   Puzzle · Schnitt und Teileformen

   Der Schnitt hängt allein vom Raster ab, nicht vom Bild – dasselbe
   Muster lässt sich also auf jedes Motiv stanzen. Er entsteht aus einer
   Saatzahl, deshalb genügt es, diese eine Zahl im Spielstand abzulegen,
   um exakt denselben Schnitt wiederherzustellen.

   Die Schnittlinien liegen nicht auf einem starren Raster: Spalten und
   Zeilen sind unterschiedlich breit, und jeder innere Gitterpunkt ist
   zusätzlich leicht versetzt. Dadurch ist kein Teil wie das andere,
   ohne dass die Formen abenteuerlich würden.
   ===================================================================== */

/**
 * Die drei Schnittarten.
 *
 * breitenVarianz – wie stark Spaltenbreiten und Zeilenhöhen schwanken
 * punktVersatz   – wie weit ein innerer Gitterpunkt aus der Kreuzung rutscht
 * nasenTiefe     – Anteil der Zellgröße, den eine Kantenform ausschlägt
 * nasenGroesse   – Spanne der Nasengröße
 * nasenVersatz   – wie weit die Form aus der Kantenmitte wandert
 * ueberhang      – wie weit über den Kern hinaus gezeichnet werden darf
 * kantenStile    – Gewichte der Kantenformen (siehe zeichneKante)
 * zellenProTeil  – wie fein das Untergitter ist, aus dem Teile wachsen
 * formen         – Gewichte der Wuchsformen (siehe wachseRegionen)
 * figuren        – Anteil der Teile, der als freie Figur ausgestanzt wird
 */
const SCHNITT_ARTEN = {
  normal: {
    name: "Normal",
    beschreibung: "Klassisch, alle Teile fast gleich groß",
    breitenVarianz: 0.04, punktVersatz: 0.02,
    nasenTiefe: 0.24, nasenGroesse: [0.96, 0.10], nasenVersatz: 0.03,
    ueberhang: 1.25,
    kantenStile: { nase: 1 },
    zellenProTeil: 1,
    formen: { kompakt: 1 },
    figuren: 0,
  },
  ungewoehnlich: {
    name: "Ungewöhnlich",
    beschreibung: "Größe und Zuschnitt schwanken deutlich",
    breitenVarianz: 0.16, punktVersatz: 0.08,
    nasenTiefe: 0.24, nasenGroesse: [0.90, 0.25], nasenVersatz: 0.08,
    ueberhang: 1.25,
    kantenStile: { nase: 1 },
    zellenProTeil: 1,
    formen: { kompakt: 1 },
    figuren: 0,
  },
  scuffed: {
    name: "Scuffed",
    beschreibung: "Schmale, verschlungene und figürliche Teile",
    breitenVarianz: 0.30, punktVersatz: 0.18,
    nasenTiefe: 0.30, nasenGroesse: [0.75, 0.60], nasenVersatz: 0.12,
    ueberhang: 1.65,
    // Gemischt, aber nicht überall zugleich: Ruhige und gerade Stücke lassen
    // die Silhouette eines Teils überhaupt erst lesbar werden. Zacken sind
    // selten, sonst sieht alles nur noch nach gerissenem Papier aus.
    kantenStile: { nase: 4, bogen: 4, welle: 3, gerade: 3, doppelnase: 1, zacken: 1 },
    zellenProTeil: 6,
    formen: { lang: 3, schlange: 3, kompakt: 2, klotz: 1 },
    figuren: 0.05,
  },
};

function schnittArt(name) {
  return SCHNITT_ARTEN[name] || SCHNITT_ARTEN.ungewoehnlich;
}

/** Kleiner, schneller Zufallsgenerator mit Saat (mulberry32). */
function makeRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wählt ein Raster, dessen Teile möglichst quadratisch sind und dessen
 * Anzahl nahe am Wunsch liegt.
 */
function chooseGrid(imageWidth, imageHeight, targetPieces) {
  const seite = imageWidth / imageHeight;
  let best = null;
  for (let cols = 2; cols <= 200; cols++) {
    const rows = Math.max(2, Math.round(targetPieces / cols));
    const anzahl = cols * rows;
    // Wie quadratisch sind die Teile, und wie nah an der Wunschzahl?
    const teilSeite = (imageWidth / cols) / (imageHeight / rows);
    const formFehler = Math.abs(Math.log(teilSeite));
    const zahlFehler = Math.abs(anzahl - targetPieces) / targetPieces;
    const fehler = formFehler * 3 + zahlFehler;
    if (!best || fehler < best.fehler) best = { cols: cols, rows: rows, fehler: fehler };
  }
  return { cols: best.cols, rows: best.rows, pieces: best.cols * best.rows, aspect: seite };
}

/**
 * Verteilt n+1 Trennlinien zwischen 0 und 1 mit ungleichen Abständen.
 * Die beiden Enden liegen fest auf dem Bildrand.
 */
function trennLinien(n, rnd, varianz) {
  const breiten = [];
  let summe = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 + (rnd() - 0.5) * 2 * varianz;
    breiten.push(w);
    summe += w;
  }
  const linien = [0];
  let lauf = 0;
  for (let i = 0; i < n; i++) {
    lauf += breiten[i] / summe;
    linien.push(i === n - 1 ? 1 : lauf);
  }
  return linien;
}

/**
 * Legt das Gitter und für jede innere Kante fest, ob die Nase heraussteht
 * oder hineingeht, und variiert Lage und Größe leicht.
 *
 * horizontal[r][c] = Kante zwischen Teil (r,c) und (r+1,c)   – waagerechte Kante
 * vertical[r][c]   = Kante zwischen Teil (r,c) und (r,c+1)   – senkrechte Kante
 * punkte[r][c]     = Gitterpunkt in Bildanteilen (0..1)
 */
function makeCut(cols, rows, seed, artName) {
  const art = schnittArt(artName);
  const rnd = makeRandom(seed);
  const spaltenX = trennLinien(cols, rnd, art.breitenVarianz);
  const zeilenY = trennLinien(rows, rnd, art.breitenVarianz);

  // Gitterpunkte: innen versetzt, am Bildrand bleibt die Kante gerade.
  const punkte = [];
  for (let r = 0; r <= rows; r++) {
    const zeile = [];
    for (let c = 0; c <= cols; c++) {
      const innenX = c > 0 && c < cols;
      const innenY = r > 0 && r < rows;
      const spanX = innenX ? Math.min(spaltenX[c] - spaltenX[c - 1], spaltenX[c + 1] - spaltenX[c]) : 0;
      const spanY = innenY ? Math.min(zeilenY[r] - zeilenY[r - 1], zeilenY[r + 1] - zeilenY[r]) : 0;
      zeile.push({
        x: spaltenX[c] + (innenX ? (rnd() - 0.5) * 2 * art.punktVersatz * spanX : 0),
        y: zeilenY[r] + (innenY ? (rnd() - 0.5) * 2 * art.punktVersatz * spanY : 0),
      });
    }
    punkte.push(zeile);
  }

  const horizontal = [];
  const vertical = [];

  const stile = [];
  for (const name in art.kantenStile) {
    for (let i = 0; i < art.kantenStile[name]; i++) stile.push(name);
  }

  function kante() {
    return {
      sign: rnd() < 0.5 ? -1 : 1,
      // Mitte verschieben und Größe variieren – rein optisch.
      shift: (rnd() - 0.5) * 2 * art.nasenVersatz,
      size: art.nasenGroesse[0] + rnd() * art.nasenGroesse[1],
      stil: stile[Math.floor(rnd() * stile.length)],
    };
  }

  for (let r = 0; r < rows - 1; r++) {
    const zeile = [];
    for (let c = 0; c < cols; c++) zeile.push(kante());
    horizontal.push(zeile);
  }
  for (let r = 0; r < rows; r++) {
    const zeile = [];
    for (let c = 0; c < cols - 1; c++) zeile.push(kante());
    vertical.push(zeile);
  }

  return {
    cols: cols, rows: rows, seed: seed, art: art,
    punkte: punkte, horizontal: horizontal, vertical: vertical,
  };
}

/** Die vier Kanten eines Teils, jeweils mit Vorzeichen aus Sicht dieses Teils. */
function edgesOf(cut, r, c) {
  return {
    // Oben: gehört zur waagerechten Kante über dem Teil, aus dessen Sicht umgekehrt.
    top: r === 0 ? null : negate(cut.horizontal[r - 1][c]),
    bottom: r === cut.rows - 1 ? null : cut.horizontal[r][c],
    left: c === 0 ? null : negate(cut.vertical[r][c - 1]),
    right: c === cut.cols - 1 ? null : cut.vertical[r][c],
  };
}

function negate(e) {
  return { sign: -e.sign, shift: -e.shift, size: e.size, stil: e.stil };
}

/**
 * Die vier Ecken eines Teils in Bildpixeln.
 *
 * Zwei benachbarte Teile greifen auf dieselben Gitterpunkte zu. Ihre
 * gemeinsame Kante ist deshalb exakt dieselbe Kurve – nur andersherum
 * durchlaufen. Genau darauf beruht das nahtlose Zeichnen von Verbünden.
 */
function pieceCorners(cut, r, c, puzzleW, puzzleH) {
  function P(rr, cc) {
    const p = cut.punkte[rr][cc];
    return { x: p.x * puzzleW, y: p.y * puzzleH };
  }
  return { tl: P(r, c), tr: P(r, c + 1), br: P(r + 1, c + 1), bl: P(r + 1, c) };
}

/**
 * Die Knotenketten der Kantenformen.
 *
 * Eine Kante wird von beiden angrenzenden Teilen gezeichnet – vom einen
 * vorwärts, vom anderen rückwärts mit umgekehrtem Vorzeichen. Nur wenn dabei
 * exakt dieselbe Kurve herauskommt, bleiben Verbünde nahtlos. Deshalb wird
 * jede Kette aus einer halben Kette gespiegelt: Damit ist die Symmetrie
 * gebaut und nicht bloß nachgeprüft.
 *
 * a = Anteil entlang der Kante, o = Ausschlag als Vielfaches der Nasentiefe.
 */
function spiegleKette(halb, mitte) {
  const voll = halb.slice();
  if (mitte) voll.push(mitte);
  for (let i = halb.length - 1; i >= 0; i--) {
    voll.push({ a: 1 - halb[i].a, o: halb[i].o });
  }
  return voll;
}

const KANTEN_KETTEN = {
  // Sanfte Schlangenlinie über die ganze Kante
  welle: spiegleKette([{ a: 0.16, o: 0.55 }, { a: 0.33, o: -0.55 }], { a: 0.5, o: 0.55 }),
  // Scharfe Zacken – wird mit geraden Strichen gezogen
  zacken: spiegleKette([{ a: 0.22, o: 0.5 }, { a: 0.38, o: -0.5 }], { a: 0.5, o: 0.5 }),
  // Ein einziger großer Bogen: macht aus der Kante eine Rundung
  bogen: spiegleKette([{ a: 0.18, o: 0.40 }, { a: 0.32, o: 0.85 }], { a: 0.5, o: 1.0 }),
  // Zwei Höcker nebeneinander
  doppelnase: spiegleKette([
    { a: 0.18, o: 0 }, { a: 0.24, o: 0.75 }, { a: 0.32, o: 1.0 }, { a: 0.40, o: 0.2 },
  ], { a: 0.5, o: 0 }),
};

/**
 * Zeichnet eine glatte Kurve durch die Punkte (Catmull-Rom als Bézier).
 * Die Vorschrift ist umkehrsymmetrisch: Rückwärts entsteht dieselbe Kurve.
 */
function glatteKurve(path, punkte) {
  const n = punkte.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = punkte[i > 0 ? i - 1 : 0];
    const p1 = punkte[i];
    const p2 = punkte[i + 1];
    const p3 = punkte[i + 2 < n ? i + 2 : n - 1];
    path.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
}

/**
 * Zeichnet eine Kante von (x0,y0) nach (x1,y1) in den Pfad.
 * `depth` ist die Nasentiefe in Pixeln, das Vorzeichen zeigt nach außen.
 * Ist `edge` null, wird eine gerade Linie gezogen (Bildrand).
 */
function traceEdge(path, x0, y0, x1, y1, edge, depth) {
  if (!edge) { path.lineTo(x1, y1); return; }

  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;         // entlang der Kante
  const nx = -uy, ny = ux;                     // senkrecht dazu
  const t = depth * edge.size * edge.sign;
  const m = edge.shift * len;                  // Verschiebung der Form

  // Punkt aus Anteil entlang der Kante und Vielfachem der Nasentiefe
  function p(along, out) {
    const a = along * len + m;
    return [x0 + ux * a + nx * out * t, y0 + uy * a + ny * out * t];
  }

  const stil = edge.stil || "nase";

  if (stil === "gerade") { path.lineTo(x1, y1); return; }

  if (stil === "nase") {
    // Klassische Puzzlenase: breite Basis, fließender Übergang aus der Kante,
    // darüber ein rundlicher Kopf. Eine schmale Basis mit rundem Kopf sähe aus
    // wie eine Kugel auf einem Stiel – das ist nicht die übliche Form.
    const A = p(0.32, 0);
    const B = p(0.42, 0.46);
    const C = p(0.58, 0.46);
    const D = p(0.68, 0);

    path.lineTo(A[0], A[1]);
    let c1 = p(0.45, 0.06), c2 = p(0.38, 0.30);
    path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], B[0], B[1]);
    c1 = p(0.30, 0.98); c2 = p(0.70, 0.98);
    path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], C[0], C[1]);
    c1 = p(0.62, 0.30); c2 = p(0.55, 0.06);
    path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], D[0], D[1]);

    path.lineTo(x1, y1);
    return;
  }

  // Anfang und Ende sind die Ecken selbst, nicht p(0,0) und p(1,0): Der
  // Versatz soll nur das Innere der Form verschieben. Sonst löste sich die
  // Kante von den Gitterpunkten – und die Nachbarn passten nicht mehr.
  const kette = KANTEN_KETTEN[stil];
  const punkte = [[x0, y0]];
  for (let i = 0; i < kette.length; i++) punkte.push(p(kette[i].a, kette[i].o));
  punkte.push([x1, y1]);

  if (stil === "zacken") {
    for (let i = 1; i < punkte.length; i++) path.lineTo(punkte[i][0], punkte[i][1]);
  } else {
    glatteKurve(path, punkte);
  }
}

/**
 * Umriss einer Rasterzelle, bezogen auf einen frei wählbaren Ursprung.
 *
 * Der Ursprung ist nicht mehr zwangsläufig die Zellecke: Ein Teil kann aus
 * mehreren Zellen bestehen, und die teilen sich dann einen gemeinsamen Bezug.
 */
function cellPath(cut, r, c, puzzleW, puzzleH, depth, ox, oy) {
  const e = edgesOf(cut, r, c);
  const k = pieceCorners(cut, r, c, puzzleW, puzzleH);
  const path = new Path2D();
  path.moveTo(k.tl.x - ox, k.tl.y - oy);
  traceEdge(path, k.tl.x - ox, k.tl.y - oy, k.tr.x - ox, k.tr.y - oy, e.top, depth);
  traceEdge(path, k.tr.x - ox, k.tr.y - oy, k.br.x - ox, k.br.y - oy, e.right, depth);
  traceEdge(path, k.br.x - ox, k.br.y - oy, k.bl.x - ox, k.bl.y - oy, e.bottom, depth);
  traceEdge(path, k.bl.x - ox, k.bl.y - oy, k.tl.x - ox, k.tl.y - oy, e.left, depth);
  path.closePath();
  return path;
}

/**
 * Die vier Kanten eines Teils als je eigener, offener Pfad.
 *
 * Damit lässt sich die Kontur eines Verbunds zeichnen, ohne die Schnitte im
 * Inneren mitzuzeichnen – dort soll das Bild ja durchgehend wirken.
 */
function cellEdgePaths(cut, r, c, puzzleW, puzzleH, depth, ox, oy) {
  const e = edgesOf(cut, r, c);
  const k = pieceCorners(cut, r, c, puzzleW, puzzleH);

  function kante(a, b, edge) {
    const pfad = new Path2D();
    pfad.moveTo(a.x - ox, a.y - oy);
    traceEdge(pfad, a.x - ox, a.y - oy, b.x - ox, b.y - oy, edge, depth);
    return pfad;
  }

  return {
    top: kante(k.tl, k.tr, e.top),
    right: kante(k.tr, k.br, e.right),
    bottom: kante(k.br, k.bl, e.bottom),
    left: kante(k.bl, k.tl, e.left),
  };
}

/* =====================================================================
   Figuren

   In alten Holzpuzzles versteckt der Schreiner einzelne Teile in Gestalt
   erkennbarer Dinge – ein Fisch, eine Katze, ein Stern –, die mit dem Motiv
   nichts zu tun haben. Genau das macht "Scuffed" hier nach.

   Eine Figur wird nicht aus dem Bild geschnitten, sondern in ein Teil
   hineingestanzt: Das umgebende Teil bekommt sie als Loch, die Figur selbst
   wird ein eigenes Teil. Beide teilen sich damit exakt dieselbe Kurve, und
   das Puzzle bleibt lückenlos.

   Die Punkte laufen im Uhrzeigersinn und sind auf 0..1 normiert.
   ===================================================================== */

const FIGUREN = {
  // seite = Breite zu Höhe. Doppelt aufgeführte Punkte ergeben eine Spitze:
  // Die weiche Kurve verrundet sonst genau die Merkmale, an denen man die
  // Figur erkennt – Ohren, Schwanzflosse, Schnabel.
  herz: { seite: 1.0, punkte: [
    [0.50, 0.24], [0.62, 0.06], [0.80, 0.04], [0.94, 0.16], [0.96, 0.36],
    [0.84, 0.60], [0.62, 0.83], [0.50, 0.99], [0.50, 0.99], [0.38, 0.83],
    [0.16, 0.60], [0.04, 0.36], [0.06, 0.16], [0.20, 0.04], [0.38, 0.06],
  ] },
  stern: { seite: 1.0, punkte: [
    [0.50, 0.01], [0.50, 0.01], [0.61, 0.33], [0.95, 0.35], [0.95, 0.35],
    [0.68, 0.55], [0.79, 0.92], [0.79, 0.92], [0.50, 0.70], [0.21, 0.92],
    [0.21, 0.92], [0.32, 0.55], [0.05, 0.35], [0.05, 0.35], [0.39, 0.33],
  ] },
  fisch: { seite: 1.7, punkte: [
    [0.02, 0.50], [0.02, 0.50], [0.14, 0.28], [0.34, 0.17], [0.55, 0.19],
    [0.70, 0.33], [0.78, 0.42], [0.98, 0.08], [0.98, 0.08], [0.86, 0.50],
    [0.98, 0.92], [0.98, 0.92], [0.78, 0.58], [0.70, 0.67], [0.55, 0.81],
    [0.34, 0.83], [0.14, 0.72],
  ] },
  katze: { seite: 0.85, punkte: [
    [0.30, 0.28], [0.22, 0.03], [0.22, 0.03], [0.42, 0.17], [0.58, 0.17],
    [0.78, 0.03], [0.78, 0.03], [0.70, 0.28], [0.80, 0.44], [0.74, 0.57],
    [0.83, 0.73], [0.87, 0.93], [0.70, 0.97], [0.36, 0.97], [0.26, 0.81],
    [0.23, 0.56], [0.22, 0.40],
  ] },
  hase: { seite: 0.72, punkte: [
    [0.30, 0.02], [0.30, 0.02], [0.38, 0.19], [0.44, 0.33], [0.52, 0.19],
    [0.60, 0.02], [0.60, 0.02], [0.67, 0.21], [0.67, 0.39], [0.79, 0.53],
    [0.87, 0.73], [0.88, 0.93], [0.66, 0.98], [0.34, 0.98], [0.17, 0.90],
    [0.15, 0.66], [0.27, 0.46], [0.28, 0.33],
  ] },
  mond: { seite: 0.78, punkte: [
    [0.54, 0.01], [0.54, 0.01], [0.80, 0.13], [0.95, 0.39], [0.95, 0.62],
    [0.80, 0.88], [0.54, 0.99], [0.54, 0.99], [0.67, 0.79], [0.71, 0.50],
    [0.67, 0.21],
  ] },
  blatt: { seite: 0.7, punkte: [
    [0.50, 0.01], [0.50, 0.01], [0.73, 0.21], [0.85, 0.47], [0.79, 0.72],
    [0.55, 0.95], [0.50, 1.00], [0.50, 1.00], [0.45, 0.95], [0.21, 0.72],
    [0.15, 0.47], [0.27, 0.21],
  ] },
  pilz: { seite: 0.95, punkte: [
    [0.50, 0.05], [0.73, 0.11], [0.91, 0.29], [0.95, 0.46], [0.95, 0.46],
    [0.71, 0.50], [0.67, 0.72], [0.72, 0.96], [0.50, 0.99], [0.28, 0.96],
    [0.33, 0.72], [0.29, 0.50], [0.05, 0.46], [0.05, 0.46], [0.09, 0.29],
    [0.27, 0.11],
  ] },
  haus: { seite: 0.95, punkte: [
    [0.50, 0.03], [0.50, 0.03], [0.95, 0.37], [0.95, 0.37], [0.80, 0.37],
    [0.80, 0.96], [0.80, 0.96], [0.60, 0.96], [0.60, 0.96], [0.60, 0.68],
    [0.40, 0.68], [0.40, 0.96], [0.40, 0.96], [0.20, 0.96], [0.20, 0.96],
    [0.20, 0.37], [0.05, 0.37], [0.05, 0.37],
  ] },
};

const FIGUR_NAMEN = Object.keys(FIGUREN);

/**
 * Baut den Umriss einer Figur als geschlossene, weiche Kurve.
 *
 * Die Figur wird formattreu in das angebotene Rechteck eingepasst und darin
 * mittig gesetzt – sonst würde eine Katze zur Qualle gestaucht.
 *
 * `rueckwaerts` dreht den Umlaufsinn um; dann wird aus der Fläche ein Loch,
 * denn die Nonzero-Regel hebt gegenläufige Umläufe auf.
 */
function figurPfad(name, x, y, w, h, ox, oy, rueckwaerts) {
  const figur = FIGUREN[name];
  let bw = w, bh = w / figur.seite;
  if (bh > h) { bh = h; bw = h * figur.seite; }
  const vx = x + (w - bw) / 2, vy = y + (h - bh) / 2;

  const punkte = [];
  for (let i = 0; i < figur.punkte.length; i++) {
    punkte.push([vx + figur.punkte[i][0] * bw - ox, vy + figur.punkte[i][1] * bh - oy]);
  }
  if (rueckwaerts) punkte.reverse();

  const n = punkte.length;
  const pfad = new Path2D();
  pfad.moveTo(punkte[0][0], punkte[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = punkte[(i - 1 + n) % n];
    const p1 = punkte[i];
    const p2 = punkte[(i + 1) % n];
    const p3 = punkte[(i + 2) % n];
    pfad.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]
    );
  }
  pfad.closePath();
  return pfad;
}

/** Das Rechteck, das eine Figur in dem angebotenen Feld tatsächlich einnimmt. */
function figurRechteck(name, x, y, w, h) {
  const figur = FIGUREN[name];
  let bw = w, bh = w / figur.seite;
  if (bh > h) { bh = h; bw = h * figur.seite; }
  return { x: x + (w - bw) / 2, y: y + (h - bh) / 2, w: bw, h: bh };
}

/* Wie weit eine Kantenform ausschlägt. Bezugsgröße ist die mittlere Zellgröße,
   nicht die einzelne Kante – sonst bekäme ein schmales Teil eine gestauchte
   Form und fiele aus der Reihe. */
function tabDepth(cellW, cellH, art) {
  return Math.min(cellW, cellH) * (art ? art.nasenTiefe : 0.24);
}

function overhang(cellW, cellH, art) {
  // Luft für Kopfbreite, Zeichenkante und die Schwankung der Formgröße.
  return Math.ceil(tabDepth(cellW, cellH, art) * (art ? art.ueberhang : 1.25));
}
