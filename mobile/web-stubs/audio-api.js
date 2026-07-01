// Web "stub" for react-native-audio-api — map to the browser's native Web Audio
// API. The binaural engine (oscillators / gain / stereo panner / buffers) works
// unchanged in the browser. (AudioContext starts on a user gesture per browser
// autoplay policy — fine, since playback begins on a button press.)
export const AudioContext =
  typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : class {};

// The browser mixes tabs/apps by default, so session management is a no-op here.
export const AudioManager = { setAudioSessionOptions() {}, setAudioSessionActivity() {} };

export default { AudioContext, AudioManager };
