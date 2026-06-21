import React from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { useSettings } from '../settings/SettingsProvider';

// Profile + preferences (local for now — see README roadmap for accounts/sync).
export default function SettingsScreen() {
  const s = useSettings();
  if (!s) return null;
  const { name, setName } = s;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Profile</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="What should we call you?"
          placeholderTextColor={COLORS.textMuted}
        />
        <Text style={styles.hint}>Used for your welcome and goal notes. Stays on this device.</Text>
      </View>

      <Text style={styles.foot}>
        Accounts &amp; cross-device sync are on the roadmap. For now your profile and goals live on this
        device only.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 40 },
  section: { color: COLORS.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 8 },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 16 },
  label: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  input: { backgroundColor: COLORS.bgCardLight, color: COLORS.textPrimary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, marginTop: 10 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  foot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 22 },
});
