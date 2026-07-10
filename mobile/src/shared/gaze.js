// Head "gaze" control — the single source of truth for turning Nova pitch/roll
// into audio bends + per-eye light behaviour. Field mode and Explore-Field programs
// used to keep byte-for-byte identical math behind parallel FIELD_* / EX_* constants,
// so a tweak (e.g. the roll-sign fix) had to be made in two places and drifted.
// Now both call mapGaze() with these constants.
import { clamp, deadzone } from './math';

export const GAZE = {
  pitch: {
    deadzone: 4, // degrees of stillness before the beat bends
    span: 20, // degrees from center for a full bend
    sign: -1, // pitch reads inverted on the Nova
    beatBend: 3.5, // Hz added to the beat at full pitch
    carrBend: 12, // Hz added to the carrier at full pitch
  },
  roll: {
    deadzone: 2, // ±this stays balanced (both eyes equal)
    max: 20, // by ±this one eye has eased to the rate floor
    sign: -1, // roll slows the OPPOSITE eye (lean left → right eye slows)
  },
  // Past ±these (degrees from center) the eyes change relationship (see the Nova
  // controller): pitch → out-of-phase, roll → the slowed eye hops sides.
  threshold: { pitch: 20, roll: 20 },
  smoothingAlpha: 0.18, // EMA low-pass on raw head samples (smaller = smoother)
};

// Raw pitch/roll deltas (smoothedHead − center, before sign) → the gaze outputs.
//   beatBend / carrBend — ± offsets to add on top of the finger/authored values
//   balance             — −1…0…+1 per-eye light bias
//   alternate / swap     — the eye-pattern flags for nova.setGazePattern
export function mapGaze(pitchRaw, rollRaw, cfg = GAZE) {
  const pitch = pitchRaw * cfg.pitch.sign;
  const roll = rollRaw * cfg.roll.sign;
  const p = clamp(deadzone(pitch, cfg.pitch.deadzone), -cfg.pitch.span, cfg.pitch.span) / cfg.pitch.span;
  const balance = clamp(deadzone(roll, cfg.roll.deadzone) / (cfg.roll.max - cfg.roll.deadzone), -1, 1);
  return {
    beatBend: p * cfg.pitch.beatBend,
    carrBend: p * cfg.pitch.carrBend,
    balance,
    // |x*sign| == |x|, so thresholds read the raw magnitude.
    alternate: Math.abs(pitchRaw) > cfg.threshold.pitch,
    swap: Math.abs(rollRaw) > cfg.threshold.roll,
  };
}
