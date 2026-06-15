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
  arrow()     { this.noise(0.04, 0.18, 4000); this.tone(900, 0.05, 'square', 0.08, -300); },
  bossRoar()  { this.tone(80, 0.9, 'sawtooth', 0.5, -40); this.tone(55, 1.1, 'square', 0.35, -15); this.noise(0.6, 0.3, 300); },
  bossSlam()  { this.noise(0.25, 0.6, 250); this.tone(60, 0.3, 'sine', 0.5, -30); },
  bossDie()   { this.tone(70, 1.4, 'sawtooth', 0.5, -50); setTimeout(() => this.tone(523, 0.15, 'triangle', 0.4), 500); setTimeout(() => this.tone(659, 0.15, 'triangle', 0.4), 680); setTimeout(() => this.tone(784, 0.3, 'triangle', 0.4), 860); },
  chatPing()  { this.tone(880, 0.05, 'sine', 0.15); },

  // trueno: estruendo grave con cola de ruido
  thunder() {
    if (!this.ctx || this.muted) return;
    this.noise(1.0, 0.6, 320);
    this.tone(70, 1.3, 'sine', 0.5, -42);
    this.tone(46, 1.6, 'square', 0.24, -14);
  },

  // --- lluvia/nieve en bucle (ruido marrón filtrado, ganancia por intensidad) ---
  _rain: null,
  startRain(snow) {
    if (!this.ctx) return;
    if (this._rain) {
      if (this._rain.snow === !!snow) return;
      this.stopRain();          // cambió de tipo: rehaz el bucle
    }
    const n = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = snow ? 'lowpass' : 'bandpass';
    f.frequency.value = snow ? 480 : 1500; f.Q.value = snow ? 0.6 : 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this._rain = { src, g, snow: !!snow };
  },
  setRainLevel(v) {
    if (!this._rain) return;
    const cap = this._rain.snow ? 0.05 : 0.14;
    this._rain.g.gain.value = cap * Math.max(0, Math.min(1, v));
  },
  stopRain() {
    if (!this._rain) return;
    try { this._rain.src.stop(); } catch (e) { /* ya parado */ }
    this._rain = null;
  },

  // Ambiente sutil: pájaros de día, viento de noche. Se autogestiona el ritmo.
  _ambT: 0,
  ambient(dt, dark) {
    if (!this.ctx || this.muted) return;
    this._ambT -= dt;
    if (this._ambT > 0) return;
    if (dark > 0.6) {
      this._ambT = 5 + Math.random() * 5;
      this.noise(1.4, 0.05, 220);                       // viento grave y suave
    } else if (dark < 0.35) {
      this._ambT = 4 + Math.random() * 6;
      const base = 1500 + Math.random() * 900;          // trino de pájaro
      this.tone(base, 0.07, 'sine', 0.045, 140);
      setTimeout(() => this.tone(base * 1.2, 0.06, 'sine', 0.045, -90), 85);
      if (Math.random() < 0.5) setTimeout(() => this.tone(base * 0.92, 0.08, 'sine', 0.035, 70), 190);
    } else {
      this._ambT = 4;                                    // crepúsculo: silencio
    }
  },
};
