# PulseEntrain Admin (desktop)

The **content-authoring** app for PulseEntrain — a [Kivy](https://kivy.org/) desktop tool
for turning audio + ideas into sessions the [mobile app](../mobile/README.md) plays.
See the platform overview in the [root README](../README.md) and the session contract in
[docs/SESSION_FORMAT.md](../docs/SESSION_FORMAT.md).

> One day this may ship to the Mac App Store; for now it runs from source.

## What it does

A single window with three entry points (the **Menu**), all loading one dose editor:

- **Extract** — pick a rendered binaural MP3; it's decomposed in-process (librosa) into a
  scene timeline (beat/carrier over time) + detected noise color, then you fill in
  title / strength / description / cover.
- **Open** — open an existing `.imedx`, or a **legacy `.imed`**: legacy files are auto-converted
  (metadata mapped, referenced image embedded as base64, referenced MP3 analyzed for the beats).
- **Create** — start a blank session.

The dose editor shows the cover, title, strength + label, category, description, a structured
**noise** bed, and a **beat-over-time graph** (read-only with hover tooltips; **Edit** mode lets
you tap-to-add, drag, type values, and delete keyframes, with an editable duration). **Preview**
renders + plays the binaural beats + noise in real time (via `sounddevice`), mirroring the mobile
[`BinauralEngine`](../mobile/src/audio/binauralEngine.js) so it sounds like the eventual mobile
render. **Save** writes a self-contained **`.imedx`** (programmatic beats + base64 cover),
validated against the JSON Schema.

The original **Pulsetto** device controller (scan/connect, intensity, timer, battery, Advanced
pulse-envelope mode) is still here, reachable from the Menu — for when the hardware modalities
come back into the authoring loop.

## Layout

```
desktop/
  main.py            # Kivy app entry (Pulsetto controller + Admin shell)
  admin_ui.py        # the Admin UI: Menu, dose editor, beat graph, preview
  engine/
    binaural_decompose.py   # MP3 -> .imedx v2 analyzer/serializer (CLI too)
    server.py               # OPTIONAL/parked FastAPI sidecar (future mobile use)
    README.md
```

## Install & run

**Prerequisites:** Python 3.11+ and [Poetry](https://python-poetry.org/docs/#installation).

```bash
cd desktop
poetry install                 # app + content engine (numpy/scipy/librosa/pillow/jsonschema/sounddevice)
poetry run python main.py
```

The window opens on the dose editor (a blank **Create** session). Use **Menu → Extract / Open /
Create**, edit on the graph, **Preview**, then **Save .imedx…** (defaults to `../imedsAssets/`).
Saved files are picked up by the mobile catalog via `npm run sync-catalog`.

### CLI extraction (batch / scripting)

```bash
poetry run python -m engine.binaural_decompose track.mp3 --out track.imedx
```

### Optional sidecar (future mobile use)

Not needed by the desktop app. See [engine/README.md](engine/README.md).

## Safety

This is an authoring tool, but the sessions it produces drive real devices. The Nova strobe can
vary into the **gamma range (up to 60 Hz)**, matching the Lumenate app; the per-session `nova.maxHz`
cap travels inside the `.imedx`. This span **includes** the photosensitive-seizure risk band —
see the platform [Safety](../README.md#safety) notes.
