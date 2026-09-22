/* Procedural knit patterns — stripes, argyle, fair isle bands, quilts and friends.
 * Every generator takes (rng, w, h, colours[]) and returns rows of palette letters. */
function grid(w, h, f) { const out = []; for (let y = 0; y < h; y++) { let r = ''; for (let x = 0; x < w; x++) r += f(x, y) || '.'; out.push(r); } return out; }
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const PATTERNS = {
  'Stripes': (rng, w, h, c) => { const band = 2 + Math.floor(rng() * 2); return grid(w, h, (x, y) => c[Math.floor(y / band) % c.length]); },
  'Pinstripes': (rng, w, h, c) => { const band = 2 + Math.floor(rng() * 2); return grid(w, h, (x, y) => c[Math.floor(x / band) % c.length]); },
  'Checkerboard': (rng, w, h, c) => { const s = 2 + Math.floor(rng() * 2); return grid(w, h, (x, y) => c[(Math.floor(x / s) + Math.floor(y / s)) % 2 ? 1 : 0]); },
  'Chevron': (rng, w, h, c) => { const p = 3 + Math.floor(rng() * 3); return grid(w, h, (x, y) => { const v = Math.abs(((x % (2 * p)) - p)); return c[Math.floor((y + v) / 2) % c.length]; }); },
  'Argyle': (rng, w, h, c) => { const s = 4 + Math.floor(rng() * 3); return grid(w, h, (x, y) => { const d = Math.abs((x % (2 * s)) - s) + Math.abs((y % (2 * s)) - s); return d < s * 0.5 ? c[2 % c.length] : d < s ? c[1] : c[0]; }); },
  'Fair Isle': (rng, w, h, c) => { const rows = []; for (let y = 0; y < h; y++) { const band = Math.floor(y / 3) % 3; let r = ''; for (let x = 0; x < w; x++) { if (band === 0) r += c[0]; else if (band === 1) r += (x + y) % 2 ? c[1] : c[0]; else r += (x % 4 === y % 4 || x % 4 === 3 - (y % 4)) ? c[2 % c.length] : c[3 % c.length]; } rows.push(r); } return rows; },
  'Polka': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 2); return grid(w, h, (x, y) => (x % s === Math.floor(s / 2) && y % s === Math.floor(s / 2)) ? c[1] : ((x % s === Math.floor(s / 2) + 1 && y % s === Math.floor(s / 2)) && c.length > 2 ? c[2] : c[0])); },
  'Plaid': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 3); return grid(w, h, (x, y) => { const a = Math.floor(x / s) % 2, b = Math.floor(y / s) % 2; return a && b ? c[2 % c.length] : a || b ? c[1] : c[0]; }); },
  'Bullseye': (rng, w, h, c) => { const cx = (w - 1) / 2, cy = (h - 1) / 2; return grid(w, h, (x, y) => { const d = Math.max(Math.abs(x - cx), Math.abs(y - cy)); return c[Math.floor(d / 2) % c.length]; }); },
  'Sunburst': (rng, w, h, c) => { const cx = (w - 1) / 2, cy = (h - 1) / 2; return grid(w, h, (x, y) => { const a = Math.atan2(y - cy, x - cx); return c[Math.floor(((a + Math.PI) / (2 * Math.PI)) * c.length * 2) % c.length]; }); },
  'Hearts': (rng, w, h, c) => { const H = ['.RR.RR.', 'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...', '.......']; return grid(w, h, (x, y) => { const ch = H[y % 7][x % 7]; const tile = Math.floor(x / 7) + Math.floor(y / 7); return ch === 'R' ? c[tile % Math.max(1, c.length - 1) + 1] : c[0]; }); },
  'Zigzag Quilt': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 2); return grid(w, h, (x, y) => { const t = Math.floor(x / s) + Math.floor(y / s); const inTri = (x % s) + (y % s) < s; return c[(t + (inTri ? 0 : 1)) % c.length]; }); },
  'Patchwork': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 3); const bw = Math.ceil(w / s), bh = Math.ceil(h / s); const blocks = []; for (let i = 0; i < bw * bh; i++) blocks.push(pick(rng, c)); return grid(w, h, (x, y) => blocks[Math.floor(y / s) * bw + Math.floor(x / s)]); },
  'Waves': (rng, w, h, c) => { const amp = 1 + Math.floor(rng() * 2), band = 2 + Math.floor(rng() * 2); return grid(w, h, (x, y) => c[Math.floor((y + Math.round(Math.sin(x / 2) * amp)) / band + 100) % c.length]); },
  'Diamonds': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 2); return grid(w, h, (x, y) => { const d = Math.abs((x % (2 * s)) - s) + Math.abs((y % (2 * s)) - s); return c[Math.floor(d / 2) % c.length]; }); },
  'Ladder': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 2); return grid(w, h, (x, y) => (x % s === 0 || y % s === 0) ? c[1] : c[(Math.floor(x / s) + 2 * Math.floor(y / s)) % (c.length - 1) + 1 === 1 ? 0 : (Math.floor(x / s) + 2 * Math.floor(y / s)) % (c.length - 1) + 1]); },
  'Honeycomb': (rng, w, h, c) => grid(w, h, (x, y) => { const ox = Math.floor(y / 2) % 2 ? 2 : 0; const cell = Math.floor((x + ox) / 4) + Math.floor(y / 2) * 3; return ((x + ox) % 4 === 0) ? c[0] : c[1 + cell % (c.length - 1)]; }),
  'Basketweave': (rng, w, h, c) => { const s = 3 + Math.floor(rng() * 2); return grid(w, h, (x, y) => { const a = Math.floor(x / s), b = Math.floor(y / s); return (a + b) % 2 ? c[(y % s) % 2 ? 1 : 0] : c[(x % s) % 2 ? 2 % c.length : 0]; }); },
  'Gradient Steps': (rng, w, h, c) => grid(w, h, (x, y) => c[Math.min(c.length - 1, Math.floor(((x + y) / (w + h)) * c.length))]),
  'Confetti': (rng, w, h, c) => grid(w, h, (x, y) => (rng() < 0.75 ? c[0] : pick(rng, c.slice(1)))),
};

const NAMES = Object.keys(PATTERNS);
function makePattern(name, rng, w, h, colours) { return PATTERNS[name](rng, w, h, colours); }
module.exports = { PATTERNS, NAMES, makePattern };
