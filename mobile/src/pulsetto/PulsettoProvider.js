import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform, Alert, AppState } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
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

// ---- BLE constants (Pulsetto UART) — lifted verbatim from the controller ----
const manager = new BleManager();
const DEVICE_NAME_PREFIX = 'Pulsetto';
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify
const BATTERY_FULL_VOLTAGE = 3.9;
const BATTERY_EMPTY_VOLTAGE = 3.5;
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

  const calculateBatteryPercentage = voltage => {
    if (voltage >= BATTERY_FULL_VOLTAGE) return 100;
    if (voltage <= BATTERY_EMPTY_VOLTAGE) return 0;
    return Math.round(
      ((voltage - BATTERY_EMPTY_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE)) * 100,
    );
  };

  const handleNotification = (decodedData, rawBytes) => {
    const trimmedData = decodedData.trim();
    if (trimmedData.startsWith('Batt:')) {
      try {
        const v = parseFloat(trimmedData.split('Batt:')[1]);
        setBattery(calculateBatteryPercentage(v));
      } catch (e) {
        console.error('Failed to parse battery data:', e);
      }
    }
    if (rawBytes.length >= 3 && rawBytes[0] === 0x75 && rawBytes[1] === 0x01) {
      if (rawBytes[2] === 0x30) setCharging('Not Charging');
      else if (rawBytes[2] === 0x31) setCharging('Charging');
    }
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
    await sendCommand('u\n', device); // charging
    await sendCommand('Q\n', device); // battery
  };
  const queryDeviceInfo = async device => {
    await sendCommand('v\n', device); // firmware
    await sendCommand('i\n', device); // identity
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
        sendCommand(`${activeStrengthRef.current}\n`);
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
    await sendCommand('+\n', device); // rampUp
    await sendCommand('-\n', device); // rampDown
    await sleep(250);
    await sendCommand('0\n', device);
    await sleep(450);
    await sendCommand('5\n', device); // calibration pulse
    await sleep(450);
    await sendCommand('0\n', device);
    await sleep(450);
    await sendCommand(`${strength}\n`, device); // target intensity
    await sleep(250);
    await sendCommand('D\n', device); // both sides
    await sendCommand('E\n', device); // LED low
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

  const scanForDevices = () => {
    if (scanningRef.current || connectedRef.current) return;
    setScan(true);
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
    activeStrengthRef.current = strength;
    setSession(true);
    const device = connectedRef.current;
    if (!device) return false;
    await runStartSequence(device, strength);
    startStatusPolling(SESSION_POLL_INTERVAL);
    startKeepalive();
    return true;
  };

  const stopSession = async () => {
    setSession(false);
    stopKeepalive();
    const device = connectedRef.current;
    if (device) {
      await sendCommand('+\n', device);
      await sendCommand('-\n', device);
      await sendCommand('-\n', device); // endSession
      startStatusPolling(STATUS_POLL_INTERVAL);
      await queryDeviceStatus(device);
    }
  };

  const setIntensity = async value => {
    activeStrengthRef.current = value;
    if (sessionActiveRef.current && connectedRef.current) {
      await sendCommand(`${value}\n`);
    }
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
    startSession,
    stopSession,
    setIntensity,
    sendCommand,
  };

  return <PulsettoContext.Provider value={value}>{children}</PulsettoContext.Provider>;
}
