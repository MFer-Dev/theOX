import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearanceMode = 'light' | 'dark' | 'system';

const KEY = 'ui:appearanceMode';

type Listener = (mode: AppearanceMode) => void;
const listeners = new Set<Listener>();

export const appearanceStore = {
  async getMode(): Promise<AppearanceMode> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
      // ignore
    }
    return 'light'; // default: stay in light mode for now
  },
  async setMode(mode: AppearanceMode) {
    try {
      await AsyncStorage.setItem(KEY, mode);
      for (const l of listeners) l(mode);
    } catch {
      // ignore
    }
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};


