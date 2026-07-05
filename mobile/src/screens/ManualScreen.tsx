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
import { useLumi } from '../lumi/LumiProvider';
import { useLightpad } from '../lightpad/LightpadProvider';
import { midiNoteToHz, noteName } from '../shared/lumiProtocol';
import { useSessions } from '../wellness/SessionsProvider';
import NovaExplorer from '../components/NovaExplorer';
import { usePhoneOrientation, PHONE_SUPPORTED } from '../sensors/usePhoneOrientation';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';
import { useSessionExitGuard } from '../session/useSessionExitGuard';
import { useSettings } from '../settings/SettingsProvider';
import { useDevLines } from '../dev/DevPanel';

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

// Explore mode: head orientation → binaural space. Full-scale tilt (±TILT°) sweeps
// the whole range. pitch (look up/down) → beat; roll (tilt L/R, the "azimuth") →
// carrier. (True yaw/turning isn't sensed by an accelerometer.)
const BEAT_MIN = 1, BEAT_MAX = 40, CARR_MIN = 80, CARR_MAX = 500, TILT = 45;
// LUMI: white keys → carrier, black keys → beat. Beat from the black key's pitch
// (~0.8 Hz/semitone up from C3); octave-shifting raises both. Ceil a bit past 40.
const BEAT_CEIL = 50;
const BEAT_GLIDE = 0.7; // seconds — beat changes sweep (like the carrier) instead of jumping
const LUMI_BASE_NOTE = 48; // C3 ≈ 0 beat
const LUMI_BEAT_PER_SEMI = 0.8;
const isAccidental = n => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12); // black key
// ROLI Lightpad Block: its default note grid is 5×5 from C3 (48), +1 semitone per
// column, +5 per row (confirmed from device logs). We decode each touch's note
// into (column, row) and map the WHOLE grid to the binaural space: column (X) →
// carrier over the full 80–500 Hz, row (Y) → beat 0–40 Hz. MPE glide (pitch bend)
// slides the carrier across columns; MPE slide (CC74) trims the beat within rows.
const LP_BASE = 48, LP_COLS = 5, LP_ROWS = 5, LP_ROW_OFFSET = 5;
const LP_CARR_MIN = 80, LP_CARR_MAX = 500, LP_BEAT_MAX = 40;
const LP_BEND_PER_COL = 170; // 14-bit pitch-bend units ≈ one semitone (one column) at ±48 st range
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mapRange = (v, inA, inB, outA, outB) => outA + ((v - inA) / ((inB - inA) || 1)) * (outB - outA);

