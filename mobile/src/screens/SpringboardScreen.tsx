import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { categoryCards } from '../catalog/data';
import SpringboardCard from '../components/SpringboardCard';

export default function SpringboardScreen({ navigation }) {
  const cats = categoryCards();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.h2}>Modes</Text>
      <View style={styles.row}>
        <SpringboardCard
          title="Manual"
          subtitle="Frequency · noise · Pulsetto"
          accent={COLORS.accentBlue}
          onPress={() => navigation.navigate('Manual')}
        />
        <View style={{ width: 12 }} />
        <SpringboardCard title="AI Session" subtitle="Prompt → program" disabled />
      </View>

      <Text style={styles.h2}>Programs</Text>
      <View style={styles.grid}>
        {cats.map(c => (
          <View key={c.name} style={styles.gridItem}>
            <SpringboardCard
              title={c.name}
              subtitle={`${c.count} program${c.count === 1 ? '' : 's'}`}
              imageName={c.image}
              onPress={() => navigation.navigate('Category', { category: c.name })}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16 },
  h2: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: { flexDirection: 'row', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  gridItem: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
});
