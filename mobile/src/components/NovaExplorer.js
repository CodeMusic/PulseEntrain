import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';

// Experimental: drive the Nova's 4 LEDs (2 per eye) for custom patterns.
// Frequency follows the audio beat; this tunes per-eye brightness, the 2nd-LED
// phase, and duty live. Presets are starting points to discover the mapping.
export default function NovaExplorer({ nova }) {
  const [open, setOpen] = useState(false);
  const [lBright, setLBright] = useState(100);
  const [rBright, setRBright] = useState(100);
  const [phase, setPhase] = useState(0);
  const [duty, setDuty] = useState(50);

  const send = patch => nova && nova.setSyncedValues(patch);

  const onLB = v => {
    setLBright(v);
    send({ lLevel: v / 100 });
  };
  const onRB = v => {
    setRBright(v);
    send({ rLevel: v / 100 });
  };
  const onPhase = v => {
    setPhase(v);
    send({ lPhase: v, rPhase: v });
  };
  const onDuty = v => {
    setDuty(v);
    send({ lDuty: v / 100, rDuty: v / 100 });
  };

  const preset = name => {
    if (name === 'sync') {
      setPhase(0);
      setLBright(100);
      setRBright(100);
      send({ lPhase: 0, rPhase: 0, lLevel: 1, rLevel: 1 });
    } else if (name === 'all4') {
      setPhase(2);
      setLBright(100);
      setRBright(100);
      send({ lPhase: 2, rPhase: 2, lLevel: 1, rLevel: 1 }); // offset → drive the primed LEDs
    } else if (name === 'left') {
      setLBright(100);
      setRBright(0);
      send({ lLevel: 1, rLevel: 0 });
    } else if (name === 'right') {
      setLBright(0);
      setRBright(100);
      send({ lLevel: 0, rLevel: 1 });
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.openBtn} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={styles.openTxt}>⚙ Pattern explorer (experimental) ▾</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.8}>
        <Text style={styles.header}>⚙ Pattern explorer ▴</Text>
      </TouchableOpacity>

      <View style={styles.presetRow}>
        {[
          ['sync', 'Sync'],
          ['all4', 'All 4'],
          ['left', 'Left'],
          ['right', 'Right'],
        ].map(([k, l]) => (
          <TouchableOpacity key={k} style={styles.preset} onPress={() => preset(k)} activeOpacity={0.8}>
            <Text style={styles.presetTxt}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Left brightness · {Math.round(lBright)}%</Text>
      <Sld min={0} max={100} val={lBright} on={onLB} />
      <Text style={styles.label}>Right brightness · {Math.round(rBright)}%</Text>
      <Sld min={0} max={100} val={rBright} on={onRB} />
      <Text style={styles.label}>Phase / 2nd LED · {phase.toFixed(1)} Hz</Text>
      <Sld min={0} max={6} step={0.5} val={phase} on={onPhase} />
      <Text style={styles.label}>Duty · {Math.round(duty)}%</Text>
      <Sld min={10} max={90} val={duty} on={onDuty} />
    </View>
  );
}

const Sld = ({ min, max, step = 1, val, on }) => (
  <Slider
    style={styles.slider}
    minimumValue={min}
    maximumValue={max}
    step={step}
    value={val}
    onValueChange={on}
    minimumTrackTintColor={COLORS.accentBlueLight}
    maximumTrackTintColor={COLORS.bgCardLight}
    thumbTintColor="#fff"
  />
);

const styles = StyleSheet.create({
  openBtn: { paddingVertical: 12, marginTop: 10, alignItems: 'center' },
  openTxt: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  box: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 14, marginTop: 12 },
  header: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 10 },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  preset: { flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: COLORS.bgCardLight, alignItems: 'center' },
  presetTxt: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 12 },
  slider: { width: '100%', height: 36 },
});
