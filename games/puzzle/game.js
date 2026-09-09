"use strict";

/* =====================================================================
   Puzzle · Spiellogik und Oberfläche

   Erste Ausbaustufe: 200 Teile, mitgelieferte Motive. Gezeichnet wird auf
   einer Leinwand – bei 200 Teilen wären das ebenso viele DOM-Elemente mit
   Freiformzuschnitt, und das wird beim Ziehen zäh.
   ===================================================================== */

/* Wählbare Teilezahlen. Der erste Wert ist zugleich die Bezugsgröße für die
   Bildauflösung. */
const TEILE_STUFEN = [200, 500, 1000];

const SAVE_KEY = "puzzleSave";
const STATS_KEY = "puzzleStats";
const EIGEN_KEY = "puzzleEigeneBilder";
/* So viele eigene Bilder lassen sich gleichzeitig ablegen. */
const EIGEN_MAX = 3;
const DREH_KEY = "puzzleDrehmodus";
const SCHNITT_KEY = "puzzleSchnitt";

/* Größe des Puzzles in Tischkoordinaten. Die Teile werden in dieser
   Auflösung gestanzt; die Leinwand skaliert beim Zeichnen. */
const PUZZLE_BREITE = 1400;
const PUZZLE_BREITE_MAX = 2200;
/* So viele Zellen darf das Untergitter höchstens haben. */
const ZELLEN_MAX = 4200;
/* Ein hochgeladenes Bild wird auf dieses Maß gebracht, bevor es abgelegt wird –
   sonst sprengt eine Handykamera den Speicher des Browsers. */
const EIGEN_BREITE_MAX = 2000;
/* So weit neben einem Teil darf man klicken und greift es trotzdem noch –
   in Bildschirmpixeln, damit die Nachsicht beim Zoomen gleich bleibt. */
const GREIF_TOLERANZ = 8;
/* So nah muss ein Teil an seinem Nachbarn liegen, damit es einrastet –
   gemessen als Anteil der kürzeren Zellenseite. */
const RASTER_TOLERANZ = 0.14;
/* So nah muss ein Teil an seinem Platz im Rahmen liegen, damit es einrastet. */
const RAHMEN_TOLERANZ = 0.15;
/* So lange blendet eine gerade verschwundene Schnittlinie noch aus. */
const NAHT_FADE_MS = 380;
/* Farbe und Stärke der Schnittlinien – gilt für Teile wie für Verbundkonturen. */
const KANTEN_FARBE = "rgba(0,0,0,0.38)";
const KANTEN_BREITE = 1.2;

let game = null;
let ctx = null;
let canvas = null;
/* Nur für isPointInPath – braucht einen Zeichenkontext, aber keine Fläche. */
const pruefContext = document.createElement("canvas").getContext("2d");
let timerInterval = null;
let elapsedSeconds = 0;

/* ---------------------------------------------------------------
   Speicher
   --------------------------------------------------------------- */

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* egal */ }
  return {};
}

function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* egal */ }
}

/* Gezählt wird je Teilezahl, nicht je Motiv: Wie schnell jemand ist, hängt
   an der Größe des Puzzles, nicht am Bild. */
function statsFuer(teile) {
  const s = loadStats();
  return s[String(teile)] || { played: 0, won: 0, best: null };
}

function recordPlayed(teile) {
  const s = loadStats();
  const e = s[String(teile)] || { played: 0, won: 0, best: null };
  e.played += 1;
  s[String(teile)] = e;
  saveStats(s);
}

function recordWon(teile, seconds) {
  const s = loadStats();
  const e = s[String(teile)] || { played: 0, won: 0, best: null };
  e.won += 1;
  if (e.best === null || seconds < e.best) e.best = seconds;
  s[String(teile)] = e;
  saveStats(s);
}

function saveGame() {
  if (!game || game.fertig) return;
  try {
    // Nur was sich nicht wiederherstellen lässt: Saat, Motiv, Lage und Gruppen.
    const lagen = new Array(game.pieces.length * 5);
    for (let i = 0; i < game.pieces.length; i++) {
      const p = game.pieces[i];
      lagen[i * 5] = Math.round(p.x);
      lagen[i * 5 + 1] = Math.round(p.y);
      lagen[i * 5 + 2] = findGroup(i);
      lagen[i * 5 + 3] = p.locked ? 1 : 0;
      lagen[i * 5 + 4] = p.rot;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      bildId: game.bildId,
      seed: game.seed,
      cols: game.cols,
      rows: game.rows,
      lagen: lagen,
      teile: game.pieces.length,
      reihenfolge: game.order,
      elapsedSeconds: elapsedSeconds,
      drehmodus: game.drehmodus,
      ziel: game.ziel,
      art: game.art,
      rand: game.frameX,
    }));
  } catch (e) { /* egal */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (!s || !s.bildId || !Array.isArray(s.lagen)) return null;
    if (!motivEintrag(s.bildId)) return null;
    // Fünf Werte je Teil: Lage, Gruppe, Feststellung, Drehung. Bei verwachsenen
    // Teilen entspricht die Zahl nicht mehr dem Raster, deshalb wird sie
    // mitgespeichert. Ältere Stände passen nicht mehr.
    if (!s.teile || s.lagen.length !== s.teile * 5) return null;
    return s;
  } catch (e) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* egal */ }
}

/* ---------------------------------------------------------------
   Uhr
   --------------------------------------------------------------- */

function formatTime(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function startTimer(initial) {
  stopTimer();
  elapsedSeconds = initial || 0;
  updateTimer();
  timerInterval = setInterval(function () {
    elapsedSeconds += 1;
    updateTimer();
    saveGame();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateTimer() {
  const el = document.getElementById("timer");
  if (el) el.textContent = formatTime(elapsedSeconds);
}

/* ---------------------------------------------------------------
   Gruppen (Union-Find)

   Zusammengesteckte Teile wandern gemeinsam. Die Struktur beantwortet
   schnell, ob zwei Teile schon verbunden sind.
   --------------------------------------------------------------- */

function findGroup(i) {
  let r = i;
  while (game.parent[r] !== r) r = game.parent[r];
  // Pfad verkürzen
  while (game.parent[i] !== r) { const n = game.parent[i]; game.parent[i] = r; i = n; }
  return r;
}

function unionGroups(a, b) {
  const ra = findGroup(a), rb = findGroup(b);
  if (ra === rb) return false;
  game.parent[rb] = ra;
  return true;
}

function piecesOfGroup(root) {
  const out = [];
  for (let i = 0; i < game.pieces.length; i++) if (findGroup(i) === root) out.push(i);
  return out;
}

/* ---------------------------------------------------------------
   Aufbau
   --------------------------------------------------------------- */

function ladeBild(datei) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error("Bild nicht ladbar: " + datei)); };
    img.src = datei;
  });
}

/** Stanzt alle Teile aus dem Bild und legt sie auf dem Tisch aus. */
/**
 * Lässt aus einem feinen Untergitter die Teile wachsen.
 *
 * Bei den klassischen Schnitten ist jede Zelle ein Teil. Bei "Scuffed" ist das
 * Gitter mehrfach feiner, und jedes Teil wächst aus einer Saatzelle heraus –
 * je nach Wuchsform lang und schmal, schlängelnd, rundlich oder als Klotz.
 * Erst dadurch entstehen Formen, die mit einem Raster nichts mehr zu tun
 * haben; die Schnittlinien selbst bleiben aber Gitterkanten, und nur deshalb
 * passen die Teile weiterhin exakt zusammen.
 *
 * Die Zahl der Regionen ist die Wunschzahl – gesät wird genau so oft.
 */
function wachseRegionen(cols, rows, seed, art, zielTeile, wirte) {
  const anzahl = cols * rows;
  const zuTeil = new Int32Array(anzahl).fill(-1);

  if (art.zellenProTeil <= 1) {
    // Ein Teil je Zelle – nichts zu wachsen.
    const teile = [];
    for (let i = 0; i < anzahl; i++) {
      zuTeil[i] = i;
      teile.push([{ r: Math.floor(i / cols), c: i % cols }]);
    }
    return { teile: teile, zuTeil: zuTeil };
  }

  // Eigene Saat, damit dieselbe Partie später identisch entsteht.
  const rnd = makeRandom((seed ^ 0x9e3779b9) >>> 0);
  const formen = [];
  for (const name in art.formen) {
    for (let i = 0; i < art.formen[name]; i++) formen.push(name);
  }

  function nachbarn(i) {
    const r = Math.floor(i / cols), c = i % cols;
    const l = [];
    if (r > 0) l.push(i - cols);
    if (r < rows - 1) l.push(i + cols);
    if (c > 0) l.push(i - 1);
    if (c < cols - 1) l.push(i + 1);
    return l;
  }

  // Saatzellen streuen
  const reihenfolge = [];
  for (let i = 0; i < anzahl; i++) reihenfolge.push(i);
  for (let i = reihenfolge.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = reihenfolge[i]; reihenfolge[i] = reihenfolge[j]; reihenfolge[j] = t;
  }

  const mittel = art.zellenProTeil;
  const regionen = [];
  for (let k = 0; k < zielTeile && k < anzahl; k++) {
    // Die ersten Regionen werden bewusst groß und rundlich: Nur solche haben
    // eine Zelle, deren sämtliche acht Nachbarn dazugehören – und nur dort
    // lässt sich später eine Figur unterbringen.
    const wirt = k < (wirte || 0);
    const form = wirt ? "klotz" : formen[Math.floor(rnd() * formen.length)];
    // Zielgröße je Form – der Klotz darf deutlich größer werden, das
    // Kompakte bleibt klein. So entsteht auch in der Größe Bandbreite.
    let ziel = mittel;
    if (form === "lang") ziel = Math.round(mittel * (1.0 + rnd() * 0.9));
    else if (form === "schlange") ziel = Math.round(mittel * (0.9 + rnd() * 1.1));
    else if (form === "kompakt") ziel = Math.round(mittel * (0.4 + rnd() * 0.7));
    else ziel = Math.round(mittel * (1.6 + rnd() * 1.2));
    if (wirt) ziel = Math.max(ziel, Math.round(mittel * 3.2), 18);

    const saat = reihenfolge[k];
    zuTeil[saat] = k;
    regionen.push({
      zellen: [saat],
      form: form,
      ziel: Math.max(1, ziel),
      letzte: saat,
      // Vorzugsrichtung der langen Teile: waagerecht oder senkrecht
      achse: rnd() < 0.5 ? 1 : cols,
    });
  }

  /** Freie Nachbarzellen einer Region, nach Wuchsform gewichtet. */
  function waehleZelle(reg) {
    if (reg.form === "schlange") {
      // Nur vom zuletzt angebauten Ende aus weiter – das mäandert.
      const frei = nachbarn(reg.letzte).filter(function (n) { return zuTeil[n] === -1; });
      if (frei.length) return frei[Math.floor(rnd() * frei.length)];
    }

    const frei = [];
    for (let k = 0; k < reg.zellen.length; k++) {
      const nb = nachbarn(reg.zellen[k]);
      for (let n = 0; n < nb.length; n++) {
        if (zuTeil[nb[n]] === -1) frei.push({ zelle: nb[n], von: reg.zellen[k] });
      }
    }
    if (!frei.length) return -1;

    if (reg.form === "lang") {
      // Bevorzugt entlang der eigenen Achse – daraus werden schmale Bänder.
      const passend = frei.filter(function (f) {
        return Math.abs(f.zelle - f.von) === reg.achse;
      });
      const menge = passend.length ? passend : frei;
      return menge[Math.floor(rnd() * menge.length)].zelle;
    }

    if (reg.form === "kompakt" || reg.form === "klotz") {
      // Die Zelle mit den meisten eigenen Nachbarn füllt Buchten auf und
      // hält die Form rundlich.
      let beste = -1, bestZahl = -1;
      for (let k = 0; k < frei.length; k++) {
        const nb = nachbarn(frei[k].zelle);
        let eigene = 0;
        for (let n = 0; n < nb.length; n++) if (zuTeil[nb[n]] === reg.nummer) eigene++;
        if (eigene > bestZahl || (eigene === bestZahl && rnd() < 0.3)) {
          bestZahl = eigene; beste = frei[k].zelle;
        }
      }
      return beste;
    }

    return frei[Math.floor(rnd() * frei.length)].zelle;
  }

  for (let k = 0; k < regionen.length; k++) regionen[k].nummer = k;

  // Die Wirtsregionen zuerst und ungestört wachsen lassen. Konkurrieren sie
  // von Anfang an mit allen anderen, werden sie eingekesselt, bevor sie einen
  // vollständig umschlossenen Innenbereich haben – und ohne den lässt sich
  // keine Figur unterbringen.
  const anzahlWirte = Math.min(wirte || 0, regionen.length);
  let wachsen = true;
  while (wachsen) {
    wachsen = false;
    for (let k = 0; k < anzahlWirte; k++) {
      const reg = regionen[k];
      if (reg.zellen.length >= reg.ziel) continue;
      const zelle = waehleZelle(reg);
      if (zelle < 0) continue;
      zuTeil[zelle] = k;
      reg.zellen.push(zelle);
      reg.letzte = zelle;
      wachsen = true;
    }
  }

  // Reihum wachsen, bis niemand mehr kann oder will.
  let weiter = true;
  while (weiter) {
    weiter = false;
    for (let k = 0; k < regionen.length; k++) {
      const reg = regionen[k];
      if (reg.zellen.length >= reg.ziel) continue;
      const zelle = waehleZelle(reg);
      if (zelle < 0) continue;
      zuTeil[zelle] = k;
      reg.zellen.push(zelle);
      reg.letzte = zelle;
      weiter = true;
    }
  }

  // Reste anschließen: Was übrig bleibt, geht an eine angrenzende Region.
  let offen = true;
  while (offen) {
    offen = false;
    for (let i = 0; i < anzahl; i++) {
      if (zuTeil[i] !== -1) continue;
      const nb = nachbarn(i);
      let ziel = -1;
      for (let n = 0; n < nb.length; n++) {
        if (zuTeil[nb[n]] !== -1) { ziel = zuTeil[nb[n]]; break; }
      }
      if (ziel < 0) { offen = true; continue; }
      zuTeil[i] = ziel;
      regionen[ziel].zellen.push(i);
    }
  }

  const teile = regionen.map(function (reg) {
    return reg.zellen.map(function (i) {
      return { r: Math.floor(i / cols), c: i % cols };
    });
  });
  return { teile: teile, zuTeil: zuTeil };
}

