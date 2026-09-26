// Integrator soak: auto game, fastForward(120) in 10 s chunks, polling state/score/invariants/free-ball time.
const path = require('path');
const { openGame } = require('./harness.cjs');
const dir = path.join(__dirname, '..');
(async () => {
  const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [3, 11, 42];
  const device = process.argv[3] || 'desktop';
  let fail = 0;
  for (const seed of seeds) {
    const g = await openGame({ dir, device, page: `index.html?seed=${seed}&q=0.2&auto=1&debug=1` });
    const { page, diag } = g;
    await page.waitForTimeout(500);
    await page.click('#btnStart');
    await page.waitForFunction(() => window.__game.state === 'LIVE' || window.__game.state === 'CHECK', null, { timeout: 4000 });
    // Free-ball watchdog installed on top of game.step
    await page.evaluate(() => {
      const G = window.__game; const w = G.world;
      G.__freeMax = 0; G.__freeNow = 0; G.__nanSteps = 0; G.__shotClockBad = 0; G.__ballBounds = 0;
      const orig = G.game.step.bind(G.game);
      G.game.step = (dt) => {
        orig(dt);
        const b = w.ball;
        if (w.state === 'LIVE' && (b.state === 'flight' || b.state === 'pass' || b.state === 'loose')) { G.__freeNow += dt; if (G.__freeNow > G.__freeMax) G.__freeMax = G.__freeNow; } else G.__freeNow = 0;
        const bad = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z].some((v) => !Number.isFinite(v)) || w.players.some((p) => !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z) || !Number.isFinite(p.vel.x));
        if (bad) G.__nanSteps++;
        if (!(w.shotClock >= 0 && w.shotClock <= 14)) G.__shotClockBad++;
        if (Math.abs(b.pos.x) > 9 || b.pos.z < -16 || b.pos.z > 1) G.__ballBounds++;
      };
    });
    const timeline = [];
    const t0 = Date.now();
    for (let i = 0; i < 12; i++) {
      const r = await page.evaluate(() => {
        const G = window.__game; const t = performance.now(); G.fastForward(10); const ms = performance.now() - t;
        return { state: G.state, score: G.game.score.slice(), q: G.world.quarter, gc: +G.world.gameClock.toFixed(1), sc: +G.world.shotClock.toFixed(1), inv: G.invariantsBroken, freeMax: +G.__freeMax.toFixed(2), nan: G.__nanSteps, scBad: G.__shotClockBad, bounds: G.__ballBounds, ms: +ms.toFixed(0), stepMs: G.perf.stepMs };
      });
      timeline.push(r);
      if (r.state === 'GAME_OVER') break;
    }
    const stats = await page.evaluate(() => window.__game.world.players.map((p) => `${p.teamIdx}:${p.index} pts${p.stats.pts} fg${p.stats.fgm}/${p.stats.fga} 3p${p.stats.tpm} reb${p.stats.reb} stl${p.stats.stl} blk${p.stats.blk}`));
    const last = timeline[timeline.length - 1];
    const fga = await page.evaluate(() => window.__game.world.players.reduce((s, p) => s + p.stats.fga, 0));
    const teamFgm = await page.evaluate(() => [0, 1].map((t) => window.__game.world.players.filter((p) => p.teamIdx === t).reduce((s, p) => s + p.stats.fgm, 0)));
    const ok = (last.state === 'GAME_OVER' || last.q >= 5) && last.score[0] > 0 && last.score[1] > 0 && fga >= 6 && last.inv === 0 && last.freeMax <= 6 && last.nan === 0 && last.scBad === 0 && last.bounds === 0 && diag.errors.length === 0 && diag.pageErrors.length === 0;
    if (!ok) fail++;
    console.log(JSON.stringify({ seed, device, ok, fga, teamFgm, last, wall: Date.now() - t0, stats, errors: diag.errors, pageErrors: diag.pageErrors }, null, 1));
    console.log('timeline', timeline.map((r) => `${r.state}@Q${r.q} ${r.gc}s ${r.score.join('-')} free${r.freeMax} ${r.ms}ms`).join(' | '));
    await g.close();
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
