import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveMindful, reportCompletion } from './appleHealth';

// App-wide wellness tracking: the session log + daily goal, shared by the home
// screen (weekly tracker) and Manual mode (which logs a completed session).
// Previously lived inside ManualScreen; lifted here so the tracker can move to
// the main page and any flow can record a session toward the daily goal.
const STORAGE_KEY_SESSIONS = '@pulselibre/sessions';
const STORAGE_KEY_DAILY_GOAL = '@pulselibre/dailyGoal';
const DEFAULT_DAILY_GOAL = 2;
const MIN_COUNTING_SECONDS = 60; // a session must run this long to count toward the goal
export const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const startOfWeekMonday = date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setDate(d.getDate() - offset);
  return d;
};
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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

const SessionsContext = createContext(null);
export const useSessions = () => useContext(SessionsContext);

export function SessionsProvider({ children }) {
  const [sessions, setSessions] = useState([]);
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sSessions, sGoal] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_SESSIONS),
          AsyncStorage.getItem(STORAGE_KEY_DAILY_GOAL),
        ]);
        if (sSessions) {
          const parsed = JSON.parse(sSessions);
          if (Array.isArray(parsed)) setSessions(parsed);
        }
        if (sGoal) {
          const v = parseInt(sGoal, 10);
          if (Number.isFinite(v) && v >= 1) setDailyGoal(v);
        }
      } catch (e) {
        console.error('Failed to load sessions:', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions)).catch(() => {});
  }, [sessions, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEY_DAILY_GOAL, String(dailyGoal)).catch(() => {});
  }, [dailyGoal, loaded]);

  // Record a finished session. `actualSeconds` >= 60 counts toward the goal.
  const logSession = ({ plannedSeconds, actualSeconds, strength = null, kind = 'manual' }) => {
    const planned = Math.max(0, Math.round(plannedSeconds || 0));
    const actual = Math.max(0, Math.round(actualSeconds || 0));
    const endTime = Date.now();
    const startTime = new Date(endTime - actual * 1000);
    // Mirror any counting-length session into Apple Health as Mindful Minutes.
    // No-ops unless the user enabled Health sync (guarded inside the bridge).
    // reportCompletion drives the one-time "turn on sync?" nudge when it's off.
    if (actual >= MIN_COUNTING_SECONDS) {
      saveMindful(startTime, new Date(endTime));
      reportCompletion(true);
    }
    setSessions(prev => [
      {
        startTime: startTime.toISOString(),
        plannedSeconds: planned,
        actualSeconds: actual,
        strength,
        kind,
        completed: planned > 0 ? actual >= planned - 1 : actual >= MIN_COUNTING_SECONDS,
      },
      ...prev,
    ]);
  };
  const deleteSession = startTime => setSessions(prev => prev.filter(s => s.startTime !== startTime));
  const clearAllSessions = () => setSessions([]);

  // Derived week view (Mon..Sun) for the tracker.
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
  const todayCount = countSessionsOnDay(sessions, today);

  const value = {
    sessions,
    dailyGoal,
    setDailyGoal,
    logSession,
    deleteSession,
    clearAllSessions,
    weekDays,
    todayCount,
    todayComplete: todayCount >= dailyGoal,
  };
  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}
