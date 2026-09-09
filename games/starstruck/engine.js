"use strict";

/* =====================================================================
   Starstruck · Rätsel-Engine
   Erzeugt Star-Battle-Rätsel mit garantiert eindeutiger Lösung und
   stellt einen Logik-Solver für Hinweise und Schwierigkeitsbewertung.
   ===================================================================== */

const UNK = 0, STAR = 1, DOT = 2;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/* ---------------------------------------------------------------
   Taktung

   Die Rätselerzeugung ist eine geschlossene Rechenschleife und würde sonst
   dauerhaft einen Kern belegen. Der Pacer zerlegt sie in kurze Arbeits-
   scheiben mit Pausen dazwischen; das Verhältnis steuert die Oberfläche.
   --------------------------------------------------------------- */

function createPacer() {
  let workMs = 0;          // 0 = ohne Pausen durchrechnen
  let restMs = 0;
  let paused = false;
  let effectiveWork = 0;
  let sliceStart = 0;

  return {
    set: function (config) {
      const cfg = config || {};
      workMs = cfg.workMs || 0;
      restMs = cfg.restMs || 0;
      paused = !!cfg.paused;
      effectiveWork = workMs;
      sliceStart = performance.now();
    },
    isPaused: function () { return paused; },
    breathe: async function () {
      while (paused) await sleep(150);
      if (!workMs) return;
      const now = performance.now();
      if (now - sliceStart < effectiveWork) return;

      const before = performance.now();
      await sleep(restMs);
      const actualRest = performance.now() - before;

      // setTimeout schläft grundsätzlich länger als bestellt, und in
      // verborgenen Tabs drosseln Browser auf bis zu eine Sekunde. Die
      // Arbeitsscheibe wird deshalb aus der tatsächlich gemessenen Pause
      // berechnet – so bleibt das gewünschte Verhältnis erhalten, statt
      // still nach unten wegzurutschen. Die Obergrenze verhindert, dass
      // eine stark gedrosselte Pause zu minutenlangen Scheiben führt.
      if (restMs > 0) {
        const ratio = workMs / restMs;
        effectiveWork = Math.min(workMs * 8, Math.max(workMs, actualRest * ratio));
      }
      sliceStart = performance.now();
    },
  };
}

const pacer = createPacer();

/* Nachbarlisten (8er-Nachbarschaft) werden pro Brettgröße einmal gebaut. */
const neighborCache = new Map();
function neighborTable(n) {
  let t = neighborCache.get(n);
  if (t) return t;
  t = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
          out.push(nr * n + nc);
        }
      }
      t.push(out);
    }
  }
  neighborCache.set(n, t);
  return t;
}

/* ---------------------------------------------------------------
   Schritt 1 · Gültige Sternverteilung würfeln
   --------------------------------------------------------------- */

/** Alle Belegungen einer Zeile mit k paarweise nicht benachbarten Spalten. */
const rowMaskCache = new Map();
function rowMasksFor(n, k) {
  const key = n + ":" + k;
  let cached = rowMaskCache.get(key);
  if (cached) return cached;
  const out = [];
  const cols = [];
  (function rec(start, left, mask) {
    if (left === 0) { out.push({ mask: mask, cols: cols.slice() }); return; }
    for (let c = start; c < n; c++) {
      if (cols.length && c - cols[cols.length - 1] < 2) continue;
      cols.push(c);
      rec(c + 1, left - 1, mask | (1 << c));
      cols.pop();
    }
  })(0, k, 0);
  rowMaskCache.set(key, out);
  return out;
}

function generateStarPlacement(n, k) {
  const masks = rowMasksFor(n, k);
  const colCount = new Array(n).fill(0);
  const rows = new Array(n).fill(0);

  function feasible(rowsDone) {
    const left = n - rowsDone;
    for (let c = 0; c < n; c++) {
      if (colCount[c] > k) return false;
      if (k - colCount[c] > left) return false;
    }
    return true;
  }

  function dfs(r, prev) {
    if (r === n) return true;
    const block = prev | (prev << 1) | (prev >> 1);
    const cand = shuffle(masks.slice());
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (e.mask & block) continue;
      let ok = true;
      for (let j = 0; j < e.cols.length; j++) {
        if (colCount[e.cols[j]] >= k) { ok = false; break; }
      }
      if (!ok) continue;
      for (let j = 0; j < e.cols.length; j++) colCount[e.cols[j]]++;
      rows[r] = e.mask;
      if (feasible(r + 1) && dfs(r + 1, e.mask)) return true;
      for (let j = 0; j < e.cols.length; j++) colCount[e.cols[j]]--;
    }
    return false;
  }

  if (!dfs(0, 0)) return null;
  const stars = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (rows[r] & (1 << c)) stars.push(r * n + c);
  }
  return stars;
}

/* ---------------------------------------------------------------
   Schritt 2 · Regionen um die Sterne herum wachsen lassen
   --------------------------------------------------------------- */

