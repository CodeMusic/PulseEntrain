import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// App-wide user settings / profile. Local-only for now (no account) — a name for
// personalised greetings + goal notes. A future login can hydrate the same shape
// from a backend without changing consumers. (Track art is always the signature
// donut, so there's no track-style setting.)
const KEY_NAME = '@pulseentrain/profileName';

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [name, setNameState] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const n = await AsyncStorage.getItem(KEY_NAME);
        if (n != null) setNameState(n);
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

  return (
    <SettingsContext.Provider value={{ name, setName, loaded }}>{children}</SettingsContext.Provider>
  );
}
