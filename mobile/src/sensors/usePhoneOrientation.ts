// Native phone orientation is not wired yet — RN has no DeviceOrientation API, so
// it needs a sensors module (e.g. expo-sensors: DeviceMotion + Magnetometer for a
// true compass heading). Until that's added, Phone tracking is web-only and this
// stub reports unsupported so the UI can say so. (Head tracking via the Nova
// accelerometer works on native today.)
export const PHONE_SUPPORTED = false;

export function usePhoneOrientation(_active: boolean) {
  return null;
}