function growRegions(n, seeds) {
  const total = n * n;
  const m = seeds.length;
  const owner = new Int16Array(total).fill(-1);
  const size = new Array(m).fill(1);
  const frontier = [];

  for (let i = 0; i < m; i++) { owner[seeds[i]] = i; frontier.push([]); }

  function pushNeighbors(i, idx) {
    const r = (idx / n) | 0, c = idx % n;
    if (r > 0 && owner[idx - n] === -1) frontier[i].push(idx - n);
    if (r < n - 1 && owner[idx + n] === -1) frontier[i].push(idx + n);
    if (c > 0 && owner[idx - 1] === -1) frontier[i].push(idx - 1);
    if (c < n - 1 && owner[idx + 1] === -1) frontier[i].push(idx + 1);
  }
  for (let i = 0; i < m; i++) pushNeighbors(i, seeds[i]);

  let unassigned = total - m;
  while (unassigned > 0) {
    const avail = [];
    for (let i = 0; i < m; i++) {
      if (frontier[i].length) {
        frontier[i] = frontier[i].filter((x) => owner[x] === -1);
        if (frontier[i].length) avail.push(i);
      }
    }
    if (!avail.length) return null;

    let pick;
    if (Math.random() < 0.8) {
      let best = size[avail[0]];
      for (let i = 1; i < avail.length; i++) if (size[avail[i]] < best) best = size[avail[i]];
      const ties = avail.filter((i) => size[i] === best);
      pick = ties[(Math.random() * ties.length) | 0];
    } else {
      pick = avail[(Math.random() * avail.length) | 0];
    }

    const f = frontier[pick];
    const idx = f[(Math.random() * f.length) | 0];
    owner[idx] = pick;
    size[pick]++;
    unassigned--;
    pushNeighbors(pick, idx);
  }
  return owner;
}

/** Für 2 Sterne: je zwei benachbarte Mini-Regionen zu einer Region verschmelzen. */
function mergeMicroRegions(n, owner, count) {
  const adj = [];
  for (let i = 0; i < count; i++) adj.push(new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c, a = owner[idx];
      if (c + 1 < n) { const b = owner[idx + 1]; if (b !== a) { adj[a].add(b); adj[b].add(a); } }
      if (r + 1 < n) { const b = owner[idx + n]; if (b !== a) { adj[a].add(b); adj[b].add(a); } }
    }
  }
  const partner = new Array(count).fill(-1);
  let budget = 200000;

  function dfs() {
    if (--budget < 0) return false;
    let u = -1;
    for (let i = 0; i < count; i++) if (partner[i] === -1) { u = i; break; }
    if (u === -1) return true;
    const opts = shuffle(Array.from(adj[u]).filter((v) => partner[v] === -1));
    for (let i = 0; i < opts.length; i++) {
      const v = opts[i];
      partner[u] = v; partner[v] = u;
      if (dfs()) return true;
      partner[u] = -1; partner[v] = -1;
    }
    return false;
  }

  if (!dfs()) return null;
  const label = new Array(count).fill(-1);
  let next = 0;
  for (let i = 0; i < count; i++) {
    if (label[i] === -1) { label[i] = next; label[partner[i]] = next; next++; }
  }
  const regionOf = new Int16Array(n * n);
  for (let i = 0; i < n * n; i++) regionOf[i] = label[owner[i]];
  return regionOf;
}

/* ---------------------------------------------------------------
   Einheiten (Zeilen, Spalten, Farbfelder)
   --------------------------------------------------------------- */

function buildUnits(n, regionOf, regionNames) {
  const units = [];
  for (let r = 0; r < n; r++) {
    const cells = [];
    for (let c = 0; c < n; c++) cells.push(r * n + c);
    units.push({ type: "row", i: r, cells: cells, name: "Zeile " + (r + 1) });
  }
  for (let c = 0; c < n; c++) {
    const cells = [];
    for (let r = 0; r < n; r++) cells.push(r * n + c);
    units.push({ type: "col", i: c, cells: cells, name: "Spalte " + (c + 1) });
  }
  const regCells = [];
  for (let g = 0; g < n; g++) regCells.push([]);
  for (let i = 0; i < n * n; i++) regCells[regionOf[i]].push(i);
  for (let g = 0; g < n; g++) {
    const label = regionNames && regionNames[g] ? "Farbfeld " + regionNames[g] : "Farbfeld " + (g + 1);
    units.push({ type: "region", i: g, cells: regCells[g], name: label });
  }
  for (let u = 0; u < units.length; u++) units[u].set = new Set(units[u].cells);
  units.rows = units.slice(0, n);
  units.cols = units.slice(n, 2 * n);
  units.regions = units.slice(2 * n, 3 * n);
  units.n = n;
  units.regionOf = regionOf;
  return units;
}

/* ---------------------------------------------------------------
   Logik-Techniken
   --------------------------------------------------------------- */

/**
 * Maximale Anzahl Sterne, die in einer Zeile/Spalte noch Platz finden.
 * Bereits gesetzte Sterne sind Pflicht, `forcedStar` erzwingt zusätzlich
 * einen Stern auf diesem Feld. Rückgabe −1 bedeutet unmöglich.
 */
function maxIndependentInLine(unit, grid, forcedStar) {
  const cells = unit.cells;
  const NEG = -999;
  let noStar = 0, withStar = NEG;
  for (let p = 0; p < cells.length; p++) {
    const cell = cells[p];
    const v = grid[cell];
    const must = v === STAR || cell === forcedStar;
    const can = v === STAR || v === UNK;
    const prevNo = noStar, prevWith = withStar;
    noStar = must ? NEG : (prevNo > prevWith ? prevNo : prevWith);
    withStar = can && prevNo > NEG ? prevNo + 1 : NEG;
  }
  const best = noStar > withStar ? noStar : withStar;
  return best <= NEG ? -1 : best;
}

/**
 * Maximale Anzahl Sterne, die in einer beliebig geformten Einheit noch Platz
 * finden (8er-Nachbarschaft). Bereits gesetzte Sterne sind Pflicht,
 * `forcedStar` erzwingt zusätzlich einen Stern. Rückgabe −1 = unmöglich.
 * Für Zeilen/Spalten ist maxIndependentInLine schneller.
 */
