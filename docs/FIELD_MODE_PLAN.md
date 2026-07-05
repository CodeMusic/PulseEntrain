# Field Mode — next phase plan (draft)

> **This is the internal engineering plan.** For the *concept* of Field Meditation
> Mode — the binaural field, resonance, and how to use it — see
> **[FIELD_MEDITATION.md](FIELD_MEDITATION.md)**.

Two additions to Field Meditation Mode:
1. **Draw to the Lightpad Block LEDs** (visual feedback on the pad itself).
2. **On-screen "simulated Lightpad"** for people without the hardware.

Status: **planning only.** Nothing here is built yet.

---

## 0. The anchoring idea: one "field input", many sources

Today `FieldScreen` reads raw Lightpad MIDI directly. Before adding a second
input source (the phone screen), refactor to a single normalized event that any
source produces:

```
FieldInput = { x: 0..1, y: 0..1, z: 0..1, active: boolean }
    x → carrier (80–500 Hz)
    y → beat / flash rate (1–40 Hz)   [when not "pushing"]
    z → field intensity (volume + brightness + gentle stim)
    active → touch down / up
```

- **Real Lightpad** → a small adapter turns MIDI into FieldInput
  (`decodeCell(note)`+bend → x/y, pressure → z, noteOff → active=false).
- **On-screen pad** → touch coords → x/y, a "push" proxy → z, touch → active.
- `FieldScreen` keeps ONE `applyFieldInput(fi)` (carrier/beat/intensity +
  push-gate + the existing Nova head-motion control). Source-agnostic.

This makes the two features drop-in "views" of the same field state, and lets me
verify the whole interaction on web (no hardware) before touching BLE.

**Rule:** if a real Lightpad is connected, use it and hide the on-screen pad. Else
show the on-screen pad.

---

## 1. On-screen simulated Lightpad (Phase 1 — build first)

Lowest risk, fully testable in-browser, unblocks no-hardware users.

**Visual**
- Full-width touch surface behind the existing carrier/beat orb (keep the orb —
  it stays center as the readout).
- Background: purple→indigo gradient.
- **"Memory-foam" echo:** each touch leaves a soft blue glow at that point that
  fades over ~1 s (a fading ripple/blur). Recent touches linger like a dent.
- Optional faint 5×5 cell grid so it reads as a pad.

**Input mapping**
- Touch position within the pad rect → `x` (left→right) and `y` (bottom→top).
- **The missing Z (pressure):** modern iPhones have no pressure API. Options:
  - **(A, recommended) Dwell-to-deepen** — holding your finger in place ramps `z`
    up (and eases back on lift). Matches the "memory foam / press in" metaphor and
    doubles as the "push" gate for Nova head-control (dwell = pushing).
  - (B) Two-finger vertical drag sets `z`.
  - (C) Fixed `z`, no intensity control on phone.
- Phone-only users have no Nova, so head-control is moot for them — but if they
  have a Nova + phone (no block), **dwell = push** lets head-control still engage.

**Work items**
- `FieldInput` refactor of `FieldScreen`.
- New `components/FieldPad.tsx` (gradient + echo + touch→FieldInput).
- Adapter so the real Lightpad emits `FieldInput` too.

---

## 2. Draw to the Lightpad LEDs (Phase 2 — verify protocol first)

The pad becomes its own display: carrier-colored glow at the touched cell, a
gradient field, a fading echo — the physical twin of the on-screen pad.

### ⚠️ The spec must be verified before we build on it
The protocol notes you shared are **plausible but unverified** — the cited source
is a general blog about tool-calling, not ROLI documentation. What we can trust:
- Manufacturer ID `00 21 10` **is** ROLI, and the BLE service/characteristic
  match what we already use (write path exists — the char is write-no-response).

What we must **prove on-device before trusting**:
- Command bytes `0x0C` (set pixel) / `0x02` (bitmap) and Product ID `0x03`.
- Whether the block's running **Note-Grid app owns the LEDs** and ignores/overwrites
  our writes (very likely — BLOCKS normally need a host/Littlefoot mode to cede LED
  control). This is the biggest risk.
- iOS MTU: iOS negotiates MTU itself (often ~185, not 512), so **full-frame dumps
  will fragment**. Plan around single-pixel writes, which are tiny and safe.

### Phase 2a — protocol spike (small, decisive)
- Add a pure `shared/lightpadDisplay.js`: build the 12-byte Set-Pixel SysEx
  (`F0 00 21 10 03 0C x y r g b F7`) + Apple BLE-MIDI framing, and the 7-bit
  packer (for later bitmap use).
- Add a `writePixel(x,y,r,g,b)` to the Lightpad transport (write-no-response to
  `7772E5DB…`).
- Test: light one pixel red. **Outcomes:**
  - Lights up → protocol confirmed, proceed to 2b.
  - Nothing / fights the note app → we either (i) find the mode/Littlefoot upload
    that cedes LED control, or (ii) capture real ROLI Dashboard BLE traffic and
    match it. Reassess scope then.

### Phase 2b — field rendering (only if spike works)
- Map our 5×5 note cells → 3×3 LED blocks on the 15×15 grid.
- Draw: gradient base + touched cell in `carrierColor` + fading echo, throttled
  (~10 fps) via batched single-pixel writes (no full-frame needed).
- Beat does NOT flash the block (Nova is the entrainment light; the block is
  ambient feedback).

---

## Open decisions (for when we build)
1. **On-screen Z / push proxy:** dwell-to-deepen (A) vs two-finger (B) vs none (C).
   → leaning **A**.
2. **LED build:** verify-first spike (recommended) vs build-on-spec-and-hope.
   → **verify-first.**
3. **Layout:** on-screen pad *behind* the orb (recommended) vs a separate pad area.

## Suggested order
1. Phase 1 (on-screen pad + FieldInput refactor) — I can verify on web.
2. Phase 2a (LED spike) — you test on the block; ~30 min of trying.
3. Phase 2b (LED field rendering) — only if 2a lights up.
