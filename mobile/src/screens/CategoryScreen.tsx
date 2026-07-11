import React from 'react';
import { FlatList, Text, Alert, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { dosesByCategory } from '../catalog/data';
import { useUserSessions, USER_CATEGORY, removeUserSession } from '../catalog/userSessions';
import DoseCard from '../components/DoseCard';
import SwipeableDoseRow from '../components/SwipeableDoseRow';

export default function CategoryScreen({ route, navigation }) {
  const { category } = route.params;
  const userSessions = useUserSessions(); // subscribes so deletes/adds re-render
  const mine = category === USER_CATEGORY;
  const doses = mine ? userSessions : dosesByCategory(category);

  const confirmDelete = dose =>
    Alert.alert('Delete this session?', `"${dose.name}" will be removed from My Sessions.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeUserSession(dose.id) },
    ]);

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={doses}
      keyExtractor={d => d.id}
      renderItem={({ item }) => {
        const card = <DoseCard dose={item} onPress={() => navigation.navigate('DoseDetail', { id: item.id })} />;
        return mine ? <SwipeableDoseRow onDelete={() => confirmDelete(item)}>{card}</SwipeableDoseRow> : card;
      }}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {mine ? 'No sessions yet — make one from AI Session or save one from Studio.' : 'No programs in this category.'}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40, lineHeight: 20 },
});
