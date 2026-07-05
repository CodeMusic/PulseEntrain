import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

// A global "is a session running?" flag plus a confirm-before-leave helper. Unlike
// beforeRemove/useBlocker (which lets native-stack animate the pop first, then
// asks), this intercepts at the navigation SOURCE — the header title, header back,
// and menu — so the navigation is only dispatched once the user confirms. Session
// screens mark themselves active with useSessionActive(running).
const Ctx = createContext(null);
export const useSessionGuard = () => useContext(Ctx);

export function SessionGuardProvider({ children }) {
  const apiRef = useRef(null);
  if (!apiRef.current) {
    const active = { current: false };
    apiRef.current = {
      setActive(v) { active.current = !!v; },
      isActive() { return active.current; },
      // Run `onProceed` immediately if no session; otherwise confirm first and only
      // proceed on "Stop & leave" — the navigation never starts until then.
      confirmExit(onProceed) {
        if (!active.current) return onProceed();
        Alert.alert(
          'Session in progress',
          'Leaving will end your PulseEntrain session. Stop and leave?',
          [
            { text: 'Keep going', style: 'cancel' },
            { text: 'Stop & leave', style: 'destructive', onPress: onProceed },
          ],
          { cancelable: true },
        );
      },
    };
  }
  return <Ctx.Provider value={apiRef.current}>{children}</Ctx.Provider>;
}

// Session screens call this with their running flag.
export function useSessionActive(active) {
  const g = useSessionGuard();
  useEffect(() => {
    if (g) g.setActive(active);
    return () => { if (g) g.setActive(false); };
  }, [g, active]);
}
