import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_ENABLED = 'push:enabled';
const KEY_TOKEN = 'push:token';

export async function getPushEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY_ENABLED);
  return v === '1';
}

export async function setPushEnabled(enabled: boolean) {
  await AsyncStorage.setItem(KEY_ENABLED, enabled ? '1' : '0');
}

export async function getOrCreatePushToken(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY_TOKEN);
  if (existing) return existing;
  const token = crypto.randomUUID();
  await AsyncStorage.setItem(KEY_TOKEN, token);
  return token;
}


