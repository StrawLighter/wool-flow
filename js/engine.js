/* Wool Flow — pure rules engine (no rendering).
 * Shared by the browser game and the Node level tools.
 *
 * Concepts
 *  - Picture: grid of stitches (palette letters, '.' = empty).
 *  - Knitting unravels from the top: a stitch is LOOSE when it is the top
 *    stitch of its column, or the stitch directly above it is already gone.
 *  - Yarn ball: one or more colour segments [[colour, count], ...].
 *    A "tangled" ball has 2 segments — it unravels the first colour, then
 *    turns into the second colour. (The Wool Flow twist.)
 *  - Pile: brick-stacked rows. A ball is available when no remaining ball in
 *    the row above overlaps it horizontally.
 *  - Cushions (slots): tap an available ball -> it goes to a free cushion and
 *    kittens start pulling loose stitches of its colour. When the ball is
 *    fully unravelled the cushion frees. A ball whose colour has no loose
 *    stitches just sits there (clogged). All cushions clogged = level failed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WoolEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Yarn palette — bold, saturated primaries in the Sesame Street spirit.
     Saliency comes from saturation against the neutral cream board (see README: colour system). */
  const PALETTE = {
    R: { name: 'Red',      hex: '#e4002b' },   // Elmo red
    O: { name: 'Orange',   hex: '#ff7f11' },   // Ernie orange
    Y: { name: 'Yellow',   hex: '#ffd23f' },   // Big Bird yellow
    G: { name: 'Green',    hex: '#3cb44b' },   // Oscar green
    B: { name: 'Blue',     hex: '#1f75fe' },   // Cookie Monster blue
    P: { name: 'Purple',   hex: '#7b2cbf' },   // Count purple
    K: { name: 'Pink',     hex: '#ff5fa2' },   // Abby pink
    W: { name: 'Cream',    hex: '#fff8e7' },
    N: { name: 'Brown',    hex: '#8b5a2b' },   // Snuffy brown
    D: { name: 'Charcoal', hex: '#2f2a3a' },
    C: { name: 'Teal',     hex: '#00a5a8' },
    L: { name: 'Lime',     hex: '#a2d729' },
    S: { name: 'Sky',      hex: '#5bc0eb' },   // Grover-ish sky
    E: { name: 'Grey',     hex: '#a9a9b3' },
    M: { name: 'Berry',    hex: '#c2185b' },
  };

  function parseGrid(rows) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const cells = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push(rows[y][x] && rows[y][x] !== '.' ? rows[y][x] : null);
      cells.push(row);
    }
    return { w, h, cells };
  }

  function countColours(grid) {
    const c = {};
    for (const row of grid.cells) for (const v of row) if (v) c[v] = (c[v] || 0) + 1;
    return c;
  }

  /* Brick layout helper: x-centre of ball i in a row of width w (units of 1 ball). */
  function rowX(w, i) { return i - (w - 1) / 2; }

  class Game {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level;
      this.grid = parseGrid(level.grid);
      this.removed = [];               // removed[y][x] = true when unravelled
      for (let y = 0; y < this.grid.h; y++) this.removed.push(new Array(this.grid.w).fill(false));
      this.total = 0;
      for (const row of this.grid.cells) for (const v of row) if (v) this.total++;
      this.cleared = 0;
      this.maxSlots = opts.slots || level.slots || 5;
      this.slots = new Array(this.maxSlots).fill(null); // each: ball object or null
      // Balls: flatten rows with position info.
      this.balls = [];
      level.rows.forEach((row, r) => {
        row.forEach((b, i) => {
          this.balls.push({
            id: this.balls.length,
            row: r, col: i, rowW: row.length,
            segs: b.segs.map(s => [s[0], s[1]]),   // working copy [colour, remaining]
            orig: b.segs.map(s => [s[0], s[1]]),
            state: 'pile',                          // pile | slot | done
            slot: -1,
          });
        });
      });
      this.status = 'playing'; // playing | won | lost
    }

    colourAt(x, y) { return this.removed[y][x] ? null : this.grid.cells[y][x]; }

    /* Knitting unravels from the top: a stitch is loose when it is the top
       stitch of its column, or the stitch directly above it has been pulled. */
    isLoose(x, y) {
      if (this.removed[y][x] || !this.grid.cells[y][x]) return false;
      if (y === 0) return true;
      return this.removed[y - 1][x] || !this.grid.cells[y - 1][x];
    }

    /* Loose stitches of a colour, in pull priority: top row first, then left->right. */
    looseOf(colour) {
      const out = [];
      const g = this.grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++)
        if (g.cells[y][x] === colour && this.isLoose(x, y)) out.push([x, y]);
      return out;
    }

    hasLoose(colour) {
      const g = this.grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++)
        if (g.cells[y][x] === colour && this.isLoose(x, y)) return true;
      return false;
    }

    remaining(colour) {
      let n = 0; const g = this.grid;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++)
        if (g.cells[y][x] === colour && !this.removed[y][x]) n++;
      return n;
    }

    /* Pile availability. */
    isAvailable(ball) {
      if (ball.state !== 'pile') return false;
      if (ball.row === 0) return true;
      const x = rowX(ball.rowW, ball.col);
      for (const b of this.balls) {
        if (b.state !== 'pile' || b.row !== ball.row - 1) continue;
        if (Math.abs(rowX(b.rowW, b.col) - x) < 0.99) return false;
      }
      return true;
    }
    availableBalls() { return this.balls.filter(b => this.isAvailable(b)); }
    freeSlot() { return this.slots.indexOf(null); }
    pileCount() { return this.balls.filter(b => b.state === 'pile').length; }

    ballColour(ball) { return ball.segs.length ? ball.segs[0][0] : null; }
    ballCount(ball) { return ball.segs.length ? ball.segs[0][1] : 0; }

    /* Player action: move an available ball to a free cushion. Returns slot index or -1. */
    play(ballId) {
      const ball = this.balls[ballId];
      if (!ball || !this.isAvailable(ball)) return -1;
      const s = this.freeSlot();
      if (s < 0) return -1;
      ball.state = 'slot'; ball.slot = s; this.slots[s] = ball;
      return s;
    }

    /* Booster: put a slotted ball back onto the pile (keeps its remaining counts). */
    hook(slotIdx) {
      const ball = this.slots[slotIdx];
      if (!ball) return false;
      this.slots[slotIdx] = null; ball.state = 'pile'; ball.slot = -1;
      return true;
    }

    /* Booster: snip a tangled ball in a slot — its second segment becomes a
       standalone ball dropped into an empty top-row spot (so it is available). */
    snip(slotIdx) {
      const ball = this.slots[slotIdx];
      if (!ball || ball.segs.length < 2) return false;
      const topW = this.level.rows[0].length;
      const used = new Set(this.balls.filter(b => b.state === 'pile' && b.row === 0).map(b => b.col));
      let col = -1;
      for (let c = 0; c < topW; c++) if (!used.has(c)) { col = c; break; }
      if (col < 0) return false;
      const seg = ball.segs.splice(1, 1)[0];
      ball.orig = ball.segs.map(s => [s[0], s[1]]);
      this.balls.push({
        id: this.balls.length, row: 0, col, rowW: topW,
        segs: [[seg[0], seg[1]]], orig: [[seg[0], seg[1]]], state: 'pile', slot: -1, snipped: true,
      });
      return true;
    }

    /* Booster: add one cushion. */
    addSlot() {
      if (this.slots.length >= 7) return false;
      this.slots.push(null); this.maxSlots = this.slots.length;
      return true;
    }

    /* Take one stitch for the ball in slot s. Returns [x, y] removed or null.
       The ball's current segment count is decremented; segment/ball completion is
       reported via the returned info so the renderer can animate. */
    pull(slotIdx) {
      const ball = this.slots[slotIdx];
      if (!ball || !ball.segs.length) return null;
      const colour = ball.segs[0][0];
      const loose = this.looseOf(colour);
      if (!loose.length) return null;
      const [x, y] = loose[0];
      this.removed[y][x] = true; this.cleared++;
      ball.segs[0][1]--;
      const info = { x, y, colour, segDone: false, ballDone: false };
      if (ball.segs[0][1] <= 0) {
        ball.segs.shift(); info.segDone = true;
        if (!ball.segs.length) { info.ballDone = true; }
      }
      return info;
    }

    /* Release a finished ball from its slot (renderer calls after animations). */
    finishBall(slotIdx) {
      const ball = this.slots[slotIdx];
      if (!ball || ball.segs.length) return false;
      ball.state = 'done'; ball.slot = -1; this.slots[slotIdx] = null;
      return true;
    }

    /* Does any slotted ball currently have work? */
    anyProgress() {
      for (const b of this.slots) if (b && b.segs.length && this.hasLoose(b.segs[0][0])) return true;
      return false;
    }

    /* Deterministic full drain used by the solver / auto-check: repeatedly pull
       from every slot until nothing moves; release finished balls. */
    drain() {
      let moved = true;
      while (moved) {
        moved = false;
        for (let s = 0; s < this.slots.length; s++) {
          const b = this.slots[s];
          if (!b) continue;
          while (b.segs.length && this.pull(s)) moved = true;
          if (!b.segs.length) { this.finishBall(s); moved = true; }
        }
      }
      this.evaluate();
    }

    evaluate() {
      if (this.cleared >= this.total) { this.status = 'won'; return this.status; }
      const full = this.freeSlot() < 0;
      const noAvail = this.availableBalls().length === 0;
      if (!this.anyProgress() && (full || (noAvail && this.pileCount() === 0))) {
        // Slots full with nothing to do, or nothing left to play but stitches remain.
        this.status = 'lost';
      }
      return this.status;
    }

    /* Compact state key for the solver. */
    key() {
      let k = '';
      for (const b of this.balls) k += b.state === 'pile' ? 'p' : b.state === 'done' ? 'd' : ('s' + b.segs.map(s => s[0] + s[1]).join(','));
      k += '|';
      for (const row of this.removed) for (const v of row) k += v ? '1' : '0';
      return k;
    }

    clone() {
      const g = new Game(this.level, { slots: this.slots.length });
      g.slots = new Array(this.slots.length).fill(null);
      for (let y = 0; y < this.grid.h; y++) g.removed[y] = this.removed[y].slice();
      g.cleared = this.cleared; g.status = this.status;
      g.balls = this.balls.map(b => ({ ...b, segs: b.segs.map(s => s.slice()), orig: b.orig.map(s => s.slice()) }));
      for (let s = 0; s < this.slots.length; s++) if (this.slots[s]) g.slots[s] = g.balls[this.slots[s].id];
      return g;
    }
  }

  /* Solver: depth-first search over play orders with the deterministic drain.
     Returns { solvable, solution: [ballIds], nodes } */
  function solve(level, limitNodes) {
    limitNodes = limitNodes || 200000;
    const seen = new Set();
    let nodes = 0;
    const start = new Game(level);
    start.drain();
    const path = [];
    function dfs(g) {
      nodes++;
      if (g.status === 'won') return true;
      if (g.status === 'lost' || nodes > limitNodes) return false;
      const k = g.key();
      if (seen.has(k)) return false;
      seen.add(k);
      if (g.freeSlot() < 0) return false;
      const avail = g.availableBalls();
      // Try balls whose colour has loose stitches first (heuristic).
      avail.sort((a, b) => (g.hasLoose(b.segs[0][0]) ? 1 : 0) - (g.hasLoose(a.segs[0][0]) ? 1 : 0));
      for (const b of avail) {
        const n = g.clone();
        n.play(b.id); n.drain();
        path.push(b.id);
        if (dfs(n)) return true;
        path.pop();
      }
      return false;
    }
    const ok = dfs(start);
    return { solvable: ok, solution: ok ? path.slice() : null, nodes };
  }

  /* Naive player: always plays the first available ball (left-to-right, top row first).
     Used by the generator to make sure later levels punish mindless play. */
  function naivePlay(level) {
    const g = new Game(level); g.drain();
    let guard = 0;
    while (g.status === 'playing' && guard++ < 500) {
      const avail = g.availableBalls();
      if (!avail.length || g.freeSlot() < 0) { g.evaluate(); break; }
      g.play(avail[0].id); g.drain();
    }
    return g.status;
  }

  /* Random player success-rate estimate. */
  function randomPlayWinRate(level, trials, rng) {
    let wins = 0;
    for (let t = 0; t < trials; t++) {
      const g = new Game(level); g.drain();
      let guard = 0;
      while (g.status === 'playing' && guard++ < 500) {
        const avail = g.availableBalls();
        if (!avail.length || g.freeSlot() < 0) { g.evaluate(); break; }
        g.play(avail[Math.floor(rng() * avail.length)].id); g.drain();
      }
      if (g.status === 'won') wins++;
    }
    return wins / trials;
  }

  return { PALETTE, parseGrid, countColours, rowX, Game, solve, naivePlay, randomPlayWinRate };
});
