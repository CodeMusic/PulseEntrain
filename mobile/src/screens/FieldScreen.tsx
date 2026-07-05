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
import { LP_COLS, LP_ROWS, LP_ROW_OFFSET, LP_BASE, LP_BEND_PER_COL, decodeCell } from '../shared/lightpadGrid';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

// Field Meditation Mode — an immersive, eyes-closed frame around the same engine
// as Manual. Wearing beats + Nova (light) + Pulsetto, you "feel around" a ROLI
// Lightpad Block and one touch moves the whole *field* at once (synesthetic):
//   left↔right  → carrier frequency, and the Nova flash pans toward your finger
//   up↔down     → beat frequency (drags the Nova flash rate with it)
//   press (Z)   → field intensity: audio volume + light brightness + stim
// It holds where you lift off, so you can rest in a spot of the field.
const CARR_MIN = 80, CARR_MAX = 500; // full carrier sweep across the pad's width
const BEAT_MIN = 1, BEAT_MAX = 40; // beat / flash-rate sweep across its height
const FIELD_PULSE_INTENSITY = 4; // Pulsetto session base (1–9); press nudges around it
const FIELD_LIGHT_PAN = true; // pan the Nova flash left/right with carrier X (tune on device)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mapRange = (v, inA, inB, outA, outB) => outA + ((v - inA) / ((inB - inA) || 1)) * (outB - outA);

