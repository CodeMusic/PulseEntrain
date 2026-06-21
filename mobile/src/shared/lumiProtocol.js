// ROLI LUMI Keys — BLE-MIDI protocol (pure, platform-agnostic). LUMI speaks the
// standard MMA "MIDI over BLE" profile, so this is generic BLE-MIDI: subscribe to
// one characteristic, strip the BLE timestamp framing, read note-on/off. MPE means
// notes arrive across many channels with interleaved pitch-bend/pressure — we mask
// the channel and skip expression. See docs/LUMI_PROTOCOL.md.

// Standard BLE-MIDI GATT (fixed across all BLE-MIDI devices).
export const LUMI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const LUMI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3'; // notify + write-no-response
export const isLumi = name => !!(name && /lumi/i.test(name));

// MIDI note number → frequency (Hz). A4 (69) = 440 Hz.
export const midiNoteToHz = n => 440 * Math.pow(2, (n - 69) / 12);

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = n => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

// Parse a BLE-MIDI notification (byte array) → [{type:'noteOn'|'noteOff', note,
// velocity, channel}]. Positional parse: both timestamp and status bytes set bit7,
// so we can't route by "MSB set". Expression messages are skipped by data-byte
// count to keep the stream aligned. (Mirrors the reference parser in the doc.)
export function parseBleMidi(buf) {
  const out = [];
  if (!buf || buf.length < 3) return out; // header + ts + status minimum
  let i = 1; // buf[0] = header (timestampHigh)
  let running = 0;
  while (i < buf.length) {
    if (buf[i] & 0x80) i++; // consume the timestamp-low byte preceding a message
    if (i >= buf.length) break;

    let status;
    if (buf[i] & 0x80) {
      status = buf[i];
      running = status;
      i++;
    } else {
      status = running; // running status
    }
    const hi = status & 0xf0;
    const ch = status & 0x0f;

    if (hi === 0x90 || hi === 0x80) {
      const note = buf[i++];
      const vel = buf[i++];
      const type = hi === 0x90 && vel > 0 ? 'noteOn' : 'noteOff'; // velocity 0 = note-off
      out.push({ type, note, velocity: vel, channel: ch });
    } else if (hi === 0xb0) {
      const controller = buf[i++];
      const value = buf[i++];
      out.push({ type: 'cc', controller, value, channel: ch }); // CC74 = MPE slide (Y)
    } else if (hi === 0xd0) {
      out.push({ type: 'pressure', value: buf[i++], channel: ch }); // channel pressure (Z)
    } else if (hi === 0xa0) {
      const note = buf[i++];
      const value = buf[i++];
      out.push({ type: 'polyAT', note, value, channel: ch }); // poly aftertouch (per-key Z)
    } else if (hi === 0xe0) {
      const lsb = buf[i++];
      const msb = buf[i++];
      out.push({ type: 'pitchBend', value: ((msb << 7) | lsb) - 8192, channel: ch }); // glide (X)
    } else if (hi === 0xc0) {
      i += 1; // program change — 1 data byte
    } else {
      i++; // system/unknown — step forward and resync
    }
  }
  return out;
}
