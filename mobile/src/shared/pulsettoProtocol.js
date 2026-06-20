// Pulsetto UART PROTOCOL — pure, platform-agnostic (no BLE, no RN APIs).
// Command strings, level clamping, battery math, and notification parsing — the
// bits a desktop/Electron transport would reuse verbatim. The RN transport
// (PulsettoProvider) and any future transport differ only in how bytes are
// written/subscribed; what to write lives here.

// BLE identifiers (UART service) — the transport needs these to find the device.
export const DEVICE_NAME_PREFIX = 'Pulsetto';
export const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const UART_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
export const UART_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify

const BATTERY_FULL_VOLTAGE = 3.9;
const BATTERY_EMPTY_VOLTAGE = 3.5;

// Safety: the Pulsetto only accepts level 0-9. Coerce any input (a tampered
// .imed strength, a bad slider value, NaN, etc.) into range so the device can
// never be sent something out of bounds. 0 = off (ramp / pause); stim is 1-9.
export const clampLevel = (n, min = 0) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.min(9, Math.max(min, v));
};

// Battery voltage → percentage (linear between empty and full).
export const batteryPercent = voltage => {
  if (voltage >= BATTERY_FULL_VOLTAGE) return 100;
  if (voltage <= BATTERY_EMPTY_VOLTAGE) return 0;
  return Math.round(
    ((voltage - BATTERY_EMPTY_VOLTAGE) / (BATTERY_FULL_VOLTAGE - BATTERY_EMPTY_VOLTAGE)) * 100,
  );
};

// Newline-terminated UART commands (from the official APK). `level` is dynamic.
export const CMD = {
  rampUp: '+\n',
  rampDown: '-\n',
  off: '0\n',
  calib: '5\n',
  bothSides: 'D\n', // both pads
  ledLow: 'E\n',
  queryCharging: 'u\n',
  queryBattery: 'Q\n',
  queryFirmware: 'v\n',
  queryIdentity: 'i\n',
};
export const levelCmd = (n, min = 0) => `${clampLevel(n, min)}\n`;

// Parse a TX notification into a state patch ({ battery?, charging? }). Pure —
// the transport applies the patch to its own state.
export function parseNotification(decoded, rawBytes) {
  const out = {};
  const t = (decoded || '').trim();
  if (t.startsWith('Batt:')) {
    const v = parseFloat(t.split('Batt:')[1]);
    if (Number.isFinite(v)) out.battery = batteryPercent(v);
  }
  if (rawBytes && rawBytes.length >= 3 && rawBytes[0] === 0x75 && rawBytes[1] === 0x01) {
    if (rawBytes[2] === 0x30) out.charging = 'Not Charging';
    else if (rawBytes[2] === 0x31) out.charging = 'Charging';
  }
  return out;
}
