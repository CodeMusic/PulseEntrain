// Web stub for @react-native-async-storage/async-storage — localStorage-backed.
const ls = typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
const mem = {};
const get = k => (ls ? ls.getItem(k) : k in mem ? mem[k] : null);
const set = (k, v) => {
  if (ls) ls.setItem(k, String(v));
  else mem[k] = String(v);
};
const del = k => {
  if (ls) ls.removeItem(k);
  else delete mem[k];
};

const AsyncStorage = {
  getItem: k => Promise.resolve(get(k)),
  setItem: (k, v) => {
    set(k, v);
    return Promise.resolve();
  },
  removeItem: k => {
    del(k);
    return Promise.resolve();
  },
  multiGet: keys => Promise.resolve(keys.map(k => [k, get(k)])),
  multiSet: pairs => {
    pairs.forEach(([k, v]) => set(k, v));
    return Promise.resolve();
  },
  multiRemove: keys => {
    keys.forEach(del);
    return Promise.resolve();
  },
  getAllKeys: () => Promise.resolve(ls ? Object.keys(ls) : Object.keys(mem)),
  clear: () => {
    if (ls) ls.clear();
    else Object.keys(mem).forEach(k => delete mem[k]);
    return Promise.resolve();
  },
};

export default AsyncStorage;
export const useAsyncStorage = key => ({
  getItem: () => AsyncStorage.getItem(key),
  setItem: v => AsyncStorage.setItem(key, v),
  removeItem: () => AsyncStorage.removeItem(key),
});