function maxIndependentInUnit(n, unit, grid, forcedStar) {
  const nbTable = neighborTable(n);
  const must = [];
  const pool = [];
  for (let i = 0; i < unit.cells.length; i++) {
    const cell = unit.cells[i];
    const v = grid[cell];
    if (v === STAR || cell === forcedStar) must.push(cell);
    else if (v === UNK) pool.push(cell);
  }

  const blocked = new Set();
  for (let i = 0; i < must.length; i++) {
    const nb = nbTable[must[i]];
    for (let j = 0; j < nb.length; j++) blocked.add(nb[j]);
  }
  for (let i = 0; i < must.length; i++) if (blocked.has(must[i])) return -1;

  const free = pool.filter((c) => !blocked.has(c));
  const idxOf = new Map();
  for (let i = 0; i < free.length; i++) idxOf.set(free[i], i);
  const adj = free.map((c) => {
    const nb = nbTable[c];
    const list = [];
    for (let j = 0; j < nb.length; j++) {
      const t = idxOf.get(nb[j]);
      if (t !== undefined) list.push(t);
    }
    return list;
  });

  const used = new Uint8Array(free.length);
  let best = 0;
  (function rec(pos, count) {
    if (count + (free.length - pos) <= best) return;
    if (pos === free.length) { if (count > best) best = count; return; }
    if (!used[pos]) {
      for (let j = 0; j < adj[pos].length; j++) used[adj[pos][j]]++;
      rec(pos + 1, count + 1);
      for (let j = 0; j < adj[pos].length; j++) used[adj[pos][j]]--;
    }
    rec(pos + 1, count);
  })(0, 0);

  return must.length + best;
}

function collectStats(units, grid, k) {
  const stats = [];
  for (let u = 0; u < units.length; u++) {
    const cells = units[u].cells;
    let stars = 0;
    const unknown = [];
    for (let i = 0; i < cells.length; i++) {
      const v = grid[cells[i]];
      if (v === STAR) stars++; else if (v === UNK) unknown.push(cells[i]);
    }
    stats.push({ stars: stars, unknown: unknown, need: k - stars });
  }
  return stats;
}

/**
 * Verallgemeinerte Überdeckung: Wenn die offenen Felder einer Gruppe von
 * Farbfeldern nur in Zeilen liegen, deren Sternbedarf genau dem Bedarf der
 * Gruppe entspricht, dürfen in diesen Zeilen sonst keine Sterne stehen.
 * Wirkt in beide Richtungen (Farbfeld → Linie und Linie → Farbfeld).
 *
 * `report` wird – falls übergeben – mit der ersten Streichung gefüllt.
 */
function coverRule(units, grid, groupUnits, targetUnits, targetOf, maxSize, report) {
  let changed = false;
  const idx = [];
  const combo = [];

  for (let i = 0; i < groupUnits.length; i++) {
    if (groupUnits[i].__stat.need > 0 && groupUnits[i].__stat.unknown.length) idx.push(i);
  }

  function evaluate() {
    let need = 0;
    const cells = [];
    for (let i = 0; i < combo.length; i++) {
      const st = groupUnits[combo[i]].__stat;
      need += st.need;
      for (let j = 0; j < st.unknown.length; j++) cells.push(st.unknown[j]);
    }
    if (!need || !cells.length) return;

    const targets = new Set();
    for (let i = 0; i < cells.length; i++) targets.add(targetOf(cells[i]));
    let targetNeed = 0;
    targets.forEach((t) => { targetNeed += targetUnits[t].__stat.need; });
    if (targetNeed !== need) return;

    const inGroup = new Set();
    for (let i = 0; i < combo.length; i++) {
      const cellsOfUnit = groupUnits[combo[i]].cells;
      for (let j = 0; j < cellsOfUnit.length; j++) inGroup.add(cellsOfUnit[j]);
    }
    targets.forEach((t) => {
      const st = targetUnits[t].__stat;
      for (let i = 0; i < st.unknown.length; i++) {
        const cell = st.unknown[i];
        if (grid[cell] === UNK && !inGroup.has(cell)) {
          grid[cell] = DOT;
          changed = true;
          if (report && report.idx === undefined) {
            const groupNames = combo.map((c) => groupUnits[c].name).join(" und ");
            const targetNames = Array.from(targets).map((t) => targetUnits[t].name).join(" und ");
            report.idx = cell;
            report.val = DOT;
            report.reason =
              "Alle noch fehlenden Sterne von " + targetNames + " müssen in " + groupNames + " liegen.";
          }
        }
      }
    });
  }

  function rec(start, depth) {
    if (depth > 0) evaluate();
    if (depth === maxSize) return;
    for (let i = start; i < idx.length; i++) {
      combo.push(idx[i]);
      rec(i + 1, depth + 1);
      combo.pop();
    }
  }
  rec(0, 0);
  return changed;
}

/**
 * Wendet die Grundtechniken bis zum Fixpunkt an.
 * level 1 = Nachbarschaft + volle/ausgelastete Einheiten
 * level 2 = zusätzlich Platzprüfung in Zeilen und Spalten
 * level 3 = zusätzlich verallgemeinerte Überdeckung
 * Rückgabe false bei Widerspruch.
 */
