import { BleManager } from 'react-native-ble-plx';

// react-native-ble-plx expects a SINGLE BleManager for the whole app.
// Both the Pulsetto provider and the Lumenate Nova controller share this one.
export const bleManager = new BleManager();
