// Tiny synthesized SFX via WebAudio (no assets). Rolling + grind loops are filtered noise.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    // noise buffer
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.roll = this.loop(400, 0.7);
    this.grind = this.loop(2600, 6);
  }
  loop(freq, q) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return { g, f };
  }
  setLoops(rollAmt, grindAmt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roll.g.gain.setTargetAtTime(this.enabled ? rollAmt * 0.25 : 0, t, 0.05);
    this.roll.f.frequency.setTargetAtTime(250 + rollAmt * 500, t, 0.1);
    this.grind.g.gain.setTargetAtTime(this.enabled ? grindAmt * 0.18 : 0, t, 0.03);
  }
  tone(freq, dur = 0.1, type = 'square', vol = 0.15, slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  pop(c = 0.5) { this.tone(150 + c * 90, 0.08 + c * 0.04, 'triangle', 0.25 + c * 0.15, -100); this.tone(900, 0.03, 'square', 0.05); }
  land() { this.tone(90, 0.12, 'sine', 0.35, -40); }
  bail() { this.tone(200, 0.4, 'sawtooth', 0.15, -170); }
  bump() { this.tone(70, 0.1, 'sine', 0.3); }
  trick(n = 0) { this.tone(520 + n * 40, 0.06, 'square', 0.06); }
  chime(i = 0) { const base = [523, 659, 784, 1046][i % 4]; this.tone(base, 0.15, 'triangle', 0.12); this.tone(base * 1.5, 0.2, 'sine', 0.06); }
  ship() { this.tone(784, 0.08, 'square', 0.07); setTimeout(() => this.tone(1175, 0.12, 'square', 0.07), 70); }
  rec() { this.tone(1200, 0.08, 'sine', 0.15); }
  goal() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.12), i * 90)); }
  click() { this.tone(1400, 0.03, 'square', 0.05); }
}
