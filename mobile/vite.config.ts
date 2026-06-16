import { defineConfig } from 'vite';
import { one } from 'one/vite';
import path from 'node:path';

const stub = (n: string) => path.resolve(import.meta.dirname, 'web-stubs', n);

export default defineConfig({
  plugins: [
    one({
      // This app is highly interactive (audio, BLE, live state) and uses
      // browser-only APIs — render purely client-side, no SSR/SSG.
      web: {
        defaultRenderMode: 'spa',
      },
      // NOTE: native (iOS/Android) bundler choice is deferred to the native
      // phase. Re-enable Metro mode here (native: { bundler: 'metro' }) once the
      // Expo/Metro native config is in place, so `one dev` web isn't gated on it.
    }),
  ],
  resolve: {
    // Native-only modules → web stubs (web/Vite only; native uses Metro and
    // never sees these aliases). audio-api maps to the browser Web Audio API.
    alias: [
      { find: /^react-native-ble-plx$/, replacement: stub('ble-plx.js') },
      { find: /^react-native-track-player$/, replacement: stub('track-player.js') },
      { find: /^react-native-audio-api$/, replacement: stub('audio-api.js') },
      { find: /^react-native-keep-awake$/, replacement: stub('keep-awake.js') },
      { find: /^react-native-permissions$/, replacement: stub('permissions.js') },
      { find: /^@react-native-community\/slider$/, replacement: stub('slider.js') },
      { find: /^@react-native-async-storage\/async-storage$/, replacement: stub('async-storage.js') },
    ],
  },
});
