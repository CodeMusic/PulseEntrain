import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { clamp01, lerpColor as mix, rgbColor as rgb } from '../shared/math';
import { carrierRGB } from '../shared/entrainment';

// Full-screen on-phone stand-in for the ROLI Lightpad: a screen door of squares that
// starts as a purple→indigo diagonal. Your finger lights the cells under it blue
// (brighter with pressure) and the rest dims while you hold.
//
// It reports the same gesture the block does via onChange({ phase, xN, yN, pressure }):
// phase is 'start' | 'move' | 'end' (release after a bend) | 'tap' (release with ~no
// travel → the screen rings a small bend). Force falls back to a medium value on
// phones without 3D-Touch so pressure still reads.
//
// Ripples reflect real values. On a tap or a bend-release a wave expands from the
// touch point at a speed equal to the BINAURAL BEAT (cells per second — 10 Hz = 10
// cells/s), and behind its front the grid settles into the CARRIER's colour (the same
// carrier→colour map used elsewhere). So a fast beat ripples quickly, a slow beat
// crawls, and the grid ends up the colour of the carrier you pulled to. `getValues`
// supplies the live { beat, carrier } at the moment the ripple is cast.
const N = 20; // grid resolution — bump for smoother waves (watch perf: N*N Views repaint ~30fps)
const PURPLE = [124, 58, 237]; // #7C3AED — resting top-left
const INDIGO = [63, 81, 181]; // bluish-indigo — resting bottom-right
const BLUE = [90, 170, 255]; // touch highlight
const FRONT_COLOR = [225, 238, 255]; // pale crest so the wavefront is visible as it travels
const TOUCH_RADIUS = 3.2; // cells lit around the finger
const DECAY = 0.9; // touch residue fade per frame
const DIM = 0.62; // how far the untouched grid darkens while held
const FILL_RATE = 0.22; // how fast cells behind the front adopt the carrier colour
const FRONT_W = 1.2; // wavefront crest half-width (cells)
const RIPPLE_MAX_AGE = 900; // frames (~15 s) — a very slow (low-beat) wave still ends
const DWELL_MIN = 0.32, DWELL_TAU = 42, DWELL_MOVE_BLEED = 55; // pressure proxy (no 3D-Touch)
const TAP_MOVE = 0.05; // normalised travel beyond which a release is a bend, not a tap

