import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, Alert, StyleSheet } from 'react-native';
import KeepAwake from 'react-native-keep-awake';
import { COLORS } from '../theme';
import { BinauralEngine } from '../audio/binauralEngine';
import { carrierColor, carrierColorVibrant, bandFor } from '../shared/entrainment';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { useNova } from '../nova/NovaProvider';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { useLightpad } from '../lightpad/LightpadProvider';
import { useSessions } from '../wellness/SessionsProvider';
import { LP_COLS, LP_ROWS, LP_BEND_PER_COL, decodeCell } from '../shared/lightpadGrid';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

// Field Meditation Mode — an immersive, eyes-closed frame around the Manual
// engine. Wearing beats + Nova (light) + Pulsetto, you "feel around" a ROLI
// Lightpad Block and one touch moves the whole *field*:
//   left↔right (glide) → carrier frequency
//   up↔down    (slide) → beat / flash rate
//   press (Z)          → field intensity: volume + light brightness + gentle stim
//
// PUSH + HEAD (Nova accelerometer): while you're actively pressing on the block,
// your head takes over the light rhythm (the block has no motion sensor, the Nova
// does):
//   head pitch (look up/down) → flash + beat rate for BOTH eyes (down ≈ 0.5 Hz,
//                               far up ≈ 40 Hz)
//   head roll  (tilt L/R)     → flash balance: centred = both in sync; lean left
//                               slows the left eye toward stop, lean right the
//                               right eye.
// These engage only during a firm press; carrier (X) and loudness (Z) keep
// working. Lift and the rhythm returns to your touch position.
const CARR_MIN = 80, CARR_MAX = 500; // full carrier sweep across the pad's width
const BEAT_MIN = 1, BEAT_MAX = 40; // beat / flash-rate sweep across its height
const FIELD_PULSE_INTENSITY = 4; // Pulsetto session base (1–9)
// Head control (tune on device — accelerometer sign depends on how the Nova sits):
const PUSH_THRESHOLD = 40; // pressure (0–127) above which head control engages
const PITCH_DOWN_DEG = -40, PITCH_UP_DEG = 40; // head-pitch span → rate 0.5…40 Hz
const ROLL_MAX_DEG = 35; // head-roll span → full left/right flash balance
const FIELD_PITCH_SIGN = 1; // flip to -1 if looking up slows instead of speeds
const FIELD_ROLL_SIGN = 1; // flip to -1 if leaning left slows the wrong eye
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mapRange = (v, inA, inB, outA, outB) => outA + ((v - inA) / ((inB - inA) || 1)) * (outB - outA);
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

