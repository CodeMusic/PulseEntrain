import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { isSynthDose } from '../catalog/data';
import { carrierColor, bandFor as band } from '../shared/entrainment';

// A read-only "peek behind the track" — the beat-over-time map (the .imedx scene
// timeline) drawn as a thin-bar area chart with axis bounds, over a faded blur of
// the real artwork. No SVG dependency: the curve is a row of height-scaled Views.
// Carrier→colour + band come from shared/entrainment (low = red, high = purple).
const N = 80;
const fmt = s => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function BeatPeek({ visible, onClose, dose, image }) {
  const data = useMemo(() => {
    if (!dose || !isSynthDose(dose) || !dose.scenes.length) return null;
    const scenes = [...dose.scenes].sort((a, b) => a.atSec - b.atSec);
    const dur = dose.lengthSeconds || scenes[scenes.length - 1].atSec || 60;
    const beatAt = t => {
      if (t <= scenes[0].atSec) return scenes[0].beatHz;
      for (let i = 0; i < scenes.length - 1; i++) {
        const a = scenes[i];
        const b = scenes[i + 1];
        if (t <= b.atSec) {
          const f = (t - a.atSec) / ((b.atSec - a.atSec) || 1);
          return a.beatHz + (b.beatHz - a.beatHz) * f;
        }
      }
      return scenes[scenes.length - 1].beatHz;
    };
    const base = dose.carrier || 200;
    const carrierAt = t => {
      if (t <= scenes[0].atSec) return scenes[0].carrierHz ?? base;
      for (let i = 0; i < scenes.length - 1; i++) {
        const a = scenes[i];
        const b = scenes[i + 1];
        if (t <= b.atSec) {
          const f = (t - a.atSec) / ((b.atSec - a.atSec) || 1);
          const ca = a.carrierHz ?? base;
          const cb = b.carrierHz ?? base;
          return ca + (cb - ca) * f;
        }
      }
      return scenes[scenes.length - 1].carrierHz ?? base;
    };
    const beats = Array.from({ length: N }, (_, i) => beatAt((i / (N - 1)) * dur));
    const carriers = Array.from({ length: N }, (_, i) => carrierAt((i / (N - 1)) * dur));
    return { beats, carriers, bmax: Math.max(1, ...beats), dur };
  }, [dose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          {image ? <Image source={image} style={styles.art} resizeMode="cover" blurRadius={3} /> : null}
          <View style={styles.artFade} />

          <Text style={styles.title}>{dose?.name}</Text>
          <Text style={styles.sub}>the beat map behind this track</Text>

          {data ? (
            <>
              <View style={styles.chart}>
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
                </View>
              </View>
              <View style={styles.xRow}>
                <Text style={styles.xLbl}>0</Text>
                <Text style={styles.xLbl}>{fmt(data.dur)}</Text>
              </View>
              <Text style={styles.note}>
                beat {Math.min(...data.beats).toFixed(1)}–{Math.max(...data.beats).toFixed(1)} Hz ·{' '}
                {band(data.beats[0])} → {band(data.beats[data.beats.length - 1])}
              </Text>
              <Text style={styles.legend}>height = beat · colour = carrier (low → high)</Text>
            </>
          ) : (
            <Text style={styles.note}>Recorded session (bundled audio) — no beat map to show.</Text>
          )}

          <Text style={styles.dismiss}>tap anywhere to close</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 560, backgroundColor: COLORS.bgCard, borderRadius: 22, padding: 20, overflow: 'hidden' },
  art: { ...StyleSheet.absoluteFillObject, opacity: 0.18 },
  artFade: { ...StyleSheet.absoluteFillObject, backgroundColor: COLORS.bgCard, opacity: 0.45 },
  title: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  sub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, marginBottom: 16 },
  chart: { height: 200, paddingLeft: 52, position: 'relative' },
  plot: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderLeftWidth: 1, borderBottomWidth: 1, borderColor: COLORS.divider },
  yTop: { position: 'absolute', left: 0, top: -6, color: COLORS.textMuted, fontSize: 11, width: 48, textAlign: 'right' },
  yBot: { position: 'absolute', left: 0, bottom: -2, color: COLORS.textMuted, fontSize: 11, width: 48, textAlign: 'right' },
  xRow: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 52, marginTop: 4 },
  xLbl: { color: COLORS.textMuted, fontSize: 11 },
  note: { color: COLORS.textSecondary, fontSize: 13, marginTop: 14, textAlign: 'center' },
  legend: { color: COLORS.textMuted, fontSize: 11, marginTop: 4, textAlign: 'center' },
  dismiss: { color: COLORS.textMuted, fontSize: 11, marginTop: 14, textAlign: 'center' },
});
