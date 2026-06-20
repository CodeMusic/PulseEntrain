import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Animated,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { COLORS } from '../theme';
import { CATEGORIES } from '../catalog/data';
import { registerImportedDose } from '../catalog/importDose';
import { pickImedxFile } from '../catalog/pickImedx';
import { useNav } from '../oneNav';

const PANEL_WIDTH = 290;
const MenuContext = createContext(null);
export const useMenu = () => useContext(MenuContext);

export function MenuProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const nav = useNav();
  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const go = (screen, params) => {
    setIsOpen(false);
    nav.navigate(screen, params);
  };

  return (
    <MenuContext.Provider value={{ isOpen, open, close }}>
      {children}
      <Flyout isOpen={isOpen} close={close} go={go} />
    </MenuContext.Provider>
  );
}

const IS_WEB = Platform.OS === 'web';

function Flyout({ isOpen, close, go }) {
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;

  // Open a saved .imedx and play it. pickImedxFile() clicks the file input
  // synchronously (within the tap gesture), so the dialog is allowed on web.
  const openFile = async () => {
    try {
      const picked = await pickImedxFile();
      if (!picked) return close();
      const dose = registerImportedDose(picked.json);
      go('Player', { id: dose.id, usePulsetto: false, useNova: false });
    } catch (e) {
      close();
      Alert.alert("Couldn't open that file", (e && e.message) || 'Unknown error.');
    }
  };
  useEffect(() => {
    // Native: slide the panel in. Web: RNW's JS-driven Animated transform is
    // unreliable here, so the panel renders statically (the Modal's fade covers
    // the entrance). The panel only mounts while open, so a static position is
    // correct.
    if (IS_WEB) return;
    Animated.timing(slide, {
      toValue: isOpen ? 0 : -PANEL_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isOpen, slide]);

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
      <TouchableWithoutFeedback onPress={close}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.panel, { transform: [{ translateX: IS_WEB ? 0 : slide }] }]}>
        <Text style={styles.brand}>PulseEntrain</Text>
        <Item label="Home" onPress={() => go('Springboard')} />
        <Item label="Open a file" onPress={openFile} />
        {IS_WEB ? <Item label="Studio (web)" onPress={() => go('Studio')} /> : null}
        <Item label="About" onPress={() => go('About')} />
        <Text style={styles.section}>Programs</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {CATEGORIES.map(c => (
            <Item key={c} label={c} small onPress={() => go('Category', { category: c })} />
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const Item = ({ label, onPress, small }: any) => (
  <TouchableOpacity onPress={onPress} style={styles.item} activeOpacity={0.7}>
    <Text style={[styles.itemTxt, small && styles.itemSmall]}>{label}</Text>
  </TouchableOpacity>
);

export function HeaderMenuButton() {
  const menu = useMenu();
  return (
    <TouchableOpacity onPress={() => menu && menu.open()} hitSlop={12} style={styles.headerBtn}>
      <Text style={styles.headerIcon}>≡</Text>
    </TouchableOpacity>
  );
}

// Center header title: shows the screen's title (default "PulseEntrain"); tapping
// it returns Home. Used as the Stack's `headerTitle`.
export function HeaderTitle({ children }: any) {
  const nav = useNav();
  return (
    <TouchableOpacity onPress={() => nav.navigate('Springboard')} hitSlop={10}>
      <Text style={styles.headerTitle}>{children || 'PulseEntrain'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: COLORS.bgCard,
    paddingTop: 64,
    paddingHorizontal: 22,
    paddingBottom: 24,
  },
  brand: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 18 },
  section: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 6,
  },
  item: { paddingVertical: 12 },
  itemTxt: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '600' },
  itemSmall: { fontSize: 16, fontWeight: '500', color: COLORS.textSecondary },
  headerBtn: { paddingHorizontal: 6 },
  headerIcon: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '700' },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
});
