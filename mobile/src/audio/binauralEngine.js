import { AudioContext, AudioManager } from 'react-native-audio-api';
import { Buffer } from 'buffer';
// Coefficients + noise generators are platform-agnostic and shared with the other
// synths (and the desktop Python preview); band helper lives in shared/entrainment.
import { NOISE_SECONDS, NOISE_LEVEL, NOISE_FILL } from '../shared/synthCoefficients';
import { bandFor } from '../shared/entrainment';

// Optional embedded background music (a base64 MP3 in the .imedx). It plays once
// through a fade-in, ducks the noise bed a little while present, and fades out — at
// the track's end if it's longer than the track, or at its own end (track continues)
// if it's shorter. Level is a separate user slider.
const MUSIC_FADE_IN = 3; // seconds
const MUSIC_FADE_OUT = 3; // seconds
const MUSIC_DEFAULT_LEVEL = 0.5;
const MUSIC_NOISE_DUCK = 0.6; // noise bed multiplier while music is present

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
    this.musicSrc = null;
    this.musicFadeGain = null; // fade-in/out envelope
    this.musicLevelGain = null; // user level
    this.musicLevel = MUSIC_DEFAULT_LEVEL;
    this.hasMusic = false;
    this.carrier = 200;
    this.beat = 10;
    this.volume = 0.8;
    this.background = 'none';
    this.running = false;
  }

  _noiseLevel() {
    return NOISE_LEVEL * (this.hasMusic ? MUSIC_NOISE_DUCK : 1);
  }

  start({ carrier = 200, beat = 10, volume = 0.8, background = 'none', music = null, musicLevel } = {}) {
    if (this.running) this.stop();
    this.carrier = carrier;
    this.beat = beat;
    this.volume = volume;
    this.background = background;
    this.hasMusic = !!music;
    if (musicLevel != null) this.musicLevel = Math.max(0, Math.min(1, musicLevel));

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

    // Each ear passes through a "tremolo" gain that an LFO can pulse — used by
    // Field mode's cross-modal effect (pulse a tone in sync with an eye's flicker).
    // Default depth 0 = transparent, so normal binaural playback is unaffected.
    const leftOsc = ctx.createOscillator();
    leftOsc.type = 'sine';
    leftOsc.frequency.value = carrier;
    const leftTrem = ctx.createGain();
    leftTrem.gain.value = 1;
    const leftPan = ctx.createStereoPanner();
    leftPan.pan.value = -1;
    leftOsc.connect(leftTrem);
    leftTrem.connect(leftPan);
    leftPan.connect(master);

    const rightOsc = ctx.createOscillator();
    rightOsc.type = 'sine';
    rightOsc.frequency.value = carrier + beat;
    const rightTrem = ctx.createGain();
    rightTrem.gain.value = 1;
    const rightPan = ctx.createStereoPanner();
    rightPan.pan.value = 1;
    rightOsc.connect(rightTrem);
    rightTrem.connect(rightPan);
    rightPan.connect(master);

    leftOsc.start();
    rightOsc.start();
    this.leftOsc = leftOsc;
    this.rightOsc = rightOsc;
    this.leftTrem = leftTrem;
    this.rightTrem = rightTrem;
    this._buildEarPulse();

    this._startNoise(background);
    if (music) this._startMusic(music); // async decode; fades in when ready
    this.running = true;
  }

  // Decode a base64 MP3 (data URI or bare base64) and play it once under the tones:
  // src → fade envelope → user level → master. Fades in, and schedules its own fade-
  // out at its end (so a short clip fades while the track keeps going).
  async _startMusic(music) {
    if (!music || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    try {
      const b64 = String(music).includes(',') ? String(music).split(',').pop() : String(music);
      const bytes = Buffer.from(b64, 'base64');
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audioBuf = await ctx.decodeAudioData(ab);
      if (this.ctx !== ctx || !this.master) return; // stopped/restarted while decoding
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      const fade = ctx.createGain();
      fade.gain.value = 0;
      const level = ctx.createGain();
      level.gain.value = this.musicLevel;
      src.connect(fade);
      fade.connect(level);
      level.connect(this.master);
      const now = ctx.currentTime;
      const dur = audioBuf.duration;
      const fin = Math.min(MUSIC_FADE_IN, dur / 3);
      fade.gain.setValueAtTime(0, now);
      fade.gain.linearRampToValueAtTime(1, now + fin);
      const outStart = Math.max(now + fin, now + dur - MUSIC_FADE_OUT);
      fade.gain.setValueAtTime(1, outStart);
      fade.gain.linearRampToValueAtTime(0, now + dur);
      src.start(now);
      this.musicSrc = src;
      this.musicFadeGain = fade;
      this.musicLevelGain = level;
    } catch (e) {}
  }

  // The user's background-music level (separate slider). Does not touch the fades.
  setMusicVolume(v) {
    this.musicLevel = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.musicLevelGain) this._setParam(this.musicLevelGain.gain, this.musicLevel);
  }

  // Fade the music out over `seconds` — used when the track ends before the music does.
  fadeOutMusic(seconds = MUSIC_FADE_OUT) {
    if (!this.musicFadeGain || !this.ctx) return;
    const g = this.musicFadeGain.gain;
    const now = this.ctx.currentTime;
    try { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + seconds); } catch (e) {}
  }

  // Attach a per-ear LFO (osc → depth gain → tremolo gain param). Off until
  // setEarPulse() gives it a non-zero depth.
  _buildEarPulse() {
    if (!this.ctx) return;
    const mk = trem => {
      try {
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 1;
        const depth = this.ctx.createGain();
        depth.gain.value = 0; // silent until setEarPulse raises it
        lfo.connect(depth);
        depth.connect(trem.gain);
        lfo.start();
        return { lfo, depth };
      } catch (e) {
        return null;
      }
    };
    this.leftPulse = mk(this.leftTrem);
    this.rightPulse = mk(this.rightTrem);
  }

  // Field cross-modal: pulse each ear's tone at a given Hz, `depth` 0..1 (0 = off).
  // The caller decides the pairing (e.g. left ear ↔ right eye's flash rate).
  setEarPulse(leftHz, rightHz, depth = 0) {
    const d = Math.max(0, Math.min(1, Number(depth) || 0));
    const apply = (pulse, trem, hz) => {
      if (!pulse || !trem) return;
      try {
        pulse.lfo.frequency.value = Math.max(0.1, Math.min(60, Number(hz) || 1));
        pulse.depth.gain.value = d / 2; // ±d/2 around the tremolo baseline
        trem.gain.value = 1 - d / 2; // so gain swings between (1−d) and 1
      } catch (e) {}
    };
    apply(this.leftPulse, this.leftTrem, leftHz);
    apply(this.rightPulse, this.rightTrem, rightHz);
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
    made.g.gain.value = this._noiseLevel(); // noise sits under the tones (ducked under music)
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
      made.g.gain.linearRampToValueAtTime(this._noiseLevel(), now + seconds);
    } catch (e) {
      made.g.gain.value = this._noiseLevel();
    }
    this.noiseSrc = made.src;
    this.noiseGain = made.g;
  }

  // Set an AudioParam to `value` *now*, on the automation timeline. A prior ramp
  // (fadeIn, glide) leaves scheduled events that otherwise pin the param and make
  // plain `param.value = v` a no-op — so cancel them first, then anchor the value.
  _setParam(param, value) {
    if (!param) return;
    if (!this.ctx) {
      param.value = value;
      return;
    }
    const now = this.ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    } catch (e) {
      param.value = value;
    }
  }

  setBeat(beat) {
    this.beat = beat;
    if (this.rightOsc) this._setParam(this.rightOsc.frequency, this.carrier + beat);
  }
  setCarrier(carrier) {
    this.carrier = carrier;
    if (this.leftOsc) this._setParam(this.leftOsc.frequency, carrier);
    if (this.rightOsc) this._setParam(this.rightOsc.frequency, carrier + this.beat);
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
    if (this.master) this._setParam(this.master.gain, v);
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
    try { this.leftPulse && this.leftPulse.lfo.stop(); } catch (e) {}
    try { this.rightPulse && this.rightPulse.lfo.stop(); } catch (e) {}
    try { this.noiseSrc && this.noiseSrc.stop(); } catch (e) {}
    try { this.musicSrc && this.musicSrc.stop(); } catch (e) {}
    try { this.ctx && this.ctx.close && this.ctx.close(); } catch (e) {}
    this.leftOsc = this.rightOsc = this.noiseSrc = this.noiseGain = this.master = this.ctx = null;
    this.leftTrem = this.rightTrem = this.leftPulse = this.rightPulse = null;
    this.musicSrc = this.musicFadeGain = this.musicLevelGain = null;
  }
}
