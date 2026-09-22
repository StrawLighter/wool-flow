#!/usr/bin/env node
/* Level generator for all 100 levels.
 *
 *   node tools/gen.js              # regenerate js/levels.js
 *   node tools/gen.js --check      # re-verify every level in js/levels.js is solvable
 *   node tools/gen.js --from 11    # only regenerate levels >= 11 (keeps earlier ones)
 *
 * Levels 1-10 come from tools/pictures.js (the launch set). Levels 11-100 mix hand
 * motifs (tools/motifs.js) with procedural knit patterns (tools/patterns.js) and
 * layer in the mechanics chapter by chapter, mirroring Colony Flow's ladder:
 *
 *   ch 2  Wrapped Up        mystery balls (colour hidden until played)
 *   ch 3  Tied Together     tied balls (2, later 3) that play as a group
 *   ch 4  The Knitting Bag  bags that dispense a hidden queue one ball at a time
 *   ch 5  Lost Needles      knotted balls unlocked by pulling the stitch hiding a needle
 *   ch 6  Zip It            zipped patches that open after N of one colour is pulled
 *   ch 7-10                 everything combined, deeper piles, bigger boards
 */
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const PICS = require('./pictures.js');
const MOTIFS = require('./motifs.js');
const PAT = require('./patterns.js');

