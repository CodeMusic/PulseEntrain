import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';
// Strobe protocol (frame encoding + safety clamp) is platform-agnostic and lives
// in shared/ so a future desktop/Electron transport reuses the exact same bytes.
import {
  MAX_NOVA_STROBE_HZ,
  clampStrobe,
  buildFrame,
  offFrame,
  DEFAULT_VALUES,
} from '../shared/novaProtocol';

// Re-export the protocol's public surface so existing importers keep their path.
export { MAX_NOVA_STROBE_HZ, clampStrobe };

const NOVA_NAME = 'Lumenate Nova';
// Full characteristic UUIDs (service UUIDs aren't needed — we find chars by UUID).
const CH_STREAM = 'abcdef01-2345-6789-abcd-ef0123456789'; // stream-rate control (1 byte)
const CH_STROBE = 'f2c51a4e-2a46-4bef-b18f-cb00c716cfa6'; // strobe timing stream (LE uint32 array)
const CH_TELEMETRY = '12345678-9abc-4def-8012-3456789abcde'; // accelerometer notify (engine wants a subscriber)

export class NovaController {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.device = null;
    this.streamChar = null;
    this.strobeChar = null;
    this.strobing = false;
    this.targetBeat = 8;
    this.values = DEFAULT_VALUES(8);
    this.master = 1; // master brightness multiplier (0..1)
    this.tickTimer = null;
    this._lastHex = null;
    this.telemetryChar = null;
    this.telemetrySub = null;
    this.onMotion = null; // (sample) => void — head-motion listener (accelerometer)
  }

  // Register a listener for accelerometer samples. Each sample is the decoded
  // { x, y, z } plus derived { pitch, roll } degrees (see telemetry monitor).
  setMotionListener(fn) {
    this.onMotion = fn || null;
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
      // expects an active stream subscriber. Decode it too (6 bytes = 3×int16 LE
      // accelerometer x/y/z) and surface head pitch/roll for motion-driven modes.
      if (this.telemetryChar) {
        try {
          this.telemetrySub = this.telemetryChar.monitor((err, ch) => {
            if (err || !ch || !ch.value || !this.onMotion) return;
            const b = Buffer.from(ch.value, 'base64');
            if (b.length < 6) return;
            const x = b.readInt16LE(0), y = b.readInt16LE(2), z = b.readInt16LE(4);
            // Derived orientation (degrees). Axis→head mapping isn't documented,
            // so these are a starting point to calibrate against on-device:
            //   pitch (look up/down), roll (tilt left/right). Yaw isn't knowable
            //   from gravity alone.
            const pitch = (Math.atan2(-y, Math.hypot(x, z)) * 180) / Math.PI;
            const roll = (Math.atan2(x, Math.hypot(y, z)) * 180) / Math.PI;
            this.onMotion({ x, y, z, pitch, roll });
          });
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
    if (beatHz != null) this.targetBeat = clampStrobe(beatHz);
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
      const { b64, hex } = this._frame();
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
    this._pushFrame();
  }

  // Master brightness (0..1) scales both eyes uniformly.
  setMasterBrightness(m) {
    this.master = Math.min(1, Math.max(0, Number(m) || 0));
    this._pushFrame();
  }

  _frame() {
    const m = this.master;
    const v = { ...this.values, lLevel: this.values.lLevel * m, rLevel: this.values.rLevel * m };
    return buildFrame(v);
  }

  _pushFrame() {
    if (this.strobing && this.strobeChar) {
      this.strobeChar.writeWithoutResponse(this._frame().b64).catch(() => {});
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
