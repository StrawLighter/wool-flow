#!/usr/bin/env node
/* Level generator: builds the yarn pile for every picture, verifies each level
 * with the solver, and writes js/levels.js.
 *
 *   node tools/gen.js            # regenerate all levels
 *   node tools/gen.js --check    # only re-verify js/levels.js
 */
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const PICS = require('./pictures.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitCount(total, min, max, rng) {
  const chunks = [];
  let left = total;
  while (left > 0) {
    if (left <= max) { chunks.push(left); break; }
    let c = min + Math.floor(rng() * (max - min + 1));
    if (left - c < min) c = left - min;           // keep the remainder legal
    chunks.push(c); left -= c;
  }
  return chunks;
}

function scaleGrid(rows, k) {
  if (!k || k === 1) return rows;
  const out = [];
  for (const r of rows) { const row = r.split('').map(ch => ch.repeat(k)).join(''); for (let i = 0; i < k; i++) out.push(row); }
  return out;
}

function buildBalls(pic, rng) {
  const grid = E.parseGrid(scaleGrid(pic.grid, pic.scale));
  const counts = E.countColours(grid);
  let chunks = [];
  for (const colour of Object.keys(counts))
    for (const c of splitCount(counts[colour], pic.chunk[0], pic.chunk[1], rng)) chunks.push({ colour, n: c });
  // Shuffle
  for (let i = chunks.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [chunks[i], chunks[j]] = [chunks[j], chunks[i]]; }
  const balls = [];
  let tangled = pic.tangled;
  while (chunks.length) {
    const a = chunks.pop();
    if (tangled > 0 && chunks.length) {
      const j = chunks.findIndex(c => c.colour !== a.colour);
      if (j >= 0) {
        const b = chunks.splice(j, 1)[0];
        balls.push({ segs: [[a.colour, a.n], [b.colour, b.n]] });
        tangled--; continue;
      }
    }
    balls.push({ segs: [[a.colour, a.n]] });
  }
  for (let i = balls.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [balls[i], balls[j]] = [balls[j], balls[i]]; }
  return balls;
}

function layoutRows(balls, top) {
  const rows = [];
  let i = 0, w = top;
  while (i < balls.length) {
    const take = Math.min(w, balls.length - i);
    rows.push(balls.slice(i, i + take));
    i += take;
    w = (w === top) ? top - 1 : top;
  }
  return rows;
}

function generate(pic) {
  const attempts = 300;
  let best = null;
  for (let s = 0; s < attempts; s++) {
    const seed = pic.seed * 100003 + s;
    const rng = mulberry32(seed);
    const balls = buildBalls(pic, rng);
    const top = balls.length <= 8 ? 4 : balls.length <= 22 ? 5 : balls.length <= 30 ? 6 : 7;
    const level = { id: pic.id, name: pic.name, hint: pic.hint, grid: scaleGrid(pic.grid, pic.scale), rows: layoutRows(balls, top), slots: 5 };
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
  if (best) { console.warn(`  ! ${pic.name}: no seed hit the target band, using closest (rate ${best.rate.toFixed(2)})`); return { ...best, tries: attempts }; }
  throw new Error(`Could not generate a solvable level for ${pic.name}`);
}

function main() {
  const out = path.join(__dirname, '..', 'js', 'levels.js');
  if (process.argv.includes('--check')) {
    const src = fs.readFileSync(out, 'utf8');
    const LEVELS = eval(src.replace(/^[^=]*=/, '').replace(/;\s*if \(typeof module[\s\S]*$/, ''));
    for (const lv of LEVELS) {
      const sol = E.solve(lv, 500000);
      console.log(`Level ${lv.id} ${lv.name}: ${sol.solvable ? 'OK' : 'UNSOLVABLE'} (${sol.nodes} nodes)`);
    }
    return;
  }
  const levels = [];
  for (const pic of PICS) {
    const g = E.parseGrid(scaleGrid(pic.grid, pic.scale));
    const counts = E.countColours(g);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const r = generate(pic);
    const nBalls = r.level.rows.reduce((a, row) => a + row.length, 0);
    const nT = r.level.rows.flat().filter(b => b.segs.length > 1).length;
    console.log(`Level ${pic.id} ${pic.name.padEnd(10)} ${g.w}x${g.h} stitches=${total} colours=${Object.keys(counts).length} balls=${nBalls} tangled=${nT} randomWin=${(r.rate * 100).toFixed(0)}% naive=${r.naive} seed=${r.seed} tries=${r.tries}`);
    r.level.solution = r.sol.solution;
    levels.push(r.level);
  }
  const js = '/* AUTO-GENERATED by tools/gen.js — do not edit by hand. */\n' +
    'var WOOL_LEVELS = ' + JSON.stringify(levels, null, 1) + ';\n' +
    'if (typeof module === "object" && module.exports) module.exports = WOOL_LEVELS;\n';
  fs.writeFileSync(out, js);
  console.log('wrote', out);
}
main();
