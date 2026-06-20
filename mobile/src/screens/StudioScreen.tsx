import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';
import BeatChart from '../components/BeatChart';
import { SessionSynth } from '../audio/sessionSynth';
import { pickImedxFile } from '../catalog/pickImedx';
import { registerImportedDose } from '../catalog/importDose';

// Web authoring (`/studio`): the desktop Admin's editor, in the browser, reusing
// the SAME shared pieces the player uses — BeatChart (graph), SessionSynth
// (preview), and the .imedx contract. Node editing is via the list for now
// (drag-on-graph is a follow-up). Save = download the self-contained .imedx.
const NOISES = ['none', 'white', 'pink', 'brown'];
const FADES = ['none', 'short', 'medium', 'long'];
const slug = s =>
  String(s || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'session';

const blankSession = () => ({
  name: 'New session',
  description: '',
  category: 'Imported',
  strength: 4,
  durationSec: 600,
  carrier: 200,
  noise: 'none',
  fade: 'medium',
  image: null,
  scenes: [
    { atSec: 0, beatHz: 10 },
    { atSec: 600, beatHz: 6 },
  ],
});

export default function StudioScreen({ navigation }) {
  const [s, setS] = useState<any>(blankSession);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const synthRef = useRef(null);

  useEffect(() => () => { try { synthRef.current?.stop(); } catch (e) {} }, []);

  if (!IS_WEB) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>The Studio editor runs in a web browser.</Text>
        <Text style={styles.mutedSmall}>Open the PulseEntrain site on a computer to author sessions.</Text>
      </View>
    );
  }

  const set = patch => setS(prev => ({ ...prev, ...patch }));
  const sortedScenes = () => [...s.scenes].sort((a, b) => a.atSec - b.atSec);

  const setScene = (i, patch) =>
    setS(prev => {
      const scenes = prev.scenes.map((sc, j) => (j === i ? { ...sc, ...patch } : sc));
      return { ...prev, scenes };
    });
  const addNode = () =>
    setS(prev => {
      const last = prev.scenes[prev.scenes.length - 1] || { atSec: 0, beatHz: 10 };
      const at = Math.min(prev.durationSec, Math.round((last.atSec + prev.durationSec) / 2));
      return { ...prev, scenes: [...prev.scenes, { atSec: at, beatHz: last.beatHz }] };
    });
  const delNode = i =>
    setS(prev => ({ ...prev, scenes: prev.scenes.filter((_, j) => j !== i) }));

  const stopPreview = () => {
    try { synthRef.current?.stop(); } catch (e) {}
    synthRef.current = null;
    setPlaying(false);
    setPos(0);
  };
  const togglePreview = () => {
    if (playing) return stopPreview();
    const synth = new SessionSynth({
      scenes: sortedScenes(),
      carrier: s.carrier,
      duration: s.durationSec,
      noise: s.noise,
      transitionFade: s.fade,
      volume: 1,
      onTick: p => setPos(p),
      onEnded: () => { setPlaying(false); setPos(0); },
    });
    synthRef.current = synth;
    synth.play();
    setPlaying(true);
  };

  // Assemble the self-contained .imedx (same shape the Admin writes / the app reads).
  const buildImedx = () => ({
    schema_version: 2,
    id: slug(s.name),
    meta: {
      name: s.name,
      description: s.description || null,
      category: s.category || null,
      strength: s.strength,
      durationSec: s.durationSec,
      image: s.image || null,
    },
    audio: {
      binaural: { carrierHz: s.carrier },
      beds: s.noise !== 'none' ? [{ source: 'noise', type: s.noise, level: 0.25 }] : [],
      transitionFade: s.fade,
      masterVolume: 1,
    },
    entrainment: { scenes: sortedScenes() },
    nova: { maxHz: 60 },
  });

  const download = () => {
    stopPreview();
    const json = JSON.stringify(buildImedx(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(s.name)}.imedx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openFile = async () => {
    try {
      const picked = await pickImedxFile();
      if (!picked) return;
      const j = picked.json;
      const meta = j.meta || {};
      const audio = j.audio || {};
      const noiseBed = (audio.beds || []).find(b => b.source === 'noise');
      stopPreview();
      set({
        name: meta.name || 'Imported session',
        description: meta.description || '',
        category: meta.category || 'Imported',
        strength: meta.strength ?? 4,
        durationSec: meta.durationSec ?? 600,
        carrier: (audio.binaural && audio.binaural.carrierHz) ?? 200,
        noise: noiseBed ? noiseBed.type : 'none',
        fade: audio.transitionFade || 'medium',
        image: meta.image || null,
        scenes: (j.entrainment && j.entrainment.scenes) || [],
      });
    } catch (e) {
      Alert.alert("Couldn't open that file", (e && e.message) || 'Unknown error.');
    }
  };

  const playInPlayer = () => {
    const dose = registerImportedDose(buildImedx());
    navigation.navigate('Player', { id: dose.id, usePulsetto: false, useNova: false });
  };

  const progress = s.durationSec > 0 ? pos / s.durationSec : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Pill label="Open…" onPress={openFile} />
        <Pill label={playing ? '■ Stop' : '▶ Preview'} onPress={togglePreview} color={playing ? COLORS.accentRed : COLORS.accentGreen} />
        <Pill label="Play in player" onPress={playInPlayer} />
        <Pill label="Download .imedx" onPress={download} color={COLORS.accentBlue} />
      </View>

      <View style={styles.graphCard}>
        <BeatChart scenes={sortedScenes()} duration={s.durationSec} baseCarrier={s.carrier} height={240} progress={playing ? progress : null} />
      </View>

      <Field label="Title">
        <TextInput style={styles.input} value={s.name} onChangeText={t => set({ name: t })} placeholder="Title" placeholderTextColor={COLORS.textMuted} />
      </Field>
      <View style={styles.rowFields}>
        <Field label={`Strength · ${s.strength}`} flex>
          <Slider minimumValue={1} maximumValue={7} step={1} value={s.strength} onValueChange={v => set({ strength: v })}
            minimumTrackTintColor={COLORS.accentBlue} maximumTrackTintColor={COLORS.bgCardLight} thumbTintColor="#fff" />
        </Field>
        <View style={{ width: 12 }} />
        <Field label="Duration (min)" w={120}>
          <TextInput style={styles.input} keyboardType="numeric" value={String(Math.round(s.durationSec / 60))}
            onChangeText={t => set({ durationSec: Math.max(1, Math.round((parseFloat(t) || 0) * 60)) })} />
        </Field>
        <View style={{ width: 12 }} />
        <Field label="Carrier (Hz)" w={120}>
          <TextInput style={styles.input} keyboardType="numeric" value={String(s.carrier)}
            onChangeText={t => set({ carrier: Math.max(40, Math.min(600, parseFloat(t) || 200)) })} />
        </Field>
      </View>
      <Field label="Category">
        <TextInput style={styles.input} value={s.category} onChangeText={t => set({ category: t })} />
      </Field>
      <Field label="Description">
        <TextInput style={[styles.input, styles.multiline]} value={s.description} onChangeText={t => set({ description: t })} multiline />
      </Field>

      <Field label="Noise bed">
        <Chips options={NOISES} value={s.noise} onPick={v => set({ noise: v })} />
      </Field>
      <Field label="Transition fade">
        <Chips options={FADES} value={s.fade} onPick={v => set({ fade: v })} />
      </Field>

      <Text style={styles.section}>Nodes (beat / carrier over time)</Text>
      <View style={styles.nodeHead}>
        <Text style={[styles.nodeCol, styles.nodeColLbl]}>time (s)</Text>
        <Text style={[styles.nodeCol, styles.nodeColLbl]}>beat (Hz)</Text>
        <Text style={[styles.nodeCol, styles.nodeColLbl]}>carrier (Hz)</Text>
        <View style={{ width: 36 }} />
      </View>
      {s.scenes.map((sc, i) => (
        <View key={i} style={styles.nodeRow}>
          <TextInput style={[styles.input, styles.nodeCol]} keyboardType="numeric" value={String(sc.atSec)}
            onChangeText={t => setScene(i, { atSec: Math.max(0, parseFloat(t) || 0) })} />
          <TextInput style={[styles.input, styles.nodeCol]} keyboardType="numeric" value={String(sc.beatHz)}
            onChangeText={t => setScene(i, { beatHz: Math.max(0, parseFloat(t) || 0) })} />
          <TextInput style={[styles.input, styles.nodeCol]} keyboardType="numeric"
            value={sc.carrierHz == null ? '' : String(sc.carrierHz)} placeholder="(base)" placeholderTextColor={COLORS.textMuted}
            onChangeText={t => setScene(i, { carrierHz: t.trim() === '' ? undefined : (parseFloat(t) || 0) })} />
          <TouchableOpacity style={styles.del} onPress={() => delNode(i)}>
            <Text style={styles.delTxt}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity style={styles.addBtn} onPress={addNode}>
        <Text style={styles.addTxt}>+ Add node</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const Pill = ({ label, onPress, color }: any) => (
  <TouchableOpacity style={[styles.pill, color && { backgroundColor: color }]} onPress={onPress} activeOpacity={0.85}>
    <Text style={styles.pillTxt}>{label}</Text>
  </TouchableOpacity>
);
const Field = ({ label, children, flex, w }: any) => (
  <View style={[styles.field, flex && { flex: 1 }, w ? { width: w } : null]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);
const Chips = ({ options, value, onPick }: any) => (
  <View style={styles.chips}>
    {options.map(o => (
      <TouchableOpacity key={o} style={[styles.chip, value === o && styles.chipOn]} onPress={() => onPick(o)}>
        <Text style={[styles.chipTxt, value === o && styles.chipTxtOn]}>{o}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: COLORS.bgDark },
  muted: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  mutedSmall: { color: COLORS.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  pill: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 22, backgroundColor: COLORS.bgCardLight },
  pillTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  graphCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, paddingTop: 14, paddingHorizontal: 8, marginBottom: 14 },
  field: { marginTop: 12 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  rowFields: { flexDirection: 'row', alignItems: 'flex-end' },
  input: { backgroundColor: COLORS.bgCardLight, color: COLORS.textPrimary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14 },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  section: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: COLORS.bgCard },
  chipOn: { backgroundColor: COLORS.accentBlue },
  chipTxt: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: '#fff' },
  nodeHead: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  nodeColLbl: { color: COLORS.textMuted, fontSize: 11, backgroundColor: 'transparent', paddingVertical: 0 },
  nodeRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  nodeCol: { flex: 1 },
  del: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgCard },
  delTxt: { color: COLORS.accentRed, fontSize: 16, fontWeight: '800' },
  addBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.bgCard, alignItems: 'center' },
  addTxt: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
});
