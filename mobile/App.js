import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from './src/theme';
import SplashScreen from './src/screens/SplashScreen';
import SpringboardScreen from './src/screens/SpringboardScreen';
import CategoryScreen from './src/screens/CategoryScreen';
import DoseDetailScreen from './src/screens/DoseDetailScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import ManualScreen from './src/screens/ManualScreen';
import AboutScreen from './src/screens/AboutScreen';
import { PulsettoProvider } from './src/pulsetto/PulsettoProvider';
import { NovaProvider } from './src/nova/NovaProvider';
import { MenuProvider, HeaderMenuButton } from './src/components/Menu';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: COLORS.bgDark,
    card: COLORS.bgCard,
    text: COLORS.textPrimary,
    border: COLORS.divider,
    primary: COLORS.accentBlue,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <PulsettoProvider>
        <NovaProvider>
        <StatusBar barStyle="light-content" />
        <NavigationContainer ref={navigationRef} theme={navTheme}>
          <MenuProvider navigationRef={navigationRef}>
            <Stack.Navigator
              initialRouteName="Splash"
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.bgCard },
                headerTintColor: COLORS.textPrimary,
                headerTitleStyle: { fontWeight: '700' },
                contentStyle: { backgroundColor: COLORS.bgDark },
                headerRight: () => <HeaderMenuButton />,
              }}>
              <Stack.Screen name="Splash" component={SplashScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Springboard" component={SpringboardScreen} options={{ title: 'PulseEntrain' }} />
              <Stack.Screen
                name="Category"
                component={CategoryScreen}
                options={({ route }) => ({ title: route.params?.category || 'Category' })}
              />
              <Stack.Screen name="DoseDetail" component={DoseDetailScreen} options={{ title: '' }} />
              <Stack.Screen name="Player" component={PlayerScreen} options={{ title: '' }} />
              <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual' }} />
              <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
            </Stack.Navigator>
          </MenuProvider>
        </NavigationContainer>
        </NovaProvider>
      </PulsettoProvider>
    </SafeAreaProvider>
  );
}
