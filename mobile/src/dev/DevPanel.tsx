import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme';
import { useSettings } from '../settings/SettingsProvider';
import { useNova } from '../nova/NovaProvider';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import { useLightpad } from '../lightpad/LightpadProvider';

// A single, app-wide developer panel docked to the bottom of every screen. It's
// collapsed to a thin bar by default and only exists when Developer mode is on.
// The bar always shows global device connections; the active screen can register
// richer diagnostics via the hooks below.
//
// Layout: the COLLAPSED bar reserves its height as bottom padding on the app
// content (via <DevContentInset>), so it never hides a screen's bottom controls.
// The EXPANDED body overlays upward on top of content — that's fine, it's transient.
//
// The screen-registered content lives in a REF-backed store (not provider state) so
// a screen pushing updates several times a second re-renders only the panel.
const Ctx = createContext(null);
export const useDevPanel = () => useContext(Ctx);

export function DevPanelProvider({ children }) {
  const apiRef = useRef(null);
  const [barHeight, setBarHeight] = useState(0);
  if (!apiRef.current) {
    const store: any = { content: null, listeners: new Set() };
    apiRef.current = {
      setContent(node) { store.content = node || null; store.listeners.forEach(l => l()); },
      getContent() { return store.content; },
      subscribe(l) { store.listeners.add(l); return () => store.listeners.delete(l); },
    };
  }
  const value = { ...apiRef.current, barHeight, setBarHeight };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Wrap the app content: reserves the collapsed bar's height at the bottom when
// devMode is on, so the bar sits below the content instead of over it.
export function DevContentInset({ children }) {
  const settings = useSettings();
  const ctx = useDevPanel();
  const pad = settings && settings.devMode && ctx ? ctx.barHeight : 0;
  return <View style={{ flex: 1, paddingBottom: pad }}>{children}</View>;
}

// Register a rich diagnostics node (may include buttons). Cleared on unmount.
export function useDevPanelContent(node, deps) {
  const ctx = useDevPanel();
  useEffect(() => {
    if (!ctx) return;
    ctx.setContent(node || null);
    return () => ctx.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Convenience: register a list of plain diagnostic lines.
export function useDevLines(lines, deps) {
  const node = lines
    ? <View>{lines.map((l, i) => <Text key={i} style={styles.line}>{l}</Text>)}</View>
    : null;
  useDevPanelContent(node, deps);
}

export function DevPanel() {
  const settings = useSettings();
  const ctx = useDevPanel();
  const insets = useSafeAreaInsets();
  const nova = useNova();
  const pulsetto = usePulsetto();
  const lightpad = useLightpad();
  const [expanded, setExpanded] = useState(false);
  const [, force] = useState(0);
  useEffect(() => (ctx ? ctx.subscribe(() => force(n => n + 1)) : undefined), [ctx]);
  // Release the reserved inset when devMode turns off / unmounts.
  useEffect(() => {
    const off = !(settings && settings.devMode);
    if (off && ctx && ctx.barHeight !== 0) ctx.setBarHeight(0);
  });
  if (!settings || !settings.devMode || !ctx) return null;
  const content = ctx.getContent();
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {expanded ? (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
          {content || <Text style={styles.dim}>No screen diagnostics.</Text>}
        </ScrollView>
      ) : null}
      <TouchableOpacity
        style={[styles.bar, { paddingBottom: 7 + insets.bottom }]}
        onLayout={e => ctx.setBarHeight(e.nativeEvent.layout.height)}
        onPress={() => setExpanded(x => !x)}
        activeOpacity={0.8}
      >
        <Text style={styles.barTxt}>
          🛠 dev · nova {nova?.connected ? 'on' : 'off'} · stim {pulsetto?.connected ? 'on' : 'off'} · pad {lightpad?.connected ? 'on' : 'off'}
        </Text>
        <Text style={styles.barChevron}>{expanded ? '▾' : '▴'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 9999 },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(6,10,16,0.97)', borderTopWidth: 1, borderTopColor: '#1D2836',
    paddingHorizontal: 12, paddingTop: 7,
  },
  barTxt: { color: '#8FE3C2', fontSize: 11, fontFamily: 'Courier', fontWeight: '700' },
  barChevron: { color: COLORS.textMuted, fontSize: 12 },
  body: { maxHeight: 220, backgroundColor: 'rgba(4,8,14,0.98)', borderTopWidth: 1, borderTopColor: '#1D2836' },
  bodyInner: { padding: 10 },
  line: { color: '#8FE3C2', fontSize: 11, lineHeight: 16, fontFamily: 'Courier' },
  dim: { color: COLORS.textMuted, fontSize: 11, fontStyle: 'italic' },
});
