import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, Alert, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';
import { BinauralEngine, bandFor } from '../audio/binauralEngine';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { useNova } from '../nova/NovaProvider';
import NovaExplorer from './NovaExplorer';

const BACKGROUNDS = ['none', 'white', 'pink', 'brown'];
const BG_LABEL = { none: 'None', white: 'White', pink: 'Pink', brown: 'Brown' };
const BANDS = ['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'];

const NOVA_STATUS = {
  idle: 'Flickers light in sync with the beat',
  scanning: 'Searching for Nova…',
  connected: 'Connected',
  notfound: 'Not found — is it on and nearby?',
  error: 'Connection error',
  disconnected: 'Disconnected',
};

export default function BinauralPanel() {
  const engineRef = useRef(null);
  const nova = useNova();
  const [beat, setBeat] = useState(10);
  const [carrier, setCarrier] = useState(200);
  const [volume, setVolume] = useState(0.8);
  const [background, setBackground] = useState('none');
  const [playing, setPlaying] = useState(false);

  // stop audio + Nova strobe when leaving this screen (keep the Nova connection)
  useEffect(
    () => () => {
      if (engineRef.current) engineRef.current.stop();
      nova.stopStrobe();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new BinauralEngine();
    return engineRef.current;
  };

  const toggle = () => {
    const e = ensureEngine();
    if (playing) {
      e.stop();
      setPlaying(false);
      nova.stopStrobe();
    } else {
      e.start({ carrier, beat, volume, background });
      setPlaying(true);
      if (nova.connected) nova.startStrobe(beat);
    }
  };

  const onBeat = v => {
    setBeat(v);
    if (playing) engineRef.current.setBeat(v);
    if (nova.connected) nova.setFrequency(v);
  };
  const onCarrier = v => {
    setCarrier(v);
    if (playing) engineRef.current.setCarrier(v);
  };
  const onVol = v => {
    setVolume(v);
    if (playing) engineRef.current.setVolume(v);
  };
  const onBg = bg => {
    setBackground(bg);
    if (playing) engineRef.current.setBackground(bg);
  };

  const toggleNova = val => {
    if (val) {
      Alert.alert(
        '⚠️ Photosensitivity warning',
        `The Lumenate Nova flashes light. Flashing light can trigger seizures in people with photosensitive epilepsy. For safety the light is capped at ${MAX_NOVA_STROBE_HZ} Hz. Do not use if you (or anyone nearby who can see it) may be photosensitive, and stop immediately if you feel unwell.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I understand — connect',
            onPress: async () => {
              const ok = await nova.connect();
              if (ok && playing) nova.startStrobe(beat);
            },
          },
        ],
        { cancelable: true },
      );
    } else {
      nova.disconnect();
    }
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

      <Text style={styles.label}>Carrier · {Math.round(carrier)} Hz</Text>
      <Slider
        minimumValue={80}
        maximumValue={500}
        step={5}
        value={carrier}
        onValueChange={onCarrier}
        minimumTrackTintColor={COLORS.accentBlueLight}
        maximumTrackTintColor={COLORS.bgCardLight}
        thumbTintColor="#fff"
        style={styles.slider}
      />

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

      <View style={styles.novaRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.novaTitle}>Lumenate Nova (visual)</Text>
          <Text style={styles.novaSub}>{NOVA_STATUS[nova.status] || NOVA_STATUS.idle}</Text>
        </View>
        <Switch
          value={nova.connected}
          onValueChange={toggleNova}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>
      {nova.connected && beat > MAX_NOVA_STROBE_HZ ? (
        <Text style={styles.novaCap}>
          Light capped at {MAX_NOVA_STROBE_HZ} Hz for safety (audio beat stays {beat.toFixed(1)} Hz).
        </Text>
      ) : null}

      {nova.connected ? <NovaExplorer nova={nova} /> : null}

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
  novaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
  },
  novaTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  novaSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  novaCap: { color: COLORS.accentOrange, fontSize: 12, marginTop: 8 },
  playBtn: { backgroundColor: COLORS.accentGreen, borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  stopBtn: { backgroundColor: COLORS.accentRed },
  playTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
