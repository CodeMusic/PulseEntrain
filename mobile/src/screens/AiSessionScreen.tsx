import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, ActivityIndicator, Animated, Easing, StyleSheet, Keyboard } from 'react-native';
import { COLORS } from '../theme';
import { IMEDX_SYSTEM_PROMPT, extractImedx } from '../catalog/imedxSpec';
import { addUserSession } from '../catalog/userSessions';

const ENDPOINT = 'https://n8n.codemusic.ca/webhook/pulseentrain';

// A spread of concrete and abstract seeds — the abstract ones lean on the AI's
// synesthesia (translate an essence into sound), not a literal description.
const SEEDS = [
  'Wind down from a racing mind into deep sleep, 25 min',
  'Nostalgia, warm and a little bittersweet',
  'The ocean at dawn',
  'Psilocybin',
  'Grief, gently held',
  'Dark chocolate',
  'A thunderstorm rolling through',
  'Focused alpha for an hour of deep work',
];

export default function AiSessionScreen({ navigation }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [glow]);

  const orbScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, busy ? 1.18 : 1.08] });
  const orbOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] });

  const generate = async () => {
    const description = text.trim();
    if (!description || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, system: IMEDX_SYSTEM_PROMPT }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`The generator returned ${res.status}.`);
      const imedx = extractImedx(await res.json());
      if (!imedx) throw new Error("Couldn't read a session from the response.");
      const dose = addUserSession(imedx); // validates; throws on a bad shape
      navigation.replace('DoseDetail', { id: dose.id });
    } catch (e) {
      setError(e && e.name === 'AbortError' ? 'The generator took too long. Try again.' : (e && e.message) || 'Something went wrong. Try again.');
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* soft nebula glows */}
      <View pointerEvents="none" style={[styles.glowBlob, { top: -60, left: -40, backgroundColor: 'rgba(124,58,237,0.22)' }]} />
      <View pointerEvents="none" style={[styles.glowBlob, { top: 120, right: -70, backgroundColor: 'rgba(59,130,246,0.18)' }]} />
      <View pointerEvents="none" style={[styles.glowBlob, { bottom: -50, left: 30, backgroundColor: 'rgba(245,158,11,0.14)' }]} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.orbWrap}>
          <Animated.View style={[styles.orb, { transform: [{ scale: orbScale }], opacity: orbOpacity }]} />
          <Text style={styles.orbGlyph}>{busy ? '🔮' : '✨'}</Text>
        </View>

        <Text style={styles.title}>Conjure a session</Text>
        <Text style={styles.sub}>
          Name a goal and a length — or give it something abstract: an emotion, a medicine, a place, a food,
          a memory. It listens for the essence and turns it into sound.
        </Text>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="the hush after snowfall · a bright clean focus · lavender · homecoming…"
          placeholderTextColor={COLORS.textMuted}
          multiline
          editable={!busy}
          textAlignVertical="top"
        />

        <View style={styles.chips}>
          {SEEDS.map(s => (
            <TouchableOpacity key={s} style={styles.chip} onPress={() => setText(s)} disabled={busy} activeOpacity={0.7}>
              <Text style={styles.chipTxt}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, (!text.trim() || busy) && styles.btnDisabled]}
          onPress={generate}
          disabled={!text.trim() || busy}
          activeOpacity={0.85}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>✨  Compose</Text>}
        </TouchableOpacity>
        {busy ? <Text style={styles.hint}>Translating essence into sound…</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080611' },
  glowBlob: { position: 'absolute', width: 240, height: 240, borderRadius: 120 },
  content: { padding: 20, paddingTop: 8 },
  orbWrap: { alignItems: 'center', justifyContent: 'center', height: 120, marginBottom: 4 },
  orb: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(139,92,246,0.5)' },
  orbGlyph: { fontSize: 42 },
  title: { color: '#F3EEFF', fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  sub: { color: '#B9AED6', fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 18, paddingHorizontal: 6 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)', color: COLORS.textPrimary, borderRadius: 16, padding: 15,
    fontSize: 15, minHeight: 110, lineHeight: 22, borderWidth: 1, borderColor: 'rgba(139,92,246,0.35)',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' },
  chip: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  chipTxt: { color: '#CFC6EA', fontSize: 12.5 },
  error: { color: COLORS.accentOrange, fontSize: 13, marginTop: 16, textAlign: 'center' },
  btn: { backgroundColor: '#7C3AED', borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 22, shadowColor: '#7C3AED', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  btnDisabled: { opacity: 0.45 },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  hint: { color: '#9A8FBE', fontSize: 12, textAlign: 'center', marginTop: 12 },
});
