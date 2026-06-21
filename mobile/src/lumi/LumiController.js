import { Buffer } from 'buffer';
import { bleManager } from '../ble/manager';
import { LUMI_SERVICE, LUMI_CHAR, isLumi, parseBleMidi } from '../shared/lumiProtocol';

// ROLI LUMI Keys — BLE-MIDI transport. Scans for the MIDI service, subscribes to
// the I/O characteristic, and forwards note-on/off events (parsed via the shared
// protocol). Receive-only for now (no lighting writes — touch-glow is on-device).
// Mirrors the Nova/Pulsetto controller pattern over the shared BLE manager.
export class LumiController {
  constructor(onStatus) {
    this.onStatus = onStatus || (() => {});
    this.device = null;
    this.char = null;
    this.sub = null;
    this.onNote = null; // (event) => void, event = { type, note, velocity, channel }
  }

  get connected() {
    return !!this.device;
  }

  setNoteListener(fn) {
    this.onNote = fn || null;
  }

  async _waitForPoweredOn() {
    try {
      if ((await bleManager.state()) === 'PoweredOn') return true;
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

  async connect() {
    if (this.device) return true;
    this.onStatus('scanning');
    if (!(await this._waitForPoweredOn())) {
      this.onStatus('error');
      return false;
    }
    return new Promise(resolve => {
      let settled = false;
      const finish = ok => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      bleManager.stopDeviceScan();
      bleManager.startDeviceScan([LUMI_SERVICE], null, async (error, device) => {
        if (error) {
          this.onStatus('error');
          finish(false);
          return;
        }
        if (device && (isLumi(device.name) || true)) {
          // scan is already filtered to the MIDI service; accept the first match
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
          if ((c.uuid || '').toLowerCase() === LUMI_CHAR) this.char = c;
        }
      }
      if (!this.char) {
        this.onStatus('error');
        return false;
      }
      this._logTs = 0;
      this.sub = this.char.monitor((err, ch) => {
        if (err || !ch || !ch.value || !this.onNote) return;
        const bytes = Buffer.from(ch.value, 'base64');
        const evs = parseBleMidi(bytes);
        // Diagnostic (throttled): see exactly what the keyboard emits — note-on
        // (carrier), CC74 slide (beat), pressure (volume), poly-AT, pitch-bend.
        const now = Date.now();
        if (now - this._logTs > 150) {
          this._logTs = now;
          const summary = evs
            .map(e => e.type + (e.controller != null ? ':cc' + e.controller : '') + (e.value != null ? '=' + e.value : ''))
            .join(' ');
          console.log('[LUMI]', bytes.toString('hex'), '→', summary || '(none)');
        }
        for (const ev of evs) this.onNote(ev);
      });
      this.device = dev;
      dev.onDisconnected(() => {
        this.device = null;
        this.char = null;
        this.onStatus('disconnected');
      });
      this.onStatus('connected');
      return true;
    } catch (e) {
      this.onStatus('error');
      return false;
    }
  }

  async disconnect() {
    if (this.sub) {
      try {
        this.sub.remove();
      } catch (e) {}
      this.sub = null;
    }
    const dev = this.device;
    this.device = null;
    this.char = null;
    if (dev) {
      try {
        await bleManager.cancelDeviceConnection(dev.id);
      } catch (e) {}
    }
    this.onStatus('idle');
  }
}
