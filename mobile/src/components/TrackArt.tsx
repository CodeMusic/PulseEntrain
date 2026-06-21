import React, { useMemo } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { carrierColor } from '../shared/entrainment';

// The track "signature": a donut radial chart — time runs clockwise from the top,
// each spoke's length is the beat, its colour the carrier (low red → high purple),
// with the cover image circle-cropped in the middle (or the track's initial). The
// universal track logo; in the player/detail it's tappable to toggle the bar view.
// Pure Views (rotated spokes) — no SVG dependency, matches the other charts.
const AXIS_MAX = 40; // fixed beat scale so a track's ring is a comparable fingerprint

function sample(scenes, baseCarrier, n) {
  const ss = (scenes || []).slice().sort((a, b) => a.atSec - b.atSec);
  if (!ss.length) return null;
  const dur = ss[ss.length - 1].atSec || 60;
  const at = (get, t) => {
    if (t <= ss[0].atSec) return get(ss[0]);
    for (let i = 0; i < ss.length - 1; i++) {
      const a = ss[i], b = ss[i + 1];
      if (t <= b.atSec) return get(a) + (get(b) - get(a)) * ((t - a.atSec) / ((b.atSec - a.atSec) || 1));
    }
    return get(ss[ss.length - 1]);
  };
  const beats = [], carriers = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * dur;
    beats.push(at(s => s.beatHz, t));
    carriers.push(at(s => (s.carrierHz == null ? baseCarrier : s.carrierHz), t));
  }
  return { beats, carriers };
}

function TrackArt({ scenes, carrier = 200, image = null, name = '', size = 220, progress = null, onPress = null }) {
  const N = Math.max(28, Math.min(96, Math.round(size / 2.6)));
  const data = useMemo(() => sample(scenes, carrier, N), [scenes, carrier, N]);
  const R = size / 2;
  const outerR = R - Math.max(3, size * 0.02);
  const innerR = outerR * 0.56;
  const barW = Math.max(1.4, (2 * Math.PI * innerR) / N * 0.72);
  const dot = Math.max(3, size * 0.022);
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  const body = (
    <View style={{ width: size, height: size }}>
      {/* faint boundary ring */}
      <View style={{ position: 'absolute', left: R - outerR, top: R - outerR, width: outerR * 2, height: outerR * 2, borderRadius: outerR, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }} />
      {/* spokes */}
      {data
        ? data.beats.map((b, i) => {
            const len = Math.max(1, Math.min(1, b / AXIS_MAX) * (outerR - innerR));
            const deg = (i / N) * 360;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: R - barW / 2,
                  top: R - len / 2,
                  width: barW,
                  height: len,
                  borderRadius: barW / 2,
                  backgroundColor: carrierColor(data.carriers[i]),
                  transform: [{ rotate: `${deg}deg` }, { translateY: -(innerR + len / 2) }],
                }}
              />
            );
          })
        : null}
      {/* centre hole: circle-cropped image, else the initial */}
      <View style={[styles.hole, { left: R - innerR, top: R - innerR, width: innerR * 2, height: innerR * 2, borderRadius: innerR }]}>
        {image ? (
          <Image source={image} style={{ width: innerR * 2, height: innerR * 2 }} resizeMode="cover" />
        ) : (
          <Text style={{ color: 'rgba(255,255,255,0.82)', fontSize: innerR * 0.9, fontWeight: '700' }}>{initial}</Text>
        )}
      </View>
      {/* playhead dot on the rim */}
      {progress != null ? (
        <View
          style={{
            position: 'absolute',
            left: R - dot,
            top: R - dot,
            width: dot * 2,
            height: dot * 2,
            borderRadius: dot,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: COLORS.bgDark,
            transform: [{ rotate: `${Math.max(0, Math.min(1, progress)) * 360}deg` }, { translateY: -outerR }],
          }}
        />
      ) : null}
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} style={styles.center}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.center}>{body}</View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  hole: { position: 'absolute', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: COLORS.bgDark },
});

export default React.memo(TrackArt);
