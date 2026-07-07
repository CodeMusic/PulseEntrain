// Web stub for react-native-health — HealthKit is iOS-only. Every method the
// appleHealth wrapper touches is a no-op here so the web bundle builds and the
// wrapper's Platform guards keep it inert.
const noop = () => {};

export default {
  Constants: { Permissions: { MindfulSession: 'MindfulSession' } },
  isAvailable: cb => cb && cb(null, false),
  initHealthKit: (_perms, cb) => cb && cb('unavailable on web'),
  saveMindfulSession: (_opts, cb) => cb && cb('unavailable on web'),
};
