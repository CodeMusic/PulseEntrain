import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LumiController } from './LumiController';

// Shared ROLI LUMI Keys connection (BLE-MIDI). Mirrors the Nova/Pulsetto providers
// so Manual mode can connect a keyboard and steer the carrier from played notes.
const LumiContext = createContext(null);
export const useLumi = () => useContext(LumiContext);

export function LumiProvider({ children }) {
  const ctrlRef = useRef(null);
  const [status, setStatus] = useState('idle');
  if (!ctrlRef.current) ctrlRef.current = new LumiController(setStatus);
  const ctrl = ctrlRef.current;

  useEffect(() => () => ctrl.disconnect(), [ctrl]);

  const value = useMemo(
    () => ({
      status,
      connected: status === 'connected',
      connect: () => ctrl.connect(),
      disconnect: () => ctrl.disconnect(),
      setNoteListener: fn => ctrl.setNoteListener(fn),
    }),
    [status, ctrl],
  );

  return <LumiContext.Provider value={value}>{children}</LumiContext.Provider>;
}
