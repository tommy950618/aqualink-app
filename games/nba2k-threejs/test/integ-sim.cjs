'use strict';
/**
 * @module test/integ-sim
 * Integrator soak for v2: CPU-vs-CPU games (`?auto=1&q=<min>&seed=<s>`) advanced with `fastForward(10)` chunks, with a
 * per-step watchdog wrapped around `game.step` (free-ball time, NaN in players / ball / character objects, shot clock
 * range, ball bounds) plus `__game.debug.invariantsBroken`, the box score of the six legends and the step cost.
 *
 * Usage: node test/integ-sim.cjs [seeds=3,11,42] [device=desktop] [q=0.2]
 * Pass: GAME_OVER (or OT) with both scores > 0, FGA ≥ 6, no NaN, invariants 0, free ball ≤ 6 s, shot clock ∈ [0, 14],
 * |ball.x| ≤ 9 and −16 ≤ ball.z ≤ 1, no console/page errors. Exit code 1 when a seed fails.
 */
const path = require('path');
const H = require('./harness.cjs');

const ROOT = path.join(__dirname, '..');

(async () => {
  const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [3, 11, 42];
  const device = process.argv[3] || 'desktop';
  const q = process.argv[4] || '0.2';
  const srv = await H.startServer(ROOT);
  const browser = await H.launchBrowser();
  let fail = 0;
  try {
    for (const seed of seeds) {
      const g = await H.openGame({ device, url: srv.url, page: `index.html?quick=1&intro=0&seed=${seed}&q=${q}&auto=1&replay=0`, browser });
      const { page, diag } = g;
      await H.startGame(page);
      await page.evaluate(() => {
        const G = window.__game; const w = G.world;
        const W = G.__soak = { freeMax: 0, freeNow: 0, nan: 0, nanWhere: null, scBad: 0, bounds: 0, steps: 0 };
        const pid = (p) => p.id || p.legendId || (p.legend && p.legend.id);
        const orig = G.game.step;
        G.game.step = function (dt) {
          const r = orig.apply(this, arguments); W.steps++;
          const b = G.ball; const bp = b.pos;
          if (w.state === 'LIVE' && b.state !== 'held' && b.state !== 'dribble') { W.freeNow += dt; if (W.freeNow > W.freeMax) W.freeMax = W.freeNow; } else W.freeNow = 0;
          if (![bp.x, bp.y, bp.z].every(Number.isFinite)) { W.nan++; W.nanWhere = W.nanWhere || 'ball'; }
          for (const p of w.players) { const q2 = p.pos || p; if (!Number.isFinite(q2.x) || !Number.isFinite(q2.z)) { W.nan++; W.nanWhere = W.nanWhere || 'player ' + pid(p); } }
          for (const id in (G.characters || {})) { const o = G.characters[id].object.position; if (![o.x, o.y, o.z].every(Number.isFinite)) { W.nan++; W.nanWhere = W.nanWhere || 'character ' + id; } }
          if (!(w.shotClock >= 0 && w.shotClock <= 14)) W.scBad++;
          if (Math.abs(bp.x) > 9 || bp.z < -16 || bp.z > 1) W.bounds++;
          return r;
        };
      });
      const timeline = []; const t0 = Date.now();
      for (let i = 0; i < 30; i++) {
        const r = await page.evaluate(() => {
          const G = window.__game; const t = performance.now(); G.fastForward(10); const ms = performance.now() - t;
          const s = (G.game && G.game.score) || G.world.score;
          return { state: G.state, score: [s[0], s[1]], q: G.world.quarter, gc: +G.world.gameClock.toFixed(1), inv: G.debug.invariantsBroken, ms: Math.round(ms), stepMs: G.perf && G.perf.stepMs, W: G.__soak };
        });
        timeline.push(r);
        if (r.state === 'GAME_OVER') break;
      }
      const box = await page.evaluate(() => window.__game.world.players.map((p) => { const id = p.id || p.legendId || (p.legend && p.legend.id); const s = window.__game.player(id).stats; return { id, team: p.team, pts: s.pts, fgm: s.fgm, fga: s.fga, tpm: s.tpm, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk }; }));
      const last = timeline[timeline.length - 1]; const W = last.W;
      const fga = box.reduce((s, p) => s + (p.fga || 0), 0);
      const ok = (last.state === 'GAME_OVER' || last.q >= 5) && last.score[0] > 0 && last.score[1] > 0 && fga >= 6 && last.inv === 0 && W.freeMax <= 6 && W.nan === 0 && W.scBad === 0 && W.bounds === 0 && diag.errors.length === 0 && diag.pageErrors.length === 0;
      if (!ok) fail++;
      console.log(JSON.stringify({ seed, device, ok, fga, last: { state: last.state, q: last.q, score: last.score, inv: last.inv, stepMs: last.stepMs }, watchdog: W, wall: Date.now() - t0, box, errors: diag.errors.slice(0, 3), pageErrors: diag.pageErrors.slice(0, 2) }, null, 1));
      console.log('timeline', timeline.map((r) => `${r.state}@Q${r.q} ${r.gc}s ${r.score.join('-')} ${r.ms}ms`).join(' | '));
      await g.close();
    }
  } finally { await browser.close(); await srv.close(); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
