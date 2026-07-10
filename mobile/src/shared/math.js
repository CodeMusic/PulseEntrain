// Generic numeric + color helpers, centralised so the screens stop each keeping
// their own copy (clamp/exClamp, dz/exDz, reflect, mapRange, lerp, color …). One
// definition = no silent drift. Domain-specific clamps (clampStrobe, clampLevel)
// stay in their protocol modules; BeatChart's timeline `lerp` is a different HOF
// and stays local.

// Constrain v to [a, b].
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Constrain to [0, 1].
export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// Deadzone: |d| <= z → 0; outside, subtract the zone so it starts from 0 at the edge.
export const deadzone = (d, z) => (Math.abs(d) <= z ? 0 : d - Math.sign(d) * z);

// Map v from [inA, inB] onto [outA, outB].
export const mapRange = (v, inA, inB, outA, outB) =>
  outA + ((v - inA) / ((inB - inA) || 1)) * (outB - outA);

// Fold v into [lo, hi] by reflecting at the edges (triangle wave), so a range
// repeats smoothly instead of clamping — cross a boundary and glide back.
export const reflect = (v, lo, hi) => {
  const span = hi - lo;
  if (span <= 0) return lo;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return t <= span ? lo + t : lo + (2 * span - t);
};

// Linear interpolate between two numbers.
export const lerp = (a, b, t) => a + (b - a) * t;

// Blend two [r, g, b] triples channel-wise.
export const lerpColor = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// [r, g, b] → 'rgb(r,g,b)'.
export const rgbColor = c => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

// Rate-limit fn to once per `ms`, tracking the last-fire time in a ref (ref.current).
export const throttleRef = (ref, ms, fn) => {
  const now = Date.now();
  if (now - ref.current > ms) { ref.current = now; fn(); }
};
