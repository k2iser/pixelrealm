'use strict';
/* ============ Sonido procedural con WebAudio (sin archivos) ============ */

const Sfx = {
  ctx: null, master: null, muted: false,

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* navegador sin WebAudio: el juego sigue sin sonido */ }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.22;
    return this.muted;
  },

  tone(freq, dur, type, vol, slide) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol || 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol, cutoff) {
    if (!this.ctx || this.muted) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff || 1000;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.4;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  },

  // --- efectos del juego ---
  chop()      { this.noise(0.08, 0.5, 600); this.tone(160, 0.08, 'square', 0.22, -60); },
  mine()      { this.noise(0.06, 0.55, 1800); this.tone(700, 0.05, 'square', 0.12, -200); },
  swing()     { this.noise(0.05, 0.15, 3000); },
  place()     { this.tone(440, 0.06, 'square', 0.3, -120); this.tone(330, 0.08, 'square', 0.18); },
  poof()      { this.noise(0.15, 0.3, 500); },
  pickup()    { this.tone(660, 0.06, 'square', 0.22); setTimeout(() => this.tone(990, 0.08, 'square', 0.22), 60); },
  craft()     { this.tone(523, 0.08, 'triangle', 0.4); setTimeout(() => this.tone(784, 0.1, 'triangle', 0.4), 80); setTimeout(() => this.tone(1046, 0.12, 'triangle', 0.4), 160); },
  hurt()      { this.tone(220, 0.18, 'sawtooth', 0.4, -120); },
  mobHurt()   { this.tone(300, 0.1, 'square', 0.28, -150); },
  slimeJump() { this.tone(150, 0.1, 'sine', 0.18, 90); },
  eat()       { this.noise(0.07, 0.4, 900); setTimeout(() => this.noise(0.07, 0.4, 700), 110); },
  die()       { this.tone(330, 0.5, 'sawtooth', 0.45, -300); },
};
