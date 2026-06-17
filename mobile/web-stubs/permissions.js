// Web stub for react-native-permissions — treat everything as granted.
export const PERMISSIONS = { IOS: {}, ANDROID: {} };
export const RESULTS = {
  UNAVAILABLE: 'unavailable',
  DENIED: 'denied',
  LIMITED: 'limited',
  GRANTED: 'granted',
  BLOCKED: 'blocked',
};
export const check = () => Promise.resolve(RESULTS.GRANTED);
export const request = () => Promise.resolve(RESULTS.GRANTED);
export const checkMultiple = () => Promise.resolve({});
export const requestMultiple = () => Promise.resolve({});
export const openSettings = () => Promise.resolve();
export default { PERMISSIONS, RESULTS, check, request, checkMultiple, requestMultiple, openSettings };
