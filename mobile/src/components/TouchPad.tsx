import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { clamp01, lerpColor as mix, rgbColor as rgb } from '../shared/math';
import { carrierRGB } from '../shared/entrainment';

// Full-screen on-phone stand-in for the ROLI Lightpad. Reports the same gesture the
// block does via onChange({ phase, xN, yN, pressure }): 'start' | 'move' | 'end'
// (release after a bend) | 'tap'. Force falls back to a medium value without 3D-Touch.
//
// The grid is an "ocean" whose colour is ALWAYS the program track's current carrier.
// While you pull/bend, the bent colour shows only in your TOUCH RESIDUE (the glowing
// trail under your finger). On release a circular WAVE is cast that carries the bend it
// was thrown with, frozen, then springing back toward the track colour (briefly past it)
// over its own life while it expands at the (springing) beat. Each wave keeps its own
// bend, so you can lay several; where they overlap the inner colours blend (colour
// interference) and their signed crests add (edge interference). In Field there's no
// spring, so a wave just settles at the field's colour.
// getValues() → live { beat, carrier (bent), trackBeat, trackCarrier }.
const N = 20;
const WHITE = [255, 255, 255];
const CREST = [235, 245, 255];
const TOUCH_RADIUS = 3.2, DECAY = 0.9, DIM = 0.62;
const SPEED_SCALE = 3.5; // wave speed = beat × this (cells/sec)
const EDGE = 1.6; // soft width of a wave's colour-fill boundary (cells)
const WAVE_K = 1.7, WAVE_ENV = 2.0; // crest ring spacing + train width (edge interference)
const DWELL_MIN = 0.32, DWELL_TAU = 42, DWELL_MOVE_BLEED = 55;
const TAP_MOVE = 0.05;

// Bend → track spring: 0 at cast, →1 with a brief overshoot past 1 (colour/speed go
// slightly past the track value before settling), over ~0.8 s.
const springProgress = age => {
  const x = age / 26;
  return Math.max(0, Math.min(1.25, 1 - Math.exp(-x) * Math.cos(x * 1.6)));
};
const clampByte = v => (v < 0 ? 0 : v > 255 ? 255 : v);

