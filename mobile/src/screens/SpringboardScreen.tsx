import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { categoryCards } from '../catalog/data';
import { useUserSessions, USER_CATEGORY } from '../catalog/userSessions';
import { useSettings } from '../settings/SettingsProvider';
import { useSessions } from '../wellness/SessionsProvider';
import SpringboardCard from '../components/SpringboardCard';
import WeeklyTracker from '../components/WeeklyTracker';

export default function SpringboardScreen({ navigation }) {
  const cats = categoryCards();
  const userSessions = useUserSessions();
  const settings = useSettings();
  const sessions = useSessions();
  const name = (settings && settings.name && settings.name.trim()) || '';
  const complete = sessions && sessions.todayComplete;
  const greeting = complete
    ? name ? `Nice work, ${name} — today's goal is done ✓` : "Today's goal is done ✓"
    : name ? `Welcome back, ${name}` : 'Welcome back';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>{greeting}</Text>
      <WeeklyTracker />
      <Text style={styles.h2}>Modes</Text>
      <View style={styles.row}>
        <SpringboardCard
          title="Manual"
          subtitle="Frequency · noise · Pulsetto"
          accent={COLORS.accentBlue}
          onPress={() => navigation.navigate('Manual')}
        />
        <View style={{ width: 12 }} />
        <SpringboardCard
          title="Field Meditation"
          subtitle="Feel around the field · Lightpad"
          accent={COLORS.accentGreen}
          onPress={() => navigation.navigate('Field')}
        />
      </View>
      <View style={styles.row}>
        <SpringboardCard
          title="AI Session"
          subtitle="Prompt → program"
          accent={COLORS.accentOrange}
          onPress={() => navigation.navigate('Ai')}
        />
        <View style={{ width: 12 }} />
        {userSessions.length > 0 ? (
          <SpringboardCard
            title={USER_CATEGORY}
            subtitle={`${userSessions.length} session${userSessions.length === 1 ? '' : 's'}`}
            accent={COLORS.accentBlueLight}
            onPress={() => navigation.navigate('Category', { category: USER_CATEGORY })}
          />
        ) : (
          <View style={{ flex: 1 }} />
        )}
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
  greeting: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 12 },
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
