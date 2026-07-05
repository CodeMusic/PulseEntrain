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
import { useSettings } from '../settings/SettingsProvider';
import { LP_COLS, LP_ROWS, LP_BEND_PER_COL, decodeCell } from '../shared/lightpadGrid';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

// Field Meditation Mode — immersive, eyes-closed. The circle IS the control:
// tap to enter, tap to pause (→ resume/stop). Wearing beats + Nova + Pulsetto you
// "feel around" a ROLI Lightpad Block; a PRESS-AND-HOLD engages editing (previewed
// by the intensity boost), and what you set persists on release. While holding:
//   FINGER  x → carrier Hz (min left … max right)
//           y → binaural beat = audio beat AND flash rate (min ≈0.5 Hz bottom … max top)
//   HEAD    pitch → same binaural beat (look down = min, up = max)
//           roll  → slows the LED bank you lean toward (far = 0.5 Hz); level =
//                   balanced. The resulting left/right flash difference is the
//                   "biphotic beat", shown above the carrier.
const CARR_MIN = 80, CARR_MAX = 500; // carrier sweep across the pad width
const FIELD_BEAT_MIN = 0.5, FIELD_BEAT_MAX = 40; // binaural beat = audio + flash rate
const FIELD_PULSE_INTENSITY = 4; // Pulsetto session base (1–9)
const PUSH_THRESHOLD = 40; // pressure (0–127) above which editing engages
const HEAD_PITCH_SPAN = 40, HEAD_ROLL_SPAN = 35; // degrees of head travel for full swing
const HEAD_DEADZONE = 5; // degrees of slack — jitter/settle is ignored
const HEAD_SMOOTH_ALPHA = 0.18; // low-pass on head samples (smaller = smoother)
const FIELD_PITCH_SIGN = 1; // flip to -1 if looking up slows instead of speeds
const FIELD_ROLL_SIGN = 1; // flip to -1 if leaning left slows the wrong eye
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mapRange = (v, inA, inB, outA, outB) => outA + ((v - inA) / ((inB - inA) || 1)) * (outB - outA);
const dz = (d, z) => (Math.abs(d) <= z ? 0 : d - Math.sign(d) * z);
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

