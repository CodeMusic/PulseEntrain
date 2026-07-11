#import <React/RCTBridgeModule.h>

// Bridges the Swift OnDeviceAI class to React Native.
@interface RCT_EXTERN_MODULE(OnDeviceAI, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(generate:(NSString *)prompt
                  system:(NSString *)system
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