function propagate(n, k, units, grid, level, maxCoverSize) {
  const total = n * n;
  const nbTable = neighborTable(n);
  const cover = maxCoverSize || 2;

  for (;;) {
    let changed = false;

    // Regel 1 · neben einem Stern kann kein Stern stehen
    for (let i = 0; i < total; i++) {
      if (grid[i] !== STAR) continue;
      const nb = nbTable[i];
      for (let j = 0; j < nb.length; j++) {
        // Regel 3 kann zwei benachbarte Felder gleichzeitig zu Sternen machen;
        // ohne diese Prüfung bliebe der Widerspruch unentdeckt.
        if (grid[nb[j]] === STAR) return false;
        if (grid[nb[j]] === UNK) { grid[nb[j]] = DOT; changed = true; }
      }
    }

    // Regeln 2 und 3 · Einheit voll bzw. Einheit exakt ausgelastet
    for (let u = 0; u < units.length; u++) {
      const cells = units[u].cells;
      let stars = 0, unk = 0;
      for (let i = 0; i < cells.length; i++) {
        const v = grid[cells[i]];
        if (v === STAR) stars++; else if (v === UNK) unk++;
      }
      if (stars > k) return false;
      if (stars + unk < k) return false;
      if (unk === 0) continue;
      if (stars === k) {
        for (let i = 0; i < cells.length; i++) if (grid[cells[i]] === UNK) grid[cells[i]] = DOT;
        changed = true;
      } else if (unk === k - stars) {
        for (let i = 0; i < cells.length; i++) if (grid[cells[i]] === UNK) grid[cells[i]] = STAR;
        changed = true;
      }
    }
    if (changed) continue;
    if (level < 2) return true;

    // Regel 4 · Nachbarschaftskapazität in Zeilen und Spalten
    for (let u = 0; u < 2 * n; u++) {
      const unit = units[u];
      if (maxIndependentInLine(unit, grid, -1) < k) return false;
      for (let i = 0; i < unit.cells.length; i++) {
        const cell = unit.cells[i];
        if (grid[cell] !== UNK) continue;
        if (maxIndependentInLine(unit, grid, cell) < k) { grid[cell] = DOT; changed = true; }
      }
    }
    if (changed) continue;

    if (level < 3) return true;

    // Regel 4b · Nachbarschaftskapazität innerhalb der Farbfelder
    for (let u = 2 * n; u < 3 * n; u++) {
      const unit = units[u];
      if (maxIndependentInUnit(n, unit, grid, -1) < k) return false;
      for (let i = 0; i < unit.cells.length; i++) {
        const cell = unit.cells[i];
        if (grid[cell] !== UNK) continue;
        if (maxIndependentInUnit(n, unit, grid, cell) < k) { grid[cell] = DOT; changed = true; }
      }
    }
    if (changed) continue;

    // Regel 5 · verallgemeinerte Überdeckung
    const stats = collectStats(units, grid, k);
    for (let u = 0; u < units.length; u++) units[u].__stat = stats[u];
    const rowOf = (cell) => (cell / n) | 0;
    const colOf = (cell) => cell % n;
    const regOf = (cell) => units.regionOf[cell];

    if (coverRule(units, grid, units.regions, units.rows, rowOf, cover)) continue;
    if (coverRule(units, grid, units.regions, units.cols, colOf, cover)) continue;
    if (coverRule(units, grid, units.rows, units.regions, regOf, cover)) continue;
    if (coverRule(units, grid, units.cols, units.regions, regOf, cover)) continue;

    return true;
  }
}

function gridComplete(grid) {
  for (let i = 0; i < grid.length; i++) if (grid[i] === UNK) return false;
  return true;
}

/**
 * Eine Runde Widerspruchsprobe: Jedes offene Feld testweise mit einem Stern
 * belegen; führt das zum Widerspruch, muss dort ein Kreuz stehen.
 */
function contradictionSweep(n, k, units, grid) {
  let changed = false;
  for (let i = 0; i < n * n; i++) {
    if (grid[i] !== UNK) continue;
    const test = Uint8Array.from(grid);
    test[i] = STAR;
    if (!propagate(n, k, units, test, 3, 2)) { grid[i] = DOT; changed = true; }
  }
  return changed;
}

/**
 * Misst, wie viel Aufwand das Lösen kostet.
 * Rückgabe: { solved, probeRounds } – probeRounds ist die Anzahl nötiger
 * Widerspruchsproben; 0 heißt: reine Grundtechniken genügen.
 */
function measureDifficulty(n, k, regionOf) {
  const units = buildUnits(n, regionOf);
  const grid = new Uint8Array(n * n);
  if (!propagate(n, k, units, grid, 3, 3)) return { solved: false, probeRounds: 0 };
  if (gridComplete(grid)) return { solved: true, probeRounds: 0 };

  for (let round = 1; round <= n * n; round++) {
    if (!contradictionSweep(n, k, units, grid)) break;
    if (!propagate(n, k, units, grid, 3, 3)) return { solved: false, probeRounds: round };
    if (gridComplete(grid)) return { solved: true, probeRounds: round };
  }
  return { solved: false, probeRounds: -1 };
}

/* ---------------------------------------------------------------
   Exakter Solver mit Constraint-Propagation
   --------------------------------------------------------------- */

/**
 * Sucht bis zu `limit` Lösungen. Da nach jeder Verzweigung propagiert wird,
 * bleibt der Suchbaum klein genug, um Eindeutigkeit wirklich zu beweisen.
 */
function solveExact(n, k, units, limit, nodeCap, level) {
  const solutions = [];
  const lv = level || 3;
  let nodes = 0, aborted = false;

  function rec(grid) {
    if (aborted || solutions.length >= limit) return;
    if (++nodes > nodeCap) { aborted = true; return; }
    if (!propagate(n, k, units, grid, lv, 2)) return;

    let bestCell = -1, bestCount = Infinity;
    for (let u = 0; u < units.length; u++) {
      const cells = units[u].cells;
      let stars = 0, unk = 0, first = -1;
      for (let i = 0; i < cells.length; i++) {
        const v = grid[cells[i]];
        if (v === STAR) stars++;
        else if (v === UNK) { unk++; if (first < 0) first = cells[i]; }
      }
      if (stars < k && unk > 0 && unk < bestCount) { bestCount = unk; bestCell = first; }
    }

    if (bestCell === -1) {
      const cells = [];
      for (let i = 0; i < n * n; i++) if (grid[i] === STAR) cells.push(i);
      solutions.push(cells);
      return;
    }

    const withStar = Uint8Array.from(grid);
    withStar[bestCell] = STAR;
    rec(withStar);
    if (aborted || solutions.length >= limit) return;
    const withDot = Uint8Array.from(grid);
    withDot[bestCell] = DOT;
    rec(withDot);
  }

  rec(new Uint8Array(n * n));
  return { solutions: solutions, aborted: aborted, nodes: nodes };
}

