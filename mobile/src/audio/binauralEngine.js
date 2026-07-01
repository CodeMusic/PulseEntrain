import { AudioContext, AudioManager } from 'react-native-audio-api';
// Coefficients + noise generators are platform-agnostic and shared with the other
// synths (and the desktop Python preview); band helper lives in shared/entrainment.
import { NOISE_SECONDS, NOISE_LEVEL, NOISE_FILL } from '../shared/synthCoefficients';
import { bandFor } from '../shared/entrainment';

export { bandFor }; // re-export so importers (ManualScreen) keep their path

// iOS audio session policy. When mixing is on we use "playback + mixWithOthers"
// so our tones blend with other apps (guided meditations, music) instead of
// stopping them; off = exclusive playback (we take over the output). Driven by
// the user's Settings toggle via setMixWithOthers(). AudioManager is only present
// on native; the web stub omits the real one → guarded no-op there.
let _mixEnabled = true;

function applySessionOptions() {
  if (!AudioManager || typeof AudioManager.setAudioSessionOptions !== 'function') return;
  try {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playback',
      iosMode: 'default',
      iosOptions: _mixEnabled ? ['mixWithOthers'] : [],
      iosNotifyOthersOnDeactivation: true, // let the other app resume cleanly when we stop
    });
  } catch (e) {}
}

// Called by SettingsProvider on load and whenever the toggle changes. Applies
// immediately so it also affects a session that's already playing.
export function setMixWithOthers(enabled) {
  _mixEnabled = !!enabled;
  applySessionOptions();
}

function configureMixing() {
  applySessionOptions();
}

