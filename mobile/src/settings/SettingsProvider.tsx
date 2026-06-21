import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// App-wide user settings / profile. Local-only for now (no account) — a name for
// personalised greetings + goal notes, and the Track Style used to render tracks
// (and the mock art for image-less ones). A future login can hydrate the same
// shape from a backend without changing consumers.
const KEY_NAME = '@pulseentrain/profileName';
const KEY_TRACK_STYLE = '@pulseentrain/trackStyle';
export const TRACK_STYLES = ['bar', 'circle']; // circle = donut radial chart

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [name, setNameState] = useState('');
  const [trackStyle, setTrackStyleState] = useState('bar');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [n, ts] = await Promise.all([
          AsyncStorage.getItem(KEY_NAME),
          AsyncStorage.getItem(KEY_TRACK_STYLE),
        ]);
        if (n != null) setNameState(n);
        if (ts === 'bar' || ts === 'circle') setTrackStyleState(ts);
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
  const setTrackStyle = v => {
    if (v !== 'bar' && v !== 'circle') return;
    setTrackStyleState(v);
    AsyncStorage.setItem(KEY_TRACK_STYLE, v).catch(() => {});
  };

  return (
    <SettingsContext.Provider value={{ name, setName, trackStyle, setTrackStyle, loaded }}>
      {children}
    </SettingsContext.Provider>
  );
}
