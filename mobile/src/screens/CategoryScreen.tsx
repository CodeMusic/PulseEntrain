import React from 'react';
import { FlatList, Text, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { dosesByCategory } from '../catalog/data';
import { useUserSessions, USER_CATEGORY } from '../catalog/userSessions';
import DoseCard from '../components/DoseCard';

export default function CategoryScreen({ route, navigation }) {
  const { category } = route.params;
  const userSessions = useUserSessions(); // subscribes so deletes/adds re-render
  const doses = category === USER_CATEGORY ? userSessions : dosesByCategory(category);
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={doses}
      keyExtractor={d => d.id}
      renderItem={({ item }) => (
        <DoseCard dose={item} onPress={() => navigation.navigate('DoseDetail', { id: item.id })} />
      )}
      ListEmptyComponent={<Text style={styles.empty}>No programs in this category.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgDark },
  content: { padding: 16 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
});
