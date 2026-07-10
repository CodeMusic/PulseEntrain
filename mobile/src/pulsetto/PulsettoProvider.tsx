import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Alert, AppState } from 'react-native';
import { bleManager as manager } from '../ble/manager';
import {
  request,
  requestMultiple,
  check,
  checkMultiple,
  PERMISSIONS,
  RESULTS,
  openSettings,
} from 'react-native-permissions';
import { Buffer } from 'buffer';
// Pulsetto UART protocol (commands, clamp, battery math, notification parse) is
// platform-agnostic and shared — a desktop/Electron transport reuses it verbatim.
import {
  DEVICE_NAME_PREFIX,
  UART_SERVICE_UUID,
  UART_RX_CHAR_UUID,
  UART_TX_CHAR_UUID,
  clampLevel,
  CMD,
  levelCmd,
  parseNotification,
} from '../shared/pulsettoProtocol';

// `manager` is the shared BleManager (see src/ble/manager.js).
const KEEPALIVE_INTERVAL = 10000;
const STATUS_POLL_INTERVAL = 30000;
const SESSION_POLL_INTERVAL = 3000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const PulsettoContext = createContext(null);

export const usePulsetto = () => {
  const ctx = useContext(PulsettoContext);
  if (!ctx) throw new Error('usePulsetto must be used within a PulsettoProvider');
  return ctx;
};