// A live binaural-beat synth: two hard-panned sine oscillators a `beat` Hz
// apart, plus an optional noise bed. Real-time setters drive the manual sliders;
// the same AudioParam scheduling will later drive AI-authored timelines.
export class BinauralEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.leftOsc = null;
    this.rightOsc = null;
    this.noiseSrc = null;
    this.noiseGain = null;
    this.carrier = 200;
    this.beat = 10;
    this.volume = 0.8;
    this.background = 'none';
    this.running = false;
  }

  start({ carrier = 200, beat = 10, volume = 0.8, background = 'none' } = {}) {
    if (this.running) this.stop();
    this.carrier = carrier;
    this.beat = beat;
    this.volume = volume;
    this.background = background;

    // Play as a "playback" session that *mixes with* other apps instead of
    // interrupting them — so a guided meditation (or any audio app) can run on
    // top of the binaural bed. Paired with the `audio` UIBackgroundMode, our
    // tones keep going after the user switches to the other app. No-op on web.
    configureMixing();

    const ctx = new AudioContext();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    this.master = master;

    const leftOsc = ctx.createOscillator();
    leftOsc.type = 'sine';
    leftOsc.frequency.value = carrier;
    const leftPan = ctx.createStereoPanner();
    leftPan.pan.value = -1;
    leftOsc.connect(leftPan);
    leftPan.connect(master);

    const rightOsc = ctx.createOscillator();
    rightOsc.type = 'sine';
    rightOsc.frequency.value = carrier + beat;
    const rightPan = ctx.createStereoPanner();
    rightPan.pan.value = 1;
    rightOsc.connect(rightPan);
    rightPan.connect(master);

    leftOsc.start();
    rightOsc.start();
    this.leftOsc = leftOsc;
    this.rightOsc = rightOsc;

    this._startNoise(background);
    this.running = true;
  }

  // Build a looping noise source (gain 0, caller ramps it). Returns {src, g}.
  _makeNoise(type) {
    const fill = NOISE_FILL[type];
    if (!fill || !this.ctx || !this.master) return null;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fill(buf.getChannelData(0));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.master);
    src.start();
    return { src, g };
  }

  _startNoise(type) {
    if (this.noiseSrc) {
      try {
        this.noiseSrc.stop();
      } catch (e) {}
      this.noiseSrc = null;
    }
    if (this.noiseGain) {
      try {
        this.noiseGain.disconnect();
      } catch (e) {}
      this.noiseGain = null;
    }
    if (type === 'none') return;
    const made = this._makeNoise(type);
    if (!made) return;
    made.g.gain.value = NOISE_LEVEL; // noise sits under the tones
    this.noiseSrc = made.src;
    this.noiseGain = made.g;
  }

  // Crossfade to a new noise bed over `seconds` (used by the .imedx timeline) —
  // overlaps the old and new beds with gain ramps so there's no click.
  crossfadeNoise(type, seconds = 1.2) {
    if (type === this.background) return;
    this.background = type;
    if (!this.ctx) {
      this._startNoise(type);
      return;
    }
    const now = this.ctx.currentTime;
    const oldSrc = this.noiseSrc;
    const oldGain = this.noiseGain;
    if (oldGain) {
      try {
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0, now + seconds);
      } catch (e) {}
      setTimeout(() => {
        try {
          oldSrc && oldSrc.stop();
        } catch (e) {}
        try {
          oldGain.disconnect();
        } catch (e) {}
      }, seconds * 1000 + 150);
    }
    if (type === 'none') {
      this.noiseSrc = null;
      this.noiseGain = null;
      return;
    }
    const made = this._makeNoise(type);
    if (!made) {
      this.noiseSrc = null;
      this.noiseGain = null;
      return;
    }
    try {
      made.g.gain.setValueAtTime(0, now);
      made.g.gain.linearRampToValueAtTime(NOISE_LEVEL, now + seconds);
    } catch (e) {
      made.g.gain.value = NOISE_LEVEL;
    }
    this.noiseSrc = made.src;
    this.noiseGain = made.g;
  }

  setBeat(beat) {
    this.beat = beat;
    if (this.rightOsc) this.rightOsc.frequency.value = this.carrier + beat;
  }
  setCarrier(carrier) {
    this.carrier = carrier;
    if (this.leftOsc) this.leftOsc.frequency.value = carrier;
    if (this.rightOsc) this.rightOsc.frequency.value = carrier + this.beat;
  }
  // Glide the carrier (and the right ear's carrier+beat) to a target over `seconds`
  // instead of jumping — a smooth portamento for note-driven carrier changes.
  glideCarrier(carrier, seconds = 1) {
    this.carrier = carrier;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const ramp = (param, to) => {
      try {
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(to, now + seconds);
      } catch (e) {
        param.value = to;
      }
    };
    if (this.leftOsc) ramp(this.leftOsc.frequency, carrier);
    if (this.rightOsc) ramp(this.rightOsc.frequency, carrier + this.beat);
  }
  // Glide just the beat (the right ear, carrier + beat) over `seconds`.
  glideBeat(beat, seconds = 0.3) {
    this.beat = beat;
    if (!this.rightOsc) return;
    if (!this.ctx) {
      this.rightOsc.frequency.value = this.carrier + beat;
      return;
    }
    const now = this.ctx.currentTime;
    const p = this.rightOsc.frequency;
    try {
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(this.carrier + beat, now + seconds);
    } catch (e) {
      p.value = this.carrier + beat;
    }
  }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // Ramp the master gain 0 → volume (start) over `seconds`.
  fadeIn(seconds) {
    if (!this.master || !this.ctx || seconds <= 0) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    try {
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(this.volume, now + seconds);
    } catch (e) {
      g.value = this.volume;
    }
  }

  // Ramp the master gain → 0 (end) over `seconds`.
  fadeOut(seconds) {
    if (!this.master || !this.ctx || seconds <= 0) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    try {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + seconds);
    } catch (e) {}
  }
  setBackground(type) {
    this.background = type;
    if (this.running) this._startNoise(type);
  }

  stop() {
    this.running = false;
    try { this.leftOsc && this.leftOsc.stop(); } catch (e) {}
    try { this.rightOsc && this.rightOsc.stop(); } catch (e) {}
    try { this.noiseSrc && this.noiseSrc.stop(); } catch (e) {}
    try { this.ctx && this.ctx.close && this.ctx.close(); } catch (e) {}
    this.leftOsc = this.rightOsc = this.noiseSrc = this.noiseGain = this.master = this.ctx = null;
  }
}
