# On-device session generation (Apple Foundation Models)

The AI Session screen can generate a session **on the phone** instead of calling the
remote n8n webhook — faster, unlimited, private, and it lets us throttle the cloud
model later. It uses Apple's **Foundation Models** framework (Apple Intelligence).

## How it degrades

The JS side (`src/ai/onDeviceModel.js`) reads the native `OnDeviceAI` module and
`isOnDeviceAvailable()` resolves **false** whenever it can't run — non-iOS, web, an
Xcode/OS without the framework, or a device without Apple Intelligence. In that case
the screen simply hides the toggle and uses the cloud generator. So nothing breaks if
the native piece isn't built in; you only *gain* the on-device option where supported.

The native module (`ios/PulseEntrain/OnDeviceAI.swift` + `OnDeviceAI.m`) is written so
it **compiles on any SDK**: `#if canImport(FoundationModels)` gates the import and
`#available(iOS 26.0, *)` gates the calls.

## Requirements

- **Xcode 26+** (so the FoundationModels SDK is present at build time).
- **iOS 26+** device with **Apple Intelligence** enabled (iPhone 15 Pro / 16 / newer).
- No special entitlement is required for the default system model, but confirm in
  Settings that Apple Intelligence is turned on.

## Wiring it into the build (one-time, in Xcode)

The `ios/` project files aren't fully tracked in git, so add the two files to the app
target once:

1. Open `ios/PulseEntrain.xcworkspace` in Xcode 26.
2. Drag `OnDeviceAI.swift` and `OnDeviceAI.m` into the **PulseEntrain** target (they're
   already on disk under `ios/PulseEntrain/`). Confirm both show under
   *Build Phases → Compile Sources*.
3. The bridging header already imports `<React/RCTBridgeModule.h>`; keep the target's
   *Swift Compiler → Objective-C Bridging Header* pointing at
   `PulseEntrain/PulseEntrain-Bridging-Header.h`.
4. Build to a device (the framework is unavailable in most Simulators).

## Contract

`OnDeviceAI.generate(prompt, system)` returns the model's raw text, which the screen
parses with the same `extractImedx()` used for the cloud response — so the on-device
model must follow the same `.imedx` system prompt (`src/catalog/imedxSpec.js`). Smaller
on-device models are more likely to drift on structure; the normalizer + fenced-JSON
parsing already tolerate the common mistakes.
