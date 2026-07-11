import Foundation

// On-device session generation via Apple's Foundation Models framework (Apple
// Intelligence). Compiles on any SDK: `canImport` gates the framework and
// `#available` gates the OS, so on a device/OS without it the methods simply report
// unavailable and the JS layer falls back to the remote generator.
//
// To activate: add this file + OnDeviceAI.m to the app target in Xcode (built with
// Xcode 26+ so the FoundationModels SDK is present). Runs on Apple-Intelligence
// devices on iOS 26+. See docs/ON_DEVICE_AI.md.
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(OnDeviceAI)
class OnDeviceAI: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(isAvailable:rejecter:)
  func isAvailable(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      if case .available = SystemLanguageModel.default.availability {
        resolve(true)
      } else {
        resolve(false)
      }
      return
    }
    #endif
    resolve(false)
  }

  @objc(generate:system:resolver:rejecter:)
  func generate(_ prompt: String, system: String,
                resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      Task {
        do {
          let session = LanguageModelSession(instructions: system)
          let response = try await session.respond(to: prompt)
          resolve(response.content)
        } catch {
          reject("on_device_error", error.localizedDescription, error)
        }
      }
      return
    }
    #endif
    reject("unavailable", "On-device model unavailable on this device or OS.", nil)
  }
}