export default function FieldScreen() {
  const nova = useNova();
  const pulsetto = usePulsetto();
  const lightpad = useLightpad();
  const sessions = useSessions();
  const settings = useSettings();
  const devMode = !!(settings && settings.devMode);

  const [carrier, setCarrier] = useState(200);
  const [beat, setBeat] = useState(10);
  const [biphotic, setBiphotic] = useState(0); // emergent left/right flash difference (Hz)
  const [intensity, setIntensity] = useState(0.7);
  const [timerMin, setTimerMin] = useState(15);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pushing, setPushing] = useState(false);

  const engineRef = useRef(null);
  const runningRef = useRef(false);
  runningRef.current = running;
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Field state.
  const colRef = useRef(2);
  const rowRef = useRef(2);
  const bendRef = useRef(0);
  const slideRef = useRef(0);
  const carrierRef = useRef(200);
  const beatRef = useRef(10); // master binaural beat (audio + both-eye flash)
  const balanceRef = useRef(0); // −1 left … 0 balanced … +1 right (roll)
  const pushingRef = useRef(false);
  const centerPitchRef = useRef(0); // head pitch captured at push-engage (anchor)
  const anchorBeatRef = useRef(10); // beat at push-engage (pitch deltas move from here)
  const headRef = useRef(null); // smoothed { pitch, roll }
  const uiRef = useRef(0);
  const novaBrightRef = useRef(0);
  const pulseRef = useRef(0);

  const endRef = useRef(0);
  const startRef = useRef(null);
  const tickRef = useRef(null);

  // Diagnostics (devMode): live values + a telemetry-rate to experiment with,
  // since the Nova's faster rates are unconfirmed. `dev` is a periodic snapshot so
  // the overlay doesn't re-render on every sample.
  const [devRate, setDevRate] = useState(20);
  const [dev, setDev] = useState(null);
  const rawHeadRef = useRef({ pitch: 0, roll: 0 });
  const hzRef = useRef(0);
  const lastTsRef = useRef(0);
  const lastPressureRef = useRef(0);
  const lastEvtRef = useRef('');

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

  // Push the current carrier/beat/balance to audio + light + readout.
  const applyField = () => {
    const c = clamp(carrierRef.current, 60, 1100);
    const b = clamp(beatRef.current, FIELD_BEAT_MIN, FIELD_BEAT_MAX);
    if (runningRef.current && !pausedRef.current && engineRef.current) {
      engineRef.current.glideCarrier(c, 0.12);
      engineRef.current.glideBeat(b, 0.12);
    }
    if (runningRef.current && !pausedRef.current && nova.connected) {
      nova.setFrequency(b);
      nova.setBalance(balanceRef.current);
    }
    const biph = Math.abs(balanceRef.current) * (b - FIELD_BEAT_MIN); // the biphotic beat
    uiTick(() => {
      setCarrier(Math.round(c));
      setBeat(Math.round(b * 10) / 10);
      setBiphotic(Math.round(biph * 10) / 10);
    });
  };

  // Lightpad touch → carrier (X), beat (Y), intensity (Z) + the push gate.
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const fromFinger = () => {
      const xN = clamp((colRef.current + bendRef.current) / (LP_COLS - 1), 0, 1);
      const yN = clamp((rowRef.current + slideRef.current) / (LP_ROWS - 1), 0, 1);
      carrierRef.current = CARR_MIN + xN * (CARR_MAX - CARR_MIN);
      beatRef.current = FIELD_BEAT_MIN + yN * (FIELD_BEAT_MAX - FIELD_BEAT_MIN);
      applyField();
    };
    lightpad.setNoteListener(ev => {
      lastEvtRef.current = ev.type + (ev.controller != null ? ':cc' + ev.controller : '') + (ev.value != null ? '=' + ev.value : '');
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        colRef.current = col; rowRef.current = row; bendRef.current = 0; slideRef.current = 0;
        fromFinger();
      } else if (ev.type === 'pitchBend') {
        bendRef.current = ev.value / LP_BEND_PER_COL;
        fromFinger();
      } else if (ev.type === 'cc' && ev.controller === 74) {
        slideRef.current = ((ev.value - 63) / 63) * (LP_ROWS - 1);
        fromFinger();
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        lastPressureRef.current = ev.value;
        const i = clamp(mapRange(ev.value, 0, 127, 0.2, 1), 0.2, 1);
        if (runningRef.current && !pausedRef.current && engineRef.current) engineRef.current.setVolume(i);
        if (runningRef.current && !pausedRef.current && nova.connected) throttle(novaBrightRef, 120, () => nova.setMasterBrightness(i));
        if (runningRef.current && !pausedRef.current && pulsetto.sessionActive) {
          throttle(pulseRef, 1000, () => pulsetto.setIntensity(Math.round(mapRange(i, 0.2, 1, 2, 6))));
        }
        uiTick(() => setIntensity(i));
        const nowPushing = ev.value >= PUSH_THRESHOLD;
        if (nowPushing && !pushingRef.current) {
          pushingRef.current = true; setPushing(true);
          const h = headRef.current;
          centerPitchRef.current = h ? h.pitch : 0; // anchor pitch so it doesn't jump the beat
          anchorBeatRef.current = beatRef.current;
        } else if (!nowPushing && pushingRef.current) {
          pushingRef.current = false; setPushing(false); // release → persists
        }
      } else if (ev.type === 'noteOff') {
        if (pushingRef.current) { pushingRef.current = false; setPushing(false); }
      }
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  // Head motion (while pressing): pitch → the binaural beat (anchored, no jump),
  // roll → per-eye slowdown (absolute from level). Smoothed + dead-zoned.
  useEffect(() => {
    if (!running || !nova.connected || !nova.setMotionListener) return;
    nova.setTelemetryRate(devRate);
    const applyHead = () => {
      if (!pushingRef.current || !runningRef.current || pausedRef.current) return;
      const s = headRef.current;
      if (!s) return;
      const dPitch = dz((s.pitch - centerPitchRef.current) * FIELD_PITCH_SIGN, HEAD_DEADZONE);
      if (dPitch !== 0) {
        const swing = FIELD_BEAT_MAX - FIELD_BEAT_MIN;
        beatRef.current = clamp(anchorBeatRef.current + mapRange(dPitch, -HEAD_PITCH_SPAN, HEAD_PITCH_SPAN, -swing, swing), FIELD_BEAT_MIN, FIELD_BEAT_MAX);
      }
      const dRoll = dz(s.roll * FIELD_ROLL_SIGN, HEAD_DEADZONE);
      balanceRef.current = clamp(dRoll / HEAD_ROLL_SPAN, -1, 1); // level = balanced
      applyField();
    };
    nova.setMotionListener(s => {
      rawHeadRef.current = { pitch: s.pitch, roll: s.roll };
      const now = Date.now();
      if (lastTsRef.current) { const d = now - lastTsRef.current; if (d > 0 && d < 5000) hzRef.current = 1000 / d; }
      lastTsRef.current = now;
      const p = headRef.current;
      headRef.current = p
        ? { pitch: p.pitch + (s.pitch - p.pitch) * HEAD_SMOOTH_ALPHA, roll: p.roll + (s.roll - p.roll) * HEAD_SMOOTH_ALPHA }
        : { pitch: s.pitch, roll: s.roll };
      applyHead();
    });
    return () => { try { nova.setMotionListener(null); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, nova.connected]);

  // Re-request the telemetry rate when experimenting with it in devMode.
  useEffect(() => {
    if (running && nova.connected && nova.setTelemetryRate) nova.setTelemetryRate(devRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devRate, running, nova.connected]);

  // Periodic snapshot for the devMode overlay (avoids per-sample re-renders).
  useEffect(() => {
    if (!devMode) { setDev(null); return; }
    const id = setInterval(() => {
      const h = headRef.current || { pitch: 0, roll: 0 };
      setDev({
        hz: hzRef.current, pitch: rawHeadRef.current.pitch, roll: rawHeadRef.current.roll,
        sPitch: h.pitch, sRoll: h.roll, pushing: pushingRef.current, pressure: lastPressureRef.current,
        carrier: carrierRef.current, beat: beatRef.current, balance: balanceRef.current,
        evt: lastEvtRef.current, novaConn: nova.connected, lpConn: lightpad.connected,
      });
    }, 200);
    return () => clearInterval(id);
  }, [devMode, nova.connected, lightpad.connected]);

  const startTimerTick = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const rem = Math.round((endRef.current - Date.now()) / 1000);
      setRemaining(Math.max(0, rem));
      if (rem <= 0) stop();
    }, 1000);
  };

  const start = async () => {
    const e = ensureEngine();
    carrierRef.current = carrier; beatRef.current = beat; balanceRef.current = 0;
    e.start({ carrier, beat, volume: intensity, background: 'none' });
    e.fadeIn(1.2);
    if (nova.connected) { nova.startStrobe(beat); nova.setMasterBrightness(intensity); nova.setBalance(0); }
    if (pulsetto.connected) { try { await pulsetto.startSession(FIELD_PULSE_INTENSITY); } catch (er) {} }
    startRef.current = { time: Date.now(), plannedSeconds: timerMin * 60 };
    endRef.current = Date.now() + timerMin * 60 * 1000;
    setRemaining(timerMin * 60);
    setBiphotic(0);
    setPaused(false);
    setRunning(true);
    KeepAwake.activate();
    startTimerTick();
  };

  const pause = async () => {
    setPaused(true);
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { engineRef.current?.fadeOut(0.6); } catch (e) {}
    try { nova.stopStrobe(); } catch (e) {}
    if (pulsetto.sessionActive) { try { await pulsetto.stopSession(); } catch (e) {} }
    KeepAwake.deactivate();
  };

  const resume = async () => {
    setPaused(false);
    try { engineRef.current?.fadeIn(0.6); } catch (e) {}
    if (nova.connected) { nova.startStrobe(beatRef.current); nova.setMasterBrightness(intensity); nova.setBalance(balanceRef.current); }
    if (pulsetto.connected) { try { await pulsetto.startSession(FIELD_PULSE_INTENSITY); } catch (e) {} }
    endRef.current = Date.now() + remaining * 1000;
    KeepAwake.activate();
    startTimerTick();
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
    setPaused(false);
    setRunning(false);
    setRemaining(0);
    KeepAwake.deactivate();
  };

  const onCircle = () => {
    if (!running) return start();
    if (paused) return resume();
    return pause();
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
        { text: 'I understand — connect', onPress: async () => { const ok = await nova.connect(); if (ok && runningRef.current) nova.startStrobe(beatRef.current); } },
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
      {/* Setup (pre-session): devices + timer. Hidden once running. */}
      {!running ? (
        <View style={styles.setup}>
          <Text style={styles.setupTitle}>Wear your devices, set a time, then tap the circle.</Text>
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
        <View style={styles.topBar}>
          <Text style={styles.countdown}>{fmtTime(remaining)}</Text>
        </View>
      )}

      {/* The circle IS the button. */}
      <View style={styles.stage}>
        <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: halo, opacity: haloOpacity, transform: [{ scale: orbScale }] }]} />
        <TouchableOpacity activeOpacity={0.9} onPress={onCircle} style={styles.orbTouch}>
          <Animated.View pointerEvents="none" style={[styles.orb, { backgroundColor: core, shadowColor: core, transform: [{ scale: orbScale }] }]} />
          <View style={styles.readout} pointerEvents={paused ? 'box-none' : 'none'}>
            {!running ? (
              <Text style={styles.enterInOrb}>Enter{'\n'}the field</Text>
            ) : paused ? (
              <>
                <Text style={styles.pausedLabel}>Paused</Text>
                <TouchableOpacity style={[styles.circleBtn, styles.resumeBtn]} onPress={resume} activeOpacity={0.85}>
                  <Text style={styles.circleBtnTxt}>Resume</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.circleBtn, styles.stopCircleBtn]} onPress={stop} activeOpacity={0.85}>
                  <Text style={[styles.circleBtnTxt, styles.stopBtnTxt]}>Stop</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {biphotic > 0.1 ? <Text style={styles.biphoticTxt}>◑ {biphotic.toFixed(1)} Hz</Text> : <Text style={styles.biphoticTxt}> </Text>}
                <Text style={styles.carrierTxt}>{Math.round(carrier)}</Text>
                <Text style={styles.carrierUnit}>Hz carrier</Text>
                <Text style={styles.beatTxt}>{beat.toFixed(1)} Hz · {band}</Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Bottom: a subtle cue (hidden while paused — controls live in the circle). */}
      {!paused ? (
        <Text style={styles.hint}>
          {IS_WEB
            ? 'Field visuals + audio preview. Connect a Lightpad on the phone to steer it.'
            : !running
            ? lightpad.connected ? 'Tap the circle to enter, then feel around the block.' : 'Connect a Lightpad above (or just enter for audio + visuals).'
            : pushing
            ? 'sculpting — finger: ← → carrier, ↑ ↓ beat · head: pitch = beat, roll = balance'
            : 'press & hold the block to edit · tap the circle to pause'}
        </Text>
      ) : null}

      {/* devMode diagnostics overlay — live Nova head data + Lightpad values, and a
          telemetry-rate experiment (the faster Nova rates are unconfirmed). */}
      {devMode ? (
        <View style={styles.devPanel} pointerEvents="box-none">
          <Text style={styles.devTxt}>
            {`nova ${dev?.novaConn ? 'on' : 'off'} · tel ${dev ? dev.hz.toFixed(1) : '0'} Hz · rate ${devRate}\n`}
            {`pitch ${dev ? dev.pitch.toFixed(1) : '—'}°  roll ${dev ? dev.roll.toFixed(1) : '—'}°  (smoothed ${dev ? dev.sPitch.toFixed(0) : '—'}/${dev ? dev.sRoll.toFixed(0) : '—'})\n`}
            {`push ${dev?.pushing ? 'YES' : 'no'} · pressure ${dev ? dev.pressure : 0}\n`}
            {`carr ${dev ? Math.round(dev.carrier) : 0} · beat ${dev ? dev.beat.toFixed(1) : 0} · bal ${dev ? dev.balance.toFixed(2) : 0}\n`}
            {`lp ${dev?.lpConn ? 'on' : 'off'} · ${dev ? dev.evt : ''}`}
          </Text>
          <View style={styles.devRates}>
            <Text style={styles.devRatesLabel}>tel rate</Text>
            {[1, 5, 10, 20, 40].map(r => (
              <TouchableOpacity key={r} onPress={() => setDevRate(r)} style={[styles.devRateBtn, devRate === r && styles.devRateOn]}>
                <Text style={styles.devRateTxt}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070A0F', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  setup: { minHeight: 150 },
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
  topBar: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  countdown: { color: COLORS.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: 1, opacity: 0.85 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 300, height: 300, borderRadius: 150 },
  orbTouch: { width: 210, height: 210, borderRadius: 105, alignItems: 'center', justifyContent: 'center' },
  orb: {
    position: 'absolute', width: 190, height: 190, borderRadius: 95,
    shadowOpacity: 0.8, shadowRadius: 40, shadowOffset: { width: 0, height: 0 }, elevation: 12,
  },
  readout: { alignItems: 'center', justifyContent: 'center' },
  enterInOrb: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', textAlign: 'center', lineHeight: 26, opacity: 0.95 },
  biphoticTxt: { color: '#EAF2FF', fontSize: 13, fontWeight: '700', opacity: 0.9, marginBottom: 2, minHeight: 17 },
  carrierTxt: { color: '#FFFFFF', fontSize: 40, fontWeight: '900', opacity: 0.95, lineHeight: 44 },
  carrierUnit: { color: '#DCE6F2', fontSize: 11, fontWeight: '600', opacity: 0.7, marginTop: -2, marginBottom: 4 },
  beatTxt: { color: '#E6EDF5', fontSize: 14, fontWeight: '700', opacity: 0.82 },
  pausedLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', opacity: 0.9, marginBottom: 8 },
  circleBtn: { width: 116, borderRadius: 999, paddingVertical: 9, alignItems: 'center', marginTop: 6 },
  resumeBtn: { backgroundColor: 'rgba(255,255,255,0.92)' },
  stopCircleBtn: { backgroundColor: 'rgba(20,10,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  circleBtnTxt: { fontSize: 14, fontWeight: '800', color: '#0B0E13' },
  stopBtnTxt: { color: '#FFFFFF' },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18, minHeight: 34 },
  devPanel: { position: 'absolute', top: 6, left: 8, right: 8, backgroundColor: 'rgba(4,8,14,0.86)', borderRadius: 10, borderWidth: 1, borderColor: '#1D2836', paddingHorizontal: 10, paddingVertical: 8 },
  devTxt: { color: '#8FE3C2', fontSize: 11, lineHeight: 16, fontFamily: 'Courier' },
  devRates: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 },
  devRatesLabel: { color: COLORS.textMuted, fontSize: 11, marginRight: 2 },
  devRateBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#141C28' },
  devRateOn: { backgroundColor: COLORS.accentGreen },
  devRateTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
