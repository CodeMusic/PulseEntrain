// Web build: map "<slug>.mp3" -> served URL via Vite's import.meta.glob.
// `query: '?url'` means only a URL string is produced (no inlining); the file
// is fetched on demand when the <audio> element loads it, so the 4 GB of MP3s
// are NOT bundled — in dev they stream from disk per-track.
//
// NOTE: a production `one build` would copy these into dist. Before shipping
// web for real, switch this to remote/streamed URLs (the planned hosting).
const mods = import.meta.glob('./assets/audio/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const audio = Object.fromEntries(
  Object.entries(mods).map(([path, url]) => [path.split('/').pop(), url]),
);
