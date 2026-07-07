import React from 'react';
import { ScrollView, View, Text, TextInput, Switch, TouchableOpacity, Alert, Platform, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { useSettings } from '../settings/SettingsProvider';

const IS_IOS = Platform.OS === 'ios'; // Apple Health is iOS-only

// Profile + preferences (local for now — see README roadmap for accounts/sync).
export default function SettingsScreen() {
  const s = useSettings();
  if (!s) return null;
  const { name, setName, mixWithOthers, setMix, devMode, setDevMode, fullBand, setFullBand, relativeControl, setRelativeControl, pulsettoStrength, setPulsettoStrength, exploreField, setExploreField, healthSync, setHealthSync } = s;

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

      {IS_IOS ? (
        <>
          <Text style={styles.section}>Apple Health</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Sync mindful minutes</Text>
                <Text style={styles.hint}>
                  Log each finished session to Apple Health as Mindful Minutes, so your
                  PulseEntrain time counts toward your wellness rings and shows up in Health.
                  You'll be asked to grant permission the first time.
                </Text>
              </View>
              <Switch
                value={!!healthSync}
                onValueChange={setHealthSync}
                trackColor={{ true: COLORS.accentGreen, false: COLORS.bgCardLight }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </>
      ) : null}

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

      <Text style={styles.section}>Devices</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Pulsetto strength</Text>
            <Text style={styles.hint}>
              Default vagus-nerve intensity a session starts at (1–7). In Field mode, pressing the
              block adds +2 on top (up to 9) while you hold.
            </Text>
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setPulsettoStrength((pulsettoStrength || 4) - 1)}>
              <Text style={styles.stepTxt}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepVal}>{pulsettoStrength || 4}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setPulsettoStrength((pulsettoStrength || 4) + 1)}>
              <Text style={styles.stepTxt}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Text style={styles.section}>Field mode</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Relative control</Text>
            <Text style={styles.hint}>
              Applies in Field mode and (with Explore Field Space) in programs. Off: a drag maps
              directly — snap to a spot, or spring back. On: it's a gentle walk — each drag moves only
              a fraction of the range and stays there, and the space wraps at the edges, so you explore
              like real space.
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

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>Explore Field Space</Text>
            <Text style={styles.hint}>
              In synth programs, steer like Field mode: look up/down (Nova) to bend the beat &amp;
              flash, tilt for the biphotic — and drag on the cover to bend carrier (←→) &amp; beat (↑↓),
              which springs back on release. Off leaves programs playing exactly as authored.
            </Text>
          </View>
          <Switch
            value={!!exploreField}
            onValueChange={setExploreField}
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
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.bgCardLight, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  stepVal: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  foot: { color: COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 22 },
});