export default function FieldScreen() {
  const nova = useNova();
  const pulsetto = usePulsetto();
  const lightpad = useLightpad();
  const sessions = useSessions();

  const [carrier, setCarrier] = useState(200);
  const [beat, setBeat] = useState(10);
  const [intensity, setIntensity] = useState(0.7); // 0..1 field intensity (volume/brightness)
  const [timerMin, setTimerMin] = useState(15);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [pushing, setPushing] = useState(false); // for the UI cue

  const engineRef = useRef(null);
  const runningRef = useRef(false);
  runningRef.current = running;

  // Lightpad decode state: base cell + fine bend/slide offsets (see Manual mode).
  const colRef = useRef(2);
  const rowRef = useRef(2);
  const bendRef = useRef(0);
  const slideRef = useRef(0);
  const yBeatRef = useRef(10); // last touch-derived beat (restored when a push ends)
  const pushingRef = useRef(false);
  const headRef = useRef(null); // latest { pitch, roll } sample
  const uiRef = useRef(0);
  const novaBrightRef = useRef(0);
  const pulseRef = useRef(0);

  // Timer / goal tracking.
  const endRef = useRef(0);
  const startRef = useRef(null); // { time, plannedSeconds }
  const tickRef = useRef(null);

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new BinauralEngine();
    return engineRef.current;
  };

  const uiTick = fn => {
    const now = Date.now();
    if (now - uiRef.current > 66) { uiRef.current = now; fn(); }
  };
  const throttle = (ref, ms, fn) => {
    const now = Date.now();
    if (now - ref.current > ms) { ref.current = now; fn(); }
  };

  // Slow "breathing" of the field orb — calm, not at the beat rate (a screen
  // flashing at the beat would be both useless and seizure-adjacent).
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const logIfCounted = () => {
    if (!startRef.current || !sessions) return;
    const planned = startRef.current.plannedSeconds;
    const actual = Math.min(planned, Math.round((Date.now() - startRef.current.time) / 1000));
    sessions.logSession({
      plannedSeconds: planned,
      actualSeconds: actual,
      strength: pulsetto.connected ? FIELD_PULSE_INTENSITY : null,
      kind: 'field',
    });
    startRef.current = null;
  };

  // Tear down on unmount (leaving the screen ends + logs the session).
  useEffect(
    () => () => {
      logIfCounted();
      if (tickRef.current) clearInterval(tickRef.current);
      try { engineRef.current?.stop(); } catch (e) {}
      try { nova.stopStrobe(); } catch (e) {}
      if (pulsetto.sessionActive) { try { pulsetto.stopSession(); } catch (e) {} }
      KeepAwake.deactivate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Lightpad → carrier (X) always; beat (Y) only when NOT pushing (a firm press
  // hands the rhythm to the head). Press → field intensity + the push gate.
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const applyField = () => {
      const xN = clamp((colRef.current + bendRef.current) / (LP_COLS - 1), 0, 1);
      const c = CARR_MIN + xN * (CARR_MAX - CARR_MIN);
      if (runningRef.current && engineRef.current) engineRef.current.glideCarrier(c, 0.12);
      const yN = clamp((rowRef.current + slideRef.current) / (LP_ROWS - 1), 0, 1);
      const b = BEAT_MIN + yN * (BEAT_MAX - BEAT_MIN);
      yBeatRef.current = b;
      if (!pushingRef.current) {
        if (runningRef.current && engineRef.current) engineRef.current.glideBeat(b, 0.12);
        if (runningRef.current && nova.connected) nova.setFrequency(b);
        uiTick(() => setBeat(Math.round(b * 10) / 10));
      }
      uiTick(() => setCarrier(Math.round(c)));
    };
    const endPush = () => {
      if (!pushingRef.current) return;
      pushingRef.current = false;
      setPushing(false);
      if (runningRef.current && nova.connected) { nova.setBalance(0); nova.setFrequency(yBeatRef.current); }
      if (runningRef.current && engineRef.current) engineRef.current.glideBeat(yBeatRef.current, 0.25);
    };
    lightpad.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        colRef.current = col; rowRef.current = row; bendRef.current = 0; slideRef.current = 0;
        applyField();
      } else if (ev.type === 'pitchBend') {
        bendRef.current = ev.value / LP_BEND_PER_COL; // glide → carrier columns (X)
        applyField();
      } else if (ev.type === 'cc' && ev.controller === 74) {
        slideRef.current = ((ev.value - 63) / 63) * (LP_ROWS - 1); // slide → beat rows (Y)
        applyField();
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        const i = clamp(mapRange(ev.value, 0, 127, 0.2, 1), 0.2, 1); // press → field intensity
        if (runningRef.current && engineRef.current) engineRef.current.setVolume(i);
        if (runningRef.current && nova.connected) throttle(novaBrightRef, 120, () => nova.setMasterBrightness(i));
        if (runningRef.current && pulsetto.sessionActive) {
          throttle(pulseRef, 1000, () => pulsetto.setIntensity(Math.round(mapRange(i, 0.2, 1, 2, 6))));
        }
        uiTick(() => setIntensity(i));
        // Push gate: a firm press hands the flash rhythm to the head.
        const nowPushing = ev.value >= PUSH_THRESHOLD;
        if (nowPushing && !pushingRef.current) { pushingRef.current = true; setPushing(true); }
        else if (!nowPushing) endPush();
      } else if (ev.type === 'noteOff') {
        endPush();
      }
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  // Nova head motion → light rhythm, but only while pushing on the block.
  useEffect(() => {
    if (!running || !nova.connected || !nova.setMotionListener) return;
    nova.setTelemetryRate(1); // wake the accelerometer stream
    const applyHead = () => {
      if (!pushingRef.current || !runningRef.current) return;
      const s = headRef.current;
      if (!s) return;
      const rate = clamp(
        mapRange(FIELD_PITCH_SIGN * s.pitch, PITCH_DOWN_DEG, PITCH_UP_DEG, BEAT_MIN, BEAT_MAX),
        BEAT_MIN, BEAT_MAX,
      );
      const bal = clamp((FIELD_ROLL_SIGN * s.roll) / ROLL_MAX_DEG, -1, 1);
      nova.setFrequency(rate); // both eyes' base rate (balance biases per eye)
      nova.setBalance(bal);
      if (engineRef.current) engineRef.current.glideBeat(rate, 0.15);
      uiTick(() => setBeat(Math.round(rate * 10) / 10));
    };
    nova.setMotionListener(s => { headRef.current = s; applyHead(); });
    return () => { try { nova.setMotionListener(null); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, nova.connected]);

  const start = async () => {
    const e = ensureEngine();
    e.start({ carrier, beat, volume: intensity, background: 'none' });
    e.fadeIn(1.2); // ease into the field
    if (nova.connected) { nova.startStrobe(beat); nova.setMasterBrightness(intensity); nova.setBalance(0); }
    if (pulsetto.connected) { try { await pulsetto.startSession(FIELD_PULSE_INTENSITY); } catch (er) {} }
    startRef.current = { time: Date.now(), plannedSeconds: timerMin * 60 };
    endRef.current = Date.now() + timerMin * 60 * 1000;
    setRemaining(timerMin * 60);
    setRunning(true);
    KeepAwake.activate();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const rem = Math.round((endRef.current - Date.now()) / 1000);
      setRemaining(Math.max(0, rem));
      if (rem <= 0) stop();
    }, 1000);
  };

  const stop = async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    logIfCounted();
    const eng = engineRef.current;
    if (eng) {
      try { eng.fadeOut(1.0); } catch (e) {}
      setTimeout(() => { try { eng.stop(); } catch (e) {} }, 1050);
    }
    try { nova.stopStrobe(); } catch (e) {}
    if (pulsetto.sessionActive) { try { await pulsetto.stopSession(); } catch (e) {} }
    pushingRef.current = false;
    setPushing(false);
    setRunning(false);
    setRemaining(0);
    KeepAwake.deactivate();
  };

  // Device connect toggles (mirror Manual's, minus the sliders).
  const toggleLightpad = () => {
    if (IS_WEB) return nativeOnlyNotice('Lightpad Block');
    lightpad.connected ? lightpad.disconnect() : lightpad.connect();
  };
  const togglePulsetto = () => {
    if (IS_WEB) return nativeOnlyNotice('Pulsetto');
    if (pulsetto.connected) pulsetto.disconnect();
    else if (!pulsetto.scanning) pulsetto.scanForDevices();
  };
  const toggleNova = () => {
    if (IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (nova.connected) { nova.disconnect(); return; }
    Alert.alert(
      '⚠️ Photosensitivity warning',
      `The Lumenate Nova flashes light, which can trigger seizures in people with photosensitive epilepsy. Capped at ${MAX_NOVA_STROBE_HZ} Hz. Don't use if you (or anyone who can see it) may be photosensitive; stop if you feel unwell.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I understand — connect', onPress: async () => { const ok = await nova.connect(); if (ok && runningRef.current) nova.startStrobe(beat); } },
      ],
      { cancelable: true },
    );
  };

  const core = carrierColorVibrant(carrier);
  const halo = carrierColor(carrier);
  const orbScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const haloOpacity = 0.2 + 0.55 * intensity;
  const band = bandFor(beat);

  const Chip = ({ label, on, onPress, hint }: any) => (
    <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.chipDot, on && styles.chipDotOn]}>●</Text>
      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{label}</Text>
      {hint ? <Text style={styles.chipHint}>{hint}</Text> : null}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Setup — hidden once you enter the field for a clean, dark space. */}
      {!running ? (
        <View style={styles.setup}>
          <Text style={styles.setupTitle}>Wear your devices, set a time, then feel around the block.</Text>
          <View style={styles.chips}>
            <Chip label="Beats" on hint="always on" />
            <Chip label="Lightpad" on={lightpad.connected} onPress={toggleLightpad}
              hint={IS_WEB ? 'app only' : lightpad.connected ? 'the field controller' : lightpad.status === 'scanning' ? 'searching…' : 'tap to connect'} />
            <Chip label="Light" on={nova.connected} onPress={toggleNova}
              hint={IS_WEB ? 'app only' : nova.connected ? 'Nova · head control' : 'tap to connect'} />
            <Chip label="Stim" on={pulsetto.connected} onPress={togglePulsetto}
              hint={IS_WEB ? 'app only' : pulsetto.connected ? 'Pulsetto' : pulsetto.scanning ? 'searching…' : 'tap to connect'} />
          </View>
          <View style={styles.timerRow}>
            <TouchableOpacity style={styles.timerBtn} onPress={() => setTimerMin(m => Math.max(1, m - 5))}>
              <Text style={styles.timerBtnTxt}>−</Text>
            </TouchableOpacity>
            <Text style={styles.timerVal}>{timerMin} min</Text>
            <TouchableOpacity style={styles.timerBtn} onPress={() => setTimerMin(m => Math.min(120, m + 5))}>
              <Text style={styles.timerBtnTxt}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.setupRunning}>
          <Text style={styles.countdown}>{fmtTime(remaining)}</Text>
          {pushing ? <Text style={styles.pushCue}>◉ head control — pitch = rate · roll = balance</Text> : null}
        </View>
      )}

      {/* The field. */}
      <View style={styles.stage}>
        <Animated.View style={[styles.halo, { backgroundColor: halo, opacity: haloOpacity, transform: [{ scale: orbScale }] }]} />
        <Animated.View style={[styles.orb, { backgroundColor: core, shadowColor: core, transform: [{ scale: orbScale }] }]} />
        <View style={styles.readout} pointerEvents="none">
          <Text style={styles.carrierTxt}>{Math.round(carrier)} Hz</Text>
          <Text style={styles.beatTxt}>{beat.toFixed(1)} Hz · {band}</Text>
        </View>
      </View>

      <Text style={styles.hint}>
        {IS_WEB
          ? 'Field visuals + audio preview. Connect a Lightpad on the phone to steer it.'
          : lightpad.connected
          ? running
            ? nova.connected
              ? '← → carrier   ↑ ↓ beat   press = intensity   ·   push + move head: pitch = rate, roll = balance'
              : '← → carrier   ↑ ↓ beat   press = intensity   · lift to rest'
            : 'Ready — press Enter, then feel around the Lightpad.'
          : 'Connect a Lightpad Block above to steer the field by touch.'}
      </Text>

      <TouchableOpacity style={[styles.enterBtn, running && styles.restBtn]} activeOpacity={0.85} onPress={running ? stop : start}>
        <Text style={styles.enterTxt}>{running ? 'Rest' : 'Enter the field'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070A0F', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  setup: { minHeight: 150 },
  setupRunning: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  setupTitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111722', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1B2430' },
  chipOn: { borderColor: COLORS.accentBlue, backgroundColor: '#12202E' },
  chipDot: { color: '#3A4658', fontSize: 10, marginRight: 6 },
  chipDotOn: { color: COLORS.accentGreen },
  chipTxt: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: COLORS.textPrimary },
  chipHint: { color: COLORS.textMuted, fontSize: 11, marginLeft: 6 },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, gap: 18 },
  timerBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#141C28', alignItems: 'center', justifyContent: 'center' },
  timerBtnTxt: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '700' },
  timerVal: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', minWidth: 84, textAlign: 'center' },
  countdown: { color: COLORS.textPrimary, fontSize: 34, fontWeight: '800', letterSpacing: 1 },
  pushCue: { color: COLORS.accentGreen, fontSize: 12, fontWeight: '600', marginTop: 6 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 300, height: 300, borderRadius: 150 },
  orb: {
    width: 180, height: 180, borderRadius: 90,
    shadowOpacity: 0.8, shadowRadius: 40, shadowOffset: { width: 0, height: 0 }, elevation: 12,
  },
  readout: { position: 'absolute', alignItems: 'center' },
  carrierTxt: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', opacity: 0.92 },
  beatTxt: { color: '#E6EDF5', fontSize: 14, fontWeight: '600', opacity: 0.8, marginTop: 2 },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 14, minHeight: 34 },
  enterBtn: { backgroundColor: COLORS.accentBlue, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  restBtn: { backgroundColor: '#243042' },
  enterTxt: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
});
