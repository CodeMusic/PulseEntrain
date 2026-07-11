import { NativeModules, Platform } from 'react-native';

// Thin wrapper over the native OnDeviceAI module (Apple Foundation Models). Safe to
// call anywhere: if the native module isn't built in (older Xcode, non-iOS, web) or
// the device has no Apple Intelligence, isOnDeviceAvailable() resolves false and the
// screen keeps using the remote generator.
const mod = NativeModules && NativeModules.OnDeviceAI;

export const hasOnDeviceModule = Platform.OS === 'ios' && !!(mod && mod.generate);

export async function isOnDeviceAvailable() {
  if (!hasOnDeviceModule || !mod.isAvailable) return false;
  try {
    return !!(await mod.isAvailable());
  } catch (e) {
    return false;
  }
}

// Returns the raw model text (parsed with extractImedx by the caller, same as cloud).
export async function generateOnDevice(prompt, system) {
  if (!hasOnDeviceModule) throw new Error('On-device model is not available.');
  return mod.generate(prompt, system);
}
