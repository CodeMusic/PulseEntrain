import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../theme';
import { IS_WEB, nativeOnlyNotice } from '../nativeOnly';
import EditableBeatGraph from '../components/EditableBeatGraph';
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
const fmtClock = sec => {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

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
  const [scrub, setScrub] = useState(0); // chosen preview start position (seconds)
  const [sel, setSel] = useState(-1); // selected node index
  const synthRef = useRef(null);
  const sRef = useRef(s);
  sRef.current = s;

  // ---- undo/redo over scene edits (add / move / delete) ----
  const histRef = useRef<{ undo: any[]; redo: any[] }>({ undo: [], redo: [] });
  const [, force] = useState(0);
  const bump = () => force(x => x + 1);
  const cloneScenes = arr => arr.map(o => ({ ...o }));
  const pushHistory = () => {
    histRef.current.undo.push(cloneScenes(sRef.current.scenes));
    if (histRef.current.undo.length > 100) histRef.current.undo.shift();
    histRef.current.redo = [];
    bump();
  };
  const undo = () => {
    const h = histRef.current;
    if (!h.undo.length) return;
    h.redo.push(cloneScenes(sRef.current.scenes));
    setS(p => ({ ...p, scenes: h.undo.pop() }));
    setSel(-1);
    bump();
  };
  const redo = () => {
    const h = histRef.current;
    if (!h.redo.length) return;
    h.undo.push(cloneScenes(sRef.current.scenes));
    setS(p => ({ ...p, scenes: h.redo.pop() }));
    setSel(-1);
    bump();
  };

  useEffect(() => () => { try { synthRef.current?.stop(); } catch (e) {} }, []);

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo (web; refs keep it fresh).
  useEffect(() => {
    if (!IS_WEB || typeof document === 'undefined') return;
    const onKey = e => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // let fields keep native text undo
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const addNode = () => {
    pushHistory();
    setS(prev => {
      const last = prev.scenes[prev.scenes.length - 1] || { atSec: 0, beatHz: 10 };
      const at = Math.min(prev.durationSec, Math.round((last.atSec + prev.durationSec) / 2));
      return { ...prev, scenes: [...prev.scenes, { atSec: at, beatHz: last.beatHz }] };
    });
  };
  const delNode = i => {
    pushHistory();
    setS(prev => ({ ...prev, scenes: prev.scenes.filter((_, j) => j !== i) }));
  };

  const stopPreview = () => {
    try { synthRef.current?.stop(); } catch (e) {}
    synthRef.current = null;
    setPlaying(false);
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
      onEnded: () => { setPlaying(false); setPos(0); setScrub(0); },
    });
    synthRef.current = synth;
    synth.seek(Math.max(0, Math.min(s.durationSec, scrub))); // start from the chosen position
    synth.play();
    setPos(scrub);
    setPlaying(true);
  };
  // Drag the position slider — seeks live if playing, else sets the start point.
  const onScrub = v => {
    setScrub(v);
    if (playing) {
      setPos(v);
      try { synthRef.current?.seek(v); } catch (e) {}
    }
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

  const headSec = playing ? pos : scrub; // playhead position (live, or chosen start)
  const progress = s.durationSec > 0 ? headSec / s.durationSec : 0;
  const canUndo = histRef.current.undo.length > 0;
  const canRedo = histRef.current.redo.length > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <Pill label="Open…" onPress={openFile} />
        <Pill label={playing ? '■ Stop' : '▶ Preview'} onPress={togglePreview} color={playing ? COLORS.accentRed : COLORS.accentGreen} />
        <Pill label="Play in player" onPress={playInPlayer} />
        <Pill label="Download .imedx" onPress={download} color={COLORS.accentBlue} />
        <Pill label="↶ Undo" onPress={undo} dim={!canUndo} />
        <Pill label="↷ Redo" onPress={redo} dim={!canRedo} />
      </View>

      <View style={styles.graphCard}>
        <EditableBeatGraph
          scenes={s.scenes}
          duration={s.durationSec}
          baseCarrier={s.carrier}
          height={260}
          selected={sel}
          onSelect={setSel}
          onChange={scenes => set({ scenes })}
          onBeginEdit={pushHistory}
          progress={progress}
        />
      </View>
      {/* Position: drag to set where Preview starts (the graph itself adds nodes). */}
      <View style={styles.scrubRow}>
        <Text style={styles.scrubTime}>{fmtClock(headSec)}</Text>
        <Slider
          style={styles.scrubSlider}
          minimumValue={0}
          maximumValue={Math.max(1, s.durationSec)}
          value={Math.min(headSec, s.durationSec)}
          onValueChange={onScrub}
          minimumTrackTintColor={COLORS.accentBlue}
          maximumTrackTintColor={COLORS.bgCardLight}
          thumbTintColor="#fff"
        />
        <Text style={styles.scrubTime}>{fmtClock(s.durationSec)}</Text>
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

      <Text style={styles.section}>Selected node</Text>
      {sel >= 0 && s.scenes[sel] ? (
        <View style={styles.nodeRow}>
          <Field label="time (s)" flex>
            <TextInput style={styles.input} keyboardType="numeric" value={String(s.scenes[sel].atSec)}
              onChangeText={t => setScene(sel, { atSec: Math.max(0, parseFloat(t) || 0) })} />
          </Field>
          <View style={{ width: 10 }} />
          <Field label="beat (Hz)" flex>
            <TextInput style={styles.input} keyboardType="numeric" value={String(s.scenes[sel].beatHz)}
              onChangeText={t => setScene(sel, { beatHz: Math.max(0, parseFloat(t) || 0) })} />
          </Field>
          <View style={{ width: 10 }} />
          <Field label="carrier (Hz)" flex>
            <TextInput style={styles.input} keyboardType="numeric"
              value={s.scenes[sel].carrierHz == null ? '' : String(s.scenes[sel].carrierHz)}
              placeholder="(base)" placeholderTextColor={COLORS.textMuted}
              onChangeText={t => setScene(sel, { carrierHz: t.trim() === '' ? undefined : (parseFloat(t) || 0) })} />
          </Field>
          <View style={{ width: 10 }} />
          <TouchableOpacity style={styles.delBig} onPress={() => { delNode(sel); setSel(-1); }}>
            <Text style={styles.delTxt}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.mutedSmall}>Tap a node on the graph to edit its time / beat / carrier — or tap empty space to add one.</Text>
      )}
      <TouchableOpacity style={styles.addBtn} onPress={() => { addNode(); setSel(s.scenes.length); }}>
        <Text style={styles.addTxt}>+ Add node (midpoint)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const Pill = ({ label, onPress, color, dim }: any) => (
  <TouchableOpacity
    disabled={dim}
    style={[styles.pill, color && { backgroundColor: color }, dim && { opacity: 0.4 }]}
    onPress={onPress}
    activeOpacity={0.85}>
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
  graphCard: { backgroundColor: COLORS.bgCard, borderRadius: 14, paddingTop: 14, paddingHorizontal: 8, marginBottom: 8 },
  scrubRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  scrubSlider: { flex: 1, marginHorizontal: 8, height: 36 },
  scrubTime: { color: COLORS.textMuted, fontSize: 11, width: 40, textAlign: 'center' },
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
  nodeRow: { flexDirection: 'row', alignItems: 'flex-end' },
  delBig: { width: 44, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bgCard },
  delTxt: { color: COLORS.accentRed, fontSize: 16, fontWeight: '800' },
  addBtn: { marginTop: 12, paddingVertical: 12, borderRadius: 10, backgroundColor: COLORS.bgCard, alignItems: 'center' },
  addTxt: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
});
