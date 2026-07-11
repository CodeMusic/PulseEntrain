import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { clamp01, lerpColor as mix, rgbColor as rgb } from '../shared/math';
import { carrierRGB } from '../shared/entrainment';

// Full-screen on-phone stand-in for the ROLI Lightpad. Your finger lights the cells
// under it blue (brighter with pressure) and the rest dims while you hold.
//
// It reports the same gesture the block does via onChange({ phase, xN, yN, pressure }):
// 'start' | 'move' | 'end' (release after a bend) | 'tap'. Force falls back to a
// medium value without 3D-Touch.
//
// COLOUR tells the story: OUTSIDE a wave, cells hold the TRACK's true carrier colour;
// INSIDE the wave they show the BENT carrier colour. A tap / bend-release casts a wave
// from the touch point that expands at the live BEAT and "reveals" the bent colour as
// it passes; as the bend springs back to the program's value, the bent colour (and the
// wave speed) spring with it, so the inner region recedes to the track colour. In Field
// there's no spring, so the inner colour just settles at the field's colour.
// Overlapping wavefronts add as a signed field → interference fringes where they cross.
// getValues() supplies live { beat, carrier (bent), trackCarrier (true) }.
const N = 20;
const BLUE = [90, 170, 255]; // touch highlight
const CREST = [235, 245, 255]; // constructive fringe tint
const TOUCH_RADIUS = 3.2, DECAY = 0.9, DIM = 0.62;
const B_RISE = 0.34; // how fast a cell flips to "revealed/bent" once a front passes it
const B_DECAY = 0.955; // how fast the reveal fades back once no wave covers the cell
const SPEED_SCALE = 3.5; // wave speed = beat × this (cells/sec)
const WAVE_K = 1.7; // wavefront ring spacing (interference wavelength)
const WAVE_ENV = 2.0; // wave-train envelope width around each front (cells)
const DWELL_MIN = 0.32, DWELL_TAU = 42, DWELL_MOVE_BLEED = 55;
const TAP_MOVE = 0.05;

export default function TouchPad({ visible, onClose, onChange, getValues }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  const bRef = useRef(new Float32Array(N * N)); // 0 = track colour … 1 = bent colour (wave-revealed)
  const frontRef = useRef(new Float32Array(N * N)); // signed wavefront field (sums → interference)
  const ripplesRef = useRef<any[]>([]);
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const startRef = useRef<null | { cx: number; cy: number; xN: number; yN: number }>(null);
  const movedRef = useRef(false);
  const dimRef = useRef(1);
  const paintRef = useRef(0); // frames of repaint remaining after the last change
  const [, forceRender] = useState(0);
  const rafRef = useRef<any>(null);

  const pressureOf = t => (t.rawForce > 0 ? t.rawForce : DWELL_MIN + (1 - DWELL_MIN) * (1 - Math.exp(-t.dwell / DWELL_TAU)));

  const spawnRipple = (cx, cy) => {
    const rs = ripplesRef.current;
    if (rs.length > 8) rs.shift();
    rs.push({ cx, cy, radius: 0 }); // speed read live from the beat each frame
    paintRef.current = 80;
  };

  useEffect(() => {
    if (!visible) {
      heatRef.current.fill(0); bRef.current.fill(0); frontRef.current.fill(0);
      ripplesRef.current = []; touchRef.current = null; startRef.current = null;
      movedRef.current = false; dimRef.current = 1; paintRef.current = 0;
      return;
    }
    paintRef.current = 40;
    let alive = true, frame = 0;
    const loop = () => {
      if (!alive) return;
      const heat = heatRef.current, b = bRef.current, front = frontRef.current;
      const t = touchRef.current;
      const v = getValues ? getValues() : { beat: 8, carrier: 200, trackCarrier: 200 };
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
      for (let i = 0; i < b.length; i++) b[i] *= B_DECAY; // reveal fades unless a wave keeps it up
      front.fill(0);
      const ripples = ripplesRef.current;
      // Live wave speed = the current beat, so a wave springs with the beat.
      const liveSpeed = (Math.max(0.5, Math.min(60, v.beat || 8)) * SPEED_SCALE) / 60;
      for (let ri = ripples.length - 1; ri >= 0; ri--) {
        const rp = ripples[ri];
        rp.radius += liveSpeed;
        if (rp.radius > N * 2.0) { ripples.splice(ri, 1); continue; }
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            const i = r * N + c;
            const dr = Math.hypot(c - rp.cx, r - rp.cy) - rp.radius;
            if (dr <= 0) b[i] += (1 - b[i]) * B_RISE; // behind the front → reveal the bent colour
            if (dr > -3 * WAVE_ENV && dr < 2 * WAVE_ENV) { // signed wave-train → interference on overlap
              front[i] += Math.cos(WAVE_K * dr) * Math.exp(-(dr * dr) / (2 * WAVE_ENV * WAVE_ENV));
            }
          }
        }
      }
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      if (Math.abs(dimRef.current - dimTarget) < 0.004) dimRef.current = dimTarget;
      if (t || ripples.length > 0) paintRef.current = 80; else paintRef.current = Math.max(0, paintRef.current - 1);
      frame++;
      const active = paintRef.current > 0 || dimRef.current < 0.995;
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

  const heat = heatRef.current, b = bRef.current, front = frontRef.current;
  const dim = dimRef.current;
  const vNow = getValues ? getValues() : { carrier: 200, trackCarrier: 200 };
  const trackCol = carrierRGB(vNow.trackCarrier != null ? vNow.trackCarrier : vNow.carrier);
  const bentCol = carrierRGB(vNow.carrier);
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      let col = mix(trackCol, bentCol, clamp01(b[i])); // outer = track, inner = bent
      col = [col[0] * dim, col[1] * dim, col[2] * dim];
      if (heat[i] > 0.01) col = mix(col, BLUE, Math.min(1, heat[i]));
      const f = front[i];
      if (f > 0.01) col = mix(col, CREST, clamp01(f * 0.5)); // constructive → bright fringe
      else if (f < -0.01) { const k = clamp01(-f * 0.5) * 0.5; col = [col[0] * (1 - k), col[1] * (1 - k), col[2] * (1 - k)]; } // destructive → dark
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
