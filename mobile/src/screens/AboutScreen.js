import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export default function AboutScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>PulseEntrain</Text>
      <Text style={styles.p}>
        PulseEntrain combines vagus nerve stimulation with binaural-beat entrainment — pairing gentle
        stimulation from the Pulsetto with audio designed to nudge your brain toward a target state.
      </Text>
      <Text style={styles.h2}>Binaural beats</Text>
      <Text style={styles.p}>
        Two slightly different tones, one in each ear (e.g. 200 Hz and 210 Hz), are perceived as a third
        "beat" at the difference (10 Hz). Use headphones. Treat it as a relaxation aid, not a guaranteed
        outcome.
      </Text>
      <Text style={styles.h2}>Vagus nerve stimulation</Text>
      <Text style={styles.p}>
        The Pulsetto applies mild transcutaneous stimulation to the vagus nerve to support a calmer,
        parasympathetic state.
      </Text>
      <Text style={styles.note}>
        Wellness / entertainment only — not a medical device. Stop if anything feels uncomfortable.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 20 },
  h1: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: 12 },
  h2: { color: COLORS.accentBlueLight, fontSize: 16, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  p: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  note: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, marginTop: 24, fontStyle: 'italic' },
});
