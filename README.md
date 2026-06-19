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
| Program catalog (96 sessions) | ✅ Available (mobile) |
| Manual mode (frequency + noise + Pulsetto / Nova) | ✅ Available (mobile) |
| **Admin** authoring app (extract / create / edit sessions) | ✅ Available (desktop) |
| Self-contained `.imedx` sessions (programmatic beats + embedded art) | ✅ Available |
| **Lumenate Nova** visual (light) entrainment | ✅ Available (mobile) |
| AI-generated sessions (n8n + image gen, saveable) | 🔜 Planned |
| Audio streaming (replace bundled MP3s) | 🔜 Planned |

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

> ⚠️ **Photosensitivity.** Flickering light in the ~15–25 Hz range can provoke seizures in people with photosensitive epilepsy. Like the Lumenate app, PulseEntrain lets the Nova strobe vary across **delta→gamma (up to 60 Hz)** — which **includes** that risk band. The per-session `nova.maxHz` bounds it, but **do not use the visual mode if you have photosensitive epilepsy or any seizure history.**

---

## The two apps

PulseEntrain is two apps built around one shared **session format**:

- **[Admin](desktop/README.md)** — `desktop/` — a [Kivy](https://kivy.org/) desktop app for **authoring content**: extract a rendered binaural MP3 into its components, or create/edit a session on a timeline (beat curve, noise, cover, duration), preview it live, and save a self-contained `.imedx`. It also still includes the original Pulsetto device controller. → **[desktop/README.md](desktop/README.md)**
- **[Main app](mobile/README.md)** — `mobile/` — the cross-platform **player** (web + iOS + Android via [One](https://onestack.dev/)). Browse the catalog, play sessions, and pair **Pulsetto** (vagus nerve) and **Lumenate Nova** (light) over BLE, plus a Manual mode. → **[mobile/README.md](mobile/README.md)**

The two BLE protocols were reverse-engineered: [docs/PULSETTO_PROTOCOL.md](docs/PULSETTO_PROTOCOL.md), [docs/LUMENATE_NOVA_PROTOCOL.md](docs/LUMENATE_NOVA_PROTOCOL.md).

---

## Session format

Sessions live in `imedsAssets/` and are described by JSON — one shared contract for the Admin, the apps, and (later) AI generation. Full spec: **[docs/SESSION_FORMAT.md](docs/SESSION_FORMAT.md)** + the JSON Schema in [docs/session.schema.json](docs/session.schema.json).

- **Legacy `.imed`** — flat metadata + a bundled MP3 and cover image.
- **`.imedx`** *(new, self-contained)* — a programmatic **scene timeline** (beat/carrier over time), a sample-free **noise bed**, and the cover **embedded as base64** — no separate audio/image files. The mobile app synthesizes these in real time; the Admin authors them (and converts legacy `.imed` on open).

---

## Safety

- PulseEntrain is a **wellness / entertainment** tool, not a medical device, and is not a substitute for professional care.
- Follow Pulsetto's own guidance for placement, intensity, and session length. Do not exceed documented limits.
- Vagus nerve stimulation and brainwave entrainment have **contraindications** — if you are pregnant, have a heart condition, epilepsy/seizure history, or an implanted electronic device (e.g. a pacemaker), consult a qualified professional before use.
- The **Lumenate Nova** uses flickering light that can vary into the **gamma range (up to 60 Hz)**, including the highest-risk ~15–25 Hz band. **If you have photosensitive epilepsy or any seizure history, do not use the visual mode.**
- Stop immediately if anything feels uncomfortable.

---

## Credits

Built on the reverse-engineered Pulsetto protocol from the original `pulse-libre` project. Devices:
- Pulsetto — https://pulsetto.tech/
- Lumenate Nova — https://lumenate.co/lumenate-nova/