/**
 * Sucht Regionen, in die sich eine Figur stanzen lässt, und wählt sie aus.
 *
 * Die Figur muss vollständig im Inneren ihrer Region liegen – sonst ragte sie
 * in den Nachbarn und das Puzzle hätte ein Loch. Als Feld dient deshalb der
 * 3×3-Block um eine Zelle, deren sämtliche acht Nachbarn zur selben Region
 * gehören, eingerückt um mehr als die tiefste Kantenform. Damit kann keine
 * Nase von außen in das Feld hineinreichen.
 */
function waehleFiguren(bau, cut, cols, rows, puzzleW, puzzleH, anzahl, seed, mittleresMass) {
  if (anzahl <= 0) return [];
  const rnd = makeRandom((seed ^ 0x85ebca6b) >>> 0);
  const einrueckung = mittleresMass * 0.45;

  const kandidaten = [];
  for (let t = 0; t < bau.teile.length; t++) {
    const drin = {};
    for (let k = 0; k < bau.teile[t].length; k++) {
      drin[bau.teile[t][k].r * cols + bau.teile[t][k].c] = true;
    }
    for (let k = 0; k < bau.teile[t].length; k++) {
      const r = bau.teile[t][k].r, c = bau.teile[t][k].c;
      if (r < 1 || c < 1 || r > rows - 2 || c > cols - 2) continue;
      let tief = true;
      for (let dr = -1; dr <= 1 && tief; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!drin[(r + dr) * cols + (c + dc)]) { tief = false; break; }
        }
      }
      if (!tief) continue;

      // Feld: der 3×3-Block, eingerückt.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const e = pieceCorners(cut, r + dr, c + dc, puzzleW, puzzleH);
          const ecken = [e.tl, e.tr, e.br, e.bl];
          for (let i = 0; i < 4; i++) {
            x0 = Math.min(x0, ecken[i].x); x1 = Math.max(x1, ecken[i].x);
            y0 = Math.min(y0, ecken[i].y); y1 = Math.max(y1, ecken[i].y);
          }
        }
      }
      x0 += einrueckung; y0 += einrueckung;
      x1 -= einrueckung; y1 -= einrueckung;
      if (x1 - x0 < mittleresMass * 0.8 || y1 - y0 < mittleresMass * 0.8) continue;

      kandidaten.push({ teil: t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      break;   // eine Figur je Region genügt
    }
  }

  // Mischen und die vordersten nehmen – so verteilen sie sich übers Bild.
  for (let i = kandidaten.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = kandidaten[i]; kandidaten[i] = kandidaten[j]; kandidaten[j] = t;
  }
  const gewaehlt = kandidaten.slice(0, anzahl);
  for (let i = 0; i < gewaehlt.length; i++) {
    gewaehlt[i].name = FIGUR_NAMEN[Math.floor(rnd() * FIGUR_NAMEN.length)];
  }
  return gewaehlt;
}

async function baueTeile(img, cut, cols, rows, puzzleW, puzzleH, zielTeile, melde) {
  // Bezugsgroesse fuer Nasentiefe und Toleranzen ist die MITTLERE Zellgroesse -
  // die einzelnen Teile weichen davon bewusst ab.
  const cellW = puzzleW / cols;
  const cellH = puzzleH / rows;
  const ov = overhang(cellW, cellH, cut.art);
  const depth = tabDepth(cellW, cellH, cut.art);

  // Bildausschnitt je Teil - im Bild gerechnet, damit die Nasen mitkommen.
  const skalaX = img.naturalWidth / puzzleW;
  const skalaY = img.naturalHeight / puzzleH;
  // Aufloesung der Belegungsmaske: fein genug, um Nasen und Buchten aufzuloesen,
  // grob genug, um beim Ablegen billig zu bleiben.
  const maskZelle = Math.max(2, Math.round(Math.min(cellW, cellH) / 22));

  // Jede Figur wird ein eigenes Teil, also entsprechend weniger Regionen säen.
  // Wirtsregionen brauchen viele Zellen; passen nicht so viele ins Gitter,
  // gibt es entsprechend weniger Figuren.
  let figurenZahl = Math.round(zielTeile * cut.art.figuren);
  figurenZahl = Math.max(0, Math.min(figurenZahl,
    Math.floor((cols * rows - 2 * zielTeile) / 17)));

  // Zwei Anläufe: Findet der erste weniger Wirtsregionen als geplant, fehlen
  // ebenso viele Teile. Der zweite sät dann entsprechend mehr Regionen.
  let bau = null, figuren = null;
  for (let anlauf = 0; anlauf < 2; anlauf++) {
    bau = wachseRegionen(cols, rows, cut.seed, cut.art, zielTeile - figurenZahl, figurenZahl);
    figuren = waehleFiguren(bau, cut, cols, rows, puzzleW, puzzleH,
                            figurenZahl, cut.seed, Math.min(cellW, cellH));
    if (figuren.length >= figurenZahl) break;
    figurenZahl = figuren.length;
  }
  const figurZuTeil = {};
  for (let f = 0; f < figuren.length; f++) figurZuTeil[figuren[f].teil] = figuren[f];

  const teile = [];
  let seitLetztemLuftholen = performance.now();

  for (let t = 0; t < bau.teile.length; t++) {
    const zellen = bau.teile[t];

    // Ursprung: linke obere Ecke aller beteiligten Zellecken.
    let ox = Infinity, oy = Infinity;
    for (let z = 0; z < zellen.length; z++) {
      const k = pieceCorners(cut, zellen[z].r, zellen[z].c, puzzleW, puzzleH);
      ox = Math.min(ox, k.tl.x, k.tr.x, k.br.x, k.bl.x);
      oy = Math.min(oy, k.tl.y, k.tr.y, k.br.y, k.bl.y);
    }

    // Umriss: alle Zellen in einem Pfad. Innere Schnittlinien gibt es damit
    // gar nicht erst - die Nonzero-Regel vereinigt die Zellen exakt.
    const pfad = new Path2D();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let z = 0; z < zellen.length; z++) {
      const zr = zellen[z].r, zc = zellen[z].c;
      pfad.addPath(cellPath(cut, zr, zc, puzzleW, puzzleH, depth, ox, oy));
      const k = pieceCorners(cut, zr, zc, puzzleW, puzzleH);
      const ecken = [k.tl, k.tr, k.br, k.bl];
      for (let e = 0; e < 4; e++) {
        minX = Math.min(minX, ecken[e].x - ox);
        maxX = Math.max(maxX, ecken[e].x - ox);
        minY = Math.min(minY, ecken[e].y - oy);
        maxY = Math.max(maxY, ecken[e].y - oy);
      }
    }

    // Beherbergt die Region eine Figur, wird sie als gegenläufiger Umlauf
    // in den Pfad gelegt: Damit fällt sie als Loch heraus.
    const figur = figurZuTeil[t];
    if (figur) {
      pfad.addPath(figurPfad(figur.name, figur.x, figur.y, figur.w, figur.h, ox, oy, true));
    }

    const bx = Math.floor(minX - ov), by = Math.floor(minY - ov);
    const bw = Math.ceil(maxX + ov) - bx, bh = Math.ceil(maxY + ov) - by;

    const cv = document.createElement("canvas");
    cv.width = bw; cv.height = bh;
    const g = cv.getContext("2d");

    // Nach der Verschiebung entsprechen die Leinwandkoordinaten genau den
    // Teilkoordinaten - der Ursprung liegt bei (0,0).
    g.save();
    g.translate(-bx, -by);
    g.clip(pfad);
    g.drawImage(
      img,
      (ox + bx) * skalaX, (oy + by) * skalaY,
      bw * skalaX, bh * skalaY,
      bx, by, bw, bh
    );
    g.restore();

    // Der Umriss wird aufbewahrt: Der Treffertest arbeitet damit rein
    // geometrisch. Pixel auszulesen waere nicht nur langsamer - es scheitert,
    // sobald die Leinwand als fremdherkunft-verunreinigt gilt, etwa wenn die
    // Seite ueber file:// geoeffnet wird.
    teile.push({
      zellen: zellen,
      ox: ox, oy: oy,           // Platz im fertigen Bild
      x: 0, y: 0,               // Platz auf dem Tisch
      rot: 0,                   // Vielfaches von 90 Grad
      cv: cv,
      bx: bx, by: by, bw: bw, bh: bh,   // Leinwand relativ zum Ursprung
      w: maxX - minX, h: maxY - minY,   // Kernmass ohne Nasen
      mx: (minX + maxX) / 2, my: (minY + maxY) / 2,
      path: pfad, locked: false,
      grenzen: {},              // gemeinsame Kanten je Nachbarteil
      rand: [],                 // Kanten am Bildrand
      nachbarn: [],
    });

    if (performance.now() - seitLetztemLuftholen > 60) {
      if (melde) melde(teile.length, bau.teile.length);
      await new Promise(function (f) { setTimeout(f, 0); });
      seitLetztemLuftholen = performance.now();
    }
  }

  // Die Figuren selbst werden eigene Teile. Sie haben keine Rasterzellen –
  // ihr einziger Nachbar ist das Teil, aus dem sie gestanzt wurden.
  for (let f = 0; f < figuren.length; f++) {
    const fig = figuren[f];
    const rechteck = figurRechteck(fig.name, fig.x, fig.y, fig.w, fig.h);
    const ox = rechteck.x, oy = rechteck.y;
    const pfad = figurPfad(fig.name, fig.x, fig.y, fig.w, fig.h, ox, oy, false);

    const bx = Math.floor(-ov), by = Math.floor(-ov);
    const bw = Math.ceil(rechteck.w + ov) - bx, bh = Math.ceil(rechteck.h + ov) - by;
    const cv = document.createElement("canvas");
    cv.width = bw; cv.height = bh;
    const g = cv.getContext("2d");
    g.save();
    g.translate(-bx, -by);
    g.clip(pfad);
    g.drawImage(
      img,
      (ox + bx) * skalaX, (oy + by) * skalaY,
      bw * skalaX, bh * skalaY,
      bx, by, bw, bh
    );
    g.restore();

    teile.push({
      zellen: [],
      figur: fig.name,
      ox: ox, oy: oy,
      x: 0, y: 0,
      rot: 0,
      cv: cv,
      bx: bx, by: by, bw: bw, bh: bh,
      w: rechteck.w, h: rechteck.h,
      mx: rechteck.w / 2, my: rechteck.h / 2,
      path: pfad, locked: false,
      grenzen: {}, rand: [], nachbarn: [],
      wirt: fig.teil,
    });
  }

  baueGrenzen(teile, bau.zuTeil, cut, cols, rows, puzzleW, puzzleH, depth);

  // Figur und Wirt teilen sich genau eine Kurve – die Silhouette.
  for (let i = 0; i < teile.length; i++) {
    const p = teile[i];
    if (p.wirt === undefined) continue;
    const wirt = teile[p.wirt];
    const fig = figurZuTeil[p.wirt];
    p.grenzen[p.wirt] = [figurPfad(fig.name, fig.x, fig.y, fig.w, fig.h, p.ox, p.oy, false)];
    p.nachbarn.push(p.wirt);
    wirt.grenzen[i] = [figurPfad(fig.name, fig.x, fig.y, fig.w, fig.h, wirt.ox, wirt.oy, false)];
    wirt.nachbarn.push(i);
  }

  for (let i = 0; i < teile.length; i++) {
    // Die Kontur eines Teils ist alles, was es an Kanten nach aussen hat.
    teile[i].kontur = teile[i].rand.slice();
    for (const j in teile[i].grenzen) {
      const pfade = teile[i].grenzen[j];
      for (let k = 0; k < pfade.length; k++) teile[i].kontur.push(pfade[k]);
    }
    // Feine Kante, damit die Teile sich voneinander abheben
    const g = teile[i].cv.getContext("2d");
    g.save();
    g.translate(-teile[i].bx, -teile[i].by);
    g.strokeStyle = KANTEN_FARBE;
    g.lineWidth = KANTEN_BREITE;
    for (let k = 0; k < teile[i].kontur.length; k++) g.stroke(teile[i].kontur[k]);
    g.restore();
  }

  baueMasken(teile, maskZelle);
  return { teile: teile, cellW: cellW, cellH: cellH, ov: ov, depth: depth, maskZelle: maskZelle };
}

/**
 * Ermittelt fuer jedes Teil, an welchen Kanten es an welches Nachbarteil stoesst.
 *
 * Damit ersetzt eine Nachbarschaftsliste die feste Vorstellung von oben,
 * unten, links und rechts: Ein Teil aus mehreren Zellen hat mehr Kanten, und
 * an derselben Seite koennen auch mehrere davon zum selben Nachbarn gehoeren.
 */
