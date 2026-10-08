// Renders App Store screenshots (iPhone 6.3", 1206x2622) from the built web bundle using local Chrome.
// Usage: npm run build && node store/make-screenshots.js
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const www = path.join(__dirname, '..', 'www'), out = path.join(__dirname, 'screenshots');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  const f = path.join(www, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => errors.push('FAILED ' + r.url()));
  await page.addInitScript(() => {
    localStorage.setItem('woolflow.unlocked', '42');
    const stars = { 1: 3, 2: 3, 3: 3, 4: 2, 5: 3, 6: 3, 7: 2, 8: 3, 9: 3, 10: 3, 11: 3, 12: 3, 13: 2, 14: 3, 15: 3, 16: 3, 17: 3, 18: 2, 19: 3, 20: 3, 21: 3, 22: 3, 23: 3, 24: 2, 25: 3 };
    for (const k in stars) localStorage.setItem('woolflow.stars.' + k, stars[k]);
  });
  await page.goto(url); await page.waitForSelector('#title.show');
  await sleep(600);
  const shot = n => page.screenshot({ path: path.join(out, n + '.jpg'), type: 'jpeg', quality: 92 });
  await shot('01-title');
  await page.click('#btnPlay'); await sleep(500); await page.evaluate(() => { document.getElementById('levelGrid').scrollTop = 0; }); await sleep(200); await shot('02-level-select');

  async function play(level, taps, wait, name) {
    await page.evaluate(l => { WoolDebug.start(l); }, level);
    await sleep(500);
    for (let i = 0; i < taps; i++) {
      await page.evaluate(() => {
        const s = WoolDebug.session, g = s.game, balls = g.playableBalls();
        const free = balls.filter(b => g.isAvailable(b));
        const b = (free.length ? free : balls)[0]; if (!b) return;
        const p = s.ballPos(b); s.tap(p.x, p.y);
      });
      await sleep(900);
    }
    await sleep(wait); await shot(name);
  }
  await play(1, 3, 3500, '03-play-first-picture');
  await play(14, 4, 4500, '04-play-wrapped-balls');
  await play(33, 4, 4500, '05-play-knitting-bag');
  await play(54, 4, 4500, '06-play-zipped-patch');
  await play(78, 5, 5000, '07-play-big-picture');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/network errors');
  await browser.close(); server.close();
})();
