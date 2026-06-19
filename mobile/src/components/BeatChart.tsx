import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

// beat-over-time chart: bar height = beat, bar colour = carrier (low red → high
// purple), with axis bounds and an optional live playhead. Shared by the player's
// live graph and (conceptually) the peek modal.
const N = 80;
const fmt = s => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}
export const carrierColor = c => hsv(Math.max(0, Math.min(1, (c - 70) / 430)) * 0.8, 0.72, 0.95);
export const bandFor = b =>
  b < 0.5 ? 'Epsilon' : b < 4 ? 'Delta' : b < 8 ? 'Theta' : b < 13 ? 'Alpha' : b < 30 ? 'Beta' : 'Gamma';

export default function BeatChart({ scenes, duration, baseCarrier = 200, height = 200, progress = null }) {
  const data = useMemo(() => {
    const ss = (scenes || []).slice().sort((a, b) => a.atSec - b.atSec);
    if (!ss.length) return null;
    const dur = duration || ss[ss.length - 1].atSec || 60;
    const lerp = get => t => {
      if (t <= ss[0].atSec) return get(ss[0]);
      for (let i = 0; i < ss.length - 1; i++) {
        const a = ss[i];
        const b = ss[i + 1];
        if (t <= b.atSec) {
          const f = (t - a.atSec) / ((b.atSec - a.atSec) || 1);
          return get(a) + (get(b) - get(a)) * f;
        }
      }
      return get(ss[ss.length - 1]);
    };
    const beatAt = lerp(s => s.beatHz);
    const carrAt = lerp(s => (s.carrierHz == null ? baseCarrier : s.carrierHz));
    const beats = Array.from({ length: N }, (_, i) => beatAt((i / (N - 1)) * dur));
    const carriers = Array.from({ length: N }, (_, i) => carrAt((i / (N - 1)) * dur));
    return { beats, carriers, bmax: Math.max(1, ...beats), dur };
  }, [scenes, duration, baseCarrier]);

  if (!data) return null;
  return (
    <View style={[styles.wrap, { height }]}>
      <Text style={styles.yTop}>{data.bmax.toFixed(1)} Hz</Text>
      <Text style={styles.yBot}>0</Text>
      <View style={styles.plot}>
        {data.beats.map((b, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: `${(b / data.bmax) * 100}%`,
              backgroundColor: carrierColor(data.carriers[i]),
              opacity: 0.9,
              marginHorizontal: 0.3,
            }}
          />
        ))}
        {progress != null ? (
          <View style={[styles.playhead, { left: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} />
        ) : null}
      </View>
      <View style={styles.xRow}>
        <Text style={styles.x}>0</Text>
        <Text style={styles.x}>{fmt(data.dur)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingLeft: 48, paddingBottom: 16 },
  plot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.divider,
  },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  yTop: { position: 'absolute', left: 0, top: -6, width: 44, textAlign: 'right', color: COLORS.textMuted, fontSize: 11 },
  yBot: { position: 'absolute', left: 0, bottom: 14, width: 44, textAlign: 'right', color: COLORS.textMuted, fontSize: 11 },
  xRow: { flexDirection: 'row', justifyContent: 'space-between' },
  x: { color: COLORS.textMuted, fontSize: 11 },
});
