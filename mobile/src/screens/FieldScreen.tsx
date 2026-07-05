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
// Lightpad Block; one touch moves the whole *field*:
//   left↔right (glide) → carrier frequency
//   up↔down    (slide) → beat / flash rate
//   press (Z)          → field intensity: volume + light brightness + gentle stim
//
// PRESS-TO-ENGAGE HEAD CONTROL (the block has no motion sensor — the Nova does):
// while you are actively pressing, you can EITHER drag your finger (carrier/beat
// as usual) OR move your head to sculpt the LIGHT:
//   head pitch (up/down) → common flash rate for both eyes (0.5 Hz … max)
//   head roll  (tilt L/R) → slows the LED bank you lean toward (per-eye rate);
//                           the other side keeps its rate
// The light decouples from the audio beat while you do this; the audio only
// *bends subtly* (a small beat/carrier nudge) so the head move feels like an
// effect. Everything PERSISTS after you release — you've set the light. Dragging
// your finger keeps steering carrier/beat throughout.
const CARR_MIN = 80, CARR_MAX = 500; // carrier sweep across the pad width
const BEAT_MIN = 1, BEAT_MAX = 40; // touch beat / audio range
const LIGHT_RATE_MIN = 0.5, LIGHT_RATE_MAX = 40; // head-driven flash-rate range
const FIELD_PULSE_INTENSITY = 4; // Pulsetto session base (1–9)
const PUSH_THRESHOLD = 40; // pressure (0–127) above which head control engages
const HEAD_PITCH_SPAN = 40, HEAD_ROLL_SPAN = 35; // degrees of head travel for full swing
const HEAD_DEADZONE = 4; // degrees before head control engages (ignore jitter)
const BEAT_BEND = 2.5, CARR_BEND = 6; // subtle, persistent audio bend (Hz) from head
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
  const [beat, setBeat] = useState(10); // shown value: audio beat, or light rate while head-driven
  const [intensity, setIntensity] = useState(0.7);
  const [timerMin, setTimerMin] = useState(15);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [pushing, setPushing] = useState(false);

  const engineRef = useRef(null);
  const runningRef = useRef(false);
  runningRef.current = running;

  // Lightpad decode + field state.
  const colRef = useRef(2);
  const rowRef = useRef(2);
  const bendRef = useRef(0);
  const slideRef = useRef(0);
  const carrierBaseRef = useRef(200); // finger-derived carrier before head bend
  const yBeatRef = useRef(10); // finger-derived beat before head bend
  const beatBendRef = useRef(0); // persistent subtle audio-beat bend from head
  const carrierBendRef = useRef(0); // persistent subtle carrier bend from head
  const pushingRef = useRef(false);
  // Light rhythm (may be head-driven, decoupled from the audio beat, and persists).
  const lightHeadRef = useRef(false); // has the head taken over the light this session?
  const lightRateRef = useRef(10);
  const balanceRef = useRef(0);
  const centerRef = useRef({ pitch: 0, roll: 0 }); // head pose captured at push-engage
  const anchorRateRef = useRef(10); // light rate at push-engage (deltas move from here)
  const anchorBalRef = useRef(0);
  const headRef = useRef(null); // latest { pitch, roll }
  const uiRef = useRef(0);
  const novaBrightRef = useRef(0);
  const pulseRef = useRef(0);

  // Timer / goal.
  const endRef = useRef(0);
  const startRef = useRef(null);
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

  // Drive the audio (and, when not head-driven, the light) from the current
  // finger position + any persistent head bend.
  const applyAudio = () => {
    const c = clamp(carrierBaseRef.current + carrierBendRef.current, 60, 1100);
    const b = clamp(yBeatRef.current + beatBendRef.current, BEAT_MIN, BEAT_MAX);
    if (runningRef.current && engineRef.current) {
      engineRef.current.glideCarrier(c, 0.12);
      engineRef.current.glideBeat(b, 0.12);
    }
    if (runningRef.current && nova.connected && !lightHeadRef.current) {
      nova.setFrequency(b); // light follows the beat until the head takes over
      lightRateRef.current = b;
    }
    uiTick(() => {
      setCarrier(Math.round(c));
      if (!lightHeadRef.current) setBeat(Math.round(b * 10) / 10);
    });
  };

  // Lightpad touch → carrier/beat/intensity + the push gate.
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const fromFinger = () => {
      const xN = clamp((colRef.current + bendRef.current) / (LP_COLS - 1), 0, 1);
      const yN = clamp((rowRef.current + slideRef.current) / (LP_ROWS - 1), 0, 1);
      carrierBaseRef.current = CARR_MIN + xN * (CARR_MAX - CARR_MIN);
      yBeatRef.current = BEAT_MIN + yN * (BEAT_MAX - BEAT_MIN);
      applyAudio();
    };
    lightpad.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        colRef.current = col; rowRef.current = row; bendRef.current = 0; slideRef.current = 0;
        fromFinger();
      } else if (ev.type === 'pitchBend') {
        bendRef.current = ev.value / LP_BEND_PER_COL; // glide → carrier columns (X)
        fromFinger();
      } else if (ev.type === 'cc' && ev.controller === 74) {
        slideRef.current = ((ev.value - 63) / 63) * (LP_ROWS - 1); // slide → beat rows (Y)
        fromFinger();
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        const i = clamp(mapRange(ev.value, 0, 127, 0.2, 1), 0.2, 1); // press → field intensity
        if (runningRef.current && engineRef.current) engineRef.current.setVolume(i);
        if (runningRef.current && nova.connected) throttle(novaBrightRef, 120, () => nova.setMasterBrightness(i));
        if (runningRef.current && pulsetto.sessionActive) {
          throttle(pulseRef, 1000, () => pulsetto.setIntensity(Math.round(mapRange(i, 0.2, 1, 2, 6))));
        }
        uiTick(() => setIntensity(i));
        // Push gate — a firm press lets the head sculpt the light (see motion effect).
        const nowPushing = ev.value >= PUSH_THRESHOLD;
        if (nowPushing && !pushingRef.current) {
          pushingRef.current = true; setPushing(true);
          const h = headRef.current;
          centerRef.current = { pitch: h ? h.pitch : 0, roll: h ? h.roll : 0 };
          anchorRateRef.current = lightRateRef.current; // move light from where it is now
          anchorBalRef.current = balanceRef.current;
        } else if (!nowPushing && pushingRef.current) {
          pushingRef.current = false; setPushing(false); // release: everything PERSISTS
        }
      } else if (ev.type === 'noteOff') {
        if (pushingRef.current) { pushingRef.current = false; setPushing(false); }
      }
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  // Nova head motion → LIGHT rhythm, only while pressing. Deltas from the head
  // pose captured at push-engage, applied on top of the anchored light rate, so
  // there's no jump. Audio only bends subtly. All of it persists after release.
  useEffect(() => {
    if (!running || !nova.connected || !nova.setMotionListener) return;
    nova.setTelemetryRate(1); // wake the accelerometer stream
    const applyHead = () => {
      if (!pushingRef.current || !runningRef.current) return;
      const s = headRef.current;
      if (!s) return;
      const dPitch = (s.pitch - centerRef.current.pitch) * FIELD_PITCH_SIGN;
      const dRoll = (s.roll - centerRef.current.roll) * FIELD_ROLL_SIGN;
      if (!lightHeadRef.current && Math.abs(dPitch) < HEAD_DEADZONE && Math.abs(dRoll) < HEAD_DEADZONE) return;
      lightHeadRef.current = true; // head owns the light from here on (persists)
      // Common flash rate from pitch — full 0.5…max reachable by tilting; anchored
      // so a still head holds the current rate.
      const swing = LIGHT_RATE_MAX - LIGHT_RATE_MIN;
      const rate = clamp(anchorRateRef.current + mapRange(dPitch, -HEAD_PITCH_SPAN, HEAD_PITCH_SPAN, -swing, swing), LIGHT_RATE_MIN, LIGHT_RATE_MAX);
      // Per-eye balance from roll — leaning slows the near side toward stop.
      const bal = clamp(anchorBalRef.current + dRoll / HEAD_ROLL_SPAN, -1, 1);
      lightRateRef.current = rate;
      balanceRef.current = bal;
      nova.setFrequency(rate);
      nova.setBalance(bal);
      // Subtle, persistent audio bend so the head move is audible as an effect.
      beatBendRef.current = mapRange(dPitch, -HEAD_PITCH_SPAN, HEAD_PITCH_SPAN, -BEAT_BEND, BEAT_BEND);
      carrierBendRef.current = mapRange(dRoll, -HEAD_ROLL_SPAN, HEAD_ROLL_SPAN, -CARR_BEND, CARR_BEND);
      if (engineRef.current) {
        engineRef.current.glideBeat(clamp(yBeatRef.current + beatBendRef.current, BEAT_MIN, BEAT_MAX), 0.15);
        engineRef.current.glideCarrier(clamp(carrierBaseRef.current + carrierBendRef.current, 60, 1100), 0.15);
      }
      uiTick(() => setBeat(Math.round(rate * 10) / 10)); // show the light rate you're sculpting
    };
    nova.setMotionListener(s => { headRef.current = s; applyHead(); });
    return () => { try { nova.setMotionListener(null); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, nova.connected]);

  const start = async () => {
    const e = ensureEngine();
    e.start({ carrier, beat, volume: intensity, background: 'none' });
    e.fadeIn(1.2);
    // Fresh session: light re-links to the beat, bends cleared.
    lightHeadRef.current = false;
    balanceRef.current = 0;
    beatBendRef.current = 0;
    carrierBendRef.current = 0;
    lightRateRef.current = beat;
    yBeatRef.current = beat;
    carrierBaseRef.current = carrier;
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
          {pushing ? <Text style={styles.pushCue}>◉ pushing — drag to steer, or move your head to sculpt the light</Text> : null}
        </View>
      )}

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
              ? 'drag: ← → carrier · ↑ ↓ beat · press = intensity   ·   push + head: pitch = flash rate, roll = side balance'
              : 'drag: ← → carrier · ↑ ↓ beat · press = intensity'
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
  pushCue: { color: COLORS.accentGreen, fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
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
