'use strict';
/**
 * Likeness screenshots (spec v2 §10.4, phase D loop of §10.6): drives the showcase page (`index.html?showcase=1`,
 * src/showcase.js) in headless Chromium (SwiftShader) and writes PNGs to test/likeness/out/ (gitignore it).
 *
 *   node test/likeness/shoot.cjs [--url <page relative to the game folder>] [--tier high|medium|low]
 *                                [--out <dir>] [--only heads,expressions,...] [--timeout <s>]
 *
 * --url defaults to `index.html?showcase=1`; point it at the WP2 dev page meanwhile:
 *   node test/likeness/shoot.cjs --url test/scratch/wp2/showcase.html
 * Shots (§10.4 + WP2 acceptance): heads.png (6 × 3, yaw 0 / 0.6 / π/2, 360 px, fov 16, 1.3 m), expressions.png
 * (signature channel 1.0 / scowl 0.6 / blink 1.0), lineup_kit_front.png, lineup_kit_back.png, lineup_allstar.png,
 * lineup_34.png, lineup_side.png, kits.png, gameplay.png + crop_<id>.png (120 px tall), grey_crops.png, landmarks.png,
 * lod.png, turn.png. The page renders once per shot through `__showcase.setView` (one load for all shots); images are
 * read from the WebGL canvas (`__showcase.capture`), so the device-pixel size is exact (gameplay: DPR 1.5).
 */
const path = require('path');
const fs = require('fs');
const { startServer, launchBrowser } = require('../harness.cjs');

const ROOT = path.resolve(__dirname, '../..');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const SHOTS = [
  ['heads', 'heads', { yaws: '0,0.6,1.5708', cell: 360, fov: 16, dist: 1.3 }],
  ['expressions', 'expr', { cell: 360 }],
  ['lineup_kit_front', 'lineup', { yaw: 0, kit: 'classic', w: 2000, h: 1000, zoom: 1.6 }],
  ['lineup_kit_back', 'lineup', { yaw: Math.PI, kit: 'classic', w: 2000, h: 1000, zoom: 1.6 }],
  ['lineup_allstar', 'lineup', { yaw: 0, kit: 'allstar', w: 2000, h: 1000, zoom: 1.6 }],
  ['lineup_34', 'lineup', { yaw: 0.6, kit: 'classic', w: 2000, h: 1000, zoom: 1.6 }],
  ['lineup_side', 'lineup', { yaw: Math.PI / 2, kit: 'classic', w: 2000, h: 1000, zoom: 1.6 }],
  ['kits', 'kits', { yaw: 0, w: 1800, h: 1500, zoom: 1 }],
  ['gameplay', 'gameplay', { kit: 'classic', w: 844, h: 390, dpr: 1.5 }],
  ['grey_crops', 'gameplay', { kit: 'grey', w: 844, h: 390, dpr: 1.5 }],
  ['landmarks', 'landmarks', { cell: 360 }],
  ['lod', 'lod', { id: 'lebron', cell: 360 }],
  ['chest', 'heads', { yaws: '0,3.1416', cell: 400, fov: 16, dist: 2.6, cy: -0.42 }],
  ['feet', 'heads', { yaws: '0,1.5708,3.1416', cell: 360, fov: 16, dist: 1.5, focus: 'feet' }],
  ['atlas_kobe', 'atlas', { id: 'kobe' }],
  ['atlas_jordan', 'atlas', { id: 'jordan' }],
  ['turn', 'turn', { id: 'lebron', pose: 'twist', cell: 420 }],
];

function writeDataUrl(file, dataUrl) {
  fs.writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

(async () => {
  const out = path.resolve(arg('out', path.join(__dirname, 'out')));
  const tier = arg('tier', 'high');
  const only = arg('only', '') ? arg('only', '').split(',') : null;
  const timeout = Number(arg('timeout', 600)) * 1000;
  let page = arg('url', 'index.html?showcase=1');
  page += (page.includes('?') ? '&' : '?') + `tier=${tier}&view=heads&yaws=0`;
  fs.mkdirSync(out, { recursive: true });
  const srv = await startServer(ROOT);
  const browser = await launchBrowser();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    pg.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await pg.goto(srv.url + page);
    await pg.waitForFunction(() => (window.__showcase && window.__showcase.ready) || window.__showcaseError || (window.__showcase && window.__showcase.error), null, { timeout });
    const err = await pg.evaluate(() => window.__showcaseError || (window.__showcase && window.__showcase.error));
    if (err) throw new Error('showcase failed: ' + err);
    console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s (tier ${tier})`);
    for (const [name, view, params] of SHOTS) {
      if (only && !only.includes(name)) continue;
      const t1 = Date.now();
      await pg.evaluate(([v, p]) => window.__showcase.setView(v, p), [view, params]);
      if (name === 'grey_crops') {
        const crops = await pg.evaluate(() => window.__showcase.crops);
        const ids = Object.keys(crops);
        writeDataUrl(path.join(out, 'grey_crops.png'), await pg.evaluate(([c]) => window.__showcase.montage(c, 120), [ids.map((id) => crops[id])]));
      } else {
        writeDataUrl(path.join(out, name + '.png'), await pg.evaluate(() => window.__showcase.capture()));
        if (name === 'gameplay') {
          const crops = await pg.evaluate(() => window.__showcase.crops);
          for (const id of Object.keys(crops)) {
            writeDataUrl(path.join(out, `crop_${id}.png`), await pg.evaluate(([c]) => window.__showcase.capture({ crop: c, height: 120 }), [crops[id]]));
          }
        }
      }
      console.log(`${name}.png  ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    }
    const stats = await pg.evaluate(() => {
      const sc = window.__showcase, r = {};
      for (const [id, c] of Object.entries(sc.characters)) r[id] = { lod: c.lod, tris: c.bodyTriangles, kit: c.kitMode };
      return r;
    });
    console.log('characters', JSON.stringify(stats));
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
  if (errors.length) { console.log('console errors:\n  ' + errors.slice(0, 10).join('\n  ')); process.exitCode = 1; }
  console.log('out:', out);
})().catch((e) => { console.error(e); process.exit(1); });
