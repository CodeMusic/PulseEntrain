# ROLI Lightpad Block — Display (LED) Protocol · Advanced Reference

> **Status: UNVERIFIED SPEC — reference for a future implementation.**
> This documents how we *intend* to drive the Lightpad's 15×15 RGB LED grid from
> the app. The receive side (touch/MIDI in) is already built and confirmed; the
> **write/draw side below is not yet tested on hardware.** Treat every byte here
> as a hypothesis until Phase 2a (the spike) lights a real pixel. See
> [FIELD_MODE_PLAN.md](FIELD_MODE_PLAN.md) for how this fits the roadmap, and
> [LUMI_PROTOCOL.md](LUMI_PROTOCOL.md) for the shared BLE-MIDI transport.

---

## ⚠️ Provenance / trust

The pixel/bitmap command spec (below) came from research notes whose cited source
is a general blog about tool-calling — **not** ROLI documentation. What we can
independently trust:

- **Manufacturer ID `00 21 10` is genuinely ROLI Ltd.** (registered MMA SysEx ID).
- The **BLE service / characteristic are the ones we already talk to** for touch
  input, and that characteristic is **write-without-response** capable — so a
  write path physically exists.

Everything else — the command bytes (`0x0C`, `0x02`), the product ID (`0x03`), the
exact bit-packing, the framing — is **plausible but must be proven on-device**.
The real ROLI BLOCKS ecosystem normally drives LEDs via its proprietary *BLOCKS
Protocol* (a packed bitstream, see JUCE `juce_blocks_basics`) and/or a Littlefoot
app running on the block. The simple SysEx pixel command may or may not be honored
by current firmware.

---

## Transport (shared with touch input)

| | |
|---|---|
| BLE service | `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` |
| I/O characteristic | `7772E5DB-3868-4112-A1A9-F2669D106BF3` (notify **and** write-without-response) |
| Framing | Apple/MMA **BLE-MIDI**: `[header] [timestamp] <midi bytes…>` |
| Grid | **15 × 15** RGB LEDs, coordinates `x,y ∈ 0..14` |

### iOS MTU reality (important)
iOS **negotiates MTU itself** (commonly ~185 bytes, sometimes up to 512 on BLE 5)
— an app cannot force 512. So **do not rely on single-packet full-frame dumps**;
they will fragment and must be split across BLE-MIDI packets with continuation.
**Plan around single-pixel writes** (12 bytes each): they never fragment, and a
handful per frame is all we need. Full-frame bitmap is a later optimization only.

---

## Spec 1 — Set a single pixel (`0x0C`) — PREFERRED

12-byte SysEx. Low overhead; safe under any MTU. This is what we'll build first.

| Byte | Value | Field |
|---|---|---|
| 0 | `F0` | SysEx start |
| 1 | `00` | Manufacturer ID 1 |
| 2 | `21` | Manufacturer ID 2 |
| 3 | `10` | Manufacturer ID 3 (ROLI) |
| 4 | `03` | Product ID (Lightpad Block) — **verify** |
| 5 | `0C` | Command: set pixel — **verify** |
| 6 | `00..0E` | X (0–14) |
| 7 | `00..0E` | Y (0–14) |
| 8 | `00..7F` | Red (7-bit, 0–127) |
| 9 | `00..7F` | Green (7-bit) |
| 10 | `00..7F` | Blue (7-bit) |
| 11 | `F7` | SysEx end |

**Color scaling:** our colors are 8-bit RGB (0–255). MIDI data bytes are 7-bit
(0–127). Scale each channel `v7 = v8 >> 1` (or `round(v8 * 127 / 255)`). Any data
byte ≥ `0x80` corrupts the stream, so **every payload byte must be masked `& 0x7F`.**

---

## Spec 2 — Full bitmap frame (`0x02`) — LATER / OPTIONAL

Dump a full 15×15 matrix. Higher performance, but fragments under iOS MTU and needs
the 7-bit packer below. Deferred until single-pixel is proven and we actually need
full-frame animation.

### 8-bit → 7-bit packer
Raw pixel bytes (≥ `0x80` allowed) can't ride MIDI directly. Pack every 7 bits of
the raw stream into its own 7-bit MIDI byte:

