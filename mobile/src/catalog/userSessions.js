// Persistent user-created sessions (AI-generated or saved from Studio). They live in
// their own category that shows up alongside the bundled ones, survive restarts via
// AsyncStorage, and can be deleted. Playable doses are kept in an in-memory registry
// so doseById() (catalog/data) resolves them like any other dose; a subscribe/notify
// pair lets the springboard + category list re-render when the set changes.
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { imedxToDose, validateImedx } from './importDose';
import { normalizeImedx } from './imedxSpec';

export const USER_CATEGORY = 'My Sessions';
const KEY = '@pulseentrain/userSessions';

const registry = new Map(); // id → dose
const listeners = new Set();
let loaded = false;

const slug = s => String(s || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
const notify = () => listeners.forEach(l => l());
const persist = () => AsyncStorage.setItem(KEY, JSON.stringify([...registry.values()])).catch(() => {});

// Load once at startup (fire-and-forget). Doses are already the play-ready shape.
export async function loadUserSessions() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) arr.forEach(d => d && d.id && registry.set(d.id, d));
  } catch (e) {}
  notify();
}
loadUserSessions();

export const listUserSessions = () => [...registry.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
export const getUserDose = id => registry.get(id) || null;
export const isUserDose = id => registry.has(id);

// Convert an .imedx, register + persist it, and return the playable dose (throws on bad input).
export function addUserSession(rawImedx, opts = {}) {
  const imedx = normalizeImedx(rawImedx); // repair misplaced keys before validating
  const v = validateImedx(imedx);
  if (!v.ok) throw new Error(v.error);
  const dose = imedxToDose(imedx);
  const nameSlug = slug((imedx.meta && imedx.meta.name) || dose.name);
  dose.id = `user_${nameSlug}_${opts.stamp || registry.size}_${Math.round((imedx.entrainment.scenes.length || 1) * 7)}`;
  // guarantee uniqueness even for same-name/same-second saves
  while (registry.has(dose.id)) dose.id += 'x';
  dose.category = USER_CATEGORY;
  dose.userCreated = true;
  dose.createdAt = opts.stamp || registry.size + 1;
  registry.set(dose.id, dose);
  persist();
  notify();
  return dose;
}

export function removeUserSession(id) {
  if (registry.delete(id)) { persist(); notify(); }
}

// Reactive list for the springboard / category screens.
export function useUserSessions() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    if (!loaded) loadUserSessions();
    return () => listeners.delete(l);
  }, []);
  return listUserSessions();
}
