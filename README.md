# PulseEntrain

**PulseEntrain combines vagus nerve stimulation with binaural-beat entrainment** — pairing gentle electrical stimulation (via the [Pulsetto](https://pulsetto.tech/) device) with audio designed to nudge your brain toward a target state. The goal is a single, calm, customizable session that works on the body and the mind at the same time. On mobile you can add a third, synchronized layer: **stroboscopic light** through the [Lumenate Nova](https://lumenate.co/lumenate-nova/) glasses, pulsing in time with the audio beat.

It is a fork and evolution of the original `pulse-libre-desktop` Pulsetto controller, expanded into an entrainment platform with both a desktop and a mobile app.

> ⚠️ **Wellness / entertainment, not medical.** PulseEntrain is for relaxation and experimentation. It is not a medical device and makes no diagnostic or treatment claims. See [Safety](#safety) before use.

---

## What it does

### 1. Program catalog
A curated library of **programs that influence your state** — relaxation, focus, sleep, and more. Each program pairs binaural-beat audio with an optional Pulsetto stimulation envelope, so you can just pick one and press play.

### 2. Manual mode
Build your own session by hand:
- **Entrainment frequency** — set the target beat frequency directly (e.g. an alpha or theta band).
- **Background noise** — choose a noise bed (e.g. white / pink / brown) to sit under the beats.
- **Pulsetto option** — enable vagus nerve stimulation alongside the audio, with intensity and pulse pattern.
- **Lumenate Nova option** *(mobile)* — enable synchronized light, strobing in time with the beat, with master brightness control.

### 3. AI-generated sessions *(planned)*
Describe what you want in a prompt, and PulseEntrain will:
- generate a matching **binaural program**, and
- optionally generate **background instrumental music** to accompany it.

Generated sessions can be **saved and reused** later.
*This arrives after the catalog and manual mode are complete (see [Roadmap](#roadmap)).*

---

## Roadmap

| Feature | Status |
|---|---|
| Pulsetto control (intensity, timer, status) | ✅ Available |
| Binaural-beat audio playback | ✅ Available |
| Advanced pulse-envelope mode (desktop) | ✅ Available |
| Program catalog | 🛠️ In progress |
| Manual mode (frequency + noise + Pulsetto) | 🛠️ In progress |
| AI-generated sessions (+ optional generated music, saveable) | 🔜 Planned |
| **Lumenate Nova** visual (light) entrainment | ✅ Available (mobile) |

---

## Supported hardware

| Modality | Device | Status |
|---|---|---|
| Vagus nerve stimulation | **[Pulsetto](https://pulsetto.tech/)** | ✅ Supported |
| Audio (binaural beats) | Any headphones | ✅ Supported |
| Visual entrainment (light) | **[Lumenate Nova](https://lumenate.co/lumenate-nova/)** | ✅ Supported (mobile) |

Binaural beats **require stereo headphones** — each ear must receive a different tone for the effect to work.

---

## How it works

### What are binaural beats?
When two slightly different tones are played separately to each ear — say **200 Hz** in the left and **210 Hz** in the right — the brain perceives a third, phantom "beat" at the *difference* between them (here, **10 Hz**). The idea behind **brainwave entrainment** is that this perceived rhythm gently encourages brain activity toward that frequency band, each of which is loosely associated with a state of mind:

| Band | Approx. range | Loosely associated with |
|---|---|---|
| Delta | 0.5–4 Hz | Deep sleep |
| Theta | 4–8 Hz | Drowsiness, meditation, dreaming |
| Alpha | 8–13 Hz | Relaxed, calm focus |
| Beta | 13–30 Hz | Alert, active thinking |
| Gamma | 30 Hz+ | High-level processing |

Binaural beats only work over **headphones**, and the evidence for entrainment is suggestive but mixed — treat it as a relaxation aid, not a guaranteed outcome.

### What is vagus nerve stimulation?
The **vagus nerve** is the main nerve of the parasympathetic ("rest and digest") system, running from the brainstem down through the neck to the organs. **Transcutaneous vagus nerve stimulation (tVNS)** applies mild electrical pulses to a branch of the nerve near the skin to influence autonomic balance — explored as a way to support calm and stress relief. The **Pulsetto** is a consumer tVNS device; PulseEntrain drives it over Bluetooth and can modulate its intensity in rhythm with a session.

### What is visual (stroboscopic) entrainment?
Rhythmic flickering light can drive a brain-rhythm response of its own (*photic driving* / the steady-state visual evoked response) — the visual cortex tends to follow a light pulsing at a steady rate. The **[Lumenate Nova](https://lumenate.co/lumenate-nova/)** is a pair of LED glasses that PulseEntrain drives over Bluetooth, strobing **in sync with the session's beat frequency** (independently per eye, with brightness control) so the light, the beats, and the stimulation all share one rhythm.

> ⚠️ **Photosensitivity.** Flickering light in the ~15–25 Hz range can provoke seizures in people with photosensitive epilepsy. PulseEntrain caps the Nova strobe at **13 Hz** (the delta/theta/alpha range, below that risk band) and ramps it gently — the audio beat may go higher, but the light will not follow past the cap.

---

## The apps

- **Desktop** (`main.py`) — a [Kivy](https://kivy.org/) app that controls the Pulsetto over Bluetooth LE: intensity, session timer, battery/charging status, and an **Advanced** pulse-envelope mode for rhythmic stimulation patterns.
- **Mobile** (`mobile/`) — a React Native app (PulseEntrain) — the primary client as the platform grows. Beyond Pulsetto, the mobile app also drives the **Lumenate Nova** light glasses over BLE, synchronized to the session beat — available in both the program catalog player and Manual mode.

The Pulsetto and Lumenate Nova BLE protocols were both reverse-engineered; full details are in [docs/PULSETTO_PROTOCOL.md](docs/PULSETTO_PROTOCOL.md) and [docs/LUMENATE_NOVA_PROTOCOL.md](docs/LUMENATE_NOVA_PROTOCOL.md).

---

## Running the desktop app

**Prerequisites:** Python 3.11+ and the [Poetry](https://python-poetry.org/docs/#installation) package manager.

```bash
poetry install
poetry run python main.py
```

On launch it scans for a Pulsetto device. Once connected, set the intensity (1–9), choose a duration, and press **Start**. Switch to the **Advanced** tab to shape the stimulation into rhythmic pulse patterns.

---

## Content library

Entrainment programs live in `entrainment_assets/`, organized by category. Each track ships with:

- the audio file,
- a cover image, and
- an `.imed` metadata file (JSON) holding its name, length, description, strength, your personal rating, and play count.

---

## Safety

- PulseEntrain is a **wellness / entertainment** tool, not a medical device, and is not a substitute for professional care.
- Follow Pulsetto's own guidance for placement, intensity, and session length. Do not exceed documented limits.
- Vagus nerve stimulation and brainwave entrainment have **contraindications** — if you are pregnant, have a heart condition, epilepsy/seizure history, or an implanted electronic device (e.g. a pacemaker), consult a qualified professional before use.
- The **Lumenate Nova** uses flickering light. If you have **photosensitive epilepsy** or any seizure history, do not use the visual mode. PulseEntrain caps the strobe below the highest-risk band (≤ 13 Hz), but this reduces — it does not eliminate — the risk.
- Stop immediately if anything feels uncomfortable.

---

## Credits

Built on the reverse-engineered Pulsetto protocol from the original `pulse-libre` project. Devices:
- Pulsetto — https://pulsetto.tech/
- Lumenate Nova — https://lumenate.co/lumenate-nova/
