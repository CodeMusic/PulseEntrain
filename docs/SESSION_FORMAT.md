# PulseEntrain Session Format (`.imed` v2)

A session (`.imed`, JSON) is the single contract shared by every part of the
system: the **n8n** generator emits it, `binaural_decompose.py` produces it from a
rendered MP3, the **Admin** app authors/visualizes it, and the **mobile/web apps**
play it. One schema, validated everywhere — see [`session.schema.json`](session.schema.json).

It encodes **one entrainment intent across three modalities** (audio, light, stim)
that mostly share a clock, plus the metadata and provenance around it.

---

## Core idea: the scene spine

`entrainment.scenes` is an ordered list of **keyframes** on a single timeline. Each
scene carries the time-varying value for every axis; the engine interpolates between
scenes per `entrainment.ramp`. Each modality reads the axes it cares about:

| Modality | Reads | Notes |
|---|---|---|
| **Audio** (binaural) | `carrierHz` + `beatHz` | L = carrier, R = carrier + beat. Both sweepable. |
| **Nova** (light) | `beatHz` | Strobe = beat, **clamped to `nova.maxHz` (default 60 Hz, delta→gamma)**, phase-aligned. Light has no pitch of its own. |
| **Pulsetto** (stim) | `intensity` | Stim level 1–9, traversed scene to scene. Not driven at the Hz beat. |
| **Nova brightness** | `brightness` | Optional master-brightness automation. |

> "As the scene shifts, everything shifts" — the beat drops, the light slows and
> dims, the stim swells — all from one readable track.

### Axis rules
- **`beatHz` is required** on every scene (it's the entrainment value).
- **Interpolated axes** — `beatHz` and `carrierHz` ramp linearly between scenes (per
  `entrainment.ramp`). `carrierHz` is optional per scene, falling back to
  `audio.binaural.carrierHz`.
- **Pulsetto stim is base-relative.** A scene's `intensity` is either an **absolute**
  `0–9` (`0` = off) **or** a **relative token** resolved against the user's base (the
  value of `=`, set by the in-session intensity slider; `pulsetto.intensity` is the file
  default, 4 if unset): `=` (base), `=-` (base −1), `=+` (base +1), clamped 0–9.
  So a track can say "one below the user's comfort" without hard-coding a level.
- **Hold-forward axes** — `intensity`, `noise` (the bed color, or
  `"none"`), and `flash` (Nova pattern: `sync` / `left` / `right`) are **step** values:
  set on a scene, they apply from that scene **forward** until a later scene changes
  them. A scene that omits one inherits the previous value (and `noise` crossfades in/out
  at a change). Example: stim `4` on scene 1 holds until scene 5 sets `2`, which then holds
  on from scene 5.
- `brightness` is optional per scene, falling back to `nova.brightness`.
- The Admin's per-node editor (Edit mode) sets all of these on the selected keyframe.
- **Resolvable-carrier invariant:** every scene must resolve a carrier — either
  `audio.binaural.carrierHz` is set, **or** every scene carries its own `carrierHz`.
- Scenes are sorted by `atSec`; the first should be `atSec: 0`.
- **Tradition vs. expressivity:** carrier is usually constant (set once on
  `binaural.carrierHz`, omitted from scenes), but the language *can* sweep it.

---

## Audio beds (sample-free by default)

`audio.beds` is a layered mixer. Three source kinds:

- `"noise"` — pure generators, zero assets: `white | pink | brown | blue | violet | grey`
- `"texture"` — procedurally synthesized ambience, zero assets: `rain | wind`
  *(reserved: `surf`, `stream`, `fire`)*, with shaping `params` (e.g. rain `density`, wind `gust`).
- `"file"` — a bundled/streamed MP3 bed. **Deferred** until streaming replaces bundled
  audio (see [bundled-audio note]); validators may warn on `file` beds for now.

Each bed has a `level` (0–1). The generator registry here is the same list the engine,
the Admin dropdowns, and the n8n prompt all read from.

---

## Modalities

### `nova`
- `mode`: `"follow"` (mirror the beat — the base option) or `"custom"` (per-eye control).
- `maxHz`: safety cap (default **13**); the light never strobes faster, even if the beat does.
- `brightness`: 0–1 master.
- `custom` (when `mode: "custom"`): `left`/`right` each `{ duty, level, phaseHz }` — maps
  directly onto the device frame encoder (`novaController` `setSyncedValues`).
