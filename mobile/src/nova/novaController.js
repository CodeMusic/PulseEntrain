import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';

const NOVA_NAME = 'Lumenate Nova';
// Full characteristic UUIDs (service UUIDs aren't needed — we find chars by UUID).
const CH_STREAM = 'abcdef01-2345-6789-abcd-ef0123456789'; // stream-rate control (1 byte)
const CH_STROBE = 'f2c51a4e-2a46-4bef-b18f-cb00c716cfa6'; // strobe timing stream (LE uint32 array)
const CH_TELEMETRY = '12345678-9abc-4def-8012-3456789abcde'; // accelerometer notify (engine wants a subscriber)

// ⚠️ SAFETY (protocol §6): the device enforces NO frequency limit. Stroboscopic
// light 3–60 Hz can provoke photosensitive seizures (15–25 Hz peak risk). We cap
// the strobe in the calm delta/theta/alpha range, below that band. The audio beat
// can go higher; the light will not follow past this ceiling.
export const MAX_NOVA_STROBE_HZ = 13;
const MIN_NOVA_STROBE_HZ = 0.5;
export const clampStrobe = hz => {
  const v = Number(hz);
  if (!Number.isFinite(v)) return MIN_NOVA_STROBE_HZ;
  return Math.min(MAX_NOVA_STROBE_HZ, Math.max(MIN_NOVA_STROBE_HZ, v));
};

// Strobe frame layout. 'symmetric' = 3×uint32 (12B) [period_µs, on_µs, level×1e6].
// 'independent' = 10×uint32 (40B) per-eye [period,on,period',on',level]×2.
// If the device lights but won't flicker on one, flip this to try the other.
const FRAME_LAYOUT = 'symmetric';
// The device reads the frame as [on_µs, period_µs, level] — sending the
// documented [period, on, …] order left the LEDs constant-on (on-time > period,
// so it can never switch off). Swap so the device sees on < period and cycles.
const SWAP_PERIOD_ON = true;

function packLE(values) {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeUInt32LE(v >>> 0, i * 4));
  return buf;
}
function frameValues(freqHz, duty, onLevel) {
  const period = Math.round(1e6 / freqHz);
  const on = Math.round((duty / freqHz) * 1e6);
  const level = Math.round(onLevel * 1e6);
  const a = SWAP_PERIOD_ON ? on : period;
  const b = SWAP_PERIOD_ON ? period : on;
  return FRAME_LAYOUT === 'independent'
    ? [a, b, a, b, level, a, b, a, b, level]
    : [a, b, level];
}
function encodeFrame(freqHz, duty = 0.5, onLevel = 1.0) {
  return packLE(frameValues(freqHz, duty, onLevel)).toString('base64');
}
// "Off" frame — on-time 0 + level 0 → LEDs dark (stopping the stream alone
// doesn't clear the last frame).
function encodeOff() {
  return packLE(frameValues(8, 0, 0)).toString('base64');
}
function frameHex(freqHz) {
  return packLE(frameValues(freqHz, 0.5, 1.0)).toString('hex');
}

