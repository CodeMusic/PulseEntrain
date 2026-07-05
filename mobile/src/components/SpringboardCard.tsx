import React from 'react';
import { TouchableOpacity, View, Text, Image, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { imageSource } from '../catalog/data';

export default function SpringboardCard({ title, subtitle, imageName, disabled, onPress, accent }: any) {
  const img = imageName ? imageSource(imageName) : null;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[styles.card, disabled && styles.disabled]}>
      {img ? <Image source={img} style={styles.bg} blurRadius={1} /> : null}
      <View style={[styles.overlay, accent && { borderColor: accent, borderWidth: 1 }]}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {disabled ? <Text style={styles.soon}>Coming soon</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minHeight: 112, borderRadius: 16, overflow: 'hidden', backgroundColor: COLORS.bgCard },
  disabled: { opacity: 0.45 },
  bg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%', opacity: 0.35 },
  overlay: {
    flex: 1,
    padding: 14,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,20,25,0.35)',
    borderRadius: 16,
  },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  subtitle: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  soon: { color: COLORS.accentOrange, fontSize: 11, marginTop: 4, fontWeight: '600' },
});