export default function TouchPad({ visible, onClose, onChange, getValues }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  const fcRef = useRef(new Float32Array(N * N * 3)); // per-cell blended colour (ocean + waves)
  const frontRef = useRef(new Float32Array(N * N)); // signed crest field (edge interference)
  const ripplesRef = useRef<any[]>([]);
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const startRef = useRef<null | { cx: number; cy: number; xN: number; yN: number }>(null);
  const movedRef = useRef(false);
  const dimRef = useRef(1);
  const paintRef = useRef(0);
  const [, forceRender] = useState(0);
  const rafRef = useRef<any>(null);

  const pressureOf = t => (t.rawForce > 0 ? t.rawForce : DWELL_MIN + (1 - DWELL_MIN) * (1 - Math.exp(-t.dwell / DWELL_TAU)));

  const spawnRipple = (cx, cy) => {
    const v = getValues ? getValues() : { beat: 8, carrier: 200 };
    const rs = ripplesRef.current;
    if (rs.length > 6) rs.shift();
    rs.push({ cx, cy, radius: 0, age: 0, c0: carrierRGB(v.carrier || 200), beat0: v.beat || 8 });
    paintRef.current = 90;
  };

  useEffect(() => {
    if (!visible) {
      heatRef.current.fill(0); frontRef.current.fill(0);
      ripplesRef.current = []; touchRef.current = null; startRef.current = null;
      movedRef.current = false; dimRef.current = 1; paintRef.current = 0;
      return;
    }
    paintRef.current = 30;
    // Seed the colour field with the current track colour so the grid opens as the ocean.
    {
      const v0 = getValues ? getValues() : { trackCarrier: 200, carrier: 200 };
      const tc = carrierRGB(v0.trackCarrier != null ? v0.trackCarrier : v0.carrier);
      const fc = fcRef.current;
      for (let i = 0; i < N * N; i++) { fc[i * 3] = tc[0]; fc[i * 3 + 1] = tc[1]; fc[i * 3 + 2] = tc[2]; }
    }
    let alive = true, frame = 0;
    const loop = () => {
      if (!alive) return;
      const heat = heatRef.current, front = frontRef.current, fc = fcRef.current;
      const t = touchRef.current;
      const v = getValues ? getValues() : { beat: 8, carrier: 200, trackBeat: 8, trackCarrier: 200 };
      const trackCol = carrierRGB(v.trackCarrier != null ? v.trackCarrier : v.carrier);
      const trackBeat = v.trackBeat != null ? v.trackBeat : v.beat || 8;
      if (t) {
        t.dwell += 1; t.eff = pressureOf(t);
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const d = Math.hypot(c - t.cx, r - t.cy);
            if (d <= TOUCH_RADIUS) { const val = t.eff * (1 - d / TOUCH_RADIUS); const i = r * N + c; if (val > heat[i]) heat[i] = val; }
          }
        }
      }
      for (let i = 0; i < heat.length; i++) heat[i] *= DECAY;
      // Per-ripple physics: spring the colour + speed toward the track, expand.
      const ripples = ripplesRef.current;
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        const rp = ripples[ri];
        rp.age += 1;
        const sp = springProgress(rp.age);
        rp.col = mix(rp.c0, trackCol, sp); // bent → track (with overshoot)
        const beat = rp.beat0 + (trackBeat - rp.beat0) * Math.min(1, sp);
        rp.radius += (Math.max(0.5, Math.min(60, beat)) * SPEED_SCALE) / 60;
        if (rp.radius > N * 2.0) ripples.splice(ri, 1);
      }
      frame++;
      const active = paintRef.current > 0 || ripples.length > 0 || t || dimRef.current < 0.995;
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      if (Math.abs(dimRef.current - dimTarget) < 0.004) dimRef.current = dimTarget;
      if (t || ripples.length > 0) paintRef.current = 90; else paintRef.current = Math.max(0, paintRef.current - 1);
      // Build the per-cell colour field (ocean + wave blend) + crest field, on paint frames.
      if (active && frame % 2 === 0) {
        front.fill(0);
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const i = r * N + c;
            let ar = 0, ag = 0, ab = 0, tw = 0;
            for (let ri = 0; ri < ripples.length; ri++) {
              const rp = ripples[ri];
              const dr = Math.hypot(c - rp.cx, r - rp.cy) - rp.radius;
              const w = clamp01(-dr / EDGE); // 1 well inside, ramps to 0 at the front
              if (w > 0) { ar += rp.col[0] * w; ag += rp.col[1] * w; ab += rp.col[2] * w; tw += w; }
              if (dr > -3 * WAVE_ENV && dr < 2 * WAVE_ENV) front[i] += Math.cos(WAVE_K * dr) * Math.exp(-(dr * dr) / (2 * WAVE_ENV * WAVE_ENV));
            }
            const cover = clamp01(tw);
            const wr = tw > 0 ? ar / tw : trackCol[0];
            const wg = tw > 0 ? ag / tw : trackCol[1];
            const wb = tw > 0 ? ab / tw : trackCol[2];
            fc[i * 3] = trackCol[0] + (wr - trackCol[0]) * cover;
            fc[i * 3 + 1] = trackCol[1] + (wg - trackCol[1]) * cover;
            fc[i * 3 + 2] = trackCol[2] + (wb - trackCol[2]) * cover;
          }
        }
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

  const heat = heatRef.current, front = frontRef.current, fc = fcRef.current;
  const dim = dimRef.current;
  const vNow = getValues ? getValues() : { carrier: 200 };
  const residue = mix(carrierRGB(vNow.carrier), WHITE, 0.22); // bent-carrier glow left by the finger
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let col = [fc[i * 3] * dim, fc[i * 3 + 1] * dim, fc[i * 3 + 2] * dim];
      if (heat[i] > 0.01) col = mix(col, residue, Math.min(1, heat[i]));
      const f = front[i];
      if (f > 0.01) col = mix(col, CREST, clamp01(f * 0.5));
      else if (f < -0.01) { const k = clamp01(-f * 0.5) * 0.5; col = [col[0] * (1 - k), col[1] * (1 - k), col[2] * (1 - k)]; }
      cells.push(
        <View
          key={i}
          style={{ position: 'absolute', left: c * cell, top: r * cell, width: cell - 1, height: cell - 1, borderRadius: 2, backgroundColor: rgb([clampByte(col[0]), clampByte(col[1]), clampByte(col[2])]) }}
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
