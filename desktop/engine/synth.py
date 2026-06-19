"""
Binaural preview synth for the Admin app.

Mirrors the mobile BinauralEngine (mobile/src/audio/binauralEngine.js) so a preview
here sounds like the eventual mobile render:
  - two hard-panned sine oscillators: left = carrier, right = carrier + beat
  - master gain 0.8; a looped noise bed mixed under the tones
  - identical white/pink/brown generators (same coefficients)
carrier & beat follow the .imedx scene timeline (linear interpolation); noise level
comes from the bed (mobile uses 0.25, which is our default). Real-time via
sounddevice with phase-continuous oscillators (no clicks) and a looped 3 s noise
buffer (low memory, even for a 30-min track).
"""
import numpy as np

SR = 44100
MASTER = 0.8
NOISE_SECONDS = 3
FADE_SECONDS = {"none": 0.0, "slow": 2.0, "medium": 1.0, "fast": 0.5}


# ---- noise generators (match binauralEngine.js) ----
def _white(n):
    return np.random.uniform(-1.0, 1.0, n)


def _pink(n):
    out = np.empty(n)
    b = [0.0] * 7
    for i in range(n):
        w = np.random.uniform(-1.0, 1.0)
        b[0] = 0.99886 * b[0] + w * 0.0555179
        b[1] = 0.99332 * b[1] + w * 0.0750759
        b[2] = 0.969 * b[2] + w * 0.153852
        b[3] = 0.8665 * b[3] + w * 0.3104856
        b[4] = 0.55 * b[4] + w * 0.5329522
        b[5] = -0.7616 * b[5] - w * 0.016898
        out[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11
        b[6] = w * 0.115926
    return out


def _brown(n):
    out = np.empty(n)
    last = 0.0
    for i in range(n):
        w = np.random.uniform(-1.0, 1.0)
        last = (last + 0.02 * w) / 1.02
        out[i] = last * 3.5
    return out


def _make_noise(kind, n):
    if kind == "white":
        return _white(n)
    if kind == "pink" or kind == "grey":   # grey ~ perceptual-flat; pink is the closest cheap match
        return _pink(n)
    if kind == "brown":
        return _brown(n)
    if kind == "blue":                      # rising spectrum: differentiate white
        d = np.diff(_white(n), prepend=0.0)
        return d / (np.max(np.abs(d)) or 1.0)
    if kind == "violet":                    # steeper rise: differentiate twice
        d = np.diff(np.diff(_white(n), prepend=0.0), prepend=0.0)
        return d / (np.max(np.abs(d)) or 1.0)
    return None


def _tracks(scenes, base_carrier):
    if not scenes:
        return np.array([0.0]), np.array([float(base_carrier)]), np.array([0.0])
    ss = sorted(scenes, key=lambda s: s["atSec"])
    t = np.array([float(s["atSec"]) for s in ss])
    carr = np.array([float(s.get("carrierHz", base_carrier)) for s in ss])
    beat = np.array([float(s["beatHz"]) for s in ss])
    return t, carr, beat


class BinauralPreview:
    """Render+play a session's binaural beats + noise bed, matching mobile."""

    def __init__(self, imed):
        au = imed.get("audio", {}) or {}
        self.base_carrier = (au.get("binaural") or {}).get("carrierHz", 200) or 200
        self.t, self.carr, self.beat = _tracks(imed.get("entrainment", {}).get("scenes", []), self.base_carrier)
        self.duration = imed.get("meta", {}).get("durationSec") or (float(self.t[-1]) if len(self.t) else 60.0)
        nb = next((b for b in (au.get("beds") or []) if b.get("source") == "noise"), None)
        self.noise_kind = nb.get("type") if nb else None
        self.noise_level = float(nb.get("level", 0.25)) if nb else 0.0
        self.master = MASTER * float(au.get("masterVolume", 1.0) or 1.0)
        self.fade = FADE_SECONDS.get(au.get("transitionFade", "medium"), 1.0)
        self.on_finish = None
        self._phaseL = self._phaseR = 0.0
        self._frame = 0
        self._noise = None
        self._noise_pos = 0
        self._stream = None
        self._sd = None

    def _at(self, tsec):
        return (float(np.interp(tsec, self.t, self.carr)),
                float(np.interp(tsec, self.t, self.beat)))

    def _fade_gain(self, tsec):
        if self.fade <= 0:
            return 1.0
        fin = tsec / self.fade
        fout = (self.duration - tsec) / self.fade
        return max(0.0, min(1.0, fin, fout))

    def _next_noise(self, n):
        buf = self._noise
        ln = len(buf)
        pos = self._noise_pos
        out = buf[pos:pos + n] if pos + n <= ln else np.concatenate([buf[pos:], buf[:(pos + n) % ln]])
        self._noise_pos = (pos + n) % ln
        return out

    def _callback(self, outdata, frames, time_info, status):
        t0 = self._frame / SR
        if t0 >= self.duration:
            outdata[:] = 0
            raise self._sd.CallbackStop
        c, b = self._at(t0)
        fL, fR = c, c + b
        idx = np.arange(frames)
        left = np.sin(self._phaseL + 2 * np.pi * fL * idx / SR)
        right = np.sin(self._phaseR + 2 * np.pi * fR * idx / SR)
        self._phaseL = float((self._phaseL + 2 * np.pi * fL * frames / SR) % (2 * np.pi))
        self._phaseR = float((self._phaseR + 2 * np.pi * fR * frames / SR) % (2 * np.pi))
        if self._noise is not None:
            ns = self.noise_level * self._next_noise(frames)
            left = left + ns
            right = right + ns
        out = self.master * self._fade_gain(t0) * np.column_stack([left, right])
        outdata[:] = np.clip(out, -1.0, 1.0).astype(np.float32)
        self._frame += frames

    def position(self):
        return self._frame / SR

    def start(self, at=0):
        import sounddevice as sd
        self._sd = sd
        if self.noise_kind:
            self._noise = _make_noise(self.noise_kind, SR * NOISE_SECONDS)
        self._frame = int(max(0, at) * SR)  # preview can begin at the playhead
        self._phaseL = self._phaseR = 0.0
        self._noise_pos = 0
        self._stream = sd.OutputStream(samplerate=SR, channels=2, dtype="float32",
                                       callback=self._callback, finished_callback=self._finished)
        self._stream.start()

    def _finished(self):
        if self.on_finish:
            self.on_finish()

    def stop(self):
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
