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
// onChange({ phase:'start'|'move'|'end', xN, yN, pressure }); the screens map that
// to the identical carrier/beat/volume bend. Force falls back to a medium value on
// phones without 3D-Touch so pressure still reads.
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


export default function TouchPad({ visible, onClose, onChange }) {
  const { width, height } = useWindowDimensions();
  const cell = Math.max(4, Math.floor(Math.min(width - 8, height - 96) / N));
  const size = cell * N;
  const heatRef = useRef(new Float32Array(N * N));
  // rawForce: real 3D-Touch force (0 if none). dwell: frames held, feeding the proxy.
  const touchRef = useRef<null | { cx: number; cy: number; xN: number; yN: number; rawForce: number; dwell: number; eff: number }>(null);
  const dimRef = useRef(1); // 1 = normal, →DIM while a finger is down
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
      const dimTarget = t ? DIM : 1;
      dimRef.current += (dimTarget - dimRef.current) * 0.12;
      frame++;
      // Drive the audio at ~30fps so dwell pressure swells even with a still finger.
      if (frame % 2 === 0) {
        if (t) onChange && onChange({ phase: 'move', xN: t.xN, yN: t.yN, pressure: t.eff });
        forceRender(n => n + 1);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [visible]);

  const handle = (e, phase) => {
    if (phase === 'end') {
      touchRef.current = null;
      onChange && onChange({ phase: 'end' });
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
    // 'start' seeds the screen's touch anchor immediately; 'move' is driven by the loop.
    if (phase === 'start') onChange && onChange({ phase: 'start', xN, yN, pressure: t.eff });
  };

  const heat = heatRef.current;
  const dim = dimRef.current;
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      const diag = (r + c) / (2 * (N - 1));
      const base = mix(PURPLE, INDIGO, diag).map(v => v * dim);
      const col = mix(base, BLUE, Math.min(1, heat[i]));
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
