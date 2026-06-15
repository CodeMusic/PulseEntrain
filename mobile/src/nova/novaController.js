import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';

const NOVA_NAME = 'Lumenate Nova';
// Full characteristic UUIDs (service UUIDs aren't needed — we find chars by UUID).
const CH_STREAM = 'abcdef01-2345-6789-abcd-ef0123456789'; // stream-rate control (1 byte)
const CH_STROBE = 'f2c51a4e-2a46-4bef-b18f-cb00c716cfa6'; // strobe timing stream (LE uint32 array)

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

// Symmetric strobe frame: [period_µs, on_µs, onLevel×1e6] little-endian (12 bytes).
function encodeSymmetric(freqHz, duty = 0.5, onLevel = 1.0) {
  const periodUs = Math.round(1e6 / freqHz);
  const onUs = Math.round((duty / freqHz) * 1e6);
  const level = Math.round(onLevel * 1e6);
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(periodUs >>> 0, 0);
  buf.writeUInt32LE(onUs >>> 0, 4);
  buf.writeUInt32LE(level >>> 0, 8);
  return buf.toString('base64');
}

export class NovaController {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    this.strobing = false;
    this.targetHz = 8;
    this.rampTimer = null;
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
      const match = known.find(d => this._isNova(d)) || (known.length === 1 ? known[0] : null);
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
        }
      }
      if (!this.strobeChar) {
        this.onStatus('error');
        return false;
      }
      if (this.streamChar) {
        await this.streamChar.writeWithoutResponse(Buffer.from([0x01]).toString('base64'));
      }
      this.device = dev;
      dev.onDisconnected(() => {
        this.device = null;
        this.streamChar = null;
        this.strobeChar = null;
        this.strobing = false;
        this._clearRamp();
        this.onStatus('disconnected');
      });
      this.onStatus('connected');
      return true;
    } catch (e) {
      this.onStatus('error');
      return false;
    }
  }

  _clearRamp() {
    if (this.rampTimer) {
      clearTimeout(this.rampTimer);
      this.rampTimer = null;
    }
  }

  async _writeStrobe(hz) {
    if (!this.strobeChar) return;
    try {
      await this.strobeChar.writeWithoutResponse(encodeSymmetric(clampStrobe(hz)));
    } catch (e) {}
  }

  // Ramp from a low frequency up to the target so the strobe never starts abruptly (§6).
  startStrobe(hz) {
    this.targetHz = clampStrobe(hz);
    if (!this.device) return;
    this.strobing = true;
    this._clearRamp();
    const target = this.targetHz;
    let cur = Math.min(2, target);
    const inc = Math.max(0.5, (target - cur) / 8);
    const step = () => {
      if (!this.strobing) return;
      this._writeStrobe(cur);
      if (cur < target) {
        cur = Math.min(target, cur + inc);
        this.rampTimer = setTimeout(step, 150);
      }
    };
    step();
  }

  // Live update from the slider — small deltas, applied directly.
  setFrequency(hz) {
    this.targetHz = clampStrobe(hz);
    if (this.strobing && this.device) this._writeStrobe(this.targetHz);
  }

  async stopStrobe() {
    this.strobing = false;
    this._clearRamp();
    if (this.streamChar) {
      try {
        await this.streamChar.writeWithoutResponse(Buffer.from([0x00]).toString('base64'));
      } catch (e) {}
    }
  }

  async disconnect() {
    await this.stopStrobe();
    const dev = this.device;
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    if (dev) {
      try {
        await bleManager.cancelDeviceConnection(dev.id);
      } catch (e) {}
    }
    this.onStatus('idle');
  }
}
