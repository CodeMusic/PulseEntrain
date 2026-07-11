# On-device session generation (Apple Foundation Models + Image Playground)

The AI Session screen can generate a session **on the phone** instead of calling the
remote n8n webhook — faster, unlimited, private, and it lets us throttle the cloud
model later. Text comes from Apple's **Foundation Models** framework; optional cover
art from **Image Playground** (`ImageCreator`) — both Apple Intelligence, both on-device.

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

## Already wired into the project

`OnDeviceAI.swift` + `OnDeviceAI.m` are added to the **PulseEntrain** target in
`project.pbxproj` (Compile Sources), the bridging header imports
`<React/RCTBridgeModule.h>`, and `FoundationModels` + `ImagePlayground` are
**weak-linked** (`-weak_framework` in `OTHER_LDFLAGS`) so the app still launches on
iOS < 26. So it builds from a normal `pod install` + rebuild — no manual Xcode drag.

Build with **Xcode 26** (so the SDKs are present) and run on a **device** (Apple
Intelligence is unavailable in most Simulators). On any older Xcode/OS the `canImport`
guards make the module compile as a no-op and the app uses the cloud generator.

## Cover art

`OnDeviceAI.generateImage(prompt)` runs Image Playground's `ImageCreator` and returns a
base64 JPEG data URI, which the screen sets as the session's `meta.image`. The AI screen
shows a "Paint cover art on-device" checkbox when `imageAvailable()` is true (on by
default); art generation is **best-effort** — if it fails the session is still saved
without art.

## Contract

`OnDeviceAI.generate(prompt, system)` returns the model's raw text, which the screen
parses with the same `extractImedx()` used for the cloud response — so the on-device
model must follow the same `.imedx` system prompt (`src/catalog/imedxSpec.js`). Smaller
on-device models are more likely to drift on structure; the normalizer + fenced-JSON
parsing already tolerate the common mistakes.

If your Xcode 26's Foundation Models / Image Playground API differs from what's in
`OnDeviceAI.swift` (it's a young API), the calls to adjust are `LanguageModelSession`/
`session.respond(to:)` and `ImageCreator()`/`creator.images(for:style:limit:)`.