function baueGrenzen(teile, zuTeil, cut, cols, rows, puzzleW, puzzleH, depth) {
  const RICHTUNGEN = [
    { dr: -1, dc: 0, seite: "top" },
    { dr: 1, dc: 0, seite: "bottom" },
    { dr: 0, dc: -1, seite: "left" },
    { dr: 0, dc: 1, seite: "right" },
  ];

  for (let i = 0; i < teile.length; i++) {
    const p = teile[i];
    for (let z = 0; z < p.zellen.length; z++) {
      const zr = p.zellen[z].r, zc = p.zellen[z].c;
      const kanten = cellEdgePaths(cut, zr, zc, puzzleW, puzzleH, depth, p.ox, p.oy);
      for (let d = 0; d < RICHTUNGEN.length; d++) {
        const nr = zr + RICHTUNGEN[d].dr, nc = zc + RICHTUNGEN[d].dc;
        const pfad = kanten[RICHTUNGEN[d].seite];
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) { p.rand.push(pfad); continue; }
        const j = zuTeil[nr * cols + nc];
        if (j === i) continue;                       // Naht im Inneren des Teils
        if (!p.grenzen[j]) { p.grenzen[j] = []; p.nachbarn.push(j); }
        p.grenzen[j].push(pfad);
      }
    }
  }
}

/* ---------------------------------------------------------------
   Belegungsmasken

   Zum dichten Ablegen genügt das Hüllrechteck eines Teils nicht: Die Nasen
   ragen an allen vier Seiten heraus, belegen dort aber nur die Mitte der
   Kante. Wer Rechtecke aneinanderlegt, verschenkt deshalb mehr als die
   Hälfte der Fläche. Stattdessen bekommt jedes Teil eine grobe Maske seiner
   tatsächlichen Form; damit lassen sich die Teile verzahnen und trotzdem
   sicher auf Überlappung prüfen.

   Die Maske entsteht rein aus dem Umriss – gefüllt wird ein Pfad, kein Bild.
   Ein Auslesen der Leinwand ist dadurch auch dann erlaubt, wenn die Seite
   über file:// geöffnet wurde.
   --------------------------------------------------------------- */

/**
 * Baut die Masken aller Teile.
 *
 * Gezeichnet wird auf Sammelblättern statt auf tausend Einzelleinwänden: Das
 * Auslesen einer Leinwand kostet je Aufruf spürbar, unabhängig von der Größe.
 * Gebündelt sind es ein paar Aufrufe statt einer je Teil (gemessen 2,7 s
 * gegenüber 0,2 s bei 1000 Teilen).
 */
function baueMasken(teile, zelle) {
  if (!teile.length) return;

  const masse = [];
  let maxW = 0, maxH = 0;
  for (let i = 0; i < teile.length; i++) {
    // Ein Zellenrand ringsum: Platz für die Aufweitung.
    const w = Math.ceil(teile[i].bw / zelle) + 2;
    const h = Math.ceil(teile[i].bh / zelle) + 2;
    masse.push({ w: w, h: h });
    if (w > maxW) maxW = w;
    if (h > maxH) maxH = h;
  }

  const spalten = Math.max(1, Math.floor(1600 / maxW));
  const zeilen = Math.max(1, Math.floor(1600 / maxH));
  const proBlatt = spalten * zeilen;
  const cv = document.createElement("canvas");
  cv.width = spalten * maxW;
  cv.height = zeilen * maxH;
  const g = cv.getContext("2d");

  for (let start = 0; start < teile.length; start += proBlatt) {
    const ende = Math.min(teile.length, start + proBlatt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000";
    for (let i = start; i < ende; i++) {
      const k = i - start;
      const sx = (k % spalten) * maxW, sy = Math.floor(k / spalten) * maxH;
      const p = teile[i];
      g.setTransform(1 / zelle, 0, 0, 1 / zelle, sx + 1 - p.bx / zelle, sy + 1 - p.by / zelle);
      g.fill(p.path);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    const blatt = g.getImageData(0, 0, cv.width, cv.height).data;

    for (let i = start; i < ende; i++) {
      const k = i - start;
      const sx = (k % spalten) * maxW, sy = Math.floor(k / spalten) * maxH;
      teile[i].maske = maskeAusBlatt(blatt, cv.width, sx, sy, masse[i].w, masse[i].h,
                                     teile[i].bx, teile[i].by, zelle);
    }
  }
}

/** Schneidet eine Maske aus dem Sammelblatt und weitet sie um eine Zelle auf. */
function maskeAusBlatt(blatt, blattBreite, sx, sy, w, h, bx, by, zelle) {
  const daten = new Uint8Array(w * h);
  // Aufweiten: So bleibt zwischen zwei Teilen immer etwas Luft, statt dass sie
  // sich auf den Pixel genau berühren.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (blatt[((sy + y) * blattBreite + (sx + x)) * 4 + 3] <= 8) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          daten[ny * w + nx] = 1;
        }
      }
    }
  }
  return { w: w, h: h, ox: bx - zelle, oy: by - zelle, daten: daten };
}

/** Dieselbe Maske um ein Vielfaches von 90 Grad gedreht. */
function dreheMaske(m, rot, zelle) {
  rot = ((rot % 4) + 4) % 4;
  if (rot === 0) return m;

  const quer = rot % 2 === 1;
  const w = quer ? m.h : m.w;
  const h = quer ? m.w : m.h;
  const daten = new Uint8Array(w * h);

  // Ecken der Maske mitdrehen, um den neuen Ursprung zu finden.
  const a = drehe(m.ox, m.oy, rot);
  const b = drehe(m.ox + m.w * zelle, m.oy + m.h * zelle, rot);
  const ox = Math.min(a.x, b.x), oy = Math.min(a.y, b.y);

  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.daten[y * m.w + x]) continue;
      let nx, ny;
      if (rot === 1) { nx = m.h - 1 - y; ny = x; }
      else if (rot === 2) { nx = m.w - 1 - x; ny = m.h - 1 - y; }
      else { nx = y; ny = m.w - 1 - x; }
      daten[ny * w + nx] = 1;
    }
  }
  return { w: w, h: h, ox: ox, oy: oy, daten: daten };
}

/** Die Maske eines Teils in seiner aktuellen Ausrichtung. */
function teilMaske(p) {
  if (!p.maskeLagen) p.maskeLagen = {};
  if (!p.maskeLagen[p.rot]) p.maskeLagen[p.rot] = dreheMaske(p.maske, p.rot, game.maskZelle);
  return p.maskeLagen[p.rot];
}

/** Mittelpunkt der Maske eines Teils auf dem Tisch. */
function maskenMitte(p) {
  const m = teilMaske(p);
  const z = game.maskZelle;
  return { x: p.x + m.ox + m.w * z / 2, y: p.y + m.oy + m.h * z / 2 };
}

/* ---------------------------------------------------------------
   Drehung

   Ein gedrehtes Teil behält seine Lage im Bild; gedreht wird um seinen
   eigenen Ursprung. Dadurch bleibt der Abstand zweier Nachbarn auch im
   gedrehten Verbund berechenbar: Er ist schlicht der gedrehte Sollabstand.
   --------------------------------------------------------------- */

/** Dreht einen Vektor um ein Vielfaches von 90 Grad im Uhrzeigersinn. */
function drehe(x, y, rot) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return { x: -y, y: x };
    case 2: return { x: -x, y: -y };
    case 3: return { x: y, y: -x };
    default: return { x: x, y: y };
  }
}

/** Rechnet einen Tischpunkt in die ungedrehten Koordinaten eines Teils um. */
function zuTeil(p, tx, ty) {
  return drehe(tx - p.x, ty - p.y, -p.rot);
}

/* ---------------------------------------------------------------
   Verbundbilder

   Zusammenhängende Teile werden nicht einzeln gezeichnet, sondern als ein
   Bild: jedes Mitglied wird in dieselbe Leinwand gestanzt. Die Schnitte im
   Inneren verschwinden dadurch vollständig – nicht nur die Linie, auch der
   feine Spalt, den zwei getrennt gezeichnete Kanten sonst hinterlassen.
   Gezeichnet wird nur noch die Außenkontur.
   --------------------------------------------------------------- */

/**
 * Stanzt eine ganze Teilemenge in einem Zug in eine Leinwand.
 *
 * Entscheidend ist, dass alle Umrisse zu EINEM Beschnittpfad zusammengelegt
 * werden. Stanzte man Teil für Teil, träfen an jeder Naht zwei weiche Kanten
 * aufeinander, deren Deckkraft sich nicht zu voller Deckung ergänzt – der
 * Tisch schimmerte als feine Linie durch. Als ein Pfad gibt es die inneren
 * Kanten schlicht nicht.
 *
 * offX/offY geben an, welcher Punkt des Bildes links oben auf der Leinwand liegt.
 */
function stanzeVerbund(g, mitglieder, offX, offY, breite, hoehe) {
  const umriss = new Path2D();
  for (let k = 0; k < mitglieder.length; k++) {
    const p = game.pieces[mitglieder[k]];
    umriss.addPath(p.path, new DOMMatrix().translate(p.ox - offX, p.oy - offY));
  }

  const skalaX = game.bild.naturalWidth / game.puzzleW;
  const skalaY = game.bild.naturalHeight / game.puzzleH;
  g.save();
  g.clip(umriss);
  g.drawImage(
    game.bild,
    offX * skalaX, offY * skalaY,
    breite * skalaX, hoehe * skalaY,
    0, 0, breite, hoehe
  );
  g.restore();
}

/**
 * Die Kanten eines Teils, die nach außerhalb der Gruppe zeigen.
 *
 * Das ist der Bildrand plus alle Grenzen zu Nachbarn, die nicht dazugehören.
 */
function aussenKanten(i, drin) {
  const p = game.pieces[i];
  const pfade = p.rand.slice();
  for (let k = 0; k < p.nachbarn.length; k++) {
    const j = p.nachbarn[k];
    if (drin[j]) continue;
    const teil = p.grenzen[j];
    for (let t = 0; t < teil.length; t++) pfade.push(teil[t]);
  }
  return pfade;
}

/** Alle Kanten, an denen sich zwei Teilemengen berühren – von beiden Seiten. */
function nahtKanten(mengeA, mengeB) {
  const kanten = [];
  for (const schluessel in mengeA) {
    const i = Number(schluessel);
    const p = game.pieces[i];
    for (let k = 0; k < p.nachbarn.length; k++) {
      const j = p.nachbarn[k];
      if (!mengeB[j]) continue;
      kanten.push({ i: i, pfade: p.grenzen[j] });
      kanten.push({ i: j, pfade: game.pieces[j].grenzen[i] });
    }
  }
  return kanten;
}

/** Hilfsmenge: Index -> true für eine Teileliste. */
function alsMenge(liste) {
  const m = {};
  for (let k = 0; k < liste.length; k++) m[liste[k]] = true;
  return m;
}

/** Umschließendes Rechteck einer Teilemenge im Bildkoordinatensystem. */
function bildAusschnitt(mitglieder) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < mitglieder.length; k++) {
    const p = game.pieces[mitglieder[k]];
    if (p.ox + p.bx < minX) minX = p.ox + p.bx;
    if (p.oy + p.by < minY) minY = p.oy + p.by;
    if (p.ox + p.bx + p.bw > maxX) maxX = p.ox + p.bx + p.bw;
    if (p.oy + p.by + p.bh > maxY) maxY = p.oy + p.by + p.bh;
  }
  return { x: minX, y: minY, w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY) };
}

/**
 * Baut das Bild eines losen Verbunds neu auf. Einzelne Teile brauchen keines –
 * für die genügt die beim Stanzen angelegte Leinwand.
 */
function baueVerbundBild(wurzel) {
  const mitglieder = piecesOfGroup(wurzel);
  if (mitglieder.length < 2) { delete game.verbundBilder[wurzel]; return; }

  const drin = alsMenge(mitglieder);
  const aus = bildAusschnitt(mitglieder);
  const cv = document.createElement("canvas");
  cv.width = aus.w; cv.height = aus.h;
  const g = cv.getContext("2d");

  stanzeVerbund(g, mitglieder, aus.x, aus.y, aus.w, aus.h);

  g.strokeStyle = KANTEN_FARBE;
  g.lineWidth = KANTEN_BREITE;
  for (let k = 0; k < mitglieder.length; k++) {
    const i = mitglieder[k];
    const p = game.pieces[i];
    const pfade = aussenKanten(i, drin);
    if (!pfade.length) continue;
    g.save();
    g.translate(p.ox - aus.x, p.oy - aus.y);
    for (let t = 0; t < pfade.length; t++) g.stroke(pfade[t]);
    g.restore();
  }

  game.verbundBilder[wurzel] = { cv: cv, offX: aus.x, offY: aus.y };
}

/**
 * Baut das Bild aller festgesetzten Teile neu auf – ein durchgehendes Bild
 * ohne jede Schnittlinie, so wie das fertige Motiv aussehen soll.
 */
