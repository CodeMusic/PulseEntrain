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
import { useSessionExitGuard } from '../session/useSessionExitGuard';
import { useDevPanelContent } from '../dev/DevPanel';
import { LP_COLS, LP_ROWS, LP_BEND_PER_COL, decodeCell } from '../shared/lightpadGrid';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

// Field Meditation Mode — immersive, eyes-closed. The circle IS the control:
// tap to enter, tap to pause (→ resume/stop). Wearing beats + Nova + Pulsetto you
// "feel around" a ROLI Lightpad Block; a PRESS-AND-HOLD engages editing (previewed
// by the intensity boost), and what you set persists on release. While holding:
//   FINGER  x → carrier Hz (min left … max right)
//           y → binaural beat = audio beat AND flash rate (min ≈0.5 Hz bottom … max top)
//   HEAD    pitch → gently BENDS the finger-set beat (± a few Hz), measured from your
//                   entry pitch, so a still head doesn't change it (carrier bends a
//                   touch too). Bends bake into the base on release.
//           roll  → the BIPHOTIC beat: while pressing, rolling from your entry pose
//                   slows the eye you lean toward (±5° balanced … ±20° to 0.5 Hz;
//                   |left − right| shown). It LOCKS on release, and ANY touch of the
//                   block eases the eyes back to sync over ~5 s (press+roll re-opens).
const CARR_MIN = 80, CARR_MAX = 500; // carrier sweep across the pad width
const FIELD_BEAT_MIN = 0.5; // near-zero binaural beat / flash floor
const FIELD_BEAT_SAFE = 15; // beat/flash ceiling with photosensitivity safeties on
const FIELD_BEAT_FULL = 30; // ceiling with Full frequency range (safeties off)
const FIELD_PULSE_INTENSITY = 4; // Pulsetto session base (1–9)
const PUSH_THRESHOLD = 40; // pressure (0–127) above which editing engages
// Head control (Nova accelerometer, while pressing). Roll opens the biphotic beat;
// pitch only *bends* the finger-set beat. Both are relative to your pose when the
// push began, and both have a dead-zone so a still/settling head does nothing.
const ROLL_DEADZONE = 5, ROLL_MAX = 20; // roll: ±5° balanced, ±20° slows one eye to 0.5 Hz
const PITCH_DEADZONE = 4, PITCH_BEND_SPAN = 20; // pitch: degrees from entry for a full bend
const BEAT_BEND_MAX = 3.5; // Hz — how far head pitch bends the (finger-set) beat
const CARR_BEND_MAX = 12; // Hz — carrier bend alongside it, big enough to actually hear
const BIPHOTIC_FADE_MS = 5000; // any touch eases the eyes back to sync over this long
const HEAD_SMOOTH_ALPHA = 0.18; // low-pass on head samples (smaller = smoother)
const FIELD_PITCH_SIGN = -1; // pitch reads inverted on the Nova — flip it
const FIELD_ROLL_SIGN = 1; // leaning left slows the left eye (confirmed on device)
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
  const fullBand = !!(settings && settings.fullBand); // opt-out of photosensitivity safeties
  // The block's full Y axis spans 0 → this max. Safeties on = 15 Hz, off = 30 Hz.
  const beatMaxRef = useRef(FIELD_BEAT_SAFE);
  beatMaxRef.current = fullBand ? FIELD_BEAT_FULL : FIELD_BEAT_SAFE;

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
  useSessionExitGuard(running); // confirm before an accidental tap leaves a live session

  // Field state.
  const colRef = useRef(2);
  const rowRef = useRef(2);
  const bendRef = useRef(0);
  const slideRef = useRef(0);
  // The beat/carrier are a finger-set BASE plus a small head-pitch BEND.
  const baseCarrierRef = useRef(200); // finger x → carrier
  const baseBeatRef = useRef(10); // finger y → binaural beat
  const beatBendRef = useRef(0); // head pitch → ± a few Hz on the beat
  const carrierBendRef = useRef(0); // head pitch → ± a couple Hz on the carrier (subtle)
  const balanceRef = useRef(0); // roll: −1 left … 0 balanced … +1 right (biphotic)
  const pushingRef = useRef(false);
  const centerPitchRef = useRef(0); // head pitch captured at push-engage (bend anchor)
  const centerRollRef = useRef(0); // head roll captured at push / finger-move (biphotic zero)
  const fadeRef = useRef(null); // interval id for the gentle biphotic re-sync
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

  // Inner orb: a slow, calm breath. Outer ring: breathes at the binaural beat rate.
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

  // The outer ring pulses at the set binaural beat — but ONLY while a session is
  // running (before you enter the field it sits still). Half-period floored at
  // 50 ms (~10 Hz) so fast beats shimmer rather than strobe, unless Full frequency
  // range is enabled in Settings (then it tracks the whole band).
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseKey = Math.max(0.5, Math.round(beat * 2) / 2);
  useEffect(() => {
    if (!running) { pulse.stopAnimation(); pulse.setValue(0); return; }
    const half = Math.max(16, 1000 / pulseKey / 2);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseKey, fullBand, running, pulse]);

  // Inner circle breathes at the biphotic beat rate, but only when one is set
  // (a left/right flash difference). Subtle — it just swells a little.
  const innerPulse = useRef(new Animated.Value(0)).current;
  const biphActive = running && biphotic >= 0.5;
  const biphKey = Math.max(0.5, Math.round(biphotic * 2) / 2);
  useEffect(() => {
    if (!biphActive) { innerPulse.stopAnimation(); innerPulse.setValue(0); return; }
    const half = Math.max(16, 1000 / biphKey / 2);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(innerPulse, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(innerPulse, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [biphActive, biphKey, fullBand, innerPulse]);

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
      if (fadeRef.current) clearInterval(fadeRef.current);
      try { engineRef.current?.stop(); } catch (e) {}
      try { nova.stopStrobe(); } catch (e) {}
      try { pulsetto.stopSession(); } catch (e) {} // unconditional — always stop the stimulator
      KeepAwake.deactivate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Effective values = finger-set base + head-pitch bend. Push to audio/light/UI.
  const applyField = () => {
    const c = clamp(baseCarrierRef.current + carrierBendRef.current, 60, 1100);
    const b = clamp(baseBeatRef.current + beatBendRef.current, FIELD_BEAT_MIN, beatMaxRef.current);
    if (runningRef.current && !pausedRef.current && engineRef.current) {
      engineRef.current.glideCarrier(c, 0.12);
      engineRef.current.glideBeat(b, 0.12);
    }
    if (runningRef.current && !pausedRef.current && nova.connected) {
      nova.setFrequency(b);
      nova.setBalance(balanceRef.current);
    }
    // Biphotic beat = |left flash − right flash|, in 0.5 Hz steps (roll slows one
    // eye from b toward 0.5, so the gap is |balance|·(b − 0.5)).
    const biph = Math.round(Math.abs(balanceRef.current) * (b - FIELD_BEAT_MIN) * 2) / 2;
    uiTick(() => {
      setCarrier(Math.round(c));
      setBeat(Math.round(b * 10) / 10);
      setBiphotic(biph);
    });
  };

  const cancelFade = () => { if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null; } };
  // A quick tap gently re-syncs the eyes: ramp the locked biphotic balance → 0
  // over BIPHOTIC_FADE_MS so the asymmetry dissolves naturally rather than snapping.
  const startBiphoticFade = () => {
    cancelFade();
    const startBal = balanceRef.current;
    if (Math.abs(startBal) < 0.02) return;
    const t0 = Date.now();
    fadeRef.current = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / BIPHOTIC_FADE_MS);
      balanceRef.current = startBal * (1 - k);
      if (runningRef.current && !pausedRef.current) nova.setBalance(balanceRef.current);
      const b = clamp(baseBeatRef.current + beatBendRef.current, FIELD_BEAT_MIN, beatMaxRef.current);
      setBiphotic(Math.round(Math.abs(balanceRef.current) * (b - FIELD_BEAT_MIN) * 2) / 2);
      if (k >= 1) { balanceRef.current = 0; cancelFade(); }
    }, 120);
  };

  // Lightpad touch → carrier (X), beat (Y), intensity (Z) + the push gate.
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const fromFinger = () => {
      const xN = clamp((colRef.current + bendRef.current) / (LP_COLS - 1), 0, 1);
      const yN = clamp((rowRef.current + slideRef.current) / (LP_ROWS - 1), 0, 1);
      const newC = CARR_MIN + xN * (CARR_MAX - CARR_MIN);
      const newB = FIELD_BEAT_MIN + (1 - yN) * (beatMaxRef.current - FIELD_BEAT_MIN); // block Y reads inverted
      // A meaningful move (not MPE jitter) re-syncs the biphotic beat: roll is a
      // fine-tune *at* a position, so a new position starts balanced. Re-anchor the
      // roll centre to the current head so rolling from here re-opens it.
      // A meaningful move WHILE PRESSING re-syncs the biphotic (roll is a fine-tune
      // at a spot); moving to a new spot re-anchors the roll centre. A light touch
      // that isn't a press leaves the locked biphotic alone.
      const moved = Math.abs(newB - baseBeatRef.current) > 0.5 || Math.abs(newC - baseCarrierRef.current) > 8;
      baseCarrierRef.current = newC;
      baseBeatRef.current = newB;
      if (moved && pushingRef.current) {
        balanceRef.current = 0;
        centerRollRef.current = headRef.current ? headRef.current.roll : 0;
      }
      applyField();
    };
    // On release from a press: bake the pitch bend into the base so beat/carrier
    // lock, and LOCK the biphotic balance in place too (it persists until you
    // press+re-roll, or tap to gently re-sync).
    const releasePush = () => {
      if (!pushingRef.current) return;
      pushingRef.current = false;
      setPushing(false);
      baseBeatRef.current = clamp(baseBeatRef.current + beatBendRef.current, FIELD_BEAT_MIN, beatMaxRef.current);
      baseCarrierRef.current = clamp(baseCarrierRef.current + carrierBendRef.current, 60, 1100);
      beatBendRef.current = 0;
      carrierBendRef.current = 0;
      applyField();
    };
    lightpad.setNoteListener(ev => {
      lastEvtRef.current = ev.type + (ev.controller != null ? ':cc' + ev.controller : '') + (ev.value != null ? '=' + ev.value : '');
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        colRef.current = col; rowRef.current = row; bendRef.current = 0; slideRef.current = 0;
        fromFinger();
        if (!pushingRef.current) startBiphoticFade(); // a touch eases to sync — but not a retrigger mid-press (that would fight the roll)
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
          cancelFade(); // pressing to edit stops the auto-sync so roll can set the biphotic
          const h = headRef.current;
          centerPitchRef.current = h ? h.pitch : 0; // bend is measured from this entry pitch
          centerRollRef.current = h ? h.roll : 0; // biphotic opens by rolling from here
        } else if (!nowPushing && pushingRef.current) {
          releasePush();
        }
      } else if (ev.type === 'noteOff') {
        if (pushingRef.current) releasePush();
      }
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  // Head motion (while pressing): pitch BENDS the finger-set beat ± a few Hz
  // (measured from your entry pitch, so a still head does nothing); roll opens the
  // biphotic beat by slowing one eye (±5° balanced … ±20° down to 0.5 Hz).
  useEffect(() => {
    if (!running || !nova.connected || !nova.setMotionListener) return;
    nova.setTelemetryRate(devRate);
    const applyHead = () => {
      if (!pushingRef.current || !runningRef.current || pausedRef.current) return;
      const s = headRef.current;
      if (!s) return;
      const p = clamp(dz((s.pitch - centerPitchRef.current) * FIELD_PITCH_SIGN, PITCH_DEADZONE), -PITCH_BEND_SPAN, PITCH_BEND_SPAN);
      beatBendRef.current = (p / PITCH_BEND_SPAN) * BEAT_BEND_MAX;
      carrierBendRef.current = (p / PITCH_BEND_SPAN) * CARR_BEND_MAX;
      const dRoll = dz((s.roll - centerRollRef.current) * FIELD_ROLL_SIGN, ROLL_DEADZONE);
      balanceRef.current = clamp(dRoll / (ROLL_MAX - ROLL_DEADZONE), -1, 1); // ±5° balanced, ±20° full
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
        carrier: baseCarrierRef.current + carrierBendRef.current, beat: baseBeatRef.current + beatBendRef.current, balance: balanceRef.current, bend: beatBendRef.current,
        biphotic: Math.abs(balanceRef.current) * (baseBeatRef.current + beatBendRef.current - FIELD_BEAT_MIN),
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
    cancelFade();
    baseCarrierRef.current = carrier; baseBeatRef.current = beat;
    beatBendRef.current = 0; carrierBendRef.current = 0; balanceRef.current = 0;
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
    cancelFade();
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { engineRef.current?.fadeOut(0.6); } catch (e) {}
    try { nova.stopStrobe(); } catch (e) {}
    try { await pulsetto.stopSession(); } catch (e) {} // unconditional — provider uses live refs
    KeepAwake.deactivate();
  };

  const resume = async () => {
    setPaused(false);
    try { engineRef.current?.fadeIn(0.6); } catch (e) {}
    const liveBeat = clamp(baseBeatRef.current + beatBendRef.current, FIELD_BEAT_MIN, beatMaxRef.current);
    if (nova.connected) { nova.startStrobe(liveBeat); nova.setMasterBrightness(intensity); nova.setBalance(balanceRef.current); }
    if (pulsetto.connected) { try { await pulsetto.startSession(FIELD_PULSE_INTENSITY); } catch (e) {} }
    endRef.current = Date.now() + remaining * 1000;
    KeepAwake.activate();
    startTimerTick();
  };

  const stop = async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    cancelFade();
    logIfCounted();
    const eng = engineRef.current;
    if (eng) {
      try { eng.fadeOut(1.0); } catch (e) {}
      setTimeout(() => { try { eng.stop(); } catch (e) {} }, 1050);
    }
    try { nova.stopStrobe(); } catch (e) {}
    try { await pulsetto.stopSession(); } catch (e) {} // unconditional — provider uses live refs
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
  const connectNova = async () => { const ok = await nova.connect(); if (ok && runningRef.current) nova.startStrobe(baseBeatRef.current + beatBendRef.current); };
  const toggleNova = () => {
    if (IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (nova.connected) { nova.disconnect(); return; }
    if (fullBand) return void connectNova(); // safeties opted out in Settings — skip the prompt
    Alert.alert(
      '⚠️ Photosensitivity warning',
      `The Lumenate Nova flashes light, which can trigger seizures in people with photosensitive epilepsy. Capped at ${MAX_NOVA_STROBE_HZ} Hz. Don't use if you (or anyone who can see it) may be photosensitive; stop if you feel unwell.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'I understand — connect', onPress: connectNova },
      ],
      { cancelable: true },
    );
  };

  // Feed the shared dev panel (docked at the bottom, collapsible) when devMode is on.
  useDevPanelContent(
    devMode ? (
      <View>
        <Text style={styles.devTxt}>
          {`coord ( x ${dev ? Math.round(dev.carrier) : 0} · y ${dev ? dev.beat.toFixed(1) : 0} · z ${dev ? dev.biphotic.toFixed(1) : 0} )\n`}
          {`nova ${dev?.novaConn ? 'on' : 'off'} · tel ${dev ? dev.hz.toFixed(1) : '0'} Hz · rate ${devRate}\n`}
          {`pitch ${dev ? dev.pitch.toFixed(1) : '—'}°  roll ${dev ? dev.roll.toFixed(1) : '—'}°  (smoothed ${dev ? dev.sPitch.toFixed(0) : '—'}/${dev ? dev.sRoll.toFixed(0) : '—'})\n`}
          {`push ${dev?.pushing ? 'YES' : 'no'} · pressure ${dev ? dev.pressure : 0}\n`}
          {`carr ${dev ? Math.round(dev.carrier) : 0} · beat ${dev ? dev.beat.toFixed(1) : 0} (bend ${dev ? (dev.bend >= 0 ? '+' : '') + dev.bend.toFixed(1) : 0}) · bal ${dev ? dev.balance.toFixed(2) : 0}\n`}
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
    ) : null,
    [devMode, dev, devRate],
  );

  const core = carrierColorVibrant(carrier);
  const halo = carrierColor(carrier);
  // Outer ring: still until running, then pulses out at the beat. Inner orb: a
  // slight swell at the biphotic rate when set, else a slow calm breath.
  const haloScale = running ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.14] }) : 1;
  const orbScale = biphActive
    ? innerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.03] })
    : breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] });
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
        <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: halo, opacity: haloOpacity, transform: [{ scale: haloScale }] }]} />
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
  devTxt: { color: '#8FE3C2', fontSize: 11, lineHeight: 16, fontFamily: 'Courier' },
  devRates: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 },
  devRatesLabel: { color: COLORS.textMuted, fontSize: 11, marginRight: 2 },
  devRateBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#141C28' },
  devRateOn: { backgroundColor: COLORS.accentGreen },
  devRateTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
