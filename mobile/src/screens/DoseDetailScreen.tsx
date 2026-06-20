import React, { useState, useRef, useEffect } from 'react';
import { ScrollView, View, Text, Switch, TouchableOpacity, Pressable, StyleSheet, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, strengthColor } from '../theme';
import { doseById, imageSource, audioSource, isSynthDose } from '../catalog/data';
import ArtImage from '../components/ArtImage';
import BeatPeek from '../components/BeatPeek';
import StrengthBadge from '../components/StrengthBadge';
import NovaExplorer from '../components/NovaExplorer';
import { useNova } from '../nova/NovaProvider';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

const STRENGTH_MIN = 1;
const STRENGTH_MAX = 7;
// Tracks the Pulsetto provider's own ~10s scan window (+2s handshake buffer) so the
// "not found" prompt appears exactly when the scan gives up — not on an arbitrary timer.
const PULSETTO_SCAN_MS = 12000;

export default function DoseDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const dose = doseById(id);
  const nova = useNova();
  const pulsetto = usePulsetto();
  const [usePulse, setUsePulse] = useState(false); // off by default — flip on to pre-connect
  const [peek, setPeek] = useState(false);
  const trackDefault = dose && dose.strength != null ? dose.strength : 4;
  const [strength, setStrength] = useState(trackDefault);
  const [showStrength, setShowStrength] = useState(false);
  const scanTimerRef = useRef(null);
  const connectedRef = useRef(pulsetto.connected); // fresh value for the scan timeout closure
  connectedRef.current = pulsetto.connected;

  const clearScanTimer = () => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
  };
  // Connected (or screen unmounts) → drop any pending Pulsetto "not found" prompt.
  useEffect(() => {
    if (pulsetto.connected) clearScanTimer();
  }, [pulsetto.connected]);
  useEffect(() => () => clearScanTimer(), []);

  // Shared "device not found" dialog so both devices behave identically: scan runs,
  // and if it gives up we offer Retry / Cancel (Cancel flips the toggle back off).
  const promptRetry = (name, onRetry, onCancel) =>
    Alert.alert(
      `${name} not found`,
      `We couldn't find your ${name}. Make sure it's switched on and nearby, then retry.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: onCancel },
        { text: 'Retry', onPress: onRetry },
      ],
      { cancelable: false },
    );

  // Pulsetto: kick the provider's scan, then prompt once its scan window elapses
  // (no arbitrary wait — PULSETTO_SCAN_MS just tracks the provider's own ~10s scan,
  // plus a short handshake buffer).
  const tryPulsetto = () => {
    if (!pulsetto.connected && !pulsetto.scanning) pulsetto.scanForDevices();
    clearScanTimer();
    scanTimerRef.current = setTimeout(() => {
      scanTimerRef.current = null;
      if (connectedRef.current) return;
      promptRetry('Pulsetto', tryPulsetto, () => setUsePulse(false));
    }, PULSETTO_SCAN_MS);
  };

  // Nova: connect() resolves false when its own scan times out (~15s) — prompt then,
  // with the same Retry / Cancel dialog as Pulsetto.
  const tryNova = async () => {
    const ok = await nova.connect();
    if (!ok) promptRetry('Nova', tryNova, () => nova.disconnect());
  };

  // Mirror the Nova's connect-on-enable: flipping Pulsetto on kicks off a scan now,
  // so the device is already connected by the time you hit Start (no start-time delay).
  const onPulsetto = v => {
    if (IS_WEB) return nativeOnlyNotice('Pulsetto');
    setUsePulse(v);
    if (v) {
      if (!pulsetto.connected) tryPulsetto();
    } else {
      clearScanTimer();
    }
  };

  if (!dose) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>Program not found.</Text>
      </View>
    );
  }
  const img = imageSource(dose.image);

  const start = () => {
    // synth (.imedx) doses need no bundled MP3 — only legacy doses can be "not in this build"
    if (!isSynthDose(dose) && !audioSource(dose.audio)) {
      Alert.alert(
        'Not in this build',
        `"${dose.name}" isn't bundled in this local build yet. A few demo tracks ship in the app for now — streaming comes later.`,
      );
      return;
    }
    navigation.navigate('Player', {
      id: dose.id,
      usePulsetto: usePulse,
      useNova: nova.connected,
      strength, // chosen base strength (may differ from the track default)
    });
  };

  const toggleNova = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (val) {
      Alert.alert(
        '⚠️ Photosensitivity warning',
        `The Lumenate Nova flashes light. Flashing light can trigger seizures in people with photosensitive epilepsy. The light is capped at ${MAX_NOVA_STROBE_HZ} Hz. Do not use if you (or anyone nearby who can see it) may be photosensitive, and stop immediately if you feel unwell.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'I understand — connect', onPress: () => tryNova() },
        ],
        { cancelable: true },
      );
    } else {
      nova.disconnect();
    }
  };

  const novaSub =
    nova.status === 'scanning'
      ? 'Searching for Nova…'
      : nova.status === 'connected'
      ? 'Connected — light follows the session'
      : nova.status === 'notfound'
      ? 'Not found — is it on and nearby?'
      : nova.status === 'error'
      ? 'Connection error'
      : 'Visual light entrainment';

  const pulseSub = !usePulse
    ? 'Vagus nerve stimulation alongside the audio'
    : pulsetto.connected
    ? 'Connected — ready to start'
    : pulsetto.scanning
    ? 'Searching for Pulsetto…'
    : 'Not found — is it on and nearby?';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onLongPress={() => setPeek(true)} delayLongPress={300}>
        <ArtImage source={img} height={220} radius={18} hpad={16} />
      </Pressable>
      <BeatPeek visible={peek} onClose={() => setPeek(false)} dose={dose} image={img} />
      <Text style={styles.title}>{dose.name}</Text>
      <View style={styles.metaRow}>
        {dose.strength != null ? (
          <TouchableOpacity onPress={() => setShowStrength(s => !s)} activeOpacity={0.7}>
            <StrengthBadge
              strength={strength}
              label={strength === trackDefault ? dose.strengthLabel : 'Adjusted'}
            />
          </TouchableOpacity>
        ) : null}
        {dose.lengthDisplay ? <Text style={styles.duration}>{dose.lengthDisplay}</Text> : null}
      </View>

      {showStrength ? (
        <View style={styles.strengthCard}>
          <View style={styles.strengthHead}>
            <Text style={styles.strengthTitle}>Session strength</Text>
            <Text style={[styles.strengthVal, { color: strengthColor(strength) }]}>{strength}</Text>
          </View>
          <Slider
            minimumValue={STRENGTH_MIN}
            maximumValue={STRENGTH_MAX}
            step={1}
            value={strength}
            onValueChange={setStrength}
            minimumTrackTintColor={strengthColor(strength)}
            maximumTrackTintColor={COLORS.bgCardLight}
            thumbTintColor="#fff"
            style={styles.strengthSlider}
          />
          <View style={styles.strengthScale}>
            {Array.from({ length: STRENGTH_MAX - STRENGTH_MIN + 1 }, (_, i) => i + STRENGTH_MIN).map(n => (
              <Text
                key={n}
                style={[
                  styles.scaleTick,
                  n === trackDefault && styles.scaleTickDefault,
                  n === strength && styles.scaleTickActive,
                ]}>
                {n}
              </Text>
            ))}
          </View>
          <Text style={styles.strengthHint}>
            Track default is {trackDefault}. Turn it down if it's too intense — the session's relative
            stim steps (=, −, +) still apply, just around your chosen level.
          </Text>
        </View>
      ) : null}

      {dose.description ? <Text style={styles.desc}>{dose.description}</Text> : null}

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Use Pulsetto</Text>
          <Text style={styles.toggleSub}>{pulseSub}</Text>
        </View>
        <Switch
          value={usePulse}
          onValueChange={onPulsetto}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Use Lumenate Nova</Text>
          <Text style={styles.toggleSub}>{novaSub}</Text>
        </View>
        <Switch
          value={nova.connected}
          onValueChange={toggleNova}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>
      {nova.connected ? <NovaExplorer nova={nova} showFrequency /> : null}

      <TouchableOpacity style={styles.startBtn} activeOpacity={0.85} onPress={start}>
        <Text style={styles.startTxt}>Start</Text>
      </TouchableOpacity>

      {IS_WEB && isSynthDose(dose) ? (
        <TouchableOpacity style={styles.studioBtn} activeOpacity={0.85}
          onPress={() => navigation.navigate('Studio', { load: dose.id })}>
          <Text style={styles.studioTxt}>Open in Studio</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 40 },
  muted: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  hero: { width: '100%', height: 220, borderRadius: 18, backgroundColor: COLORS.bgCardLight },
  heroEmpty: { borderWidth: 1, borderColor: COLORS.divider },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  duration: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  desc: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 14 },
  strengthCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 14, marginTop: 12 },
  strengthHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  strengthTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700' },
  strengthVal: { fontSize: 18, fontWeight: '800' },
  strengthSlider: { width: '100%', height: 36, marginTop: 6 },
  strengthScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  scaleTick: { color: COLORS.textMuted, fontSize: 11, fontWeight: '600' },
  scaleTickDefault: { color: COLORS.textSecondary, textDecorationLine: 'underline' },
  scaleTickActive: { color: COLORS.textPrimary, fontWeight: '800' },
  strengthHint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 10 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
  },
  toggleTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  toggleSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  startBtn: { backgroundColor: COLORS.accentGreen, borderRadius: 30, paddingVertical: 18, alignItems: 'center', marginTop: 24 },
  startTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
  studioBtn: { borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: COLORS.divider },
  studioTxt: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '700' },
});