function baueRahmenBild() {
  // Bewusst jedes Mal eine frische Leinwand: In die alte wird bei jedem Bild
  // hineingezeichnet, sie liegt also als Textur auf der Grafikkarte. Sie zu
  // überschreiben kostet dort das Vielfache eines Neuaufbaus (gemessen 26 ms
  // gegenüber 0,8 ms bei 200 Teilen).
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(game.puzzleW + 2 * game.ov);
  cv.height = Math.ceil(game.puzzleH + 2 * game.ov);
  const g = cv.getContext("2d");

  const fest = [];
  for (let i = 0; i < game.pieces.length; i++) {
    if (game.pieces[i].locked) fest.push(i);
  }
  if (fest.length) stanzeVerbund(g, fest, -game.ov, -game.ov, cv.width, cv.height);
  game.rahmenBild = { cv: cv, g: g };
}

/** Legt Rahmenbild und Verbundbilder aus dem aktuellen Stand neu an. */
function baueAlleBilder() {
  game.verbundBilder = {};
  baueRahmenBild();

  const gesehen = {};
  for (let i = 0; i < game.pieces.length; i++) {
    if (game.pieces[i].locked) continue;
    const w = findGroup(i);
    if (gesehen[w]) continue;
    gesehen[w] = true;
    baueVerbundBild(w);
  }
}

/**
 * Merkt sich Schnittlinien, die gerade verschwunden sind, damit sie noch kurz
 * ausblenden können statt schlagartig zu fehlen.
 */
function blendeKantenAus(kanten) {
  if (!kanten.length) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  game.uebergaenge.push({ kanten: kanten, start: performance.now() });
}

/** Sollposition eines Teils im Rahmen. */
function sollPosition(i) {
  const p = game.pieces[i];
  return { x: game.frameX + p.ox, y: game.frameY + p.oy };
}

/**
 * Belegungsraster des Tisches in Maskenauflösung.
 *
 * Der Rahmen ist von vornherein gesperrt – dort gehören nur gelegte Teile
 * hin. Ebenso alles, was liegen bleibt: festgesetzte Teile und Verbünde.
 */
function baueBelegung(bleibende) {
  const z = game.maskZelle;
  const gw = Math.ceil(game.tischW / z), gh = Math.ceil(game.tischH / z);
  // -1 frei, sonst der Index des Teils; GESPERRT für den Rahmen.
  const belegt = new Int32Array(gw * gh).fill(-1);

  const rx0 = Math.floor(game.frameX / z), ry0 = Math.floor(game.frameY / z);
  const rx1 = Math.ceil((game.frameX + game.puzzleW) / z);
  const ry1 = Math.ceil((game.frameY + game.puzzleH) / z);
  for (let y = Math.max(0, ry0); y < Math.min(gh, ry1); y++) {
    belegt.fill(GESPERRT, y * gw + Math.max(0, rx0), y * gw + Math.min(gw, rx1));
  }

  const raster = { belegt: belegt, gw: gw, gh: gh, z: z };
  for (let k = 0; k < bleibende.length; k++) {
    stempleMaske(raster, game.pieces[bleibende[k]], bleibende[k]);
  }
  return raster;
}

/** Trägt ein Teil an seinem aktuellen Platz in das Belegungsraster ein. */
function stempleMaske(raster, p, wert) {
  const m = teilMaske(p);
  const cx = Math.round((p.x + m.ox) / raster.z), cy = Math.round((p.y + m.oy) / raster.z);
  for (let y = 0; y < m.h; y++) {
    const gy = cy + y;
    if (gy < 0 || gy >= raster.gh) continue;
    for (let x = 0; x < m.w; x++) {
      const gx = cx + x;
      if (gx < 0 || gx >= raster.gw) continue;
      if (m.daten[y * m.w + x]) raster.belegt[gy * raster.gw + gx] = wert;
    }
  }
}

/**
 * Ist an dieser Rasterstelle Platz für die Maske?
 * `ausser` erlaubt es, den eigenen Eintrag zu übergehen.
 */
function maskePasst(raster, m, cx, cy, ausser) {
  if (cx < 0 || cy < 0 || cx + m.w > raster.gw || cy + m.h > raster.gh) return false;
  const frei = ausser === undefined ? -1 : ausser;
  for (let y = 0; y < m.h; y++) {
    const zeile = (cy + y) * raster.gw + cx;
    const mz = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (!m.daten[mz + x]) continue;
      const w = raster.belegt[zeile + x];
      if (w !== -1 && w !== frei) return false;
    }
  }
  return true;
}

/**
 * Ablageplätze ringweise von innen nach außen.
 *
 * Erzeugt wird immer nur so weit, wie gerade gebraucht wird: Die vorderen
 * Ringe liegen dicht am Rahmen, dort landen die Teile zuerst. Je weniger
 * Teile noch übrig sind, desto näher rücken sie an den Rahmen.
 */
function kandidatenQuelle(schritt) {
  const liste = [];
  let ring = 0;
  return {
    liste: liste,
    /** Erweitert die Liste um einen Ring; false, wenn der Tisch zu Ende ist. */
    mehr: function () {
      ring++;
      const d = ring * schritt;
      const links = game.frameX - d, oben = game.frameY - d;
      const rechts = game.frameX + game.puzzleW + d, unten = game.frameY + game.puzzleH + d;
      if (links < -schritt && oben < -schritt &&
          rechts > game.tischW + schritt && unten > game.tischH + schritt) return false;

      for (let x = links; x <= rechts; x += schritt) {
        liste.push({ x: x, y: oben });
        liste.push({ x: x, y: unten });
      }
      for (let y = oben + schritt; y < unten; y += schritt) {
        liste.push({ x: links, y: y });
        liste.push({ x: rechts, y: y });
      }
      return true;
    },
  };
}

/**
 * Legt die übergebenen Teile dicht im Rand ab, ohne Überlappung.
 *
 * Gesucht wird für jedes Teil der erste freie Platz in der Ringfolge. Der
 * Suchzeiger läuft mit, springt aber ein Stück zurück, damit Lücken, die ein
 * größeres Teil hinterlassen hat, von einem kleineren noch genutzt werden.
 */
function packeTeile(zuLegende, bleibende) {
  const raster = baueBelegung(bleibende);
  const schritt = Math.max(raster.z * 2, Math.round(Math.min(game.cellW, game.cellH) / 6));
  const quelle = kandidatenQuelle(schritt);
  const RUECKBLICK = 250;
  let zeiger = 0;

  for (let k = 0; k < zuLegende.length; k++) {
    const p = game.pieces[zuLegende[k]];
    const m = teilMaske(p);
    let i = zeiger, gefunden = -1;

    while (gefunden < 0) {
      while (i >= quelle.liste.length) {
        if (!quelle.mehr()) break;
      }
      if (i >= quelle.liste.length) break;   // Tisch erschöpft
      const kand = quelle.liste[i];
      if (maskePasst(raster, m, Math.round(kand.x / raster.z), Math.round(kand.y / raster.z))) gefunden = i;
      else i++;
    }
    if (gefunden < 0) continue;              // sollte nicht vorkommen

    const kand = quelle.liste[gefunden];
    const cx = Math.round(kand.x / raster.z), cy = Math.round(kand.y / raster.z);
    p.x = cx * raster.z - m.ox;
    p.y = cy * raster.z - m.oy;
    stempleMaske(raster, p, zuLegende[k]);
    zeiger = Math.max(zeiger, gefunden - RUECKBLICK);
  }
}

/**
 * Umschließendes Rechteck eines Teils auf dem Tisch, relativ zu seinem
 * Ursprung. Bei gedrehten Teilen tauschen Breite und Höhe die Rollen.
 */
function teilRechteck(p) {
  const a = drehe(p.bx, p.by, p.rot);
  const b = drehe(p.bx + p.bw, p.by + p.bh, p.rot);
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
  };
}

/**
 * Verteilt die losen Einzelteile neu.
 *
 * Unangetastet bleiben festgesetzte Teile und alles, was schon mit einem
 * Nachbarn verbunden ist – wer Teile zusammengesucht hat, soll die Arbeit
 * durch ein Ordnen nicht verlieren. Im Drehmodus ändert der Knopf nicht die
 * Anordnung, sondern die Ausrichtung der Teile.
 */
function verteileTeile(nurDrehen) {
  const groessen = gruppenGroessen();
  const lose = [];
  const bleibende = [];
  for (let i = 0; i < game.pieces.length; i++) {
    if (game.pieces[i].locked) continue;
    if (groessen[findGroup(i)] > 1) { bleibende.push(i); continue; }
    lose.push(i);
  }

  if (nurDrehen) {
    dreheLoseTeile(lose, bleibende);
    return;
  }

  // Zufällige Reihenfolge, damit nicht Zeile für Zeile des Motivs im Rand
  // landet – sonst läge das Puzzle praktisch sortiert daneben.
  mische(lose);
  packeTeile(lose, bleibende);
}

function passeTischGroesseAn() {
  // Großzügige Vorabgröße; das dichte Ablegen braucht anschließend deutlich
  // weniger, der Tisch wird danach eingekürzt.
  //
  // Bezug ist die Summe der tatsächlichen Hüllrechtecke, nicht die Zahl der
  // Teile mal dem größten davon: Bei sehr ungleichen Teilen überschätzt das
  // zweite Maß den Bedarf um ein Vielfaches – und ein zu großer Tisch kostet
  // beim Ablegen ein riesiges Belegungsraster.
  let flaeche = 0, groesstes = 0;
  for (let i = 0; i < game.pieces.length; i++) {
    const p = game.pieces[i];
    flaeche += p.bw * p.bh;
    groesstes = Math.max(groesstes, p.bw, p.bh);
  }
  flaeche *= 2.0;
  // (W + 2r)(H + 2r) - W*H >= Fläche  nach r auflösen
  const W = game.puzzleW, H = game.puzzleH;
  const rand = Math.ceil((-(W + H) + Math.sqrt((W + H) * (W + H) + 4 * flaeche)) / 4)
             + Math.ceil(groesstes);
  setzeRand(rand);
}

/**
 * Kürzt den Tisch auf das ein, was die Teile tatsächlich brauchen.
 *
 * Beim ersten Verteilen ist der Tisch großzügig bemessen, damit die Suche
 * nach freien Plätzen nie an den Rand stößt. Wie viel davon gebraucht wurde,
 * steht erst hinterher fest – deshalb wird der Rand danach nachgezogen und
 * alles um dieselbe Strecke verschoben.
 */
function schrumpfeTisch() {
  let noetig = 0;
  for (let i = 0; i < game.pieces.length; i++) {
    const p = game.pieces[i];
    if (p.locked) continue;
    const r = teilRechteck(p);
    noetig = Math.max(noetig,
      game.frameX - (p.x + r.x),
      (p.x + r.x + r.w) - (game.frameX + game.puzzleW),
      game.frameY - (p.y + r.y),
      (p.y + r.y + r.h) - (game.frameY + game.puzzleH));
  }
  const rand = Math.ceil(Math.max(noetig, Math.min(game.cellW, game.cellH)) + game.cellW * 0.5);
  const dx = rand - game.frameX, dy = rand - game.frameY;
  setzeRand(rand);
  for (let i = 0; i < game.pieces.length; i++) {
    game.pieces[i].x += dx;
    game.pieces[i].y += dy;
  }
}

function setzeRand(rand) {
  game.frameX = rand;
  game.frameY = rand;
  game.tischW = game.puzzleW + 2 * rand;
  game.tischH = game.puzzleH + 2 * rand;
}

/**
 * Richtet die losen Einzelteile neu aus, ohne sie umzuräumen.
 *
 * Die Teile liegen dicht; nicht jede Drehung passt an Ort und Stelle. Deshalb
 * werden die Lagen in zufälliger Reihenfolge durchprobiert und die erste
 * genommen, die frei ist. Findet sich keine, bleibt das Teil, wie es liegt.
 * Gedreht wird um den Mittelpunkt, damit es seinen Platz behält.
 */
function dreheLoseTeile(lose, bleibende) {
  const raster = baueBelegung(bleibende.concat(lose));

  for (let k = 0; k < lose.length; k++) {
    const i = lose[k];
    const p = game.pieces[i];
    const alt = p.rot;
    const mitte = maskenMitte(p);

    const lagen = [0, 1, 2, 3];
    mische(lagen);
    let gesetzt = false;
    for (let t = 0; t < 4 && !gesetzt; t++) {
      if (lagen[t] === alt) continue;
      p.rot = lagen[t];
      const m = teilMaske(p);
      // Mittelpunkt festhalten, damit das Teil auf seinem Platz bleibt.
      p.x = mitte.x - m.ox - m.w * raster.z / 2;
      p.y = mitte.y - m.oy - m.h * raster.z / 2;
      const cx = Math.round((p.x + m.ox) / raster.z), cy = Math.round((p.y + m.oy) / raster.z);
      if (maskePasst(raster, m, cx, cy, i)) {
        // Alten Abdruck löschen, neuen setzen.
        p.rot = alt;
        loescheMaske(raster, p, i);
        p.rot = lagen[t];
        p.x = cx * raster.z - m.ox;
        p.y = cy * raster.z - m.oy;
        stempleMaske(raster, p, i);
        gesetzt = true;
      }
    }
    if (!gesetzt) {
      p.rot = alt;
      const m = teilMaske(p);
      p.x = mitte.x - m.ox - m.w * raster.z / 2;
      p.y = mitte.y - m.oy - m.h * raster.z / 2;
    }
  }
}