/* ---------------------------------------------------------------
   Zusammenhang von Regionen
   --------------------------------------------------------------- */

function isRegionConnected(n, regionOf, g) {
  const total = n * n;
  let start = -1, size = 0;
  for (let i = 0; i < total; i++) if (regionOf[i] === g) { size++; if (start < 0) start = i; }
  if (start < 0) return false;
  const seen = new Uint8Array(total);
  const stack = [start];
  seen[start] = 1;
  let reached = 1;
  while (stack.length) {
    const idx = stack.pop();
    const r = (idx / n) | 0, c = idx % n;
    if (r > 0 && regionOf[idx - n] === g && !seen[idx - n]) { seen[idx - n] = 1; reached++; stack.push(idx - n); }
    if (r < n - 1 && regionOf[idx + n] === g && !seen[idx + n]) { seen[idx + n] = 1; reached++; stack.push(idx + n); }
    if (c > 0 && regionOf[idx - 1] === g && !seen[idx - 1]) { seen[idx - 1] = 1; reached++; stack.push(idx - 1); }
    if (c < n - 1 && regionOf[idx + 1] === g && !seen[idx + 1]) { seen[idx + 1] = 1; reached++; stack.push(idx + 1); }
  }
  return reached === size;
}

/* ---------------------------------------------------------------
   Hinweise
   --------------------------------------------------------------- */

/**
 * Sucht den nächsten logisch ableitbaren Schritt ab dem übergebenen Stand.
 * Rückgabe: { idx, val, reason } · { contradiction: true } · null
 */
function logicNextStep(n, k, units, grid) {
  const total = n * n;
  const nbTable = neighborTable(n);

  // Regel 1
  for (let i = 0; i < total; i++) {
    if (grid[i] !== STAR) continue;
    const nb = nbTable[i];
    for (let j = 0; j < nb.length; j++) {
      if (grid[nb[j]] === UNK) {
        return { idx: nb[j], val: DOT, reason: "Direkt neben einem Stern kann kein weiterer Stern stehen." };
      }
    }
  }

  const stats = collectStats(units, grid, k);
  for (let u = 0; u < units.length; u++) {
    if (stats[u].stars > k) return { contradiction: true };
    if (stats[u].stars + stats[u].unknown.length < k) return { contradiction: true };
    units[u].__stat = stats[u];
  }

  // Regel 2 · Einheit ist voll
  for (let u = 0; u < units.length; u++) {
    if (stats[u].need === 0 && stats[u].unknown.length) {
      return {
        idx: stats[u].unknown[0],
        val: DOT,
        reason: units[u].name + " hat schon " + k + (k === 1 ? " Stern" : " Sterne") + " – hier kann keiner mehr stehen.",
      };
    }
  }

  // Regel 3 · genau so viele freie Felder wie fehlende Sterne
  for (let u = 0; u < units.length; u++) {
    const need = stats[u].need;
    if (need > 0 && stats[u].unknown.length === need) {
      return {
        idx: stats[u].unknown[0],
        val: STAR,
        reason: "In " + units[u].name + " bleiben nur noch " + need + " freie Felder für " + need + (need === 1 ? " Stern" : " Sterne") + ".",
      };
    }
  }

  // Regel 4 · Platzprüfung in Zeile/Spalte
  for (let u = 0; u < 2 * n; u++) {
    const unit = units[u];
    if (stats[u].need <= 0) continue;
    if (maxIndependentInLine(unit, grid, -1) < k) return { contradiction: true };
    for (let i = 0; i < stats[u].unknown.length; i++) {
      const cell = stats[u].unknown[i];
      if (maxIndependentInLine(unit, grid, cell) < k) {
        return {
          idx: cell,
          val: DOT,
          reason: "Ein Stern hier lässt in " + unit.name + " nicht mehr genug Platz für die übrigen Sterne.",
        };
      }
    }
  }

  // Regel 5 · verallgemeinerte Überdeckung
  const rowOf = (cell) => (cell / n) | 0;
  const colOf = (cell) => cell % n;
  const regOf = (cell) => units.regionOf[cell];
  const probes = [
    [units.regions, units.rows, rowOf],
    [units.regions, units.cols, colOf],
    [units.rows, units.regions, regOf],
    [units.cols, units.regions, regOf],
  ];
  for (let p = 0; p < probes.length; p++) {
    const report = {};
    const probe = Uint8Array.from(grid);
    if (coverRule(units, probe, probes[p][0], probes[p][1], probes[p][2], 3, report) && report.idx !== undefined) {
      return { idx: report.idx, val: report.val, reason: report.reason };
    }
  }

  // Regel 6 · Widerspruchsprobe
  for (let i = 0; i < total; i++) {
    if (grid[i] !== UNK) continue;
    const test = Uint8Array.from(grid);
    test[i] = STAR;
    if (!propagate(n, k, units, test, 3, 2)) {
      return {
        idx: i,
        val: DOT,
        reason: "Ein Stern hier führt ein paar Schritte weiter zwangsläufig zu einem Widerspruch.",
      };
    }
  }

  return null;
}