export default function TouchPad({ visible, onClose, onChange, getValues }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  const srRef = useRef(new Float32Array(N * N)); // settled colour the grid has filled to
  const sgRef = useRef(new Float32Array(N * N));
  const sbRef = useRef(new Float32Array(N * N));
  const frontRef = useRef(new Float32Array(N * N)); // wavefront crest highlight, rebuilt per frame
  const ripplesRef = useRef<any[]>([]);
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const startRef = useRef<null | { cx: number; cy: number; xN: number; yN: number }>(null);
  const movedRef = useRef(false);
  const dimRef = useRef(1);
  const [, forceRender] = useState(0);
  const rafRef = useRef<any>(null);

  const pressureOf = t => (t.rawForce > 0 ? t.rawForce : DWELL_MIN + (1 - DWELL_MIN) * (1 - Math.exp(-t.dwell / DWELL_TAU)));

  const resetSettled = () => {
    const sr = srRef.current, sg = sgRef.current, sb = sbRef.current;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        const col = mix(PURPLE, INDIGO, (r + c) / (2 * (N - 1)));
        sr[i] = col[0]; sg[i] = col[1]; sb[i] = col[2];
      }
    }
  };

  const spawnRipple = (cx, cy) => {
    const v = getValues ? getValues() : { beat: 8, carrier: 200 };
    const beat = Math.max(0.5, Math.min(60, v.beat || 8)); // cells/sec
    const [cr, cg, cb] = carrierRGB(v.carrier || 200);
    const rs = ripplesRef.current;
    if (rs.length > 10) rs.shift();
    rs.push({ cx, cy, radius: 0, age: 0, speed: beat / 60, r: cr, g: cg, b: cb }); // 60fps loop → beat cells/sec
  };

  useEffect(() => {
    if (!visible) {
      heatRef.current.fill(0); frontRef.current.fill(0);
      ripplesRef.current = []; touchRef.current = null; startRef.current = null;
      movedRef.current = false; dimRef.current = 1;
      return;
    }
    resetSettled(); // each open starts at the purple diagonal
    let alive = true;
    let frame = 0;
    const loop = () => {
      if (!alive) return;
      const heat = heatRef.current, front = frontRef.current;
      const sr = srRef.current, sg = sgRef.current, sb = sbRef.current;
      const t = touchRef.current;
      if (t) {
        t.dwell += 1;
        t.eff = pressureOf(t);
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const d = Math.hypot(c - t.cx, r - t.cy);
            if (d <= TOUCH_RADIUS) {
              const val = t.eff * (1 - d / TOUCH_RADIUS);
              const i = r * N + c;
              if (val > heat[i]) heat[i] = val;
            }
          }
        }
      }
      for (let i = 0; i < heat.length; i++) heat[i] *= DECAY;
      // Ripples: expand at the beat rate, fill the carrier colour behind the crest.
      front.fill(0);
      const ripples = ripplesRef.current;
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        const rp = ripples[ri];
        rp.radius += rp.speed;
        rp.age += 1;
        if (rp.radius > N * 1.7 || rp.age > RIPPLE_MAX_AGE) { ripples.splice(ri, 1); continue; }
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const i = r * N + c;
            const dr = Math.hypot(c - rp.cx, r - rp.cy) - rp.radius;
            if (dr <= 0) { // behind the front → settle toward the carrier colour
              sr[i] += (rp.r - sr[i]) * FILL_RATE;
              sg[i] += (rp.g - sg[i]) * FILL_RATE;
              sb[i] += (rp.b - sb[i]) * FILL_RATE;
            }
            if (dr > -FRONT_W && dr < FRONT_W) front[i] += 1 - Math.abs(dr) / FRONT_W; // crest
          }
        }
      }
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      if (Math.abs(dimRef.current - dimTarget) < 0.004) dimRef.current = dimTarget;
      frame++;
      const active = !!t || ripples.length > 0 || dimRef.current < 0.995;
      if (active && frame % 2 === 0) {
        if (t) onChange && onChange({ phase: 'move', xN: t.xN, yN: t.yN, pressure: t.eff });
        forceRender(n => n + 1);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handle = (e, phase) => {
    if (phase === 'end') {
      const t = touchRef.current, start = startRef.current;
      const o = t || start;
      if (start && o) {
        spawnRipple(o.cx, o.cy);
        onChange && onChange(movedRef.current ? { phase: 'end' } : { phase: 'tap', xN: start.xN, yN: start.yN });
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
    let dwell = prev ? prev.dwell : 0;
    if (prev) dwell = Math.max(0, dwell - Math.hypot(xN - prev.xN, yN - prev.yN) * DWELL_MOVE_BLEED);
    const t = { cx: lx / cell - 0.5, cy: ly / cell - 0.5, xN, yN, rawForce, dwell, eff: 0 };
    t.eff = pressureOf(t);
    touchRef.current = t;
    if (phase === 'start') {
      startRef.current = { cx: t.cx, cy: t.cy, xN, yN };
      movedRef.current = false;
      onChange && onChange({ phase: 'start', xN, yN, pressure: t.eff });
    } else if (startRef.current && Math.hypot(xN - startRef.current.xN, yN - startRef.current.yN) > TAP_MOVE) {
      movedRef.current = true;
    }
  };

  const heat = heatRef.current, front = frontRef.current;
  const sr = srRef.current, sg = sgRef.current, sb = sbRef.current;
  const dim = dimRef.current;
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let col = [sr[i] * dim, sg[i] * dim, sb[i] * dim];
      if (heat[i] > 0.01) col = mix(col, BLUE, Math.min(1, heat[i]));
      if (front[i] > 0.01) col = mix(col, FRONT_COLOR, clamp01(front[i]) * 0.55);
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
          pointerEvents="box-only"
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
