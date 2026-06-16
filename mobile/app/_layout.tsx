import { Stack } from 'one';
import { Platform } from 'react-native';
// Side-effect: registers the track-player background service on native (no-op on web).
import '../src/audio/registerPlaybackService';
import { Providers } from '../src/Providers';
import { COLORS } from '../src/theme';
import { HeaderMenuButton } from '../src/components/Menu';

function Navigator() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: COLORS.bgCard },
        headerTintColor: COLORS.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: COLORS.bgDark },
        headerRight: () => <HeaderMenuButton />,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="springboard" options={{ title: 'PulseEntrain' }} />
      <Stack.Screen name="category/[category]" options={{ title: 'Programs' }} />
      <Stack.Screen name="dose/[id]" options={{ title: '' }} />
      <Stack.Screen name="player/[id]" options={{ title: '' }} />
      <Stack.Screen name="manual" options={{ title: 'Manual' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
    </Stack>
  );
}

export default function Layout() {
  const app = (
    <Providers>
      <Navigator />
    </Providers>
  );

  if (Platform.OS === 'web') {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"
          />
          <title>PulseEntrain</title>
          {/* One mounts the app through display:contents wrappers into <body>.
              Make <body> a full-height flex column so the app's top flex:1 view
              fills the viewport — otherwise the whole RN flex tree (ScrollViews,
              navigation scenes, Modals) collapses to height:0 and nothing paints. */}
          <style>{`
            html, body { height: 100%; margin: 0; background-color: #0F1419; }
            body { display: flex; flex-direction: column; }
          `}</style>
        </head>
        {app}
      </html>
    );
  }

  return app;
}
