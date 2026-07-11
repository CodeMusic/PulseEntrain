import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { clamp01, lerpColor as mix, rgbColor as rgb } from '../shared/math';

// Full-screen on-phone stand-in for the ROLI Lightpad: a 15×15 "screen door" of
// squares tinted along the top-left→bottom-right diagonal from purple to a bluish
// indigo. Your finger lights the cells under and around it blue (brighter with
// pressure), the rest of the grid dims while you hold, and a dragged trail leaves
// a blue residue that fades. On release the dimming and the residue ease back.
//
// It reports the same gesture the block does — normalised x/y and pressure — via
// onChange({ phase, xN, yN, pressure }); the screens map that to the carrier/beat/
// volume bend. phase is 'start' | 'move' | 'end' (release after a bend → springs) |
// 'tap' (release with ~no travel → the screen rings a small bend). Releasing a bend
// and tapping both also cast a water ripple across the grid (see the loop). Force
// falls back to a medium value on phones without 3D-Touch so pressure still reads.
const N = 15;
const PURPLE = [124, 58, 237]; // #7C3AED — top-left
const INDIGO = [63, 81, 181]; // bluish-indigo — bottom-right
const BLUE = [90, 170, 255]; // touch highlight
const TOUCH_RADIUS = 2.5; // cells lit around the finger
const DECAY = 0.9; // residue fade per frame (~0.4 s tail)
const DIM = 0.62; // how far the untouched grid darkens while held (slightly)
// Pressure proxy for phones with no 3D-Touch (force === 0). RN doesn't expose the
// touch radius, so we use DWELL: holding still builds pressure toward full; a fast
// drag bleeds it off, so a light glide stays soft. Real force wins when present.
const DWELL_MIN = 0.32; // pressure the instant you land
const DWELL_TAU = 42; // frames to build most of the way (~0.7 s at 60fps)
const DWELL_MOVE_BLEED = 55; // how much a drag (normalised distance) softens the dwell
// Water ripples: a tap sends one clean expanding ring; releasing a bend sends a
// bigger, ringed wave that echoes the audio spring-back. They lay a lighter tint on
// top of the base + touch and keep propagating after the finger lifts.
const RIPPLE_COLOR = [190, 220, 255]; // pale blue — lighter than the direct-touch BLUE
const RIPPLE_SPEED = 0.16; // cells/frame the wavefront expands
const RIPPLE_WIDTH = 1.25; // wavefront thickness (cells)
const RIPPLE_K = 1.5; // ring oscillation of a spring wave (0 = one clean ring)
const TAP_LIFE = 72, SPRING_LIFE = 104; // frames a ripple lives
const TAP_AMP = 0.6; // tap-ring strength
const TAP_MOVE = 0.05; // normalised travel beyond which a release is a bend, not a tap


