import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, strengthColor } from '../theme';

export default function StrengthBadge({ strength, label, compact }) {
  if (strength == null) return null;
  const color = strengthColor(strength);
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.num, { color }]}>{strength}</Text>
      {!compact && label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    gap: 6,
  },
  num: { fontSize: 13, fontWeight: '700' },
  label: { color: COLORS.textSecondary, fontSize: 11 },
});