export function PulsettoProvider({ children }) {
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [battery, setBattery] = useState(null);
  const [charging, setCharging] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);

  // Refs mirror state so interval/BLE callbacks never read stale closures.
  const connectedRef = useRef(null);
  const scanningRef = useRef(false);
  const keepaliveRef = useRef(null);
  const statusPollRef = useRef(null);
  const disconnectSubRef = useRef(null);
  const isReconnectingRef = useRef(false);
  const userDisconnectedRef = useRef(false); // user toggled off → don't auto-reconnect
  const sessionActiveRef = useRef(false);
  const activeStrengthRef = useRef(5);

  const setConnected = dev => {
    connectedRef.current = dev;
    setConnectedDevice(dev);
  };
  const setScan = v => {
    scanningRef.current = v;
    setScanning(v);
  };
  const setSession = v => {
    sessionActiveRef.current = v;
    setSessionActive(v);
  };

  // ---- low-level command write ----
  const sendCommand = async (command, device = connectedRef.current) => {
    if (!device) {
      console.log('Device not connected. Cannot send command.');
      return;
    }
    try {
      const base64Command = Buffer.from(command).toString('base64');
      const cmdChar = command.trim();
      if (cmdChar === '+' || cmdChar === '-') {
        // ramp commands use writeWithResponse
        await device.writeCharacteristicWithResponseForService(
          UART_SERVICE_UUID,
          UART_RX_CHAR_UUID,
          base64Command,
        );
      } else {
        await device.writeCharacteristicWithoutResponseForService(
          UART_SERVICE_UUID,
          UART_RX_CHAR_UUID,
          base64Command,
        );
      }
    } catch (error) {
      console.error('Failed to send command:', error);
      if (error.message?.includes('not connected') || error.message?.includes('disconnected')) {
        handleDisconnection();
      }
    }
  };

  const handleNotification = (decodedData, rawBytes) => {
    const patch = parseNotification(decodedData, rawBytes); // pure parse → state patch
    if ('battery' in patch) setBattery(patch.battery);
    if ('charging' in patch) setCharging(patch.charging);
  };

  const subscribeToNotifications = device => {
    device.monitorCharacteristicForService(
      UART_SERVICE_UUID,
      UART_TX_CHAR_UUID,
      (error, characteristic) => {
        if (error) {
          console.error('Notification error:', error);
          return;
        }
        if (characteristic?.value) {
          const decoded = Buffer.from(characteristic.value, 'base64').toString('utf-8');
          const raw = Buffer.from(characteristic.value, 'base64');
          handleNotification(decoded, raw);
        }
      },
    );
  };

  const queryDeviceStatus = async device => {
    await sendCommand(CMD.queryCharging, device); // charging
    await sendCommand(CMD.queryBattery, device); // battery
  };
  const queryDeviceInfo = async device => {
    await sendCommand(CMD.queryFirmware, device); // firmware
    await sendCommand(CMD.queryIdentity, device); // identity
  };

  const startStatusPolling = interval => {
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    statusPollRef.current = setInterval(() => {
      queryDeviceStatus(connectedRef.current);
    }, interval);
  };

  const startKeepalive = () => {
    if (keepaliveRef.current) clearInterval(keepaliveRef.current);
    keepaliveRef.current = setInterval(() => {
      if (sessionActiveRef.current && connectedRef.current) {
        sendCommand(levelCmd(activeStrengthRef.current, 0));
      }
    }, KEEPALIVE_INTERVAL);
  };
  const stopKeepalive = () => {
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
  };

  // ---- start / stop ramp sequences (from official APK begin/endSession) ----
  const runStartSequence = async (device, strength) => {
    await sendCommand(CMD.rampUp, device); // rampUp
    await sendCommand(CMD.rampDown, device); // rampDown
    await sleep(250);
    await sendCommand(CMD.off, device);
    await sleep(450);
    await sendCommand(CMD.calib, device); // calibration pulse
    await sleep(450);
    await sendCommand(CMD.off, device);
    await sleep(450);
    await sendCommand(levelCmd(strength, 1), device); // target intensity (1-9)
    await sleep(250);
    await sendCommand(CMD.bothSides, device); // both sides
    await sendCommand(CMD.ledLow, device); // LED low
  };

  const handleDisconnection = () => {
    setConnected(null);
    setBattery(null);
    setCharging(null);
    stopKeepalive();
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    // keep sessionActive as-is so we resume on reconnect
    if (userDisconnectedRef.current) {
      userDisconnectedRef.current = false; // user-initiated → don't auto-reconnect
      return;
    }
    if (!isReconnectingRef.current) {
      isReconnectingRef.current = true;
      setTimeout(() => {
        scanForDevices();
        isReconnectingRef.current = false;
      }, 1000);
    }
  };

  const connectToDevice = async device => {
    try {
      const connected = await manager.connectToDevice(device.id, { autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();
      if (disconnectSubRef.current) disconnectSubRef.current.remove();
      disconnectSubRef.current = manager.onDeviceDisconnected(connected.id, () =>
        handleDisconnection(),
      );
      setConnected(connected);
      subscribeToNotifications(connected);
      await queryDeviceInfo(connected);
      await queryDeviceStatus(connected);
      startStatusPolling(STATUS_POLL_INTERVAL);
      // resume an in-progress session after a reconnect
      if (sessionActiveRef.current) {
        await runStartSequence(connected, activeStrengthRef.current);
        startStatusPolling(SESSION_POLL_INTERVAL);
        startKeepalive();
      }
    } catch (error) {
      console.error('Connection error:', error);
      setTimeout(() => {
        if (!isReconnectingRef.current) {
          isReconnectingRef.current = true;
          scanForDevices();
          isReconnectingRef.current = false;
        }
      }, 2000);
    }
  };

  // Wait until the BLE radio is actually on before scanning — otherwise a cold
  // start throws "invalid state" (Nova/Lumi controllers do the same).
  const waitPoweredOn = async () => {
    try {
      if ((await manager.state()) === 'PoweredOn') return true;
      return await new Promise(resolve => {
        const sub = manager.onStateChange(s => { if (s === 'PoweredOn') { sub.remove(); resolve(true); } }, true);
        setTimeout(() => { sub.remove(); resolve(false); }, 6000);
      });
    } catch (e) { return false; }
  };

  const scanForDevices = async () => {
    if (scanningRef.current || connectedRef.current) return;
    userDisconnectedRef.current = false; // re-enabling clears the no-reconnect flag
    setScan(true);
    if (!(await waitPoweredOn())) { setScan(false); return; }
    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        setScan(false);
        Alert.alert('Scan Error', error.message || JSON.stringify(error), [{ text: 'OK' }]);
        return;
      }
      if (device.name?.startsWith(DEVICE_NAME_PREFIX)) {
        manager.stopDeviceScan();
        setScan(false);
        connectToDevice(device);
      }
    });
    setTimeout(() => {
      if (!connectedRef.current) {
        manager.stopDeviceScan();
        setScan(false);
      }
    }, 10000);
  };

  const requestBluetoothPermissions = async () => {
    if (Platform.OS === 'android') {
      const permissions = [
        PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
        PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      ];
      try {
        const statuses = await checkMultiple(permissions);
        const toRequest = permissions.filter(p => statuses[p] !== RESULTS.GRANTED);
        if (toRequest.length > 0) {
          const newStatuses = await requestMultiple(toRequest);
          const allGranted = Object.values(newStatuses).every(s => s === RESULTS.GRANTED);
          if (allGranted) scanForDevices();
          else
            Alert.alert(
              'Permissions Required',
              'Location and Bluetooth permissions are required for scanning.',
              [
                { text: 'Grant Permissions', onPress: () => requestBluetoothPermissions() },
                { text: 'Open Settings', onPress: () => openSettings(), style: 'cancel' },
              ],
            );
        } else scanForDevices();
      } catch (error) {
        Alert.alert('Permission Error', error.message, [{ text: 'OK' }]);
      }
    } else if (Platform.OS === 'ios') {
      try {
        const status = await check(PERMISSIONS.IOS.BLUETOOTH);
        if (status !== RESULTS.GRANTED) {
          const newStatus = await request(PERMISSIONS.IOS.BLUETOOTH);
          if (newStatus === RESULTS.GRANTED) scanForDevices();
          else
            Alert.alert(
              'Permissions Required',
              'Bluetooth permission is required for scanning.',
              [
                { text: 'Grant Permissions', onPress: () => requestBluetoothPermissions() },
                { text: 'Open Settings', onPress: () => openSettings(), style: 'cancel' },
              ],
            );
        } else scanForDevices();
      } catch (error) {
        Alert.alert('Permission Error', error.message, [{ text: 'OK' }]);
      }
    }
  };

  // ---- public API ----
  // Begin a session. Returns true if the device actually started, false if no
  // device is connected (caller decides whether to prompt / go audio-only).
  const startSession = async (strength = 5) => {
    strength = clampLevel(strength, 1); // never begin a session outside 1-9
    activeStrengthRef.current = strength;
    setSession(true);
    const device = connectedRef.current;
    if (!device) return false;
    await runStartSequence(device, strength);
    startStatusPolling(SESSION_POLL_INTERVAL);
    startKeepalive();
    return true;
  };

  // Idempotent + safe to call unconditionally. Callers used to guard this with the
  // React `sessionActive` STATE, but a stop fired from a stale closure (e.g. a
  // session timer that completes minutes after start) saw that state as false and
  // skipped the stop — leaving the stimulator buzzing (the keepalive kept
  // re-asserting it). We instead gate on the LIVE ref here: if a session is truly
  // active we ramp the device down; if not, it's a no-op (no stray stim blip).
  const stopSession = async () => {
    const wasActive = sessionActiveRef.current;
    setSession(false);
    stopKeepalive();
    const device = connectedRef.current;
    if (device && wasActive) {
      await sendCommand(CMD.rampUp, device);
      await sendCommand(CMD.rampDown, device);
      await sendCommand(CMD.rampDown, device); // endSession
      startStatusPolling(STATUS_POLL_INTERVAL);
      await queryDeviceStatus(device);
    }
  };

  const setIntensity = async value => {
    value = clampLevel(value, 0); // 0 = mute (pause); active stim is 1-9
    activeStrengthRef.current = value;
    if (sessionActiveRef.current && connectedRef.current) {
      await sendCommand(levelCmd(value, 0));
    }
  };

  // User-initiated disconnect (toggle off). Ends any session and drops the BLE
  // link without auto-reconnecting (handleDisconnection honours the flag).
  const disconnect = async () => {
    userDisconnectedRef.current = true;
    const device = connectedRef.current;
    if (sessionActiveRef.current) { try { await stopSession(); } catch (e) {} }
    manager.stopDeviceScan();
    if (device) { try { await manager.cancelDeviceConnection(device.id); } catch (e) {} }
    setConnected(null);
    setBattery(null);
    setCharging(null);
  };

  // ---- lifecycle: permissions + auto-scan on mount, refresh on foreground ----
  useEffect(() => {
    requestBluetoothPermissions();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' && connectedRef.current) queryDeviceStatus(connectedRef.current);
    });
    return () => {
      sub?.remove();
      manager.stopDeviceScan();
      if (connectedRef.current) manager.cancelDeviceConnection(connectedRef.current.id);
      stopKeepalive();
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      if (disconnectSubRef.current) disconnectSubRef.current.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    connectedDevice,
    connected: !!connectedDevice,
    battery,
    charging,
    scanning,
    sessionActive,
    scanForDevices,
    disconnect,
    startSession,
    stopSession,
    setIntensity,
    sendCommand,
  };

  return <PulsettoContext.Provider value={value}>{children}</PulsettoContext.Provider>;
}
