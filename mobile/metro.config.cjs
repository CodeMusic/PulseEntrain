// Metro config for One's "Metro mode" (stable native bundler). withOne wires
// the same native bundling pipeline One uses, reading vite.config.ts (where
// native.bundler === 'metro'). CommonJS because package.json is type: module.
const { withOne } = require('one/metro-config');

module.exports = withOne(__dirname);
