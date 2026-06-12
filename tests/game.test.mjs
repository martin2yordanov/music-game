// Logic tests for index.html (Музикалното Оръдие).
// The game ships as a single static HTML file, so the suite extracts the
// inline <script>, evaluates it in a vm sandbox with a stub DOM/canvas/audio,
// and exercises the pure logic + physics directly.
//
// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

// ─────────────────────────────────────────────────────────────
// Static HTML checks
// ─────────────────────────────────────────────────────────────
test('no duplicate element ids in HTML', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const seen = new Set(), dup = new Set();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  assert.deepEqual([...dup], [], `duplicate ids: ${[...dup]}`);
});

test('page declares a favicon', () => {
  assert.ok(/<link rel="icon"/.test(html), 'favicon <link rel="icon"> present in <head>');
});

test('every getElementById target exists in the HTML (or is created at runtime)', () => {
  const created = new Set(['dAutoPlayBtn', 'mAutoPlayBtn', 'resizeWarnMsg']); // built dynamically
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const refs = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  const missing = refs.filter(r => !ids.has(r) && !created.has(r));
  assert.deepEqual(missing, [], `getElementById targets missing from HTML: ${missing}`);
});

// ─────────────────────────────────────────────────────────────
// Sandbox: stub DOM + canvas + audio, evaluate the game script
// ─────────────────────────────────────────────────────────────
function makeCtx2d() {
  const store = {};
  return new Proxy({}, {
    get(_, k) {
      if (k in store) return store[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 0 });
      return () => undefined; // any other method is a no-op
    },
    set(_, k, v) { store[k] = v; return true; },
  });
}

function makeEl(tag = 'div') {
  return {
    tag,
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    get lastChild() { return this.children[this.children.length - 1] ?? null; },
    get parentNode() { return { replaceChild() {} }; },
    cloneNode() { return makeEl(tag); },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    getContext() { return makeCtx2d(); },
    querySelectorAll() { return []; },
    clientWidth: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0,
    width: 0, height: 0,
    innerHTML: '', textContent: '',
    onclick: null, onmousedown: null,
  };
}

function makeSandbox() {
  const elements = new Map();
  const documentStub = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeEl());
      return elements.get(id);
    },
    createElement: tag => makeEl(tag),
    createElementNS: (_, tag) => makeEl(tag),
    querySelectorAll: () => [],
    body: makeEl('body'),
    addEventListener() {},
    removeEventListener() {},
  };
  const audioNode = () => ({
    type: '', connect() {}, start() {}, stop() {},
    frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
  });
  const sandbox = {
    console,
    document: documentStub,
    navigator: { maxTouchPoints: 0 },
    location: { reload() {} },
    performance: { now: () => 0 },
    setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {},
    AudioContext: class {
      resume() {}
      get currentTime() { return 0; }
      get destination() { return {}; }
      createOscillator() { return audioNode(); }
      createGain() { return audioNode(); }
    },
    MouseEvent: class { constructor(type, opts) { Object.assign(this, opts); this.type = type; } },
  };
  sandbox.window = sandbox;
  sandbox.window.innerWidth = 1400;
  sandbox.window.devicePixelRatio = 1;
  vm.createContext(sandbox);

  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'inline <script> block found');
  vm.runInContext(m[1], sandbox);
  // let/const live in the context's lexical scope, so all reads/writes of
  // game state must go through `run`, not sandbox properties.
  const run = code => vm.runInContext(code, sandbox);
  return { sandbox, run };
}

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────
test('color helpers', () => {
  const { run } = makeSandbox();
  assert.equal(run(`lightenColor('#000000',10)`), 'rgb(10,10,10)');
  assert.equal(run(`lightenColor('#ffffff',10)`), 'rgb(255,255,255)');
  assert.equal(run(`darkenColor('#ffffff',10)`), 'rgb(245,245,245)');
  assert.equal(run(`darkenColor('#000000',10)`), 'rgb(0,0,0)');
  assert.equal(run(`hexToRgbStr('#ff8000')`), '255,128,0');
});

