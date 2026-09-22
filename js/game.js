/* Wool Flow — canvas renderer, animation and input. Rules live in engine.js. */
(function () {
  'use strict';
  const E = window.WoolEngine;
  const LEVELS = window.WOOL_LEVELS;

  /* ---------- layout (logical portrait canvas) ---------- */
  const W = 720, H = 1280;
  const BOOST_Y = 1215;                                   // booster bar centre
  /* Everything above the boosters is laid out per level so big piles still fit. */
  function makeLayout(level) {
    const rows = level.rows.length, maxW = Math.max(...level.rows.map(r => r.length));
    const spacing = Math.min(112, 660 / maxW), r = Math.round(spacing * 0.39), rowH = Math.round(r * 1.9);
    const pileBottom = BOOST_Y - 78;
    const pileY = pileBottom - (rows - 1) * rowH - r;         // centre of row 0
    const cushY = pileY - r - 84;
    const pic = { x: 104, y: 104, w: 512, h: cushY - 66 - 104 };
    const trees = { w: 84, left: 52, right: W - 52, top: pic.y - 6, bottom: pic.y + pic.h + 30 };   // wool cat trees either side
    return { pic, trees, cushY, pileY, rowH, spacing, r, pileTop: pileY - r - 16, pileBottom: pileBottom + r + 10 };
  }
  const KITTENS_PER_SLOT = 3;
  const KITTEN_SPEED = 250;   // px / s along the walking path — a slow, ASMR stroll (x2 / x3 available)
  const WALK_FRAMES = 4;      // frames in assets/kitten_walk_sheet.png
  const WALK_CYCLE = [0, 1, 2, 3, 2, 1]; // ping-pong through the sheet for a smooth loop
  const WALK_STRIDE = 16;     // px of travel per animation step
  const ROLL_TIME = 1.1;      // seconds for a pulled yarn ball to roll home
  const SWIPE_TIME = 0.7;     // seconds a kitten stops and bats at the ball before it comes loose
  const CLIMB_FRAMES = 4;     // frames in assets/kitten_climb_sheet.png
  const CLIMB_STRIDE = 14;    // px of vertical travel per climb frame
  const VANISH_TIME = 0.45;   // seconds to slip through the cat door
  const FINAL_STRETCH = 5;    // yarn balls left on the board when kittens speed up to 1.5x

  /* ---------- safe storage (Safari with cookies blocked / in-app browsers throw) ---------- */
  const Store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
  };

  /* ---------- assets ---------- */
  const IMG = {};
  const ASSET_LIST = ['yarn', 'kitten_walk', 'kitten_walk_sheet', 'kitten_swipe_sheet', 'kitten_climb_sheet', 'kitten_walk_up_sheet', 'kitten_walk_down_sheet', 'kitten_swipe_front_sheet', 'cat_tree', 'prop_bag', 'prop_lock', 'prop_needle', 'prop_mystery', 'prop_zip', 'kitten_carry', 'kitten_sleep', 'basket', 'icon_basket', 'icon_hook', 'icon_snip', 'logo', 'kitten_win', 'kitten_fail'];
  function loadAssets() {
    const all = Promise.all(ASSET_LIST.map(n => new Promise(res => {
      const im = new Image(); im.onload = () => { IMG[n] = im; res(); }; im.onerror = () => res(); im.src = 'assets/' + n + '.png';
    })));
    const timeout = new Promise(res => setTimeout(res, 8000)); // never hang on "loading"
    return Promise.race([all, timeout]);
  }

  /* Tint a white sprite to a colour (multiply, keep alpha). Cached. */
  const tintCache = new Map();
  function tinted(name, hex, flip) {
    const key = name + hex + (flip ? 'f' : '');
    if (tintCache.has(key)) return tintCache.get(key);
    const src = IMG[name]; if (!src) return null;
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = hex; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in'; g.setTransform(1, 0, 0, 1, 0, 0);
    if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(src, 0, 0);
    tintCache.set(key, c); return c;
  }

  /* Pre-rendered mini yarn ball per colour and size — the picture is made of these. */
  const stitchCache = new Map();
  function stitchTile(hex, s) {
    const key = hex + '_' + s;
    if (stitchCache.has(key)) return stitchCache.get(key);
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d');
    const yarn = tinted('yarn', hex);
    if (yarn) {
      // the yarn sprite has a loose thread on the right; crop to the round ball itself
      const sw = yarn.width * 0.78, sh = yarn.height * 0.92;
      g.drawImage(yarn, 0, yarn.height * 0.04, sw, sh, 0, 0, s, s);
    } else { g.fillStyle = hex; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 0.5, 0, Math.PI * 2); g.fill(); }
    if (hex.toLowerCase() === '#f8f2e4') { g.strokeStyle = 'rgba(120,90,60,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); g.stroke(); }
    stitchCache.set(key, c); return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const hexOf = c => E.PALETTE[c] ? E.PALETTE[c].hex : '#999';
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  /* ---------- sound (tiny synth) ---------- */
  const Sfx = {
    ctx: null, muted: Store.get('woolflow.muted') === '1',
    init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    tone(f, dur, type, vol, when) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    },
    pop() { this.tone(520 + Math.random() * 240, 0.08, 'triangle', 0.08); },
    /* paw swipe: a short airy swish (band-passed noise) followed by a soft pat */
    swipe() {
      if (this.muted || !this.ctx) return;
      const c = this.ctx, t0 = c.currentTime;
      if (!this.noise) { const len = c.sampleRate * 0.5, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = buf; }
      const src = c.createBufferSource(); src.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(2600, t0); bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.16);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      src.connect(bp); bp.connect(g); g.connect(c.destination); src.start(t0); src.stop(t0 + 0.2);
      this.tone(140, 0.07, 'sine', 0.12, 0.13);
    },
    place() { this.tone(330, 0.12, 'sine', 0.15); this.tone(440, 0.12, 'sine', 0.12, 0.06); },
    done() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.14, i * 0.07)); },
    clog() { this.tone(180, 0.25, 'sawtooth', 0.06); },
    win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.16, i * 0.12)); },
    lose() { [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.14, i * 0.18)); },
    click() { this.tone(700, 0.05, 'square', 0.04); },
  };

  /* ---------- progress ---------- */
  const Progress = {
    get unlocked() { return Math.max(1, parseInt(Store.get('woolflow.unlocked') || '1', 10)); },
    set unlocked(v) { Store.set('woolflow.unlocked', String(v)); },
    stars(id) { return parseInt(Store.get('woolflow.stars.' + id) || '0', 10); },
    setStars(id, n) { if (n > this.stars(id)) Store.set('woolflow.stars.' + id, String(n)); },
  };

  /* ---------- game session ---------- */
  class Session {
    constructor(level) {
      this.level = level;
      this.game = new E.Game(level);
      this.kittens = [];      // walking kittens, see spawnKitten()
      this.flying = [];       // mini yarn balls rolling back to their cushion
      this.particles = [];
      this.floaters = [];     // floating text
      this.moving = [];       // balls sliding pile -> cushion
      this.popping = [];      // balls finished (shrink anim)
      this.held = new Set();  // "x,y" stitches a kitten is walking to (reserved, still on the board until the swipe)
      this.speed = 1;
      this.boosters = { basket: 1, hook: 1, snip: 1 };
      this.armed = null;      // 'hook' | 'snip'
      this.over = null;       // 'won' | 'lost'
      this.time = 0;
      this.boostersUsed = 0;
      this.shake = 0;
      this.L = makeLayout(level);
      this.layoutPicture();
    }

    layoutPicture() {
      const g = this.game.grid;
      const PIC = this.L.pic;
      const cell = Math.floor(Math.min((PIC.w - 40) / g.w, (PIC.h - 40) / g.h));
      this.cell = cell;
      this.gridX = PIC.x + (PIC.w - cell * g.w) / 2;
      this.gridY = PIC.y + (PIC.h - cell * g.h) / 2;
    }
    stitchPos(x, y) { return { x: this.gridX + x * this.cell + this.cell / 2, y: this.gridY + y * this.cell + this.cell / 2 }; }
    slotPos(i) { const n = this.game.slots.length; const sp = Math.min(124, 640 / n); return { x: W / 2 + (i - (n - 1) / 2) * sp, y: this.L.cushY }; }
    ballPos(b) { return { x: W / 2 + E.rowX(b.rowW, b.col) * this.L.spacing, y: this.L.pileY + b.row * this.L.rowH }; }

    /* ----- kitten paths (kittens only ever walk: frame rails + unravelled cells) ----- */
    rails() { const P = this.L.pic; return { left: P.x + 7, right: P.x + P.w - 7, top: P.y + 7, bottom: P.y + P.h + 26 }; }
    /* first still-knitted row in a column (grid.h when the column is empty) */
    topFilled(c) { const g = this.game; for (let y = 0; y < g.grid.h; y++) if (g.grid.cells[y][c] && !g.removed[y][c]) return y; return g.grid.h; }
    /* y (px) of the lowest clear walkway between two columns, or the top rail */
    walkwayY(c0, c1) {
      let top = Infinity;
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) top = Math.min(top, this.topFilled(c));
      const row = top - 1;
      return row < 0 ? this.rails().top : this.stitchPos(0, row).y;
    }
    /* where a kitten stands to bat at a ball: the clear cell just above it */
    standPos(gx, gy) { const t = this.stitchPos(gx, gy); return { x: t.x, y: t.y - this.cell * 0.95 }; }
    /* path from a cushion to a stitch */
    pathToStitch(from, gx, gy) {
      const R = this.rails(); const t = this.standPos(gx, gy); const side = t.x < W / 2 ? R.left : R.right;
      const wy = this.walkwayY(gx, gx);
      return [{ x: from.x, y: from.y }, { x: side, y: R.bottom }, { x: side, y: wy }, { x: t.x, y: wy }, { x: t.x, y: t.y }];
    }
    /* path from one stitch to the next through the unravelled area */
    pathBetween(cx, cy, gx, gy) {
      const a = this.standPos(cx, cy), t = this.standPos(gx, gy);
      const wy = this.walkwayY(cx, gx);
      return [{ x: a.x, y: a.y }, { x: a.x, y: wy }, { x: t.x, y: wy }, { x: t.x, y: t.y }];
    }
    /* path from a stitch back to the cushion */
    pathHome(cx, cy, to) {
      const R = this.rails(); const a = this.standPos(cx, cy); const side = a.x < W / 2 ? R.left : R.right;
      const wy = this.walkwayY(cx, cx);
      return [{ x: a.x, y: a.y }, { x: a.x, y: wy }, { x: side, y: wy }, { x: side, y: R.bottom }, { x: to.x, y: to.y }];
    }
    /* the cat tree a kitten leaves by: nearest side */
    treeX(x) { return x < W / 2 ? this.L.trees.left : this.L.trees.right; }
    doorY() { return this.L.trees.top + 22; }
    /* path from a stitch to the base of the nearest cat tree (then it climbs) */
    pathExitFromStitch(cx, cy) {
      const R = this.rails(); const a = this.standPos(cx, cy); const side = a.x < W / 2 ? R.left : R.right;
      const wy = this.walkwayY(cx, cx); const tx = this.treeX(a.x);
      return [{ x: a.x, y: a.y }, { x: a.x, y: wy }, { x: side, y: wy }, { x: side, y: R.bottom }, { x: tx, y: R.bottom }];
    }
    /* path from wherever a kitten stands (cushion area) to the base of the nearest tree */
    pathExitFrom(x, y) { const R = this.rails(); const tx = this.treeX(x); return [{ x, y }, { x: tx, y: R.bottom }]; }
    startClimb(k) { const tx = k.x; this.setPath(k, [{ x: tx, y: k.y }, { x: tx, y: this.doorY() }], 'climb'); }
    leave(k, fromStitch) {
      if (fromStitch) this.setPath(k, this.pathExitFromStitch(fromStitch.x, fromStitch.y), 'exit');
      else this.setPath(k, this.pathExitFrom(k.x, k.y), 'exit');
      k.leaving = true;
    }
    /* is the kitten currently on a vertical stretch? (climb animation) */
    climbing(k) {
      if (!k.path || k.seg >= k.path.length - 1) return k.state === 'climb';
      const a = k.path[k.seg], b = k.path[k.seg + 1];
      return Math.abs(b.y - a.y) > Math.abs(b.x - a.x) * 1.5;
    }
    setPath(k, path, state) {
      k.path = path; k.seg = 0; k.segT = 0; k.state = state;
      k.segLen = Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y);
      this.face(k, path[0], path[1]);
    }
    /* 4-way heading from a segment: 'left' | 'right' | 'up' | 'down' */
    face(k, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) >= Math.abs(dy) * 0.9) { k.dir = dx >= 0 ? 1 : -1; k.heading = k.dir > 0 ? 'right' : 'left'; }
      else k.heading = dy < 0 ? 'up' : 'down';
    }
    /* advance along the path; returns true when the end is reached */
    walk(k, dist) {
      while (dist > 0 && k.path && k.seg < k.path.length - 1) {
        const a = k.path[k.seg], b = k.path[k.seg + 1];
        const left = k.segLen - k.segT;
        if (dist >= left) { dist -= left; k.seg++; k.segT = 0; k.x = b.x; k.y = b.y; k.odo += left;
          if (k.seg < k.path.length - 1) { const n = k.path[k.seg + 1]; k.segLen = Math.hypot(n.x - b.x, n.y - b.y); this.face(k, b, n); } }
        else { k.segT += dist; k.odo += dist; const u = k.segLen ? k.segT / k.segLen : 1; k.x = lerp(a.x, b.x, u); k.y = lerp(a.y, b.y, u); dist = 0; }
      }
      return !k.path || k.seg >= k.path.length - 1;
    }
    /* A stitch a kitten may set off for: on the board, loose right now, and not already
       reserved by another kitten. (Loose = top of its column or the one above is truly gone.) */
    freeTargets(colour) {
      const g = this.game, out = [];
      for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++)
        if (g.grid.cells[y][x] === colour && g.isLoose(x, y) && !this.held.has(x + ',' + y)) out.push([x, y]);
      return out;
    }
    hasFree(colour) { return this.freeTargets(colour).length > 0; }
    reservedFor(slot) { return this.kittens.filter(k => k.slot === slot && k.state !== 'idle' && k.target).length; }

    /* give a kitten its next stitch: reserve only, the rules pull happens when it swipes */
    assign(k, fromStitch) {
      const g = this.game, s = k.slot, b = g.slots[s];
      if (!b || !b.segs.length) return false;
      if (b.segs[0][1] - this.reservedFor(s) <= 0) return false;      // rest of this colour already spoken for
      const colour = b.segs[0][0];
      const free = this.freeTargets(colour);
      if (!free.length) return false;
      const [x, y] = free[0];
      this.held.add(x + ',' + y);
      k.colour = colour; k.target = { x, y, colour };
      if (fromStitch) this.setPath(k, this.pathBetween(fromStitch.x, fromStitch.y, x, y), 'go');
      else this.setPath(k, this.pathToStitch({ x: k.x, y: k.y }, x, y), 'go');
      return true;
    }

    /* ----- input ----- */
    tap(px, py) {
      if (this.over) return;
      const g = this.game;
      // boosters
      const bx = this.boosterHit(px, py);
      if (bx) { this.useBooster(bx); return; }
      // cushions when a booster is armed
      if (this.armed) {
        for (let i = 0; i < g.slots.length; i++) {
          const p = this.slotPos(i);
          if (Math.hypot(px - p.x, py - p.y) < 62 && g.slots[i]) { this.applyArmed(i); return; }
        }
        this.armed = null; Sfx.click(); return;
      }
      // pile balls (top rows drawn last, so hit-test available balls only)
      let best = null, bd = 1e9;
      for (const b of g.balls) {
        if (!g.isAvailable(b)) continue;
        const p = this.ballPos(b); const d = Math.hypot(px - p.x, py - p.y);
        if (d < this.L.r + 8 && d < bd) { best = b; bd = d; }
      }
      if (best) this.playBall(best);
    }

    playBall(b) {
      const g = this.game;
      const grp = g.tieGroup(b);
      const free = g.slots.filter(x => x === null).length;
      if (free < grp.length) { this.shake = 0.3; Sfx.clog(); this.float(W / 2, this.L.cushY - 70, grp.length > 1 ? 'Tied: need ' + grp.length + ' free cushions!' : 'No free cushion!', '#e4002b'); return; }
      const froms = grp.map(x => this.ballPos(x));
      const s = g.play(b.id);
      if (s < 0) return;
      grp.forEach((x, i) => {
        const to = this.slotPos(x.slot);
        this.moving.push({ ball: x, x0: froms[i].x, y0: froms[i].y, x1: to.x, y1: to.y - 14, t: -i * 0.12, dur: 0.32 });
        if (x.mystery) this.revealSoon = (this.revealSoon || []).concat([{ ball: x, t: 0.3 + i * 0.12 }]);
      });
      Sfx.place();
      const to = this.slotPos(s);
      if (!this.hasFree(b.segs[0][0]) && !b.mystery) { this.float(to.x, to.y - 90, 'waiting…', '#7a6a5a'); }
      this.armed = null;
    }

    boosterHit(px, py) {
      const items = ['basket', 'hook', 'snip'];
      for (let i = 0; i < 3; i++) { const x = W / 2 + (i - 1) * 150; if (Math.hypot(px - x, py - BOOST_Y) < 46) return items[i]; }
      return null;
    }
    useBooster(kind) {
      const g = this.game;
      if (this.boosters[kind] <= 0) { Sfx.clog(); return; }
      if (kind === 'basket') {
        if (g.addSlot()) { this.boosters.basket--; this.boostersUsed++; Sfx.done(); this.float(W / 2, this.L.cushY - 80, '+1 cushion', '#3cb44b'); this.checkEnd(); }
        return;
      }
      this.armed = this.armed === kind ? null : kind; Sfx.click();
      if (this.armed) this.float(W / 2, this.L.cushY - 80, kind === 'hook' ? 'Tap a cushion to hook its yarn back' : 'Tap a tangled ball to snip it', '#7a6a5a');
    }
    applyArmed(i) {
      const g = this.game, kind = this.armed; this.armed = null;
      if (this.kittens.some(k => k.slot === i && (k.state === 'go' || k.state === 'swipe'))) { this.float(this.slotPos(i).x, this.L.cushY - 80, 'kittens busy!', '#e8453c'); return; }
      if (kind === 'hook') {
        const b = g.slots[i];
        if (g.hook(i)) { this.boosters.hook--; this.boostersUsed++; for (const k of this.kittens) if (k.slot === i) { k.orphan = true; if (k.state === 'idle') this.leave(k, null); } Sfx.done(); this.burst(this.slotPos(i).x, this.L.cushY, hexOf(b.segs[0][0]), 10); }
      } else if (kind === 'snip') {
        const b = g.slots[i];
        if (!b || b.segs.length < 2) { this.float(this.slotPos(i).x, this.L.cushY - 80, 'not tangled', '#e8453c'); Sfx.clog(); return; }
        if (g.snip(i)) { this.boosters.snip--; this.boostersUsed++; Sfx.done(); this.burst(this.slotPos(i).x, this.L.cushY, '#fff', 12); }
      }
    }

    float(x, y, text, colour) { this.floaters.push({ x, y, text, colour, t: 0 }); }
    burst(x, y, colour, n) {
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220; this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0, life: 0.5 + Math.random() * 0.4, colour, r: 3 + Math.random() * 4 }); }
    }

    /* ----- simulation ----- */
    update(dt) {
      this.time += dt;
      const g = this.game;
      // final stretch: with 5 or fewer yarn balls left on the board the kittens hurry (1.5x)
      const left = g.total - g.cleared;
      const rush = left <= FINAL_STRETCH ? 1.5 : 1;
      if (rush > 1 && !this.rushed) { this.rushed = true; this.float(W / 2, this.L.pic.y + this.L.pic.h / 2, 'final stretch!', '#e4002b'); Sfx.done(); }
      const sdt = dt * this.speed * rush;
      if (this.shake > 0) this.shake -= dt;
      // ball slide animations
      for (const m of this.moving) m.t += dt;
      this.moving = this.moving.filter(m => m.t < m.dur);
      if (this.revealSoon) { for (const r of this.revealSoon) { r.t -= dt; if (r.t <= 0 && !r.done) { r.done = true; r.ball.shown = true; const p = this.slotPos(r.ball.slot); this.burst(p.x, p.y - 14, '#fff8e7', 12); this.burst(p.x, p.y - 14, hexOf(r.ball.segs[0][0]), 8); Sfx.done(); this.float(p.x, p.y - 90, E.PALETTE[r.ball.segs[0][0]].name + '!', hexOf(r.ball.segs[0][0])); } } this.revealSoon = this.revealSoon.filter(r => !r.done); }
      for (const p of this.popping) p.t += dt;
      this.popping = this.popping.filter(p => p.t < 0.35);
      // kittens
      for (let s = 0; s < g.slots.length; s++) {
        const b = g.slots[s];
        if (!b) continue;
        if (this.moving.some(m => m.ball === b)) continue; // still sliding in
        let mine = this.kittens.filter(k => k.slot === s && !k.orphan && !k.leaving);
        while (b.segs.length && mine.length < KITTENS_PER_SLOT) {
          const p = this.slotPos(s);
          const k = { slot: s, colour: b.segs.length ? b.segs[0][0] : null, x: p.x + (mine.length - 1) * 24, y: p.y + 30, home: { x: p.x + (mine.length - 1) * 24, y: p.y + 30 }, state: 'idle', wait: mine.length * 0.25, dir: 1, odo: 0, path: null };
          this.kittens.push(k); mine.push(k);
        }
        for (const k of mine) {
          if (k.state === 'idle') {
            if (k.wait > 0) { k.wait -= sdt; continue; }
            if (!b.segs.length) continue;
            this.assign(k, null);
          } else if (k.state === 'go') {
            if (this.walk(k, KITTEN_SPEED * sdt)) { k.state = 'swipe'; k.swipeT = 0; k.heading = 'down'; k.swished = 0; }
          } else if (k.state === 'swipe') {
            k.swipeT += sdt;
            const u = k.swipeT / SWIPE_TIME;
            if (k.swished === 0 && u >= 0.45) { k.swished = 1; Sfx.swipe(); }
            if (k.swished === 1 && u >= 0.85) { k.swished = 2; Sfx.swipe(); }
            if (k.swipeT >= SWIPE_TIME) {
              // the swipe lands: pull the ball in the rules, it rolls home, the kitten walks on
              const t = k.target; this.held.delete(t.x + ',' + t.y);
              const info = g.pullAt(s, t.x, t.y);
              k.target = null;
              if (info) {
                const p = this.slotPos(s); const from = this.stitchPos(t.x, t.y);
                this.flying.push({ x0: from.x, y0: from.y, x1: p.x, y1: p.y - 14, t: 0, dur: ROLL_TIME, colour: hexOf(info.colour), size: Math.max(10, this.cell), slot: s });
                this.burst(from.x, from.y, hexOf(info.colour), 4); Sfx.pop();
                for (const ev of info.events || []) {
                  if (ev.type === 'unlock') { const bp = this.ballPos(ev.ball); this.burst(bp.x, bp.y, '#ffd23f', 14); this.float(bp.x, bp.y - 60, 'unknotted!', '#3cb44b'); Sfx.done(); this.needleFly = { x0: from.x, y0: from.y, x1: bp.x, y1: bp.y, t: 0 }; }
                  if (ev.type === 'unzip') { const z = ev.zip; const c = this.stitchPos((z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2); this.burst(c.x, c.y, '#fff8e7', 16); this.float(c.x, c.y, 'unzipped!', '#e4002b'); Sfx.win(); z.anim = 0; }
                }
                if (info.segDone && !info.ballDone) { this.float(p.x, p.y - 90, 'colour change!', hexOf(b.segs[0][0])); this.burst(p.x, p.y - 14, hexOf(b.segs[0][0]), 8); }
              }
              if (!this.assign(k, t)) { if (!b.segs.length) this.leave(k, t); else this.setPath(k, this.pathHome(t.x, t.y, k.home), 'home'); }
            }
          } else if (k.state === 'home') {
            if (this.walk(k, KITTEN_SPEED * sdt)) { k.state = 'idle'; k.path = null; k.wait = 0.1; }
          }
          // leaving kittens are advanced below, for every slot at once
        }
        // ball finished? (all stitches grabbed) — kittens still walking home become orphans
        if (!b.segs.length && !mine.some(k => k.state === 'go' || k.state === 'swipe') && !this.flying.some(f => f.slot === s)) {
          const p = this.slotPos(s);
          this.popping.push({ x: p.x, y: p.y - 14, colour: hexOf(b.orig[b.orig.length - 1][0]), t: 0, r: this.L.r });
          this.burst(p.x, p.y - 14, hexOf(b.orig[b.orig.length - 1][0]), 14); Sfx.done();
          g.finishBall(s);
          for (const k of mine) {
            k.orphan = true;
            if (k.state === 'idle') this.leave(k, null);
            else if (k.state === 'home' && k.path) {
              // keep the remaining rail route, but swap the cushion for the tree base
              const rest = k.path.slice(k.seg + 1, k.path.length - 1); const R = this.rails();
              const np = [{ x: k.x, y: k.y }, ...rest, { x: this.treeX(rest.length ? rest[rest.length - 1].x : k.x), y: R.bottom }];
              this.setPath(k, np, 'exit'); k.leaving = true;
            }
          }
        }
      }
      // kittens on their way out: walk to the tree, climb it, slip through the door
      for (const k of this.kittens) {
        if (k.orphan && k.state === 'home' && this.walk(k, KITTEN_SPEED * sdt)) this.leave(k, null);
        else if (k.orphan && k.state === 'idle') this.leave(k, null);
        else if (k.state === 'exit') { if (this.walk(k, KITTEN_SPEED * sdt)) this.startClimb(k); }
        else if (k.state === 'climb') { if (this.walk(k, KITTEN_SPEED * 0.8 * sdt)) { k.state = 'vanish'; k.vanishT = 0; } }
        else if (k.state === 'vanish') { k.vanishT += sdt; if (k.vanishT >= VANISH_TIME) { k.remove = true; if (!k.poofed) { k.poofed = true; this.burst(k.x, k.y, hexOf(k.colour || 'W'), 5); } } }
      }
      this.kittens = this.kittens.filter(k => !k.remove);
      // rolling yarn balls
      for (const f of this.flying) { f.t += sdt; if (f.t >= f.dur) { this.burst(f.x1, f.y1, f.colour, 3); } }
      this.flying = this.flying.filter(f => f.t < f.dur);
      if (this.needleFly) { this.needleFly.t += dt; if (this.needleFly.t > 0.6) this.needleFly = null; }
      for (const z of g.zips) if (z.anim != null) { z.anim += dt; if (z.anim > 0.8) z.anim = null; }
      // particles & floaters
      for (const p of this.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
      this.particles = this.particles.filter(p => p.t < p.life);
      for (const f of this.floaters) f.t += dt;
      this.floaters = this.floaters.filter(f => f.t < 1.4);
      this.checkEnd();
    }

    checkEnd() {
      if (this.over) return;
      const g = this.game;
      if (this.kittens.some(k => k.state === 'go' || k.state === 'swipe') || this.moving.length || this.flying.length) return;
      const st = g.evaluate();
      if (st === 'won') { this.over = 'won'; Sfx.win(); }
      else if (st === 'lost') {
        // give boosters a chance: only lose when nothing could still help
        this.over = 'lost'; Sfx.lose();
      }
    }

    /* ----- drawing ----- */
    draw(ctx) {
      const g = this.game;
      ctx.save();
      if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 10, 0);
      this.drawPicture(ctx);
      this.drawCushions(ctx);
      this.drawPile(ctx);
      this.drawBoosters(ctx);
      // sliding balls
      for (const m of this.moving) { const u = easeOut(Math.max(0, Math.min(1, m.t / m.dur))); this.drawBall(ctx, m.ball, lerp(m.x0, m.x1, u), lerp(m.y0, m.y1, u) - Math.sin(u * Math.PI) * 60, Math.min(40, this.L.r), false); }
      for (const p of this.popping) { const u = p.t / 0.35; ctx.globalAlpha = 1 - u; ctx.fillStyle = p.colour; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + u * 0.6), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      // kittens, then rolling mini yarn balls
      for (const k of this.kittens) this.drawKitten(ctx, k);
      for (const f of this.flying) { const u = easeOut(Math.min(1, f.t / f.dur)); const x = lerp(f.x0, f.x1, u), y = lerp(f.y0, f.y1, u) - Math.sin(u * Math.PI) * 90;
        ctx.save(); ctx.translate(x, y); ctx.rotate(u * Math.PI * 2); ctx.drawImage(stitchTile(f.colour, Math.round(f.size * 1.4)), -f.size * 0.7, -f.size * 0.7); ctx.restore(); }
      // particles
      for (const p of this.particles) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.colour; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      for (const f of this.floaters) { const u = f.t / 1.4; ctx.globalAlpha = 1 - u * u; ctx.fillStyle = f.colour; ctx.font = 'bold 26px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 5; ctx.strokeText(f.text, f.x, f.y - u * 40); ctx.fillText(f.text, f.x, f.y - u * 40); }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    drawPicture(ctx) {
      const g = this.game; const PIC = this.L.pic;
      // frame
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; roundRect(ctx, PIC.x + 6, PIC.y + 10, PIC.w, PIC.h, 26); ctx.fill();
      ctx.fillStyle = '#b97a45'; roundRect(ctx, PIC.x, PIC.y, PIC.w, PIC.h, 26); ctx.fill();
      ctx.fillStyle = '#efe3cf'; roundRect(ctx, PIC.x + 14, PIC.y + 14, PIC.w - 28, PIC.h - 28, 18); ctx.fill();
      // faint canvas grid of the picture (ghost of the finished image)
      const s = this.cell;
      for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) {
        const c = g.grid.cells[y][x]; if (!c) continue;
        const px = this.gridX + x * s, py = this.gridY + y * s;
        if (g.removed[y][x]) { ctx.fillStyle = 'rgba(0,0,0,0.05)'; ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, Math.max(1.5, s * 0.16), 0, Math.PI * 2); ctx.fill(); continue; }
        const ts = Math.max(6, Math.round(s * 1.08)); ctx.drawImage(stitchTile(hexOf(c), ts), px + (s - ts) / 2, py + (s - ts) / 2);
      }
      // loose indicator: a little thread end curling up from balls that can be pulled
      if (s >= 12) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.5, s * 0.09); ctx.lineCap = 'round';
        for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) {
          if (!g.isLoose(x, y) || this.held.has(x + ',' + y)) continue;
          const px = this.gridX + x * s, py = this.gridY + y * s;
          ctx.beginPath(); ctx.moveTo(px + s * 0.5, py + s * 0.25); ctx.quadraticCurveTo(px + s * 0.75, py - s * 0.05, px + s * 0.9, py + s * 0.12); ctx.stroke();
        }
      }
      // needles hidden under stitches (keys for knotted balls)
      const pn = IMG.prop_needle;
      for (const b of g.balls) if (b.lock && !b.unlocked && b.state === 'pile' && !g.removed[b.lock.y][b.lock.x]) {
        const c = this.stitchPos(b.lock.x, b.lock.y); const d = Math.max(14, s * 1.3);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(c.x, c.y, d * 0.55, 0, Math.PI * 2); ctx.fill();
        if (pn) ctx.drawImage(pn, c.x - d / 2, c.y - d / 2, d, d); else { ctx.fillStyle = '#ffd23f'; ctx.fillRect(c.x - 2, c.y - d / 2, 4, d); }
      }
      if (this.needleFly) { const f = this.needleFly, u = easeOut(Math.min(1, f.t / 0.6)); const d = 34; if (pn) ctx.drawImage(pn, lerp(f.x0, f.x1, u) - d / 2, lerp(f.y0, f.y1, u) - Math.sin(u * Math.PI) * 80 - d / 2, d, d); }
      // zipped patches
      for (const z of g.zips) {
        if (z.open && z.anim == null) continue;
        const a = this.stitchPos(z.x0, z.y0), b2 = this.stitchPos(z.x1, z.y1);
        const x0 = a.x - s / 2, y0 = a.y - s / 2, x1 = b2.x + s / 2, y1 = b2.y + s / 2;
        const openU = z.open ? Math.min(1, (z.anim || 0) / 0.8) : 0;
        ctx.save(); ctx.globalAlpha = 1 - openU;
        ctx.fillStyle = 'rgba(47,42,58,0.55)'; roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 8); ctx.fill();
        // zipper teeth along the middle
        const my = (y0 + y1) / 2; ctx.strokeStyle = '#d9d9e2'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x0 + 6, my - 3); ctx.lineTo(x1 - 6, my - 3); ctx.moveTo(x0 + 6, my + 3); ctx.lineTo(x1 - 6, my + 3); ctx.stroke(); ctx.setLineDash([]);
        const pz = IMG.prop_zip; const zd = Math.min(38, (y1 - y0) * 0.9);
        const zx = lerp(x1 - zd, x0 + zd * 0.4, openU);
        if (pz) ctx.drawImage(pz, zx - zd * pz.width / pz.height / 2, my - zd / 2, zd * pz.width / pz.height, zd);
        // requirement tag: "N × colour"
        const have = Math.min(z.need, g.pulled[z.colour] || 0);
        const label = have + '/' + z.need;
        ctx.font = 'bold 18px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(label).width + 34;
        ctx.fillStyle = '#fff8e7'; roundRect(ctx, (x0 + x1) / 2 - tw / 2, y0 - 12, tw, 24, 12); ctx.fill();
        ctx.fillStyle = hexOf(z.colour); ctx.beginPath(); ctx.arc((x0 + x1) / 2 - tw / 2 + 13, y0, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2f2a3a'; ctx.fillText(label, (x0 + x1) / 2 + 8, y0 + 1);
        ctx.restore();
      }
      this.drawTrees(ctx);
      // progress
      const pct = g.cleared / g.total;
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; roundRect(ctx, PIC.x + 60, PIC.y + PIC.h - 8, PIC.w - 120, 12, 6); ctx.fill();
      ctx.fillStyle = '#3cb44b'; roundRect(ctx, PIC.x + 60, PIC.y + PIC.h - 8, Math.max(12, (PIC.w - 120) * pct), 12, 6); ctx.fill();
    }

    /* wool cat trees either side: top cap + tiled wrapped posts + base, stretched to the frame height */
    drawTrees(ctx) {
      const T = this.L.trees, im = IMG.cat_tree; if (!im) return;
      const w = T.w, k = w / im.width, H = T.bottom - T.top;
      const capH = im.height * 0.17 * k, baseH = im.height * 0.08 * k, midSrcY = im.height * 0.17, midSrcH = im.height * 0.72;
      const tileH = midSrcH * k;
      for (const cx of [T.left, T.right]) {
        const x = cx - w / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(cx, T.bottom + 4, w * 0.6, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(im, 0, 0, im.width, im.height * 0.17, x, T.top, w, capH);
        let y = T.top + capH; const midEnd = T.bottom - baseH;
        while (y < midEnd - 0.5) { const hh = Math.min(tileH, midEnd - y); ctx.drawImage(im, 0, midSrcY, im.width, midSrcH * (hh / tileH), x, y, w, hh); y += hh; }
        ctx.drawImage(im, 0, im.height * 0.92, im.width, im.height * 0.08, x, midEnd, w, baseH);
      }
    }

    drawCushions(ctx) {
      const g = this.game;
      for (let i = 0; i < g.slots.length; i++) {
        const p = this.slotPos(i);
        const im = IMG.basket; const bw = 118, bh = bw * (im ? im.height / im.width : 0.85);
        if (im) ctx.drawImage(im, p.x - bw / 2, p.y - bh / 2 + 6, bw, bh);
        else { ctx.fillStyle = '#c99a6b'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 56, 40, 0, 0, Math.PI * 2); ctx.fill(); }
        const b = g.slots[i];
        if (b && !this.moving.some(m => m.ball === b)) {
          const clogged = b.segs.length && !this.hasFree(b.segs[0][0]) && !this.kittens.some(k => k.slot === i && k.target);
          this.drawBall(ctx, b, p.x, p.y - 14, Math.min(40, this.L.r + 2), false, clogged);
          if (this.armed && ((this.armed === 'snip' && b.segs.length > 1) || this.armed === 'hook')) {
            ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(p.x, p.y - 14, 52, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          }
        }
      }
    }

    drawPile(ctx) {
      const g = this.game;
      // tray
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; roundRect(ctx, 30, this.L.pileTop, W - 60, this.L.pileBottom - this.L.pileTop, 24); ctx.fill();
      const inPile = g.balls.filter(b => b.state === 'pile');
      // tie strings between grouped balls
      const groups = {};
      for (const b of inPile) if (b.tie != null) (groups[b.tie] = groups[b.tie] || []).push(b);
      ctx.strokeStyle = '#e4002b'; ctx.lineWidth = 4; ctx.setLineDash([9, 7]);
      for (const id in groups) { const gr = groups[id]; for (let i = 0; i < gr.length - 1; i++) { const a = this.ballPos(gr[i]), b = this.ballPos(gr[i + 1]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 30, b.x, b.y); ctx.stroke(); } }
      ctx.setLineDash([]);
      // bags: draw the bag, then only its front ball peeking out
      const bagsDrawn = new Set();
      const balls = inPile.filter(b => b.bag == null).sort((a, b) => b.row - a.row);
      for (const b of inPile) if (b.bag != null && !bagsDrawn.has(b.bag)) {
        bagsDrawn.add(b.bag);
        const p = this.ballPos(b); const bg = IMG.prop_bag; const r = this.L.r; const d = r * 2.9;
        ctx.save(); if (!g.isAvailable(b) && !g.balls.some(o => o.bag === b.bag && o.state === 'pile' && g.isAvailable(o))) ctx.globalAlpha = 0.6;
        if (bg) ctx.drawImage(bg, p.x - d * bg.width / bg.height / 2, p.y - d * 0.42, d * bg.width / bg.height, d);
        ctx.restore();
      }
      for (const b of balls) { const p = this.ballPos(b); this.drawBall(ctx, b, p.x, p.y, this.L.r, !g.isAvailable(b)); }
      // front balls of bags on top of the bag, with a "left" badge
      for (const b of inPile) if (b.bag != null && g.isAvailable(b) === !g.balls.some(o => o.bag === b.bag && o !== b && o.state === 'pile' && o.bagIdx < b.bagIdx)) {
        if (g.balls.some(o => o.bag === b.bag && o !== b && o.state === 'pile' && o.bagIdx < b.bagIdx)) continue;
        const p = this.ballPos(b); const r = this.L.r;
        this.drawBall(ctx, b, p.x, p.y - r * 0.55, r * 0.9, !g.isAvailable(b));
        const left = g.balls.filter(o => o.bag === b.bag && o.state === 'pile').length;
        ctx.fillStyle = '#1f75fe'; ctx.beginPath(); ctx.arc(p.x + r * 0.95, p.y + r * 0.7, r * 0.38, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(r * 0.44) + 'px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(left), p.x + r * 0.95, p.y + r * 0.72);
      }
    }

    drawBall(ctx, b, x, y, r, dim, clogged) {
      const segs = b.segs.length ? b.segs : b.orig;
      const c0 = hexOf(segs[0][0]);
      const im = IMG.yarn;
      ctx.save();
      if (dim) ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      if (b.mystery && !b.shown) {
        // wrapped: paper parcel with a question mark, colour unknown
        const pm = IMG.prop_mystery; const d = r * 2.3;
        if (pm) ctx.drawImage(pm, x - d * pm.width / pm.height / 2, y - d / 2 - r * 0.15, d * pm.width / pm.height, d);
        else { ctx.fillStyle = '#e9dcc6'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#3b2f2a'; ctx.font = 'bold ' + r + 'px Nunito'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x, y); }
        if (b.tie != null) this.drawTieTag(ctx, b, x, y, r);
        ctx.restore(); return;
      }
      if (im) {
        const t0 = tinted('yarn', c0); const d = r * 2.15;
        if (segs.length > 1) {
          const t1 = tinted('yarn', hexOf(segs[1][0]));
          ctx.save(); ctx.beginPath(); ctx.moveTo(x - r * 1.2, y - r * 1.2); ctx.lineTo(x + r * 0.35, y - r * 1.2); ctx.lineTo(x - r * 0.35, y + r * 1.2); ctx.lineTo(x - r * 1.2, y + r * 1.2); ctx.closePath(); ctx.clip();
          ctx.drawImage(t0, x - d / 2, y - d / 2, d, d); ctx.restore();
          ctx.save(); ctx.beginPath(); ctx.moveTo(x + r * 0.35, y - r * 1.2); ctx.lineTo(x + r * 1.2, y - r * 1.2); ctx.lineTo(x + r * 1.2, y + r * 1.2); ctx.lineTo(x - r * 0.35, y + r * 1.2); ctx.closePath(); ctx.clip();
          ctx.drawImage(t1, x - d / 2, y - d / 2, d, d); ctx.restore();
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + r * 0.35, y - r * 0.95); ctx.lineTo(x - r * 0.35, y + r * 0.95); ctx.stroke();
        } else ctx.drawImage(t0, x - d / 2, y - d / 2, d, d);
      } else { ctx.fillStyle = c0; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      if (segs[0][0] === 'W') { ctx.strokeStyle = 'rgba(120,90,60,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, Math.PI * 2); ctx.stroke(); }
      // count label
      const label = segs.map(s => s[1]).join('·');
      ctx.font = 'bold ' + Math.round(r * 0.62) + 'px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(label).width + r * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; roundRect(ctx, x - tw / 2, y + r * 0.15, tw, r * 0.72, r * 0.3); ctx.fill();
      ctx.fillStyle = '#3b2f2a'; ctx.fillText(label, x, y + r * 0.53);
      if (clogged) { ctx.font = '26px sans-serif'; ctx.fillText('💤', x + r * 0.7, y - r * 0.7); }
      if (b.lock && !b.unlocked && b.state === 'pile') { const pl = IMG.prop_lock; const d = r * 1.1; if (pl) ctx.drawImage(pl, x - d * pl.width / pl.height / 2, y - r * 0.9, d * pl.width / pl.height, d); }
      if (b.tie != null) this.drawTieTag(ctx, b, x, y, r);
      ctx.restore();
    }
    drawTieTag(ctx, b, x, y, r) {
      const n = this.game.tieGroup(b).length; if (n < 2) return;
      ctx.fillStyle = '#e4002b'; ctx.beginPath(); ctx.arc(x - r * 0.75, y - r * 0.7, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(r * 0.42) + 'px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('×' + n, x - r * 0.75, y - r * 0.68);
    }

    drawKitten(ctx, k) {
      const b = this.game.slots[k.slot];
      const colour = k.colour || (b ? (b.segs.length ? b.segs[0][0] : b.orig[b.orig.length - 1][0]) : 'W');
      const sleeping = k.state === 'idle' && !k.orphan && b && b.segs.length && !this.hasFree(b.segs[0][0]);
      const h = Math.max(30, Math.min(52, this.cell * 2.4));
      if (sleeping) {
        const im = tinted('kitten_sleep', hexOf(colour), false); if (!im) return;
        const hh = h * 0.8, w = hh * im.width / im.height; ctx.drawImage(im, k.x - w / 2, k.y - hh / 2 + 6, w, hh); return;
      }
      if (k.state === 'vanish') {
        const u = Math.min(1, k.vanishT / VANISH_TIME); ctx.save(); ctx.globalAlpha = 1 - u; ctx.translate(k.x, k.y + u * 26); ctx.scale(1 - u * 0.6, 1 - u * 0.6); ctx.translate(-k.x, -k.y);
      }
      if (k.state === 'climb' && IMG.kitten_climb_sheet) {   // climbing cycle only on the cat trees; everywhere else kittens walk
        const cs = tinted('kitten_climb_sheet', hexOf(colour), false);
        const fw = cs.width / CLIMB_FRAMES, fh = cs.height;
        const frame = Math.floor(k.odo / CLIMB_STRIDE) % CLIMB_FRAMES;
        const ch = h * 1.15, w = ch * fw / fh;
        ctx.drawImage(cs, frame * fw, 0, fw, fh, k.x - w / 2, k.y - ch / 2, w, ch);
        if (k.state === 'vanish') ctx.restore();
        return;
      }
      if (k.state === 'vanish' && IMG.kitten_climb_sheet) {
        const cs = tinted('kitten_climb_sheet', hexOf(colour), false); const fw = cs.width / CLIMB_FRAMES, fh = cs.height; const ch = h * 1.15, w = ch * fw / fh;
        ctx.drawImage(cs, 0, 0, fw, fh, k.x - w / 2, k.y - ch / 2, w, ch); ctx.restore(); return;
      }
      if (k.state === 'swipe') {
        const u = k.swipeT / SWIPE_TIME;
        let frame = (u < 0.45 || (u > 0.7 && u < 0.85)) ? 0 : 1;   // raise, bat, raise, bat
        const batting = frame === 1;
        if (IMG.kitten_swipe_front_sheet) {                         // the ball is below the kitten: face the camera and bat down
          const sw = tinted('kitten_swipe_front_sheet', hexOf(colour), false);
          const fw = sw.width / 2, fh = sw.height, w = h * fw / fh, lunge = batting ? h * 0.08 : 0;
          ctx.drawImage(sw, frame * fw, 0, fw, fh, k.x - w / 2, k.y - h / 2 + lunge, w, h);
          return;
        }
        if (IMG.kitten_swipe_sheet) {
          const sw = tinted('kitten_swipe_sheet', hexOf(colour), k.dir < 0);
          const fw = sw.width / 2, fh = sw.height; if (k.dir < 0) frame = 1 - frame;
          const w = h * fw / fh, lunge = batting ? h * 0.08 : 0;
          ctx.drawImage(sw, frame * fw, 0, fw, fh, k.x - w / 2, k.y - h / 2 + lunge, w, h);
          return;
        }
      }
      // walking: pick the sheet for the heading (up = back view, down = front view, else side view mirrored for left)
      const heading = k.heading || (k.dir < 0 ? 'left' : 'right');
      const moving = k.state !== 'idle';
      let sheet = null, flip = false;
      if (heading === 'up' && IMG.kitten_walk_up_sheet && moving) sheet = tinted('kitten_walk_up_sheet', hexOf(colour), false);
      else if (heading === 'down' && IMG.kitten_walk_down_sheet && moving) sheet = tinted('kitten_walk_down_sheet', hexOf(colour), false);
      else if (IMG.kitten_walk_sheet) { flip = k.dir < 0; sheet = tinted('kitten_walk_sheet', hexOf(colour), flip); }
      if (sheet) {
        const fw = sheet.width / WALK_FRAMES, fh = sheet.height;
        let frame = moving ? WALK_CYCLE[Math.floor(k.odo / WALK_STRIDE) % WALK_CYCLE.length] : 0;
        if (flip) frame = WALK_FRAMES - 1 - frame; // side sheet is mirrored as a whole
        const w = h * fw / fh;
        const bob = moving ? Math.sin((k.odo / WALK_STRIDE) * Math.PI / 3) * h * 0.03 : Math.sin(this.time * 1.6 + k.x) * h * 0.012;
        ctx.drawImage(sheet, frame * fw, 0, fw, fh, k.x - w / 2, k.y - h / 2 + bob, w, h);
      } else {
        const im = tinted('kitten_walk', hexOf(colour), k.dir < 0); if (!im) return;
        const w = h * im.width / im.height; const bob = k.state === 'idle' ? 0 : Math.sin(k.odo / 12) * 3;
        ctx.drawImage(im, k.x - w / 2, k.y - h / 2 + bob, w, h);
      }
    }

    drawBoosters(ctx) {
      const items = [['basket', 'icon_basket', '+Cushion'], ['hook', 'icon_hook', 'Hook'], ['snip', 'icon_snip', 'Snip']];
      items.forEach(([key, icon, label], i) => {
        const x = W / 2 + (i - 1) * 150, y = BOOST_Y; const n = this.boosters[key];
        ctx.save(); if (n <= 0) ctx.globalAlpha = 0.4;
        if (this.armed === key) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, 48, 0, Math.PI * 2); ctx.stroke(); }
        const im = IMG[icon]; if (im) ctx.drawImage(im, x - 42, y - 42, 84, 84); else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = n > 0 ? '#e4002b' : '#a9a9b3'; ctx.beginPath(); ctx.arc(x + 32, y + 30, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), x + 32, y + 31);
        ctx.fillStyle = '#5a463a'; ctx.font = 'bold 16px Nunito, sans-serif'; ctx.fillText(label, x, y + 58);
        ctx.restore();
      });
    }
  }

  /* ---------- app shell ---------- */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = {
    title: document.getElementById('title'), select: document.getElementById('select'), hud: document.getElementById('hud'),
    over: document.getElementById('over'), levelGrid: document.getElementById('levelGrid'), hudLevel: document.getElementById('hudLevel'),
    hint: document.getElementById('hint'), speed: document.getElementById('btnSpeed'), mute: document.getElementById('btnMute'),
  };
  let session = null, last = 0, scale = 1, offX = 0, offY = 0, screen = 'title';

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    canvas.style.width = Math.round(W * scale) + 'px'; canvas.style.height = Math.round(H * scale) + 'px';
    offX = (vw - W * scale) / 2; offY = (vh - H * scale) / 2;
    canvas.style.left = offX + 'px'; canvas.style.top = offY + 'px';
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    document.documentElement.style.setProperty('--s', scale);
  }
  window.addEventListener('resize', resize); resize();

  function show(name) {
    screen = name;
    for (const k of ['title', 'select', 'hud', 'over']) ui[k].classList.toggle('show', k === name || (name === 'play' && k === 'hud'));
    if (name === 'select') buildSelect();
  }

  function buildSelect() {
    ui.levelGrid.innerHTML = '';
    const CH = window.WOOL_CHAPTERS || [];
    let lastCh = null;
    LEVELS.forEach(lv => {
      const ch = Math.ceil(lv.id / 10);
      if (ch !== lastCh) {
        lastCh = ch;
        const h = document.createElement('div'); h.className = 'chapter';
        const done = LEVELS.filter(l => Math.ceil(l.id / 10) === ch && l.id < Progress.unlocked).length;
        h.innerHTML = `<span class="chnum">Chapter ${ch}</span><span class="chname">${CH[ch - 1] || lv.chapter || ''}</span><span class="chdone">${done}/10</span>`;
        ui.levelGrid.appendChild(h);
      }
      const locked = lv.id > Progress.unlocked;
      const el = document.createElement('button');
      el.className = 'lvl' + (locked ? ' locked' : '') + (lv.id === Progress.unlocked ? ' current' : '');
      el.innerHTML = `<span class="num">${lv.id}</span><span class="name">${lv.name}</span><span class="stars">${'★'.repeat(Progress.stars(lv.id))}${'☆'.repeat(3 - Progress.stars(lv.id))}</span>`;
      if (!locked) el.onclick = () => { Sfx.init(); Sfx.click(); start(lv.id); };
      ui.levelGrid.appendChild(el);
    });
    const cur = ui.levelGrid.querySelector('.lvl.current'); if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 30);
  }

  function start(id) {
    const lv = LEVELS.find(l => l.id === id);
    session = new Session(lv);
    session.speed = parseInt(ui.speed.dataset.speed || '1', 10);
    ui.hudLevel.textContent = 'Level ' + lv.id + ' · ' + lv.name;
    ui.hint.textContent = lv.hint || '';
    if (lv.hint) { ui.hint.classList.add('show'); clearTimeout(ui.hint._t); ui.hint._t = setTimeout(() => ui.hint.classList.remove('show'), 6500); } else ui.hint.classList.remove('show');
    show('play');
  }

  /* Small image of the finished picture for the win card. */
  function renderPicture(lv) {
    const grid = E.parseGrid(lv.grid); const cs = Math.max(6, Math.floor(160 / Math.max(grid.w, grid.h)));
    const c = document.createElement('canvas'); c.width = grid.w * cs; c.height = grid.h * cs; const g = c.getContext('2d');
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (grid.cells[y][x]) g.drawImage(stitchTile(hexOf(grid.cells[y][x]), cs), x * cs, y * cs);
    return c.toDataURL();
  }

  function endLevel() {
    const s = session; const lv = s.level;
    const won = s.over === 'won';
    const stars = won ? (s.boostersUsed === 0 ? 3 : s.boostersUsed === 1 ? 2 : 1) : 0;
    if (won) { Progress.setStars(lv.id, stars); if (lv.id >= Progress.unlocked && lv.id < LEVELS.length) Progress.unlocked = lv.id + 1; }
    document.getElementById('overImg').src = won ? 'assets/kitten_win.png' : 'assets/kitten_fail.png';
    const pv = document.getElementById('overPic');
    if (won) { pv.src = renderPicture(lv); pv.style.display = ''; } else pv.style.display = 'none';
    document.getElementById('overTitle').textContent = won ? (lv.id === LEVELS.length ? 'All unravelled!' : 'Level ' + lv.id + ' unravelled!') : 'Every cushion is clogged';
    document.getElementById('overSub').textContent = won ? ('★'.repeat(stars) + '☆'.repeat(3 - stars) + (stars === 3 ? '  ·  no boosters, purr-fect' : '')) : 'The kittens have nothing loose to pull. Try a different order.';
    document.getElementById('btnNext').style.display = won && lv.id < LEVELS.length ? '' : 'none';
    document.getElementById('btnRetry').textContent = won ? 'Replay' : 'Try again';
    ui.over.dataset.level = lv.id;
    show('over');
  }

  /* input */
  function onTap(e) {
    if (screen !== 'play' || !session) return;
    Sfx.init();
    const pt = e.touches ? e.touches[0] : e;
    const px = (pt.clientX - offX) / scale, py = (pt.clientY - offY) / scale;
    session.tap(px, py);
    if (e.cancelable) e.preventDefault();
  }
  if (window.PointerEvent) canvas.addEventListener('pointerdown', onTap);
  else { canvas.addEventListener('touchstart', onTap, { passive: false }); canvas.addEventListener('mousedown', onTap); }
  document.getElementById('btnPlay').onclick = () => { Sfx.init(); Sfx.click(); show('select'); };
  document.getElementById('btnHow').onclick = () => { Sfx.init(); Sfx.click(); document.getElementById('how').classList.toggle('show'); };
  document.getElementById('btnHowClose').onclick = () => { document.getElementById('how').classList.remove('show'); };
  document.getElementById('btnBack').onclick = () => { Sfx.click(); show('select'); session = null; };
  document.getElementById('btnRestart').onclick = () => { Sfx.click(); start(session.level.id); };
  document.getElementById('btnSelectBack').onclick = () => { Sfx.click(); show('title'); };
  document.getElementById('btnNext').onclick = () => { Sfx.click(); start(parseInt(ui.over.dataset.level, 10) + 1); };
  document.getElementById('btnRetry').onclick = () => { Sfx.click(); start(parseInt(ui.over.dataset.level, 10)); };
  document.getElementById('btnMenu').onclick = () => { Sfx.click(); show('select'); session = null; };
  document.getElementById('btnHintShow').onclick = () => { ui.hint.classList.add('show'); clearTimeout(ui.hint._t); ui.hint._t = setTimeout(() => ui.hint.classList.remove('show'), 5200); };
  ui.speed.onclick = () => { const cur = parseInt(ui.speed.dataset.speed || '1', 10); const s = cur >= 3 ? 1 : cur + 1; ui.speed.dataset.speed = s; ui.speed.textContent = '▶ x' + s; if (session) session.speed = s; Sfx.click(); };
  function syncMute() { ui.mute.textContent = Sfx.muted ? '🔇' : '🔊'; }
  ui.mute.onclick = () => { Sfx.muted = !Sfx.muted; Store.set('woolflow.muted', Sfx.muted ? '1' : '0'); syncMute(); Sfx.init(); Sfx.click(); };
  syncMute();

  /* loop — requestAnimationFrame when it is healthy, timer fallback when the
     browser throttles it (background tabs, embedded previews, low-power modes). */
  let lastRaf = 0, rafAlive = false;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    ctx.clearRect(0, 0, W, H);
    if (screen === 'play' && session) {
      session.update(dt);
      session.draw(ctx);
      if (session.over) { screen = 'ending'; setTimeout(() => { if (session && session.over && screen === 'ending') endLevel(); }, 700); }
    } else if (screen === 'ending' && session) { session.update(dt); session.draw(ctx); }
  }
  function rafLoop(ts) { rafAlive = true; lastRaf = performance.now(); tick(ts); requestAnimationFrame(rafLoop); }
  setInterval(() => { const now = performance.now(); if (!rafAlive || now - lastRaf > 80) { tick(now); } }, 1000 / 60);
  window.WoolDebug = { get session() { return session; }, start, tick: (ms) => { for (let i = 0; i < ms / 16; i++) tick(last + 16); } };

  window.addEventListener('error', e => {
    const el = document.getElementById('loading');
    if (el) el.querySelector('p').textContent = 'Something snagged: ' + (e.message || 'unknown error') + ' — try reloading.';
  });

  loadAssets().then(() => {
    const ld = document.getElementById('loading'); if (ld) ld.remove();
    document.getElementById('logoImg').src = 'assets/logo.png';
    show('title');
    last = performance.now();
    requestAnimationFrame(rafLoop);
  });
})();
