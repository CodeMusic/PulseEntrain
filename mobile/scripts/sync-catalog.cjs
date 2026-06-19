#!/usr/bin/env node
/**
 * sync-catalog.js — builds the mobile app's catalog from the shared
 * entrainment_assets/ folder at the repo root.
 *
 * Outputs (under mobile/src/catalog/):
 *   catalog.json            metadata for every dose (read-only catalog)
 *   images.js               static require() map: "Name.jpg" -> bundled image
 *   audio.js                static require() map for the bundled audio SUBSET
 *   assets/images/*.jpg     copied cover images (all doses)
 *   assets/audio/*.mp3      copied audio (subset only, to keep the app small)
 *
 * User-mutable data (rating, play_count) is NOT baked in here — it lives in
 * AsyncStorage at runtime, keyed by each dose's stable `id`.
 *
 * Run: npm run sync-catalog
 */
const fs = require('fs');
const path = require('path');

const MOBILE_DIR = path.resolve(__dirname, '..');
const ASSETS_DIR = path.resolve(MOBILE_DIR, '..', 'entrainment_assets');
const OUT_DIR = path.join(MOBILE_DIR, 'src', 'catalog');
const OUT_IMAGES = path.join(OUT_DIR, 'assets', 'images');
const OUT_AUDIO = path.join(OUT_DIR, 'assets', 'audio');

// Which tracks ship their MP3 in the bundle for now (one per category).
// Everything else gets metadata + image only (audio resolved remotely later).
const AUDIO_SUBSET = new Set([
  'Pure/Alpha',
  'Spiritual/Lucid Dream',
  'Sex & Intimacy/First Love',
  'Calm & Sleep/Serene',
  'Focus & Energy/Energizer',
  'Experimental/Mystery',
  'Medications & Drugs/French Roast',
]);

