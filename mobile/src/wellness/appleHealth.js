import { Platform } from 'react-native';
import AppleHealthKit from 'react-native-health';

// Apple Health (HealthKit) bridge — write-only, Mindful Minutes. A finished
// session becomes an HKCategoryTypeIdentifierMindfulSession sample spanning its
// real start→end, so PulseEntrain time shows up in Health's Mindful Minutes and
// anything that reads it (rings, other wellness apps).
//
// State lives here (not in a provider) so the single write path — SessionsProvider
// .logSession — can stay ignorant of settings/provider order: it just calls
// saveMindful() and this module no-ops unless the user turned sync on AND HealthKit
// authorized us. iOS-only; every entry point guards so web/Android are inert.
const IS_IOS = Platform.OS === 'ios';

let enabled = false; // user's "Sync to Apple Health" preference
let authorized = false; // HealthKit granted the write permission
let authInFlight = null; // de-dupe concurrent auth requests

// Tiny event bus so an app-level notifier can react without the write path
// (SessionsProvider.logSession) needing any UI. Events: { type: 'synced' } after
// a sample lands, { type: 'offNudge' } when a counting session finished but sync
// is off (the listener decides whether to nudge, once).
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(evt) {
  listeners.forEach(l => {
    try { l(evt); } catch (e) {}
  });
}

const PERMS = {
  permissions: {
    read: [],
    write: IS_IOS && AppleHealthKit?.Constants
      ? [AppleHealthKit.Constants.Permissions.MindfulSession]
      : [],
  },
};

// Is HealthKit even present on this device? (iPad has no Health app.)
export function isHealthAvailable() {
  return new Promise(resolve => {
    if (!IS_IOS || !AppleHealthKit?.isAvailable) return resolve(false);
    try {
      AppleHealthKit.isAvailable((err, available) => resolve(!err && !!available));
    } catch (e) {
      resolve(false);
    }
  });
}

// Ask HealthKit for the Mindful write permission. Resolves true if we can write.
// iOS never reveals *write* authorization status (privacy), so a resolved auth
// request is treated as success — a denied one just means our writes silently
// no-op, which is the desired graceful degradation.
export function requestAuthorization() {
  if (!IS_IOS || !AppleHealthKit?.initHealthKit) return Promise.resolve(false);
  if (authInFlight) return authInFlight;
  authInFlight = new Promise(resolve => {
    try {
      AppleHealthKit.initHealthKit(PERMS, err => {
        authorized = !err;
        authInFlight = null;
        resolve(authorized);
      });
    } catch (e) {
      authInFlight = null;
      authorized = false;
      resolve(false);
    }
  });
  return authInFlight;
}

// SettingsProvider calls this on load and whenever the toggle changes. Turning it
// on kicks off the permission request so the first synced session already has it.
export function setSyncEnabled(on) {
  enabled = !!on;
  if (enabled && !authorized) requestAuthorization();
}

export function isSyncEnabled() {
  return enabled;
}

// Write one Mindful Minutes sample for a completed session. Silently no-ops when
// off, unavailable, or unauthorized. `start`/`end` are Date objects or ISO strings.
export function saveMindful(start, end) {
  if (!IS_IOS || !enabled || !AppleHealthKit?.saveMindfulSession) return;
  const startDate = (start instanceof Date ? start : new Date(start)).toISOString();
  const endDate = (end instanceof Date ? end : new Date(end)).toISOString();
  const write = () => {
    try {
      AppleHealthKit.saveMindfulSession({ startDate, endDate }, err => {
        if (!err) emit({ type: 'synced' });
      });
    } catch (e) {}
  };
  // If the user enabled sync but auth hasn't resolved yet, request then write.
  if (!authorized) {
    requestAuthorization().then(ok => ok && write());
    return;
  }
  write();
}

// Called for every counting-length session. When sync is OFF (but the platform
// could do it), emit a nudge so the notifier can offer to turn it on — once.
// When ON, the write path emits 'synced' itself, so nothing to do here.
export function reportCompletion(counted) {
  if (!IS_IOS || !counted || enabled) return;
  emit({ type: 'offNudge' });
}