export default function ManualScreen() {
  const nova = useNova();
  const pulsetto = usePulsetto();
  const lumiKeys = useLumi();
  const lightpad = useLightpad();
  const sessions = useSessions();
  const [lastNote, setLastNote] = useState(null); // last LUMI note played
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
  const [trackMode, setTrackMode] = useState('off'); // off | head (Nova) | phone
  const explore = trackMode !== 'off';
  const runningRef = useRef(false);
  runningRef.current = running;
  useSessionExitGuard(running); // confirm before an accidental tap leaves a live session
  const uiSettings: any = useSettings() || {};
  const devMode = !!uiSettings.devMode;
  const fullBand = !!uiSettings.fullBand;
  useDevLines(
    devMode ? [
      `manual · ${running ? 'running' : 'idle'} · carrier ${Math.round(carrier)} · beat ${beat.toFixed(1)}`,
      `nova ${nova.connected ? 'on' : 'off'} · stim ${pulsetto.connected ? 'on' : 'off'} · lumi ${lumiKeys.connected ? 'on' : 'off'} · pad ${lightpad.connected ? 'on' : 'off'}`,
    ] : null,
    [devMode, running, carrier, beat, nova.connected, pulsetto.connected, lumiKeys.connected, lightpad.connected],
  );
  const baseBeatRef = useRef(10); // the "settled" beat; black-key bend offsets around it
  const baseCarrierNoteRef = useRef(60); // last white key's MIDI note; white-key bend offsets ±1 semitone
  const lastKeyTypeRef = useRef('white'); // route pitch-bend: white → carrier, black → beat
  const lpColRef = useRef(2); // Lightpad: touched cell column (X → carrier) + fine bend
  const lpRowRef = useRef(2); // touched cell row (Y → beat)
  const lpBendRef = useRef(0); // fine X offset (columns) from MPE pitch bend
  const lpSlideRef = useRef(0); // fine Y offset (rows) from MPE slide (CC74)
  const motionZeroRef = useRef({ pitch: 0, roll: 0 }); // head Center calibration
  const lastSampleRef = useRef({ pitch: 0, roll: 0 }); // latest raw head sample
  const phoneZeroRef = useRef({ pitch: 0, heading: 0 }); // phone Center calibration
  const lastPhoneRef = useRef({ pitch: 0, heading: 0 }); // latest raw phone sample
  const phone = usePhoneOrientation(trackMode === 'phone');

  // Shared: set carrier/beat live from a steered value.
  const steer = (b, c) => {
    baseBeatRef.current = b;
    setBeat(Math.round(b * 10) / 10);
    setCarrier(Math.round(c));
    if (runningRef.current && engineRef.current) {
      engineRef.current.setBeat(b);
      engineRef.current.setCarrier(c);
    }
    if (nova.connected && !novaOverrideRef.current) nova.setFrequency(b);
  };

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

  // Head tracking: Nova accelerometer → beat (look up/down) + carrier (tilt L/R).
  useEffect(() => {
    if (trackMode !== 'head' || !nova.connected || !nova.setMotionListener) return;
    if (nova.setTelemetryRate) nova.setTelemetryRate(10); // ask for faster cadence (best-effort)
    nova.setMotionListener(s => {
      lastSampleRef.current = { pitch: s.pitch, roll: s.roll };
      const p = s.pitch - motionZeroRef.current.pitch; // look up/down
      const r = s.roll - motionZeroRef.current.roll; // tilt L/R ("azimuth")
      // look UP raises the beat; tilt RIGHT raises the carrier (tilt LEFT lowers).
      steer(
        clamp(mapRange(p, -TILT, TILT, BEAT_MAX, BEAT_MIN), BEAT_MIN, BEAT_MAX),
        clamp(mapRange(r, -TILT, TILT, CARR_MIN, CARR_MAX), CARR_MIN, CARR_MAX),
      );
    });
    return () => {
      nova.setMotionListener(null);
      if (nova.setTelemetryRate) nova.setTelemetryRate(1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackMode, nova.connected]);

  // Phone tracking: device orientation → beat (point up/down) + carrier (compass
  // azimuth — true left/right turning, which the phone can do and the Nova can't).
  useEffect(() => {
    if (trackMode !== 'phone' || !phone) return;
    lastPhoneRef.current = { pitch: phone.pitch, heading: phone.heading };
    const p = phone.pitch - phoneZeroRef.current.pitch; // point up → positive
    let h = phone.heading - phoneZeroRef.current.heading; // compass delta
    if (h > 180) h -= 360;
    if (h < -180) h += 360;
    steer(
      clamp(mapRange(p, -TILT, TILT, BEAT_MIN, BEAT_MAX), BEAT_MIN, BEAT_MAX), // up raises
      clamp(mapRange(h, -90, 90, CARR_MIN, CARR_MAX), CARR_MIN, CARR_MAX), // turn right raises
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, trackMode]);

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
    const eng = engineRef.current; // fade out, then stop the engine after the fade
    if (eng) {
      try { eng.fadeOut(0.8); } catch (e) {}
      setTimeout(() => { try { eng.stop(); } catch (e) {} }, 850);
    }
    try { nova.stopStrobe(); } catch (e) {}
    try { await pulsetto.stopSession(); } catch (e) {} // unconditional — provider uses live refs
    logIfCounted();
    setRunning(false);
    setRemaining(0);
    KeepAwake.deactivate();
  };

  const start = async () => {
    const e = ensureEngine();
    e.start({ carrier, beat, volume, background: noise });
    e.fadeIn(1.0); // ease in instead of an abrupt start
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

  // LUMI Keys → binaural instrument: WHITE keys set the carrier, BLACK keys set the
  // beat (by pitch); pitch-bend trims the beat ±0.5 Hz; the octave button raises
  // both. (Slide/press also map on 5D units.) Expression streams fast, so drive the
  // engine every message but throttle React state (UI) to ~15 fps.
  const lumiUiRef = useRef(0);
  useEffect(() => {
    if (!lumiKeys.connected || !lumiKeys.setNoteListener) return;
    const uiTick = fn => {
      const now = Date.now();
      if (now - lumiUiRef.current > 66) {
        lumiUiRef.current = now;
        fn();
      }
    };
    const applyBeat = (b, glideS = 0) => {
      const v = clamp(b, BEAT_MIN, BEAT_CEIL);
      if (runningRef.current && engineRef.current) {
        if (glideS > 0) engineRef.current.glideBeat(v, glideS);
        else engineRef.current.setBeat(v);
      }
      if (nova.connected && !novaOverrideRef.current) nova.setFrequency(v);
      uiTick(() => setBeat(Math.round(v * 10) / 10));
    };
    // White-key bend: carrier offset in semitones (±1 reaches the next sharp/flat).
    const applyCarrierBend = (semiOffset, glideS = 0.06) => {
      const hz = clamp(midiNoteToHz(baseCarrierNoteRef.current + semiOffset), 65, 1100);
      if (runningRef.current && engineRef.current) engineRef.current.glideCarrier(hz, glideS);
      uiTick(() => setCarrier(Math.round(hz)));
    };
    lumiKeys.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        if (isAccidental(ev.note)) {
          // Black key → beat (from its pitch); glides, persists on release.
          const b = clamp((ev.note - LUMI_BASE_NOTE) * LUMI_BEAT_PER_SEMI, BEAT_MIN, BEAT_CEIL);
          baseBeatRef.current = b;
          lastKeyTypeRef.current = 'black';
          setLastNote(noteName(ev.note));
          applyBeat(b, BEAT_GLIDE);
        } else {
          // White key → carrier (octave control moves it; fusion holds to ~1 kHz).
          baseCarrierNoteRef.current = ev.note;
          lastKeyTypeRef.current = 'white';
          const hz = clamp(midiNoteToHz(ev.note), 65, 1100);
          setCarrier(Math.round(hz));
          setLastNote(noteName(ev.note));
          if (runningRef.current && engineRef.current) engineRef.current.glideCarrier(hz, 0.9);
        }
      } else if (ev.type === 'noteOff') {
        // Spring the bent axis back to its base when the key lifts.
        if (isAccidental(ev.note)) applyBeat(baseBeatRef.current);
        else applyCarrierBend(0);
      } else if (ev.type === 'pitchBend') {
        // Bend the axis the last-played key controls.
        if (lastKeyTypeRef.current === 'white') {
          applyCarrierBend(clamp(ev.value * 0.007, -1, 1)); // ±1 semitone → reach the sharp/flat
        } else {
          applyBeat(baseBeatRef.current + clamp(ev.value * 0.004, -0.5, 0.5)); // ±0.5 Hz fine trim
        }
      } else if (ev.type === 'cc' && ev.controller === 74) {
        const b = clamp(mapRange(ev.value, 0, 127, BEAT_MIN, BEAT_MAX), BEAT_MIN, BEAT_MAX);
        baseBeatRef.current = b; // 5D slide also sets the beat
        applyBeat(b, 0.2);
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        const v = clamp(mapRange(ev.value, 0, 127, 0.25, 1), 0.25, 1);
        if (runningRef.current && engineRef.current) engineRef.current.setVolume(v);
        uiTick(() => setVolume(v));
      }
    });
    return () => lumiKeys.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lumiKeys.connected]);

  const toggleLumi = val => {
    if (val && IS_WEB) return nativeOnlyNotice('LUMI Keys');
    if (val) lumiKeys.connect();
    else lumiKeys.disconnect();
  };

  // ROLI Lightpad Block → an XY binaural pad. Each touched cell decodes to a
  // (column, row): column spans the carrier across the full 80–500 Hz, row spans
  // the beat 0–40 Hz — so touching a corner reaches the extremes. MPE glide slides
  // the carrier between columns, MPE slide trims the beat, press (Z) rides volume.
  // It holds where you lift off. If the axes feel scrambled, the pad's grid differs
  // from 5×5 / C3 — retune LP_BASE / LP_COLS / LP_ROW_OFFSET above.
  const lpUiRef = useRef(0);
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const uiTick = fn => {
      const now = Date.now();
      if (now - lpUiRef.current > 66) { lpUiRef.current = now; fn(); }
    };
    const applyLp = () => {
      const col = clamp(lpColRef.current + lpBendRef.current, 0, LP_COLS - 1);
      const row = clamp(lpRowRef.current + lpSlideRef.current, 0, LP_ROWS - 1);
      const c = mapRange(col, 0, LP_COLS - 1, LP_CARR_MIN, LP_CARR_MAX);
      const b = clamp(mapRange(row, 0, LP_ROWS - 1, BEAT_MIN, LP_BEAT_MAX), BEAT_MIN, BEAT_CEIL);
      baseBeatRef.current = b;
      if (runningRef.current && engineRef.current) {
        engineRef.current.glideCarrier(c, 0.12);
        engineRef.current.glideBeat(b, 0.12);
      }
      if (nova.connected && !novaOverrideRef.current) nova.setFrequency(b);
      uiTick(() => { setCarrier(Math.round(c)); setBeat(Math.round(b * 10) / 10); });
    };
    lightpad.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        const n = ev.note - LP_BASE;
        const row = clamp(Math.floor(n / LP_ROW_OFFSET), 0, LP_ROWS - 1);
        const col = clamp(n - row * LP_ROW_OFFSET, 0, LP_COLS - 1);
        lpRowRef.current = row;
        lpColRef.current = col;
        lpBendRef.current = 0; // a fresh touch re-centres the fine trims
        lpSlideRef.current = 0;
        setLastNote(noteName(ev.note));
        applyLp();
      } else if (ev.type === 'pitchBend') {
        lpBendRef.current = ev.value / LP_BEND_PER_COL; // MPE glide → carrier columns (X)
        applyLp();
      } else if (ev.type === 'cc' && ev.controller === 74) {
        lpSlideRef.current = ((ev.value - 63) / 63) * (LP_ROWS - 1); // MPE slide → beat rows (Y)
        applyLp();
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        const v = clamp(mapRange(ev.value, 0, 127, 0.25, 1), 0.25, 1);
        if (runningRef.current && engineRef.current) engineRef.current.setVolume(v);
        uiTick(() => setVolume(v));
      }
      // noteOff: leave carrier/beat where they landed — the space holds.
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  const toggleLightpad = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Lightpad Block');
    if (val) lightpad.connect();
    else lightpad.disconnect();
  };

  // live controls
  const onBeat = v => {
    baseBeatRef.current = v;
    setBeat(v);
    if (running) engineRef.current?.glideBeat(v, BEAT_GLIDE); // sweep to the new beat, like the carrier
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

  const connectNova = async () => { const ok = await nova.connect(); if (ok && running) nova.startStrobe(beat); };
  const toggleNova = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (!val) return nova.disconnect();
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
        <Slider minimumValue={0.5} maximumValue={50} step={0.5} value={beat} onValueChange={onBeat} disabled={explore}
          minimumTrackTintColor={COLORS.accentBlue} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" style={styles.slider} />
        <View style={styles.scaleRow}>
          {BANDS.map(b => (
            <Text key={b} style={[styles.scaleTxt, bandFor(beat) === b && styles.scaleTxtOn]}>{b}</Text>
          ))}
        </View>

        <Text style={[styles.label, { color: carrierColor(carrier) }]}>Carrier · {Math.round(carrier)} Hz</Text>
        <Slider minimumValue={80} maximumValue={500} step={5} value={carrier} onValueChange={onCarrier} disabled={explore}
          minimumTrackTintColor={carrierColor(carrier)} maximumTrackTintColor={COLORS.bgCardLight}
          thumbTintColor={carrierColor(carrier)} style={styles.slider} />

        {/* EXPLORE — motion steers the binaural space */}
        <View style={styles.exploreRow}>
          <Text style={styles.label}>🧭 Explore (motion)</Text>
        </View>
        <View style={styles.segmented}>
          {[
            ['off', 'Off', true],
            ['head', 'Head (Nova)', nova.connected],
            ['phone', 'Phone', PHONE_SUPPORTED],
          ].map(([k, lbl, enabled]) => (
            <TouchableOpacity
              key={k}
              disabled={!enabled}
              onPress={() => setTrackMode(k)}
              style={[styles.segBtn, trackMode === k && styles.segBtnOn, !enabled && styles.segBtnOff]}>
              <Text style={[styles.segTxt, trackMode === k && styles.segTxtOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.deviceSub}>
          {trackMode === 'head'
            ? 'Look up/down = beat · tilt L/R = carrier'
            : trackMode === 'phone'
            ? 'Point up/down = beat · turn (compass) = carrier'
            : !nova.connected && !PHONE_SUPPORTED
            ? 'Connect the Nova (head) — phone tracking needs the sensors module on native'
            : 'Look around to explore the binaural space'}
        </Text>
        {explore ? (
          <View style={styles.exploreReadout}>
            <Text style={[styles.exploreVal, { color: carrierColor(carrier) }]}>
              carrier {Math.round(carrier)} Hz · beat {beat.toFixed(1)} Hz ({bandFor(beat)})
            </Text>
            <TouchableOpacity
              style={styles.centerBtn}
              onPress={() => {
                if (trackMode === 'phone') phoneZeroRef.current = { ...lastPhoneRef.current };
                else motionZeroRef.current = { ...lastSampleRef.current };
              }}>
              <Text style={styles.centerTxt}>Center</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={styles.label}>Background noise</Text>
        <View style={styles.chips}>
          {BACKGROUNDS.map(bg => (
            <TouchableOpacity key={bg} onPress={() => onNoise(bg)} style={[styles.chip, noise === bg && styles.chipOn]}>
              <Text style={[styles.chipTxt, noise === bg && styles.chipTxtOn]}>{BG_LABEL[bg]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Session volume</Text>
        <Text style={styles.subLabel}>PulseEntrain's tones only — turn down to sit quietly under a blended app.</Text>
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

      {/* LUMI Keys — a played note sets the carrier (binaural piano) */}
      <View style={styles.card}>
        <View style={styles.deviceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceTitle}>LUMI Keys</Text>
            <Text style={styles.deviceSub}>
              {IS_WEB
                ? 'Keyboard — in the app'
                : lumiKeys.connected
                ? lastNote
                  ? `carrier ${Math.round(carrier)} · beat ${beat.toFixed(1)} Hz — white=carrier · black=beat`
                  : 'Connected — white keys = carrier · black keys = beat · bend = ±0.5 Hz'
                : lumiKeys.status === 'scanning'
                ? 'Searching…'
                : lumiKeys.status === 'notfound'
                ? 'Not found — is it on and nearby?'
                : 'Binaural piano — a note sets the carrier'}
            </Text>
          </View>
          <Switch value={lumiKeys.connected} disabled={IS_WEB} onValueChange={toggleLumi}
            trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }} thumbColor="#fff" />
        </View>
      </View>

      {/* ROLI Lightpad Block — an XY pad: left↔right = carrier, up↔down = beat */}
      <View style={styles.card}>
        <View style={styles.deviceRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceTitle}>Lightpad Block</Text>
            <Text style={styles.deviceSub}>
              {IS_WEB
                ? 'XY pad — in the app'
                : lightpad.connected
                ? lastNote
                  ? `carrier ${Math.round(carrier)} · beat ${beat.toFixed(1)} Hz — ←→ carrier · ↑↓ beat · press = volume`
                  : 'Connected — glide ←→ for carrier, ↑↓ for beat, press for volume'
                : lightpad.status === 'scanning'
                ? 'Searching…'
                : lightpad.status === 'notfound'
                ? 'Not found — is it on and nearby?'
                : 'Touch pad — feel around the binaural space'}
            </Text>
          </View>
          <Switch value={lightpad.connected} disabled={IS_WEB} onValueChange={toggleLightpad}
            trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }} thumbColor="#fff" />
        </View>
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
  subLabel: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: COLORS.bgCardLight, alignItems: 'center' },
  chipOn: { backgroundColor: COLORS.accentBlue },
  chipTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: '#fff' },
  deviceRow: { flexDirection: 'row', alignItems: 'center' },
  deviceTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  deviceSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  exploreRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, borderTopWidth: 1, borderTopColor: COLORS.divider, paddingTop: 14 },
  segmented: { flexDirection: 'row', backgroundColor: COLORS.bgCardLight, borderRadius: 10, padding: 3, marginTop: 8, gap: 3 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segBtnOn: { backgroundColor: COLORS.accentBlue },
  segBtnOff: { opacity: 0.35 },
  segTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700' },
  segTxtOn: { color: '#fff' },
  exploreReadout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  exploreVal: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], flex: 1 },
  centerBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: COLORS.bgCardLight },
  centerTxt: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700' },
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
