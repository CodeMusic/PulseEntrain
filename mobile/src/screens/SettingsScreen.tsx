import React from 'react';
import { ScrollView, View, Text, TextInput, Switch, Alert, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { useSettings } from '../settings/SettingsProvider';

// Profile + preferences (local for now — see README roadmap for accounts/sync).
export default function SettingsScreen() {
  const s = useSettings();
  if (!s) return null;
  const { name, setName, mixWithOthers, setMix, devMode, setDevMode, fullBand, setFullBand, relativeControl, setRelativeControl } = s;

  // Turning the safety off requires an explicit acknowledgement; turning it back
  // on is immediate.
  const onToggleFullBand = on => {
    if (!on) return setFullBand(false);
    Alert.alert(
      '⚠️ Remove photosensitivity safeties?',
      'This lets the light and the on-screen pulse run at the full frequency range — including the 15–25 Hz band that most readily provokes photosensitive seizures — and stops the per-use warning from appearing.\n\nOnly enable this if you are certain neither you nor anyone who can see the light is photosensitive or has any seizure history. Stop immediately if you feel unwell.',
      [
        { text: 'Keep safeties on', style: 'cancel' },
        { text: 'I understand — remove', style: 'destructive', onPress: () => setFullBand(true) },
      ],
      { cancelable: true },
    );
  };

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

      <Text style={styles.section}>Audio</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Blend with other apps</Text>
            <Text style={styles.hint}>
              Keep playing under a guided meditation or music from another app instead of stopping it.
              Turn off to have PulseEntrain take over audio on its own.
            </Text>
          </View>
          <Switch
            value={mixWithOthers}
            onValueChange={setMix}
            trackColor={{ true: COLORS.accentGreen, false: COLORS.bgCardLight }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <Text style={styles.section}>Safety</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Full frequency range</Text>
            <Text style={styles.hint}>
              Off (recommended): the light/visual pulse is capped out of the highest-risk flicker band
              and a photosensitivity warning appears when you connect the Nova. Turn on — with
              confirmation — to unlock the full range and skip that warning.
            </Text>
          </View>
          <Switch
            value={!!fullBand}
            onValueChange={onToggleFullBand}
            trackColor={{ true: COLORS.accentOrange, false: COLORS.bgCardLight }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <Text style={styles.section}>Field mode</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Relative control</Text>
            <Text style={styles.hint}>
              Off: the block is an absolute map — each spot is a fixed carrier/beat. On: it's a
              trackpad — drag to nudge carrier/beat by how far you move, and the space wraps back on
              itself at the edges so you can keep exploring smoothly.
            </Text>
          </View>
          <Switch
            value={!!relativeControl}
            onValueChange={setRelativeControl}
            trackColor={{ true: COLORS.accentBlue, false: COLORS.bgCardLight }}
            thumbColor="#fff"
          />
        </View>
      </View>

      <Text style={styles.section}>Developer</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Developer mode</Text>
            <Text style={styles.hint}>
              Show live diagnostics — e.g. in Field mode, the Nova head pitch/roll and telemetry rate,
              and the Lightpad's raw touch values — for tuning and debugging.
            </Text>
          </View>
          <Switch
            value={!!devMode}
            onValueChange={setDevMode}
            trackColor={{ true: COLORS.accentGreen, false: COLORS.bgCardLight }}
            thumbColor="#fff"
          />
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { flex: 1, paddingRight: 14 },
  label: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  input: { backgroundColor: COLORS.bgCardLight, color: COLORS.textPrimary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, marginTop: 10 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  foot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 22 },
});