export default function FieldScreen() {
  const nova = useNova();
  const pulsetto = usePulsetto();
  const lightpad = useLightpad();

  const [carrier, setCarrier] = useState(200);
  const [beat, setBeat] = useState(10);
  const [intensity, setIntensity] = useState(0.7); // 0..1 field intensity (volume/brightness)
  const [running, setRunning] = useState(false);

  const engineRef = useRef(null);
  const runningRef = useRef(false);
  runningRef.current = running;

  // Lightpad decode state: base cell + fine bend/slide offsets (see Manual mode).
  const colRef = useRef(2);
  const rowRef = useRef(2);
  const bendRef = useRef(0);
  const slideRef = useRef(0);
  const uiRef = useRef(0);
  const novaPanRef = useRef(0); // throttle Nova pan BLE writes
  const novaBrightRef = useRef(0); // throttle Nova brightness BLE writes
  const pulseRef = useRef(0); // throttle Pulsetto intensity BLE writes

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new BinauralEngine();
    return engineRef.current;
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

  // Tear down on unmount (leaving the screen ends the session).
  useEffect(
    () => () => {
      try { engineRef.current?.stop(); } catch (e) {}
      try { nova.stopStrobe(); } catch (e) {}
      if (pulsetto.sessionActive) { try { pulsetto.stopSession(); } catch (e) {} }
      KeepAwake.deactivate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const uiTick = fn => {
    const now = Date.now();
    if (now - uiRef.current > 66) { uiRef.current = now; fn(); }
  };
  const throttle = (ref, ms, fn) => {
    const now = Date.now();
    if (now - ref.current > ms) { ref.current = now; fn(); }
  };

  // The synesthetic mapping. Registered whenever a Lightpad is connected; device
  // writes are gated on a running session, but the readouts update either way so
  // you can see where a touch lands before you start.
  useEffect(() => {
    if (!lightpad.connected || !lightpad.setNoteListener) return;
    const applyField = () => {
      const xN = clamp((colRef.current + bendRef.current) / (LP_COLS - 1), 0, 1);
      const yN = clamp((rowRef.current + slideRef.current) / (LP_ROWS - 1), 0, 1);
      const c = CARR_MIN + xN * (CARR_MAX - CARR_MIN);
      const b = BEAT_MIN + yN * (BEAT_MAX - BEAT_MIN);
      if (runningRef.current && engineRef.current) {
        engineRef.current.glideCarrier(c, 0.12);
        engineRef.current.glideBeat(b, 0.12);
      }
      if (runningRef.current && nova.connected) {
        nova.setFrequency(b); // flash rate follows the beat (cheap — no BLE write here)
        if (FIELD_LIGHT_PAN) {
          throttle(novaPanRef, 120, () => {
            // Pan the flash toward the finger: the near eye flashes (level 0),
            // the far eye holds steady (level up = washes its flicker out).
            const leftBias = clamp(1 - 2 * xN, 0, 1);
            const rightBias = clamp(2 * xN - 1, 0, 1);
            nova.setSyncedValues({ lLevel: rightBias, rLevel: leftBias });
          });
        }
      }
      uiTick(() => { setCarrier(Math.round(c)); setBeat(Math.round(b * 10) / 10); });
    };
    lightpad.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        colRef.current = col;
        rowRef.current = row;
        bendRef.current = 0;
        slideRef.current = 0;
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
        if (runningRef.current && nova.connected) {
          throttle(novaBrightRef, 120, () => nova.setMasterBrightness(i));
        }
        if (runningRef.current && pulsetto.sessionActive) {
          // Gently nudge stim around the base — heavily throttled so we don't
          // flood the vagus device, and kept in a modest range for comfort.
          throttle(pulseRef, 1000, () => pulsetto.setIntensity(Math.round(mapRange(i, 0.2, 1, 2, 6))));
        }
        uiTick(() => setIntensity(i));
      }
      // noteOff: hold where you left off — rest in that spot of the field.
    });
    return () => lightpad.setNoteListener(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightpad.connected]);

  const start = async () => {
    const e = ensureEngine();
    e.start({ carrier, beat, volume: intensity, background: 'none' });
    e.fadeIn(1.2); // ease into the field
    if (nova.connected) { nova.startStrobe(beat); nova.setMasterBrightness(intensity); }
    if (pulsetto.connected) { try { await pulsetto.startSession(FIELD_PULSE_INTENSITY); } catch (er) {} }
    setRunning(true);
    KeepAwake.activate();
  };

  const stop = async () => {
    const eng = engineRef.current;
    if (eng) {
      try { eng.fadeOut(1.0); } catch (e) {}
      setTimeout(() => { try { eng.stop(); } catch (e) {} }, 1050);
    }
    try { nova.stopStrobe(); } catch (e) {}
    if (pulsetto.sessionActive) { try { await pulsetto.stopSession(); } catch (e) {} }
    setRunning(false);
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
      {/* Setup chips — hidden once you enter the field for a clean, dark space. */}
      {!running ? (
        <View style={styles.setup}>
          <Text style={styles.setupTitle}>Wear your devices, then feel around the block.</Text>
          <View style={styles.chips}>
            <Chip label="Beats" on hint="always on" />
            <Chip label="Lightpad" on={lightpad.connected} onPress={toggleLightpad}
              hint={IS_WEB ? 'app only' : lightpad.connected ? 'the field controller' : lightpad.status === 'scanning' ? 'searching…' : 'tap to connect'} />
            <Chip label="Light" on={nova.connected} onPress={toggleNova}
              hint={IS_WEB ? 'app only' : nova.connected ? 'Nova' : 'tap to connect'} />
            <Chip label="Stim" on={pulsetto.connected} onPress={togglePulsetto}
              hint={IS_WEB ? 'app only' : pulsetto.connected ? 'Pulsetto' : pulsetto.scanning ? 'searching…' : 'tap to connect'} />
          </View>
        </View>
      ) : (
        <View style={styles.setup} />
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
            ? '← → carrier   ↑ ↓ beat   press = intensity   · lift to rest'
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
  setup: { minHeight: 92 },
  setupTitle: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111722', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1B2430' },
  chipOn: { borderColor: COLORS.accentBlue, backgroundColor: '#12202E' },
  chipDot: { color: '#3A4658', fontSize: 10, marginRight: 6 },
  chipDotOn: { color: COLORS.accentGreen },
  chipTxt: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  chipTxtOn: { color: COLORS.textPrimary },
  chipHint: { color: COLORS.textMuted, fontSize: 11, marginLeft: 6 },
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
