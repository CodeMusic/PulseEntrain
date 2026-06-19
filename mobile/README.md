# PulseEntrain (mobile)

The PulseEntrain **player** — the main, user-facing app. Browse the session catalog, play a
session, and pair the **Pulsetto** (vagus nerve) and **Lumenate Nova** (light) devices over BLE.
Built on [One](https://onestack.dev/) so one codebase targets **web + iOS + Android**.

See the platform overview in the [root README](../README.md), the authoring tool in
[../desktop/README.md](../desktop/README.md), and the session contract in
[../docs/SESSION_FORMAT.md](../docs/SESSION_FORMAT.md).

## What it does

- **Catalog** — browse 96 sessions by category, with cover art, strength, and description.
- **Player** — plays both session formats:
  - **Legacy `.imed`** → streams its bundled MP3 (via `react-native-track-player`).
  - **`.imedx`** (self-contained) → **synthesized in real time** from the scene timeline
    (carrier ± beat, interpolated) plus the noise bed, by
    [`SessionSynth`](src/audio/sessionSynth.js) driving [`BinauralEngine`](src/audio/binauralEngine.js)
    — the embedded base64 cover renders directly. No MP3 needed.
- **Manual mode** — dial a beat frequency + noise bed live (same `BinauralEngine`).
- **Devices (BLE)** — **Pulsetto** intensity tracks the session; **Lumenate Nova** strobes in
  sync with the live beat (clamped to `nova.maxHz`, default 60 Hz — delta→gamma). Both are optional; binaural-only works on any headphones.

## Architecture

- **One** with file-based routing in `app/`; web is served by Vite, native by **One's Metro mode**
  (RN 0.83). Native-only modules (BLE, track-player, audio-api) are stubbed for web in
  `web-stubs/` (the audio stub maps to real Web Audio, so synthesis works in the browser too).
- **Catalog** is generated from `../entrainment_assets/` by `scripts/sync-catalog.cjs` into
  `src/catalog/` (`catalog.json` + bundled image/audio maps). A `.imedx` supersedes a same-named
  legacy `.imed`. Run `npm run sync-catalog` (or it runs via `predev`).

## Run

**Prerequisites:** Node 18+, and for native: Xcode / Android Studio + a device or simulator.

```bash
npm install
```

**Web:**
```bash
npm run dev            # One dev server (Vite) — opens the app in the browser
```

**Native (iOS/Android):** the JS bundle **must** be served by One's bundler, not `expo start` /
`react-native start`. The reliable loop:

1. Build & install once (Xcode, or `xcrun devicectl device install app …` — avoids the
   `@expo/cli` lockdownd issue on recent iOS).
2. Serve JS: `ONE_METRO_MODE=1 npx one dev`
3. Launch the app on the device; it loads the bundle over the LAN.

`npm run ios` / `npm run ios:device` wrap the build+serve, but install can fail on iOS 26.x — fall
back to the Xcode/devicectl + `one dev` flow above.

> ⚠️ Serving native JS via `expo start`/`react-native start` produces a broken bundle (One's Babel
> transform isn't applied). Always use One's bundler.

## Notes

- **Permissions:** Bluetooth (+ location on Android, required for BLE scanning). No internet
  permission is needed for playback.
- **Known follow-up:** the catalog still bundles ~4.2 GB of MP3s for legacy `.imed` sessions;
  `.imedx` sessions carry no audio. Streaming (or fully moving to `.imedx`) is the path to a
  shippable build — see the root README roadmap.

## Safety

Binaural beats need **stereo headphones**. The Nova uses flickering light — see the platform
[Safety](../README.md#safety) notes (photosensitivity).
