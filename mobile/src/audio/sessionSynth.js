import { BinauralEngine } from './binauralEngine';

// Plays a self-contained (.imedx) session: drives BinauralEngine through the
// scene timeline (carrier/beat interpolated per scene) plus the noise bed, while
// tracking position/duration so PlayerScreen can render the same transport it
// uses for bundled MP3s. Same engine the Manual mode uses, so a previewed/saved
// session sounds the same here as in the desktop Admin.
const ENGINE_NOISE = new Set(['white', 'pink', 'brown']); // others fall back to closest

function normalizeNoise(type) {
  if (!type || type === 'none') return 'none';
  if (ENGINE_NOISE.has(type)) return type;
  if (type === 'grey') return 'pink';
  return 'none'; // blue/violet not in the RN engine yet
}

export class SessionSynth {
  /**
   * @param {{ scenes?: Array<{atSec:number,beatHz:number,carrierHz?:number}>, carrier?: number,
   *           duration?: number, noise?: string, volume?: number,
   *           onTick?: (pos:number, beat:number)=>void, onEnded?: ()=>void }} [opts]
   */
  constructor(opts = {}) {
    const { scenes, carrier = 200, duration, noise = 'none', volume = 1, onTick, onEnded } = opts;
    this.scenes = (scenes || []).slice().sort((a, b) => a.atSec - b.atSec);
    this.baseCarrier = carrier || 200;
    this.duration =
      duration || (this.scenes.length ? this.scenes[this.scenes.length - 1].atSec : 60) || 60;
    this.noise = normalizeNoise(noise);
    this.volume = volume;
    this.onTick = onTick;
    this.onEnded = onEnded;
    this.engine = new BinauralEngine();
    this.position = 0;
    this.playing = false;
    this._offset = 0;
    this._t0 = 0;
    this._timer = null;
  }

  // Linear interpolation of carrier+beat at time t across the scene keyframes.
  _at(t) {
    const s = this.scenes;
    if (!s.length) return { carrier: this.baseCarrier, beat: 0 };
    const carrierOf = sc => (sc.carrierHz == null ? this.baseCarrier : sc.carrierHz);
    if (t <= s[0].atSec) return { carrier: carrierOf(s[0]), beat: s[0].beatHz };
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      if (t <= b.atSec) {
        const f = (t - a.atSec) / ((b.atSec - a.atSec) || 1);
        return {
          carrier: carrierOf(a) + (carrierOf(b) - carrierOf(a)) * f,
          beat: a.beatHz + (b.beatHz - a.beatHz) * f,
        };
      }
    }
    const last = s[s.length - 1];
    return { carrier: carrierOf(last), beat: last.beatHz };
  }

  play() {
    if (this.playing) return;
    const { carrier, beat } = this._at(this.position);
    this.engine.start({ carrier, beat, volume: this.volume, background: this.noise });
    this._t0 = Date.now();
    this.playing = true;
    this._timer = setInterval(() => this._tick(), 200);
  }

  _tick() {
    this.position = this._offset + (Date.now() - this._t0) / 1000;
    if (this.position >= this.duration) {
      this.position = this.duration;
      this.pause();
      this._offset = this.duration;
      if (this.onEnded) this.onEnded();
      return;
    }
    const { carrier, beat } = this._at(this.position);
    this.engine.setCarrier(carrier);
    this.engine.setBeat(beat);
    if (this.onTick) this.onTick(this.position, beat);
  }

  pause() {
    if (!this.playing) return;
    this.position = this._offset + (Date.now() - this._t0) / 1000;
    this._offset = Math.min(this.position, this.duration);
    this.playing = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.engine.stop();
  }

  seek(sec) {
    this._offset = Math.max(0, Math.min(this.duration, sec));
    this.position = this._offset;
    if (this.playing) {
      this._t0 = Date.now();
      const { carrier, beat } = this._at(this.position);
      this.engine.setCarrier(carrier);
      this.engine.setBeat(beat);
    }
  }

  // Beat at the current position — lets the caller drive Nova/light in sync.
  beatNow() {
    return this._at(this.position).beat;
  }

  setVolume(v) {
    this.volume = v;
    this.engine.setVolume(v);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.playing = false;
    this.engine.stop();
  }
}
