# ROLI LUMI Keys — BLE Protocol & Build Guide

> **Status: SPEC-GROUNDED (connect + receive). Lighting control = Phase 2.**
> LUMI speaks the **published BLE-MIDI standard** (MMA "MIDI over BLE"), so the
> connect/receive path needs no reverse engineering — only on-hardware
> confirmation of a few specifics.
> ✅ spec-confirmed (BLE-MIDI standard) · 🔬 verify-on-hardware · 🔶 external/inferred

> **Also covers the ROLI Lightpad Block / Block M.** These are the same BLE-MIDI /
> MPE transport as the LUMI — the *connect + receive* half of this guide applies
> unchanged. Only the client-side mapping differs: LUMI reads note-on as a keyboard
> (note → carrier, black keys → beat), while the Lightpad is read as an XY pad
> (MPE glide/note → carrier, slide CC74 → beat, pressure → volume). In the app one
> [`LumiController`](../mobile/src/lumi/LumiController.js) serves both, matched by
> device name (`isLumi` / `isLightpad`). The Block and Block M differ only in
> surface material and LED brightness (both are the 15×15 / 225-cell surface) — the
> protocol is identical. Custom LED colouring on either pad still needs ROLI's
> proprietary **BLOCKS** protocol (a future spike), not standard MIDI.

---

## ⚡ Agent Brief (read first)

You are building a client that connects to a **ROLI LUMI Keys** controller and
**receives the notes the player presses**. The keyboard lights its own keys as
they're touched — that is **device-side behavior** and requires **zero writes**
from you. Build exactly this flow:

```
1. Scan for the BLE-MIDI service 03B80E5A-… (name contains "LUMI")
2. Connect; discover services
3. requestMtu(>=64)                      # keeps packed packets from truncating
4. Enable notifications on 7772E5DB-…    # the MIDI I/O characteristic
5. Parse each notification → strip BLE-MIDI framing → MIDI note-on/off events
6. (Lights "as you touch" already happen on-device — see §5)
```

**Non-negotiable rules for the agent:**
- **Do NOT write anything to drive the touch-glow.** It's autonomous. Writing is
  only for Phase 2 (changing colours/scales). See §5.
- The MIDI I/O characteristic is **write-without-response** for any writes.
- **LUMI is an MPE device** — notes arrive across **multiple channels**, with
  per-note pitch-bend and pressure interleaved. Mask the channel; skip the
  expression messages unless you want them. See §4.
- Treat the parser in §3 as the thing to verify first: `console.log` raw bytes,
  mash keys, confirm note numbers before building on top.

---

## Device Summary

| Property | Value |
|---|---|
| Transport | **BLE-MIDI** (MMA "Specification for MIDI over Bluetooth LE") ✅ |
| Profile | **MPE** (MIDI Polyphonic Expression) — per-note pitch-bend + pressure ✅ |
| Lighting | On-device colour modes (Pro / User / Piano / Stage / Rainbow), stored on the keyboard, toggled by the power button — renders touch-response autonomously ✅ |
| Wired alt | USB-C also presents as a standard USB-MIDI device 🔬 |

> **Implication:** for "connect + receive + normal glow," LUMI is a *generic
> BLE-MIDI source*. Any code that works for one BLE-MIDI controller works here.

---

## GATT Map ✅ (standard BLE-MIDI — fixed across all devices)

| UUID | Role | Type |
|---|---|---|
| `03B80E5A-EDE8-4B33-A751-6CE34EC4C700` | **MIDI service** | service |
| `7772E5DB-3868-4112-A1A9-F2669D106BF3` | **MIDI I/O characteristic** | notify + write-no-resp |

There is **one** characteristic for both directions: you **subscribe** to it to
receive notes, and (Phase 2) **write** to it to send SysEx. No other
characteristics are needed for note input.

---

## 1. Connect 🔬

