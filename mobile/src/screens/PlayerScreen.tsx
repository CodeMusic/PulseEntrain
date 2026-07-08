import React, { useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'one';
import { ScrollView, View, Text, TouchableOpacity, Pressable, Switch, StyleSheet, Alert, ActivityIndicator, PanResponder } from 'react-native';
import TrackPlayer, {
  useProgress,
  usePlaybackState,
  useTrackPlayerEvents,
  Event,
  State,
} from 'react-native-track-player';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme';
import { doseById, imageSource, audioSource, isSynthDose } from '../catalog/data';
import ArtImage from '../components/ArtImage';
import TrackArt from '../components/TrackArt';
import { Stack } from 'one';
import BeatChart, { carrierColor, bandFor } from '../components/BeatChart';
import { carrierColorVibrant } from '../shared/entrainment';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { useLightpad } from '../lightpad/LightpadProvider';
import { LP_COLS, LP_ROWS, LP_BEND_PER_COL, decodeCell } from '../shared/lightpadGrid';
import { springTouch, PRESS_VOL_BOOST } from '../shared/springTouch';
import { useSessionActive } from '../session/SessionGuard';
import { useSettings } from '../settings/SettingsProvider';
import { useDevLines } from '../dev/DevPanel';
import { useNova } from '../nova/NovaProvider';
import { useSessions } from '../wellness/SessionsProvider';
import NovaExplorer from '../components/NovaExplorer';
import { setupPlayer } from '../audio/player';
import { SessionSynth } from '../audio/sessionSynth';
import { IS_WEB } from '../nativeOnly';

const fmt = s => {
  if (!s || s < 0) s = 0;
  const m = Math.floor(s / 60).toString();
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${sec}`;
};
const playCountKey = id => `@pulseentrain/playcount/${id}`;
// Explore Field Space: head motion bends a program the way Field mode does. Values
// mirror Field's head control (anchored to your pose when it engages).
const EX_DEADZONE = 5, EX_PITCH_SPAN = 20, EX_ROLL_MAX = 20;
const EX_ROLL_DEADZONE = 2; // roll: only ±2° stays balanced, then one eye eases to 0.5 Hz by EX_ROLL_MAX
const EX_BEAT_BEND = 3.5, EX_CARR_BEND = 12; // Hz — how far pitch bends beat / carrier
const EX_ALPHA = 0.18, EX_PITCH_SIGN = -1, EX_ROLL_SIGN = 1;
// Touch-drag bend (on-screen): deeper than the head bend, and springs back on release.
const TOUCH_CARR_MAX = 200, TOUCH_BEAT_MAX = 10; // Hz bend range for a full drag
const TOUCH_TRAVEL_PX = 180; // drag distance (px) that reaches the full bend
const exClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const exDz = (d, z) => (Math.abs(d) <= z ? 0 : d - Math.sign(d) * z);
// Track strength (1-7) → default Pulsetto base intensity (1-9): strength + 1, clamped.
const defaultIntensityFor = strength => Math.min(9, Math.max(1, ((strength ?? 4) + 1)));

// A per-node stim is an absolute int 0–9 OR a base-relative token. The slider is
// the base (the value of "="); tokens resolve ±steps against it. null → the base.
const STIM_OFFSETS = { '=': 0, '=-': -1, '=+': 1 };
const resolveStim = (val, base) => {
  if (val == null) return base;
  if (typeof val === 'number') return Math.max(0, Math.min(9, val));
  const off = STIM_OFFSETS[val];
  return off == null ? base : Math.max(0, Math.min(9, base + off));
};

export default function PlayerScreen({ route, navigation }) {
  const { id, usePulsetto: wantPulsetto, useNova: wantNova, strength: chosenStrength } = route.params;
  const dose = doseById(id);
  const pulsetto = usePulsetto();
  const nova = useNova();
  const lightpad = useLightpad();
  const sessions = useSessions();
  const loggedRef = useRef(false); // log a completed session once
  const tp = useProgress(500);

  // A finished playback counts toward the daily goal (same store as Manual mode).
  const logCompletion = secs => {
    if (loggedRef.current || !sessions) return;
    const d = Math.round(secs || 0);
    if (d < 1) return;
    loggedRef.current = true;
    sessions.logSession({ plannedSeconds: d, actualSeconds: d, kind: (dose && dose.category) || 'session' });
  };
  const playbackState = usePlaybackState();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Self-contained (.imedx) doses are synthesized from their scene timeline
  // instead of streamed from an MP3; they keep their own transport state.
  const isSynth = isSynthDose(dose);
  const synthRef = useRef(null);
  const [synthPos, setSynthPos] = useState(0);
  const [synthDur, setSynthDur] = useState((dose && dose.lengthSeconds) || 0);
  const [synthPlaying, setSynthPlaying] = useState(false);
  const [graphMode, setGraphMode] = useState(false); // tap the cover → live beat map
  const [seeking, setSeeking] = useState(false); // dragging the progress slider
  const [seekVal, setSeekVal] = useState(0);
  const novaOverrideRef = useRef(false); // Developer Tools took manual control of the flicker

  const [intensity, setIntensityVal] = useState(
    defaultIntensityFor(chosenStrength != null ? chosenStrength : dose && dose.strength),
  );
  const [volume, setVolume] = useState(1);
  const [lumi, setLumi] = useState(100);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  const pausedForBreakRef = useRef(false);
  const endedRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const connectedRef = useRef(pulsetto.connected);
  connectedRef.current = pulsetto.connected;
  const lastFlashRef = useRef(null); // last Nova flash pattern applied (.imedx hold-forward)
  const lastStimRef = useRef(null); // last raw per-node stim seen (token/int/null)
  const activeStimRef = useRef(null); // current per-node stim; resolves against the base slider
  const lastSentRef = useRef(null); // last resolved value actually written to Pulsetto (dedup)

  const tpPlaying = playbackState?.state === State.Playing;
  const isPlaying = isSynth ? synthPlaying : tpPlaying;
  useSessionActive(isPlaying); // confirm before an accidental tap leaves a playing program
  const uiSettings: any = useSettings() || {};
  const devMode = !!uiSettings.devMode;
  const exploreField = !!uiSettings.exploreField;
  useDevLines(
    devMode ? [
      `program · ${isSynth ? 'synth' : 'track'} · ${isPlaying ? 'playing' : 'paused/stopped'}`,
      `nova ${nova.connected ? 'on' : 'off'} · stim ${pulsetto.connected ? 'on' : 'off'} · pad ${lightpad.connected ? 'on' : 'off'}`,
    ] : null,
    [devMode, isSynth, isPlaying, nova.connected, pulsetto.connected, lightpad.connected],
  );

  // Explore Field Space: while a program plays, the Nova's accelerometer lets you
  // look around — pitch bends the beat + flash rate, roll opens the biphotic — like
  // Field mode, anchored to your head pose when it engages. Off = program as authored.
  const exHeadRef = useRef(null); // smoothed { pitch, roll }
  const exCenterRef = useRef(null); // pose captured when it engaged
  // The program's bend = head part + touch part, summed and pushed to the synth.
  const headBendRef = useRef({ beat: 0, carr: 0 });
  const touchBendRef = useRef({ beat: 0, carr: 0 });
  const applyBend = () => {
    const s = synthRef.current;
    if (isSynth && s && s.setBend) {
      s.setBend(headBendRef.current.beat + touchBendRef.current.beat, headBendRef.current.carr + touchBendRef.current.carr);
    }
  };
  useEffect(() => {
    if (!exploreField || !nova.connected || !isPlaying || !nova.setMotionListener) return;
    if (nova.setTelemetryRate) nova.setTelemetryRate(10);
    exCenterRef.current = null;
    const engageTs = Date.now();
    const apply = () => {
      const s = exHeadRef.current;
      if (!s) return;
      // Auto-center on start: capture the neutral pose once the head has settled
      // (~0.6 s in), so no manual dev-tools calibration is needed.
      if (!exCenterRef.current) {
        if (Date.now() - engageTs < 600) return;
        exCenterRef.current = { pitch: s.pitch, roll: s.roll };
      }
      const c = exCenterRef.current;
      const p = exClamp(exDz((s.pitch - c.pitch) * EX_PITCH_SIGN, EX_DEADZONE), -EX_PITCH_SPAN, EX_PITCH_SPAN) / EX_PITCH_SPAN;
      const dRoll = exDz((s.roll - c.roll) * EX_ROLL_SIGN, EX_ROLL_DEADZONE);
      headBendRef.current = { beat: p * EX_BEAT_BEND, carr: p * EX_CARR_BEND };
      applyBend();
      nova.setBalance(exClamp(dRoll / (EX_ROLL_MAX - EX_ROLL_DEADZONE), -1, 1));
    };
    nova.setMotionListener(s => {
      const prev = exHeadRef.current;
      exHeadRef.current = prev
        ? { pitch: prev.pitch + (s.pitch - prev.pitch) * EX_ALPHA, roll: prev.roll + (s.roll - prev.roll) * EX_ALPHA }
        : { pitch: s.pitch, roll: s.roll };
      apply();
    });
    return () => {
      try { nova.setMotionListener(null); } catch (e) {}
      try { nova.setBalance(0); } catch (e) {}
      headBendRef.current = { beat: 0, carr: 0 };
      applyBend();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exploreField, nova.connected, isPlaying, isSynth]);

  // Touch-drag on the art: bend carrier (X) + beat (Y) as a temporary offset that
  // springs back (with a little bounce) on release, so the program always returns
  // to what it authored. Taps still fall through to the graph toggle.
  const exploreRef = useRef(false);
  exploreRef.current = exploreField && isSynth;
  // Released bends spring home with a natural overshoot (see springTouch). One
  // spring scales both dimensions off their release value, so carrier and beat
  // bounce back together and the bigger pull overshoots more.
  const springCancelRef = useRef<null | (() => void)>(null);
  const cancelSpring = () => { if (springCancelRef.current) { springCancelRef.current(); springCancelRef.current = null; } };
  const springBack = () => {
    cancelSpring();
    const start = { ...touchBendRef.current };
    if (Math.abs(start.beat) < 0.01 && Math.abs(start.carr) < 0.5) {
      touchBendRef.current = { beat: 0, carr: 0 };
      applyBend();
      return;
    }
    springCancelRef.current = springTouch({
      onUpdate: s => { touchBendRef.current = { beat: start.beat * s, carr: start.carr * s }; applyBend(); },
      onRest: () => { touchBendRef.current = { beat: 0, carr: 0 }; applyBend(); springCancelRef.current = null; },
    });
  };
  const panRef = useRef(null);
  if (!panRef.current) {
    panRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => false, // let taps reach the graph toggle
      onMoveShouldSetPanResponder: (e, g) => exploreRef.current && (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6),
      onPanResponderTerminationRequest: () => false, // once we're bending, don't hand the drag back to the ScrollView
      onPanResponderGrant: () => { cancelSpring(); },
      onPanResponderMove: (e, g) => {
        // A program is a fixed journey — the drag is a momentary snap-bend that
        // springs back on release (below). Direct/absolute so it tracks the finger
        // 1:1; the relative "walk & stay" mode is Field-mode-only.
        touchBendRef.current = {
          carr: exClamp(g.dx / TOUCH_TRAVEL_PX, -1, 1) * TOUCH_CARR_MAX,
          beat: exClamp(-g.dy / TOUCH_TRAVEL_PX, -1, 1) * TOUCH_BEAT_MAX,
        };
        applyBend();
      },
      onPanResponderRelease: () => springBack(),
      onPanResponderTerminate: () => springBack(),
    });
  }

  // A ROLI Lightpad Block bends a program too: drag on the pad → the same
  // temporary carrier/beat bend as the on-screen touch, springing back on release.
  const lpColRef = useRef(2);
  const lpRowRef = useRef(2);
  const lpBendRef = useRef(0);
  const lpSlideRef = useRef(0);
  const lpStartRef = useRef(null); // block position at touch-start (absolute-drag reference)
  useEffect(() => {
    // A connected Lightpad always bends a synth program — attaching the block IS
    // the opt-in, so this doesn't wait on the Explore Field Space setting (that
    // gates only the *implicit* surfaces: head motion + on-screen cover drag).
    if (!isSynth || !lightpad.connected || !lightpad.setNoteListener) return;
    const blockPos = () => ({
      x: exClamp((lpColRef.current + lpBendRef.current) / (LP_COLS - 1), 0, 1),
      y: exClamp((lpRowRef.current + lpSlideRef.current) / (LP_ROWS - 1), 0, 1),
    });
    const applyBlock = () => {
      // Same as the on-screen drag: absolute snap-bend off the touch-start cell,
      // springing back on release so the program returns to its authored journey.
      if (!lpStartRef.current) return;
      const p = blockPos();
      touchBendRef.current = {
        carr: exClamp(p.x - lpStartRef.current.x, -1, 1) * TOUCH_CARR_MAX,
        beat: exClamp(p.y - lpStartRef.current.y, -1, 1) * TOUCH_BEAT_MAX, // up on the pad = higher beat
      };
      applyBend();
    };
    lightpad.setNoteListener(ev => {
      if (ev.type === 'noteOn') {
        const { col, row } = decodeCell(ev.note);
        lpColRef.current = col; lpRowRef.current = row; lpBendRef.current = 0; lpSlideRef.current = 0;
        cancelSpring();
        lpStartRef.current = blockPos();
        applyBlock();
      } else if (ev.type === 'pitchBend') {
        lpBendRef.current = ev.value / LP_BEND_PER_COL;
        applyBlock();
      } else if (ev.type === 'cc' && ev.controller === 74) {
        lpSlideRef.current = ((ev.value - 63) / 63) * (LP_ROWS - 1);
        applyBlock();
      } else if (ev.type === 'pressure' || ev.type === 'polyAT') {
        applyPressVol(ev.value / 127); // press harder → a little louder, on top of the base
      } else if (ev.type === 'noteOff') {
        lpStartRef.current = null;
        applyPressVol(0); // lifted → drop the press boost
        springBack(); // lift off the pad → ease back to the authored beat/carrier
      }
    });
    return () => { try { lightpad.setNoteListener(null); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSynth, lightpad.connected]);

  const toggleLightpad = () => {
    if (IS_WEB) return;
    if (lightpad.connected) lightpad.disconnect();
    else if (lightpad.status !== 'scanning') lightpad.connect();
  };
  const lpChipStatus = lightpad.connected ? 'connected' : lightpad.status === 'scanning' ? 'scanning' : 'idle';

  const position = isSynth ? synthPos : tp.position;
  const duration = isSynth ? synthDur : tp.duration;
  const audio = dose ? audioSource(dose.audio) : null;
  const playable = isSynth || !!audio; // a synth dose needs no bundled MP3

  // ---- helpers ----
  const beginAudio = async () => {
    try {
      if (isSynth) {
        synthRef.current?.play();
        setSynthPlaying(true);
      } else {
        await TrackPlayer.play();
      }
    } catch (e) {
      setLoadError(`Couldn't start audio: ${e?.message || e}`);
    }
  };

  const startStim = async () => {
    try {
      await pulsetto.startSession(intensityRef.current);
    } catch (e) {}
  };

  // ---- per-node (.imedx hold-forward) appliers, driven by the synth tick ----
  const applyFlash = f => {
    const flash = f || 'sync';
    if (flash === lastFlashRef.current) return;
    lastFlashRef.current = flash;
    // `level` is STEADY brightness (1 = LED full-on = no visible flash; 0 = pure
    // strobe). So a flashing eye is level 0 / duty 0.5, and a *quiet* eye is level
    // 0 / duty 0 (never pulses → dark). sync flashes both; left/right isolate one.
    const eyes =
      flash === 'left'
        ? { lLevel: 0, lDuty: 0.5, rLevel: 0, rDuty: 0 }
        : flash === 'right'
        ? { lLevel: 0, lDuty: 0, rLevel: 0, rDuty: 0.5 }
        : { lLevel: 0, lDuty: 0.5, rLevel: 0, rDuty: 0.5 };
    try {
      nova.setSyncedValues(eyes);
    } catch (e) {}
  };

  // Send the active stim (per-node, resolved against the base) to Pulsetto. With
  // no per-node stim, this sends the base itself — i.e. the slider drives it.
  const pushStim = () => {
    const resolved = resolveStim(activeStimRef.current, intensityRef.current);
    if (resolved === lastSentRef.current) return; // dedup: no redundant BLE writes
    if (wantPulsetto && pulsetto.connected && pulsetto.sessionActive && !pausedForBreakRef.current) {
      lastSentRef.current = resolved;
      pulsetto.setIntensity(resolved);
    }
  };

  const applyStim = stim => {
    if (stim === lastStimRef.current) return; // hold-forward: only on change
    lastStimRef.current = stim;
    activeStimRef.current = stim; // token or absolute; the slider stays the base
    pushStim();
  };

  const promptNotAttached = () => {
    Alert.alert(
      'Pulsetto not attached',
      "Your Pulsetto isn't connected. Attach it and retry, or continue with a pure binaural session.",
      [
        { text: 'Binaural only', style: 'cancel', onPress: () => beginAudio() },
        {
          text: 'Retry',
          onPress: () => {
            pendingRetryRef.current = true;
            pulsetto.scanForDevices();
            setTimeout(() => {
              if (pendingRetryRef.current && !connectedRef.current) {
                pendingRetryRef.current = false;
                promptNotAttached();
              }
            }, 12000);
          },
        },
      ],
      { cancelable: false },
    );
  };

  const teardown = async () => {
    pendingRetryRef.current = false;
    if (isSynth) {
      try {
        synthRef.current?.stop();
      } catch (e) {}
    } else {
      try {
        await TrackPlayer.reset();
      } catch (e) {}
    }
    try {
      await pulsetto.stopSession(); // unconditional — provider uses live refs
    } catch (e) {}
    try {
      nova.stopStrobe();
    } catch (e) {}
  };
  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;

  // Stop everything when the player loses focus (e.g. tapping Home/title pushes a
  // new screen without unmounting this one — audio would otherwise keep playing).
  useFocusEffect(() => {
    return () => {
      try { teardownRef.current(); } catch (e) {}
      setSynthPlaying(false);
    };
  }, []);

  // ---- load + start on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ---- self-contained (.imedx): synthesize from the scene timeline ----
      if (isSynth) {
        const sd = dose as any; // synth-only fields (scenes/carrier/noise) live on .imedx doses
        const synth = new SessionSynth({
          scenes: sd.scenes,
          carrier: sd.carrier,
          duration: sd.lengthSeconds,
          noise: sd.noise,
          transitionFade: sd.fade,
          volume: 1,
          onTick: (pos, beat, ctx) => {
            setSynthPos(pos);
            if (wantNova && nova.connected && !novaOverrideRef.current) {
              nova.setFrequency(ctx && ctx.flashHz != null ? ctx.flashHz : beat);
              applyFlash(ctx && ctx.flash);
            }
            applyStim(ctx && ctx.intensity);
          },
          onEnded: () => {
            setSynthPlaying(false);
            logCompletion(synth.duration);
            pulsetto.stopSession(); // unconditional — provider uses live refs
            if (wantNova && nova.connected) nova.stopStrobe();
          },
        });
        synthRef.current = synth;
        setSynthDur(synth.duration);
        if (cancelled) return;
        setLoading(false);
        try {
          const k = playCountKey(dose.id);
          const cur = parseInt((await AsyncStorage.getItem(k)) || '0', 10) || 0;
          await AsyncStorage.setItem(k, String(cur + 1));
        } catch (e) {}
        if (wantNova && nova.connected) nova.startStrobe(synth.beatNow());
        if (wantPulsetto && !pulsetto.connected) {
          promptNotAttached();
        } else {
          if (wantPulsetto) await startStim();
          await beginAudio();
        }
        return;
      }

      if (!audio) {
        setLoading(false);
        return;
      }
      try {
        await setupPlayer();
        await TrackPlayer.reset();
        await TrackPlayer.add({
          id: dose.id,
          url: audio,
          title: dose.name,
          artist: dose.category,
          artwork: imageSource(dose.image) || undefined,
        });
        await TrackPlayer.setVolume(1);
      } catch (e) {
        if (cancelled) return;
        setLoadError(`Couldn't load this track: ${e?.message || e}`);
        setLoading(false);
        return;
      }
      if (cancelled) return;
      setLoading(false);

      try {
        const k = playCountKey(dose.id);
        const cur = parseInt((await AsyncStorage.getItem(k)) || '0', 10) || 0;
        await AsyncStorage.setItem(k, String(cur + 1));
      } catch (e) {}

      if (wantNova && nova.connected) nova.startStrobe();

      if (wantPulsetto && !pulsetto.connected) {
        promptNotAttached(); // audio waits for the user's choice
      } else {
        if (wantPulsetto) await startStim();
        await beginAudio();
      }
    })();
    return () => {
      cancelled = true;
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry scan that connects → start stim + audio.
  useEffect(() => {
    if (pendingRetryRef.current && pulsetto.connected) {
      pendingRetryRef.current = false;
      (async () => {
        await startStim();
        await beginAudio();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulsetto.connected]);

  // Async playback errors (bad/unreachable asset, codec issue) surface here.
  useTrackPlayerEvents([Event.PlaybackError], event => {
    setLoadError(`Playback error: ${event?.message || event?.code || 'unknown'}`);
  });

  // Natural end → stop the stim.
  useEffect(() => {
    if (playbackState?.state === State.Ended && !endedRef.current) {
      endedRef.current = true;
      logCompletion(tp.duration);
      pulsetto.stopSession(); // unconditional — provider uses live refs
      if (wantNova && nova.connected) nova.stopStrobe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState]);

  // ---- controls ----
  const togglePlay = async () => {
    if (isPlaying) {
      if (isSynth) {
        synthRef.current?.pause();
        setSynthPlaying(false);
      } else {
        await TrackPlayer.pause();
      }
      if (wantNova && nova.connected) nova.stopStrobe();
      if (wantPulsetto && pulsetto.sessionActive) {
        pausedForBreakRef.current = true;
        await pulsetto.setIntensity(0); // mute stim while paused
        lastSentRef.current = 0; // so resume re-sends the resolved level
      }
    } else {
      if (isSynth) {
        synthRef.current?.play();
        setSynthPlaying(true);
      } else {
        await TrackPlayer.play();
      }
      if (wantNova && nova.connected) nova.startStrobe(isSynth ? synthRef.current?.beatNow() : undefined);
      if (pausedForBreakRef.current) {
        pausedForBreakRef.current = false;
        pushStim(); // restore stim (resolved against base) after a break
      }
    }
  };

  const restart = async () => {
    endedRef.current = false;
    if (isSynth) {
      synthRef.current?.seek(0);
      setSynthPos(0);
      if (!synthRef.current?.playing) {
        synthRef.current?.play();
        setSynthPlaying(true);
      }
    } else {
      await TrackPlayer.seekTo(0);
      await TrackPlayer.play();
    }
    if (wantPulsetto && !pulsetto.sessionActive && pulsetto.connected) {
      await startStim();
    }
    if (wantNova && nova.connected) nova.startStrobe(isSynth ? synthRef.current?.beatNow() : undefined);
  };

  const stopAndBack = async () => {
    await teardown();
    navigation.goBack();
  };

  const onIntensity = v => {
    const val = Math.round(v);
    setIntensityVal(val);
    intensityRef.current = val; // the base (the value of "="); per-node stim resolves against it
    // don't un-mute a paused session; the new value applies on resume
    if (!pausedForBreakRef.current) pushStim();
  };

  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const onVolume = v => {
    setVolume(v);
    if (isSynth) synthRef.current?.setVolume(v);
    else TrackPlayer.setVolume(v);
  };
  // Press (Lightpad Z / future touch) lifts the level a little above the slider's
  // base while held, without moving the slider; pn 0 restores the base.
  const applyPressVol = pn => {
    const target = Math.min(1, volumeRef.current + PRESS_VOL_BOOST * exClamp(pn, 0, 1));
    if (isSynth) synthRef.current?.setVolume(target);
    else TrackPlayer.setVolume(target).catch(() => {});
  };

  const onLumi = v => {
    setLumi(v);
    nova.setMasterBrightness(v / 100);
  };

  // Web: spacebar toggles play/pause (ignored while typing or on a control).
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined') return;
    const onKey = e => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      e.preventDefault();
      togglePlayRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- render ----
  if (!dose) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.muted}>Program not found.</Text>
      </View>
    );
  }

  if (!playable) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.title}>{dose.name}</Text>
        <Text style={styles.notBundled}>
          This track isn't bundled in this local build yet. Only a few demo tracks ship in the app for
          now — streaming/download arrives later.
        </Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryTxt}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Seek to a position (seconds). Works for both transports.
  const doSeek = sec => {
    const t = Math.max(0, Math.min(duration || 0, sec));
    if (isSynth) {
      synthRef.current?.seek(t);
      setSynthPos(t);
    } else {
      TrackPlayer.seekTo(t);
    }
  };
  const headSec = seeking ? seekVal : position; // slider/label follow the drag
  const onCoverTap = () => {
    if (!isSynth) return; // only synth (.imedx) doses have a beat map
    // Single tap toggles the beat map. (Was a double-tap, but the timing window
    // is unreliable through Pressable on web — clicks land outside it.)
    setGraphMode(g => !g);
  };
  const cur = graphMode && isSynth && synthRef.current ? synthRef.current.current() : null;
  // Live carrier (recomputed as the synth ticks) → a faint full-screen tint so the
  // player subtly takes on the current carrier's colour while playing.
  const liveCarrier = isSynth && synthRef.current ? synthRef.current.current().carrier : ((dose && dose.carrier) || 200);
  const pulseLabel = wantPulsetto
    ? pulsetto.connected
      ? ' · Pulsetto on'
      : ' · Pulsetto (not attached)'
    : ' · Binaural only';
  const showIntensity = wantPulsetto && pulsetto.connected;

  // Header tints to the live carrier colour while a synth session plays (binned so
  // the colour only updates when it meaningfully changes, not every tick).
  const headerTint =
    isSynth && isPlaying ? carrierColorVibrant(Math.round(liveCarrier / 8) * 8) : COLORS.bgCard;

  return (
    <>
      <Stack.Screen options={{ headerStyle: { backgroundColor: headerTint } }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Web: toggle on press-in — a quick click's onPress gets eaten by the
          ScrollView responder, so only a held click registered. Native keeps the
          on-release press so it doesn't fight scrolling. */}
      <View {...panRef.current.panHandlers}>
      <Pressable {...(IS_WEB ? { onPressIn: onCoverTap } : { onPress: onCoverTap })}>
        {graphMode && isSynth ? (
          <View style={styles.graphBox}>
            <BeatChart
              scenes={(dose as any).scenes}
              duration={duration}
              baseCarrier={(dose as any).carrier}
              height={244}
              progress={duration > 0 ? position / duration : 0}
            />
          </View>
        ) : isSynth ? (
          <View style={styles.artCenter}>
            <TrackArt
              scenes={(dose as any).scenes}
              carrier={(dose as any).carrier}
              image={imageSource(dose.image)}
              name={dose.name}
              size={252}
              progress={isPlaying && duration > 0 ? position / duration : null}
            />
          </View>
        ) : (
          <ArtImage source={imageSource(dose.image)} height={260} radius={20} hpad={24} />
        )}
      </Pressable>
      </View>
      <Text style={styles.title}>{dose.name}</Text>
      {cur ? (
        <Text style={[styles.sub, { color: carrierColor(cur.carrier) }]}>
          {bandFor(cur.beat)} · {cur.beat.toFixed(1)} Hz · carrier {Math.round(cur.carrier)} Hz
        </Text>
      ) : (
        <Text style={styles.sub}>
          {dose.category}
          {pulseLabel}
        </Text>
      )}

      {/* Connect a Lightpad to bend this program's beat/carrier by touch. Shown for
          any synth (.imedx) program — no Explore Field Space setting required. */}
      {!IS_WEB && isSynth ? (
        <TouchableOpacity
          onPress={toggleLightpad}
          activeOpacity={0.7}
          hitSlop={14}
          style={[styles.lpChip, lpChipStatus === 'connected' && styles.lpChipOn, lpChipStatus === 'scanning' && styles.lpChipBusy]}
        >
          <Text style={[styles.lpChipDot, lpChipStatus === 'connected' && { color: COLORS.accentGreen }, lpChipStatus === 'scanning' && { color: COLORS.accentBlue }]}>●</Text>
          <Text style={styles.lpChipTxt}>
            Lightpad — {lightpad.connected ? 'drag to bend the field' : lpChipStatus === 'scanning' ? 'connecting…' : 'tap to connect'}
          </Text>
        </TouchableOpacity>
      ) : null}

      <Slider
        style={styles.progressSlider}
        minimumValue={0}
        maximumValue={Math.max(1, duration)}
        value={Math.min(headSec, duration || 0)}
        onSlidingStart={() => { setSeekVal(position); setSeeking(true); }}
        onValueChange={setSeekVal}
        onSlidingComplete={v => { doSeek(v); setSeeking(false); }}
        minimumTrackTintColor={COLORS.accentBlue}
        maximumTrackTintColor={COLORS.bgCardLight}
        thumbTintColor="#fff"
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(headSec)}</Text>
        <Text style={styles.time}>{fmt(duration)}</Text>
      </View>

      {loadError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTxt}>{loadError}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={COLORS.accentBlue} style={{ marginTop: 28 }} />
      ) : (
        <View style={styles.controls}>
          <TouchableOpacity onPress={restart} style={styles.ctrlSecondary}>
            <Text style={styles.ctrlSecondaryTxt}>⟲</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={togglePlay} style={styles.ctrlMain}>
            <Text style={styles.ctrlMainTxt}>{isPlaying ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={stopAndBack} style={styles.ctrlSecondary}>
            <Text style={styles.ctrlSecondaryTxt}>■</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pulsetto intensity — only when enabled and connected */}
      {showIntensity && (
        <View style={styles.sliderBlock}>
          <Text style={styles.sliderLabel}>Pulsetto intensity · {intensity}</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={9}
            step={1}
            value={intensity}
            onValueChange={onIntensity}
            minimumTrackTintColor={COLORS.accentGreen}
            maximumTrackTintColor={COLORS.bgCardLight}
            thumbTintColor="#fff"
          />
        </View>
      )}

      {/* Volume */}
      <View style={styles.sliderBlock}>
        <Text style={styles.sliderLabel}>Volume</Text>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={volume}
          onValueChange={onVolume}
          minimumTrackTintColor={COLORS.accentBlue}
          maximumTrackTintColor={COLORS.bgCardLight}
          thumbTintColor="#fff"
        />
      </View>

      {/* Web preview: device modalities are native-only — show them disabled so
          it's clear the iOS / Android app does more (Bluetooth devices). */}
      {IS_WEB ? (
        <View style={styles.deviceCard}>
          {[
            ['Use Pulsetto', 'Vagus nerve stimulation'],
            ['Use Lumenate Nova', 'Light entrainment'],
          ].map(([title, sub]) => (
            <View key={title} style={styles.deviceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceTitle}>{title}</Text>
                <Text style={styles.deviceSub}>{sub}</Text>
              </View>
              <Switch
                value={false}
                disabled
                trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
                thumbColor="#fff"
              />
            </View>
          ))}
          <Text style={styles.deviceHint}>
            Bluetooth devices (Pulsetto · Nova) work in the iOS / Android app.
          </Text>
        </View>
      ) : null}

      {/* Lumi brightness master + in-session pattern explorer (Nova) */}
      {wantNova && nova.connected ? (
        <View style={styles.sliderBlock}>
          <Text style={styles.sliderLabel}>Lumi brightness · {Math.round(lumi)}%</Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            value={lumi}
            onValueChange={onLumi}
            minimumTrackTintColor={COLORS.accentBlueLight}
            maximumTrackTintColor={COLORS.bgCardLight}
            thumbTintColor="#fff"
          />
          <NovaExplorer
            nova={nova}
            showFrequency
            onOverride={v => {
              novaOverrideRef.current = v;
            }}
          />
        </View>
      ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  artCenter: { alignItems: 'center', justifyContent: 'center', height: 260 },
  content: { padding: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: COLORS.textMuted },
  art: { width: '100%', height: 260, borderRadius: 20, backgroundColor: COLORS.bgCardLight },
  graphBox: { height: 260, marginHorizontal: 24, borderRadius: 20, backgroundColor: COLORS.bgCard, paddingTop: 14, paddingHorizontal: 8 },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  sub: { color: COLORS.textSecondary, fontSize: 14, marginTop: 6, textAlign: 'center' },
  lpChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#1B2430', backgroundColor: '#111722' },
  lpChipOn: { borderColor: COLORS.accentGreen, backgroundColor: '#12241C' },
  lpChipBusy: { borderColor: COLORS.accentBlue, backgroundColor: '#12202E' },
  lpChipDot: { color: '#3A4658', fontSize: 10, marginRight: 7 },
  lpChipTxt: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  progressSlider: { width: '100%', height: 36, marginTop: 18 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  time: { color: COLORS.textMuted, fontSize: 12 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 26, gap: 28 },
  ctrlMain: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.accentGreen, justifyContent: 'center', alignItems: 'center' },
  ctrlMainTxt: { color: '#fff', fontSize: 28, fontWeight: '700' },
  ctrlSecondary: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.bgCard, justifyContent: 'center', alignItems: 'center' },
  ctrlSecondaryTxt: { color: COLORS.textPrimary, fontSize: 20 },
  sliderBlock: { marginTop: 22 },
  sliderLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  deviceCard: { marginTop: 24, backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 14 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  deviceTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  deviceSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  deviceHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  slider: { width: '100%', height: 40 },
  notBundled: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 16 },
  errorBox: { marginTop: 20, padding: 14, borderRadius: 12, backgroundColor: 'rgba(255,80,80,0.12)', borderWidth: 1, borderColor: 'rgba(255,80,80,0.4)' },
  errorTxt: { color: '#ff8a8a', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  secondaryBtn: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 24, backgroundColor: COLORS.bgCard },
  secondaryTxt: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
});
