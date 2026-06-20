// Lumenate Nova strobe PROTOCOL — pure, platform-agnostic (no BLE, no RN APIs).
// Turns strobe parameters into the device's wire frames. Shared by the mobile
// RN transport (novaController) today, and reusable by a desktop/Electron
// transport later — the protocol lives here once; only the BLE write differs.
import { Buffer } from 'buffer';

// ⚠️ SAFETY (protocol §6): the device enforces NO frequency limit. We cap the
// strobe at 60 Hz so it can traverse delta→gamma the way the Lumenate app does
// (it modulates from ~3 Hz up into the gamma range). NOTE this span now includes
// the 15–25 Hz band where stroboscopic light most readily provokes photosensitive
// seizures — see the photosensitivity warnings. Not for users with epilepsy.
export const MAX_NOVA_STROBE_HZ = 60;
export const MIN_NOVA_STROBE_HZ = 0.5;
export const clampStrobe = hz => {
  const v = Number(hz);
  if (!Number.isFinite(v)) return MIN_NOVA_STROBE_HZ;
  return Math.min(MAX_NOVA_STROBE_HZ, Math.max(MIN_NOVA_STROBE_HZ, v));
};

// ── Strobe encoder — faithful port of the app's C4500z0.w0 / La.m.{a,b} ──
// Independent 10×uint32 (40B), little-endian, per eye:
//   [ period, on, period', on', level ]   (left block, then right block)
//   La.m.b(seconds) = round(seconds·1e6) clamped uint32   → period/on (µs)
//   La.m.a(level)   = round(level·1e6)   clamped uint32   → brightness ×1e6
//   on = duty·period ; period' = phase-adjusted period (= period when phase 0)
const U32_MAX = 0xffffffff;
const bSec = s =>
  !Number.isFinite(s) || s <= 0 ? 0 : Math.min(U32_MAX, Math.max(0, Math.round(s * 1e6)));
const aLvl = l => (!Number.isFinite(l) ? 0 : Math.min(U32_MAX, Math.max(0, Math.round(l * 1e6))));

function packLE(values) {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeUInt32LE(v >>> 0, i * 4));
  return buf;
}

// One eye → 5 ints. Frequency clamped for safety; phaseHz shifts the primed pair
// (drives the eye's 2nd LED).
export function eyeInts(freqHz, duty, level, phaseHz) {
  const f = clampStrobe(freqHz);
  const period = 1 / f; // seconds
  const periodP = phaseHz && f - phaseHz > 0 ? 1 / (f - phaseHz) : period;
  return [bSec(period), bSec(period * duty), bSec(periodP), bSec(periodP * duty), aLvl(level)];
}

// Full 8-param SyncedValues → 40-byte frame (+ hex for logging).
export function buildFrame(v) {
  const ints = [
    ...eyeInts(v.lFreq, v.lDuty, v.lLevel, v.lPhase),
    ...eyeInts(v.rFreq, v.rDuty, v.rLevel, v.rPhase),
  ];
  const buf = packLE(ints);
  return { b64: buf.toString('base64'), hex: buf.toString('hex') };
}

// All-dark frame (on-time 0, level 0) — used to clear the LEDs on stop.
export function offFrame() {
  return buildFrame({ lFreq: 8, rFreq: 8, lDuty: 0, rDuty: 0, lLevel: 0, rLevel: 0, lPhase: 0, rPhase: 0 }).b64;
}

export const DEFAULT_VALUES = beatHz => ({
  lFreq: beatHz,
  rFreq: beatHz,
  lDuty: 0.5,
  rDuty: 0.5,
  lLevel: 1,
  rLevel: 1,
  lPhase: 0,
  rPhase: 0,
});
