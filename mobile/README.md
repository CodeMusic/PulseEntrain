# PulseEntrain (mobile)

The PulseEntrain **player** — the main, user-facing app. Browse the session catalog, play a
session, and pair the **Pulsetto** (vagus nerve) and **Lumenate Nova** (light) devices over BLE.
Built on [One](https://onestack.dev/) so one codebase targets **web + iOS + Android**.

See the platform overview in the [root README](../README.md), the authoring tool in
[../desktop/README.md](../desktop/README.md), and the session contract in
[../docs/SESSION_FORMAT.md](../docs/SESSION_FORMAT.md).

## What it does

- **Catalog** — browse the session library by category, with cover art, strength, and description.
- **Player** — plays both session formats:
  - **Legacy `.imed`** → streams its bundled MP3 (via `react-native-track-player`).
  - **`.imedx`** (self-contained) → **synthesized in real time** from the scene timeline
    (carrier ± beat, interpolated) plus the noise bed, by
    [`SessionSynth`](src/audio/sessionSynth.js) driving [`BinauralEngine`](src/audio/binauralEngine.js)
    — the embedded base64 cover renders directly. No MP3 needed.
- **Manual mode** — dial a beat frequency + noise bed live (same `BinauralEngine`); unified Start/Stop
  drives audio + Nova + Pulsetto together, with a session timer and per-session **Session volume**
  (scales only our tones, so it can sit under a blended app).
- **[Field Meditation Mode](../docs/FIELD_MEDITATION.md)** — immersive, eyes-closed. A glowing circle
  shows carrier (colour) / binaural beat / **biphotic beat**; the circle *is* the control (tap to
  enter, tap to pause → Resume/Stop). Press a **Lightpad** and feel around (x = carrier, y = beat,
  press = intensity); or press + move your head and the **Nova accelerometer** steers it (pitch →
  beat/flash rate, roll → per-eye biphotic balance) — release and the tuning locks. Has a timer and
  logs toward the daily goal. See the [full guide](../docs/FIELD_MEDITATION.md).
- **Devices (BLE)** — **Pulsetto** intensity tracks the session (and always ramps down when a session
  ends, even on a timer completion); **Lumenate Nova** strobes in sync with the live beat (clamped to
  `nova.maxHz`, default 60 Hz — delta→gamma), per-eye, and can also feed head-motion into Field mode.
  Both optional; binaural-only works on any headphones. Playing audio uses `mixWithOthers`, so a
  guided meditation from another app layers on top. On web (no BLE) devices show disabled.
- **ROLI controllers (BLE-MIDI)** *(experimental)* — a **LUMI Keys** keyboard or a **Lightpad Block / Block M** pad can play Manual mode live. Both share one transport ([`LumiController`](src/lumi/LumiController.js) + shared [`lumiProtocol`](src/shared/lumiProtocol.js)), picked apart by name: LUMI → carrier/beat from notes; Lightpad → XY pad (glide = carrier, slide = beat, press = volume). Receive-only; the pads use their own touch-glow (custom LED colour would need ROLI's proprietary BLOCKS protocol).
- **Settings** — a general settings page: profile name, **Blend with other apps** (`mixWithOthers`),
  and **Developer mode**. Dev mode shows a collapsible **dev panel** docked to the bottom of every
  screen (device connections, and per-screen diagnostics — e.g. in Field, live Nova pitch/roll +
  telemetry-Hz with a rate experiment, and the Lightpad's raw events).
- **Session guard** — leaving a running session (back gesture, header, Home) asks to confirm first,
  so an accidental tap can't silently end a session (or leave a vagus-nerve device running).
- **Open a file** — pick a saved `.imedx` from the hamburger menu and play it (your own
  creation or one shared with you). Validated against the session contract.
- **Studio** *(web)* — author `.imedx` in the browser: an interactive beat-over-time graph
  (tap to add a node, drag to move, select to edit time/beat/carrier), noise + transition-fade,
  live **Preview** with a position scrubber, **undo/redo** (⌘/Ctrl+Z), **New / Open / Library**
  (load any catalog or file session), dynamic axis, and **Download .imedx**. Reuses the same
  `BeatChart` + `SessionSynth` + `.imedx` contract as the player, so what you build is what plays.
  Open it from the menu, or from a catalog item's **Open in Studio** (web). Native authoring stays
  in the desktop Admin.

## Architecture

- **One** with file-based routing in `app/`; web is served by Vite, native by **One's Metro mode**
  (RN 0.83). Native-only modules (BLE, track-player, audio-api) are stubbed for web in
  `web-stubs/` (the audio stub maps to real Web Audio, so synthesis works in the browser too).
- **Catalog** is generated from `../imedsAssets/` by `scripts/sync-catalog.cjs` into
  `src/catalog/` (`catalog.json` + bundled image/audio maps). A `.imedx` supersedes a same-named
  legacy `.imed`. Run `npm run sync-catalog` (or it runs via `predev`).

## Run

**Prerequisites:** Node 18+, and for native: Xcode / Android Studio + a device or simulator.

```bash
npm install
```

**Quick start** (serve the JS bundle for the native app on a device/simulator):

```bash
./start.sh             # = npm run dev:native (sync-catalog + ONE_METRO_MODE=1 one dev)
./start.sh --pair      # first install / new device / new Wi-Fi: build + install to the USB-connected
                       #   iOS device (xcodebuild → devicectl), then serve. Bakes in the current IP.
```

The device/simulator must be on the **same Wi-Fi** as this machine (a phone on cellular can't reach
the dev server — see the "No script URL provided" error). Then launch the app; it loads the bundle
over the LAN. Tap **Reload JS** if it was already open.

**Switched Wi-Fi?** This Mac's LAN IP changes with the network, and the installed app caches the old
one → "No script URL provided". `start.sh` auto-detects the current IP and advertises it to the
bundler (via `REACT_NATIVE_PACKAGER_HOSTNAME`) — it prints the host on launch. Two ways to recover:

- **`./start.sh`** (regular, serve-only) — the installed app still holds the previous IP, so **once
  per new network**: shake the phone → Dev Menu → Settings → *Debug server host & port for device* →
  enter the printed `IP:8081`, then Reload. No rebuild.
- **`./start.sh --pair`** — build + install to the connected iOS device, then serve. One's `run:ios`
  ignores `--device` and always targets the Simulator, so `--pair` drives the device directly:
  `xcodebuild` for the phone → `xcrun devicectl device install app` + `process launch` → serve JS (this
  also dodges the `@expo/cli` lockdownd install bug). Requires the phone plugged in, unlocked, and
  trusted; slower (native build). After launch, tap the printed `IP:8081` in the dev-client launcher.
  Note: JS-only changes don't need this at all — plain `./start.sh` + reload is enough.

**Web:**
```bash
npm run dev            # One dev server (Vite) — opens the app in the browser
```

**Native (iOS/Android):** the JS bundle **must** be served by One's bundler, not `expo start` /
`react-native start`. `./start.sh` (above) does this; the manual reliable loop:

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
