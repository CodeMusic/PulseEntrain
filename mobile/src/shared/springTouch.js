// springTouch — the "warp, then let go" feel shared by Field and programs.
//
// When a pull is released we don't snap the value home; we hand it to an
// underdamped spring that eases it back to the target, overshoots a little, and
// settles over a few decaying bounces — the natural springiness you feel in a
// physical control. The spring runs a NORMALISED value from 1 → 0, so a caller
// scales its own displacement by it (`live = target + start * s`). That keeps
// every warped dimension — carrier, binaural beat, and the bi-ocular balance
// (per-eye rate split from a head roll) — locked in the same phase, and makes the
// *absolute* overshoot grow with the size of the pull (a big pull overshoots more
// than a small one), exactly as asked.
//
//   springRate — angular frequency ω (rad/s). Higher = snappier return + quicker
//                bounces. ~10–16 feels lively without being twitchy.
//   bounce     — how much it overshoots. 0 = none (critically damped), ~0.5 gives
//                a gentle ~15% overshoot, higher = bouncier.
//
// Returns a cancel() — call it when a new pull grabs the control mid-spring.
export const SPRING_RATE = 13; // default ω for released bends
export const SPRING_BOUNCE = 0.5; // default overshoot (~15%)
export const PRESS_VOL_BOOST = 0.15; // press (Z) lifts volume by up to this, on top of the base

export function springTouch({ springRate = SPRING_RATE, bounce = SPRING_BOUNCE, onUpdate = _s => {}, onRest = () => {} } = {}) {
  const omega = Math.max(1, springRate);
  // bounce → damping ratio ζ (1 = no overshoot, →0 = very bouncy).
  const zeta = Math.min(1, Math.max(0.05, 1 - Math.min(0.95, Math.max(0, bounce))));
  const dt = 1 / 60; // fixed step — stable regardless of frame jitter
  let s = 1;
  let v = 0;
  let raf = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    // Two half-steps of semi-implicit Euler for stability at stiff settings.
    for (let i = 0; i < 2; i++) {
      const a = -omega * omega * s - 2 * zeta * omega * v;
      v += a * (dt / 2);
      s += v * (dt / 2);
    }
    if (onUpdate) onUpdate(s);
    if (Math.abs(s) < 0.002 && Math.abs(v) < 0.02) {
      stopped = true;
      if (onUpdate) onUpdate(0); // land exactly on target
      if (onRest) onRest();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
  };
}
