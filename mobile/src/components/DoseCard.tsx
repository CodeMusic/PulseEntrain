import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { imageSource } from '../catalog/data';
import StrengthBadge from './StrengthBadge';
import TrackArt from './TrackArt';

export default function DoseCard({ dose, onPress }) {
  const img = imageSource(dose.image);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      <View style={styles.thumb}>
        <TrackArt scenes={dose.scenes} carrier={dose.carrier} image={img} name={dose.name} size={64} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {dose.name}
        </Text>
        {dose.lengthDisplay ? <Text style={styles.meta}>{dose.lengthDisplay}</Text> : null}
        <View style={styles.badgeRow}>
          <StrengthBadge strength={dose.strength} label={dose.strengthLabel} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  thumb: { width: 64, height: 64, marginRight: 12 },
  body: { flex: 1 },
  title: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  meta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  badgeRow: { marginTop: 6 },
});