- Scan for peripherals advertising service `03B80E5A-…`. Filter by advertised
  name containing **`LUMI`** *(exact string — confirm via scan; e.g. `LUMI Keys`)*.
- Connect, discover services, locate char `7772E5DB-…`.
- `requestMtu(>=64)` after connect. Default ATT (23) works for single notes, but
  LUMI packs multiple MPE messages per packet; a larger MTU avoids truncation.
- **Bonding:** BLE-MIDI characteristics are typically not encryption-gated, so a
  bond may not be required to read notes 🔶 — but implement pairing for robust
  reconnection.

## 2. Subscribe = "receive notes" ✅

Enable notifications (write CCCD) on `7772E5DB-…`. Every key press/release now
arrives as a notification. **That is the entire receive path.** Decode each
notification with §3 → §4.

---

## 3. BLE-MIDI packet framing ✅ (this is the only non-obvious part)

Notifications are **not** raw MIDI — they're wrapped with BLE timestamps:

```
[ header ][ ts-low ][ MIDI msg ][ ts-low ][ MIDI msg ] …
 header = 1 0 h h h h h h   (bit7=1, bit6=0, low 6 bits = timestampHigh)
 ts-low = 1 l l l l l l l   (bit7=1, low 7 bits = timestampLow)
 status = 1 . . . . . . .   (bit7=1)   data = 0 . . . . . . .  (bit7=0)
```

Because timestamp bytes **and** status bytes both set bit 7, you must parse
**positionally**, not by "MSB set = status." Reference parser (RN/JS flavour):

```js
// 🔬 verify against real LUMI output — running-status timestamp handling is the
// edge case most likely to need a tweak.
function parseBleMidi(buf) {
  const out = [];
  if (buf.length < 3) return out;          // header + ts + status minimum
  let i = 1;                               // buf[0] = header (timestampHigh) — ignorable for routing
  let running = 0;
  while (i < buf.length) {
    if (buf[i] & 0x80) i++;                // consume the timestamp-low byte preceding a message
    if (i >= buf.length) break;

    let status;
    if (buf[i] & 0x80) { status = buf[i]; running = status; i++; }
    else { status = running; }             // running status: reuse previous

    const hi = status & 0xf0;
    const ch = status & 0x0f;

    if (hi === 0x90 || hi === 0x80) {      // note on / off
      const note = buf[i++], vel = buf[i++];
      const type = (hi === 0x90 && vel > 0) ? 'noteOn' : 'noteOff'; // vel 0 = note off!
      out.push({ type, note, velocity: vel, channel: ch });
    } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
      i += 2;                              // poly-AT / CC / pitch-bend → 2 data bytes (MPE expression)
    } else if (hi === 0xc0 || hi === 0xd0) {
      i += 1;                              // program change / channel pressure → 1 data byte
    } else {
      i++;                                 // system/unknown → step forward and resync
    }
  }
  return out;
}
```

**Golden behaviour to confirm:** press middle C → expect a `noteOn` with
`note = 60`; release → `noteOff` (or `noteOn` with `velocity = 0`). If that lands
cleanly while you ignore the interleaved pitch-bend/pressure spam, the parser is
correct.

---

## 4. Note semantics ✅ / 🔬

- **Note-on:** status `0x90–0x9F`, `[note, velocity]`. **Velocity 0 = note-off.**
- **Note-off:** status `0x80–0x8F`, `[note, velocity]`.
- **MPE channel spread 🔬:** LUMI assigns each held note its own MIDI channel
  (default MPE zone uses channels 2–16; channel 1 is the global/master). For
  "just the notes," **mask the channel** (`status & 0xf0`) and read note+velocity;
  don't assume channel 1. Confirm the exact zone layout via sniff if you later
  need per-note routing.
- **Expression you can ignore (for now):** poly aftertouch (`0xA0`), CC (`0xB0`),
  channel pressure (`0xD0`), pitch-bend (`0xE0`). The parser skips them by data-
  byte count so the stream stays aligned — that's the only reason to handle them.

