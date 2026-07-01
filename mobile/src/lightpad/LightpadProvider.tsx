import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LumiController } from '../lumi/LumiController';
import { isLightpad } from '../shared/lumiProtocol';

// ROLI Lightpad Block connection (BLE-MIDI). Same transport as the LUMI Keys, but
// Manual mode reads it as an XY pad: horizontal → carrier, vertical → beat. The
// pad's own touch-glow gives the visual feedback (custom LED colour is a future
// spike — it needs ROLI's proprietary BLOCKS protocol, not standard MIDI).
const LightpadContext = createContext(null);
export const useLightpad = () => useContext(LightpadContext);

export function LightpadProvider({ children }) {
  const ctrlRef = useRef(null);
  const [status, setStatus] = useState('idle');
  if (!ctrlRef.current)
    ctrlRef.current = new LumiController(setStatus, { match: isLightpad, label: 'LIGHTPAD' });
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

  return <LightpadContext.Provider value={value}>{children}</LightpadContext.Provider>;
}
