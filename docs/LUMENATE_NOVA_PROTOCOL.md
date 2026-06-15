# Lumenate Nova — BLE Protocol & Build Guide

> **Status: DECODED & VERIFIED.** From the official Android app
> (`com.lumenate.lumenateaa` v6.4.2) decompiled to source, cross-checked against
> live device probing. ✅ source-confirmed · 🔬 live-confirmed · 🔶 inferred

---

## ⚡ Agent Brief (read first)

You are building a client that drives a **stroboscopic light mask** over BLE.
Build exactly this flow; verify the first strobe write against the real device.

```
1. Scan & connect to "Lumenate Nova"
2. requestMtu(>=64)                          # REQUIRED: strobe frames reach 40 bytes
3. Enable notifications on 12345678          # accelerometer telemetry
4. write abcdef01 := 0x01                    # start stream @ ~1 Hz
5. write f2c51a4e := <LE uint32 timing array># the strobe (see §3)
6. stop: write abcdef01 := 0x00              # stop stream; stop strobe writes
```

**Non-negotiable rules for the agent:**
- **YOU enforce the frequency safety clamp.** The device enforces none. See §6.
- All control writes are **write-without-response**.
- **Left and right eye are independent** — every strobe parameter is per-side.
- Treat the worked example in §3 as a golden test vector; confirm it flickers
  before building anything on top.

---

## Device Summary ✅

| Property | Value |
|---|---|
| SoC | Nordic **nRF52833** |
| Manufacturer / ODM | **Oxalis Design** |
| Firmware / Hardware | `1.0.2` / `1.0` |
| Output | 4 LEDs driven as **2 independent channels (left / right eye)** |
| Sensors | 3-axis accelerometer (telemetry + sudden-motion detection) |
| Engine | App computes waveforms in native C++ and streams timings to the device |

---

## GATT Map ✅

| UUID | Svc | Role | Type |
|---|---|---|---|
| `abcdef01-2345-6789-abcd-ef0123456789` | C `b568de7c` | **Stream rate control** | write-no-resp |
| `12345678-9abc-4def-8012-3456789abcde` | C `b568de7c` | **Accelerometer telemetry** | notify |
| `f2c51a4e-2a46-4bef-b18f-cb00c716cfa6` | C `b568de7c` | **Strobe timing stream** | write-no-resp |
| `3e25a3bf-bfe1-4c71-97c5-5bdb73fac89e` | A `47bbfb1e` | **Command** `[opcode,arg]` | write-no-resp |
| `2a84aaff-6738-4629-894c-346357b89a0c` | B `3e8ec328` | Offline session-type (1B) | write-no-resp |
| `51bfc219-…` | B | Config blob (`NLFO…`) | read |
| `964fbffe…`, `2b35ef1f…` | A | status/aux | notify |
| Battery `0x180F` / Device Info `0x180A` | std | telemetry | read/notify |
| SMP service | — | **DFU — never write** | — |

---

## 1. Streaming control — `abcdef01` (write 1B) 🔬

```
write abcdef01 := <rate>     # 0x01 -> ~1 Hz telemetry (live-confirmed). 0x00 -> stop.
then enable notify on 12345678
```
Source: `C4424z0.t0(byte)` = "Setting streaming data rate N".

## 2. Accelerometer telemetry — `12345678` (notify, 6 bytes) ✅

Three little-endian **int16** channels = `AccelerometerDataSample(x, y, z)`:

```
[ x:int16_LE ][ y:int16_LE ][ z:int16_LE ]
scale: raw / 4096.0  ->  g   (4096 counts per g)
```
Live `aa 04 cf f1 d0 05` → x=1194 (0.29 g), y=−3633 (−0.89 g), z=1488 (0.36 g).
Used by `SuddenMotionDetector` (e.g. mask removed / moved). Not required to drive
light; required to read motion/orientation/worn-state.

---

## 3. Strobe stream — `f2c51a4e` (write, LE uint32 array) ✅

The core flicker control. App computes 8 values per update (class `SyncedValues`),
**independent per eye**:

| Param | Meaning |
|---|---|
| `lhsFrequency` / `rhsFrequency` | left / right flicker frequency (Hz) |
| `lhsDuty` / `rhsDuty` | on-fraction of each period (0..1) |
| `lhsConstantOnLevel` / `rhsConstantOnLevel` | on-phase **brightness** (0..1) |
| `lhsFrequencyPhaseShift` / `rhsFrequencyPhaseShift` | left / right phase shift |

**Encoding** (`C4424z0.w0` + `La.m.a/La.m.b`): every value is
`round(x * 1_000_000)` clamped to **uint32**, packed **little-endian**:
- time values (period, on-time) → microseconds
- on-level → fixed-point (level × 1e6)