/* ---------------------------------------------------------------
   Rätsel bauen
   --------------------------------------------------------------- */

function buildCandidate(n, k) {
  const stars = generateStarPlacement(n, k);
  if (!stars) return null;
  const owner = growRegions(n, stars.slice());
  if (!owner) return null;
  if (k === 1) return { stars: stars, regionOf: Int16Array.from(owner) };
  const regionOf = mergeMicroRegions(n, owner, stars.length);
  if (!regionOf) return null;
  return { stars: stars, regionOf: regionOf };
}

const SAMPLE_SOLUTIONS = 30;
const ENDGAME_AT = 6;

/** Erlaubte Zielregionen für eine Zelle (Zusammenhang bleibt gewahrt). */
function targetsFor(n, regionOf, x, sizes, minRegionSize) {
  const g = regionOf[x];
  if (sizes[g] <= minRegionSize) return [];
  const r = (x / n) | 0, c = x % n;
  const cand = [];
  if (r > 0) cand.push(regionOf[x - n]);
  if (r < n - 1) cand.push(regionOf[x + n]);
  if (c > 0) cand.push(regionOf[x - 1]);
  if (c < n - 1) cand.push(regionOf[x + 1]);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < cand.length; i++) {
    const t = cand[i];
    if (t === g || seen.has(t)) continue;
    seen.add(t);
    regionOf[x] = t;
    if (isRegionConnected(n, regionOf, g)) out.push(t);
    regionOf[x] = g;
  }
  return out;
}

/** Zellen nach ihrem Nutzen sortieren: Wie oft tragen sie in Rivalen einen Stern? */
function rankRivalCells(solutions, wantedSet) {
  const score = new Map();
  for (let i = 0; i < solutions.length; i++) {
    const s = solutions[i];
    let isRival = false;
    for (let j = 0; j < s.length; j++) if (!wantedSet.has(s[j])) { isRival = true; break; }
    if (!isRival) continue;
    for (let j = 0; j < s.length; j++) {
      if (wantedSet.has(s[j])) continue;
      score.set(s[j], (score.get(s[j]) || 0) + 1);
    }
  }
  return shuffle(Array.from(score.keys())).sort((a, b) => score.get(b) - score.get(a));
}

/**
 * Repariert einen Kandidaten, bis die Lösung eindeutig ist.
 *
 * Die Wunschlösung bleibt dabei immer gültig, weil ihre Sternzellen nie die
 * Region wechseln – jeder Zug kann also höchstens Rivalen beseitigen.
 * Ohne Tabu-Liste zykelt die Suche allerdings: Dieselbe Zelle wandert immer
 * wieder hin und her. Deshalb sind zuletzt bewegte Zellen kurzzeitig gesperrt,
 * der bisher beste Stand wird gesichert, und im Endspiel werden Züge vor dem
 * Festlegen durchgerechnet.
 */
async function makeUnique(n, k, cand, maxRounds, nodeCap) {
  const wantedSet = new Set(cand.stars);
  const minRegionSize = k === 1 ? 3 : 5;
  const regionOf = cand.regionOf;
  const tabuLen = Math.max(8, Math.round(n * 1.2));
  const tabu = [];
  const tabuSet = new Set();
  let best = null, bestCount = Infinity, stale = 0;

  function solveNow(limit) {
    const units = buildUnits(n, regionOf);
    let res = solveExact(n, k, units, limit, nodeCap, 1);
    if (res.aborted) res = solveExact(n, k, units, limit, nodeCap * 4, 3);
    return res;
  }

  function commit(x, target) {
    regionOf[x] = target;
    tabu.push(x);
    tabuSet.add(x);
    while (tabu.length > tabuLen) tabuSet.delete(tabu.shift());
  }

  for (let round = 0; round < maxRounds; round++) {
    // Eine Runde dauert wenige Millisekunden – der passende Ort, um der
    // Oberfläche regelmäßig Luft zu lassen.
    await pacer.breathe();
    const res = solveNow(SAMPLE_SOLUTIONS);
    if (res.aborted || res.solutions.length === 0) return false;
    const count = res.solutions.length;
    if (count === 1) {
      // Wie mühsam die Reparatur war, sagt später etwas über die
      // Schwierigkeit aus – deshalb am Kandidaten festhalten.
      cand.repairRounds = round;
      return true;
    }

    if (count < bestCount) {
      bestCount = count;
      best = regionOf.slice();
      stale = 0;
    } else if (++stale > 50 && best) {
      regionOf.set(best);
      stale = 0;
      tabu.length = 0;
      tabuSet.clear();
      continue;
    }

    const ranked = rankRivalCells(res.solutions, wantedSet);
    if (!ranked.length) return false;
    const sizes = new Array(n).fill(0);
    for (let i = 0; i < n * n; i++) sizes[regionOf[i]]++;

    // Endspiel: wenige Lösungen übrig – jetzt lohnt es, Züge durchzurechnen.
    if (count <= ENDGAME_AT) {
      let bestCell = -1, bestTarget = -1, bestScore = count, tested = 0;
      for (let i = 0; i < ranked.length && tested < 6; i++) {
        const x = ranked[i];
        const targets = targetsFor(n, regionOf, x, sizes, minRegionSize);
        if (!targets.length) continue;
        tested++;
        const g = regionOf[x];
        for (let j = 0; j < targets.length; j++) {
          regionOf[x] = targets[j];
          const probe = solveNow(SAMPLE_SOLUTIONS);
          const cnt = probe.aborted ? Infinity : probe.solutions.length;
          regionOf[x] = g;
          if (cnt < bestScore) { bestScore = cnt; bestCell = x; bestTarget = targets[j]; }
        }
      }
      if (bestCell >= 0) { commit(bestCell, bestTarget); continue; }
    }

    // Sonst: die nützlichste nicht gesperrte Zelle verschieben.
    let moved = false;
    for (let i = 0; i < ranked.length && !moved; i++) {
      const x = ranked[i];
      if (tabuSet.has(x)) continue;
      const targets = targetsFor(n, regionOf, x, sizes, minRegionSize);
      if (!targets.length) continue;
      commit(x, targets[(Math.random() * targets.length) | 0]);
      moved = true;
    }
    if (moved) continue;

    // Sackgasse: irgendeine Zelle bewegen, um die Formen aufzulockern.
    const shake = shuffle(Array.from({ length: n * n }, (_, i) => i));
    for (let i = 0; i < shake.length; i++) {
      const x = shake[i];
      if (wantedSet.has(x) || tabuSet.has(x)) continue;
      const targets = targetsFor(n, regionOf, x, sizes, minRegionSize);
      if (!targets.length) continue;
      commit(x, targets[(Math.random() * targets.length) | 0]);
      moved = true;
      break;
    }
    if (!moved) return false;
  }
  return false;
}

