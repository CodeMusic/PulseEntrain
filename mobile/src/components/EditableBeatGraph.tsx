import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { carrierColor } from '../shared/entrainment';

// Interactive beat-over-time editor (the desktop Admin's graph, for web/studio):
// tap empty space to add a node, drag a node to move it (time + beat), tap a node
// to select it. Carrier isn't a spatial axis, so it's edited in the panel below.
// Curve is drawn as carrier-coloured bars (no SVG dep); nodes are draggable
// handles on top. The vertical axis is fixed (0..AXIS_MAX) so dragging maps
// predictably.
const N = 90; // curve sample count
const AXIS_MAX = 40; // Hz — covers delta→gamma; fixed so vertical drag is stable
const LEFT = 44;
const TOP = 10;
const BOTTOM = 20;
const HIT = 26; // px radius to grab an existing node

const fmt = s => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function EditableBeatGraph({
  scenes,
  duration,
  baseCarrier = 200,
  height = 260,
  selected = -1,
  onSelect,
  onChange, // (nextScenes) => void
  onBeginEdit, // called once at the start of an add/drag gesture (for undo history)
  progress = null,
}) {
  const [w, setW] = useState(0);
  const plotW = Math.max(1, w - LEFT);
  const plotH = Math.max(1, height - TOP - BOTTOM);
  const dur = duration || 1;

  const sorted = [...scenes].sort((a, b) => a.atSec - b.atSec);
  const beatAt = t => {
    if (!sorted.length) return 0;
    if (t <= sorted[0].atSec) return sorted[0].beatHz;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t <= b.atSec) return a.beatHz + (b.beatHz - a.beatHz) * ((t - a.atSec) / ((b.atSec - a.atSec) || 1));
    }
    return sorted[sorted.length - 1].beatHz;
  };
  const carrAt = t => {
    if (!sorted.length) return baseCarrier;
    const c = sc => (sc.carrierHz == null ? baseCarrier : sc.carrierHz);
    if (t <= sorted[0].atSec) return c(sorted[0]);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t <= b.atSec) return c(a) + (c(b) - c(a)) * ((t - a.atSec) / ((b.atSec - a.atSec) || 1));
    }
    return c(sorted[sorted.length - 1]);
  };

  const bars = Array.from({ length: N }, (_, i) => {
    const t = (i / (N - 1)) * dur;
    return { h: Math.min(1, beatAt(t) / AXIS_MAX), color: carrierColor(carrAt(t)) };
  });

  // screen <-> data
  const toData = (locX, locY) => ({
    atSec: Math.max(0, Math.min(dur, ((locX - LEFT) / plotW) * dur)),
    beatHz: Math.max(0, Math.min(AXIS_MAX, (1 - (locY - TOP) / plotH) * AXIS_MAX)),
  });
  const nodeX = sc => LEFT + (sc.atSec / dur) * plotW;
  const nodeY = sc => TOP + (1 - Math.min(AXIS_MAX, sc.beatHz) / AXIS_MAX) * plotH;

  // index into the *original* scenes array nearest to a touch (within HIT px)
  const hitNode = (locX, locY) => {
    let best = -1;
    let bestD = HIT;
    scenes.forEach((sc, i) => {
      const d = Math.hypot(nodeX(sc) - locX, nodeY(sc) - locY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  let dragIdx = -1; // closed over per-gesture (handlers recreated each render)

  const onGrant = e => {
    const { locationX, locationY } = e.nativeEvent;
    onBeginEdit && onBeginEdit(); // snapshot for undo before this gesture mutates
    const i = hitNode(locationX, locationY);
    if (i >= 0) {
      dragIdx = i;
      onSelect && onSelect(i);
    } else {
      const p = toData(locationX, locationY);
      const next = [...scenes, { atSec: Math.round(p.atSec), beatHz: Math.round(p.beatHz * 100) / 100 }];
      dragIdx = next.length - 1;
      onChange && onChange(next);
      onSelect && onSelect(dragIdx);
    }
  };
  const onMove = e => {
    if (dragIdx < 0) return;
    const { locationX, locationY } = e.nativeEvent;
    const p = toData(locationX, locationY);
    const next = scenes.map((sc, i) =>
      i === dragIdx ? { ...sc, atSec: Math.round(p.atSec), beatHz: Math.round(p.beatHz * 100) / 100 } : sc,
    );
    onChange && onChange(next);
  };
  const onRelease = () => {
    dragIdx = -1;
  };

  return (
    <View style={[styles.wrap, { height }]} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Text style={styles.yTop}>{AXIS_MAX} Hz</Text>
      <Text style={styles.yBot}>0</Text>
      <View
        style={styles.surface}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={onRelease}>
        {/* curve (carrier-coloured bars) */}
        <View style={[styles.plot, { left: LEFT, top: TOP, height: plotH }]}>
          {bars.map((b, i) => (
            <View key={i} style={{ flex: 1, height: `${b.h * 100}%`, backgroundColor: b.color, opacity: 0.55, marginHorizontal: 0.2 }} />
          ))}
        </View>
        {/* node handles */}
        {scenes.map((sc, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={[
              styles.node,
              { left: nodeX(sc) - 7, top: nodeY(sc) - 7 },
              i === selected && styles.nodeSel,
            ]}
          />
        ))}
        {progress != null ? (
          <View style={[styles.playhead, { left: LEFT + Math.max(0, Math.min(1, progress)) * plotW, top: TOP, height: plotH }]} />
        ) : null}
      </View>
      <View style={styles.xRow}>
        <Text style={styles.x}>0</Text>
        <Text style={styles.x}>{fmt(dur)}</Text>
      </View>
      <Text style={styles.hint}>tap to add · drag a node to move · tap a node to edit it below</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  surface: { ...StyleSheet.absoluteFillObject },
  plot: { position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'flex-end', borderLeftWidth: 1, borderBottomWidth: 1, borderColor: COLORS.divider },
  node: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.accentGreen, borderWidth: 2, borderColor: COLORS.bgDark },
  nodeSel: { backgroundColor: '#fff', borderColor: COLORS.accentGreen, width: 16, height: 16, borderRadius: 8, marginLeft: -1, marginTop: -1 },
  playhead: { position: 'absolute', width: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  yTop: { position: 'absolute', left: 0, top: TOP - 6, width: LEFT - 6, textAlign: 'right', color: COLORS.textMuted, fontSize: 11 },
  yBot: { position: 'absolute', left: 0, bottom: BOTTOM, width: LEFT - 6, textAlign: 'right', color: COLORS.textMuted, fontSize: 11 },
  xRow: { position: 'absolute', left: LEFT, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between' },
  x: { color: COLORS.textMuted, fontSize: 11 },
  hint: { position: 'absolute', left: LEFT, bottom: -2, right: 0, textAlign: 'center', color: COLORS.textMuted, fontSize: 10 },
});
