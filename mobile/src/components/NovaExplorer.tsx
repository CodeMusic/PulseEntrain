import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';

// Developer Tools: drive the Nova for testing and authoring tracks. Two controls
// for now — a flicker-rate override (0 Hz/no flash up through gamma, so you can
// time and refine the rate), and a flicker style. During track playback the
// timeline normally drives the flicker; "Override track flicker" hands manual
// control to this panel (onOverride lets the player suspend its per-tick writes).
const FREQ_MAX = 40; // covers delta→gamma (30 Hz+); device cap is 60 Hz

// Per-eye brightness presets. "Standard" (both LEDs dark) is the harder default
// flicker; "Enlightened" lights both; Left/Right are single-eye pulses.
const STYLE_LEVELS = {
  standard: { lLevel: 0, rLevel: 0 }, // both LEDs dark — the harder/default flicker
  enlightened: { lLevel: 1, rLevel: 1 }, // both LEDs lit
  left: { lLevel: 1, rLevel: 0 },
  right: { lLevel: 0, rLevel: 1 },
};
const STYLE_BUTTONS = [
  ['standard', 'Standard'],
  ['enlightened', 'Enlightened'],
  ['left', 'Left'],
  ['right', 'Right'],
];

export default function NovaExplorer({ nova, showFrequency = false, onOverride = null }) {
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState(false);
  const [freq, setFreq] = useState(10);
  const [style, setStyle] = useState('standard');

  const send = patch => nova && nova.setSyncedValues(patch);
  const applyStyle = name => send(STYLE_LEVELS[name]);

  const onFreq = v => {
    setFreq(v);
    if (!nova) return;
    if (v <= 0) {
      send({ lLevel: 0, rLevel: 0 }); // 0 Hz = no flash (LEDs dark)
      return;
    }
    nova.setFrequency(v);
    applyStyle(style);
  };

  const pickStyle = name => {
    setStyle(name);
    if (freq > 0) applyStyle(name);
  };

  // Hand frequency/flash control to the explorer (player stops its per-tick
  // writes). Re-assert the current rate + style when turning on.
  const toggleOverride = () => {
    const next = !override;
    setOverride(next);
    onOverride && onOverride(next);
    if (next && nova) {
      if (freq > 0) {
        nova.setFrequency(freq);
        applyStyle(style);
      } else {
        send({ lLevel: 0, rLevel: 0 });
      }
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.openBtn} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={styles.openTxt}>🛠 Developer Tools ▾</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      <TouchableOpacity onPress={() => setOpen(false)} activeOpacity={0.8}>
        <Text style={styles.header}>🛠 Developer Tools ▴</Text>
      </TouchableOpacity>

      {showFrequency ? (
        <Check label="Override track flicker" on={override} onToggle={toggleOverride} />
      ) : null}
      <Text style={styles.label}>
        Flicker frequency · {freq <= 0 ? 'off (0 Hz)' : `${freq.toFixed(1)} Hz`}
      </Text>
      <Sld min={0} max={FREQ_MAX} step={0.5} val={freq} on={onFreq} />

      <Text style={styles.label}>Flicker style</Text>
      <View style={styles.styleGrid}>
        {STYLE_BUTTONS.map(([k, l]) => (
          <TouchableOpacity
            key={k}
            style={[styles.styleBtn, style === k && styles.styleBtnActive]}
            onPress={() => pickStyle(k)}
            activeOpacity={0.8}>
            <Text style={[styles.styleTxt, style === k && styles.styleTxtActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const Check = ({ label, on, onToggle }) => (
  <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.8}>
    <View style={[styles.checkBox, on && styles.checkBoxOn]}>
      {on ? <Text style={styles.checkMark}>✓</Text> : null}
    </View>
    <Text style={styles.checkLabel}>{label}</Text>
  </TouchableOpacity>
);

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
  header: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 12 },
  slider: { width: '100%', height: 36 },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  styleBtn: {
    width: '48%',
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: COLORS.bgCardLight,
    alignItems: 'center',
  },
  styleBtnActive: { backgroundColor: COLORS.accentBlue },
  styleTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  styleTxtActive: { color: '#fff' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 10 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: COLORS.accentBlueLight, borderColor: COLORS.accentBlueLight },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  checkLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', flex: 1 },
});
