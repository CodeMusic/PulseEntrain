import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PulsettoProvider } from './pulsetto/PulsettoProvider';
import { NovaProvider } from './nova/NovaProvider';
import { LumiProvider } from './lumi/LumiProvider';
import { LightpadProvider } from './lightpad/LightpadProvider';
import { SessionsProvider } from './wellness/SessionsProvider';
import { SettingsProvider } from './settings/SettingsProvider';
import { MenuProvider } from './components/Menu';
import { DevPanelProvider, DevPanel, DevContentInset } from './dev/DevPanel';
import { SessionGuardProvider } from './session/SessionGuard';
import HealthNotifier from './wellness/HealthNotifier';

// App-wide context tree. Previously lived in App.js; under One it wraps the
// file-based <Stack> from app/_layout.tsx instead of a NavigationContainer
// (One owns the navigation container).
export function Providers({ children }) {
  return (
    <SafeAreaProvider>
      <PulsettoProvider>
        <NovaProvider>
          <LumiProvider>
          <LightpadProvider>
          <SessionsProvider>
            <SettingsProvider>
              <StatusBar barStyle="light-content" />
              <SessionGuardProvider>
                <DevPanelProvider>
                  <DevContentInset>
                    <MenuProvider>{children}</MenuProvider>
                  </DevContentInset>
                  <DevPanel />
                </DevPanelProvider>
              </SessionGuardProvider>
              <HealthNotifier />
            </SettingsProvider>
          </SessionsProvider>
          </LightpadProvider>
          </LumiProvider>
        </NovaProvider>
      </PulsettoProvider>
    </SafeAreaProvider>
  );
}
