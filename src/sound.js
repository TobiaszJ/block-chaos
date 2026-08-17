// Kleiner Audio-Motor: alle Effekte werden synthetisch erzeugt (WebAudio),
// keine externen Assets. Lautstärke moderat, pro Effekt eine Mindest-Pause
// gegen Überlagerungs-Spam.

let ctx = null;
let master = null;
let muted = false;
const MASTVOL = 0.4;
const lastPlay = {};

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTVOL;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

let _noise = null;
function noiseBuffer(c) {
  if (!_noise) {
    _noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = _noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return _noise;
}

function ok(name, minGap = 0) {
  const t = performance.now();
  if (lastPlay[name] && t - lastPlay[name] < minGap) return false;
  lastPlay[name] = t;
  return true;
}

// Ton: Frequenz von `freq` nach `end` über `dur` Sekunden
function tone({ freq = 440, end = null, dur = 0.1, type = 'sine', gain = 0.3, attack = 0.003 }) {
  const c = ensure(); if (!c) return;
  const endF = end === null ? freq : end;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), c.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, endF), c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(c.currentTime + dur + 0.02);
}

// Rauschen durch ein (bewegtes) Filter
function noise({ dur = 0.2, gain = 0.3, filter = 1000, filterEnd = null, q = 0.8 }) {
  const c = ensure(); if (!c) return;
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(filter, c.currentTime);
  if (filterEnd !== null) f.frequency.exponentialRampToValueAtTime(Math.max(30, filterEnd), c.currentTime + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  s.connect(f).connect(g).connect(master);
  s.start();
  s.stop(c.currentTime + dur + 0.02);
}

export const Sound = {
  unlock() { ensure(); },
  toggle() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : MASTVOL;
    return muted;
  },
  get muted() { return muted; },

  pop() { // Block zerbröselt
    if (!ok('pop', 40)) return;
    tone({ freq: 520, end: 170, dur: 0.09, type: 'triangle', gain: 0.4 });
    noise({ dur: 0.07, gain: 0.22, filter: 2600 });
  },
  place() {
    if (!ok('place', 40)) return;
    tone({ freq: 320, end: 250, dur: 0.06, type: 'triangle', gain: 0.25 });
  },
  laser() {
    if (!ok('laser', 90)) return;
    tone({ freq: 1300, end: 130, dur: 0.09, type: 'sawtooth', gain: 0.14 });
  },
  boom() {
    if (!ok('boom', 120)) return;
    noise({ dur: 0.8, gain: 0.9, filter: 480, filterEnd: 55 });
    tone({ freq: 95, end: 26, dur: 0.8, type: 'sine', gain: 0.95 });
  },
  thud(strength) { // Aufprall, strength ≈ Relativgeschwindigkeit in m/s
    if (!ok('thud', 90)) return;
    const s = Math.min(1, strength / 12);
    if (s < 0.18) return;
    tone({ freq: 130 - 40 * s, end: 50, dur: 0.1, type: 'sine', gain: 0.5 * s });
    noise({ dur: 0.05, gain: 0.2 * s, filter: 520 });
  },
  cannon() {
    if (!ok('cannon', 150)) return;
    noise({ dur: 0.35, gain: 0.7, filter: 950, filterEnd: 90 });
    tone({ freq: 75, end: 28, dur: 0.32, type: 'sine', gain: 0.75 });
  },
  flip() {
    tone({ freq: 160, end: 760, dur: 0.5, type: 'sine', gain: 0.3 });
    tone({ freq: 760, end: 160, dur: 0.4, type: 'sine', gain: 0.18 });
  },
  suck() { // Schwarzes Loch schluckt
    if (!ok('suck', 120)) return;
    tone({ freq: 240, end: 35, dur: 0.35, type: 'sawtooth', gain: 0.22 });
  },
  water() { // Quelle aktiviert
    if (!ok('water', 200)) return;
    tone({ freq: 300, end: 420, dur: 0.18, type: 'sine', gain: 0.2 });
  },
  wind() { // Windstoß: tiefer Saug + Rauschwall
    if (!ok('wind', 400)) return;
    tone({ freq: 180, end: 70, dur: 0.7, type: 'sawtooth', gain: 0.08 });
    noise({ dur: 0.9, gain: 0.4, filter: 260, filterEnd: 950, q: 1.3 });
  },
  balloon() { // Ballon steigt
    if (!ok('balloon', 150)) return;
    tone({ freq: 240, end: 420, dur: 0.25, type: 'sine', gain: 0.15 });
  },
};