/**
 * Erzeugt ein Rätsel mit eindeutiger Lösung.
 *
 * `spec` legt die gewünschte Tiefe fest: `minProbes`/`maxProbes` grenzen ein,
 * wie oft man beim Lösen vorausdenken muss (0 = reine Grundtechniken genügen).
 * Passt bis zum Ablauf des Zeitbudgets nichts, wird – sofern `spec.strict`
 * nicht gesetzt ist – das beste lösbare Rätsel zurückgegeben.
 */
/* ---------------------------------------------------------------
   Nachpolieren

   Ein eindeutiges Rätsel kostet Sekunden. Verfehlt es die Wunschtiefe, liegt
   es meist nur wenige Zellverschiebungen daneben – nachbessern ist deutlich
   billiger, als die ganze Arbeit wegzuwerfen und neu anzufangen.
   --------------------------------------------------------------- */

/** Abstand zum Zielbereich; null bedeutet "mit unseren Techniken unlösbar". */
function depthMiss(probeRounds, minProbes, maxProbes) {
  if (probeRounds === null) return 20;
  if (probeRounds < minProbes) return minProbes - probeRounds;
  if (probeRounds > maxProbes) return probeRounds - maxProbes;
  return 0;
}

/** Verschiebt eine zufällige Nicht-Stern-Zelle in eine Nachbarregion. */
function randomMove(n, regionOf, wantedSet, minRegionSize) {
  const sizes = new Array(n).fill(0);
  for (let i = 0; i < n * n; i++) sizes[regionOf[i]]++;
  const order = shuffle(Array.from({ length: n * n }, (_, i) => i));
  for (let i = 0; i < order.length; i++) {
    const x = order[i];
    if (wantedSet.has(x)) continue;
    const targets = targetsFor(n, regionOf, x, sizes, minRegionSize);
    if (!targets.length) continue;
    const from = regionOf[x];
    regionOf[x] = targets[(Math.random() * targets.length) | 0];
    return { cell: x, from: from };
  }
  return null;
}

/**
 * Schiebt die Schwierigkeit eines bereits eindeutigen Rätsels in Richtung
 * Zielbereich. Züge, die die Eindeutigkeit brechen oder es verschlimmern,
 * werden zurückgenommen; gleich gute werden angenommen, damit die Suche
 * nicht auf einer Ebene festsitzt.
 */
async function polishTowards(n, k, cand, minProbes, maxProbes, maxMoves, nodeCap) {
  const wantedSet = new Set(cand.stars);
  const minRegionSize = k === 1 ? 3 : 5;
  let bestRegions = cand.regionOf.slice();
  let bestProbes = cand.probeRounds;
  let bestMiss = depthMiss(bestProbes, minProbes, maxProbes);

  for (let i = 0; i < maxMoves && bestMiss > 0; i++) {
    await pacer.breathe();
    const move = randomMove(n, cand.regionOf, wantedSet, minRegionSize);
    if (!move) break;

    const units = buildUnits(n, cand.regionOf);
    const res = solveExact(n, k, units, 2, nodeCap, 1);
    if (res.aborted || res.solutions.length !== 1) {
      cand.regionOf[move.cell] = move.from;
      continue;
    }

    const diff = measureDifficulty(n, k, cand.regionOf);
    const probes = diff.solved ? diff.probeRounds : null;
    const miss = depthMiss(probes, minProbes, maxProbes);
    if (miss <= bestMiss) {
      bestMiss = miss;
      bestProbes = probes;
      bestRegions = cand.regionOf.slice();
    } else {
      cand.regionOf[move.cell] = move.from;
    }
  }

  cand.regionOf.set(bestRegions);
  cand.probeRounds = bestProbes;
  return bestMiss === 0;
}

function inRange(value, min, max) {
  return value !== null && value >= min && value <= max;
}

/* So viele Nachbesserungszüge lohnen sich, bevor ein neuer Kandidat billiger ist. */
const POLISH_MOVES = 10;

/** Reicht das Rätsel an eine passende verwandte Stufe weiter. */
function donate(cand, siblings, onBonus) {
  if (!onBonus || cand.probeRounds === null) return false;
  for (let i = 0; i < siblings.length; i++) {
    if (inRange(cand.probeRounds, siblings[i].minProbes, siblings[i].maxProbes)) {
      onBonus(siblings[i].modeKey, cand);
      return true;
    }
  }
  return false;
}

