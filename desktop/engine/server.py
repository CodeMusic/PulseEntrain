"""
PulseEntrain Admin — Process sidecar.

OPTIONAL / PARKED. The desktop Admin app does extraction in-process and does NOT
use this. This sidecar exists only so the MOBILE app could call extraction
remotely later — a thin HTTP front door around the same engine.

Run:
    cd desktop
    poetry install --with server
    poetry run uvicorn engine.server:app --reload --port 8765

Endpoints:
    GET  /health     -> {"status": "ok", "schema": <bool>}
    POST /decompose  -> multipart form field `file` = the MP3
                        returns { "imed": <.imed v2>, "warnings": [...] }
                        422 if the file isn't a plausible binaural track.
"""
import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .binaural_decompose import IncompatibleTrack, analyze, spec_to_dict_v2

# The single contract — repo-root docs/session.schema.json (../../docs from here).
SCHEMA_PATH = Path(__file__).resolve().parents[2] / "docs" / "session.schema.json"

app = FastAPI(title="PulseEntrain Admin — Process sidecar", version="2.0")

# The web Admin runs on a different localhost port; let it call us. This is a
# local dev tool — tighten allow_origins if it's ever exposed beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_validator = None  # None = not built yet, False = schema unavailable, else a validator


def _get_validator():
    global _validator
    if _validator is None:
        try:
            from jsonschema import Draft202012Validator

            schema = json.loads(SCHEMA_PATH.read_text())
            Draft202012Validator.check_schema(schema)
            _validator = Draft202012Validator(schema)
        except (FileNotFoundError, ImportError):
            _validator = False
    return _validator


@app.get("/health")
def health():
    return {"status": "ok", "schema": SCHEMA_PATH.exists()}


@app.post("/decompose")
async def decompose(
    file: UploadFile = File(...),
    rdp: float = Query(0.4, description="beat segmentation sensitivity in Hz"),
    name: str | None = Query(None, description="override session name (default: filename stem)"),
):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp3"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(await file.read())
        tmp.flush()
        tmp.close()

        stem = Path(file.filename or "track").stem
        try:
            spec = analyze(tmp.name, name=name or stem, beat_eps=rdp)
        except IncompatibleTrack as e:
            raise HTTPException(status_code=422, detail=f"incompatible: {e}")
        except Exception as e:  # decode failures, etc.
            raise HTTPException(status_code=400, detail=f"{type(e).__name__}: {e}")

        imed = spec_to_dict_v2(spec)
        imed["generation"]["input"] = file.filename  # original name, not the temp path

        warnings = list(imed.get("generation", {}).get("warnings", []))
        v = _get_validator()
        if v is False:
            warnings.append("schema not found/loadable — output was not validated")
        elif v:
            errs = sorted(v.iter_errors(imed), key=lambda e: list(e.path))
            if errs:
                # Producing invalid output is a server bug, not a bad upload.
                raise HTTPException(
                    status_code=500,
                    detail={"schema_errors": [e.message for e in errs[:10]], "imed": imed},
                )

        return {"imed": imed, "warnings": warnings}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
