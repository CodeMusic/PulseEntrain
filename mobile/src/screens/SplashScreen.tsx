import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

// Branded loading screen — covers the JS-bundle warm-up so there's no white
// flash, then hands off to the springboard.
export default function SplashScreen({ navigation }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 1100,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) navigation.replace('Springboard');
    });
    return () => anim.stop();
  }, [navigation, progress]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>PulseEntrain</Text>
      <Text style={styles.tag}>binaural + vagus nerve entrainment</Text>
      <View style={styles.bar}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark, justifyContent: 'center', alignItems: 'center', padding: 40 },
  brand: { color: COLORS.textPrimary, fontSize: 34, fontWeight: '800' },
  tag: { color: COLORS.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 44 },
  bar: { width: '70%', height: 4, borderRadius: 2, backgroundColor: COLORS.bgCardLight, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: COLORS.accentBlue },
});
