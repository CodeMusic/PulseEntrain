import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  useColorScheme,
  Platform,
  Alert,
  ActivityIndicator,
  AppState,
  SafeAreaView,
  StatusBar,
  Modal,
  ScrollView,
  FlatList,
} from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import KeepAwake from 'react-native-keep-awake';
import { usePulsetto } from '../pulsetto/PulsettoProvider';
import BinauralPanel from '../components/BinauralPanel';

// BLE (manager, UUIDs, voltages, intervals) now lives in
// src/pulsetto/PulsettoProvider.js — a single BLE owner shared app-wide.

// Persistent storage keys
const STORAGE_KEY_STRENGTH = '@pulselibre/strength';
const STORAGE_KEY_TIMER = '@pulselibre/timer';
const STORAGE_KEY_SESSIONS = '@pulselibre/sessions';
const STORAGE_KEY_DAILY_GOAL = '@pulselibre/dailyGoal';
const DEFAULT_DAILY_GOAL = 2;
// Minimum runtime (seconds) for a session to count toward the daily goal
const MIN_COUNTING_SECONDS = 60;
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];


// Helper: start of week (Monday) at 00:00 for the given date
const startOfWeekMonday = date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay(); // 0=Sun .. 6=Sat
  const offset = (dayOfWeek + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - offset);
  return d;
};

const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const countSessionsOnDay = (sessions, day) => {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return sessions.filter(s => {
    const t = new Date(s.startTime);
    return t >= start && t < end && (s.actualSeconds ?? 0) >= MIN_COUNTING_SECONDS;
  }).length;
};

const formatSessionDate = iso => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (isSameDay(d, today)) return `Today, ${timeStr}`;
  if (isSameDay(d, yesterday)) return `Yesterday, ${timeStr}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${timeStr}`;
};

const formatDuration = seconds => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
};

