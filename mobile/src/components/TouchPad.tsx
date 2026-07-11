import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { clamp01, lerpColor as mix, rgbColor as rgb } from '../shared/math';
import { carrierRGB } from '../shared/entrainment';

// Full-screen on-phone stand-in for the ROLI Lightpad. Your finger lights the cells
// under it blue (brighter with pressure) and the rest dims while you hold.
//
// It reports the same gesture the block does via onChange({ phase, xN, yN, pressure }):
// 'start' | 'move' | 'end' (release after a bend) | 'tap' (release with ~no travel →
// the screen rings a small bend). Force falls back to a medium value without 3D-Touch.
//
// COLOUR = the live CARRIER. The whole grid continuously eases toward the carrier's
// colour (the shared carrier→colour map), so a program's timeline changes recolour it
// gradually, and a bend that springs back drags the colour back too — overshoot and
// all. A tap or bend-release also casts a WAVE from the touch point that expands at the
// live BEAT (cells/sec × a scale) and recolours faster inside its front — so you see the
// change ripple out at the entrainment rate. getValues() supplies live { beat, carrier }.
const N = 20; // grid resolution — one constant; N*N Views repaint ~30fps, so watch perf if you raise it
const PURPLE = [124, 58, 237]; // resting diagonal (blooms into the carrier colour on open)
const INDIGO = [63, 81, 181];
const BLUE = [90, 170, 255]; // touch highlight
const FRONT_COLOR = [230, 242, 255]; // pale crest so the wavefront is visible as it travels
const TOUCH_RADIUS = 3.2; // cells lit around the finger
const DECAY = 0.9; // touch residue fade per frame
const DIM = 0.62; // how far the untouched grid darkens while held
const BASE_DRIFT = 0.035; // ambient recolour toward the live carrier (timeline / spring-back / bloom)
const FILL_RATE = 0.36; // faster recolour inside a wavefront — makes the ripple read as a moving edge
const SPEED_SCALE = 3.5; // wave speed = beat × this (cells/sec); raise for snappier waves
const FRONT_W = 1.2; // wavefront crest half-width (cells)
const DWELL_MIN = 0.32, DWELL_TAU = 42, DWELL_MOVE_BLEED = 55; // pressure proxy (no 3D-Touch)
const TAP_MOVE = 0.05; // normalised travel beyond which a release is a bend, not a tap

export default function TouchPad({ visible, onClose, onChange, getValues }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  const srRef = useRef(new Float32Array(N * N)); // settled colour the grid has eased to
  const sgRef = useRef(new Float32Array(N * N));
  const sbRef = useRef(new Float32Array(N * N));
  const frontRef = useRef(new Float32Array(N * N)); // wavefront crest highlight, rebuilt per frame
  const rateRef = useRef(new Float32Array(N * N)); // per-cell recolour rate this frame
  const ripplesRef = useRef<any[]>([]);
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const startRef = useRef<null | { cx: number; cy: number; xN: number; yN: number }>(null);
  const movedRef = useRef(false);
  const dimRef = useRef(1);
  const lastTargetRef = useRef([0, 0, 0]);
  const settleFramesRef = useRef(0); // keep repainting for a bit after anything changes
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
    const rs = ripplesRef.current;
    if (rs.length > 10) rs.shift();
    rs.push({ cx, cy, radius: 0 }); // speed is read live from the beat each frame (springs with it)
    settleFramesRef.current = 60;
  };

  useEffect(() => {
    if (!visible) {
      heatRef.current.fill(0); frontRef.current.fill(0);
      ripplesRef.current = []; touchRef.current = null; startRef.current = null;
      movedRef.current = false; dimRef.current = 1; settleFramesRef.current = 0;
      return;
    }
    resetSettled();
    settleFramesRef.current = 80; // bloom into the carrier colour on open
    let alive = true;
    let frame = 0;
    const loop = () => {
      if (!alive) return;
      const heat = heatRef.current, front = frontRef.current, rate = rateRef.current;
      const sr = srRef.current, sg = sgRef.current, sb = sbRef.current;
      const t = touchRef.current;
      const v = getValues ? getValues() : { beat: 8, carrier: 200 };
      const tgt = carrierRGB(v.carrier || 200);
      const lt = lastTargetRef.current;
      if (Math.abs(tgt[0] - lt[0]) + Math.abs(tgt[1] - lt[1]) + Math.abs(tgt[2] - lt[2]) > 1.5) {
        settleFramesRef.current = Math.max(settleFramesRef.current, 30); // carrier moved → keep painting
        lastTargetRef.current = tgt;
      }
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
      // Wavefronts: expand at the beat rate; mark cells inside for fast recolour + crest.
      front.fill(0);
      rate.fill(BASE_DRIFT);
      const ripples = ripplesRef.current;
      // Live wave speed = the current beat — so an in-flight wave slows/speeds as the
      // beat springs back to the program's value (overshoot included).
      const liveSpeed = (Math.max(0.5, Math.min(60, v.beat || 8)) * SPEED_SCALE) / 60;
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        const rp = ripples[ri];
        rp.radius += liveSpeed;
        if (rp.radius > N * 1.9) { ripples.splice(ri, 1); continue; }
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const i = r * N + c;
            const dr = Math.hypot(c - rp.cx, r - rp.cy) - rp.radius;
            if (dr <= 0) rate[i] = FILL_RATE;
            if (dr > -FRONT_W && dr < FRONT_W) front[i] += 1 - Math.abs(dr) / FRONT_W;
          }
        }
      }
      // Recolour every cell toward the live carrier colour (fast inside a front, slow outside).
      for (let i = 0; i < sr.length; i++) {
        sr[i] += (tgt[0] - sr[i]) * rate[i];
        sg[i] += (tgt[1] - sg[i]) * rate[i];
        sb[i] += (tgt[2] - sb[i]) * rate[i];
      }
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      if (Math.abs(dimRef.current - dimTarget) < 0.004) dimRef.current = dimTarget;
      if (t || ripples.length > 0) settleFramesRef.current = 60;
      else settleFramesRef.current = Math.max(0, settleFramesRef.current - 1);
      frame++;
      const active = settleFramesRef.current > 0 || dimRef.current < 0.995;
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
