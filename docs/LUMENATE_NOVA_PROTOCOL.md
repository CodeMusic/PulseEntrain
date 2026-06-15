# Lumenate Nova — BLE Protocol

> **Status: DECODED.** Derived from the official Android app
> (`com.lumenate.lumenateaa`, v6.4.2) decompiled to source, cross-confirmed
> against live device probing. Confidence tags:
> ✅ source-confirmed · 🔬 live-confirmed on device · 🔶 inferred

---

## Device Summary ✅

| Property | Value |
|---|---|
| SoC | Nordic **nRF52833** (Model Number `0x2A24`) |
| Manufacturer / ODM | **Oxalis Design** (`0x2A29`) |
| Firmware / Hardware rev | `1.0.2` / `1.0` |
| Stack | Zephyr + MCUmgr/MCUboot DFU |
| Output | 4 LEDs, independent **left / right** strobe channels |
| Native engine | App computes waveforms in C++ (`StrobeManager.doStrobe`), streams timing to the device |

App side: `com.lumenate.lumenate.common.C4425z1` (BLE manager),
`C4424z0` (GATT writer), `strobe.StrobeManager` (native waveform engine).

---

## GATT Map — confirmed roles ✅

| UUID | Svc | Role (from source) | Idle |
|---|---|---|---|
| `abcdef01-2345-6789-abcd-ef0123456789` | C `b568de7c` | **Stream data-rate control** (write 1B) 🔬 | — |
| `12345678-9abc-4def-8012-3456789abcde` | C `b568de7c` | **Telemetry notify** (6B frames) 🔬 | `00×6` |
| `f2c51a4e-2a46-4bef-b18f-cb00c716cfa6` | C `b568de7c` | **Strobe timing stream** (write int32 array) | — |
| `3e25a3bf-bfe1-4c71-97c5-5bdb73fac89e` | A `47bbfb1e` | **Command** `[opcode,arg]` (write 2B) | — |
| `2a84aaff-6738-4629-894c-346357b89a0c` | B `3e8ec328` | **Offline session-type select** (write 1B) | `ff` |
| `51bfc219-feab-4227-8b93-8af8cc5306d4` | B `3e8ec328` | Config blob (read `NLFO…`) | — |
| `964fbffe…`, `2b35ef1f…` | A | status/aux (notify) | — |
| `0x180F / 0x180A` + `2A19/24/25/26/27` | std | Battery + Device Info | — |
| SMP service | — | **DFU — do not touch** | — |

---

## 1. Streaming control — `abcdef01` (write, 1 byte) 🔬

Sets the headset telemetry rate, then the app enables notifications on `12345678`.

```
write abcdef01 := <rate>     # 1 byte. live: 0x01 -> ~1 Hz frames. 0x00 -> stop.
enable notify on 12345678
```

Source: `C4424z0.t0(byte)` logs *"Setting streaming data rate N"*; caller enables
notify on `12345678` when rate>0, disables when rate=0.

### Telemetry frames — `12345678` (notify, 6 bytes)
Three little-endian **int16** channels per frame:

```
[ ch1:int16_LE ][ ch2:int16_LE ][ ch3:int16_LE ]
```
Live sample `aa 04 cf f1 d0 05` → ch1=1194, ch2=−3633, ch3=1488.
Observed: ch2 stable (~−3650), ch1/ch3 roam → headset sensor/sync stream. 🔶 exact channel meaning TBD.

---

## 2. Commands — `3e25a3bf` (write, 2 bytes) ✅

```
write 3e25a3bf := [ opcode, arg ]      # arg = 0x00 when unused
```
Source: `C4424z0.s0(...)` → `new byte[]{ opcode, arg }`.

### Opcode table
| Opcode | Name | Notes |
|---|---|---|
| `0x01` | **WelcomeLEDs** | "Welcome LEDs Command" — the demo/welcome light 🔬 |

(The discrete-command enum currently defines only `WelcomeLEDs`. Sessions are
driven by the strobe stream below, not by per-session opcodes.)

---

## 3. Strobe stream — `f2c51a4e` (write, int32 array) ✅

The core flicker control. App calls
`w0(svc=b568de7c, char=f2c51a4e, f10..f17)` with 8 floats:

| Float | Meaning |
|---|---|
| f10 / f11 | **left / right frequency** (Hz) |
| f12 / f13 | left / right duty (on-fraction of period) |
| f14 / f15 | left / right **segment duration** (s) |
| f16 / f17 | left / right **frequency phase-shift** |

Encoding (`C4424z0.w0`): values converted to **integer microsecond timings**,
packed **little-endian int32**:

- **Symmetric** (L==R, no phase shift):
  `[ period_us, on_us, duration_us ]` → 3 ints (12 bytes)
- **Independent L/R**:
  `[ Lperiod, Lon, Lperiod', Lon', Lduration_us,
     Rperiod, Ron, Rperiod', Ron', Rduration_us ]` → 10 ints (40 bytes)
  (the primed pair = phase-shift-adjusted period/on-time)

NaN/Inf inputs are zeroed (safety guard in source). Duplicate frames are
suppressed (writes only on change).

---

## 4. Offline session type — `2a84aaff` (write, 1 byte) ✅

```
write 2a84aaff := <sessionType>      # source: v0(svc=3e8ec328, char=2a84aaff)
```
Idle reads `0xff` (none selected).

---

## 5. Brightness — hardware buttons, not BLE ✅

`BRIGHTNESS_UP/DOWN/CUTOFF` are **physical buttons on the headset**
("Use these buttons on the top of Nova to increase or decrease the brightness").
Brightness is reported back via telemetry, not set by a write characteristic.

---

## Minimal client recipe (to drive light)

```
1. connect; (optional) read Device Info
2. enable notify on 12345678
3. write abcdef01 := 01           # start telemetry @ ~1 Hz
4. write f2c51a4e := <int32 LE timing array>   # left/right strobe
   - simple:  [period_us, on_us, duration_us]
5. to stop: write abcdef01 := 00 ; stop strobe writes
```

---

## ⚠️ Safety — strobe frequency

This drives stroboscopic light directly. Any client built from this **owns the
photosensitive-epilepsy envelope** the official app guarded (peak provocation
~15–25 Hz). Clamp `f10/f11` to a deliberate safe range, ramp gently, expose a
hard stop, and warn users with photosensitive history. Design requirement, not a
disclaimer.

## Scope
Reverse-engineered from an app/device the owner possesses, for personal
interoperability. Do not redistribute Lumenate firmware or proprietary content.
