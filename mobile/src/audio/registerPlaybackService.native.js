// Registers the react-native-track-player background playback service.
// Previously lived in index.js; under One it runs as a module side-effect
// imported once by app/_layout.tsx. Native only (see the .web.js no-op).
import TrackPlayer from 'react-native-track-player';

TrackPlayer.registerPlaybackService(() => require('./playbackService'));
