import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Pressable, Switch, StyleSheet, Alert, ActivityIndicator } from 'react-native';
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
import BeatChart, { carrierColor, bandFor } from '../components/BeatChart';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
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
    // sync = both eyes, left/right = one eye on (the beat drives the rate via setFrequency)
    const eyes =
      flash === 'left'
        ? { lLevel: 1, rLevel: 0 }
        : flash === 'right'
        ? { lLevel: 0, rLevel: 1 }
        : { lLevel: 1, rLevel: 1 };
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
    if (pulsetto.sessionActive) {
      try {
        await pulsetto.stopSession();
      } catch (e) {}
    }
    try {
      nova.stopStrobe();
    } catch (e) {}
  };

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
            if (pulsetto.sessionActive) pulsetto.stopSession();
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
      if (pulsetto.sessionActive) pulsetto.stopSession();
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

  const onVolume = v => {
    setVolume(v);
    if (isSynth) synthRef.current?.setVolume(v);
    else TrackPlayer.setVolume(v);
  };

  const onLumi = v => {
    setLumi(v);
    nova.setMasterBrightness(v / 100);
  };

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

  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
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

  return (
    <View style={styles.root}>
      {isSynth && isPlaying ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: carrierColor(liveCarrier), opacity: 0.1 }]}
        />
      ) : null}
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Web: toggle on press-in — a quick click's onPress gets eaten by the
          ScrollView responder, so only a held click registered. Native keeps the
          on-release press so it doesn't fight scrolling. */}
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
        ) : (
          <ArtImage source={imageSource(dose.image)} height={260} radius={20} hpad={24} />
        )}
      </Pressable>
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

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(position)}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bgDark },
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: COLORS.textMuted },
  art: { width: '100%', height: 260, borderRadius: 20, backgroundColor: COLORS.bgCardLight },
  graphBox: { height: 260, marginHorizontal: 24, borderRadius: 20, backgroundColor: COLORS.bgCard, paddingTop: 14, paddingHorizontal: 8 },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  sub: { color: COLORS.textSecondary, fontSize: 14, marginTop: 6, textAlign: 'center' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.bgCardLight, marginTop: 24, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.accentBlue },
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
