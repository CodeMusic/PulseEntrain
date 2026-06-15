import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, Image, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import TrackPlayer, { useProgress, usePlaybackState, State } from 'react-native-track-player';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme';
import { doseById, imageSource, audioSource } from '../catalog/data';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { setupPlayer } from '../audio/player';

const fmt = s => {
  if (!s || s < 0) s = 0;
  const m = Math.floor(s / 60).toString();
  const sec = Math.floor(s % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${sec}`;
};
const playCountKey = id => `@pulseentrain/playcount/${id}`;
// Track strength (1-7) → default Pulsetto intensity (1-9): strength + 1, clamped.
const defaultIntensityFor = dose => Math.min(9, Math.max(1, ((dose && dose.strength) || 4) + 1));

export default function PlayerScreen({ route, navigation }) {
  const { id, usePulsetto: wantPulsetto } = route.params;
  const dose = doseById(id);
  const pulsetto = usePulsetto();
  const { position, duration } = useProgress(500);
  const playbackState = usePlaybackState();
  const [loading, setLoading] = useState(true);

  const [intensity, setIntensityVal] = useState(defaultIntensityFor(dose));
  const [volume, setVolume] = useState(1);
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  const pausedForBreakRef = useRef(false);
  const endedRef = useRef(false);
  const pendingRetryRef = useRef(false);
  const connectedRef = useRef(pulsetto.connected);
  connectedRef.current = pulsetto.connected;

  const isPlaying = playbackState?.state === State.Playing;
  const audio = dose ? audioSource(dose.audio) : null;

  // ---- helpers ----
  const beginAudio = async () => {
    try {
      await TrackPlayer.play();
    } catch (e) {}
  };

  const startStim = async () => {
    try {
      await pulsetto.startSession(intensityRef.current);
    } catch (e) {}
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
    try {
      await TrackPlayer.reset();
    } catch (e) {}
    if (pulsetto.sessionActive) {
      try {
        await pulsetto.stopSession();
      } catch (e) {}
    }
  };

  // ---- load + start on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!audio) {
        setLoading(false);
        return;
      }
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
      if (cancelled) return;
      setLoading(false);

      try {
        const k = playCountKey(dose.id);
        const cur = parseInt((await AsyncStorage.getItem(k)) || '0', 10) || 0;
        await AsyncStorage.setItem(k, String(cur + 1));
      } catch (e) {}

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

  // Natural end → stop the stim.
  useEffect(() => {
    if (playbackState?.state === State.Ended && !endedRef.current) {
      endedRef.current = true;
      if (pulsetto.sessionActive) pulsetto.stopSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState]);

  // ---- controls ----
  const togglePlay = async () => {
    if (isPlaying) {
      await TrackPlayer.pause();
      if (wantPulsetto && pulsetto.sessionActive) {
        pausedForBreakRef.current = true;
        await pulsetto.setIntensity(0); // mute stim while paused
      }
    } else {
      await TrackPlayer.play();
      if (pausedForBreakRef.current) {
        pausedForBreakRef.current = false;
        await pulsetto.setIntensity(intensityRef.current); // restore to slider value
      }
    }
  };

  const restart = async () => {
    endedRef.current = false;
    await TrackPlayer.seekTo(0);
    await TrackPlayer.play();
    if (wantPulsetto && !pulsetto.sessionActive && pulsetto.connected) {
      await startStim();
    }
  };

  const stopAndBack = async () => {
    await teardown();
    navigation.goBack();
  };

  const onIntensity = v => {
    const val = Math.round(v);
    setIntensityVal(val);
    intensityRef.current = val;
    // don't un-mute a paused session; the new value applies on resume
    if (!pausedForBreakRef.current) pulsetto.setIntensity(val);
  };

  const onVolume = v => {
    setVolume(v);
    TrackPlayer.setVolume(v);
  };

  // ---- render ----
  if (!dose) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.muted}>Program not found.</Text>
      </View>
    );
  }

  if (!audio) {
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
  const pulseLabel = wantPulsetto
    ? pulsetto.connected
      ? ' · Pulsetto on'
      : ' · Pulsetto (not attached)'
    : ' · Binaural only';
  const showIntensity = wantPulsetto && pulsetto.connected;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Image source={imageSource(dose.image)} style={styles.art} />
      <Text style={styles.title}>{dose.name}</Text>
      <Text style={styles.sub}>
        {dose.category}
        {pulseLabel}
      </Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmt(position)}</Text>
        <Text style={styles.time}>{fmt(duration)}</Text>
      </View>

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 24, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: COLORS.textMuted },
  art: { width: '100%', height: 260, borderRadius: 20, backgroundColor: COLORS.bgCardLight },
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
  slider: { width: '100%', height: 40 },
  notBundled: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 16 },
  secondaryBtn: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 24, backgroundColor: COLORS.bgCard },
  secondaryTxt: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
});
