import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Switch, Alert, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import KeepAwake from 'react-native-keep-awake';
import { COLORS } from '../theme';
import { BinauralEngine, bandFor } from '../audio/binauralEngine';
import { carrierColor } from '../shared/entrainment';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { useNova } from '../nova/NovaProvider';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { useSessions } from '../wellness/SessionsProvider';
import NovaExplorer from '../components/NovaExplorer';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

// Unified Manual mode: one screen, one Start/Stop that runs audio (binaural +
// noise) plus — when connected — Lumenate Nova light and Pulsetto stim together,
// on a session timer. A finished session is logged to the shared store, so the
// home-screen weekly tracker shows the check. BLE devices are native-only; on
// web their sections are disabled with a hint to get the app.
const BACKGROUNDS = ['none', 'white', 'pink', 'brown'];
const BG_LABEL = { none: 'None', white: 'White', pink: 'Pink', brown: 'Brown' };
const BANDS = ['Delta', 'Theta', 'Alpha', 'Beta', 'Gamma'];

const fmtTime = sec => {
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

export default function ManualScreen() {
  const nova = useNova();
  const pulsetto = usePulsetto();
  const sessions = useSessions();
  const engineRef = useRef(null);
  const endRef = useRef(0);
  const tickRef = useRef(null);
  const startRef = useRef(null); // { time, plannedSeconds }
  const novaOverrideRef = useRef(false);

  const [beat, setBeat] = useState(10);
  const [carrier, setCarrier] = useState(200);
  const [noise, setNoise] = useState('none');
  const [volume, setVolume] = useState(0.8);
  const [intensity, setIntensity] = useState(5);
  const [lumi, setLumi] = useState(100);
  const [timerMin, setTimerMin] = useState(10);
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new BinauralEngine();
    return engineRef.current;
  };

  useEffect(
    () => () => {
      try { engineRef.current?.stop(); } catch (e) {}
      try { nova.stopStrobe(); } catch (e) {}
      if (tickRef.current) clearInterval(tickRef.current);
      KeepAwake.deactivate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const logIfCounted = () => {
    if (!startRef.current || !sessions) return;
    const planned = startRef.current.plannedSeconds;
    const actual = Math.min(planned, Math.round((Date.now() - startRef.current.time) / 1000));
    sessions.logSession({
      plannedSeconds: planned,
      actualSeconds: actual,
      strength: pulsetto.connected ? intensity : null,
      kind: 'manual',
    });
    startRef.current = null;
  };

  const stop = async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { engineRef.current?.stop(); } catch (e) {}
    try { nova.stopStrobe(); } catch (e) {}
    if (pulsetto.sessionActive) { try { await pulsetto.stopSession(); } catch (e) {} }
    logIfCounted();
    setRunning(false);
    setRemaining(0);
    KeepAwake.deactivate();
  };

  const start = async () => {
    const e = ensureEngine();
    e.start({ carrier, beat, volume, background: noise });
    if (nova.connected) nova.startStrobe(beat);
    if (pulsetto.connected) { try { await pulsetto.startSession(intensity); } catch (er) {} }
    startRef.current = { time: Date.now(), plannedSeconds: timerMin * 60 };
    endRef.current = Date.now() + timerMin * 60 * 1000;
    setRemaining(timerMin * 60);
    setRunning(true);
    KeepAwake.activate();
    tickRef.current = setInterval(() => {
      const rem = Math.round((endRef.current - Date.now()) / 1000);
      setRemaining(Math.max(0, rem));
      if (rem <= 0) stop();
    }, 1000);
  };

  // live controls
  const onBeat = v => {
    setBeat(v);
    if (running) engineRef.current?.setBeat(v);
    if (nova.connected && !novaOverrideRef.current) nova.setFrequency(v);
  };
  const onCarrier = v => { setCarrier(v); if (running) engineRef.current?.setCarrier(v); };
  const onNoise = v => { setNoise(v); if (running) engineRef.current?.setBackground(v); };
  const onVol = v => { setVolume(v); if (running) engineRef.current?.setVolume(v); };
  const onIntensity = v => { setIntensity(v); if (running && pulsetto.connected) pulsetto.setIntensity(v); };
  const onLumi = v => { setLumi(v); nova.setMasterBrightness(v / 100); };

  const togglePulsetto = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Pulsetto');
    if (val) {
      if (!pulsetto.connected && !pulsetto.scanning) pulsetto.scanForDevices();
    } else {
      pulsetto.disconnect();
    }
  };

  const toggleNova = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (val) {
      Alert.alert(
        '⚠️ Photosensitivity warning',
        `The Lumenate Nova flashes light, which can trigger seizures in people with photosensitive epilepsy. Capped at ${MAX_NOVA_STROBE_HZ} Hz. Don't use if you (or anyone who can see it) may be photosensitive; stop if you feel unwell.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'I understand — connect', onPress: async () => { const ok = await nova.connect(); if (ok && running) nova.startStrobe(beat); } },
        ],
        { cancelable: true },
      );
    } else {
      nova.disconnect();
    }
  };

  const novaSub =
    nova.status === 'scanning' ? 'Searching…'
      : nova.connected ? 'Connected — flickers with the beat'
      : nova.status === 'notfound' ? 'Not found — is it on and nearby?'
      : 'Light entrainment in sync with the beat';
  const pulseSub = pulsetto.connected ? 'Connected' : pulsetto.scanning ? 'Searching…' : 'Vagus nerve stimulation';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>🎧 Use headphones — binaural beats need a separate tone in each ear.</Text>

      {/* AUDIO */}
      <View style={styles.card}>
        <View style={styles.bandRow}>
          <Text style={styles.band}>{bandFor(beat)}</Text>
          <Text style={styles.beatVal}>{beat.toFixed(1)} Hz</Text>
        </View>
        <Slider minimumValue={0.5} maximumValue={40} step={0.5} value={beat} onValueChange={onBeat}
          minimumTrackTintColor={COLORS.accentBlue} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" style={styles.slider} />
        <View style={styles.scaleRow}>
          {BANDS.map(b => (
            <Text key={b} style={[styles.scaleTxt, bandFor(beat) === b && styles.scaleTxtOn]}>{b}</Text>
          ))}
        </View>

        <Text style={[styles.label, { color: carrierColor(carrier) }]}>Carrier · {Math.round(carrier)} Hz</Text>
        <Slider minimumValue={80} maximumValue={500} step={5} value={carrier} onValueChange={onCarrier}
          minimumTrackTintColor={carrierColor(carrier)} maximumTrackTintColor={COLORS.bgCardLight}
          thumbTintColor={carrierColor(carrier)} style={styles.slider} />

        <Text style={styles.label}>Background noise</Text>
        <View style={styles.chips}>
          {BACKGROUNDS.map(bg => (
            <TouchableOpacity key={bg} onPress={() => onNoise(bg)} style={[styles.chip, noise === bg && styles.chipOn]}>
              <Text style={[styles.chipTxt, noise === bg && styles.chipTxtOn]}>{BG_LABEL[bg]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Volume</Text>
        <Slider minimumValue={0} maximumValue={1} value={volume} onValueChange={onVol}
          minimumTrackTintColor={COLORS.accentBlue} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" style={styles.slider} />
      </View>

      {/* LIGHT — Lumenate Nova */}
      <View style={styles.card}>
        <View style={styles.deviceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceTitle}>Lumenate Nova</Text>
            <Text style={styles.deviceSub}>{IS_WEB ? 'Light entrainment — in the app' : novaSub}</Text>
          </View>
          <Switch value={nova.connected} disabled={IS_WEB} onValueChange={toggleNova}
            trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }} thumbColor="#fff" />
        </View>
        {nova.connected ? (
          <>
            <Text style={styles.label}>Brightness · {Math.round(lumi)}%</Text>
            <Slider minimumValue={0} maximumValue={100} value={lumi} onValueChange={onLumi}
              minimumTrackTintColor={COLORS.accentBlueLight} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" style={styles.slider} />
            <NovaExplorer nova={nova} showFrequency onOverride={v => { novaOverrideRef.current = v; }} />
          </>
        ) : null}
      </View>

      {/* STIM — Pulsetto */}
      <View style={styles.card}>
        <View style={styles.deviceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceTitle}>Pulsetto</Text>
            <Text style={styles.deviceSub}>
              {IS_WEB ? 'Vagus nerve stimulation — in the app' : pulseSub}
              {!IS_WEB && pulsetto.connected && pulsetto.battery != null ? ` · ${pulsetto.battery}%` : ''}
            </Text>
          </View>
          <Switch value={pulsetto.connected} disabled={IS_WEB} onValueChange={togglePulsetto}
            trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }} thumbColor="#fff" />
        </View>
        {!IS_WEB && pulsetto.connected ? (
          <>
            <Text style={styles.label}>Intensity · {intensity}</Text>
            <Slider minimumValue={1} maximumValue={9} step={1} value={intensity} onValueChange={onIntensity}
              minimumTrackTintColor={COLORS.accentBlue} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" style={styles.slider} />
          </>
        ) : null}
      </View>

      {/* TIMER + master Start/Stop */}
      <View style={styles.card}>
        <Text style={styles.label}>Session timer</Text>
        <View style={styles.timerRow}>
          <TouchableOpacity style={styles.timerBtn} disabled={running} onPress={() => setTimerMin(m => Math.max(1, m - 1))}>
            <Text style={[styles.timerBtnTxt, running && styles.dim]}>−</Text>
          </TouchableOpacity>
          <Text style={styles.timerVal}>{running ? fmtTime(remaining) : fmtTime(timerMin * 60)}</Text>
          <TouchableOpacity style={styles.timerBtn} disabled={running} onPress={() => setTimerMin(m => m + 1)}>
            <Text style={[styles.timerBtnTxt, running && styles.dim]}>+</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.startBtn, running && styles.stopBtn]} activeOpacity={0.85} onPress={running ? stop : start}>
          <Text style={styles.startTxt}>{running ? '■ Stop' : '▶ Start'}</Text>
        </TouchableOpacity>
        <Text style={styles.runHint}>
          Start runs the audio{!IS_WEB ? ' + any connected devices' : ''} together; finishing the timer logs a session toward your daily goal.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 40 },
  hint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 14 },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 16, marginBottom: 14 },
  bandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  band: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  beatVal: { color: COLORS.accentBlueLight, fontSize: 18, fontWeight: '700' },
  slider: { width: '100%', height: 40, marginTop: 4 },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2, marginBottom: 4 },
  scaleTxt: { color: COLORS.textMuted, fontSize: 10 },
  scaleTxtOn: { color: COLORS.accentBlueLight, fontWeight: '700' },
  label: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.bgCardLight, alignItems: 'center' },
  chipOn: { backgroundColor: COLORS.accentBlue },
  chipTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: '#fff' },
  deviceRow: { flexDirection: 'row', alignItems: 'center' },
  deviceTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  deviceSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 6 },
  timerBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.bgCardLight, alignItems: 'center', justifyContent: 'center' },
  timerBtnTxt: { color: COLORS.textPrimary, fontSize: 30, fontWeight: '300' },
  dim: { opacity: 0.3 },
  timerVal: { color: COLORS.textPrimary, fontSize: 44, fontWeight: '700', marginHorizontal: 28, fontVariant: ['tabular-nums'] },
  startBtn: { backgroundColor: COLORS.accentGreen, borderRadius: 30, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  stopBtn: { backgroundColor: COLORS.accentRed },
  startTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
  runHint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
