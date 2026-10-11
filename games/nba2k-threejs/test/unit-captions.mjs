// unit-captions.mjs - spec v2 sections 6.5.8 / 9.4 (WP8): caption priority flush, 0.6 s cut, 2.0 s age drop, display
// durations (1.8 s + 0.3 s fade, ability 0.9 s), queue bound 4, clear() (R#19), language re-render (R#20), pooled
// params (payload reuse is safe) and {zh,en} names.
// Run: node test/unit-captions.mjs
import { Captions, CAPTION, priorityOf } from '../src/ui/captions.js';
import { setLang, getLang } from '../src/i18n.js';

let failures = 0, passes = 0;
function check(name, ok, extra) {
  if (ok) passes++;
  else { failures++; console.log('FAIL - ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

/** Fake DOM element: textContent + classList. */
function fakeEl() {
  const cls = new Set();
  return { textContent: '', classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, _cls: cls };
}

const KOBE = { zh: '科比', en: 'Kobe' };
const YAO = { zh: '姚明', en: 'Yao' };
const STEP = 1 / 60;
function run(c, seconds) { const n = Math.round(seconds / STEP); for (let i = 0; i < n; i++) c.update(STEP); }

setLang('zh');

// ---- constants and priorities ----
check('constants', CAPTION.SHOW === 1.8 && CAPTION.FADE === 0.3 && CAPTION.MAX_AGE === 2.0 && CAPTION.MIN_CUT === 0.6 && CAPTION.QUEUE === 4 && CAPTION.ABILITY_SHOW === 0.9);
check('priorityOf', priorityOf('cap.make2') === 3 && priorityOf('cap.turnover') === 3 && priorityOf('cap.shotClock') === 3
  && priorityOf('cap.block') === 2 && priorityOf('cap.ankle') === 2 && priorityOf('cap.ab.kyrie.combo') === 2
  && priorityOf('cap.rebound') === 1 && priorityOf('cap.miss') === 1);

// ---- basic display and timing ----
{
  const el = fakeEl();
  const c = new Captions(el);
  c.push('cap.rebound', { name: YAO }, 1);
  check('shows immediately with short name', el.textContent === '姚明 抢下篮板' && el.classList.contains('show') && c.visible);
  run(c, 1.75);
  check('still visible at 1.75 s', c.visible && el.classList.contains('show'));
  run(c, 0.1);
  check('fading after 1.8 s', !c.visible && !el.classList.contains('show') && c.current !== null);
  run(c, 0.3);
  check('gone after the 0.3 s fade', c.current === null && !c.visible);
}

// ---- R#42: a score replaces a stale rebound caption within 0.7 s ----
{
  const el = fakeEl();
  const c = new Captions(el);
  c.push('cap.miss', { name: KOBE }, 1);
  run(c, 0.2);
  c.push('cap.rebound', { name: YAO }, 1);
  check('rebound queued behind the miss', c.queueLength === 1 && el.textContent === '科比 投篮不中');
  c.push('cap.make2', { name: YAO }, 3);
  check('p3 flushes lower queued entries', c.queueLength === 1 && c.text === '科比 投篮不中');
  run(c, 0.3);
  check('score waits for the 0.6 s minimum of the current caption', el.textContent === '科比 投篮不中');
  run(c, 0.12);
  check('score shown once the current caption reached 0.6 s (within 0.7 s)', el.textContent === '姚明 两分命中' && c.visible, el.textContent);
  check('rebound dropped', c.queueLength === 0);
}
{
  const c = new Captions(null);
  c.push('cap.rebound', { name: YAO }, 1);
  run(c, 1.0);
  c.push('cap.make3', { name: YAO }, 3);
  check('p3 cuts a caption shown >= 0.6 s immediately', c.text === '姚明 三分命中！' && c.visible);
}
{
  // p3 while a p3 shows < 0.6 s: waits for the 0.6 s minimum, then cuts.
  const c = new Captions(null);
  c.push('cap.make2', { name: KOBE }, 3);
  run(c, 0.3);
  c.push('cap.buzzerBeater', { name: KOBE }, 3);
  check('second p3 waits for the minimum', c.text === '科比 两分命中');
  run(c, 0.32);
  check('second p3 cuts at 0.6 s', c.text === '科比 压哨命中！');
}

// ---- 2.0 s age drop ----
{
  const c = new Captions(null);
  c.push('cap.make2', { name: KOBE }, 3);           // shows 1.8 s + 0.3 s fade
  c.push('cap.rebound', { name: YAO }, 1);           // queued at t = 0
  run(c, 1.0);
  c.push('cap.steal', { name: YAO }, 2);             // queued at t = 1.0
  run(c, 1.15);                                      // t = 2.15: the rebound is 2.15 s old when the score caption ends
  check('stale entry (> 2.0 s) skipped at dequeue', c.text === '姚明 抢断！', c.text);
}
{
  // drop on push using world time
  const c = new Captions(null);
  c.update(0, 10);
  c.push('cap.make2', { name: KOBE }, 3);
  c.push('cap.rebound', { name: YAO }, 1);
  c.update(STEP, 12.5);                              // world time jumped (e.g. a dead-ball hold)
  c.push('cap.block', { name: KOBE }, 2);
  check('push drops entries older than 2.0 s (world time)', c.queueLength === 1, c.queueLength);
}

// ---- ability captions 0.9 s ----
{
  const c = new Captions(null);
  c.push('cap.ab.kyrie.combo', { name: { zh: '欧文', en: 'Kyrie' } }, 2);
  check('ability caption text', c.text === '欧文 连续变向');
  run(c, 0.95);
  check('ability caption fades after 0.9 s', !c.visible);
}

// ---- queue bound ----
{
  const c = new Captions(null);
  c.push('cap.make2', { name: KOBE }, 3);
  for (let i = 0; i < 6; i++) c.push('cap.rebound', { name: YAO }, 1);
  check('at most 4 queued', c.queueLength === 4, c.queueLength);
  c.push('cap.block', { name: KOBE }, 2);
  check('higher priority evicts the oldest lowest entry', c.queueLength === 4);
  const c2 = new Captions(null);
  c2.push('cap.make2', { name: KOBE }, 3);
  for (let i = 0; i < 4; i++) c2.push('cap.block', { name: YAO }, 2);
  c2.push('cap.rebound', { name: YAO }, 1);
  check('a newcomer lower than everything queued is discarded', c2.queueLength === 4);
}

// ---- clear() (R#19) ----
{
  const el = fakeEl();
  const c = new Captions(el);
  c.push('cap.make2', { name: KOBE }, 3);
  c.push('cap.rebound', { name: YAO }, 1);
  c.clear();
  check('clear empties queue and hides', c.queueLength === 0 && c.current === null && !c.visible && el.textContent === '' && !el.classList.contains('show'));
  run(c, 1);
  check('nothing comes back after clear', c.current === null);
  c.push('cap.steal', { name: YAO });
  check('push after clear works (default priority by key)', c.text === '姚明 抢断！' && c.current.priority === 2);
}

// ---- language toggle (R#20) ----
{
  const el = fakeEl();
  const c = new Captions(el);
  c.push('cap.make3', { name: KOBE }, 3);
  setLang('en');
  c.refreshLang();
  check('re-render in English', el.textContent === 'Kobe hits the three!', el.textContent);
  setLang('zh');
  c.refreshLang();
  check('back to Chinese', el.textContent === '科比 三分命中！');
}

// ---- pooled params: the emitter may reuse its payload object ----
{
  const c = new Captions(null);
  const payload = { name: KOBE };
  c.push('cap.make2', payload, 3);
  run(c, 0.5);
  c.push('cap.rebound', payload, 1);
  payload.name = YAO;                                // emitter reuses the object for the next event
  check('current caption unaffected by payload reuse', c.text === '科比 两分命中');
  run(c, 1.65);
  check('queued caption kept its own params', c.text === '科比 抢下篮板', c.text);
}

// ---- no allocation growth in steady update ----
{
  const c = new Captions(null);
  c.push('cap.make2', { name: KOBE }, 3);
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) c.update(STEP);
  const grow = process.memoryUsage().heapUsed - before;
  check('update() steady state allocates < 1 MB over 200k frames', grow < 1048576, grow);
}

check('language restored', getLang() === 'zh');
console.log(failures === 0 ? 'unit-captions: ALL OK (' + passes + ' checks)' : 'unit-captions: ' + failures + ' FAILURES, ' + passes + ' passed');
process.exit(failures === 0 ? 0 : 1);
