import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';
import { BinauralEngine, bandFor } from '../audio/binauralEngine';

const BACKGROUNDS = ['none', 'white', 'pink', 'brown'];
const BG_LABEL = { none: 'None', white: 'White', pink: 'Pink', brown: 'Brown' };
const BANDS = ['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'];

export default function BinauralPanel() {
  const engineRef = useRef(null);
  const [beat, setBeat] = useState(10);
  const [volume, setVolume] = useState(0.8);
  const [background, setBackground] = useState('none');
  const [playing, setPlaying] = useState(false);

  // stop the engine if the user leaves this screen
  useEffect(() => () => engineRef.current && engineRef.current.stop(), []);

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new BinauralEngine();
    return engineRef.current;
  };

  const toggle = () => {
    const e = ensureEngine();
    if (playing) {
      e.stop();
      setPlaying(false);
    } else {
      e.start({ carrier: 200, beat, volume, background });
      setPlaying(true);
    }
  };

  const onBeat = v => {
    setBeat(v);
    if (playing) engineRef.current.setBeat(v);
  };
  const onVol = v => {
    setVolume(v);
    if (playing) engineRef.current.setVolume(v);
  };
  const onBg = bg => {
    setBackground(bg);
    if (playing) engineRef.current.setBackground(bg);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>🎧 Use headphones — binaural beats need a separate tone in each ear.</Text>

      <View style={styles.bandRow}>
        <Text style={styles.band}>{bandFor(beat)}</Text>
        <Text style={styles.beatVal}>{beat.toFixed(1)} Hz</Text>
      </View>
      <Slider
        minimumValue={0.5}
        maximumValue={40}
        step={0.5}
        value={beat}
        onValueChange={onBeat}
        minimumTrackTintColor={COLORS.accentBlue}
        maximumTrackTintColor={COLORS.bgCardLight}
        thumbTintColor="#fff"
        style={styles.slider}
      />
      <View style={styles.scaleRow}>
        {BANDS.map(b => (
          <Text key={b} style={[styles.scaleTxt, bandFor(beat) === b && styles.scaleTxtActive]}>
            {b}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>Background</Text>
      <View style={styles.bgRow}>
        {BACKGROUNDS.map(bg => (
          <TouchableOpacity
            key={bg}
            onPress={() => onBg(bg)}
            style={[styles.bgChip, background === bg && styles.bgChipActive]}>
            <Text style={[styles.bgChipTxt, background === bg && styles.bgChipTxtActive]}>{BG_LABEL[bg]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Volume</Text>
      <Slider
        minimumValue={0}
        maximumValue={1}
        value={volume}
        onValueChange={onVol}
        minimumTrackTintColor={COLORS.accentBlue}
        maximumTrackTintColor={COLORS.bgCardLight}
        thumbTintColor="#fff"
        style={styles.slider}
      />

      <TouchableOpacity style={[styles.playBtn, playing && styles.stopBtn]} onPress={toggle} activeOpacity={0.85}>
        <Text style={styles.playTxt}>{playing ? '■ Stop' : '▶ Play binaural'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 4 },
  hint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 18 },
  bandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  band: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  beatVal: { color: COLORS.accentBlueLight, fontSize: 18, fontWeight: '700' },
  slider: { width: '100%', height: 40, marginTop: 4 },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2, marginBottom: 8 },
  scaleTxt: { color: COLORS.textMuted, fontSize: 10 },
  scaleTxtActive: { color: COLORS.accentBlueLight, fontWeight: '700' },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  bgRow: { flexDirection: 'row', gap: 8 },
  bgChip: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.bgCard, alignItems: 'center' },
  bgChipActive: { backgroundColor: COLORS.accentBlue },
  bgChipTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  bgChipTxtActive: { color: '#fff' },
  playBtn: { backgroundColor: COLORS.accentGreen, borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 26 },
  stopBtn: { backgroundColor: COLORS.accentRed },
  playTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
