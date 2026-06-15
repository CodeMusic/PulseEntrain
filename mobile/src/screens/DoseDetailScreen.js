import React, { useState } from 'react';
import { ScrollView, View, Text, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { COLORS } from '../theme';
import { doseById, imageSource, audioSource } from '../catalog/data';
import ArtImage from '../components/ArtImage';
import StrengthBadge from '../components/StrengthBadge';

export default function DoseDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const dose = doseById(id);
  const [usePulsetto, setUsePulsetto] = useState(true);

  if (!dose) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>Program not found.</Text>
      </View>
    );
  }
  const img = imageSource(dose.image);

  const start = () => {
    if (!audioSource(dose.audio)) {
      Alert.alert(
        'Not in this build',
        `"${dose.name}" isn't bundled in this local build yet. A few demo tracks ship in the app for now — streaming comes later.`,
      );
      return;
    }
    navigation.navigate('Player', { id: dose.id, usePulsetto });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <ArtImage source={img} height={220} radius={18} hpad={16} />
      <Text style={styles.title}>{dose.name}</Text>
      <View style={styles.metaRow}>
        <StrengthBadge strength={dose.strength} label={dose.strengthLabel} />
        {dose.lengthDisplay ? <Text style={styles.duration}>{dose.lengthDisplay}</Text> : null}
      </View>
      {dose.description ? <Text style={styles.desc}>{dose.description}</Text> : null}

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Use Pulsetto</Text>
          <Text style={styles.toggleSub}>Vagus nerve stimulation alongside the audio</Text>
        </View>
        <Switch
          value={usePulsetto}
          onValueChange={setUsePulsetto}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>

      <TouchableOpacity style={styles.startBtn} activeOpacity={0.85} onPress={start}>
        <Text style={styles.startTxt}>Start</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 40 },
  muted: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  hero: { width: '100%', height: 220, borderRadius: 18, backgroundColor: COLORS.bgCardLight },
  heroEmpty: { borderWidth: 1, borderColor: COLORS.divider },
  title: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '800', marginTop: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  duration: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  desc: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 14 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
  },
  toggleTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  toggleSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  startBtn: { backgroundColor: COLORS.accentGreen, borderRadius: 30, paddingVertical: 18, alignItems: 'center', marginTop: 24 },
  startTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
