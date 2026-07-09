import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setMixWithOthers } from '../audio/binauralEngine';
import { setSyncEnabled as setHealthSyncEnabled } from '../wellness/appleHealth';

// App-wide user settings / profile. Local-only for now (no account) — a name for
// personalised greetings + goal notes, plus general preferences. A future login
// can hydrate the same shape from a backend without changing consumers. (Track
// art is always the signature donut, so there's no track-style setting.)
const KEY_NAME = '@pulseentrain/profileName';
const KEY_MIX = '@pulseentrain/mixWithOthers';
const KEY_DEV = '@pulseentrain/devMode';
const KEY_FULLBAND = '@pulseentrain/fullBand'; // opt out of photosensitivity safeties
const KEY_RELATIVE = '@pulseentrain/relativeControl'; // Field: relative (drag-delta) vs absolute pad
const KEY_STIM = '@pulseentrain/pulsettoStrength'; // default Pulsetto session strength (1–7)
const KEY_EXPLORE = '@pulseentrain/exploreField'; // let head motion bend normal programs
const KEY_HEALTH = '@pulseentrain/healthSync'; // write finished sessions to Apple Health (Mindful Minutes)
const KEY_GAZE = '@pulseentrain/gazeLock'; // lock head pitch/roll (gaze) to require a press

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [name, setNameState] = useState('');
  const [mixWithOthers, setMixState] = useState(true); // blend with other apps' audio
  const [devMode, setDevState] = useState(false); // show on-screen diagnostics
  const [fullBand, setFullBandState] = useState(false); // opt out: full pulse range, no photo prompts
  const [relativeControl, setRelState] = useState(false); // Field: drag-delta control vs absolute pad
  const [pulsettoStrength, setStimState] = useState(4); // default session strength (1–7); push adds +2
  const [exploreField, setExploreState] = useState(false); // head motion bends normal programs
  const [healthSync, setHealthState] = useState(false); // write Mindful Minutes to Apple Health
  const [gazeLock, setGazeState] = useState(false); // head gaze locked to a press (default: free)
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const n = await AsyncStorage.getItem(KEY_NAME);
        if (n != null) setNameState(n);
        const m = await AsyncStorage.getItem(KEY_MIX);
        const on = m == null ? true : m === '1'; // default on
        setMixState(on);
        setMixWithOthers(on); // apply the stored preference to the audio engine
        const d = await AsyncStorage.getItem(KEY_DEV);
        setDevState(d === '1');
        const fb = await AsyncStorage.getItem(KEY_FULLBAND);
        setFullBandState(fb === '1');
        const rc = await AsyncStorage.getItem(KEY_RELATIVE);
        setRelState(rc === '1');
        const st = parseInt(await AsyncStorage.getItem(KEY_STIM), 10);
        if (Number.isFinite(st)) setStimState(Math.max(1, Math.min(7, st)));
        const ex = await AsyncStorage.getItem(KEY_EXPLORE);
        setExploreState(ex === '1');
        const hs = await AsyncStorage.getItem(KEY_HEALTH);
        setHealthState(hs === '1');
        setHealthSyncEnabled(hs === '1'); // prime the Health bridge with the stored pref
        const gz = await AsyncStorage.getItem(KEY_GAZE);
        setGazeState(gz === '1');
      } catch (e) {
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setName = v => {
    setNameState(v);
    AsyncStorage.setItem(KEY_NAME, v || '').catch(() => {});
  };

  const setMix = on => {
    setMixState(on);
    setMixWithOthers(on);
    AsyncStorage.setItem(KEY_MIX, on ? '1' : '0').catch(() => {});
  };

  const setDevMode = on => {
    setDevState(on);
    AsyncStorage.setItem(KEY_DEV, on ? '1' : '0').catch(() => {});
  };

  const setFullBand = on => {
    setFullBandState(on);
    AsyncStorage.setItem(KEY_FULLBAND, on ? '1' : '0').catch(() => {});
  };

  const setRelativeControl = on => {
    setRelState(on);
    AsyncStorage.setItem(KEY_RELATIVE, on ? '1' : '0').catch(() => {});
  };

  const setPulsettoStrength = v => {
    const n = Math.max(1, Math.min(7, Math.round(Number(v) || 1)));
    setStimState(n);
    AsyncStorage.setItem(KEY_STIM, String(n)).catch(() => {});
  };

  const setExploreField = on => {
    setExploreState(on);
    AsyncStorage.setItem(KEY_EXPLORE, on ? '1' : '0').catch(() => {});
  };

  // Enabling requests HealthKit's Mindful write permission (handled in the bridge).
  const setHealthSync = on => {
    setHealthState(on);
    setHealthSyncEnabled(on);
    AsyncStorage.setItem(KEY_HEALTH, on ? '1' : '0').catch(() => {});
  };

  const setGazeLock = on => {
    setGazeState(on);
    AsyncStorage.setItem(KEY_GAZE, on ? '1' : '0').catch(() => {});
  };

  return (
    <SettingsContext.Provider value={{ name, setName, mixWithOthers, setMix, devMode, setDevMode, fullBand, setFullBand, relativeControl, setRelativeControl, pulsettoStrength, setPulsettoStrength, exploreField, setExploreField, healthSync, setHealthSync, gazeLock, setGazeLock, loaded }}>
      {children}
    </SettingsContext.Provider>
  );
}
