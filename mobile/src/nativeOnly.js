import { Platform, Alert } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

// BLE features (Pulsetto, Nova) don't exist on web — show a friendly notice.
export function nativeOnlyNotice(feature) {
  const msg = `${feature} uses Bluetooth, which is only available in the iOS and Android apps.`;
  if (IS_WEB && typeof window !== 'undefined' && window.alert) {
    window.alert(msg);
  } else {
    Alert.alert(`${feature} — mobile only`, msg);
  }
}