test('ring note map covers all 7 notes plus exactly one hole gap', () => {
  const { run } = makeSandbox();
  const map = run('SHARED.RING_NOTE_MAP');
  assert.equal(map.length, 8);
  assert.equal(map.filter(v => v === -1).length, 1);
  assert.deepEqual([...map].filter(v => v >= 0).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
});

test('noteFreq: white keys map to the diatonic frequency table', () => {
  const { run } = makeSandbox();
  const freqs = run('SHARED.FREQS');
  for (let i = 0; i < 7; i++) {
    assert.equal(run(`noteFreq(${i})`), freqs[i], `note index ${i}`);
  }
});

test('noteFreq: black keys (fractional index) are true sharps, not the next white key', () => {
  const { run } = makeSandbox();
  // C# must sit between C (261.63) and D (293.66): equal-tempered ≈ 277.18
  const cSharp = run('noteFreq(0.5)');
  assert.ok(Math.abs(cSharp - 277.18) < 0.5, `C# expected ≈277.18, got ${cSharp}`);
  const fSharp = run('noteFreq(3.5)');
  assert.ok(Math.abs(fSharp - 370.0) < 0.7, `F# expected ≈369.99, got ${fSharp}`);
  // and it must never equal a plain white key (the old Math.round bug)
  const freqs = run('SHARED.FREQS');
  assert.ok(!freqs.includes(cSharp), 'C# must not collapse onto a white key');
});

// ─────────────────────────────────────────────────────────────
// Ring slot geometry
// ─────────────────────────────────────────────────────────────
test('desktop slot detection maps each wedge midpoint to its slot', () => {
  const { run } = makeSandbox();
  run('dW=1000; dH=800; dRingRotation=0;');
  const rp = run('dGetRing()');
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i + 0.5) * (Math.PI / 4);
    const px = rp.x + Math.cos(ang) * 60, py = rp.y + Math.sin(ang) * 60;
    assert.equal(run(`dGetSlotRaw(${px},${py})`), i, `slot ${i}`);
  }
});

test('desktop slot detection tracks ring rotation', () => {
  const { run } = makeSandbox();
  run('dW=1000; dH=800; dRingRotation=Math.PI/4;'); // rotate by exactly one slot
  const rp = run('dGetRing()');
  const ang = -Math.PI / 2 + Math.PI / 4 + 0.5 * (Math.PI / 4); // midpoint of rotated slot 0
  const px = rp.x + Math.cos(ang) * 60, py = rp.y + Math.sin(ang) * 60;
  assert.equal(run(`dGetSlotRaw(${px},${py})`), 0);
});

test('mobile slot detection maps each wedge midpoint to its slot', () => {
  const { run } = makeSandbox();
  run('mRW=160; mRH=160; mRingRot=0;');
  const rp = run('mGetRing()');
  for (let i = 0; i < 8; i++) {
    const ang = -Math.PI / 2 + (i + 0.5) * (Math.PI / 4);
    const px = rp.x + Math.cos(ang) * 40, py = rp.y + Math.sin(ang) * 40;
    assert.equal(run(`mGetSlotRaw(${px},${py})`), i, `slot ${i}`);
  }
});

// ─────────────────────────────────────────────────────────────
// Projectile physics — integration: a straight-up shot must reach
// the ring and record exactly one note (catches gravity/speed and
// collision regressions on both layouts).
// ─────────────────────────────────────────────────────────────
test('desktop: straight-up shot reaches the wheel and records one note', () => {
  const { run } = makeSandbox();
  run(`
    dW=1000; dH=800; dRingRotation=0;
    dState.gamePhase='play';
    dState.cannon.angle=-Math.PI/2;
    dState.cannon.loaded={color:'#e53935',noteIdx:0};
    dState.swapBall=null;
    dState.projectile=null;
    dState.notes.length=0;
  `);
  run('dLaunch()');
  assert.ok(run('dState.projectile !== null'), 'projectile launched');
  for (let i = 0; i < 500 && run('dState.projectile !== null'); i++) run('dUpdateProjectile(1)');
  assert.equal(run('dState.projectile'), null, 'projectile resolved');
  assert.equal(run('dState.notes.length'), 1, 'exactly one note recorded');
});

test('desktop: physics is stable at high-refresh dt (no tunneling)', () => {
  const { run } = makeSandbox();
  run(`
    dW=1000; dH=800; dRingRotation=0;
    dState.gamePhase='play';
    dState.cannon.angle=-Math.PI/2;
    dState.cannon.loaded={color:'#e53935',noteIdx:0};
    dState.swapBall=null;
    dState.projectile=null;
    dState.notes.length=0;
  `);
  run('dLaunch()');
  for (let i = 0; i < 500 && run('dState.projectile !== null'); i++) run('dUpdateProjectile(3)');
  assert.equal(run('dState.notes.length'), 1, 'note still recorded with dt=3 steps');
});

test('mobile: straight-up shot reaches the wheel and records one note', () => {
  const { run } = makeSandbox();
  run(`
    mFW=400; mFH=300; mRW=160; mRH=160; mRingRot=0;
    mState.gamePhase='play';
    mState.cannon.angle=-Math.PI/2;
    mState.cannon.loaded={color:'#e53935',noteIdx:0};
    mState.cannon.isSwap=false;
    mState.projectile=null;
    mState.notes.length=0;
  `);
  run('mLaunch()');
  assert.ok(run('mState.projectile !== null'), 'projectile launched');
  for (let i = 0; i < 800 && run('mState.projectile !== null'); i++) run('mUpdateProj(1)');
  assert.equal(run('mState.projectile'), null, 'projectile resolved');
  assert.equal(run('mState.notes.length'), 1, 'exactly one note recorded');
});