async function generatePuzzle(n, k, spec, timeBudgetMs) {
  const deadline = performance.now() + (timeBudgetMs || 8000);
  const nodeCap = 20000;
  const minProbes = spec && spec.minProbes !== undefined ? spec.minProbes : 0;
  const maxProbes = spec && spec.maxProbes !== undefined ? spec.maxProbes : 99;
  // Stufen mit gleicher Brettgröße und Sternzahl, für die ein hier verworfener
  // Kandidat trotzdem taugt.
  const siblings = (spec && spec.siblings) || [];
  const onBonus = spec && spec.onBonus;
  const polishMoves = spec && spec.polishMoves !== undefined ? spec.polishMoves : POLISH_MOVES;
  let fallback = null, fallbackMiss = Infinity;

  while (performance.now() < deadline) {
    await pacer.breathe();
    const cand = buildCandidate(n, k);
    // Eine Sackgasse ist billiger neu gewürfelt als weiter repariert.
    if (!cand || !(await makeUnique(n, k, cand, 400, nodeCap))) continue;

    const diff = measureDifficulty(n, k, cand.regionOf);
    cand.probeRounds = diff.solved ? diff.probeRounds : null;
    if (diff.solved && inRange(cand.probeRounds, minProbes, maxProbes)) return cand;

    // Die teure Arbeit ist schon bezahlt – passt das Rätsel zu einer
    // verwandten Stufe, wird es dort verwertet statt weggeworfen.
    if (donate(cand, siblings, onBonus)) continue;

    // Sonst nachbessern statt neu anfangen – aber nur bei Rätseln, die unsere
    // Techniken überhaupt lösen. Bei den übrigen ist die Politur gemessen
    // dreimal so teuer und rettet nichts (0 von 12 in der Messreihe).
    if (polishMoves && cand.probeRounds !== null) {
      if (await polishTowards(n, k, cand, minProbes, maxProbes, polishMoves, nodeCap)) return cand;
      if (donate(cand, siblings, onBonus)) continue;
    }

    if (cand.probeRounds === null) continue;
    const miss = depthMiss(cand.probeRounds, minProbes, maxProbes);
    if (miss < fallbackMiss) { fallbackMiss = miss; fallback = cand; }
  }
  return spec && spec.strict ? null : fallback;
}

/* ---------------------------------------------------------------
   Farbzuweisung: benachbarte Regionen bekommen verschiedene Farben
   --------------------------------------------------------------- */

/**
 * Jede Region bekommt eine eigene Farbe – gleiche Farben für getrennte
 * Regionen würden auf dem Brett wie ein zusammenhängendes Feld aussehen.
 * Die Farbtöne werden so verteilt, dass Nachbarregionen möglichst weit
 * auseinanderliegen.
 */
function regionPalette(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push("hsl(" + slotHue(i, count) + " " + slotSat(i) + "% " + slotLight(i) + "%)");
  }
  return out;
}

function slotHue(slot, count) { return Math.round((360 * slot) / count); }

/* Pastellige, zurückgenommene Töne – das Brett soll ruhig wirken, nicht bunt
   schreien. Die Helligkeit wechselt zwischen benachbarten Tönen trotzdem
   deutlich, damit auch zwei Grüntöne nebeneinander unterscheidbar bleiben. */
function slotLight(slot) { return 70 + (slot % 3) * 8; }
function slotSat(slot) { return 30 + (slot % 2) * 14; }

function colorRegions(n, regionOf) {
  const adj = [];
  for (let g = 0; g < n; g++) adj.push(new Set());
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c, a = regionOf[idx];
      if (c + 1 < n) { const b = regionOf[idx + 1]; if (b !== a) { adj[a].add(b); adj[b].add(a); } }
      if (r + 1 < n) { const b = regionOf[idx + n]; if (b !== a) { adj[a].add(b); adj[b].add(a); } }
    }
  }

  const palette = regionPalette(n);

  /* Abstand zweier Farbtöpfe: Farbwinkel plus Helligkeitsunterschied. */
  function slotDistance(a, b) {
    const raw = Math.abs(slotHue(a, n) - slotHue(b, n)) % 360;
    const hue = raw > 180 ? 360 - raw : raw;
    return hue + 3 * Math.abs(slotLight(a) - slotLight(b));
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => adj[y].size - adj[x].size);
  const slotOf = new Array(n).fill(-1);
  const taken = new Array(n).fill(false);

  for (let oi = 0; oi < order.length; oi++) {
    const g = order[oi];
    let bestSlot = -1, bestScore = -1;
    for (let slot = 0; slot < n; slot++) {
      if (taken[slot]) continue;
      // Abstand zur ähnlichsten bereits vergebenen Nachbarfarbe
      let score = Infinity;
      adj[g].forEach((h) => {
        if (slotOf[h] < 0) return;
        const d = slotDistance(slot, slotOf[h]);
        if (d < score) score = d;
      });
      if (score === Infinity) score = 9999;
      if (score > bestScore) { bestScore = score; bestSlot = slot; }
    }
    slotOf[g] = bestSlot;
    taken[bestSlot] = true;
  }

  return {
    colors: slotOf.map((slot) => palette[slot]),
    names: slotOf.map((slot) => slotName(slot, n)),
  };
}

/* Die Farbtöne liegen gleichmäßig auf dem Farbkreis, deshalb lassen sich die
   Namen direkt aus der Position ableiten. Für n ≤ 14 bleiben sie eindeutig. */
const HUE_NAMES = [
  "Rot", "Orange", "Gold", "Gelb", "Limette", "Grün", "Smaragd",
  "Türkis", "Cyan", "Himmelblau", "Blau", "Violett", "Magenta", "Pink",
];

function slotName(slot, n) {
  const i = Math.round((slot * HUE_NAMES.length) / n);
  return HUE_NAMES[Math.min(HUE_NAMES.length - 1, i)];
}
