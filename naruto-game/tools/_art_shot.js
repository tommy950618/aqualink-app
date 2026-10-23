// dev-only: screenshot art-gallery.html views. usage: node tools/_art_shot.js "<query>" out.png [width] [fullPage(1/0)]
const { chromium } = require('playwright');
(async () => {
  const q = process.argv[2] || 'view=real', out = process.argv[3] || 'shot.png', w = +process.argv[4] || 1400, full = process.argv[5] !== '0';
  const port = process.env.PORT || 8765;
  const browser = await chromium.launch({ executablePath: undefined });
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: +process.env.DPR || 1 });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(`http://localhost:${port}/art-gallery.html?${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__galleryDone === true, null, { timeout: 60000 });
  await page.evaluate(() => Promise.all(Array.from(document.images).map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  await page.waitForTimeout(300);
  await page.screenshot({ path: out, fullPage: full });
  const stat = await page.evaluate(() => document.getElementById('stat').textContent);
  console.log(stat); if (errs.length) console.log(errs.slice(0, 20).join('\n'));
  await browser.close();
})();
