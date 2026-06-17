# Admin content engine

The analysis/serialization core the desktop **Admin** app uses for **Extract** mode:
turn a rendered binaural-beat MP3 into a validated `.imed` v2 session
(see [`../../docs/SESSION_FORMAT.md`](../../docs/SESSION_FORMAT.md)). It runs
**in-process** inside the desktop app — no server required.

- **`binaural_decompose.py`** — the analyzer (librosa/scipy) + `.imed` v2 serializer.
  The Admin GUI imports `analyze()` and `spec_to_dict_v2()` from here.
- **`server.py`** — *optional / parked.* A FastAPI sidecar that wraps the same
  engine over HTTP, in case the **mobile** app ever wants to call extraction
  remotely. Not used by the desktop app.

## Install

```bash
cd desktop
poetry install                 # desktop app + engine (numpy/scipy/librosa/pillow)
poetry install --with server   # also pull the optional sidecar deps (fastapi/uvicorn)
```

## CLI (handy for batch / testing)

```bash
poetry run python -m engine.binaural_decompose track.mp3 --out track.imed
poetry run python -m engine.binaural_decompose track.mp3 --schema v1   # legacy output
```

## Optional sidecar (mobile, later)

```bash
poetry run uvicorn engine.server:app --reload --port 8765
# POST multipart `file`=<mp3> to /decompose  ->  { "imed": ..., "warnings": [...] }
```
