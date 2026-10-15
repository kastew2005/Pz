// ===================== audio.js — Web Audio API, всё процедурно =====================
import { clamp, rand, pick } from './consts.js';

export class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.rainGain = null; this.windGain = null; this.alarmNode = null; this.heliNode = null;
    this.heartT = 0; this.musicT = rand(8, 20); this.stingT = 0;
    this._noiseBuf = null;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = .85; this.master.connect(this.ctx.destination);
    // белый шум
    const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
    // дождь и ветер — зацикленные шлейфы
    this.rainGain = this._loopNoise(1400, .0, 'bandpass', 900);
    this.windGain = this._loopNoise(320, .03, 'lowpass', 400);
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : .85, this.ctx.currentTime, .05); }
  _loopNoise(freq, vol, type = 'bandpass', q = 1) {
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return g;
  }
  _noise(dur, { f = 1200, q = 1, type = 'bandpass', vol = .3, at = 0, sweep = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    src.playbackRate.value = rand(.85, 1.15);
    const flt = this.ctx.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (sweep) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f + sweep), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + .05);
  }
  _tone(dur, { f = 220, type = 'sine', vol = .2, at = 0, slide = 0, attack = .01 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  }
  _pan(vol, pan) { // стерео-панорама
    if (!this.ctx) return null;
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  // ---------- Игровые звуки ----------
  step(run, surface, vol = 1) {
    const f = surface === 'wood' ? 700 : surface === 'grass' ? 1500 : 1000;
    this._noise(.07, { f: f * rand(.8, 1.2), vol: (run ? .16 : .08) * vol, type: 'bandpass', q: 2 });
    if (surface === 'wood') this._tone(.05, { f: 120, type: 'triangle', vol: .05 * vol });
  }
  bush() { this._noise(.22, { f: 2400, vol: .1, q: .6 }); }
  swing() { this._noise(.18, { f: 900, sweep: -700, vol: .12, q: 1.5 }); }
  hitFlesh(vol = 1) {
    this._tone(.12, { f: 110, type: 'sine', vol: .35 * vol, slide: -60 });
    this._noise(.1, { f: 500, vol: .25 * vol, type: 'lowpass' });
  }
  shove() { this._tone(.1, { f: 150, type: 'sine', vol: .2, slide: -80 }); this._noise(.12, { f: 800, vol: .12 }); }
  dryClick() { this._tone(.03, { f: 2200, type: 'square', vol: .1 }); }
  pistol() {
    this._noise(.22, { f: 3000, vol: .7, type: 'highpass', sweep: -2400 });
    this._tone(.3, { f: 160, type: 'sawtooth', vol: .4, slide: -120 });
  }
  hurtPlayer() { this._tone(.25, { f: rand(190, 240), type: 'sawtooth', vol: .25, slide: -120 }); this._noise(.15, { f: 700, vol: .2 }); }
  bite() { this._noise(.18, { f: 350, vol: .35, type: 'lowpass' }); this._tone(.2, { f: 90, vol: .3, slide: -40 }); }
  zombieMoan(vol, pan, pitch = 1) {
    if (!this.ctx || this.muted || vol <= .01) return;
    const f = rand(70, 130) * pitch, t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * rand(.7, .9), t + .9);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = rand(5, 9);
    const lg = this.ctx.createGain(); lg.gain.value = f * .25; lfo.connect(lg); lg.connect(o.frequency);
    const flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 500;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * .5, t + .25); g.gain.linearRampToValueAtTime(0, t + 1.1);
    const out = this._pan(1, pan); o.connect(flt); flt.connect(g); g.connect(out);
    o.start(t); o.stop(t + 1.2); lfo.start(t); lfo.stop(t + 1.2);
    this._noise(.8, { f: 300, vol: vol * .12, type: 'lowpass' });
  }
  zombieAlert(vol = .5) { this.zombieMoan(vol, 0, 1.4); this._tone(.4, { f: 180, type: 'sawtooth', vol: vol * .2, slide: 120 }); }
  doorCreak() { this._tone(.5, { f: rand(300, 420), type: 'sawtooth', vol: .06, slide: 160 }); }
  doorBash(vol = .5) { this._tone(.09, { f: 90, type: 'sine', vol: vol * .5, slide: -30 }); this._noise(.08, { f: 400, vol: vol * .3, type: 'lowpass' }); }
  breakWood() { this._noise(.3, { f: 900, vol: .4, q: .7 }); this._tone(.15, { f: 140, type: 'triangle', vol: .25, slide: -70 }); }
  breakGlass() { for (let i = 0; i < 6; i++) this._tone(rand(.2, .4), { f: rand(1800, 4200), type: 'triangle', vol: .12, at: i * .03, slide: -900 }); this._noise(.25, { f: 3500, vol: .3, type: 'highpass' }); }
  pickup() { this._noise(.07, { f: 1800, vol: .1 }); this._tone(.08, { f: 640, type: 'triangle', vol: .08, slide: 120 }); }
  eat() { for (let i = 0; i < 3; i++) this._noise(.09, { f: 900, vol: .1, at: i * .16 }); }
  drink() { for (let i = 0; i < 3; i++) this._tone(.12, { f: 300 + i * 90, type: 'sine', vol: .09, at: i * .14, slide: 60 }); }
  clothTear() { this._noise(.3, { f: 2600, vol: .18, q: .5, sweep: -1200 }); }
  bandage() { this._noise(.35, { f: 3200, vol: .1, q: .5 }); }
  pills() { this._tone(.06, { f: 1400, type: 'square', vol: .07 }); this._tone(.09, { f: 900, type: 'sine', vol: .08, at: .1, slide: 100 }); }
  uiClick() { this._tone(.05, { f: 700, type: 'triangle', vol: .07, slide: 80 }); }
  craft() { this._noise(.15, { f: 1200, vol: .15 }); this._tone(.2, { f: 240, type: 'triangle', vol: .12, at: .12, slide: 80 }); }
  hammerHit() { this._tone(.08, { f: 260, type: 'square', vol: .2, slide: -120 }); this._noise(.06, { f: 1500, vol: .15 }); }
  sneeze() { this._noise(.3, { f: 1600, vol: .3, sweep: 900 }); }
  thunder() {
    this._noise(2.2, { f: 120, vol: .5, type: 'lowpass', sweep: -60 });
    this._noise(.5, { f: 800, vol: .25, at: .05, sweep: -400 });
  }
  sting() { // опасность
    this._tone(1.4, { f: 65, type: 'sawtooth', vol: .22, attack: .3 });
    this._tone(1.4, { f: 66.5, type: 'sawtooth', vol: .22, attack: .3 });
    this._tone(1.2, { f: 98, type: 'triangle', vol: .1, attack: .4 });
  }
  piano(freq, vol = .16, delay = 0) { // жуткое ночное пианино
    this._tone(2.8, { f: freq, type: 'triangle', vol, at: delay, attack: .005 });
    this._tone(2.4, { f: freq * 2.01, type: 'sine', vol: vol * .3, at: delay, attack: .005 });
  }
  heartbeat() { this._tone(.11, { f: 55, type: 'sine', vol: .3 }); this._tone(.09, { f: 48, type: 'sine', vol: .22, at: .16 }); }
  setRain(level) { if (this.rainGain) this.rainGain.gain.setTargetAtTime(this.muted ? 0 : level * .16, this.ctx.currentTime, .5); }
  alarmStart() {
    if (!this.ctx || this.alarmNode) return;
    const o = this.ctx.createOscillator(); o.type = 'square';
    const g = this.ctx.createGain(); g.gain.value = 0;
    const lfo = this.ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 1.6;
    const lg = this.ctx.createGain(); lg.gain.value = 260;
    o.frequency.value = 700; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setTargetAtTime(.05, this.ctx.currentTime, .2);
    o.connect(g); g.connect(this.master); o.start(); lfo.start();
    this.alarmNode = { o, g, lfo };
  }
  alarmStop() { if (this.alarmNode) { const { o, g, lfo } = this.alarmNode; g.gain.setTargetAtTime(0, this.ctx.currentTime, .15); o.stop(this.ctx.currentTime + .5); lfo.stop(this.ctx.currentTime + .5); this.alarmNode = null; } }
  heliStart() {
    if (!this.ctx || this.heliNode) return;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain(); g.gain.value = 0;
    const chop = this.ctx.createGain();
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 13;
    const lg = this.ctx.createGain(); lg.gain.value = .5; lfo.connect(lg); lg.connect(chop.gain); chop.gain.value = .5;
    g.gain.setTargetAtTime(.4, this.ctx.currentTime, 2);
    src.connect(f); f.connect(chop); chop.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.heliNode = { src, g, lfo };
  }
  heliStop() { if (this.heliNode) { const { src, g, lfo } = this.heliNode; g.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2); src.stop(this.ctx.currentTime + 2.5); lfo.stop(this.ctx.currentTime + 2.5); this.heliNode = null; } }
  // ---------- Цикл: сердцебиение, ночная музыка ----------
  tick(dt, G) {
    if (!this.ctx || this.muted) return;
    const p = G.player;
    const danger = G.zombies.chasingCount();
    // сердцебиение при низком хп или панике
    const hr = Math.max(panic01(p) * .8, p.health01() < .35 ? .9 - p.health01() : 0, danger > 2 ? .5 : 0);
    if (hr > .05) { this.heartT -= dt; if (this.heartT <= 0) { this.heartbeat(); this.heartT = 1.15 - hr * .55; } }
    // стинг опасности
    if (danger >= 4) { this.stingT -= dt; if (this.stingT <= 0) { this.sting(); this.stingT = 9; } }
    // ночное пианино
    if (G.world.isNight() && danger < 2) {
      this.musicT -= dt;
      if (this.musicT <= 0) {
        const scale = [220, 233.1, 261.6, 311.1, 329.6, 392, 440, 466.2];
        const n = pick(scale) * (Math.random() < .3 ? .5 : 1);
        this.piano(n, rand(.08, .16)); if (Math.random() < .4) this.piano(n * 1.189, .06, .3);
        this.musicT = rand(14, 38);
      }
    }
  }
}
function panic01(p) { return p.panic / 100; }
