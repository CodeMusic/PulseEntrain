// Binaural synth COEFFICIENTS + noise generators — pure, platform-agnostic.
// These are the numbers the audio render must agree on across runtimes (browser
// Web Audio, native react-native-audio-api, and the desktop Python preview, which
// mirrors the same constants in engine/synth.py). Single-sourcing them here keeps
// every synth in lockstep — change a coefficient once, every player follows.

export const NOISE_SECONDS = 3; // noise loop buffer length; longer = less obvious looping

// Noise bed loudness — the easy knob if it sits too loud/quiet under the beat.
// Absolute gain on a 0–1 scale: 1.0 ≈ as loud as the tones, so this is the
// fraction of "full". 0.1 = noise at 10% of full (turned down 90%).
export const NOISE_LEVEL = 0.1;

// Start/end transition fade lengths (seconds), keyed by the .imedx fade label.
export const FADE_SECONDS = { none: 0, short: 1.0, medium: 2.0, long: 3.0 };

// ---- noise generators (fill a Float32Array in place; identical to engine/synth.py) ----
export function fillWhite(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}
export function fillPink(data) {
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
export function fillBrown(data) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    data[i] = last * 3.5;
  }
}
export const NOISE_FILL = { white: fillWhite, pink: fillPink, brown: fillBrown };
