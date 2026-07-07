import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme';
import { subscribe } from './appleHealth';
import { useSettings } from '../settings/SettingsProvider';

// App-level reaction to Apple Health sync events (see appleHealth's event bus):
//  • 'synced'   → a brief "✓ Synced to Apple Health" pill, so a write is visible.
//  • 'offNudge' → a one-time offer to turn sync on when a session finished while
//    it was off. Persisted flag so we only ever ask once.
// Rendered once near the app root (inside SettingsProvider) so it overlays every
// screen; the session screens stay untouched.
const KEY_NUDGED = '@pulseentrain/healthNudgePrompted';
const IS_IOS = Platform.OS === 'ios';

export default function HealthNotifier() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const [msg, setMsg] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<any>(null);
  const nudgingRef = useRef(false); // guard against overlapping prompts

  const showPill = text => {
    setMsg(text);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() =>
        setMsg(null),
      );
    }, 2200);
  };

  const maybeNudge = async () => {
    if (nudgingRef.current || !settings || !settings.setHealthSync) return;
    try {
      if ((await AsyncStorage.getItem(KEY_NUDGED)) === '1') return; // asked before
    } catch (e) {}
    nudgingRef.current = true;
    AsyncStorage.setItem(KEY_NUDGED, '1').catch(() => {}); // ask at most once, ever
    Alert.alert(
      'Log this to Apple Health?',
      'PulseEntrain can save your sessions to Apple Health as Mindful Minutes, so they count toward your wellness rings. You can change this anytime in Settings.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => { nudgingRef.current = false; } },
        {
          text: 'Turn on',
          onPress: () => {
            settings.setHealthSync(true);
            nudgingRef.current = false;
            showPill('✓ Syncing to Apple Health');
          },
        },
      ],
      { cancelable: true, onDismiss: () => { nudgingRef.current = false; } },
    );
  };

  useEffect(() => {
    if (!IS_IOS) return; // Health is iOS-only; nothing to surface elsewhere
    const off = subscribe(evt => {
      if (evt.type === 'synced') showPill('✓ Synced to Apple Health');
      else if (evt.type === 'offNudge') maybeNudge();
    });
    return () => {
      off();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  if (!msg) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pill, { opacity, bottom: 28 + insets.bottom }]}
    >
      <Text style={styles.pillTxt}>{msg}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10000,
  },
  pillTxt: {
    backgroundColor: 'rgba(16,185,129,0.95)', // accentGreen, opaque enough to read on any screen
    color: '#04120C',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
});