/** Nimmt den Abdruck eines Teils wieder aus dem Belegungsraster heraus. */
function loescheMaske(raster, p, wert) {
  const m = teilMaske(p);
  const cx = Math.round((p.x + m.ox) / raster.z), cy = Math.round((p.y + m.oy) / raster.z);
  for (let y = 0; y < m.h; y++) {
    const gy = cy + y;
    if (gy < 0 || gy >= raster.gh) continue;
    for (let x = 0; x < m.w; x++) {
      const gx = cx + x;
      if (gx < 0 || gx >= raster.gw) continue;
      if (m.daten[y * m.w + x] && raster.belegt[gy * raster.gw + gx] === wert) {
        raster.belegt[gy * raster.gw + gx] = -1;
      }
    }
  }
}

function mische(liste) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = liste[i]; liste[i] = liste[j]; liste[j] = t;
  }
}

function gruppenGroessen() {
  const g = {};
  for (let i = 0; i < game.pieces.length; i++) {
    const w = findGroup(i);
    g[w] = (g[w] || 0) + 1;
  }
  return g;
}

async function starteSpiel(bildId, teileZiel, saved) {
  const eintrag = motivEintrag(bildId);
  if (!eintrag) return;
  const ziel = saved ? null : (teileZiel || TEILE_STUFEN[0]);

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("result-btn").classList.add("hidden");
  zeigeLaden(true, "Teile werden gestanzt …");
  stopTimer();

  let img;
  try {
    img = await ladeBild(eintrag.datei);
  } catch (e) {
    zeigeLaden(false);
    zurueckZurUebersicht();
    zeigeHinweis(eintrag.eigen
      ? "Das eigene Bild lässt sich nicht mehr laden. Lade es bitte neu hoch."
      : "Das Motiv „" + eintrag.titel + "“ fehlt noch. Lege die Datei unter " + eintrag.datei + " ab.");
    return;
  }

  const seed = saved ? saved.seed : (Math.random() * 0xffffffff) >>> 0;
  const artName = saved ? (saved.art || "ungewoehnlich") : ladeSchnittArt();
  const art = schnittArt(artName);
  // Teile wachsen aus einem feineren Untergitter. Je mehr Zellen je Teil,
  // desto freier die Formen – gedeckelt, weil jede Zelle Rechenzeit und
  // Speicher kostet und der Gewinn an Wildheit irgendwann ausläuft.
  const zellZiel = Math.min(
    (saved ? saved.ziel : ziel) * art.zellenProTeil,
    Math.max(saved ? saved.ziel : ziel, ZELLEN_MAX)
  );
  const raster = saved
    ? { cols: saved.cols, rows: saved.rows }
    : chooseGrid(img.naturalWidth, img.naturalHeight, zellZiel);
  const cut = makeCut(raster.cols, raster.rows, seed, artName);

  // Je mehr Teile, desto größer das Bild – sonst würde ein Teil bei 1000
  // Stück nur noch eine Briefmarke.
  const puzzleW = puzzleBreite(raster.cols * raster.rows);   // nach Zellen, nicht nach Teilen
  const puzzleH = Math.round(puzzleW * img.naturalHeight / img.naturalWidth);

  const gebaut = await baueTeile(img, cut, raster.cols, raster.rows, puzzleW, puzzleH,
    saved ? saved.ziel : ziel,
    function (fertig, gesamt) {
      zeigeLaden(true, "Teile werden gestanzt … " + Math.round(100 * fertig / gesamt) + " %");
    });

  game = {
    bildId: bildId,
    titel: eintrag.titel,
    bild: img,
    seed: seed,
    cols: raster.cols,
    rows: raster.rows,
    ziel: saved ? (saved.ziel || raster.cols * raster.rows) : ziel,
    art: artName,
    cut: cut,
    puzzleW: puzzleW,
    puzzleH: puzzleH,
    cellW: gebaut.cellW,
    cellH: gebaut.cellH,
    ov: gebaut.ov,
    maskZelle: gebaut.maskZelle,
    pieces: gebaut.teile,
    parent: [],
    order: [],
    tischW: 0, tischH: 0, frameX: 0, frameY: 0,
    drehmodus: saved ? !!saved.drehmodus : ladeDrehmodus(),
    farben: farbenAus(ladeFarbe()),
    view: { x: 0, y: 0, scale: 1 },
    drag: null,
    fertig: false,
    // Ein Bild für alles Festgesetzte, je eines pro losem Verbund.
    rahmenBild: null,
    verbundBilder: {},
    uebergaenge: [],
    auswahl: {},
  };
  for (let i = 0; i < game.pieces.length; i++) {
    game.parent.push(i);
    game.order.push(i);
  }
  // Beim dichten Ablegen entscheidet der Zufall, wie weit der Rand gebraucht
  // wird – deshalb wird er mitgespeichert statt neu berechnet.
  if (saved && saved.rand) setzeRand(saved.rand);
  else passeTischGroesseAn();

  if (saved) {
    for (let i = 0; i < game.pieces.length; i++) {
      game.pieces[i].x = saved.lagen[i * 5];
      game.pieces[i].y = saved.lagen[i * 5 + 1];
      game.pieces[i].locked = saved.lagen[i * 5 + 3] === 1;
      game.pieces[i].rot = saved.lagen[i * 5 + 4] || 0;
    }
    // Gruppen wiederherstellen: gleiche Kennung heißt verbunden.
    const ersterMit = {};
    for (let i = 0; i < game.pieces.length; i++) {
      const k = saved.lagen[i * 5 + 2];
      if (ersterMit[k] === undefined) ersterMit[k] = i;
      else unionGroups(ersterMit[k], i);
    }
    if (Array.isArray(saved.reihenfolge) && saved.reihenfolge.length === game.pieces.length) {
      game.order = saved.reihenfolge.slice();
    }
  } else {
    if (game.drehmodus) {
      for (let i = 0; i < game.pieces.length; i++) {
        game.pieces[i].rot = Math.floor(Math.random() * 4);
      }
    }
    verteileTeile();
    schrumpfeTisch();
  }

  baueAlleBilder();

  document.getElementById("motiv-label").textContent = eintrag.titel;
  document.getElementById("piece-total").textContent = String(game.pieces.length);
  document.getElementById("sort-btn").lastChild.textContent =
    game.drehmodus ? "Teile drehen" : "Teile ordnen";
  document.getElementById("sort-btn").title = game.drehmodus
    ? "Lose Einzelteile zufällig neu ausrichten"
    : "Einzeln liegende Teile außerhalb des Rahmens neu verteilen";

  zeigeLaden(false);
  passeLeinwandAn(true);
  aktualisiereZaehler();
  startTimer(saved ? (saved.elapsedSeconds || 0) : 0);
  if (!saved) recordPlayed(game.ziel);
  saveGame();
}

/**
 * Bildbreite in Tischkoordinaten. Sie wächst mit der Teilezahl, damit ein
 * einzelnes Teil ungefähr gleich groß bleibt, ist aber gedeckelt: Darüber
 * hinaus kosteten die Leinwände mehr Speicher, als die Schärfe wert wäre.
 */
function puzzleBreite(teile) {
  const b = Math.round(PUZZLE_BREITE * Math.sqrt(teile / TEILE_STUFEN[0]));
  return Math.max(PUZZLE_BREITE, Math.min(PUZZLE_BREITE_MAX, b));
}

/* ---------------------------------------------------------------
   Ansicht und Zeichnen
   --------------------------------------------------------------- */

let einpassenAusstehend = false;
let groessenWaechter = null;

/**
 * Meldet jede Größenänderung des Spielbereichs zurück.
 *
 * Direkt nach dem Einblenden – und in einem verborgenen Tab – ist der Bereich
 * noch 0 Pixel breit. Statt in einer Schleife nachzumessen, wird hier auf die
 * erste echte Größe gewartet.
 */
function beobachteGroesse() {
  if (groessenWaechter || typeof ResizeObserver === "undefined") return;
  groessenWaechter = new ResizeObserver(function () { passeLeinwandAn(false); });
  groessenWaechter.observe(document.getElementById("board-wrap"));
}

/**
 * Misst den Spielbereich und richtet die Leinwand darauf ein. Steht die
 * Einpassung noch aus, wird sie nachgeholt, sobald echte Maße vorliegen.
 */
function passeLeinwandAn(dannEinpassen) {
  if (dannEinpassen) einpassenAusstehend = true;
  beobachteGroesse();

  const wrap = document.getElementById("board-wrap");
  const r = wrap.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!game) return;
  game.viewport = { w: r.width, h: r.height };
  if (einpassenAusstehend) {
    einpassenAusstehend = false;
    zeigeGanzenTisch();
  }
  zeichne();
}

function zeigeGanzenTisch() {
  if (!game || !game.viewport || !game.viewport.w || !game.viewport.h) return;
  let s = Math.min(game.viewport.w / game.tischW, game.viewport.h / game.tischH) * 0.98;
  if (!isFinite(s) || s <= 0) s = 1;
  game.view.scale = s;
  game.view.x = (game.viewport.w - game.tischW * s) / 2;
  game.view.y = (game.viewport.h - game.tischH * s) / 2;
}

function zeichne() {
  if (!game || !game.rahmenBild) return;
  const v = game.view;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.translate(v.x, v.y);
  ctx.scale(v.scale, v.scale);

  // Umfeld jenseits des Tisches
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = game.farben.aussen;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Tischfläche
  ctx.fillStyle = game.farben.tisch;
  ctx.fillRect(0, 0, game.tischW, game.tischH);

  // Rahmen in Bildgröße – hier gehört das fertige Puzzle hin
  ctx.fillStyle = game.farben.innen;
  ctx.fillRect(game.frameX, game.frameY, game.puzzleW, game.puzzleH);

  // Zuunterst die festgesetzten Teile als ein durchgehendes Bild – so bleibt
  // ein Teil, das über den Rahmen gezogen wird, sichtbar obenauf.
  ctx.drawImage(game.rahmenBild.cv, game.frameX - game.ov, game.frameY - game.ov);

  const groessen = gruppenGroessen();
  const gezeichnet = {};
  for (let k = 0; k < game.order.length; k++) {
    const i = game.order[k];
    const p = game.pieces[i];
    if (p.locked) continue;
    const w = findGroup(i);

    if (groessen[w] > 1) {
      // Der ganze Verbund steckt in einer Leinwand und wird einmal gesetzt.
      if (gezeichnet[w]) continue;
      gezeichnet[w] = true;
      const bild = game.verbundBilder[w];
      if (!bild) continue;
      mitTeilLage(p, function () {
        ctx.drawImage(bild.cv, bild.offX - p.ox, bild.offY - p.oy);
      });
    } else {
      mitTeilLage(p, function () { ctx.drawImage(p.cv, p.bx, p.by); });
    }
  }

  // Vorlage: das fertige Bild liegt genau im Rahmen, also im selben
  // Koordinatensystem wie die Teile. Dadurch wandert und zoomt es mit – wer
  // in eine Ecke hineingezoomt hat, sieht auch nur diese Ecke. Gezeichnet
  // wird es deckend über den Teilen: Solange die Vorlage an ist, sieht man
  // im Rahmen das Motiv und sonst nichts.
  if (vorschauAktiv) {
    ctx.drawImage(game.bild, game.frameX, game.frameY, game.puzzleW, game.puzzleH);
  }

  // Die Rahmenlinie zuletzt – so bleibt sie auch unter der Vorlage scharf.
  ctx.strokeStyle = game.farben.linie;
  ctx.lineWidth = 2 / game.view.scale;
  ctx.strokeRect(game.frameX, game.frameY, game.puzzleW, game.puzzleH);

  zeichneMarkierung();
  zeichneAusblendendeKanten();
  ctx.restore();
}

/** Hebt die ausgewählten Teile hervor und zeigt das aufgezogene Rechteck. */
function zeichneMarkierung() {
  const strich = 2 / game.view.scale;

  for (const schluessel in game.auswahl) {
    const p = game.pieces[Number(schluessel)];
    if (p.locked) continue;
    ctx.save();
    ctx.strokeStyle = game.farben.linie;
    ctx.lineWidth = strich;
    mitTeilLage(p, function () {
      for (let k = 0; k < p.kontur.length; k++) ctx.stroke(p.kontur[k]);
    });
    ctx.restore();
  }

  if (game.drag && game.drag.modus === "auswahl") {
    const d = game.drag;
    const x = Math.min(d.vonX, d.bisX), y = Math.min(d.vonY, d.bisY);
    const b = Math.abs(d.bisX - d.vonX), h = Math.abs(d.bisY - d.vonY);
    ctx.save();
    ctx.fillStyle = game.farben.linie;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x, y, b, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = game.farben.linie;
    ctx.lineWidth = strich;
    ctx.setLineDash([6 / game.view.scale, 4 / game.view.scale]);
    ctx.strokeRect(x, y, b, h);
    ctx.restore();
  }
}

/**
 * Führt eine Zeichnung im Koordinatensystem eines Teils aus: Ursprung auf
 * seinem Platz, gedreht um seine Ausrichtung.
 */
function mitTeilLage(p, zeichnung) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.rot) ctx.rotate(p.rot * Math.PI / 2);
  zeichnung();
  ctx.restore();
}

/** Gerade verschwundene Schnittlinien noch kurz nachklingen lassen. */
function zeichneAusblendendeKanten() {
  if (!game.uebergaenge.length) return;
  const jetzt = performance.now();
  let laeuftNoch = false;

  ctx.strokeStyle = KANTEN_FARBE;
  ctx.lineWidth = KANTEN_BREITE;
  for (let u = 0; u < game.uebergaenge.length; u++) {
    const ueb = game.uebergaenge[u];
    const t = (jetzt - ueb.start) / NAHT_FADE_MS;
    if (t >= 1) continue;
    laeuftNoch = true;
    ctx.globalAlpha = 1 - t * t;
    for (let k = 0; k < ueb.kanten.length; k++) {
      const p = game.pieces[ueb.kanten[k].i];
      const pfade = ueb.kanten[k].pfade;
      mitTeilLage(p, function () {
        for (let t = 0; t < pfade.length; t++) ctx.stroke(pfade[t]);
      });
    }
  }
  ctx.globalAlpha = 1;

  if (laeuftNoch) requestAnimationFrame(function () { zeichne(); });
  else game.uebergaenge.length = 0;
}

