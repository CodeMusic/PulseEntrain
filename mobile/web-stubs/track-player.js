// Web stub for react-native-track-player, backed by a single HTMLAudioElement.
// Implements enough of the API for PlayerScreen (add / play / pause / reset /
// seekTo / setVolume) plus the useProgress / usePlaybackState hooks and State
// enum. Catalog MP3s play in the browser via this; on native the real library
// is used instead.
import { useEffect, useState } from 'react';

export const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Ended: 'ended',
  Buffering: 'buffering',
};
export const Event = {};
export const Capability = {};
export const AppKilledPlaybackBehavior = {};

const hasDOM = typeof window !== 'undefined' && typeof Audio !== 'undefined';
const el = hasDOM ? new Audio() : null;
if (el) el.preload = 'auto';

// simple subscription bus so the hooks re-render on playback changes
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());
if (el) {
  ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'seeked', 'emptied', 'error'].forEach(
    ev => el.addEventListener(ev, notify),
  );
}

const stateOf = () => {
  if (!el || !el.currentSrc) return State.None;
  if (el.ended) return State.Ended;
  return el.paused ? State.Paused : State.Playing;
};

const urlOf = t => (typeof t?.url === 'string' ? t.url : t?.url?.uri || '');
const noop = () => Promise.resolve();

const TrackPlayer = {
  registerPlaybackService: () => {},
  setupPlayer: noop,
  updateOptions: noop,
  add: async track => {
    const t = Array.isArray(track) ? track[0] : track;
    const url = urlOf(t);
    if (el && url) {
      el.src = url;
      el.load();
    }
    notify();
  },
  play: async () => {
    if (el) {
      try {
        await el.play();
      } catch (e) {
        // autoplay can be blocked until a user gesture; the ▶ control will work
      }
    }
    notify();
  },
  pause: async () => {
    if (el) el.pause();
    notify();
  },
  stop: async () => {
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    notify();
  },
  reset: async () => {
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    notify();
  },
  seekTo: async seconds => {
    if (el) el.currentTime = seconds || 0;
    notify();
  },
  setVolume: async v => {
    if (el) el.volume = Math.max(0, Math.min(1, v ?? 1));
  },
  getProgress: async () => ({
    position: el?.currentTime || 0,
    duration: Number.isFinite(el?.duration) ? el.duration : 0,
    buffered: 0,
  }),
  addEventListener: () => ({ remove() {} }),
};

export default TrackPlayer;

export const useProgress = (interval = 1000) => {
  const [p, setP] = useState({ position: 0, duration: 0, buffered: 0 });
  useEffect(() => {
    if (!el) return undefined;
    const tick = () =>
      setP({
        position: el.currentTime || 0,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
        buffered: 0,
      });
    tick();
    const id = setInterval(tick, interval || 1000);
    el.addEventListener('timeupdate', tick);
    el.addEventListener('loadedmetadata', tick);
    return () => {
      clearInterval(id);
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('loadedmetadata', tick);
    };
  }, [interval]);
  return p;
};

export const usePlaybackState = () => {
  const [s, setS] = useState({ state: stateOf() });
  useEffect(() => {
    if (!el) return undefined;
    const update = () => setS({ state: stateOf() });
    update();
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);
  return s;
};
