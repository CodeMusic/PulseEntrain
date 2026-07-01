import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setMixWithOthers } from '../audio/binauralEngine';

// App-wide user settings / profile. Local-only for now (no account) — a name for
// personalised greetings + goal notes, plus general preferences. A future login
// can hydrate the same shape from a backend without changing consumers. (Track
// art is always the signature donut, so there's no track-style setting.)
const KEY_NAME = '@pulseentrain/profileName';
const KEY_MIX = '@pulseentrain/mixWithOthers';

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [name, setNameState] = useState('');
  const [mixWithOthers, setMixState] = useState(true); // blend with other apps' audio
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

  return (
    <SettingsContext.Provider value={{ name, setName, mixWithOthers, setMix, loaded }}>
      {children}
    </SettingsContext.Provider>
  );
}
