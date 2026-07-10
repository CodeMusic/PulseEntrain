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
    this.balance = 0; // −1 left … 0 both … +1 right flicker bias (Field mode)
    this.gazeAlt = false; // pitch past threshold → eyes detune / drift out of phase
    this.gazeSwap = false; // roll past threshold → the slowed eye hops each slow blink
    this._swapPhase = 0; // accumulates a slow-blink cycle for the swap
    this._swapState = false;
    this._kicking = false; // a phase-kick is briefly driving the eyes directly
    this._kickTimer = null;
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

  // Telemetry cadence: write a rate byte to the stream char (abcdef01). 0x01 is
  // the only live-confirmed rate (~1 Hz); higher bytes (0x02/0x05/0x0A…) are
  // speculative per the protocol — use the live Hz readout to see what sticks.
  async setTelemetryRate(byte) {
    if (!this.streamChar) return;
    try {
      await this.streamChar.writeWithoutResponse(Buffer.from([byte & 0xff]).toString('base64'));
    } catch (e) {}
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
  // frame streamed to keep cycling. Both eyes ramp toward the target beat (§6),
  // biased left/right by `balance` (−1 left … 0 both … +1 right) so head-roll can
  // slow one side's flicker independently (Field mode). Ramp is proportional so
  // the light tracks head/touch changes in ~1 s instead of crawling.
  startStrobe(beatHz) {
    if (beatHz != null) this.targetBeat = clampStrobe(beatHz);
    // Start from a clean pure-flash frame (level 0 = strobe, duty 0.5, phase 0).
    // The controller is a singleton, so without this a prior program's "both-lit"
    // style would leak in here and wash out the flash until Dev Tools reset it.
    const start = Math.min(2, this.targetBeat);
    this.values = { ...DEFAULT_VALUES(this.targetBeat), lFreq: start, rFreq: start };
    if (!this.device || !this.strobeChar) return;
    this.strobing = true;
    this._clearTick();
    this.tickTimer = setInterval(() => {
      if (!this.strobing || !this.strobeChar) return;
      if (this._kicking) return; // a phase-kick owns the eyes for its brief window
      const RATE_MIN = 0.5; // the leaned-toward eye slows to ~0.5 Hz (≈ stopped)
      const DT = 0.25; // tick period (s)
      let b = this.balance || 0;
      // Roll past threshold (gazeSwap): after each slow blink, hop the slowed eye to
      // the other side, so the slow flash walks between the eyes as you hold the tilt.
      if (this.gazeSwap && b !== 0) {
        const slowRate = this.targetBeat - Math.abs(b) * (this.targetBeat - RATE_MIN);
        this._swapPhase += Math.max(0.05, slowRate) * DT;
        if (this._swapPhase >= 1) { this._swapPhase -= 1; this._swapState = !this._swapState; }
        if (this._swapState) b = -b;
      } else {
        this._swapPhase = 0; this._swapState = false;
      }
      let lTarget = b < 0 ? this.targetBeat + b * (this.targetBeat - RATE_MIN) : this.targetBeat;
      let rTarget = b > 0 ? this.targetBeat - b * (this.targetBeat - RATE_MIN) : this.targetBeat;
      // Pitch past threshold (gazeAlt): detune the eyes a touch so they drift out of
      // sync — they cross through anti-phase (alternating) instead of blinking together.
      if (this.gazeAlt) {
        const ALT_DETUNE = 0.22; // wider split → the drift through anti-phase is more obvious
        lTarget *= 1 - ALT_DETUNE / 2;
        rTarget *= 1 + ALT_DETUNE / 2;
      }
      const ramp = (cur, tgt) => (Math.abs(tgt - cur) < 0.05 ? tgt : cur + (tgt - cur) * 0.35);
      this.values.lFreq = ramp(this.values.lFreq, lTarget);
      this.values.rFreq = ramp(this.values.rFreq, rTarget);
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

  // Field mode: bias the flicker left/right. −1 slows the left eye toward stop,
  // +1 the right, 0 keeps both in sync. Applied by the strobe tick, no BLE write.
  setBalance(b) {
    const v = Number(b);
    this.balance = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  }

  // Gaze thresholds (Field / Explore): once head pitch or roll passes ±threshold,
  // switch the eyes into a different flicker relationship (see the strobe tick).
  //   alternate — pitch past ±threshold: eyes drift out of phase (anti-phase blink)
  //   swap      — roll past ±threshold: the slowed eye hops sides each slow blink
  setGazePattern(p) {
    const o = p || {};
    this.gazeAlt = !!o.alternate;
    this.gazeSwap = !!o.swap;
    if (!this.gazeSwap) { this._swapPhase = 0; this._swapState = false; }
  }

  // DIAGNOSTIC: try to set a held phase offset with rate alone. Both eyes start at
  // targetBeat; for `ms`, run the right eye faster so it advances `cycles` extra
  // cycles, then restore matched rates. If the device free-runs (doesn't reset
  // phase per frame), the eyes end up offset and STAY that way — a real anti-phase.
  // If they snap back in sync, phase resets per frame and a true half-offset needs
  // firmware support. Streams frames at a fine cadence during the window.
  phaseKick(cycles = 0.5, ms = 500) {
    if (!this.device || !this.strobeChar || !this.strobing) return;
    if (this._kickTimer) { clearInterval(this._kickTimer); this._kickTimer = null; }
    const f = Math.max(0.5, this.targetBeat);
    const dRate = cycles / (ms / 1000); // extra Hz on the right eye for the window
    const t0 = Date.now();
    this._kicking = true;
    this.values.lFreq = f;
    this.values.rFreq = f;
    console.log(`[Nova] phaseKick START L=${f.toFixed(2)}Hz R=${(f + dRate).toFixed(2)}Hz for ${ms}ms (right eye advances ${cycles} cycle)`);
    this._kickTimer = setInterval(() => {
      const done = Date.now() - t0 >= ms;
      this.values.lFreq = f;
      this.values.rFreq = done ? f : f + dRate;
      const { hex } = this._frame();
      console.log(`[Nova] kick${done ? '·END' : ''} L=${this.values.lFreq.toFixed(2)} R=${this.values.rFreq.toFixed(2)} ${hex}`);
      try { this.strobeChar.writeWithoutResponse(this._frame().b64); } catch (e) {}
      if (done) {
        clearInterval(this._kickTimer);
        this._kickTimer = null;
        this._kicking = false; // hand the eyes back to the tick at matched rates
        console.log('[Nova] phaseKick done — WATCH THE EYES: do they hold anti-phase or resync?');
      }
    }, 50);
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
