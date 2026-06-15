import TrackPlayer, { Capability, AppKilledPlaybackBehavior } from 'react-native-track-player';

let ready = false;

// Idempotent player setup — safe to call on every Player screen mount.
export async function setupPlayer() {
  if (ready) return;
  try {
    await TrackPlayer.setupPlayer();
  } catch (e) {
    // "player already initialized" — fine, continue.
  }
  await TrackPlayer.updateOptions({
    android: {
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
    },
    capabilities: [Capability.Play, Capability.Pause, Capability.Stop, Capability.SeekTo],
    compactCapabilities: [Capability.Play, Capability.Pause],
    progressUpdateEventInterval: 1,
  });
  ready = true;
}
