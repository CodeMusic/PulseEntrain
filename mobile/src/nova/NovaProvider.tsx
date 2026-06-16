import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NovaController } from './novaController';

const NovaContext = createContext(null);
export const useNova = () => useContext(NovaContext);

// Single shared Lumenate Nova connection, used by both Manual (binaural) and the
// catalog player. Mirrors the Pulsetto provider pattern.
export function NovaProvider({ children }) {
  const ctrlRef = useRef(null);
  const [status, setStatus] = useState('idle');
  if (!ctrlRef.current) ctrlRef.current = new NovaController(setStatus);
  const ctrl = ctrlRef.current;

  useEffect(() => () => ctrl.disconnect(), [ctrl]);

  const value = useMemo(
    () => ({
      status,
      connected: status === 'connected',
      connect: () => ctrl.connect(),
      disconnect: () => ctrl.disconnect(),
      startStrobe: hz => ctrl.startStrobe(hz),
      setFrequency: hz => ctrl.setFrequency(hz),
      setSyncedValues: patch => ctrl.setSyncedValues(patch),
      setMasterBrightness: m => ctrl.setMasterBrightness(m),
      stopStrobe: () => ctrl.stopStrobe(),
    }),
    [status, ctrl],
  );

  return <NovaContext.Provider value={value}>{children}</NovaContext.Provider>;
}