---

## 5. Lighting — what's free vs. what's Phase 2

### Free (no writes) ✅
The "keys light up as you touch them" is rendered **on the device** by whichever
colour mode is active (Pro / User / Piano / Stage / Rainbow). Set a mode once
(via the power button or ROLI software); it persists. Your client does **nothing**
to make touch-glow work.

### Phase 2 — app-driven lighting 🔶 (NOT required for the current goal)
To *change* what lights up (custom colours, scale highlighting, or — the actual
PulseEntrain payoff — **pulsing keys in sync with the binaural beat**), you send
ROLI's **proprietary SysEx** over the same characteristic (`7772E5DB-…`).

- This is **not** part of the BLE-MIDI standard and is **not yet captured here.**
- **Cheapest source:** the community reverse-engineering of LUMI's SysEx lighting
  commands (e.g. the `benob/LUMI-lights` project) documents the command structure
  and checksum. Fold that table in and verify on hardware **before** trusting it.
- **Do not** decompile the APK from scratch for this — it's the most expensive
  route and the SysEx is already largely mapped externally.

> Placeholder for the verified command table:
> ```
> SysEx frame:  F0 <ROLI manufacturer id> <device/space> <command…> <checksum> F7
> (populate from benob's table + on-hardware confirmation)
> ```

---

## 6. ⚠️ SAFETY — relevant only if Phase 2 drives lights at flicker rates

Plain note-input and normal touch-glow carry **no** photosensitivity concern.
**But** if you later sync the whole keybed's brightness to a beat *frequency*
(the entrainment idea), you re-enter strobe territory:

- Whole-field flicker in **~3–60 Hz** (peak risk **15–25 Hz**) can provoke
  photosensitive seizures. Your binaural target band (theta 4–8 Hz, alpha
  8–13 Hz) overlaps the low end.
- **Client owns the clamp** (same discipline as your Lumenate build): configurable
  max, conservative default, explicit photosensitivity opt-in, ramp don't step,
  reachable hard-stop.
- This only applies to **synchronized global brightness modulation**, not to
  per-key "note played" highlighting.

---

## 7. Implementation requirements

- **MTU:** `requestMtu(>=64)` after connect, before relying on packed packets.
- **Write type:** any write (Phase 2 SysEx) → write-without-response on `7772E5DB-…`.
- **Notifications:** enable CCCD on `7772E5DB-…` before expecting notes.
- **Parser:** strip BLE-MIDI framing (§3); never feed raw notification bytes to a
  MIDI handler expecting plain status/data.
- **Reconnect:** handle pairing/bond for clean re-pair after sleep.

---

## 8. On-hardware verification tests

1. **Advertised name/UUID:** scan → confirm the device exposes `03B80E5A-…` and
   note its exact advertised name. Locks the scan filter.
2. **Note round-trip:** subscribe, press a known key (middle C) → confirm
   `note = 60`, correct on/off, velocity-0-as-off handling. Locks §3 + §4.
3. **MPE channel spread:** hold 3 keys → confirm each arrives on a distinct
   channel; map the zone. Confirms the channel-mask assumption.
4. **Expression skip:** while holding/pressing, confirm pitch-bend/pressure
   traffic does **not** desync the note parser (alignment holds).
5. **Touch-glow autonomy:** with **no** writes from the client, confirm keys still
   light on press. Proves lighting is device-side.
6. **(Phase 2) SysEx:** once benob's table is folded in, send one colour command
   → confirm a single key changes colour. Locks the SysEx encoder/checksum.

---

## Scope
Built for personal interoperability with a device the owner possesses
(PulseEntrain integration). The connect/receive layer is the public BLE-MIDI
standard. Any LUMI-proprietary lighting commands (Phase 2) derive from external
community reverse engineering — do not redistribute ROLI firmware or content.