```js
function pack8to7(raw /* Uint8Array */) {
  const out = [];
  let acc = 0, bits = 0;
  for (const byte of raw) {
    acc |= byte << bits;
    bits += 8;
    while (bits >= 7) {
      out.push(acc & 0x7f);
      acc >>= 7;
      bits -= 7;
    }
  }
  if (bits > 0) out.push(acc & 0x7f);
  return out; // all bytes 0x00..0x7F
}
```
ROLI commonly uses a packed 4-bit (RGBA4444-ish) or 7-bit-scaled array to save
bandwidth — the exact bitmap layout is **unconfirmed** and part of the spike.

---

## BLE-MIDI framing for SysEx

Wrap the SysEx bytes for BLE, per the Apple/MMA BLE-MIDI spec:

- **Header byte:** `0x80 | (timestampHigh & 0x3F)`.
- **Timestamp byte:** `0x80 | (timestampLow & 0x7F)` — precedes the SysEx **start**
  (`F0`). A running SysEx spanning packets uses continuation rules; the trailing
  `F7` also gets its own preceding timestamp byte.
- Timestamps are a rolling 13-bit millisecond counter; exact value isn't critical
  for our low-rate writes — keep it monotonic (pass one in, since `Date.now()` is
  unavailable in some contexts).

For single-pixel writes that fit one packet:
```
[0x80|tsHi] [0x80|tsLo] F0 00 21 10 03 0C x y r g b [0x80|tsLo] F7
```
(one timestamp before F0, one before F7). Confirm on hardware whether the block
wants a timestamp before the terminating `F7` — some parsers are lenient.

---

## The biggest risk: who owns the LEDs

The block's running **Note-Grid app lights its own LEDs on touch, autonomously.**
Our external writes may be **ignored or immediately overwritten** by that app. Very
possibly we must first put the block into a host-controlled / blank mode (a
Littlefoot upload, or a specific mode command) before it accepts our pixels. This
is the #1 thing the spike must determine. If external writes don't stick, options:
1. Find/craft the mode-select or minimal Littlefoot "host display" app.
2. Capture what **ROLI Dashboard** sends over BLE when it recolors the pad, and
   replay that framing.
3. Accept the block's own touch-glow (our current state) and skip custom LEDs.

---

## Phase 2a — the spike (do this first)

1. `shared/lightpadDisplay.js` (pure): `setPixel(x,y,r,g,b) → Uint8Array` (the
   12-byte SysEx), `frameBLE(sysexBytes, ts)` (BLE-MIDI wrap), and `pack8to7`.
2. Add `writePixel(x,y,r,g,b)` to the Lightpad transport (write-no-response to
   `7772E5DB…`), throttled.
3. **Test:** light pixel (7,7) full red. Decision tree:
   - Lights → protocol confirmed → Phase 2b (field rendering).
   - Nothing / flickers back to the note colors → the app owns the LEDs → pursue
     the mode/Littlefoot/Dashboard-capture path before investing further.

## Phase 2b — field rendering (only if the spike lights)

- Map our 5×5 note cells → 3×3 LED blocks on the 15×15 grid.
- Draw: gradient base + the touched cell in `carrierColor(carrier)` + a fading
  "echo" of recent touches; throttle to ~10 fps via batched single-pixel writes.
- The block is **ambient feedback**, NOT the entrainment strobe (that's the Nova).
  Do not flash the block at the beat rate.

## Integration notes

- Reuse the existing `LumiController` write path (it already holds the
  characteristic) or add a thin display method beside it; keep the pure packet
  building in `shared/lightpadDisplay.js` so it's testable in Node.
- Throttle writes hard (BLE-MIDI is low-bandwidth); coalesce per-frame pixel diffs.
- Feature-flag the whole thing so a firmware that ignores writes degrades to
  today's built-in touch-glow with no user-visible error.

---

## Appendix A — original research notes (verbatim, unverified)

> Set LED command `0x0C`, 12 bytes: `F0 00 21 10 03 0C x y r g b F7` (x,y 0–14;
> r,g,b 7-bit). Bitmap dump command `0x02`, 15×15, 4-bit/7-bit packed. 8→7 packer
> as above. BLE-MIDI wrap: header `0x80+`, timestamp `0x80 | (ts & 0x3F)`. Service
> `03B80E5A-…`, characteristic `7772E5DB-…`, request MTU ≥ 512. (Cited source was a
> general tool-calling blog — treat as unverified.)
