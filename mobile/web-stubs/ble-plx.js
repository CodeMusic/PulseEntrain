// Web stub for react-native-ble-plx — no BLE on web. No-ops so the Pulsetto /
// Nova providers mount without crashing (devices just never connect).
export class BleManager {
  state() {
    return Promise.resolve('Unsupported');
  }
  onStateChange(cb) {
    try {
      cb('Unsupported');
    } catch (e) {}
    return { remove() {} };
  }
  startDeviceScan() {}
  stopDeviceScan() {}
  connectedDevices() {
    return Promise.resolve([]);
  }
  devices() {
    return Promise.resolve([]);
  }
  connectToDevice() {
    return Promise.reject(new Error('BLE not available on web'));
  }
  cancelDeviceConnection() {
    return Promise.resolve();
  }
}
export default { BleManager };
