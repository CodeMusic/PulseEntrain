import { AudioContext } from 'react-native-audio-api';

// How long a noise loop buffer is (seconds). Longer = less obvious looping.
const NOISE_SECONDS = 3;

// Noise bed loudness — the easy knob if it sits too loud/quiet under the beat.
// Absolute gain on a 0–1 scale: 1.0 ≈ as loud as the tones, so this is the
// fraction of "full". 0.1 = noise at 10% of full (turned down 90%).
const NOISE_LEVEL = 0.1;

// ---- noise generators (fill a Float32Array in place) ----
function fillWhite(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}
function fillPink(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}
function fillBrown(data) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    data[i] = last * 3.5;
  }
}
const NOISE_FILL = { white: fillWhite, pink: fillPink, brown: fillBrown };

// Map an entrainment (beat) frequency to its brainwave band name.
export const bandFor = beat => {
  if (beat < 4) return 'Delta';
  if (beat < 8) return 'Theta';
  if (beat < 13) return 'Alpha';
  if (beat < 30) return 'Beta';
  return 'Gamma';
};

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