const CHAPTERS = ['Cosy Corner', 'Wrapped Up', 'Tied Together', 'The Knitting Bag', 'Lost Needles', 'Zip It', 'Tangle Tangle', 'Deep Wool', 'Master Knitter', 'Grand Tapestry'];
const HINTS = {
  12: 'WRAPPED balls hide their colour until they land on a cushion. Play them when you have room to be surprised.',
  21: 'TIED balls play together: tapping one sends the whole bundle to the cushions. You need a free cushion for each.',
  26: 'Some bundles are three balls. Count your cushions first.',
  31: 'The KNITTING BAG only lets you take the ball at the front. Take it and the next one pops out.',
  41: 'KNOTTED balls stay shut until you pull the stitch hiding their needle. Look for the needle on the picture.',
  51: 'ZIPPED patches cannot be unravelled until enough of the tag colour has been pulled elsewhere.',
  61: 'Tangled, wrapped and tied at once. Read the whole pile before you tap.',
  71: 'Deep piles: the balls you need most are buried. Dig with what is loose.',
  81: 'Two bags, two zips, three-ball bundles. Master knitters plan five moves ahead.',
  91: 'The grand tapestry. Every mechanic, every colour. Take your time.',
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (arr, rng) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

function scaleGrid(rows, k) {
  if (!k || k === 1) return rows;
  const out = [];
  for (const r of rows) { const row = r.split('').map(ch => ch.repeat(k)).join(''); for (let i = 0; i < k; i++) out.push(row); }
  return out;
}

function splitCount(total, min, max, rng) {
  const chunks = [];
  let left = total;
  while (left > 0) {
    if (left <= max) { chunks.push(left); break; }
    let c = min + Math.floor(rng() * (max - min + 1));
    if (left - c < min) c = left - min;
    chunks.push(c); left -= c;
  }
  return chunks;
}

/* ---------- per-level recipe ---------- */
function recipe(n) {
  const ch = Math.ceil(n / 10);            // chapter 1..10
  const pos = (n - 1) % 10;                // 0..9 within the chapter
  const late = pos >= 7;
  const r = {
    n, ch, chapter: CHAPTERS[ch - 1],
    chunk: ch <= 2 ? [6, 14] : ch <= 4 ? [7, 16] : ch <= 6 ? [8, 18] : [8, 20],
    tangled: ch === 2 ? (pos >= 3 ? 1 : 0) : ch <= 4 ? 2 : ch <= 6 ? 3 : late ? 6 : 4,
    mystery: n >= 12 ? (ch === 2 ? 2 : ch <= 5 ? 2 : late ? 5 : 3) : 0,
    ties: n >= 21 ? (ch === 3 ? (pos >= 5 ? 2 : 1) : ch <= 6 ? 1 : late ? 3 : 2) : 0,
    tieSize: n >= 26 && (n % 3 === 2 || ch >= 8) ? 3 : 2,
    bags: n >= 31 ? (ch === 4 ? 1 : ch <= 7 ? 1 : late ? 2 : 1) : 0,
    bagSize: ch >= 8 ? 4 : 3,
    locks: n >= 41 ? (ch === 5 ? (pos >= 5 ? 2 : 1) : ch <= 7 ? 1 : late ? 3 : 2) : 0,
    zips: n >= 51 ? (ch === 6 ? (pos >= 6 ? 2 : 1) : ch <= 8 ? 1 : 2) : 0,
    colours: Math.min(7, 3 + Math.floor((n - 11) / 15) + (pos >= 5 ? 1 : 0)),
    boardW: ch <= 2 ? [14, 20] : ch <= 4 ? [18, 24] : ch <= 7 ? [20, 26] : [24, 28],
    // random-play win-rate band: gently down across the game, dipping at chapter ends
    target: (() => { const hi = Math.max(0.12, 0.8 - (ch - 2) * 0.085 - pos * 0.01); return [Math.max(0.02, hi - 0.3), hi]; })(),
    naiveMustFail: n >= 13,
    hint: HINTS[n] || null,
  };
  return r;
}

/* ---------- picture choice ---------- */
const PALETTE_KEYS = Object.keys(E.PALETTE).filter(k => k !== 'W');
function pickColours(rng, k) { const c = shuffle(PALETTE_KEYS.slice(), rng).slice(0, k); return c; }

function choosePicture(n, rc, rng) {
  // showcase motifs on x5 and x0, otherwise alternate motif / pattern
  const useMotif = n % 5 === 0 || n % 2 === 1;
  if (useMotif) {
    const m = MOTIFS[(n * 7 + Math.floor(n / 10)) % MOTIFS.length];
    let base = m.grid; const w = Math.max(...base.map(r => r.length));
    let scale = 1; while (w * scale < rc.boardW[0]) scale++;
    if (w * scale > rc.boardW[1] + 4 && scale > 1) scale--;
    return { name: m.name, grid: scaleGrid(base, scale) };
  }
  const name = PAT.NAMES[(n * 11 + 3) % PAT.NAMES.length];
  const w = ri(rng, rc.boardW[0], rc.boardW[1]); const h = ri(rng, Math.round(w * 0.9), Math.round(w * 1.15));
  const cols = pickColours(rng, Math.max(3, Math.min(rc.colours, 5)));
  return { name, grid: PAT.makePattern(name, rng, w, h, cols) };
}

/* ---------- pile construction ---------- */
function buildItems(pic, rc, rng) {
  const grid = E.parseGrid(pic.grid);
  const counts = E.countColours(grid);
  let chunks = [];
  for (const colour of Object.keys(counts))
    for (const c of splitCount(counts[colour], rc.chunk[0], rc.chunk[1], rng)) chunks.push({ colour, n: c });
  shuffle(chunks, rng);
  const balls = [];
  let tangled = rc.tangled;
  while (chunks.length) {
    const a = chunks.pop();
    if (tangled > 0 && chunks.length) {
      const j = chunks.findIndex(c => c.colour !== a.colour);
      if (j >= 0) { const b = chunks.splice(j, 1)[0]; balls.push({ segs: [[a.colour, a.n], [b.colour, b.n]] }); tangled--; continue; }
    }
    balls.push({ segs: [[a.colour, a.n]] });
  }
  shuffle(balls, rng);
  // mystery
  const plain = balls.filter(b => b.segs.length === 1);
  shuffle(plain, rng).slice(0, rc.mystery).forEach(b => { b.mystery = true; });
  // ties
  let tieId = 0;
  const untied = () => balls.filter(b => b.tie == null && !b.mystery);
  for (let t = 0; t < rc.ties; t++) {
    const pool = shuffle(untied(), rng).slice(0, rc.tieSize);
    if (pool.length < 2) break;
    pool.forEach(b => { b.tie = tieId; }); tieId++;
  }
  // bags: pull some plain balls into a hidden queue
  const items = [];
  const loose = balls.slice();
  for (let g = 0; g < rc.bags; g++) {
    const q = [];
    for (let i = 0; i < rc.bagSize && loose.length > rc.bagSize + 4; i++) {
      const idx = loose.findIndex(b => b.tie == null);
      if (idx < 0) break;
      q.push(loose.splice(idx, 1)[0]);
    }
    if (q.length >= 2) items.push({ bag: q });
  }
  for (const b of loose) items.push(b);
  shuffle(items, rng);
  // locks: a knotted ball with its needle hidden under a stitch of another colour
  const cells = [];
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (grid.cells[y][x]) cells.push([x, y, grid.cells[y][x]]);
  const lockable = items.filter(it => !it.bag && it.tie == null && !it.mystery);
  shuffle(lockable, rng).slice(0, rc.locks).forEach(b => {
    const c = b.segs[0][0];
    const opts = cells.filter(([x, y, col]) => col !== c && y < grid.h * 0.6);
    if (opts.length) { const [x, y] = opts[Math.floor(rng() * opts.length)]; b.lock = { x, y }; }
  });
  // zips: a rectangle in the lower half, opened by pulling N of a colour that also lives outside it
  const zips = [];
  for (let z = 0; z < rc.zips; z++) {
    const zw = ri(rng, 3, Math.max(3, Math.floor(grid.w / 3))), zh = ri(rng, 2, Math.max(2, Math.floor(grid.h / 5)));
    const x0 = ri(rng, 0, grid.w - zw), y0 = ri(rng, Math.floor(grid.h / 2), grid.h - zh);
    const inside = new Set(); for (let y = y0; y < y0 + zh; y++) for (let x = x0; x < x0 + zw; x++) inside.add(x + ',' + y);
    const outsideCounts = {};
    for (const [x, y, col] of cells) if (!inside.has(x + ',' + y)) outsideCounts[col] = (outsideCounts[col] || 0) + 1;
    const colours = Object.keys(outsideCounts).filter(c => outsideCounts[c] >= 6);
    if (!colours.length) continue;
    const colour = colours[Math.floor(rng() * colours.length)];
    const need = Math.max(4, Math.floor(outsideCounts[colour] * (0.35 + rng() * 0.3)));
    if (zips.some(o => !(x0 + zw <= o.x0 || o.x1 < x0 || y0 + zh <= o.y0 || o.y1 < y0))) continue;
    zips.push({ x0, y0, x1: x0 + zw - 1, y1: y0 + zh - 1, colour, need });
  }
  return { items, zips };
}

function layoutRows(items, top) {
  const rows = [];
  let i = 0, w = top;
  while (i < items.length) { const take = Math.min(w, items.length - i); rows.push(items.slice(i, i + take)); i += take; w = (w === top) ? top - 1 : top; }
  return rows;
}

/* ---------- generation with verification ---------- */
function attemptLevel(n, rc, seed) {
  const rng = mulberry32(seed);
  const pic = choosePicture(n, rc, rng);
  const { items, zips } = buildItems(pic, rc, rng);
  const nItems = items.length;
  const top = nItems <= 8 ? 4 : nItems <= 22 ? 5 : nItems <= 30 ? 6 : 7;
  return { id: n, name: pic.name, chapter: rc.chapter, hint: rc.hint, grid: pic.grid, rows: layoutRows(items, top), zips, slots: 5 };
}

function generate(n) {
  const rc = recipe(n);
  const attempts = 220;
  let best = null;
  for (let s = 0; s < attempts; s++) {
    const seed = n * 100003 + s * 7919;
    const level = attemptLevel(n, rc, seed);
    const naive = E.naivePlay(level);
    const sol = E.solve(level, 250000);
    if (!sol.solvable) continue;
    const rate = E.randomPlayWinRate(level, 120, mulberry32(seed + 7));
    const mid = (rc.target[0] + rc.target[1]) / 2;
    const dist = Math.abs(rate - mid) + (rc.naiveMustFail && naive === 'won' ? 0.5 : 0);
    if (!best || dist < best.dist) best = { level, rate, dist, sol, seed, naive };
    if (rate >= rc.target[0] && rate <= rc.target[1] && (!rc.naiveMustFail || naive !== 'won')) return { level, rate, sol, seed, tries: s + 1, naive };
  }
  if (best) return { ...best, tries: attempts, fallback: true };
  throw new Error('Could not generate level ' + n);
}

/* ---------- launch levels 1-10 (unchanged recipe from the first release) ---------- */
function generateLaunch(pic) {
  const attempts = 300;
  let best = null;
  for (let s = 0; s < attempts; s++) {
    const seed = pic.seed * 100003 + s;
    const rng = mulberry32(seed);
    const grid = E.parseGrid(scaleGrid(pic.grid, pic.scale));
    const counts = E.countColours(grid);
    let chunks = [];
    for (const colour of Object.keys(counts)) for (const c of splitCount(counts[colour], pic.chunk[0], pic.chunk[1], rng)) chunks.push({ colour, n: c });
    shuffle(chunks, rng);
    const balls = []; let tangled = pic.tangled;
    while (chunks.length) {
      const a = chunks.pop();
      if (tangled > 0 && chunks.length) { const j = chunks.findIndex(c => c.colour !== a.colour); if (j >= 0) { const b = chunks.splice(j, 1)[0]; balls.push({ segs: [[a.colour, a.n], [b.colour, b.n]] }); tangled--; continue; } }
      balls.push({ segs: [[a.colour, a.n]] });
    }
    shuffle(balls, rng);
    const top = balls.length <= 8 ? 4 : balls.length <= 22 ? 5 : balls.length <= 30 ? 6 : 7;
    const level = { id: pic.id, name: pic.name, chapter: CHAPTERS[0], hint: pic.hint, grid: scaleGrid(pic.grid, pic.scale), rows: layoutRows(balls, top), zips: [], slots: 5 };
    const naive = E.naivePlay(level);
    if (pic.id === 1 && naive !== 'won') continue;
    const sol = E.solve(level, 300000);
    if (!sol.solvable) continue;
    const rate = E.randomPlayWinRate(level, 150, mulberry32(seed + 7));
    const mid = (pic.target[0] + pic.target[1]) / 2;
    const dist = Math.abs(rate - mid) + (pic.naiveMustFail && naive === 'won' ? 0.5 : 0);
    if (!best || dist < best.dist) best = { level, rate, dist, sol, seed, naive };
    if (rate >= pic.target[0] && rate <= pic.target[1] && (!pic.naiveMustFail || naive !== 'won')) return { level, rate, sol, seed, tries: s + 1, naive };
  }
  return { ...best, tries: attempts, fallback: true };
}

function main() {
  const out = path.join(__dirname, '..', 'js', 'levels.js');
  if (process.argv.includes('--check')) {
    const LEVELS = require(out);
    let bad = 0;
    for (const lv of LEVELS) { const sol = E.solve(lv, 500000); if (!sol.solvable) bad++; console.log(`Level ${lv.id} ${lv.name}: ${sol.solvable ? 'OK' : 'UNSOLVABLE'} (${sol.nodes} nodes)`); }
    console.log(bad ? `${bad} UNSOLVABLE` : 'all solvable');
    return;
  }
  const fromArg = process.argv.indexOf('--from');
  const from = fromArg >= 0 ? parseInt(process.argv[fromArg + 1], 10) : 1;
  let levels = [];
  if (from > 1 && fs.existsSync(out)) levels = require(out).filter(l => l.id < from);
  const t0 = Date.now();
  for (let n = from; n <= 100; n++) {
    let r;
    if (n <= 10) r = generateLaunch(PICS[n - 1]);
    else r = generate(n);
    const lv = r.level; lv.solution = r.sol.solution;
    const g = E.parseGrid(lv.grid); const counts = E.countColours(g);
    const nBalls = lv.rows.reduce((a, row) => a + row.reduce((b, it) => b + (it.bag ? it.bag.length : 1), 0), 0);
    const flat = lv.rows.flat().flatMap(it => it.bag ? it.bag : [it]);
    const feat = [flat.filter(b => b.segs.length > 1).length ? 'tangled' + flat.filter(b => b.segs.length > 1).length : '', flat.filter(b => b.mystery).length ? 'mystery' + flat.filter(b => b.mystery).length : '', new Set(flat.filter(b => b.tie != null).map(b => b.tie)).size ? 'ties' + new Set(flat.filter(b => b.tie != null).map(b => b.tie)).size : '', lv.rows.flat().filter(it => it.bag).length ? 'bags' + lv.rows.flat().filter(it => it.bag).length : '', flat.filter(b => b.lock).length ? 'locks' + flat.filter(b => b.lock).length : '', lv.zips.length ? 'zips' + lv.zips.length : ''].filter(Boolean).join(' ');
    console.log(`L${String(n).padStart(3)} ${lv.chapter.padEnd(17)} ${lv.name.padEnd(14)} ${g.w}x${g.h} st=${Object.values(counts).reduce((a, b) => a + b, 0)} col=${Object.keys(counts).length} balls=${nBalls} win=${(r.rate * 100).toFixed(0)}% naive=${r.naive}${r.fallback ? ' (closest)' : ''} ${feat}`);
    levels.push(lv);
  }
  const js = '/* AUTO-GENERATED by tools/gen.js — do not edit by hand. */\n' +
    'var WOOL_LEVELS = ' + JSON.stringify(levels) + ';\n' +
    'var WOOL_CHAPTERS = ' + JSON.stringify(CHAPTERS) + ';\n' +
    'if (typeof module === "object" && module.exports) module.exports = WOOL_LEVELS;\n';
  fs.writeFileSync(out, js);
  console.log('wrote', out, 'in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
main();
