import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, SafeAreaView, StyleSheet } from 'react-native';
import { COLORS } from '../theme';
import { useSessions } from '../wellness/SessionsProvider';

// Home-screen weekly goal tracker: a Mon..Sun row of day circles (✓ when the
// day's goal is met, today's count otherwise), and a tap-through to set the goal
// + browse session history. Reads the shared SessionsProvider, so a session
// finished anywhere (e.g. a Manual timer run) shows up here as a check.
const formatSessionDate = iso => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (same(d, today)) return `Today, ${time}`;
  if (same(d, yest)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
};
const formatDuration = sec => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
};

export default function WeeklyTracker() {
  const ss = useSessions();
  const [open, setOpen] = useState(false);
  if (!ss) return null;
  const { weekDays, dailyGoal, setDailyGoal, sessions, deleteSession, clearAllSessions } = ss;

  return (
    <>
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => setOpen(true)}>
        <View style={styles.row}>
          {weekDays.map((d, i) => (
            <View key={i} style={styles.dayItem}>
              <Text style={[styles.dayLabel, d.isToday && styles.dayLabelToday]}>{d.label}</Text>
              <View
                style={[
                  styles.circle,
                  d.complete && styles.circleComplete,
                  !d.complete && d.isToday && styles.circleToday,
                  !d.complete && !d.isToday && !d.isFuture && styles.circleMissed,
                ]}>
                {d.complete ? (
                  <Text style={styles.check}>✓</Text>
                ) : d.isToday ? (
                  <Text style={styles.count}>{d.count}</Text>
                ) : d.isFuture ? null : (
                  <Text style={styles.x}>✕</Text>
                )}
              </View>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>
          {dailyGoal} session{dailyGoal === 1 ? '' : 's'} a day completes it · tap for history
        </Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Daily goal &amp; history</Text>
            <TouchableOpacity onPress={() => setOpen(false)}><Text style={styles.done}>Done</Text></TouchableOpacity>
          </View>

          <View style={styles.goalCard}>
            <Text style={styles.goalLabel}>Sessions per day</Text>
            <View style={styles.goalRow}>
              <TouchableOpacity style={styles.goalBtn} onPress={() => setDailyGoal(Math.max(1, dailyGoal - 1))}>
                <Text style={styles.goalBtnTxt}>−</Text>
              </TouchableOpacity>
              <View style={styles.goalBadge}><Text style={styles.goalVal}>{dailyGoal}</Text></View>
              <TouchableOpacity style={styles.goalBtn} onPress={() => setDailyGoal(Math.min(20, dailyGoal + 1))}>
                <Text style={styles.goalBtnTxt}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.listHead}>
            <Text style={styles.listTitle}>All sessions ({sessions.length})</Text>
            {sessions.length > 0 ? (
              <TouchableOpacity onPress={clearAllSessions}><Text style={styles.clear}>Clear all</Text></TouchableOpacity>
            ) : null}
          </View>
          {sessions.length === 0 ? (
            <Text style={styles.empty}>No sessions yet — finish a Manual session to log one.</Text>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(it, idx) => `${it.startTime}-${idx}`}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.logRow} activeOpacity={0.7} onLongPress={() => deleteSession(item.startTime)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logDate}>{formatSessionDate(item.startTime)}</Text>
                    <Text style={styles.logDetail}>
                      {formatDuration(item.actualSeconds)} / {formatDuration(item.plannedSeconds)}
                      {item.kind ? ` · ${item.kind}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.logBadge, item.completed && styles.logBadgeOk]}>{item.completed ? '✓' : '·'}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
          )}
          {sessions.length > 0 ? <Text style={styles.footHint}>Long-press a session to delete it.</Text> : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 16, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayItem: { alignItems: 'center', flex: 1 },
  dayLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, marginBottom: 6, letterSpacing: 0.5 },
  dayLabelToday: { color: COLORS.accentBlueLight },
  circle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.divider, alignItems: 'center', justifyContent: 'center' },
  circleComplete: { backgroundColor: COLORS.accentGreen, borderColor: COLORS.accentGreen },
  circleToday: { borderColor: COLORS.accentBlueLight, borderWidth: 2 },
  circleMissed: { borderColor: COLORS.accentRed },
  check: { color: '#fff', fontSize: 16, fontWeight: '700' },
  count: { color: COLORS.accentBlueLight, fontSize: 14, fontWeight: '700' },
  x: { color: COLORS.accentRed, fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 12 },
  modal: { flex: 1, backgroundColor: COLORS.bgDark },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  modalTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  done: { color: COLORS.accentBlueLight, fontSize: 16, fontWeight: '600' },
  goalCard: { backgroundColor: COLORS.bgCard, borderRadius: 16, padding: 18, margin: 16 },
  goalLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  goalBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: COLORS.bgCardLight, alignItems: 'center', justifyContent: 'center' },
  goalBtnTxt: { color: COLORS.textPrimary, fontSize: 26, fontWeight: '300' },
  goalBadge: { backgroundColor: COLORS.accentBlue, paddingHorizontal: 22, paddingVertical: 8, borderRadius: 20, marginHorizontal: 18, minWidth: 64, alignItems: 'center' },
  goalVal: { color: '#fff', fontSize: 24, fontWeight: '700' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  listTitle: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  clear: { color: COLORS.accentRed, fontSize: 14, fontWeight: '600' },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 30 },
  logRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgCard, borderRadius: 12, padding: 14 },
  logDate: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },
  logDetail: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  logBadge: { color: COLORS.textMuted, fontSize: 16, fontWeight: '700', width: 28, textAlign: 'center' },
  logBadgeOk: { color: COLORS.accentGreen },
  footHint: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
});