- `pattern` *(reserved)*: keyframed per-eye animation for richer choreography later.

> ⚠️ `nova.maxHz` (default 60 Hz) travels **with the file** and bounds the flash rate. The light
> can traverse delta→gamma like the Lumenate app — which **includes** the 15–25 Hz band where
> stroboscopic light most readily provokes photosensitive seizures. Not for users with epilepsy.

### `pulsetto`
- `enabled`: bool.
- `follow`: `"scenes"` (intensity from `scenes[].intensity`, ramped) | `"phase"` | `"none"`.
- `intensity`: base level used when a scene omits one.
- `pattern` *(optional)*: a fast sub-modulation / envelope *within* a scene (the desktop
  "Advanced" pulse shape) — rides on top of the scene's intensity.
- `intensityClamp`: `[min, max]`, default `[1, 9]`.

---

## Metadata & provenance

- `meta`: `name`, `description`, `category`, `strength` (1–7), `strengthLabel`,
  `durationSec`, `image`, `rating`, `playCount`.
  - **`image`** is either a catalog filename (`"lucid_dream.png"`) **or**, for a
    **self-contained** `.imed`, a scaled base64 data URI
    (`"data:image/jpeg;base64,…"`). The Admin "Extract" mode writes the data-URI
    form so a single file carries everything the app needs.
  - **`strengthLabel`** is an optional human label for the strength (e.g. "Gentle",
    "Deep") shown in the Open view.
- `generation`: how the file was produced — `source` (`n8n` | `binaural_decompose` | `studio`),
  plus tool/prompt/model, `input`/`createdAt`/`analyzedAt`, and for decomposition
  `confidence` + `warnings`.

---

## Example

```jsonc
{
  "formatVersion": 2,
  "id": "lucid_dream",
  "meta": {
    "name": "Lucid Dream", "description": "Alpha → theta drift.",
    "category": "spiritual", "strength": 5, "durationSec": 1800,
    "image": "lucid_dream.png", "rating": null, "playCount": 0
  },
  "generation": { "source": "studio", "createdAt": "2026-06-16T19:00:00Z" },

  "entrainment": {
    "ramp": "linear",
    "scenes": [
      { "atSec": 0,    "beatHz": 10, "intensity": 3, "brightness": 0.8 },
      { "atSec": 300,  "beatHz": 6,  "intensity": 6, "brightness": 1.0 },
      { "atSec": 1500, "beatHz": 4,  "intensity": 4, "brightness": 0.6 },
      { "atSec": 1800, "beatHz": 4,  "intensity": 2, "brightness": 0.0 }
    ]
  },

  "audio": {
    "binaural": { "carrierHz": 200, "follow": "beat" },
    "beds": [
      { "source": "noise",   "type": "pink", "level": 0.25 },
      { "source": "texture", "type": "rain", "level": 0.40, "params": { "density": 0.6 } }
    ],
    "masterVolume": 1.0
  },

  "nova":     { "mode": "follow", "maxHz": 13, "brightness": 1.0 },
  "pulsetto": { "enabled": true, "follow": "scenes", "intensityClamp": [1, 9] }
}
```

## Producers

- **`binaural_decompose.py`** (Process mode) measures `scenes` (beat/carrier), the noise
  bed, and `meta.durationSec`; defaults Nova to `follow` and Pulsetto to disabled for the
  author to finish. Run with `--schema v2` (default).
- **Studio Create** authors all axes on the timeline canvas.
- **n8n** emits `meta` + a `scenes` timeline + bed selections as structured output that
  must validate against the schema.

## File extensions & legacy

- **`.imedx`** — a self-contained v2 session (programmatic beats + base64 image). This
  is what the Admin "Save" writes and what new content uses.
- **`.imed`** — same v2 JSON (the extension is interchangeable for new files), **and**
  the **legacy** format: `schema_version: 1` with `files.audio` / `files.image`
  references and flat metadata (`length_seconds`, `strength_label`, `user.rating`, …).
  The Admin auto-converts a legacy `.imed` on open: it maps the metadata, embeds the
  referenced image as base64, and analyzes the referenced MP3 to recover the `scenes`
  and noise bed — then you Save it as `.imedx`.
- **Noise is structured** (`audio.beds`), never inferred from the description text.
- Apps must read **both** `.imedx`/new `.imed` and legacy `.imed` (backward compatible).
