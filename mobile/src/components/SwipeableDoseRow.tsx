import React, { useRef } from 'react';
import { Animated, View, Text, PanResponder, StyleSheet } from 'react-native';

// Swipe a My Sessions row left to delete. A red "Delete" backdrop is revealed as you
// drag; releasing past the threshold fires onDelete (which must confirm before it
// actually removes anything). The row always springs back — deletion happens only
// through the confirmation. Vertical scrolls pass straight through to the list.
const THRESHOLD = 96;
const MAX = 132;

export default function SwipeableDoseRow({ onDelete, children }) {
  const tx = useRef(new Animated.Value(0)).current;
  const spring = to => Animated.spring(tx, { toValue: to, useNativeDriver: true, bounciness: 6 }).start();

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (e, g) => { if (g.dx < 0) tx.setValue(Math.max(g.dx, -MAX)); },
      onPanResponderRelease: (e, g) => {
        spring(0);
        if (g.dx < -THRESHOLD) onDelete && onDelete();
      },
      onPanResponderTerminate: () => spring(0),
    }),
  ).current;

  const hintOpacity = tx.interpolate({ inputRange: [-MAX, -20, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.action, { opacity: hintOpacity }]} pointerEvents="none">
        <Text style={styles.actionTxt}>🗑  Delete</Text>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: tx }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  action: { position: 'absolute', right: 0, top: 0, bottom: 0, width: MAX, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 22 },
  actionTxt: { color: '#F87171', fontSize: 14, fontWeight: '800' },
});