Two layouts (the app picks the short one when both eyes are identical & unshifted):

- **Symmetric** (L == R, no phase shift) → **3 uint32** (12 bytes):
  `[ period_µs, on_µs, onLevel_x1e6 ]`
- **Independent L/R** → **10 uint32** (40 bytes):
  `[ Lperiod, Lon, Lperiod', Lon', LonLevel,  Rperiod, Ron, Rperiod', Ron', RonLevel ]`
  (primed = phase-shift-adjusted period/on-time; the per-side trailing value is onLevel)

Inputs that are NaN/Inf are zeroed; identical consecutive frames are skipped.

**Golden test vector** — symmetric, 10 Hz, 50% duty, full on-level
*(10 Hz is illustrative — clamp per §6 in real use)*:
```
period  = 1/10 s           = 100000 µs   = 0x000186A0
on      = 0.5 * 0.1 s      =  50000 µs   = 0x0000C350
onLevel = 1.0 * 1e6        = 1000000     = 0x000F4240
payload (LE) = A0 86 01 00 50 C3 00 00 40 42 0F 00   (12 bytes)
```
If that 12-byte write makes the mask flicker at 10 Hz, your encoder is correct.

---

## 4. Commands — `3e25a3bf` (write 2B) ✅

```
write 3e25a3bf := [ opcode, arg ]     # arg = 0x00 when unused
```
| Opcode | Name |
|---|---|
| `0x01` | `WelcomeLEDs` (demo/welcome light) 🔬 |

(The discrete-command enum defines only this; sessions run via the strobe stream.)

## 5. Offline session-type — `2a84aaff` (write 1B) ✅
`write 2a84aaff := <sessionType>`. Idle `0xff`.

---

## 6. ⚠️ SAFETY — you must build the clamp yourself

**The protocol enforces NO frequency limits.** `f2c51a4e` accepts any uint32
microsecond period, so the device will flicker at whatever you send — there is no
device-side floor or ceiling to rely on. The strobe path in the app has **no
min/max frequency check** in the BLE layer; bounds (if any) live in native
session data, not in anything you control.

Therefore, **safety is entirely the client's responsibility:**

- **Hard-cap commanded frequency.** Stroboscopic light in ~**3–60 Hz** can
  provoke photosensitive seizures; the **15–25 Hz** band is peak risk. There is
  no strobe frequency that is safe for photosensitive individuals.
- **Recommended client policy:**
  - Expose a configurable max; default conservative.
  - Intended meditation range is low: theta ≈ 4–8 Hz, alpha ≈ 8–13 Hz.
  - Require an explicit **photosensitivity warning + opt-in** before any session.
  - Rate-limit changes (ramp), never step the frequency abruptly.
  - Provide a **hard STOP** reachable without removing the mask
    (`abcdef01 := 0x00` + cease strobe writes).
- **Per-eye note:** independent L/R means you can desync the eyes; large
  left/right frequency differences are disorienting — clamp the L/R delta too.

This is a build requirement, not a disclaimer.

---

## 7. Implementation requirements ✅

- **MTU:** call `requestMtu(>=64)` after connect, before strobe writes. 10-int
  frames are 40 bytes; default ATT payload is 20 → large writes fail without it.
- **Write type:** write-without-response on `abcdef01`, `f2c51a4e`, `3e25a3bf`,
  `2a84aaff`.
- **Notifications:** enable CCCD on `12345678` before reading telemetry.
- **Bonding:** the official app calls `createBond()`. Live probing wrote without
  an explicit bond (chars aren't encryption-gated), but handle pairing for
  robust reconnection.

---

## 8. Future-proofing tests (verify on real hardware)

1. **Strobe encoder:** send the §3 golden vector → confirm ~10 Hz flicker. Then
   try independent L/R (10-int) with different left/right Hz → confirm each eye
   differs. This locks endianness, units, and the per-eye layout.
2. **Accelerometer axes:** with telemetry streaming, rotate the mask through each
   axis and watch which channel tracks ±1 g (≈ ±4096). Confirms x/y/z order and
   the 4096-counts/g scale, and flags any firmware change to the frame format.
3. **Sudden-motion:** shake the mask; watch for state/notify changes — verifies
   the motion-detector path if you depend on worn/removed detection.
4. **Rate sweep:** write `abcdef01 := 0x02/0x05/…` and measure telemetry cadence
   to map the rate byte → Hz precisely (we confirmed `0x01 → ~1 Hz`).
5. **Regression guard:** re-read Device Info `Firmware Revision`; if it changes
   from `1.0.2`, re-run tests 1–2 before trusting the encoding.

---

## Scope
Reverse-engineered from an app/device the owner possesses, for personal
interoperability. Do not redistribute Lumenate firmware or proprietary content.
