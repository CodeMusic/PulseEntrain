// Entrainment helpers — pure, platform-agnostic. The brainwave band for a beat
// frequency, and the carrier→colour scale (low = red … high = purple) used by the
// graph, the peek, and the player subtitle. Single-sourced so the colour/band
// mapping is identical everywhere (and matches the desktop graph's carrier_color).

// Brainwave band for an entrainment (beat) frequency, in Hz.
export const bandFor = b =>
  b < 0.5 ? 'Epsilon' : b < 4 ? 'Delta' : b < 8 ? 'Theta' : b < 13 ? 'Alpha' : b < 30 ? 'Beta' : 'Gamma';

// HSV → [r,g,b] 0..255 (h,s,v in 0..1).
export function hsvRGB(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// HSV → 'rgb(r,g,b)' string.
export function hsv(h, s, v) {
  const [r, g, b] = hsvRGB(h, s, v);
  return `rgb(${r},${g},${b})`;
}

const carrierHue = c => Math.max(0, Math.min(1, (c - 70) / 430)) * 0.8;
// Carrier frequency (Hz) → colour. 70–500 Hz maps low=red … high=purple.
export const carrierColor = c => hsv(carrierHue(c), 0.72, 0.95);
// Same scale as [r,g,b] (for blending — e.g. the touch pad's ripple fill).
export const carrierRGB = c => hsvRGB(carrierHue(c), 0.72, 0.95);
// Deeper, more saturated variant for filled surfaces (e.g. the player header) so
// it reads as vibrant and keeps white text legible.
export const carrierColorVibrant = c => hsv(Math.max(0, Math.min(1, (c - 70) / 430)) * 0.8, 0.85, 0.72);