/* ---------------------------------------------------------------
   Umrechnung Bildschirm <-> Tisch
   --------------------------------------------------------------- */

function zuTisch(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (clientX - r.left - game.view.x) / game.view.scale,
    y: (clientY - r.top - game.view.y) / game.view.scale,
  };
}

/**
 * Oberstes Teil an dieser Stelle.
 *
 * Ein rein formgenauer Test über die Deckkraft ist zu streng: In der
 * Übersicht ist ein Teil nur wenige Dutzend Pixel groß, und wer knapp
 * danebentippt, verschiebt sonst den Tisch statt das Teil. Deshalb drei
 * Stufen – erst genau, dann das Kernrechteck, zuletzt das nächstgelegene.
 */
function teilAn(tx, ty) {
  // Erst formgenau: Liegt der Zeiger wirklich auf einem Teil, gewinnt das
  // oberste – auch wenn ein anderes in der Nähe ist.
  const genau = sucheTeil(tx, ty, 0);
  if (genau !== null) return genau;

  // Sonst mit etwas Nachsicht. In der Übersicht ist ein Teil nur wenige
  // Dutzend Pixel groß; wer knapp danebentippt, verschöbe sonst den Tisch.
  // Die Nachsicht gilt in Bildschirmpixeln, damit sie beim Hineinzoomen
  // nicht mitwächst.
  const nah = sucheTeil(tx, ty, GREIF_TOLERANZ / game.view.scale);
  return nah === null ? -1 : nah;
}

/** Oberstes Teil, dessen Form den Punkt trifft (mit Nachsicht). */
function sucheTeil(tx, ty, toleranz) {
  for (let k = game.order.length - 1; k >= 0; k--) {
    const i = game.order[k];
    const p = game.pieces[i];
    const l = zuTeil(p, tx, ty);
    if (l.x < p.bx - toleranz || l.y < p.by - toleranz ||
        l.x > p.bx + p.bw + toleranz || l.y > p.by + p.bh + toleranz) continue;
    if (!trifftForm(p, l.x, l.y, toleranz)) continue;
    // Genau auf ein festgesetztes Teil getippt: nichts greifen, sondern den
    // Tisch verschieben. Sonst würde stattdessen ein loses Teil aus der
    // Nachbarschaft anspringen, was verwirrt.
    return p.locked ? -1 : i;
  }
  return null;
}

/**
 * Trifft der Punkt die Form des Teils?
 *
 * Geprüft wird der Punkt selbst und – bei Nachsicht – ein Kranz darum. Damit
 * bleibt der Test an der tatsächlichen Form, statt auf das umschließende
 * Rechteck auszuweichen: Bei einem langen oder verwinkelten Teil liegt das
 * Rechteck größtenteils neben dem Teil, und man würde etwas greifen, wo
 * sichtbar nichts ist.
 */
