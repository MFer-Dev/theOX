import AsyncStorage from '@react-native-async-storage/async-storage';

type Overrides = {
  display_name?: string;
  bio?: string;
  avatar_key?: 'default' | 'alt1' | 'alt2';
};

const KEY = 'ui:profile:me:v1';

const AVATARS: Record<NonNullable<Overrides['avatar_key']>, any> = {
  default: require('../../../public/profile_avatar.png'),
  alt1: require('../../../public/profile_avatar.png'),
  alt2: require('../../../public/profile_avatar.png'),
};

async function read(): Promise<Overrides> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Overrides;
  } catch {
    return {};
  }
}

async function write(next: Overrides) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export const profileStore = {
  avatars: AVATARS,
  async getOverrides() {
    return read();
  },
  async setOverrides(next: Overrides) {
    const prev = await read();
    await write({ ...prev, ...next });
  },
  async clear() {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  },
};


