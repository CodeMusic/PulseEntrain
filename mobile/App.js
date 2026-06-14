import React from 'react';
import { StatusBar, TouchableOpacity, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { COLORS } from './src/theme';
import SpringboardScreen from './src/screens/SpringboardScreen';
import CategoryScreen from './src/screens/CategoryScreen';
import DoseDetailScreen from './src/screens/DoseDetailScreen';
import ManualScreen from './src/screens/ManualScreen';
import AboutScreen from './src/screens/AboutScreen';

const Stack = createNativeStackNavigator();

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
      <StatusBar barStyle="light-content" />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.bgCard },
            headerTintColor: COLORS.textPrimary,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: COLORS.bgDark },
          }}>
          <Stack.Screen
            name="Springboard"
            component={SpringboardScreen}
            options={({ navigation }) => ({
              title: 'PulseEntrain',
              headerRight: () => (
                <TouchableOpacity onPress={() => navigation.navigate('About')} hitSlop={10}>
                  <Text style={{ color: COLORS.accentBlueLight, fontSize: 15, fontWeight: '600' }}>About</Text>
                </TouchableOpacity>
              ),
            })}
          />
          <Stack.Screen
            name="Category"
            component={CategoryScreen}
            options={({ route }) => ({ title: route.params?.category || 'Category' })}
          />
          <Stack.Screen name="DoseDetail" component={DoseDetailScreen} options={{ title: '' }} />
          <Stack.Screen name="Manual" component={ManualScreen} options={{ title: 'Manual' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