function trifftForm(p, lx, ly, toleranz) {
  if (pruefContext.isPointInPath(p.path, lx, ly)) return true;
  if (toleranz <= 0) return false;
  for (let w = 0; w < 8; w++) {
    const a = w * Math.PI / 4;
    if (pruefContext.isPointInPath(p.path, lx + Math.cos(a) * toleranz, ly + Math.sin(a) * toleranz)) {
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------
   Ziehen und Einrasten
   --------------------------------------------------------------- */

function hebeGruppeNachOben(mitglieder) {
  const set = {};
  for (let i = 0; i < mitglieder.length; i++) set[mitglieder[i]] = true;
  const rest = game.order.filter(function (i) { return !set[i]; });
  game.order = rest.concat(mitglieder);
}

/**
 * Dreht eine Gruppe um 90 Grad nach rechts.
 *
 * Gedreht wird um die Mitte der Gruppe, sonst schöbe sie sich beim Drehen
 * davon. Der Zusammenhalt bleibt gewahrt: Werden alle Mitglieder um denselben
 * Punkt gedreht, bleiben ihre Abstände zueinander die gedrehten Sollabstände.
 */
function dreheGruppe(mitglieder) {
  let sx = 0, sy = 0;
  for (let k = 0; k < mitglieder.length; k++) {
    const p = game.pieces[mitglieder[k]];
    const m = drehe(p.mx, p.my, p.rot);
    sx += p.x + m.x;
    sy += p.y + m.y;
  }
  const cx = sx / mitglieder.length, cy = sy / mitglieder.length;

  for (let k = 0; k < mitglieder.length; k++) {
    const p = game.pieces[mitglieder[k]];
    const v = drehe(p.x - cx, p.y - cy, 1);
    p.x = cx + v.x;
    p.y = cy + v.y;
    p.rot = (p.rot + 1) % 4;
  }
}

function onPointerDown(e) {
  if (!game) return;

  if (e.button === 2) {
    e.preventDefault();

    // Im Drehmodus dreht die rechte Taste – aber nur, wenn sie ein Teil
    // trifft. Auf freier Fläche gibt es nichts zu drehen, dort zeigt sie
    // wie sonst auch die Vorlage.
    if (game.drehmodus && !game.fertig) {
      const t = zuTisch(e.clientX, e.clientY);
      const idx = teilAn(t.x, t.y);
      if (idx >= 0) {
        dreheGruppe(piecesOfGroup(findGroup(idx)));
        zeichne();
        saveGame();
        return;
      }
    }

    // Solange die Taste gedrückt ist, das fertige Bild einblenden.
    zeigeVorschau(true);
    return;
  }

  // Gezogen wird nur mit der linken Taste. Ohne das griffe auch ein Klick mit
  // der mittleren oder einer Zusatztaste ein Teil.
  if (e.button !== 0) return;
  if (game.fertig) return;

  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
  const t = zuTisch(e.clientX, e.clientY);

  // Mit gehaltenem M spannt die linke Taste ein Auswahlrechteck auf.
  if (mTaste) {
    game.drag = { modus: "auswahl", vonX: t.x, vonY: t.y, bisX: t.x, bisY: t.y };
    zeichne();
    return;
  }

  // Leere Fläche: Tisch verschieben
  const idx = teilAn(t.x, t.y);
  if (idx < 0) {
    setzeAuswahl([]);
    game.drag = { modus: "tisch", startX: e.clientX, startY: e.clientY, vx: game.view.x, vy: game.view.y };
    zeichne();
    return;
  }

  // Ein Teil aus der Auswahl nimmt die ganze Auswahl mit; ein Teil außerhalb
  // hebt sie auf – so wie man es von einer Mehrfachauswahl erwartet.
  let mitglieder;
  if (game.auswahl[idx]) {
    mitglieder = auswahlMitglieder();
  } else {
    setzeAuswahl([]);
    mitglieder = piecesOfGroup(findGroup(idx));
  }
  hebeGruppeNachOben(mitglieder);
  game.drag = {
    modus: "teile",
    mitglieder: mitglieder,
    letzteX: t.x,
    letzteY: t.y,
  };
  zeichne();
}

/* ---------------------------------------------------------------
   Mehrfachauswahl

   Bei mehreren hundert Teilen wird das Umräumen mühsam, wenn jedes einzeln
   angefasst werden muss. Mit gehaltenem M zieht die linke Taste deshalb ein
   Rechteck über einen Bereich; alles darin wandert danach gemeinsam.
   --------------------------------------------------------------- */

function setzeAuswahl(indizes) {
  game.auswahl = {};
  for (let k = 0; k < indizes.length; k++) game.auswahl[indizes[k]] = true;
}

/** Alle Teile der ausgewählten Gruppen – Verbünde bleiben zusammen. */
function auswahlMitglieder() {
  const wurzeln = {};
  for (const schluessel in game.auswahl) {
    const i = Number(schluessel);
    if (game.pieces[i].locked) continue;
    wurzeln[findGroup(i)] = true;
  }
  let alle = [];
  for (const w in wurzeln) alle = alle.concat(piecesOfGroup(Number(w)));
  return alle;
}

/**
 * Sammelt die Teile, die das Rechteck berührt.
 *
 * Maßgeblich ist das umschließende Rechteck des Teils – wer einen Bereich
 * überstreicht, meint alles, was dort sichtbar liegt, und nicht nur das, was
 * mit dem Umriss exakt hineinragt. Festgesetzte Teile bleiben außen vor, die
 * lassen sich ohnehin nicht bewegen.
 */
function teileImRechteck(x0, y0, x1, y1) {
  const links = Math.min(x0, x1), rechts = Math.max(x0, x1);
  const oben = Math.min(y0, y1), unten = Math.max(y0, y1);
  const treffer = [];
  for (let i = 0; i < game.pieces.length; i++) {
    const p = game.pieces[i];
    if (p.locked) continue;
    const r = teilRechteck(p);
    if (p.x + r.x > rechts || p.x + r.x + r.w < links) continue;
    if (p.y + r.y > unten || p.y + r.y + r.h < oben) continue;
    treffer.push(i);
  }
  return treffer;
}



function onPointerMove(e) {
  if (!game || !game.drag) return;
  if (game.drag.modus === "auswahl") {
    const t = zuTisch(e.clientX, e.clientY);
    game.drag.bisX = t.x;
    game.drag.bisY = t.y;
    zeichne();
    return;
  }
  if (game.drag.modus === "tisch") {
    game.view.x = game.drag.vx + (e.clientX - game.drag.startX);
    game.view.y = game.drag.vy + (e.clientY - game.drag.startY);
    zeichne();
    return;
  }
  const t = zuTisch(e.clientX, e.clientY);
  const dx = t.x - game.drag.letzteX;
  const dy = t.y - game.drag.letzteY;
  game.drag.letzteX = t.x;
  game.drag.letzteY = t.y;
  for (let i = 0; i < game.drag.mitglieder.length; i++) {
    const p = game.pieces[game.drag.mitglieder[i]];
    p.x += dx;
    p.y += dy;
  }
  zeichne();
}

function onPointerUp(e) {
  if (e && e.button === 2) { zeigeVorschau(false); return; }
  if (!game || !game.drag) return;
  const war = game.drag;
  game.drag = null;

  if (war.modus === "auswahl") {
    setzeAuswahl(teileImRechteck(war.vonX, war.vonY, war.bisX, war.bisY));
    zeichne();
    return;
  }
  if (war.modus === "tisch") return;

  // Je bewegter Gruppe einmal prüfen. Beim Ziehen einer Auswahl sind das
  // mehrere; jede rastet für sich ein, sonst müsste eine von ihnen die
  // anderen mitziehen.
  const vertreter = [];
  const gesehen = {};
  for (let k = 0; k < war.mitglieder.length; k++) {
    const w = findGroup(war.mitglieder[k]);
    if (gesehen[w]) continue;
    gesehen[w] = true;
    vertreter.push(war.mitglieder[k]);
  }
  for (let k = 0; k < vertreter.length; k++) {
    versucheEinrasten(piecesOfGroup(findGroup(vertreter[k])));
  }

  // Was dabei festgesetzt wurde, gehört nicht mehr zur Auswahl.
  for (const schluessel in game.auswahl) {
    if (game.pieces[Number(schluessel)].locked) delete game.auswahl[schluessel];
  }
  zeichne();
  aktualisiereZaehler();
  saveGame();
  pruefeFertig();
}

/**
 * Setzt eine bewegte Gruppe ab: erst der Rahmen, dann die Nachbarn.
 *
 * Zuerst der Rahmen – sitzt die Gruppe an ihrem Platz, ist sie fertig. Sonst
 * kann das Andocken an einen Nachbarn weitere Nachbarn in Reichweite bringen,
 * deshalb die Schleife.
 */
function versucheEinrasten(mitglieder) {
  if (pruefeRahmen(mitglieder)) return;
  if (!pruefeRasten(mitglieder)) return;
  let nochmal = true, runden = 0;
  while (nochmal && runden < 8) {
    nochmal = pruefeRasten(piecesOfGroup(findGroup(mitglieder[0])));
    runden++;
  }
  // Wurde dabei an eine bereits festgesetzte Gruppe angedockt, sitzt die
  // ganze Gruppe nun richtig – dann gilt sie ebenfalls als eingesetzt.
  pruefeRahmen(piecesOfGroup(findGroup(mitglieder[0])));
}

/**
 * Prüft für alle Teile der bewegten Gruppe, ob ein Nachbar nah genug an
 * seiner Sollposition liegt. Passt es, wird die ganze Gruppe exakt
 * ausgerichtet und mit der anderen verbunden.
 */
/**
 * Liegt ein Teil der Gruppe nah genug an seinem Platz im Rahmen, wird die
 * ganze Gruppe exakt dorthin gesetzt und festgestellt. Ab da lässt sie sich
 * nicht mehr bewegen – sie ist ja am Ziel.
 */
function pruefeRahmen(mitglieder) {
  const toleranz = Math.min(game.cellW, game.cellH) * RAHMEN_TOLERANZ;
  // Ein schief liegendes Teil gehört nicht in den Rahmen, auch wenn es an der
  // richtigen Stelle liegt – erst gerade drehen.
  if (game.pieces[mitglieder[0]].rot !== 0) return false;

  for (let m = 0; m < mitglieder.length; m++) {
    const i = mitglieder[m];
    const p = game.pieces[i];
    const soll = sollPosition(i);
    const fx = p.x - soll.x, fy = p.y - soll.y;
    if (Math.hypot(fx, fy) > toleranz) continue;

    const wurzel = findGroup(i);
    const gruppe = piecesOfGroup(wurzel);
    const drin = alsMenge(gruppe);

    // Die Kontur des Verbunds verschwindet gleich – im Rahmen wird das Bild
    // durchgehend gezeichnet. Vorher merken, damit sie ausblenden kann.
    const kontur = [];
    for (let k = 0; k < gruppe.length; k++) {
      const pfade = aussenKanten(gruppe[k], drin);
      if (pfade.length) kontur.push({ i: gruppe[k], pfade: pfade });
    }

    for (let k = 0; k < gruppe.length; k++) {
      const q = game.pieces[gruppe[k]];
      q.x -= fx;
      q.y -= fy;
      q.locked = true;
    }
    baueRahmenBild();
    delete game.verbundBilder[wurzel];
    blendeKantenAus(kontur);
    return true;
  }
  return false;
}

function pruefeRasten(mitglieder) {
  const toleranz = Math.min(game.cellW, game.cellH) * RASTER_TOLERANZ;
  const wurzel = findGroup(mitglieder[0]);

  for (let m = 0; m < mitglieder.length; m++) {
    const i = mitglieder[m];
    const p = game.pieces[i];
    for (let n = 0; n < p.nachbarn.length; n++) {
      const j = p.nachbarn[n];
      if (findGroup(j) === wurzel) continue;

      const q = game.pieces[j];
      // Verschieden ausgerichtete Teile passen nicht zusammen.
      if (q.rot !== p.rot) continue;
      // Sollabstand zwischen den beiden Teilen – im gedrehten Verbund ist es
      // schlicht der mitgedrehte Abstand ihrer Plätze im Bild.
      const soll = drehe(p.ox - q.ox, p.oy - q.oy, p.rot);
      const fehlerX = (p.x - q.x) - soll.x;
      const fehlerY = (p.y - q.y) - soll.y;
      if (Math.hypot(fehlerX, fehlerY) > toleranz) continue;

      // Bewegte Gruppe exakt auf die andere ausrichten
      const eigene = piecesOfGroup(wurzel);
      for (let k = 0; k < eigene.length; k++) {
        game.pieces[eigene[k]].x -= fehlerX;
        game.pieces[eigene[k]].y -= fehlerY;
      }

      // Die Schnittlinien zwischen beiden Gruppen fallen mit dem Verbinden
      // weg – sie werden hier festgehalten und blenden danach aus.
      const andereWurzel = findGroup(j);
      const naht = nahtKanten(alsMenge(eigene), alsMenge(piecesOfGroup(andereWurzel)));

      unionGroups(j, i);
      const neueWurzel = findGroup(i);
      if (neueWurzel !== wurzel) delete game.verbundBilder[wurzel];
      if (neueWurzel !== andereWurzel) delete game.verbundBilder[andereWurzel];
      baueVerbundBild(neueWurzel);
      blendeKantenAus(naht);
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------
   Zustand
   --------------------------------------------------------------- */

function aktualisiereZaehler() {
  // "Gelegt" = im Rahmen eingesetzt oder wenigstens mit einem Nachbarn verbunden
  const groessen = gruppenGroessen();
  let gelegt = 0;
  for (let i = 0; i < game.pieces.length; i++) {
    if (game.pieces[i].locked || groessen[findGroup(i)] > 1) gelegt++;
  }
  document.getElementById("done-count").textContent = String(gelegt);
}

/**
 * Ist das Puzzle fertig?
 *
 * Es gibt zwei Wege dorthin, und beide zählen: Man kann alle Teile einzeln in
 * den Rahmen setzen – dann ist jedes für sich festgestellt und es gibt gar
 * keinen gemeinsamen Verbund. Oder man baut das Bild daneben zusammen – dann
 * hängt alles in einer Gruppe und rückt zum Schluss an seinen Platz.
 */
function pruefeFertig() {
  if (game.fertig) return;

  let alleFest = true;
  for (let i = 0; i < game.pieces.length; i++) {
    if (!game.pieces[i].locked) { alleFest = false; break; }
  }

  if (!alleFest) {
    const wurzel = findGroup(0);
    for (let i = 1; i < game.pieces.length; i++) {
      if (findGroup(i) !== wurzel) return;
    }
  }

  // Wurde außerhalb des Rahmens gebaut, rückt das Bild jetzt an seinen Platz –
  // sonst bliebe es daneben liegen.
  if (!game.pieces[0].locked) {
    for (let i = 0; i < game.pieces.length; i++) {
      const soll = sollPosition(i);
      game.pieces[i].x = soll.x;
      game.pieces[i].y = soll.y;
      game.pieces[i].rot = 0;
      game.pieces[i].locked = true;
    }
    baueAlleBilder();
    zeichne();
  }
  game.fertig = true;
  aktualisiereZaehler();
  stopTimer();
  clearSave();
  recordWon(game.ziel, elapsedSeconds);
  siegesAnimation();
  document.getElementById("result-btn").classList.remove("hidden");
  document.getElementById("end-text").textContent =
    game.titel + " · " + game.pieces.length + " Teile in " + formatTime(elapsedSeconds);
  setTimeout(function () {
    document.getElementById("end-overlay").classList.remove("hidden");
    konfetti();
  }, 1400);
}

/** Das fertige Bild rückt sanft in die Mitte und wird herangezoomt. */
function siegesAnimation() {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Zielansicht: das fertige Bild formatfüllend
  const linkeObere = { x: game.frameX, y: game.frameY };
  const zielScale = Math.min(
    game.viewport.w / game.puzzleW, game.viewport.h / game.puzzleH
  ) * 0.92;
  const ziel = {
    scale: zielScale,
    x: game.viewport.w / 2 - (linkeObere.x + game.puzzleW / 2) * zielScale,
    y: game.viewport.h / 2 - (linkeObere.y + game.puzzleH / 2) * zielScale,
  };

  if (reduced) { game.view = ziel; zeichne(); return; }

  const start = { x: game.view.x, y: game.view.y, scale: game.view.scale };
  const t0 = performance.now();
  const dauer = 1100;
  function schritt(now) {
    const t = Math.min(1, (now - t0) / dauer);
    const e = 1 - Math.pow(1 - t, 3);
    game.view.x = start.x + (ziel.x - start.x) * e;
    game.view.y = start.y + (ziel.y - start.y) * e;
    game.view.scale = start.scale + (ziel.scale - start.scale) * e;
    zeichne();
    if (t < 1) requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);
}

function konfetti() {
  const layer = document.getElementById("confetti-layer");
  layer.innerHTML = "";
  const farben = ["#f2c94c", "#f2994a", "#6fcf97", "#56ccf2", "#bb6bd9"];
  for (let i = 0; i < 60; i++) {
    const bit = document.createElement("span");
    bit.className = "confetti";
    bit.style.left = Math.random() * 100 + "%";
    bit.style.background = farben[i % farben.length];
    bit.style.animationDelay = (Math.random() * 0.7).toFixed(2) + "s";
    bit.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + "s";
    layer.appendChild(bit);
  }
}

/* ---------------------------------------------------------------
   Bildschirme
   --------------------------------------------------------------- */

/* Festgestellt über den Knopf – die rechte Maustaste zeigt nur solange sie hält. */
let vorschauFest = false;
/* Ob die Vorlage gerade im Rahmen liegt – gedrückt gehalten oder festgestellt. */
let vorschauAktiv = false;
/* Solange M gehalten wird, zieht die linke Taste ein Auswahlrechteck. */
let mTaste = false;

function zeigeVorschau(an) {
  const neu = !!(an || vorschauFest);
  if (neu === vorschauAktiv) return;
  vorschauAktiv = neu;
  if (game) zeichne();
}

function zeigeLaden(an, text) {
  document.getElementById("loading-overlay").classList.toggle("hidden", !an);
  if (text) document.getElementById("loading-text").textContent = text;
}

function zeigeHinweis(text) {
  const el = document.getElementById("start-notice");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

function zurueckZurUebersicht() {
  stopTimer();
  saveGame();
  game = null;
  document.getElementById("game-screen").classList.add("hidden");
  document.getElementById("end-overlay").classList.add("hidden");
  document.getElementById("start-screen").classList.remove("hidden");
  baueStartbildschirm();
}

/* ---------------------------------------------------------------
   Farben

   Gewählt wird nur die Fläche innerhalb des Rahmens. Tisch, Umfeld und
   Rahmenlinie leiten sich davon ab: Sie behalten den Farbton und weichen in
   der Helligkeit aus – und zwar in die Richtung, in der noch Luft ist. Bei
   einem dunklen Bildgrund wird das Umfeld also heller, bei einem hellen
   dunkler. Die Rahmenlinie geht denselben Weg, nur deutlich weiter, und wird
   zusätzlich gesättigter – so bleibt sie in jeder Wahl gut ablesbar.
   --------------------------------------------------------------- */

/* Rasterwert für Flächen, auf denen kein loses Teil liegen darf. */
const GESPERRT = -2;

const FARB_VORSCHLAEGE = [
  "#123d2a", "#123047", "#3a1f4d", "#4a2418", "#3d3a12", "#1f1f24",
];
const FARBE_STANDARD = FARB_VORSCHLAEGE[0];

function hexZuHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return hexZuHsl(FARBE_STANDARD);
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: h, s: sat * 100, l: l * 100 };
}

function hsl(h, s, l) {
  return "hsl(" + ((h % 360) + 360) % 360 + ", " + Math.max(0, Math.min(100, s)).toFixed(1) + "%, " +
         Math.max(0, Math.min(100, l)).toFixed(1) + "%)";
}

function farbenAus(hex) {
  const c = hexZuHsl(hex);
  // Richtung, in der noch Spielraum ist.
  const weg = c.l > 50 ? -1 : 1;
  return {
    innen: hsl(c.h, c.s, c.l),
    tisch: hsl(c.h, c.s * 0.92, c.l + weg * 6),
    aussen: hsl(c.h, c.s * 0.82, c.l + weg * 11),
    linie: hsl(c.h, Math.max(30, Math.min(80, c.s + 12)),
               weg > 0 ? Math.min(72, c.l + 38) : Math.max(24, c.l - 38)),
  };
}

function ladeFarbe() {
  const f = localStorage.getItem("puzzleFarbe");
  return /^#[0-9a-f]{6}$/i.test(f || "") ? f : FARBE_STANDARD;
}

function setzeFarbe(hex) {
  try { localStorage.setItem("puzzleFarbe", hex); } catch (e) { /* egal */ }
}

/**
 * Die Farbtupfer in der Fußleiste des Spielbildschirms.
 *
 * Die Wahl gehört dorthin, wo man sie beurteilen kann: neben das Spielfeld,
 * nicht auf die Startseite.
 */
function baueFarbwahl() {
  const farbe = ladeFarbe();
  const tupfer = document.getElementById("farb-tupfer");
  if (!tupfer) return;
  tupfer.innerHTML = "";
  for (let i = 0; i < FARB_VORSCHLAEGE.length; i++) {
    const hex = FARB_VORSCHLAEGE[i];
    const f = farbenAus(hex);
    const punkt = document.createElement("button");
    punkt.type = "button";
    punkt.className = "farb-punkt" + (hex.toLowerCase() === farbe.toLowerCase() ? " aktiv" : "");
    // Der Tupfer zeigt gleich das ganze Zusammenspiel: Fläche und Linie.
    punkt.style.background = f.innen;
    punkt.style.boxShadow = "inset 0 0 0 2px " + f.linie;
    punkt.title = "Hintergrund " + hex;
    punkt.addEventListener("click", function () { waehleFarbe(hex); });
    tupfer.appendChild(punkt);
  }
  const frei = document.getElementById("farb-wahl");
  if (frei) frei.value = farbe;
}

/** Übernimmt eine Farbe und zeichnet das laufende Spiel sofort neu. */
function waehleFarbe(hex) {
  setzeFarbe(hex);
  baueFarbwahl();
  if (game) {
    game.farben = farbenAus(hex);
    zeichne();
  }
}

/* ---------------------------------------------------------------
   Motive, eigenes Bild und Einstellungen
   --------------------------------------------------------------- */

/**
 * Die hochgeladenen Bilder als Motiveinträge.
 *
 * Es sind bis zu drei; abgelegt wird eine Liste, damit ein neues Bild die
 * vorhandenen nicht verdrängt. Erst wenn die Liste voll ist, muss eines
 * weichen – dafür trägt jede Kachel ein kleines Kreuz.
 */
function ladeEigeneBilder() {
  try {
    const raw = localStorage.getItem(EIGEN_KEY);
    if (!raw) return [];
    const o = JSON.parse(raw);
    // Frühere Fassung hielt genau ein Bild als Objekt.
    const liste = Array.isArray(o) ? o : (o && o.datenUrl ? [o] : []);
    return liste.filter(function (e) { return e && e.datenUrl; }).slice(0, EIGEN_MAX);
  } catch (e) { return []; }
}

function speichereEigeneBilder(liste) {
  localStorage.setItem(EIGEN_KEY, JSON.stringify(liste));
}

function eigenerEintrag(index, anzahl) {
  return {
    id: "eigen" + index,
    // Der Dateiname sagt beim Puzzeln nichts – die Kachel zeigt ja das Bild.
    titel: anzahl > 1 ? "Eigenes Bild " + (index + 1) : "Eigenes Bild",
    datei: ladeEigeneBilder()[index].datenUrl,
    eigen: true,
    eigenIndex: index,
  };
}

function motivListe() {
  const eigene = ladeEigeneBilder();
  const liste = BILDER.slice();
  for (let i = 0; i < eigene.length; i++) liste.push(eigenerEintrag(i, eigene.length));
  return liste;
}

function motivEintrag(id) {
  const liste = motivListe();
  for (let i = 0; i < liste.length; i++) if (liste[i].id === id) return liste[i];
  return null;
}

/** Entfernt ein eigenes Bild und einen etwaigen Spielstand dazu. */
function loescheEigenesBild(index) {
  const liste = ladeEigeneBilder();
  if (index < 0 || index >= liste.length) return;
  liste.splice(index, 1);
  speichereEigeneBilder(liste);
  // Die Kennungen der nachrückenden Bilder verschieben sich – ein Spielstand
  // zu einem eigenen Bild ist danach nicht mehr eindeutig zuzuordnen.
  const saved = loadSave();
  if (saved && /^eigen/.test(saved.bildId)) clearSave();
}

function gewaehlteTeile() {
  const n = parseInt(localStorage.getItem("puzzleTeileWahl"), 10);
  return TEILE_STUFEN.indexOf(n) >= 0 ? n : TEILE_STUFEN[0];
}

function setzeTeileWahl(n) {
  try { localStorage.setItem("puzzleTeileWahl", String(n)); } catch (e) { /* egal */ }
}

function ladeSchnittArt() {
  const a = localStorage.getItem(SCHNITT_KEY);
  return SCHNITT_ARTEN[a] ? a : "ungewoehnlich";
}

function setzeSchnittArt(name) {
  try { localStorage.setItem(SCHNITT_KEY, name); } catch (e) { /* egal */ }
}

function ladeDrehmodus() {
  return localStorage.getItem(DREH_KEY) === "1";
}

function setzeDrehmodus(an) {
  try { localStorage.setItem(DREH_KEY, an ? "1" : "0"); } catch (e) { /* egal */ }
}

function dateiAlsDatenUrl(datei) {
  return new Promise(function (fertig, fehler) {
    const leser = new FileReader();
    leser.onload = function () { fertig(leser.result); };
    leser.onerror = function () { fehler(new Error("Datei nicht lesbar")); };
    leser.readAsDataURL(datei);
  });
}

/**
 * Nimmt ein hochgeladenes Bild an und legt es ab – das vorige wird ersetzt.
 *
 * Das Bild wird vorher verkleinert und neu kodiert. Ein Foto aus einer
 * Handykamera hat schnell mehrere Megabyte; der Speicher des Browsers fasst
 * insgesamt nur wenige. Reicht es trotzdem nicht, wird die Qualität in
 * Stufen gesenkt, statt kommentarlos zu scheitern.
 */
async function nimmEigenesBild(datei) {
  const roh = await dateiAlsDatenUrl(datei);
  const img = await ladeBild(roh);

  const breite = Math.min(EIGEN_BREITE_MAX, img.naturalWidth);
  const hoehe = Math.round(breite * img.naturalHeight / img.naturalWidth);
  const cv = document.createElement("canvas");
  cv.width = breite; cv.height = hoehe;
  cv.getContext("2d").drawImage(img, 0, 0, breite, hoehe);

  const liste = ladeEigeneBilder();
  if (liste.length >= EIGEN_MAX) {
    throw new Error("Es passen höchstens " + EIGEN_MAX + " eigene Bilder. Lösche zuerst eines über das Kreuz.");
  }

  const stufen = [0.85, 0.7, 0.55, 0.4];
  for (let i = 0; i < stufen.length; i++) {
    const datenUrl = cv.toDataURL("image/jpeg", stufen[i]);
    try {
      speichereEigeneBilder(liste.concat([{ datenUrl: datenUrl }]));
      return true;
    } catch (e) { /* zu groß – nächste Stufe */ }
  }
  throw new Error("Das Bild passt nicht in den Speicher des Browsers.");
}

/* ---------------------------------------------------------------
   Startbildschirm
   --------------------------------------------------------------- */

function baueStartbildschirm() {
  const teile = gewaehlteTeile();

  // Teilezahl
  const stufen = document.getElementById("groessen");
  stufen.innerHTML = "";
  for (let i = 0; i < TEILE_STUFEN.length; i++) {
    const n = TEILE_STUFEN[i];
    const b = document.createElement("button");
    b.className = "groesse-btn" + (n === teile ? " aktiv" : "");
    b.textContent = n + " Teile";
    b.addEventListener("click", function () {
      setzeTeileWahl(n);
      baueStartbildschirm();
    });
    stufen.appendChild(b);
  }

  // Schnittart
  const schnitte = document.getElementById("schnitte");
  const gewaehlt = ladeSchnittArt();
  schnitte.innerHTML = "";
  for (const name in SCHNITT_ARTEN) {
    const art = SCHNITT_ARTEN[name];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "schnitt-btn" + (name === gewaehlt ? " aktiv" : "");
    b.innerHTML = '<span class="schnitt-name"></span><span class="schnitt-sub"></span>';
    b.querySelector(".schnitt-name").textContent = art.name;
    b.querySelector(".schnitt-sub").textContent = art.beschreibung;
    b.addEventListener("click", function () {
      setzeSchnittArt(name);
      baueStartbildschirm();
    });
    schnitte.appendChild(b);
  }

  // Statistik zur gewählten Größe
  const st = statsFuer(teile);
  const zeilen = [
    ["Gespielt", String(st.played)],
    ["Gelegt", String(st.won)],
    ["Bestzeit", st.best === null ? "–" : formatTime(st.best)],
  ];
  const koerper = document.getElementById("stats-table-body");
  koerper.innerHTML = "";
  for (let i = 0; i < zeilen.length; i++) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = zeilen[i][0];
    const td = document.createElement("td");
    td.textContent = zeilen[i][1];
    tr.appendChild(th);
    tr.appendChild(td);
    koerper.appendChild(tr);
  }
  document.getElementById("stats-titel").textContent = teile + " Teile";

  // Drehmodus
  document.getElementById("dreh-toggle").checked = ladeDrehmodus();

  // Motive
  const grid = document.getElementById("motive");
  grid.innerHTML = "";
  const liste = motivListe();
  for (let i = 0; i < liste.length; i++) {
    const b = liste[i];
    const kachel = document.createElement("div");
    kachel.className = "motiv-kachel";

    const knopf = document.createElement("button");
    knopf.className = "motiv-btn";
    knopf.dataset.bild = b.id;

    const bild = document.createElement("img");
    bild.src = b.datei;
    bild.alt = b.titel;
    bild.loading = "lazy";
    // Fehlt die Datei, bleibt die Kachel nutzbar, zeigt aber den Hinweis.
    bild.onerror = function () { knopf.classList.add("fehlt"); };

    const titel = document.createElement("span");
    titel.className = "motiv-titel";
    titel.textContent = b.titel;

    knopf.appendChild(bild);
    knopf.appendChild(titel);
    knopf.addEventListener("click", function () { starteSpiel(b.id, gewaehlteTeile(), null); });
    kachel.appendChild(knopf);

    if (b.eigen) {
      const weg = document.createElement("button");
      weg.className = "motiv-loeschen";
      weg.type = "button";
      weg.title = "Dieses Bild entfernen";
      weg.setAttribute("aria-label", "Dieses Bild entfernen");
      weg.textContent = "×";
      weg.addEventListener("click", function (e) {
        e.stopPropagation();
        loescheEigenesBild(b.eigenIndex);
        baueStartbildschirm();
      });
      kachel.appendChild(weg);
    }
    grid.appendChild(kachel);
  }

  // Kachel zum Hochladen, solange noch Platz ist
  if (ladeEigeneBilder().length < EIGEN_MAX) {
    const kachel = document.createElement("div");
    kachel.className = "motiv-kachel";
    const hoch = document.createElement("button");
    hoch.className = "motiv-btn motiv-upload";
    hoch.innerHTML =
      '<span class="upload-mark">＋</span>' +
      '<span class="motiv-titel">Eigenes Bild</span>';
    hoch.addEventListener("click", function () { document.getElementById("datei").click(); });
    kachel.appendChild(hoch);
    grid.appendChild(kachel);
  }

  const saved = loadSave();
  const weiter = document.getElementById("continue-btn");
  if (saved) {
    const eintrag = motivEintrag(saved.bildId);
    weiter.classList.remove("hidden");
    document.getElementById("continue-meta").textContent =
      (eintrag ? eintrag.titel : "Motiv") + " · " + saved.teile + " Teile · " +
      formatTime(saved.elapsedSeconds || 0);
  } else {
    weiter.classList.add("hidden");
  }
}

/* ---------------------------------------------------------------
   Verdrahtung
   --------------------------------------------------------------- */

function init() {
  canvas = document.getElementById("tisch");
  ctx = canvas.getContext("2d");
  baueStartbildschirm();

  document.getElementById("continue-btn").addEventListener("click", function () {
    const saved = loadSave();
    if (saved) starteSpiel(saved.bildId, null, saved);
  });
  document.getElementById("back-btn").addEventListener("click", zurueckZurUebersicht);
  // Der Titel im Kopf führt ebenfalls zurück auf die Übersicht.
  document.getElementById("game-title").addEventListener("click", zurueckZurUebersicht);
  document.getElementById("restart-btn").addEventListener("click", function () {
    if (game) { const id = game.bildId, z = game.ziel; clearSave(); starteSpiel(id, z, null); }
  });

  document.getElementById("dreh-toggle").addEventListener("change", function () {
    setzeDrehmodus(this.checked);
  });

  document.getElementById("farb-wahl").addEventListener("input", function () {
    waehleFarbe(this.value);
  });
  baueFarbwahl();

  document.getElementById("datei").addEventListener("change", async function () {
    const datei = this.files && this.files[0];
    this.value = "";
    if (!datei) return;
    zeigeHinweis("");
    if (!/^image\//.test(datei.type)) {
      zeigeHinweis("Das war keine Bilddatei.");
      return;
    }
    zeigeLaden(true, "Bild wird übernommen …");
    try {
      await nimmEigenesBild(datei);
      // Ein Spielstand zum alten eigenen Bild wäre jetzt sinnlos.
      const saved = loadSave();
      if (saved && saved.bildId === "eigen") clearSave();
      baueStartbildschirm();
    } catch (e) {
      zeigeHinweis(e && e.message ? e.message : "Das Bild ließ sich nicht übernehmen.");
    } finally {
      zeigeLaden(false);
    }
  });
  document.getElementById("end-again").addEventListener("click", zurueckZurUebersicht);
  document.getElementById("end-back").addEventListener("click", function () {
    document.getElementById("end-overlay").classList.add("hidden");
  });
  document.getElementById("result-btn").addEventListener("click", function () {
    document.getElementById("end-overlay").classList.remove("hidden");
  });

  document.getElementById("preview-btn").addEventListener("click", function () {
    vorschauFest = !vorschauFest;
    this.classList.toggle("primary", vorschauFest);
    zeigeVorschau(vorschauFest);
  });
  document.getElementById("zoom-fit").addEventListener("click", function () {
    if (!game) return;
    zeigeGanzenTisch();
    zeichne();
  });
  document.getElementById("sort-btn").addEventListener("click", function () {
    if (!game || game.fertig) return;
    verteileTeile(game.drehmodus);
    zeichne();
    saveGame();
  });

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // Wird die Taste außerhalb der Leinwand losgelassen, bliebe die Vorschau sonst stehen.
  // Wird die Taste außerhalb der Leinwand losgelassen, bliebe die Vorlage sonst stehen.
  window.addEventListener("pointerup", function (e) {
    if (e.button === 2) zeigeVorschau(false);
  });
  window.addEventListener("blur", function () {
    zeigeVorschau(false);
    // Wird das Fenster gewechselt, kommt das Loslassen der Taste nie an.
    mTaste = false;
    canvas.classList.remove("waehlt");
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Spacebar") {
      // Sonst scrollt die Leertaste die Seite.
      e.preventDefault();
      if (!e.repeat) zeigeVorschau(true);
      return;
    }
    if (e.repeat) return;
    if (e.key === "m" || e.key === "M") {
      mTaste = true;
      canvas.classList.add("waehlt");
    } else if (e.key === "Escape" && game) {
      setzeAuswahl([]);
      zeichne();
    }
  });

  window.addEventListener("keyup", function (e) {
    if (e.key === " " || e.key === "Spacebar") {
      zeigeVorschau(false);
    } else if (e.key === "m" || e.key === "M") {
      mTaste = false;
      canvas.classList.remove("waehlt");
    }
  });

  canvas.addEventListener("wheel", function (e) {
    if (!game) return;
    e.preventDefault();
    const vor = zuTisch(e.clientX, e.clientY);
    const faktor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    game.view.scale = Math.max(0.15, Math.min(4, game.view.scale * faktor));
    // Punkt unter dem Zeiger festhalten
    const r = canvas.getBoundingClientRect();
    game.view.x = e.clientX - r.left - vor.x * game.view.scale;
    game.view.y = e.clientY - r.top - vor.y * game.view.scale;
    zeichne();
  }, { passive: false });

  window.addEventListener("resize", function () {
    if (!game) return;
    passeLeinwandAn(false);
  });
}

document.addEventListener("DOMContentLoaded", init);
