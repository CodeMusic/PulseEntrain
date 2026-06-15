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
} from 'react-native';
import { COLORS } from '../theme';
import { CATEGORIES } from '../catalog/data';

const PANEL_WIDTH = 290;
const MenuContext = createContext(null);
export const useMenu = () => useContext(MenuContext);

export function MenuProvider({ children, navigationRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const go = (screen, params) => {
    setIsOpen(false);
    if (navigationRef.isReady()) navigationRef.navigate(screen, params);
  };

  return (
    <MenuContext.Provider value={{ isOpen, open, close }}>
      {children}
      <Flyout isOpen={isOpen} close={close} go={go} />
    </MenuContext.Provider>
  );
}

function Flyout({ isOpen, close, go }) {
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  useEffect(() => {
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
      <Animated.View style={[styles.panel, { transform: [{ translateX: slide }] }]}>
        <Text style={styles.brand}>PulseEntrain</Text>
        <Item label="Home" onPress={() => go('Springboard')} />
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

const Item = ({ label, onPress, small }) => (
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
});
