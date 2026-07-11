import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Keyboard } from 'react-native';
import { COLORS } from '../theme';
import { IMEDX_SYSTEM_PROMPT, extractImedx } from '../catalog/imedxSpec';
import { addUserSession } from '../catalog/userSessions';

const ENDPOINT = 'https://n8n.codemusic.ca/webhook/pulseentrain';

const EXAMPLES = [
  'A 20-minute wind-down from a busy mind into deep sleep.',
  'Focused alpha for an hour of deep work, no drowsiness.',
  'A short theta journey for a creative brainstorm.',
  'Gentle delta for an afternoon nap that leaves me clear.',
];

export default function AiSessionScreen({ navigation }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Describe your session</Text>
      <Text style={styles.sub}>
        Say what you want to feel and how long — the generator composes a binaural program and saves it to
        My Sessions.
      </Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="e.g. Ease me from a racing mind into deep sleep over 25 minutes…"
        placeholderTextColor={COLORS.textMuted}
        multiline
        editable={!busy}
        textAlignVertical="top"
      />

      <View style={styles.chips}>
        {EXAMPLES.map(ex => (
          <TouchableOpacity key={ex} style={styles.chip} onPress={() => setText(ex)} disabled={busy} activeOpacity={0.7}>
            <Text style={styles.chipTxt}>{ex}</Text>
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
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Generate session</Text>}
      </TouchableOpacity>
      {busy ? <Text style={styles.hint}>Composing your program…</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16 },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  sub: { color: COLORS.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  input: {
    backgroundColor: COLORS.bgCard, color: COLORS.textPrimary, borderRadius: 14, padding: 14,
    fontSize: 15, minHeight: 120, lineHeight: 21,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { backgroundColor: COLORS.bgCardLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipTxt: { color: COLORS.textSecondary, fontSize: 12 },
  error: { color: COLORS.accentOrange, fontSize: 13, marginTop: 14 },
  btn: { backgroundColor: COLORS.accentBlue, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
