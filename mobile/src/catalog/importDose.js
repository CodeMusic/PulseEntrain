// Runtime import of a user-supplied .imedx session so it can be played without
// being in the bundled catalog. Mirrors the .imedx → dose mapping that
// scripts/sync-catalog.cjs does at build time. Imported doses live in an
// in-memory registry; doseById() falls back to it (see catalog/data.js).

let _counter = 0;
const _imported = new Map();

export const getImportedDose = id => _imported.get(id) || null;

const slug = s =>
  String(s || 'session')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'session';

const fmtLen = sec => {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Lightweight structural check — enough to safely play and to give a friendly
// error. (Full JSON-Schema validation against docs/session.schema.json is a
// follow-up that belongs with the shared engine/contract step.)
export function validateImedx(json) {
  if (!json || typeof json !== 'object') return { ok: false, error: 'Not a valid session file.' };
  const scenes = json.entrainment && json.entrainment.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0)
    return { ok: false, error: 'No entrainment scenes — is this an .imedx session?' };
  if (!scenes.every(s => s && typeof s.beatHz === 'number'))
    return { ok: false, error: 'Each scene needs a numeric beatHz.' };
  return { ok: true };
}

// Map a parsed .imedx to the dose shape the player/catalog expect.
export function imedxToDose(json) {
  const meta = json.meta || {};
  const audio = json.audio || {};
  const beds = audio.beds || [];
  const noiseBed = beds.find(b => b.source === 'noise');
  const binaural = audio.binaural || {};
  const id = `imported_${slug(meta.name)}_${++_counter}`;
  return {
    id,
    category: 'Imported',
    name: meta.name || 'Imported session',
    strength: meta.strength ?? null,
    strengthLabel: meta.strengthLabel || '',
    lengthSeconds: meta.durationSec ?? null,
    lengthDisplay: fmtLen(meta.durationSec),
    description: meta.description || '',
    image: meta.image || null, // base64 data URI (self-contained) or null
    audio: null,
    bundledAudio: false,
    format: 'imedx',
    scenes: (json.entrainment && json.entrainment.scenes) || [],
    carrier: binaural.carrierHz ?? 200,
    noise: noiseBed ? noiseBed.type : 'none',
    noiseLevel: noiseBed ? noiseBed.level ?? 0.25 : 0,
    fade: audio.transitionFade || 'medium',
    imported: true,
  };
}

// Validate + register a parsed .imedx; returns the playable dose (throws on bad input).
export function registerImportedDose(json) {
  const v = validateImedx(json);
  if (!v.ok) throw new Error(v.error);
  const dose = imedxToDose(json);
  _imported.set(dose.id, dose);
  return dose;
}
