#!/usr/bin/env python3
"""
binaural_decompose.py
---------------------
Decompose a binaural-beat audio file (MP3/WAV/FLAC/...) into a compact JSON
"recipe": per-segment carrier frequency, beat frequency, and noise color.

It errs loudly (exit code 2) if the file isn't a plausible binaural track,
so you can gradually feed in a folder and let the incompatible ones bounce.

By default it emits the PulseEntrain ".imed" v2 model: a shared `entrainment.scenes`
timeline (beat / carrier keyframes), an `audio.beds` noise layer, and Nova/Pulsetto
blocks defaulted for the Studio to finish. Audio is all an MP3 can reveal, so the
glasses default to mirroring the beat (`nova.mode: "follow"`) and stim is left off.

Usage:
    python binaural_decompose.py input.mp3
    python binaural_decompose.py input.mp3 --out track.imed --name "deep-focus"
    python binaural_decompose.py input.mp3 --rdp 0.4 --quiet
    python binaural_decompose.py input.mp3 --schema v1   # legacy flat-segment output

Author: built for Chris (CodeMusic) — serializers are isolated in spec_to_dict_v2()
(default) and spec_to_dict_v1() (legacy), so the schema lives in one place.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone

import numpy as np
import librosa
from scipy.signal import stft, welch, medfilt


# ----------------------------------------------------------------------------- 
# Errors
# -----------------------------------------------------------------------------
class IncompatibleTrack(Exception):
    """Raised when a file is not a plausible binaural-beat track."""


# -----------------------------------------------------------------------------
# Tunables (sane defaults; expose the important ones on the CLI)
# -----------------------------------------------------------------------------
CARRIER_BAND = (30.0, 1200.0)     # Hz: where we expect carrier tones to live
BEAT_MAX     = 45.0               # Hz: |L-R| above this -> not a binaural beat
BEAT_MIN     = 0.2                # Hz: below this -> mono-ish / not binaural
N_FFT        = 16384              # long window -> fine freq resolution (~2.7 Hz @ 44.1k)
HOP          = 4096               # time resolution ~ 0.09 s @ 44.1k
PEAK_MIN_PROM_DB = 12.0           # carrier peak must stand this far above local floor


# -----------------------------------------------------------------------------
# Load
# -----------------------------------------------------------------------------
def load_stereo(path):
    """Return (sr, L, R). Raises IncompatibleTrack if not true stereo."""
    y, sr = librosa.load(path, sr=None, mono=False)
    y = np.atleast_2d(y)
    if y.shape[0] < 2:
        raise IncompatibleTrack("file is mono — binaural beats need two channels")
    L, R = y[0].astype(np.float64), y[1].astype(np.float64)
    # near-identical channels => no inter-aural difference => not binaural
    n = min(len(L), len(R))
    if n == 0:
        raise IncompatibleTrack("empty audio")
    corr = np.corrcoef(L[:n], R[:n])[0, 1]
    if corr > 0.9999:
        raise IncompatibleTrack(
            f"L and R are effectively identical (corr={corr:.5f}) — dual-mono, not binaural"
        )
    return sr, L, R


# -----------------------------------------------------------------------------
# Carrier contour per channel via STFT + parabolic peak interpolation
# -----------------------------------------------------------------------------
def carrier_contour(x, sr):
    """Return (times, freqs, prominence_db) — dominant in-band tone per frame."""
    f, t, Z = stft(x, fs=sr, nperseg=N_FFT, noverlap=N_FFT - HOP, padded=False)
    mag = np.abs(Z)
    band = (f >= CARRIER_BAND[0]) & (f <= CARRIER_BAND[1])
    fb = f[band]
    mb = mag[band, :]
    df = f[1] - f[0]

    freqs = np.full(t.shape, np.nan)
    proms = np.zeros(t.shape)
    log_mb = 20 * np.log10(mb + 1e-12)

    for j in range(mb.shape[1]):
        col = mb[:, j]
        k = int(np.argmax(col))
        # parabolic interpolation around the peak bin for sub-bin accuracy
        if 0 < k < len(col) - 1:
            a, b, c = log_mb[k - 1, j], log_mb[k, j], log_mb[k + 1, j]
            denom = (a - 2 * b + c)
            delta = 0.5 * (a - c) / denom if denom != 0 else 0.0
            delta = float(np.clip(delta, -0.5, 0.5))
        else:
            delta = 0.0
        freqs[j] = fb[k] + delta * df
        # prominence = peak height above local median floor
        floor = np.median(log_mb[:, j])
        proms[j] = log_mb[k, j] - floor

    return t, freqs, proms


def monophonic_gap_db(x, sr, n_frames=40):
    """Median dB gap between the top in-band peak and the strongest competing
    peak (>15 Hz away) per frame. Small gap => polyphonic (chord/music)."""
    f, t, Z = stft(x, fs=sr, nperseg=N_FFT, noverlap=N_FFT - HOP, padded=False)
    mag = np.abs(Z)
    band = (f >= CARRIER_BAND[0]) & (f <= CARRIER_BAND[1])
    fb, mb = f[band], mag[band, :]
    df = f[1] - f[0]
    guard = max(1, int(round(15.0 / df)))  # ignore bins within 15 Hz of the top
    cols = np.linspace(0, mb.shape[1] - 1, min(n_frames, mb.shape[1])).astype(int)
    gaps = []
    for j in cols:
        col = mb[:, j]
        k = int(np.argmax(col))
        comp = col.copy()
        comp[max(0, k - guard):k + guard + 1] = 0
        runner = comp.max()
        if runner > 0:
            gaps.append(20 * np.log10((col[k] + 1e-12) / (runner + 1e-12)))
    return float(np.median(gaps)) if gaps else 99.0


# -----------------------------------------------------------------------------
# Noise color: slope of the residual power spectrum (carriers masked out)
# -----------------------------------------------------------------------------
def estimate_noise(x, sr, carrier_hz):
    """Return (color, slope_db_per_decade, level_db). Fits PSD on log-log axes."""
    f, Pxx = welch(x, fs=sr, nperseg=8192)
    lo, hi = 40.0, min(8000.0, sr / 2 * 0.9)
    band = (f >= lo) & (f <= hi) & (f > 0)
    # notch out a region around each known carrier so tones don't bias the slope
    for c in carrier_hz:
        if c and not np.isnan(c):
            band &= np.abs(f - c) > max(8.0, 0.04 * c)
    ff, pp = f[band], Pxx[band]
    if len(ff) < 16:
        return "unknown", 0.0, float("nan")
    logf = np.log10(ff)
    logp = 10 * np.log10(pp + 1e-20)
    slope, intercept = np.polyfit(logf, logp, 1)  # dB per decade
    color = classify_color(slope)
    level_db = float(np.median(logp))
    return color, float(slope), level_db


def classify_color(slope_db_per_decade):
    """Map spectral slope (dB/decade) to a noise color name."""
    s = slope_db_per_decade
    # white 0, pink -10, brown -20, blue +10, violet +20 (dB/decade)
    table = [("violet", 20), ("blue", 10), ("white", 0),
             ("pink", -10), ("brown", -20)]
    return min(table, key=lambda kv: abs(s - kv[1]))[0]


# -----------------------------------------------------------------------------
# Segment the timeline with Ramer–Douglas–Peucker on the beat & carrier curves
# -----------------------------------------------------------------------------
def _rdp(points, eps):
    """Ramer–Douglas–Peucker. points: Nx2 array. Returns kept indices."""
    if len(points) < 3:
        return [0, len(points) - 1]
    start, end = points[0], points[-1]
    line = end - start
    L = np.hypot(*line)
    if L == 0:
        d = np.hypot(*(points - start).T)
    else:
        rel = points - start
        cross = line[0] * rel[:, 1] - line[1] * rel[:, 0]  # explicit 2D cross
        d = np.abs(cross) / L
    idx = int(np.argmax(d))
    if d[idx] > eps:
        left = _rdp(points[:idx + 1], eps)
        right = _rdp(points[idx:], eps)
        return left[:-1] + [i + idx for i in right]
    return [0, len(points) - 1]


def segment_track(t, beat, carrier, beat_eps):
    """Break the timeline where beat/carrier bend. Returns list of segment dicts."""
    beat_s = medfilt(np.nan_to_num(beat, nan=np.nanmedian(beat)), 5)
    car_s = medfilt(np.nan_to_num(carrier, nan=np.nanmedian(carrier)), 5)

    pts = np.column_stack([t, beat_s])
    keep = sorted(set(_rdp(pts, beat_eps)))

    segs = []
    for a, b in zip(keep[:-1], keep[1:]):
        seg = dict(
            t_start=float(t[a]), t_end=float(t[b]),
            beat_start=round(float(beat_s[a]), 2), beat_end=round(float(beat_s[b]), 2),
            carrier_start=round(float(car_s[a]), 2), carrier_end=round(float(car_s[b]), 2),
        )
        segs.append(seg)
    return segs


# -----------------------------------------------------------------------------
# Orchestration
# -----------------------------------------------------------------------------
def analyze(path, name=None, beat_eps=0.4):
    sr, L, R = load_stereo(path)
    dur = len(L) / sr

    tL, fL, pL = carrier_contour(L, sr)
    tR, fR, pR = carrier_contour(R, sr)

    # align (same params -> same frame count, but guard anyway)
    n = min(len(tL), len(tR))
    t = tL[:n]
    fL, fR = fL[:n], fR[:n]
    prom = np.minimum(pL[:n], pR[:n])

    # confidence: fraction of frames where BOTH channels show a clear tone
    tonal = prom >= PEAK_MIN_PROM_DB
    confidence = float(np.mean(tonal))
    if confidence < 0.15:
        raise IncompatibleTrack(
            f"no stable carrier tone found (only {confidence:.0%} of frames are tonal) "
            "— probably music/ambience, not a pure binaural track"
        )

    beat = np.abs(fL - fR)
    carrier = (fL + fR) / 2.0

    # polyphonic guard: each channel must be dominated by ONE clean tone.
    POLY_MIN_GAP_DB = 9.0
    gapL = monophonic_gap_db(L, sr)
    gapR = monophonic_gap_db(R, sr)
    if min(gapL, gapR) < POLY_MIN_GAP_DB:
        raise IncompatibleTrack(
            f"channel(s) carry multiple strong tones (peak/runner-up gap "
            f"{min(gapL, gapR):.1f} dB < {POLY_MIN_GAP_DB} dB) — chord/music/layered "
            "ambience, not a clean binaural carrier pair"
        )

    med_beat = float(np.nanmedian(beat[tonal]))
    if med_beat > BEAT_MAX:
        raise IncompatibleTrack(
            f"median inter-aural difference {med_beat:.1f} Hz exceeds {BEAT_MAX} Hz "
            "— channels differ, but not like a binaural beat"
        )
    if med_beat < BEAT_MIN:
        raise IncompatibleTrack(
            f"inter-aural difference ~{med_beat:.2f} Hz is below {BEAT_MIN} Hz — no real beat"
        )

    warnings = []
    # crude joint-stereo / smear sniff: lots of frames where one side loses its tone
    one_sided = np.mean((pL[:n] >= PEAK_MIN_PROM_DB) ^ (pR[:n] >= PEAK_MIN_PROM_DB))
    if one_sided > 0.2:
        warnings.append("intermittent single-channel tone — possible joint-stereo smear; "
                        "beat values may wobble ~0.5 Hz")

    segs = segment_track(t, beat, carrier, beat_eps)

    # noise color per segment + globally
    g_color, g_slope, g_level = estimate_noise(np.concatenate([L, R]), sr, [float(np.nanmedian(carrier))])
    for s in segs:
        i0 = int(s["t_start"] * sr)
        i1 = min(int(s["t_end"] * sr), len(L))
        if i1 - i0 > sr:  # at least 1s
            c, slope, lvl = estimate_noise(L[i0:i1], sr,
                                           [s["carrier_start"], s["carrier_end"]])
        else:
            c, slope, lvl = g_color, g_slope, g_level
        s["noise_color"] = c
        s["noise_slope_db_per_decade"] = round(slope, 1)
        s["noise_level_db"] = round(lvl, 1)

    return dict(
        name=name or _stem(path),
        source=path,
        rate=int(sr),
        duration_s=round(dur, 2),
        confidence=round(confidence, 3),
        warnings=warnings,
        global_noise=dict(color=g_color,
                          slope_db_per_decade=round(g_slope, 1),
                          level_db=round(g_level, 1)),
        segments=segs,
    )


def _stem(path):
    base = path.replace("\\", "/").split("/")[-1]
    return base.rsplit(".", 1)[0]


# -----------------------------------------------------------------------------
# Serializers — the schema lives here. v2 (default) emits the PulseEntrain
# ".imed" model; v1 is the original flat-segment output, kept for compatibility.
# -----------------------------------------------------------------------------
def _slug(name):
    s = re.sub(r"[^a-zA-Z0-9]+", "_", str(name).strip().lower()).strip("_")
    return s or "session"


def _noise_level_from_db(level_db):
    """Rough 0..1 mix level from a measured median-PSD dB value. Absolute PSD dB
    is NOT a fader value, so this is a heuristic placeholder the Studio/author is
    expected to refine; the raw dB is preserved on the bed under `_measured`."""
    if level_db is None or (isinstance(level_db, float) and np.isnan(level_db)):
        return 0.2
    lo, hi = -80.0, -30.0  # plausible band -> 0.05..0.60
    frac = (float(level_db) - lo) / (hi - lo)
    return round(float(np.clip(frac, 0.0, 1.0)) * 0.55 + 0.05, 3)


# Carrier is a first-class scene axis (peer to beatHz): a track MAY sweep it,
# though traditionally it's fixed. We express it per-scene only when it actually
# moves more than this; otherwise the single `audio.binaural.carrierHz` base
# applies and scenes omit it (resolution: scene.carrierHz ?? binaural.carrierHz).
CARRIER_SWEEP_HZ = 5.0


def spec_to_dict_v2(spec):
    """Emit the PulseEntrain .imed v2 model. Populates every field the audio
    analysis can actually measure (scenes / beat / carrier / noise); leaves the
    modalities an MP3 can't observe (Nova custom patterns, Pulsetto intensity) at
    safe defaults for the Studio or n8n to complete."""
    segs = spec["segments"]

    # Carrier: median is the nominal base tone; surface it per-scene only if it sweeps.
    carriers = [c for s in segs for c in (s["carrier_start"], s["carrier_end"])
                if c and not np.isnan(c)]
    carrier_med = round(float(np.median(carriers)), 2) if carriers else None
    carrier_sweeps = bool(carriers) and (max(carriers) - min(carriers) > CARRIER_SWEEP_HZ)

    # Scenes = ordered keyframes reconstructed from the segment breakpoints. Each
    # boundary becomes one keyframe; the engine interpolates (entrainment.ramp).
    def scene(at, beat, carrier):
        sc = {"atSec": round(float(at), 2), "beatHz": round(float(beat), 2)}
        if carrier_sweeps and carrier and not np.isnan(carrier):
            sc["carrierHz"] = round(float(carrier), 2)
        return sc

    scenes = []
    if segs:
        scenes.append(scene(segs[0]["t_start"], segs[0]["beat_start"], segs[0]["carrier_start"]))
        for s in segs:
            scenes.append(scene(s["t_end"], s["beat_end"], s["carrier_end"]))

    beats = [sc["beatHz"] for sc in scenes] or [0.0]
    gn = spec["global_noise"]
    name = spec["name"]

    return {
        "formatVersion": 2,
        "id": _slug(name),
        "meta": {
            "name": name,
            "description": (
                f"Decomposed from audio: {len(scenes)} scene(s), "
                f"beat {min(beats):.2f}-{max(beats):.2f} Hz"
                + (f", carrier ~{carrier_med:.0f} Hz." if carrier_med else ".")
            ),
            "category": None,     # not derivable from audio
            "strength": None,     # author/n8n decides (1-7)
            "durationSec": round(spec["duration_s"]),
            "image": None,        # local image-gen fills this
            "rating": None,
            "playCount": 0,
        },
        "generation": {
            "source": "binaural_decompose",
            "tool": "binaural_decompose.py",
            "input": spec["source"],
            "analyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "confidence": spec["confidence"],
            "warnings": spec["warnings"],
        },
        "entrainment": {
            "ramp": "linear",
            "scenes": scenes,     # shared spine: audio + Nova read beatHz, Pulsetto reads intensity
        },
        "audio": {
            "binaural": {"carrierHz": carrier_med, "follow": "beat"},
            "beds": [
                {
                    "source": "noise",          # white|pink|brown|blue|violet|grey
                    "type": gn["color"],
                    "level": _noise_level_from_db(gn["level_db"]),
                    "_measured": {
                        "slopeDbPerDecade": gn["slope_db_per_decade"],
                        "levelDb": gn["level_db"],
                    },
                }
                # texture beds (rain|wind) and a custom-file bed are authored in the
                # Studio; a file bed is deferred until streaming replaces bundled MP3s.
            ],
            "masterVolume": 1.0,
            "transitionFade": "medium",
        },
        # Audio-only source can't observe the glasses -> mirror the beat (the base option).
        "nova": {"mode": "follow", "maxHz": 60, "brightness": 1.0},
        # No stim information in an MP3 -> disabled; author intensity per scene later.
        "pulsetto": {"enabled": False, "follow": "scenes", "intensityClamp": [1, 9]},
    }


def spec_to_dict_v1(spec):
    """Legacy flat-segment output (the original schema). Edit field names here."""
    def ramp(a, b):
        return {"start": a, "end": b} if a != b else a
    out = {
        "name": spec["name"],
        "source": spec["source"],
        "rate": spec["rate"],
        "duration_s": spec["duration_s"],
        "confidence": spec["confidence"],
        "warnings": spec["warnings"],
        "global_noise": spec["global_noise"],
        "segments": [],
    }
    for s in spec["segments"]:
        out["segments"].append({
            "t_start": s["t_start"],
            "t_end": s["t_end"],
            "carrier_hz": ramp(s["carrier_start"], s["carrier_end"]),
            "beat_hz": ramp(s["beat_start"], s["beat_end"]),
            "noise": {"color": s["noise_color"], "level_db": s["noise_level_db"]},
        })
    return out


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Decompose a binaural-beat file into JSON.")
    ap.add_argument("input")
    ap.add_argument("--out", help="write JSON here (default: stdout)")
    ap.add_argument("--name", help="track name (default: filename stem)")
    ap.add_argument("--rdp", type=float, default=0.4,
                    help="beat segmentation sensitivity in Hz (smaller = more segments)")
    ap.add_argument("--schema", choices=["v2", "v1"], default="v2",
                    help="output schema: v2 = PulseEntrain .imed model (default), "
                         "v1 = legacy flat segments")
    ap.add_argument("--quiet", action="store_true", help="suppress the summary on stderr")
    args = ap.parse_args(argv)

    try:
        spec = analyze(args.input, name=args.name, beat_eps=args.rdp)
    except IncompatibleTrack as e:
        print(f"INCOMPATIBLE: {args.input}: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # decode failures, etc.
        print(f"ERROR: {args.input}: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    serializer = spec_to_dict_v2 if args.schema == "v2" else spec_to_dict_v1
    payload = serializer(spec)
    text = json.dumps(payload, indent=2)
    if args.out:
        with open(args.out, "w") as fh:
            fh.write(text)
    else:
        print(text)

    if not args.quiet:
        print(f"[ok] {args.input}: {len(spec['segments'])} segment(s) -> {args.schema}, "
              f"confidence={spec['confidence']:.0%}, noise={spec['global_noise']['color']}",
              file=sys.stderr)
        for w in spec["warnings"]:
            print(f"[warn] {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
