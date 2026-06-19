import React, { useState } from 'react';
import { ScrollView, View, Text, Switch, TouchableOpacity, Pressable, StyleSheet, Alert } from 'react-native';
import { COLORS } from '../theme';
import { doseById, imageSource, audioSource, isSynthDose } from '../catalog/data';
import ArtImage from '../components/ArtImage';
import BeatPeek from '../components/BeatPeek';
import StrengthBadge from '../components/StrengthBadge';
import NovaExplorer from '../components/NovaExplorer';
import { useNova } from '../nova/NovaProvider';
import { MAX_NOVA_STROBE_HZ } from '../nova/novaController';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';

export default function DoseDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const dose = doseById(id);
  const nova = useNova();
  const [usePulsetto, setUsePulsetto] = useState(!IS_WEB);
  const [peek, setPeek] = useState(false);

  const onPulsetto = v => {
    if (IS_WEB) return nativeOnlyNotice('Pulsetto');
    setUsePulsetto(v);
  };

  if (!dose) {
    return (
      <View style={styles.container}>
        <Text style={styles.muted}>Program not found.</Text>
      </View>
    );
  }
  const img = imageSource(dose.image);

  const start = () => {
    // synth (.imedx) doses need no bundled MP3 — only legacy doses can be "not in this build"
    if (!isSynthDose(dose) && !audioSource(dose.audio)) {
      Alert.alert(
        'Not in this build',
        `"${dose.name}" isn't bundled in this local build yet. A few demo tracks ship in the app for now — streaming comes later.`,
      );
      return;
    }
    navigation.navigate('Player', { id: dose.id, usePulsetto, useNova: nova.connected });
  };

  const toggleNova = val => {
    if (val && IS_WEB) return nativeOnlyNotice('Lumenate Nova');
    if (val) {
      Alert.alert(
        '⚠️ Photosensitivity warning',
        `The Lumenate Nova flashes light. Flashing light can trigger seizures in people with photosensitive epilepsy. The light is capped at ${MAX_NOVA_STROBE_HZ} Hz. Do not use if you (or anyone nearby who can see it) may be photosensitive, and stop immediately if you feel unwell.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'I understand — connect', onPress: () => nova.connect() },
        ],
        { cancelable: true },
      );
    } else {
      nova.disconnect();
    }
  };

  const novaSub =
    nova.status === 'scanning'
      ? 'Searching for Nova…'
      : nova.status === 'connected'
      ? 'Connected — light follows the session'
      : nova.status === 'notfound'
      ? 'Not found — is it on and nearby?'
      : nova.status === 'error'
      ? 'Connection error'
      : 'Visual light entrainment';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onLongPress={() => setPeek(true)} delayLongPress={300}>
        <ArtImage source={img} height={220} radius={18} hpad={16} />
      </Pressable>
      <BeatPeek visible={peek} onClose={() => setPeek(false)} dose={dose} image={img} />
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
          onValueChange={onPulsetto}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>

      <View style={styles.toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>Use Lumenate Nova</Text>
          <Text style={styles.toggleSub}>{novaSub}</Text>
        </View>
        <Switch
          value={nova.connected}
          onValueChange={toggleNova}
          trackColor={{ true: COLORS.accentBlue, false: COLORS.divider }}
          thumbColor="#fff"
        />
      </View>
      {nova.connected ? <NovaExplorer nova={nova} showFrequency /> : null}

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