test('mobile: swap-phase shot into the hole registers a pending swap and uses an attempt', () => {
  const { run } = makeSandbox();
  // Place the hole gap (slot 7) at the impact direction. The projectile
  // climbs from below, so impact happens at angle +PI/2 from ring centre.
  // rel = ang - (rot - PI/2) must land mid-slot-7 (15PI/8) → rot = -7PI/8.
  run(`
    mFW=400; mFH=300; mRW=160; mRH=160;
    mRingRot = -7*Math.PI/8;
    mState.gamePhase='swap';
    mState.swapsLeft=3; mState.shotAttemptsLeft=3;
    mState.pendingSwapNote=-1;
    mState.cannon.angle=-Math.PI/2;
    mState.cannon.loaded={color:'#1e88e5',noteIdx:4};
    mState.cannon.isSwap=true;
    mState.projectile=null;
    mState.notes.length=0;
  `);
  run('mLaunch()');
  assert.equal(run('mState.shotAttemptsLeft'), 2, 'shot consumed an attempt');
  // freeze rotation during flight so the gap stays under the impact point
  for (let i = 0; i < 800 && run('mState.projectile !== null'); i++) run('mUpdateProj(1)');
  assert.equal(run('mState.pendingSwapNote'), 4, 'hole hit registered the pending swap note');
  assert.equal(run('mState.notes.length'), 0, 'swap ball must not record a melody note');
});

test('mobile: near-vertical shots always reach the wheel', () => {
  for (const frac of [0.45, 0.5, 0.55]) {
    const angle = -Math.PI * frac;
    const { run: r } = makeSandbox();
    r(`
      mFW=400; mFH=300; mRW=160; mRH=160; mRingRot=0;
      mState.gamePhase='play';
      mState.cannon.angle=${angle};
      mState.cannon.loaded={color:'#e53935',noteIdx:0};
      mState.cannon.isSwap=false;
      mState.projectile=null;
    `);
    r('mLaunch()');
    let minDist = Infinity;
    for (let i = 0; i < 800 && r('mState.projectile !== null'); i++) {
      r('mUpdateProj(1)');
      const p = r('mState.projectile');
      if (p) {
        const dx = p.x - 200, dy = p.y - (-80);
        minDist = Math.min(minDist, Math.hypot(dx, dy));
      }
    }
    const reached = minDist <= 160 * 0.42 + 12 + 8 || r('mState.notes.length') > 0;
    assert.ok(reached, `angle ${angle.toFixed(2)} should bring projectile near the wheel (minDist ${minDist.toFixed(0)})`);
  }
});

test('desktop: ball physics stays inside bounds under dt variation', () => {
  const { run } = makeSandbox();
  run('dW=1000; dH=800; dInitBalls();');
  for (let i = 0; i < 300; i++) run(`dUpdateBalls(${i % 2 ? 1 : 2.5})`);
  const balls = run('dState.balls');
  assert.equal(balls.length, 9);
  for (const b of balls) {
    assert.ok(b.x >= 15 && b.x <= 1000 - 15, `ball x ${b.x} in bounds`);
    assert.ok(b.y >= 55 && b.y <= 800 - 90, `ball y ${b.y} in bounds`);
  }
});

test('mobile: ball speed stays clamped', () => {
  const { run } = makeSandbox();
  run('mFW=400; mFH=300; mInitBalls();');
  for (let i = 0; i < 400; i++) run('mUpdateBalls(1)');
  const balls = run('mState.balls');
  assert.equal(balls.length, 7);
  for (const b of balls) {
    const s = Math.hypot(b.vx, b.vy);
    assert.ok(s <= 3.2 + 0.3, `speed ${s.toFixed(2)} within clamp`);
  }
});

// ─────────────────────────────────────────────────────────────
// Staff rendering (uses the stub DOM)
// ─────────────────────────────────────────────────────────────
test('renderStaffSVG: empty staff shows placeholder, notes render in rows of 5', () => {
  const { run } = makeSandbox();
  const empty = run('renderStaffSVG([], -1, -1, "play", ()=>{})');
  assert.ok(empty.innerHTML.includes('Запиши'), 'placeholder rendered');
  const one = run('renderStaffSVG([0,1,2], -1, -1, "play", ()=>{})');
  assert.equal(one.children.length, 1, '3 notes → 1 staff row');
  const two = run('renderStaffSVG([0,1,2,3,4,5,6], -1, -1, "play", ()=>{})');
  assert.equal(two.children.length, 2, '7 notes → 2 staff rows');
});