// Audio bundling: ALL 96 tracks by default (until streaming is hosted).
//   SYNC_AUDIO_SUBSET=1  bundle only the curated 7-track subset (small/fast)
//   SYNC_AUDIO_LIMIT=N   bundle just the first N tracks
const BUNDLE_ALL = process.env.SYNC_AUDIO_SUBSET !== '1';
const BUNDLE_LIMIT = process.env.SYNC_AUDIO_LIMIT ? parseInt(process.env.SYNC_AUDIO_LIMIT, 10) : null;

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const fmtLen = sec => {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
// Copy only if missing or changed — keeps the prestart hook fast (no 4 GB re-copy).
function copyIfNeeded(src, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) return;
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`entrainment_assets not found at ${ASSETS_DIR}`);
    process.exit(1);
  }
  ensure(OUT_IMAGES);
  ensure(OUT_AUDIO);

  const categories = fs
    .readdirSync(ASSETS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const catalog = [];
  const imageEntries = []; // [filename]
  const audioEntries = []; // [filename]
  let missingImages = 0;
  let imedxCount = 0;

  for (const category of categories) {
    const catDir = path.join(ASSETS_DIR, category);
    // Group by base name; a self-contained .imedx supersedes a legacy .imed.
    const byBase = {};
    for (const f of fs.readdirSync(catDir)) {
      if (f.endsWith('.imedx')) {
        const b = path.basename(f, '.imedx');
        (byBase[b] = byBase[b] || {}).imedx = f;
      } else if (f.endsWith('.imed')) {
        const b = path.basename(f, '.imed');
        (byBase[b] = byBase[b] || {}).imed = f;
      }
    }

    for (const base of Object.keys(byBase).sort()) {
      const entry = byBase[base];
      const key = `${category}/${base}`;
      const id = slug(key); // safe filename base — no spaces/+/& (Metro-friendly)

      // ---- self-contained .imedx: programmatic beats + embedded base64 image ----
      if (entry.imedx) {
        const j = JSON.parse(fs.readFileSync(path.join(catDir, entry.imedx), 'utf8'));
        const meta = j.meta || {};
        const beds = (j.audio && j.audio.beds) || [];
        const noiseBed = beds.find(b => b.source === 'noise');
        const binaural = (j.audio && j.audio.binaural) || {};
        catalog.push({
          id,
          category,
          name: meta.name || base,
          strength: meta.strength ?? null,
          strengthLabel: meta.strengthLabel || '',
          lengthSeconds: meta.durationSec ?? null,
          lengthDisplay: fmtLen(meta.durationSec),
          description: meta.description || '',
          image: meta.image || null, // base64 data URI (self-contained) or null
          audio: null,
          bundledAudio: false,
          format: 'imedx',
          scenes: (j.entrainment && j.entrainment.scenes) || [],
          carrier: binaural.carrierHz ?? 200,
          noise: noiseBed ? noiseBed.type : 'none',
          noiseLevel: noiseBed ? noiseBed.level ?? 0.25 : 0,
          fade: (j.audio && j.audio.transitionFade) || 'medium',
        });
        imedxCount++;
        continue;
      }

      // ---- legacy .imed: bundled mp3 + jpg references ----
      const meta = JSON.parse(fs.readFileSync(path.join(catDir, entry.imed), 'utf8'));

      // image (always bundled if present)
      const imgSrc = path.join(catDir, `${base}.jpg`);
      let image = null;
      if (fs.existsSync(imgSrc)) {
        const imgName = `${id}.jpg`;
        copyIfNeeded(imgSrc, path.join(OUT_IMAGES, imgName));
        imageEntries.push(imgName);
        image = imgName;
      } else {
        missingImages++;
        console.warn(`  ⚠ no image for ${key}`);
      }

      // audio — curated subset by default; SYNC_ALL_AUDIO / SYNC_AUDIO_LIMIT widen it
      const audioSrc = path.join(catDir, `${base}.mp3`);
      let audio = null;
      const wanted = BUNDLE_ALL || BUNDLE_LIMIT != null || AUDIO_SUBSET.has(key);
      const underLimit = BUNDLE_LIMIT == null || audioEntries.length < BUNDLE_LIMIT;
      const bundledAudio = wanted && underLimit && fs.existsSync(audioSrc);
      if (bundledAudio) {
        const audioName = `${id}.mp3`;
        copyIfNeeded(audioSrc, path.join(OUT_AUDIO, audioName));
        audioEntries.push(audioName);
        audio = audioName;
      }

      catalog.push({
        id,
        category,
        name: meta.name || base,
        strength: meta.strength ?? null,
        strengthLabel: meta.strength_label || '',
        lengthSeconds: meta.length_seconds ?? null,
        lengthDisplay: meta.length_display || '',
        description: meta.description || '',
        image, // key into images.js (or null)
        audio, // key into audio.js (or null)
        bundledAudio,
        format: 'legacy',
      });
    }
  }

  // catalog.json
  fs.writeFileSync(
    path.join(OUT_DIR, 'catalog.json'),
    JSON.stringify({ generatedFrom: 'entrainment_assets', categories, doses: catalog }, null, 2) + '\n',
  );

  // images.js — static require map
  const imgMap = imageEntries
    .sort()
    .map(n => `  ${JSON.stringify(n)}: require(${JSON.stringify('./assets/images/' + n)}),`)
    .join('\n');
  fs.writeFileSync(
    path.join(OUT_DIR, 'images.js'),
    `// AUTO-GENERATED by scripts/sync-catalog.js — do not edit.\nexport const images = {\n${imgMap}\n};\n`,
  );

  // audio.js — static require map (subset only)
  const audMap = audioEntries
    .sort()
    .map(n => `  ${JSON.stringify(n)}: require(${JSON.stringify('./assets/audio/' + n)}),`)
    .join('\n');
  fs.writeFileSync(
    path.join(OUT_DIR, 'audio.js'),
    `// AUTO-GENERATED by scripts/sync-catalog.js — do not edit.\nexport const audio = {\n${audMap}\n};\n`,
  );

  console.log(`\nCatalog: ${catalog.length} doses across ${categories.length} categories`);
  console.log(`Images bundled: ${imageEntries.length}${missingImages ? ` (missing ${missingImages})` : ''}`);
  const mode = BUNDLE_ALL ? 'all' : BUNDLE_LIMIT != null ? `limit ${BUNDLE_LIMIT}` : 'curated subset';
  const list = audioEntries.length <= 12 ? ` -> ${audioEntries.join(', ')}` : '';
  console.log(`Audio bundled (${mode}): ${audioEntries.length}${list}`);
  if (imedxCount) console.log(`Self-contained .imedx doses: ${imedxCount}`);
}

function rmrf_outputs() {
  rmrf(OUT_IMAGES);
  rmrf(OUT_AUDIO);
}

main();