const ManualScreen = () => {
  // State Variables
  const [timer, setTimer] = useState(10); // Timer in minutes
  const [strength, setStrength] = useState(5); // Default strength
  const [isRunning, setIsRunning] = useState(false); // Timer running state
  const [remainingTime, setRemainingTime] = useState(0); // Remaining time in seconds
  const [appState, setAppState] = useState(AppState.currentState);

  // Session log + daily goal
  const [sessions, setSessions] = useState([]);
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  const [showLogs, setShowLogs] = useState(false);
  const [tab, setTab] = useState('pulsetto'); // 'pulsetto' | 'binaural'
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Reference for intervals to allow clearing
  const intervalRef = useRef(null);
  const sessionStartRef = useRef(null);

  // Pulsetto BLE is owned by the shared provider (single BLE manager app-wide).
  const {
    connectedDevice,
    battery,
    charging,
    scanning,
    scanForDevices,
    startSession,
    stopSession,
    setIntensity,
  } = usePulsetto();

  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const backgroundColor = isDarkMode ? '#0F1419' : '#F3F4F6';
  const styles = getStyles(isDarkMode);

  // Load persisted preferences and session log on mount
  useEffect(() => {
    (async () => {
      try {
        const [sStrength, sTimer, sSessions, sGoal] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_STRENGTH),
          AsyncStorage.getItem(STORAGE_KEY_TIMER),
          AsyncStorage.getItem(STORAGE_KEY_SESSIONS),
          AsyncStorage.getItem(STORAGE_KEY_DAILY_GOAL),
        ]);
        if (sStrength !== null) {
          const v = parseInt(sStrength, 10);
          if (Number.isFinite(v) && v >= 1 && v <= 9) setStrength(v);
        }
        if (sTimer !== null) {
          const v = parseInt(sTimer, 10);
          if (Number.isFinite(v) && v >= 1) setTimer(v);
        }
        if (sSessions !== null) {
          const parsed = JSON.parse(sSessions);
          if (Array.isArray(parsed)) setSessions(parsed);
        }
        if (sGoal !== null) {
          const v = parseInt(sGoal, 10);
          if (Number.isFinite(v) && v >= 1) setDailyGoal(v);
        }
      } catch (e) {
        console.error('Failed to load preferences:', e);
      } finally {
        setPrefsLoaded(true);
      }
    })();
  }, []);

  // Persist strength whenever it changes (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    AsyncStorage.setItem(STORAGE_KEY_STRENGTH, String(strength)).catch(e =>
      console.error('Failed to persist strength:', e)
    );
  }, [strength, prefsLoaded]);

  // Persist timer whenever it changes (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    AsyncStorage.setItem(STORAGE_KEY_TIMER, String(timer)).catch(e =>
      console.error('Failed to persist timer:', e)
    );
  }, [timer, prefsLoaded]);

  // Persist daily goal whenever it changes (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    AsyncStorage.setItem(STORAGE_KEY_DAILY_GOAL, String(dailyGoal)).catch(e =>
      console.error('Failed to persist daily goal:', e)
    );
  }, [dailyGoal, prefsLoaded]);

  // Persist sessions whenever they change (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    AsyncStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions)).catch(e =>
      console.error('Failed to persist sessions:', e)
    );
  }, [sessions, prefsLoaded]);


  // Keep screen awake while running
  useEffect(() => {
    if (isRunning) {
      KeepAwake.activate();
      console.log('Screen wake lock activated');
    } else {
      KeepAwake.deactivate();
      console.log('Screen wake lock deactivated');
    }

    return () => {
      KeepAwake.deactivate();
    };
  }, [isRunning]);


  // Handle Start Button Press
  const handleStart = async () => {
    if (!connectedDevice) {
      console.log('Cannot start - device not connected');
      return;
    }

    sessionStartRef.current = {
      time: Date.now(),
      plannedSeconds: timer * 60,
      strength,
    };
    setIsRunning(true);
    setRemainingTime(timer * 60); // Set remaining time in seconds

    // The provider runs the full ramp sequence + keepalive + fast polling.
    await startSession(strength);
  };

  // Handle Stop Button Press
  const handleStop = async () => {
    console.log('Stop button pressed.');
    // Log the session before clearing state
    if (sessionStartRef.current) {
      const { time: startMs, plannedSeconds, strength: usedStrength } = sessionStartRef.current;
      const elapsedMs = Date.now() - startMs;
      const actualSeconds = Math.max(0, Math.min(plannedSeconds, Math.round(elapsedMs / 1000)));
      const completed = actualSeconds >= plannedSeconds - 1;
      const newSession = {
        startTime: new Date(startMs).toISOString(),
        plannedSeconds,
        actualSeconds,
        strength: usedStrength,
        completed,
      };
      console.log('Logging session:', newSession);
      setSessions(prev => [newSession, ...prev]);
      sessionStartRef.current = null;
    }

    setIsRunning(false);
    setRemainingTime(0); // Reset remaining time

    // The provider runs the stop sequence and returns to idle polling.
    await stopSession();
  };

  // Implement countdown timer
  useEffect(() => {
    if (isRunning && remainingTime > 0) {
      console.log(`Timer started: ${remainingTime} seconds remaining.`);
      intervalRef.current = setInterval(() => {
        setRemainingTime(prevTime => {
          if (prevTime <= 1) {
            clearInterval(intervalRef.current);
            console.log('Timer ended.');
            handleStop(); // Automatically stop when timer reaches zero
            return 0;
          }
          return prevTime - 1;
        });
      }, 1000); // Decrement every second
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  // Handle Strength Change
  const handleStrengthChange = async value => {
    setStrength(value);
    console.log(`Strength slider changed to: ${value}`);

    if (isRunning && connectedDevice) {
      await setIntensity(value); // Update strength on the device
    }
  };

  // Format remaining time as MM:SS
  const formatTime = seconds => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Timer Handlers should be defined before the return statement
  const increaseTimer = () => {
    setTimer(prev => prev + 1);
    console.log(`Timer increased to ${timer + 1} minutes.`);
  };

  const decreaseTimer = () => {
    setTimer(prev => Math.max(1, prev - 1));
    console.log(`Timer decreased to ${Math.max(1, timer - 1)} minutes.`);
  };

  // Build week view data (Mon..Sun) — derived from sessions/dailyGoal
  const today = new Date();
  const weekStart = startOfWeekMonday(today);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const count = countSessionsOnDay(sessions, d);
    return {
      date: d,
      label: DAY_LABELS[i],
      count,
      isToday: isSameDay(d, today),
      isFuture: d > todayMidnight,
      complete: count >= dailyGoal,
    };
  });

  const clearAllSessions = () => {
    Alert.alert(
      'Clear All Sessions?',
      'This will permanently delete the entire session history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => setSessions([]),
        },
      ]
    );
  };

  const deleteSession = startTime => {
    Alert.alert('Delete Session?', 'Remove this session from the log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => setSessions(prev => prev.filter(s => s.startTime !== startTime)),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={backgroundColor}
        translucent={Platform.OS === 'ios'}
      />
      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Connection</Text>
          <View style={styles.connectionIndicator}>
            <View style={[styles.dot, connectedDevice ? styles.dotConnected : styles.dotDisconnected]} />
            <Text style={styles.statusValue}>
              {connectedDevice ? 'Connected' : 'Disconnected'}
            </Text>
          </View>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Battery</Text>
          <Text style={styles.statusValue}>
            {battery !== null ? `${battery}%` : '--'}
          </Text>
        </View>
        <View style={styles.statusDivider} />
        <View style={styles.statusItem}>
          <Text style={styles.statusLabel}>Charging</Text>
          <Text style={styles.statusValue}>
            {charging !== null ? (charging === 'Charging' ? '⚡' : '○') : '--'}
          </Text>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.mainScroll}
        contentContainerStyle={styles.mainContent}
        showsVerticalScrollIndicator={false}
      >
        {/* mode tabs */}
        <View style={styles.segmented}>
          <TouchableOpacity
            onPress={() => setTab('pulsetto')}
            style={[styles.segBtn, tab === 'pulsetto' && styles.segBtnActive]}
          >
            <Text style={[styles.segTxt, tab === 'pulsetto' && styles.segTxtActive]}>Pulsetto</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTab('binaural')}
            style={[styles.segBtn, tab === 'binaural' && styles.segBtnActive]}
          >
            <Text style={[styles.segTxt, tab === 'binaural' && styles.segTxtActive]}>Binaural</Text>
          </TouchableOpacity>
        </View>

        {tab === 'binaural' ? (
          <BinauralPanel />
        ) : (
          <>
        {/* Weekly Tracker */}
        <View style={styles.weekCard}>
          <View style={styles.weekRow}>
            {weekDays.map((d, i) => (
              <View key={i} style={styles.weekDayItem}>
                <Text style={[styles.weekDayLabel, d.isToday && styles.weekDayLabelToday]}>
                  {d.label}
                </Text>
                <View
                  style={[
                    styles.weekDayCircle,
                    d.complete && styles.weekDayCircleComplete,
                    !d.complete && d.isToday && styles.weekDayCircleToday,
                    !d.complete && !d.isToday && !d.isFuture && styles.weekDayCircleMissed,
                  ]}
                >
                  {d.complete ? (
                    <Text style={styles.weekDayCheck}>✓</Text>
                  ) : d.isToday ? (
                    <Text style={styles.weekDayCount}>{d.count}</Text>
                  ) : d.isFuture ? null : (
                    <Text style={styles.weekDayX}>✕</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.weekHint}>
            Use Pulsetto {dailyGoal} {dailyGoal === 1 ? 'time' : 'times'} to mark your day as complete.
          </Text>
        </View>

        {/* Timer Display */}
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>Session Timer</Text>
          <View style={styles.timerDisplay}>
            <TouchableOpacity
              style={styles.timerButton}
              onPress={decreaseTimer}
              disabled={isRunning}
            >
              <Text style={[styles.timerButtonText, isRunning && styles.timerButtonDisabled]}>−</Text>
            </TouchableOpacity>
            <View style={styles.timerTextContainer}>
              <Text style={styles.timerText}>
                {formatTime(remainingTime > 0 ? remainingTime : timer * 60)}
              </Text>
              {isRunning && remainingTime > 0 && (
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${(remainingTime / (timer * 60)) * 100}%` }
                    ]}
                  />
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.timerButton}
              onPress={increaseTimer}
              disabled={isRunning}
            >
              <Text style={[styles.timerButtonText, isRunning && styles.timerButtonDisabled]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Strength Control */}
        <View style={styles.strengthCard}>
          <Text style={styles.strengthLabel}>Intensity Level</Text>
          <View style={styles.strengthDisplay}>
            <TouchableOpacity
              style={styles.strengthButton}
              onPress={() => handleStrengthChange(Math.max(1, strength - 1))}
            >
              <Text style={styles.strengthButtonText}>−</Text>
            </TouchableOpacity>
            <View style={styles.strengthBadge}>
              <Text style={styles.strengthValue}>{strength}</Text>
            </View>
            <TouchableOpacity
              style={styles.strengthButton}
              onPress={() => handleStrengthChange(Math.min(9, strength + 1))}
            >
              <Text style={styles.strengthButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderMinMax}>1</Text>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={9}
              step={1}
              value={strength}
              onValueChange={handleStrengthChange}
              minimumTrackTintColor={isDarkMode ? '#4A90E2' : '#2563EB'}
              maximumTrackTintColor={isDarkMode ? '#374151' : '#D1D5DB'}
              thumbTintColor={isDarkMode ? '#60A5FA' : '#3B82F6'}
            />
            <Text style={styles.sliderMinMax}>9</Text>
          </View>
        </View>

        {/* Control Buttons */}
        <View style={styles.controlsContainer}>
          {connectedDevice ? (
            <TouchableOpacity
              style={[
                styles.mainButton,
                isRunning ? styles.stopButton : styles.startButton
              ]}
              onPress={isRunning ? handleStop : handleStart}
            >
              <Text style={styles.mainButtonText}>
                {isRunning ? '■ Stop' : '▶ Start'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.mainButton, styles.scanButton, scanning && styles.scanningButton]}
              onPress={scanForDevices}
              disabled={scanning}
            >
              {scanning ? (
                <>
                  <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonSpinner} />
                  <Text style={styles.mainButtonText}>Scanning...</Text>
                </>
              ) : (
                <Text style={styles.mainButtonText}>📡 Scan for Device</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.logsButton}
            onPress={() => setShowLogs(true)}
          >
            <Text style={styles.logsButtonText}>
              📋 Session History{sessions.length > 0 ? ` (${sessions.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
          </>
        )}
      </ScrollView>

      {/* Session History Modal */}
      <Modal
        visible={showLogs}
        animationType="slide"
        onRequestClose={() => setShowLogs(false)}
      >
        <SafeAreaView style={styles.container}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Session History</Text>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowLogs(false)}
            >
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.goalCard}>
            <Text style={styles.goalLabel}>Daily Goal</Text>
            <Text style={styles.goalSubLabel}>
              Sessions per day to mark complete
            </Text>
            <View style={styles.goalRow}>
              <TouchableOpacity
                style={styles.goalButton}
                onPress={() => setDailyGoal(prev => Math.max(1, prev - 1))}
              >
                <Text style={styles.goalButtonText}>−</Text>
              </TouchableOpacity>
              <View style={styles.goalBadge}>
                <Text style={styles.goalValue}>{dailyGoal}</Text>
              </View>
              <TouchableOpacity
                style={styles.goalButton}
                onPress={() => setDailyGoal(prev => Math.min(20, prev + 1))}
              >
                <Text style={styles.goalButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.logsListHeader}>
            <Text style={styles.logsListTitle}>
              All Sessions ({sessions.length})
            </Text>
            {sessions.length > 0 && (
              <TouchableOpacity onPress={clearAllSessions}>
                <Text style={styles.clearAllText}>Clear All</Text>
              </TouchableOpacity>
            )}
          </View>

          {sessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No sessions yet</Text>
              <Text style={styles.emptyStateHint}>
                Your sessions will be logged here automatically.
              </Text>
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item, idx) => `${item.startTime}-${idx}`}
              contentContainerStyle={styles.logsListContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onLongPress={() => deleteSession(item.startTime)}
                  style={styles.logRow}
                  activeOpacity={0.7}
                >
                  <View style={styles.logRowLeft}>
                    <Text style={styles.logRowDate}>
                      {formatSessionDate(item.startTime)}
                    </Text>
                    <Text style={styles.logRowDetail}>
                      {formatDuration(item.actualSeconds)}
                      {' / '}
                      {formatDuration(item.plannedSeconds)}
                      {' · '}
                      Strength {item.strength}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.logRowBadge,
                      item.completed
                        ? styles.logRowBadgeComplete
                        : styles.logRowBadgePartial,
                    ]}
                  >
                    <Text style={styles.logRowBadgeText}>
                      {item.completed ? '✓' : '·'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.logSeparator} />}
            />
          )}
          {sessions.length > 0 && (
            <Text style={styles.logsFooterHint}>
              Long-press a session to delete it.
            </Text>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

// Styles
const getStyles = isDarkMode =>
  StyleSheet.create({
    segmented: {
      flexDirection: 'row',
      backgroundColor: isDarkMode ? '#1A1F2E' : '#E5E7EB',
      borderRadius: 12,
      padding: 4,
      marginBottom: 16,
    },
    segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
    segBtnActive: { backgroundColor: '#3B82F6' },
    segTxt: { color: isDarkMode ? '#9CA3AF' : '#6B7280', fontWeight: '600', fontSize: 14 },
    segTxtActive: { color: '#FFFFFF' },
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0F1419' : '#F3F4F6',
      paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    },
    statusBar: {
      flexDirection: 'row',
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      paddingVertical: 16,
      paddingHorizontal: 20,
      marginTop: 16,
      marginHorizontal: 16,
      borderRadius: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    statusItem: {
      flex: 1,
      alignItems: 'center',
    },
    statusLabel: {
      fontSize: 12,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 4,
      fontWeight: '500',
    },
    statusValue: {
      fontSize: 14,
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
      fontWeight: '600',
    },
    statusDivider: {
      width: 1,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      marginHorizontal: 8,
    },
    connectionIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dotConnected: {
      backgroundColor: '#10B981',
    },
    dotDisconnected: {
      backgroundColor: '#EF4444',
    },
    mainScroll: {
      flex: 1,
    },
    mainContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 40,
    },
    weekCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    weekDayItem: {
      alignItems: 'center',
      flex: 1,
    },
    weekDayLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 6,
      letterSpacing: 0.5,
    },
    weekDayLabelToday: {
      color: isDarkMode ? '#60A5FA' : '#2563EB',
    },
    weekDayCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: isDarkMode ? '#374151' : '#D1D5DB',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    weekDayCircleComplete: {
      backgroundColor: isDarkMode ? '#10B981' : '#059669',
      borderColor: isDarkMode ? '#10B981' : '#059669',
    },
    weekDayCircleToday: {
      borderColor: isDarkMode ? '#60A5FA' : '#2563EB',
      borderWidth: 2,
    },
    weekDayCircleMissed: {
      borderColor: isDarkMode ? '#7F1D1D' : '#FCA5A5',
    },
    weekDayCheck: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    weekDayX: {
      color: isDarkMode ? '#7F1D1D' : '#DC2626',
      fontSize: 14,
      fontWeight: '700',
    },
    weekDayCount: {
      color: isDarkMode ? '#60A5FA' : '#2563EB',
      fontSize: 14,
      fontWeight: '700',
    },
    weekHint: {
      fontSize: 12,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
      marginTop: 12,
    },
    logsButton: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDarkMode ? '#374151' : '#E5E7EB',
    },
    logsButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#374151' : '#E5E7EB',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: isDarkMode ? '#FFFFFF' : '#1F2937',
    },
    modalCloseButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    modalCloseText: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#60A5FA' : '#2563EB',
    },
    goalCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 20,
      marginHorizontal: 16,
      marginTop: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    goalLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
      textAlign: 'center',
    },
    goalSubLabel: {
      fontSize: 12,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 16,
    },
    goalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    goalButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      justifyContent: 'center',
      alignItems: 'center',
    },
    goalButtonText: {
      fontSize: 28,
      fontWeight: '300',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    goalBadge: {
      backgroundColor: isDarkMode ? '#3B82F6' : '#2563EB',
      paddingHorizontal: 24,
      paddingVertical: 8,
      borderRadius: 20,
      minWidth: 72,
      alignItems: 'center',
      marginHorizontal: 20,
    },
    goalValue: {
      fontSize: 28,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    logsListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 8,
    },
    logsListTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    clearAllText: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#EF4444' : '#DC2626',
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    },
    emptyStateText: {
      fontSize: 18,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
    },
    emptyStateHint: {
      fontSize: 14,
      color: isDarkMode ? '#6B7280' : '#9CA3AF',
      marginTop: 8,
      textAlign: 'center',
    },
    logsListContent: {
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    logRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 12,
    },
    logRowLeft: {
      flex: 1,
    },
    logRowDate: {
      fontSize: 15,
      fontWeight: '600',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    logRowDetail: {
      fontSize: 13,
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginTop: 4,
    },
    logRowBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 12,
    },
    logRowBadgeComplete: {
      backgroundColor: isDarkMode ? '#10B981' : '#059669',
    },
    logRowBadgePartial: {
      backgroundColor: isDarkMode ? '#374151' : '#D1D5DB',
    },
    logRowBadgeText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    logSeparator: {
      height: 8,
    },
    logsFooterHint: {
      fontSize: 12,
      color: isDarkMode ? '#6B7280' : '#9CA3AF',
      textAlign: 'center',
      paddingVertical: 12,
    },
    timerCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    timerLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      marginBottom: 16,
      textAlign: 'center',
    },
    timerDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    timerButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      justifyContent: 'center',
      alignItems: 'center',
    },
    timerButtonText: {
      fontSize: 32,
      fontWeight: '300',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    timerButtonDisabled: {
      opacity: 0.3,
    },
    timerTextContainer: {
      marginHorizontal: 32,
      alignItems: 'center',
    },
    timerText: {
      fontSize: 56,
      fontWeight: '700',
      color: isDarkMode ? '#FFFFFF' : '#1F2937',
      fontVariant: ['tabular-nums'],
    },
    progressBar: {
      width: 200,
      height: 4,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      borderRadius: 2,
      marginTop: 12,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: isDarkMode ? '#60A5FA' : '#3B82F6',
      borderRadius: 2,
    },
    strengthCard: {
      backgroundColor: isDarkMode ? '#1A1F2E' : '#FFFFFF',
      borderRadius: 16,
      padding: 24,
      marginTop: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    strengthLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#9CA3AF' : '#6B7280',
      textAlign: 'center',
      marginBottom: 16,
    },
    strengthDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    strengthButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: isDarkMode ? '#374151' : '#E5E7EB',
      justifyContent: 'center',
      alignItems: 'center',
    },
    strengthButtonText: {
      fontSize: 32,
      fontWeight: '300',
      color: isDarkMode ? '#E5E7EB' : '#1F2937',
    },
    strengthBadge: {
      backgroundColor: isDarkMode ? '#3B82F6' : '#2563EB',
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
      minWidth: 80,
      alignItems: 'center',
      marginHorizontal: 24,
    },
    strengthValue: {
      fontSize: 32,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    sliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    slider: {
      flex: 1,
      marginHorizontal: 12,
    },
    sliderMinMax: {
      fontSize: 14,
      fontWeight: '600',
      color: isDarkMode ? '#6B7280' : '#9CA3AF',
      width: 24,
      textAlign: 'center',
    },
    controlsContainer: {
      marginTop: 24,
    },
    mainButton: {
      height: 64,
      borderRadius: 32,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 6,
    },
    startButton: {
      backgroundColor: isDarkMode ? '#10B981' : '#059669',
    },
    stopButton: {
      backgroundColor: isDarkMode ? '#EF4444' : '#DC2626',
    },
    scanButton: {
      backgroundColor: isDarkMode ? '#3B82F6' : '#2563EB',
    },
    scanningButton: {
      opacity: 0.7,
    },
    mainButtonText: {
      fontSize: 20,
      fontWeight: '700',
      color: '#FFFFFF',
      letterSpacing: 0.5,
    },
    buttonSpinner: {
      marginRight: 12,
    },
  });

export default ManualScreen;
