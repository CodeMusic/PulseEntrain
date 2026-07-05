import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useBlocker } from 'one';

// Confirm before navigating away from an active session — the back gesture, the
// header back arrow, tapping the header title (Home), or the Home menu item all
// pop this screen, and One's useBlocker (React Navigation usePreventRemove) lets
// us intercept that. Stops an accidental tap from silently ending a session — and,
// importantly, leaving a vagus-nerve stimulator running or cut mid-fade. Pass a
// truthy `active` while a session is running (or paused). On confirm we `proceed`,
// which unmounts the screen and runs its normal teardown (audio/Nova/Pulsetto off).
export function useSessionExitGuard(active: any) {
  const blocker: any = useBlocker(!!active);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    Alert.alert(
      'Session in progress',
      'Leaving will end your PulseEntrain session. Stop and leave?',
      [
        { text: 'Keep going', style: 'cancel', onPress: () => blocker.reset && blocker.reset() },
        { text: 'Stop & leave', style: 'destructive', onPress: () => blocker.proceed && blocker.proceed() },
      ],
      { cancelable: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);
}