export class NovaController {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    this.strobing = false;
    this.targetHz = 8;
    this.currentHz = 2;
    this.tickTimer = null;
    this.telemetryChar = null;
    this.telemetrySub = null;
  }

  get connected() {
    return !!this.device;
  }

  // Wait until the BLE radio is actually powered on (avoids the "invalid state"
  // race where we scan before CoreBluetooth is ready).
  async _waitForPoweredOn() {
    try {
      const state = await bleManager.state();
      if (state === 'PoweredOn') return true;
      return await new Promise(resolve => {
        const sub = bleManager.onStateChange(s => {
          if (s === 'PoweredOn') {
            sub.remove();
            resolve(true);
          }
        }, true);
        setTimeout(() => {
          sub.remove();
          resolve(false);
        }, 6000);
      });
    } catch (e) {
      return false;
    }
  }

  _isNova(device) {
    return !!(device && device.name && /lumenate|nova/i.test(device.name));
  }

  async connect() {
    if (this.device) return true;
    this.onStatus('scanning');

    if (!(await this._waitForPoweredOn())) {
      this.onStatus('error');
      return false;
    }

    // 1) If it's already paired/connected at the OS level it won't advertise, so
    //    a scan can't see it — retrieve it from the system's connected devices.
    try {
      const known = await bleManager.connectedDevices([
        '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
        '0000180f-0000-1000-8000-00805f9b34fb', // Battery
      ]);
      const match = known.find(d => this._isNova(d));
      if (match && (await this._setup(match.id))) return true;
    } catch (e) {}

    // 2) Otherwise scan for it.
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      bleManager.stopDeviceScan(); // shared manager — clear any in-flight scan
      bleManager.startDeviceScan(null, null, async (error, device) => {
        if (error) {
          this.onStatus('error');
          finish(false);
          return;
        }
        if (device && device.name) console.log('[Nova] discovered:', device.name);
        if (this._isNova(device)) {
          bleManager.stopDeviceScan();
          finish(await this._setup(device.id));
        }
      });
      setTimeout(() => {
        if (!this.device) {
          bleManager.stopDeviceScan();
          this.onStatus('notfound');
          finish(false);
        }
      }, 15000);
    });
  }

  async _setup(deviceId) {
    try {
      const dev = await bleManager.connectToDevice(deviceId, { requestMTU: 64 });
      await dev.discoverAllServicesAndCharacteristics();
      const services = await dev.services();
      for (const s of services) {
        const chars = await s.characteristics();
        for (const c of chars) {
          const u = (c.uuid || '').toLowerCase();
          if (u === CH_STREAM) this.streamChar = c;
          if (u === CH_STROBE) this.strobeChar = c;
          if (u === CH_TELEMETRY) this.telemetryChar = c;
        }
      }
      console.log(
        `[Nova] chars: stream=${!!this.streamChar} strobe=${!!this.strobeChar} telemetry=${!!this.telemetryChar}`,
      );
      if (!this.strobeChar) {
        this.onStatus('error');
        return false;
      }
      // Step 3 (protocol brief): subscribe to telemetry — the strobe engine
      // expects an active stream subscriber. We ignore the data.
      if (this.telemetryChar) {
        try {
          this.telemetrySub = this.telemetryChar.monitor(() => {});
        } catch (e) {}
      }
      // Step 4: start the data stream.
      if (this.streamChar) {
        await this.streamChar.writeWithoutResponse(Buffer.from([0x01]).toString('base64'));
      }
      this.device = dev;
      dev.onDisconnected(() => {
        this.device = null;
        this.streamChar = null;
        this.strobeChar = null;
        this.telemetryChar = null;
        this.strobing = false;
        this._clearTick();
        this.onStatus('disconnected');
      });
      this.onStatus('connected');
      return true;
    } catch (e) {
      this.onStatus('error');
      return false;
    }
  }

  _clearTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // Continuously stream the strobe frame (~every 250ms) while ramping currentHz
  // toward targetHz. A single frame just holds a static on-level, so the device
  // needs the frame streamed to actually flicker; ramping avoids an abrupt onset (§6).
  startStrobe(hz) {
    this.targetHz = clampStrobe(hz);
    this.currentHz = Math.min(2, this.targetHz);
    if (!this.device || !this.strobeChar) return;
    this.strobing = true;
    this._clearTick();
    this.tickTimer = setInterval(() => {
      if (!this.strobing || !this.strobeChar) return;
      if (this.currentHz < this.targetHz) {
        this.currentHz = Math.min(this.targetHz, this.currentHz + 0.5);
      } else if (this.currentHz > this.targetHz) {
        this.currentHz = Math.max(this.targetHz, this.currentHz - 0.5);
      }
      const hz = this.currentHz;
      if (hz !== this._lastLoggedHz) {
        this._lastLoggedHz = hz;
        console.log(`[Nova] ${FRAME_LAYOUT} ${hz.toFixed(1)}Hz ${frameHex(hz)}`);
      }
      this.strobeChar
        .writeWithoutResponse(encodeFrame(hz))
        .catch(e => console.log('[Nova] write err:', e && e.message));
    }, 250);
  }

  // Live update from the slider — the tick ramps toward the new target.
  setFrequency(hz) {
    this.targetHz = clampStrobe(hz);
  }

  async stopStrobe() {
    this.strobing = false;
    this._clearTick();
    // Stopping the stream does NOT clear the LEDs — send an explicit off frame.
    if (this.strobeChar) {
      try {
        await this.strobeChar.writeWithoutResponse(encodeOff());
      } catch (e) {}
    }
    if (this.streamChar) {
      try {
        await this.streamChar.writeWithoutResponse(Buffer.from([0x00]).toString('base64'));
      } catch (e) {}
    }
  }

  async disconnect() {
    await this.stopStrobe();
    if (this.telemetrySub) {
      try {
        this.telemetrySub.remove();
      } catch (e) {}
      this.telemetrySub = null;
    }
    const dev = this.device;
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    this.telemetryChar = null;
    if (dev) {
      try {
        await bleManager.cancelDeviceConnection(dev.id);
      } catch (e) {}
    }
    this.onStatus('idle');
  }
}
