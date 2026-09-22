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
    const pic = { x: 44, y: 104, w: 632, h: cushY - 66 - 104 };
    return { pic, cushY, pileY, rowH, spacing, r, pileTop: pileY - r - 16, pileBottom: pileBottom + r + 10 };
  }
  const KITTENS_PER_SLOT = 3;
  const KITTEN_SPEED = 620; // px / s

  /* ---------- safe storage (Safari with cookies blocked / in-app browsers throw) ---------- */
  const Store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
  };

  /* ---------- assets ---------- */
  const IMG = {};
  const ASSET_LIST = ['yarn', 'kitten_walk', 'kitten_carry', 'kitten_sleep', 'basket', 'icon_basket', 'icon_hook', 'icon_snip', 'logo', 'kitten_win', 'kitten_fail'];
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

  /* Pre-rendered knit stitch tile per colour and size. */
  const stitchCache = new Map();
  function stitchTile(hex, s) {
    const key = hex + '_' + s;
    if (stitchCache.has(key)) return stitchCache.get(key);
    const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d');
    const r = Math.max(2, s * 0.22);
    g.fillStyle = hex; roundRect(g, 0.5, 0.5, s - 1, s - 1, r); g.fill();
    // knit "v" highlight + shade
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, s * 0.12);
    g.beginPath(); g.moveTo(s * 0.22, s * 0.28); g.lineTo(s * 0.5, s * 0.62); g.lineTo(s * 0.78, s * 0.28); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.moveTo(s * 0.22, s * 0.5); g.lineTo(s * 0.5, s * 0.84); g.lineTo(s * 0.78, s * 0.5); g.stroke();
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
      this.kittens = [];      // {slot, colour, x, y, state, tx, ty, t, dur, sx, sy, cx, cy}
      this.particles = [];
      this.floaters = [];     // floating text
      this.moving = [];       // balls sliding pile -> cushion
      this.popping = [];      // balls finished (shrink anim)
      this.held = new Set();  // "x,y" stitches logically pulled but still drawn until the kitten grabs them
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
      if (g.freeSlot() < 0) { this.shake = 0.3; Sfx.clog(); this.float(W / 2, this.L.cushY - 70, 'No free cushion!', '#e8453c'); return; }
      const from = this.ballPos(b);
      const s = g.play(b.id);
      if (s < 0) return;
      const to = this.slotPos(s);
      this.moving.push({ ball: b, x0: from.x, y0: from.y, x1: to.x, y1: to.y - 14, t: 0, dur: 0.32 });
      Sfx.place();
      if (!g.hasLoose(b.segs[0][0])) { this.float(to.x, to.y - 90, 'waiting…', '#7a6a5a'); }
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
        if (g.addSlot()) { this.boosters.basket--; this.boostersUsed++; Sfx.done(); this.float(W / 2, this.L.cushY - 80, '+1 cushion', '#5fbf5a'); this.checkEnd(); }
        return;
      }
      this.armed = this.armed === kind ? null : kind; Sfx.click();
      if (this.armed) this.float(W / 2, this.L.cushY - 80, kind === 'hook' ? 'Tap a cushion to hook its yarn back' : 'Tap a tangled ball to snip it', '#7a6a5a');
    }
    applyArmed(i) {
      const g = this.game, kind = this.armed; this.armed = null;
      if (this.kittens.some(k => k.slot === i && k.state !== 'idle')) { this.float(this.slotPos(i).x, this.L.cushY - 80, 'kittens busy!', '#e8453c'); return; }
      if (kind === 'hook') {
        const b = g.slots[i];
        if (g.hook(i)) { this.boosters.hook--; this.boostersUsed++; this.kittens = this.kittens.filter(k => k.slot !== i); Sfx.done(); this.burst(this.slotPos(i).x, this.L.cushY, hexOf(b.segs[0][0]), 10); }
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
      const sdt = dt * this.speed;
      if (this.shake > 0) this.shake -= dt;
      // ball slide animations
      for (const m of this.moving) m.t += dt;
      this.moving = this.moving.filter(m => m.t < m.dur);
      for (const p of this.popping) p.t += dt;
      this.popping = this.popping.filter(p => p.t < 0.35);
      // kittens
      for (let s = 0; s < g.slots.length; s++) {
        const b = g.slots[s];
        if (!b) { this.kittens = this.kittens.filter(k => k.slot !== s); continue; }
        if (this.moving.some(m => m.ball === b)) continue; // still sliding in
        let mine = this.kittens.filter(k => k.slot === s);
        while (mine.length < KITTENS_PER_SLOT) {
          const p = this.slotPos(s);
          const k = { slot: s, colour: b.segs.length ? b.segs[0][0] : null, x: p.x + (mine.length - 1) * 22, y: p.y + 30, state: 'idle', t: 0, dur: 0, wait: mine.length * 0.15, carry: null, dir: 1 };
          this.kittens.push(k); mine.push(k);
        }
        for (const k of mine) {
          if (k.state === 'idle') {
            if (k.wait > 0) { k.wait -= sdt; continue; }
            if (!b.segs.length) continue;
            const info = g.pull(s);
            if (!info) { k.sleepy = true; continue; }
            k.sleepy = false;
            this.held.add(info.x + ',' + info.y);
            const t = this.stitchPos(info.x, info.y);
            k.colour = info.colour; k.carry = null; k.target = info; k.sx = k.x; k.sy = k.y; k.tx = t.x; k.ty = t.y + this.cell * 0.1;
            k.dur = Math.hypot(k.tx - k.sx, k.ty - k.sy) / KITTEN_SPEED; k.t = 0; k.state = 'go'; k.dir = k.tx >= k.sx ? 1 : -1;
            if (info.segDone && !info.ballDone) { const p = this.slotPos(s); this.float(p.x, p.y - 90, 'colour change!', hexOf(b.segs[0][0])); this.burst(p.x, p.y - 14, hexOf(b.segs[0][0]), 8); }
          } else if (k.state === 'go') {
            k.t += sdt;
            if (k.t >= k.dur) {
              // grab the stitch
              this.held.delete(k.target.x + ',' + k.target.y);
              this.burst(k.tx, k.ty, hexOf(k.colour), 4); Sfx.pop();
              k.carry = k.colour; const p = this.slotPos(s);
              k.sx = k.x; k.sy = k.y; k.tx = p.x + (Math.random() - 0.5) * 30; k.ty = p.y + 30; k.dur = Math.hypot(k.tx - k.sx, k.ty - k.sy) / KITTEN_SPEED; k.t = 0; k.state = 'back'; k.dir = k.tx >= k.sx ? 1 : -1;
            } else { const u = k.t / k.dur; k.x = lerp(k.sx, k.tx, u); k.y = lerp(k.sy, k.ty, u); }
          } else if (k.state === 'back') {
            k.t += sdt;
            if (k.t >= k.dur) { k.x = k.tx; k.y = k.ty; k.state = 'idle'; k.carry = null; k.wait = 0.05; }
            else { const u = k.t / k.dur; k.x = lerp(k.sx, k.tx, u); k.y = lerp(k.sy, k.ty, u); }
          }
        }
        // ball finished?
        if (!b.segs.length && !mine.some(k => k.state !== 'idle')) {
          const p = this.slotPos(s);
          this.popping.push({ x: p.x, y: p.y - 14, colour: hexOf(b.orig[b.orig.length - 1][0]), t: 0, r: this.L.r });
          this.burst(p.x, p.y - 14, hexOf(b.orig[b.orig.length - 1][0]), 14); Sfx.done();
          g.finishBall(s); this.kittens = this.kittens.filter(k => k.slot !== s);
        }
      }
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
      if (this.kittens.some(k => k.state !== 'idle') || this.moving.length) return;
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
      for (const m of this.moving) { const u = easeOut(Math.min(1, m.t / m.dur)); this.drawBall(ctx, m.ball, lerp(m.x0, m.x1, u), lerp(m.y0, m.y1, u) - Math.sin(u * Math.PI) * 60, Math.min(40, this.L.r), false); }
      for (const p of this.popping) { const u = p.t / 0.35; ctx.globalAlpha = 1 - u; ctx.fillStyle = p.colour; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + u * 0.6), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      // kittens
      for (const k of this.kittens) this.drawKitten(ctx, k);
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
      ctx.fillStyle = '#c99a6b'; roundRect(ctx, PIC.x, PIC.y, PIC.w, PIC.h, 26); ctx.fill();
      ctx.fillStyle = '#e6d3b8'; roundRect(ctx, PIC.x + 14, PIC.y + 14, PIC.w - 28, PIC.h - 28, 18); ctx.fill();
      // faint canvas grid of the picture (ghost of the finished image)
      const s = this.cell;
      for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) {
        const c = g.grid.cells[y][x]; if (!c) continue;
        const px = this.gridX + x * s, py = this.gridY + y * s;
        if (g.removed[y][x] && !this.held.has(x + ',' + y)) { ctx.fillStyle = 'rgba(0,0,0,0.045)'; ctx.fillRect(px + 1, py + 1, s - 2, s - 2); continue; }
        ctx.drawImage(stitchTile(hexOf(c), Math.max(4, s - 1)), px, py);
      }
      // loose-row indicator: little "thread" on stitches that are loose
      if (s >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) {
          if (!g.isLoose(x, y)) continue;
          const px = this.gridX + x * s, py = this.gridY + y * s;
          ctx.beginPath(); ctx.moveTo(px + s * 0.3, py + 2); ctx.lineTo(px + s * 0.7, py + 2); ctx.stroke();
        }
      }
      // progress
      const pct = g.cleared / g.total;
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; roundRect(ctx, PIC.x + 60, PIC.y + PIC.h - 8, PIC.w - 120, 12, 6); ctx.fill();
      ctx.fillStyle = '#5fbf5a'; roundRect(ctx, PIC.x + 60, PIC.y + PIC.h - 8, Math.max(12, (PIC.w - 120) * pct), 12, 6); ctx.fill();
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
          const clogged = b.segs.length && !g.hasLoose(b.segs[0][0]);
          this.drawBall(ctx, b, p.x, p.y - 14, Math.min(40, this.L.r + 2), false, clogged);
          if (this.armed && ((this.armed === 'snip' && b.segs.length > 1) || this.armed === 'hook')) {
            ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 5; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(p.x, p.y - 14, 52, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
          }
        }
      }
    }

    drawPile(ctx) {
      const g = this.game;
      // tray
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; roundRect(ctx, 30, this.L.pileTop, W - 60, this.L.pileBottom - this.L.pileTop, 24); ctx.fill();
      const balls = g.balls.filter(b => b.state === 'pile').sort((a, b) => b.row - a.row);
      for (const b of balls) { const p = this.ballPos(b); this.drawBall(ctx, b, p.x, p.y, this.L.r, !g.isAvailable(b)); }
    }

    drawBall(ctx, b, x, y, r, dim, clogged) {
      const segs = b.segs.length ? b.segs : b.orig;
      const c0 = hexOf(segs[0][0]);
      const im = IMG.yarn;
      ctx.save();
      if (dim) ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
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
      ctx.restore();
    }

    drawKitten(ctx, k) {
      const b = this.game.slots[k.slot];
      const sleeping = k.state === 'idle' && b && b.segs.length && !this.game.hasLoose(b.segs[0][0]);
      const name = sleeping ? 'kitten_sleep' : (k.carry ? 'kitten_carry' : 'kitten_walk');
      const im = tinted(name, hexOf(k.colour || (b && b.segs.length ? b.segs[0][0] : 'W')), k.dir < 0);
      const h = sleeping ? 42 : 52; const w = im ? h * im.width / im.height : 42;
      const bob = k.state === 'idle' ? 0 : Math.sin(this.time * 22) * 3;
      if (im) ctx.drawImage(im, k.x - w / 2, k.y - h / 2 + bob, w, h);
      if (k.carry) { const s = Math.max(8, this.cell * 0.7); ctx.drawImage(stitchTile(hexOf(k.carry), s), k.x + (k.dir < 0 ? -w / 2 - s * 0.2 : w / 2 - s * 0.8), k.y - s * 0.2 + bob); }
    }

    drawBoosters(ctx) {
      const items = [['basket', 'icon_basket', '+Cushion'], ['hook', 'icon_hook', 'Hook'], ['snip', 'icon_snip', 'Snip']];
      items.forEach(([key, icon, label], i) => {
        const x = W / 2 + (i - 1) * 150, y = BOOST_Y; const n = this.boosters[key];
        ctx.save(); if (n <= 0) ctx.globalAlpha = 0.4;
        if (this.armed === key) { ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, 48, 0, Math.PI * 2); ctx.stroke(); }
        const im = IMG[icon]; if (im) ctx.drawImage(im, x - 42, y - 42, 84, 84); else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 40, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = n > 0 ? '#5fbf5a' : '#999'; ctx.beginPath(); ctx.arc(x + 32, y + 30, 15, 0, Math.PI * 2); ctx.fill();
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
    LEVELS.forEach(lv => {
      const locked = lv.id > Progress.unlocked;
      const el = document.createElement('button');
      el.className = 'lvl' + (locked ? ' locked' : '');
      el.innerHTML = `<span class="num">${lv.id}</span><span class="name">${lv.name}</span><span class="stars">${'★'.repeat(Progress.stars(lv.id))}${'☆'.repeat(3 - Progress.stars(lv.id))}</span>`;
      if (!locked) el.onclick = () => { Sfx.init(); Sfx.click(); start(lv.id); };
      ui.levelGrid.appendChild(el);
    });
  }

  function start(id) {
    const lv = LEVELS.find(l => l.id === id);
    session = new Session(lv);
    session.speed = parseInt(ui.speed.dataset.speed || '1', 10);
    ui.hudLevel.textContent = 'Level ' + lv.id + ' · ' + lv.name;
    ui.hint.textContent = lv.hint;
    ui.hint.classList.add('show'); clearTimeout(ui.hint._t); ui.hint._t = setTimeout(() => ui.hint.classList.remove('show'), 5200);
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
  ui.speed.onclick = () => { const s = ui.speed.dataset.speed === '2' ? 1 : 2; ui.speed.dataset.speed = s; ui.speed.textContent = '▶ x' + s; if (session) session.speed = s; Sfx.click(); };
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