export default function TouchPad({ visible, onClose, onChange }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  // rawForce: real 3D-Touch force (0 if none). dwell: frames held, feeding the proxy.
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const dimRef = useRef(1); // 1 = normal, →DIM while a finger is down
  const ripplesRef = useRef<any[]>([]); // active water rings { cx, cy, age, life, amp, k }
  const rippleFieldRef = useRef(new Float32Array(N * N)); // per-cell ripple brightness, rebuilt each frame
  const startRef = useRef<null | { cx: number; cy: number; xN: number; yN: number }>(null); // touch-down point
  const movedRef = useRef(false); // did this touch travel far enough to count as a bend?
  const [, forceRender] = useState(0);
  const rafRef = useRef<any>(null);

  const pressureOf = t => {
    if (t.rawForce > 0) return t.rawForce; // real pressure wins
    return DWELL_MIN + (1 - DWELL_MIN) * (1 - Math.exp(-t.dwell / DWELL_TAU));
  };

  // Animation loop: build dwell pressure, emit it, paint heat, decay residue, ease dim.
  useEffect(() => {
    if (!visible) {
      heatRef.current.fill(0);
      touchRef.current = null;
      dimRef.current = 1;
      ripplesRef.current = [];
      rippleFieldRef.current.fill(0);
      startRef.current = null;
      movedRef.current = false;
      return;
    }
    let alive = true;
    let frame = 0;
    const loop = () => {
      if (!alive) return;
      const heat = heatRef.current;
      const t = touchRef.current;
      if (t) {
        t.dwell += 1; // holding still builds pressure toward full
        t.eff = pressureOf(t);
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const d = Math.hypot(c - t.cx, r - t.cy);
            if (d <= TOUCH_RADIUS) {
              const v = t.eff * (1 - d / TOUCH_RADIUS);
              const i = r * N + c;
              if (v > heat[i]) heat[i] = v;
            }
          }
        }
      }
      for (let i = 0; i < heat.length; i++) heat[i] *= DECAY;
      // Ripples: expanding water rings (taps + spring-backs) fading as they spread.
      const ripples = ripplesRef.current;
      const field = rippleFieldRef.current;
      field.fill(0);
      const band = RIPPLE_WIDTH * 2.5;
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        const rp = ripples[ri];
        rp.age += 1;
        if (rp.age >= rp.life) { ripples.splice(ri, 1); continue; }
        const radius = RIPPLE_SPEED * rp.age;
        const fade = 1 - rp.age / rp.life;
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const dr = Math.hypot(c - rp.cx, r - rp.cy) - radius;
            if (dr < -band || dr > band) continue;
            const env = Math.exp(-(dr * dr) / (2 * RIPPLE_WIDTH * RIPPLE_WIDTH));
            const ring = rp.k > 0 ? 0.5 + 0.5 * Math.cos(rp.k * dr) : 1;
            field[r * N + c] += rp.amp * fade * fade * env * ring;
          }
        }
      }
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      if (Math.abs(dimRef.current - dimTarget) < 0.004) dimRef.current = dimTarget;
      frame++;
      // ~30fps: emit the live touch (dwell pressure swells even when still) + repaint.
      // Skip when fully idle (no touch, no ripples, dim settled) to save renders.
      const active = !!t || ripples.length > 0 || dimRef.current < 0.995;
      if (active && frame % 2 === 0) {
        if (t) onChange && onChange({ phase: 'move', xN: t.xN, yN: t.yN, pressure: t.eff });
        forceRender(n => n + 1);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [visible]);

  const spawnRipple = (cx, cy, life, amp, k) => {
    const rs = ripplesRef.current;
    if (rs.length > 16) rs.shift(); // cap
    rs.push({ cx, cy, age: 0, life, amp, k });
  };

  const handle = (e, phase) => {
    if (phase === 'end') {
      const t = touchRef.current, start = startRef.current;
      const o = t || start; // release origin (cell coords)
      if (start && o) {
        if (movedRef.current) {
          // Released a bend → a bigger ringed wave, sized by how far you pulled, that
          // echoes the audio spring-back. onChange('end') springs the sound.
          const dist = t ? Math.hypot(t.xN - start.xN, t.yN - start.yN) : 0;
          spawnRipple(o.cx, o.cy, SPRING_LIFE, Math.min(1.3, 0.35 + dist * 1.7), RIPPLE_K);
          onChange && onChange({ phase: 'end' });
        } else {
          // A tap → one clean ring + a 'tap' so the screen can ring the sound.
          spawnRipple(o.cx, o.cy, TAP_LIFE, TAP_AMP, 0);
          onChange && onChange({ phase: 'tap', xN: start.xN, yN: start.yN });
        }
      } else {
        onChange && onChange({ phase: 'end' });
      }
      touchRef.current = null; startRef.current = null; movedRef.current = false;
      return;
    }
    const n = e.nativeEvent;
    const lx = clamp01(n.locationX / size) * size;
    const ly = clamp01(n.locationY / size) * size;
    const xN = lx / size, yN = ly / size;
    const rawForce = n.force && n.force > 0 ? Math.min(1, n.force) : 0;
    const prev = touchRef.current;
    // A drag bleeds dwell off (light glide stays soft); a still hold keeps building.
    let dwell = prev ? prev.dwell : 0;
    if (prev) dwell = Math.max(0, dwell - Math.hypot(xN - prev.xN, yN - prev.yN) * DWELL_MOVE_BLEED);
    const t = { cx: lx / cell - 0.5, cy: ly / cell - 0.5, xN, yN, rawForce, dwell, eff: 0 };
    t.eff = pressureOf(t);
    touchRef.current = t;
    if (phase === 'start') {
      startRef.current = { cx: t.cx, cy: t.cy, xN, yN };
      movedRef.current = false;
      onChange && onChange({ phase: 'start', xN, yN, pressure: t.eff }); // seed the anchor; 'move' is loop-driven
    } else if (startRef.current && Math.hypot(xN - startRef.current.xN, yN - startRef.current.yN) > TAP_MOVE) {
      movedRef.current = true;
    }
  };

  const heat = heatRef.current;
  const field = rippleFieldRef.current;
  const dim = dimRef.current;
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const diag = (r + c) / (2 * (N - 1));
      const base = mix(PURPLE, INDIGO, diag).map(v => v * dim);
      let col = mix(base, BLUE, Math.min(1, heat[i]));
      const rip = clamp01(field[i]);
      if (rip > 0.01) col = mix(col, RIPPLE_COLOR, rip * 0.7); // lighter echoic residue
      cells.push(
        <View
          key={i}
          style={{ position: 'absolute', left: c * cell, top: r * cell, width: cell - 1, height: cell - 1, borderRadius: 2, backgroundColor: rgb(col) }}
        />,
      );
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.grid, { width: size, height: size }]}
          pointerEvents="box-only" // the grid is the touch target, not the cells → locationX/Y stays grid-relative
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={e => handle(e, 'start')}
          onResponderMove={e => handle(e, 'move')}
          onResponderRelease={e => handle(e, 'end')}
          onResponderTerminate={e => handle(e, 'end')}
        >
          {cells}
        </View>
        <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={16} activeOpacity={0.7}>
          <Text style={styles.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#05070C', alignItems: 'center', justifyContent: 'center' },
  grid: { position: 'relative' },
  close: {
    position: 'absolute', top: 44, left: 20, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)',
  },
  closeTxt: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 },
});
