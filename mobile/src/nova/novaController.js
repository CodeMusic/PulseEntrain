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

// ── Strobe encoder — faithful port of the app's C4500z0.w0 / La.m.{a,b} ──
// Independent 10×uint32 (40B), little-endian, per eye:
//   [ period, on, period', on', level ]   (left block, then right block)
//   La.m.b(seconds) = round(seconds·1e6) clamped uint32   → period/on (µs)
//   La.m.a(level)   = round(level·1e6)   clamped uint32   → brightness ×1e6
//   on = duty·period ; period' = phase-adjusted period (= period when phase 0)
const U32_MAX = 0xffffffff;
const bSec = s =>
  !Number.isFinite(s) || s <= 0 ? 0 : Math.min(U32_MAX, Math.max(0, Math.round(s * 1e6)));
const aLvl = l => (!Number.isFinite(l) ? 0 : Math.min(U32_MAX, Math.max(0, Math.round(l * 1e6))));

function packLE(values) {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeUInt32LE(v >>> 0, i * 4));
  return buf;
}

// One eye → 5 ints. Frequency clamped for safety; phaseHz shifts the primed pair
// (drives the eye's 2nd LED).
function eyeInts(freqHz, duty, level, phaseHz) {
  const f = clampStrobe(freqHz);
  const period = 1 / f; // seconds
  const periodP = phaseHz && f - phaseHz > 0 ? 1 / (f - phaseHz) : period;
  return [bSec(period), bSec(period * duty), bSec(periodP), bSec(periodP * duty), aLvl(level)];
}

// Full 8-param SyncedValues → 40-byte frame (+ hex for logging).
function buildFrame(v) {
  const ints = [
    ...eyeInts(v.lFreq, v.lDuty, v.lLevel, v.lPhase),
    ...eyeInts(v.rFreq, v.rDuty, v.rLevel, v.rPhase),
  ];
  const buf = packLE(ints);
  return { b64: buf.toString('base64'), hex: buf.toString('hex') };
}

// All-dark frame (on-time 0, level 0) — used to clear the LEDs on stop.
function offFrame() {
  return buildFrame({ lFreq: 8, rFreq: 8, lDuty: 0, rDuty: 0, lLevel: 0, rLevel: 0, lPhase: 0, rPhase: 0 }).b64;
}

const DEFAULT_VALUES = beatHz => ({
  lFreq: beatHz,
  rFreq: beatHz,
  lDuty: 0.5,
  rDuty: 0.5,
  lLevel: 1,
  rLevel: 1,
  lPhase: 0,
  rPhase: 0,
});

export class NovaController {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    this.strobing = false;
    this.targetBeat = 8;
    this.values = DEFAULT_VALUES(8);
    this.tickTimer = null;
    this._lastHex = null;
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

  // Continuously stream the current frame (~every 250ms) — the device needs the
  // frame streamed to keep cycling. Both eyes ramp toward the target beat (§6).
  startStrobe(beatHz) {
    this.targetBeat = clampStrobe(beatHz);
    this.values = { ...this.values, lFreq: Math.min(2, this.targetBeat), rFreq: Math.min(2, this.targetBeat) };
    if (!this.device || !this.strobeChar) return;
    this.strobing = true;
    this._clearTick();
    this.tickTimer = setInterval(() => {
      if (!this.strobing || !this.strobeChar) return;
      const ramp = cur =>
        cur < this.targetBeat
          ? Math.min(this.targetBeat, cur + 0.5)
          : cur > this.targetBeat
          ? Math.max(this.targetBeat, cur - 0.5)
          : cur;
      this.values.lFreq = ramp(this.values.lFreq);
      this.values.rFreq = ramp(this.values.rFreq);
      const { b64, hex } = buildFrame(this.values);
      if (hex !== this._lastHex) {
        this._lastHex = hex;
        console.log('[Nova]', hex);
      }
      this.strobeChar.writeWithoutResponse(b64).catch(e => console.log('[Nova] write err:', e && e.message));
    }, 250);
  }

  // Entrainment: keep both eyes following the audio beat.
  setFrequency(hz) {
    this.targetBeat = clampStrobe(hz);
  }

  // Explorer: merge per-eye pattern params (brightness / phase / duty) live.
  setSyncedValues(patch) {
    this.values = { ...this.values, ...patch };
    if (this.strobing && this.strobeChar) {
      this.strobeChar.writeWithoutResponse(buildFrame(this.values).b64).catch(() => {});
    }
  }

  async stopStrobe() {
    this.strobing = false;
    this._clearTick();
    // Stopping the stream does NOT clear the LEDs — send an explicit off frame.
    if (this.strobeChar) {
      try {
        await this.strobeChar.writeWithoutResponse(offFrame());
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
