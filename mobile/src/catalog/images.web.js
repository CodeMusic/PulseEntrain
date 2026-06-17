// Web build: the generated images.js uses Metro's require() for assets, which
// doesn't exist under Vite. Build the same { "slug.jpg": url } map using Vite's
// import.meta.glob so cover art still renders on web. (Kept in sync manually,
// like audio.web.js — sync-catalog only writes the native images.js.)
const mods = import.meta.glob('./assets/images/*.jpg', { eager: true, import: 'default' });

export const images = Object.fromEntries(
  Object.entries(mods).map(([path, url]) => [path.split('/').pop(), url]),
);
