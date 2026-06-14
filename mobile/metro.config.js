const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Ensure bundled audio (require('./assets/audio/X.mp3')) resolves as an asset.
    assetExts: [...new Set([...defaultConfig.resolver.assetExts, 'mp3'])],
  },
};

module.exports = mergeConfig(defaultConfig, config);
