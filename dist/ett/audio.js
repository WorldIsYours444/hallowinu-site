/* Escape The Trenches — original procedural soundtrack + SFX (Web Audio, no audio files).
   Created on the first user gesture to respect browser autoplay rules. */

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
// D harmonic minor flavour — spooky but energetic
const BASS = [38, 38, 50, 38, 41, 41, 53, 41, 36, 36, 48, 36, 37, 37, 49, 37];
const ARP = [62, 65, 69, 74, 69, 65, 62, 65, 60, 64, 67, 72, 61, 64, 69, 73];
const LEAD = [74, 0, 73, 74, 77, 0, 76, 74, 72, 0, 70, 69, 70, 0, 69, 0, 74, 0, 73, 74, 77, 0, 79, 81, 82, 81, 79, 77, 76, 0, 73, 0];

export class Audio {
  constructor() {
    this.ctx = null; this.started = false;
    this.vol = { music: 0.55, sfx: 0.8, muted: false };
    this.step = 0; this.nextT = 0; this.tempo = 138; this.intensity = 0; this.musicOn = false;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.sfxBus = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.musicBus.connect(comp); this.sfxBus.connect(comp); comp.connect(this.master);
    // shared noise buffer
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // simple echo for the lead
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.32;
    const fb = ctx.createGain(); fb.gain.value = 0.28; const dl = ctx.createGain(); dl.gain.value = 0.35;
    this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(dl); dl.connect(this.musicBus);
    this.apply();
    this.started = true;
    this._timer = setInterval(() => this._schedule(), 25);
  }
  setVolumes(v) { Object.assign(this.vol, v); this.apply(); }
  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : 1, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * 0.9, t, 0.02);
  }
  music(on, intensity = 0) {
    this.musicOn = on; this.intensity = intensity;
    if (on && this.ctx && this.nextT < this.ctx.currentTime) { this.nextT = this.ctx.currentTime + 0.05; }
  }
  setIntensity(x) { this.intensity = x; this.tempo = 138 + Math.round(x * 18); }

  /* ---------------- sequencer ---------------- */
  _schedule() {
    if (!this.ctx || !this.musicOn) return;
    const ctx = this.ctx, spb = 60 / this.tempo / 4;   // 16th notes
    while (this.nextT < ctx.currentTime + 0.12) {
      const s = this.step, t = this.nextT, bar = Math.floor(s / 16) % 4, i = s % 16;
      const menu = this.intensity < 0;
      // drums
      if (!menu) {
        if (i % 4 === 0) this._kick(t);
        if (i === 4 || i === 12) this._snare(t);
        if (i % 2 === 0 || this.intensity > 0.5) this._hat(t, i % 4 === 2 ? 0.09 : 0.05);
      } else if (i === 0) this._kick(t, 0.5);
      // bass (8ths)
      if (i % 2 === 0) this._tone(NOTE(BASS[(bar * 4 + (i >> 2)) % 16]), t, spb * 1.8, 'sawtooth', menu ? 0.08 : 0.13, 380 + Math.max(0, this.intensity) * 500);
      // arpeggio
      if (!menu || i % 2 === 0) this._tone(NOTE(ARP[(bar * 4 + (i % 4)) % 16] + (i >= 8 ? 12 : 0)), t, spb * 0.8, 'square', 0.035, 2400);
      // lead melody every other phrase
      const ln = LEAD[(s >> 1) % 32];
      if (!menu && (s >> 1) % 2 === 0 && ln && Math.floor(s / 64) % 2 === 1) this._tone(NOTE(ln), t, spb * 2.4, 'triangle', 0.09, 3000, true);
      // organ pad on the bar
      if (i === 0) for (const n of [50, 53, 57]) this._tone(NOTE(n + [0, 0, -2, -1][bar]), t, spb * 15, 'triangle', 0.025, 1200);
      this.step++; this.nextT += spb;
    }
  }
  _tone(freq, t, dur, type, vol, cutoff = 2000, echo = false, bus) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq; f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(bus || this.musicBus); if (echo) g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(t, dur, vol, type, freq, bus, q = 1) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.musicBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
    return f;
  }
  _kick(t, v = 1) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25);
  }
  _snare(t) { this._noise(t, 0.14, 0.22, 'highpass', 1400); this._tone(190, t, 0.08, 'triangle', 0.1, 2000); }
  _hat(t, v) { this._noise(t, 0.04, v, 'highpass', 7000); }

  /* ---------------- SFX ---------------- */
  sfx(name, arg) {
    if (!this.ctx || this.vol.muted) return;
    const ctx = this.ctx, t = ctx.currentTime, B = this.sfxBus;
    const sweep = (f0, f1, dur, type = 'square', vol = 0.12) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(B); o.start(t); o.stop(t + dur + 0.02);
    };
    const tone = (f, at, dur, type = 'square', vol = 0.1) => this._tone(f, t + at, dur, type, vol, 6000, false, B);
    switch (name) {
      case 'jump': sweep(260, 620, 0.16, 'square', 0.09); break;
      case 'slide': this._noise(t, 0.3, 0.18, 'bandpass', 900, B, 0.8); sweep(300, 120, 0.25, 'triangle', 0.06); break;
      case 'lane': this._noise(t, 0.09, 0.08, 'bandpass', 2400, B, 2); break;
      case 'edge': sweep(160, 120, 0.06, 'square', 0.05); break;
      case 'land': this._noise(t, 0.07, 0.1, 'lowpass', 500, B); break;
      case 'step': this._noise(t, 0.04, 0.035, 'lowpass', 320, B); break;
      case 'coin1': tone(1318, 0, 0.07, 'square', 0.07); tone(1760, 0.05, 0.09, 'square', 0.06); break;
      case 'coin5': tone(1046, 0, 0.08, 'square', 0.08); tone(1318, 0.05, 0.08, 'square', 0.07); tone(1568, 0.1, 0.14, 'triangle', 0.09); break;
      case 'coin10': [1046, 1318, 1568, 2093, 2637].forEach((f, i) => tone(f, i * 0.045, 0.16, i % 2 ? 'triangle' : 'square', 0.08));
        this._noise(t + 0.05, 0.4, 0.05, 'highpass', 6000, B); break;
      case 'nearmiss': this._noise(t, 0.22, 0.12, 'bandpass', 1600, B, 3); break;
      case 'stumble': this._noise(t, 0.18, 0.3, 'lowpass', 300, B); this.sfx('rattle'); break;
      case 'crash': this._noise(t, 0.5, 0.45, 'lowpass', 600, B); sweep(180, 40, 0.5, 'sawtooth', 0.16); break;
      case 'rattle': for (let i = 0; i < 7; i++) { const tt = t + i * 0.045 + Math.random() * 0.02; this._tone(900 + Math.random() * 900, tt - t + t, 0.03, 'square', 0.05, 5000, false, B); } break;
      case 'bark': { const f = this._noise(t, 0.12, 0.35, 'bandpass', 700, B, 4); f.frequency.exponentialRampToValueAtTime(380, t + 0.12); sweep(420, 260, 0.1, 'sawtooth', 0.08);
        const t2 = t + 0.18; const f2 = this._noise(t2, 0.1, 0.3, 'bandpass', 760, B, 4); f2.frequency.exponentialRampToValueAtTime(400, t2 + 0.1); break; }
      case 'gameover': [392, 370, 349, 294].forEach((f, i) => tone(f, i * 0.32, i === 3 ? 0.9 : 0.3, 'sawtooth', 0.09)); break;
      case 'best': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.18, 'square', 0.09)); break;
      case 'redeem': [784, 988, 1175].forEach((f, i) => tone(f, i * 0.07, 0.12, 'triangle', 0.08)); break;
      case 'click': tone(880, 0, 0.04, 'square', 0.05); break;
      case 'whoosh': this._noise(t, 0.35, 0.12, 'bandpass', 600, B, 1); break;
      default: break;
    }
  }
}
