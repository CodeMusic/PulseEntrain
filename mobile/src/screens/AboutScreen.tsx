import React from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { IS_WEB } from '../nativeOnly';

export default function AboutScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>PulseEntrain</Text>
      <Text style={styles.p}>
        PulseEntrain layers up to three optional modalities to nudge your brain toward a target state:
        binaural-beat <Text style={styles.b}>audio</Text>, synchronized <Text style={styles.b}>light</Text>{' '}
        (Lumenate Nova), and gentle vagus-nerve <Text style={styles.b}>stimulation</Text> (Pulsetto). Use
        whatever you have — audio alone works on any headphones; the devices add to it.
      </Text>

      <Text style={styles.h2}>Ways to play</Text>
      <Text style={styles.p}>
        Browse the <Text style={styles.b}>catalog</Text> by category, dial a session live in{' '}
        <Text style={styles.b}>Manual</Text> mode, or <Text style={styles.b}>open a saved .imedx</Text> file
        from the menu. {IS_WEB ? 'On the web you can also author your own sessions in ' : 'On the web, '}
        <Text style={styles.b}>Studio</Text>
        {IS_WEB ? ' — draw a beat-over-time curve, preview it, and download it.' : ' lets you author your own.'}
      </Text>

      <Text style={styles.h2}>Binaural beats</Text>
      <Text style={styles.p}>
        Two slightly different tones, one in each ear (e.g. 200 Hz and 210 Hz), are perceived as a third
        "beat" at the difference (10 Hz). The beat targets a brainwave band (delta → gamma). Use
        headphones. Treat it as a relaxation aid, not a guaranteed outcome.
      </Text>

      <Text style={styles.h2}>Light entrainment (Lumenate Nova)</Text>
      <Text style={styles.p}>
        When connected, the Nova flickers in sync with the beat for combined audio-visual entrainment.
        The strobe is capped at {MAX_NOVA_STROBE_HZ} Hz.
      </Text>
      <Text style={styles.warn}>
        ⚠️ Flashing light can trigger seizures in people with photosensitive epilepsy. Don't use the Nova
        if you (or anyone who can see it) may be photosensitive, and stop immediately if you feel unwell.
      </Text>

      <Text style={styles.h2}>Vagus nerve stimulation (Pulsetto)</Text>
      <Text style={styles.p}>
        The Pulsetto applies mild transcutaneous stimulation to the vagus nerve to support a calmer,
        parasympathetic state. Its intensity can follow the session or be set by hand.
      </Text>

      <Text style={styles.h2}>Play it live (ROLI controllers)</Text>
      <Text style={styles.p}>
        In Manual mode you can steer the binaural space by hand from a{' '}
        <Text style={styles.b}>ROLI</Text> controller over Bluetooth MIDI. A{' '}
        <Text style={styles.b}>LUMI Keys</Text> keyboard plays it like an instrument — a note sets the
        carrier, black keys set the beat. A <Text style={styles.b}>Lightpad Block</Text> (or the legacy
        Block M) becomes an XY pad: glide left↔right for the carrier, up↔down for the beat, and press for
        volume — so you can feel around for a spot that suits you. The pad lights under your finger on its
        own; matching those lights to our colours is a future addition.
      </Text>

      <Text style={styles.h2}>Daily goal</Text>
      <Text style={styles.p}>
        Any completed session — from the catalog or a Manual timer — counts toward your daily goal,
        shown as the weekly tracker on the home screen. Tap it to set the goal or review history.
      </Text>

      <Text style={styles.note}>
        Wellness / entertainment only — not a medical device, and not a treatment for any condition. Stop
        if anything feels uncomfortable.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 20, paddingBottom: 40 },
  h1: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: 12 },
  h2: { color: COLORS.accentBlueLight, fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 6 },
  p: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  b: { color: COLORS.textPrimary, fontWeight: '700' },
  warn: { color: COLORS.accentOrange, fontSize: 13, lineHeight: 20, marginTop: 8 },
  note: { color: COLORS.textMuted, fontSize: 13, lineHeight: 20, marginTop: 24, fontStyle: 'italic' },
});
