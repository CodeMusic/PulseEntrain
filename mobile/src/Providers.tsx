import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PulsettoProvider } from './pulsetto/PulsettoProvider';
import { NovaProvider } from './nova/NovaProvider';
import { SessionsProvider } from './wellness/SessionsProvider';
import { MenuProvider } from './components/Menu';

// App-wide context tree. Previously lived in App.js; under One it wraps the
// file-based <Stack> from app/_layout.tsx instead of a NavigationContainer
// (One owns the navigation container).
export function Providers({ children }) {
  return (
    <SafeAreaProvider>
      <PulsettoProvider>
        <NovaProvider>
          <SessionsProvider>
            <StatusBar barStyle="light-content" />
            <MenuProvider>{children}</MenuProvider>
          </SessionsProvider>
        </NovaProvider>
      </PulsettoProvider>
    </SafeAreaProvider>
  );
}
