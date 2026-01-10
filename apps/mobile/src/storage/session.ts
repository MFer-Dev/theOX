import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_TOKEN = 'session:token';
const KEY_REFRESH_TOKEN = 'session:refresh_token';
const KEY_ONBOARD = 'session:onboarded';
const KEY_GENERATION = 'session:generation';
const KEY_GATHERING_SEEN_PREFIX = 'session:gathering:seen:';
const KEY_GATHERING_ENTERED_PREFIX = 'session:gathering:entered:';

export const sessionStore = {
  saveToken: async (accessToken: string, refreshToken?: string) => {
    await AsyncStorage.setItem(KEY_TOKEN, accessToken);
    if (refreshToken) await AsyncStorage.setItem(KEY_REFRESH_TOKEN, refreshToken);
  },
  getToken: async () => {
    return AsyncStorage.getItem(KEY_TOKEN);
  },
  getRefreshToken: async () => {
    return AsyncStorage.getItem(KEY_REFRESH_TOKEN);
  },
  clearToken: async () => {
    await Promise.all([AsyncStorage.removeItem(KEY_TOKEN), AsyncStorage.removeItem(KEY_REFRESH_TOKEN)]);
  },
  saveOnboarded: async (flag: boolean) => {
    await AsyncStorage.setItem(KEY_ONBOARD, flag ? '1' : '0');
  },
  getOnboarded: async () => {
    const v = await AsyncStorage.getItem(KEY_ONBOARD);
    return v === '1';
  },
  saveGeneration: async (generation: string | null) => {
    if (generation) {
      await AsyncStorage.setItem(KEY_GENERATION, generation);
    } else {
      await AsyncStorage.removeItem(KEY_GENERATION);
    }
  },
  getGeneration: async () => {
    return AsyncStorage.getItem(KEY_GENERATION);
  },
  clearAll: async () => {
    await Promise.all([KEY_TOKEN, KEY_REFRESH_TOKEN, KEY_ONBOARD, KEY_GENERATION].map((k) => AsyncStorage.removeItem(k)));
  },
  setGatheringSeen: async (endAt: string) => {
    if (!endAt) return;
    await AsyncStorage.setItem(`${KEY_GATHERING_SEEN_PREFIX}${endAt}`, '1');
  },
  getGatheringSeen: async (endAt: string) => {
    if (!endAt) return false;
    const v = await AsyncStorage.getItem(`${KEY_GATHERING_SEEN_PREFIX}${endAt}`);
    return v === '1';
  },
  setGatheringEntered: async (startsAt: string) => {
    if (!startsAt) return;
    await AsyncStorage.setItem(`${KEY_GATHERING_ENTERED_PREFIX}${startsAt}`, '1');
  },
  getGatheringEntered: async (startsAt: string) => {
    if (!startsAt) return false;
    const v = await AsyncStorage.getItem(`${KEY_GATHERING_ENTERED_PREFIX}${startsAt}`);
    return v === '1';
  },
};

