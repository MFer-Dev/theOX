import AsyncStorage from '@react-native-async-storage/async-storage';

export type Relationship = {
  followed?: boolean;
  muted?: boolean;
  updatedAt: number;
};

type Store = Record<string, Relationship>;

const KEY = 'ui:relationships:v1';

async function readAll(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Store;
  } catch {
    return {};
  }
}

async function writeAll(next: Store) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export const relationshipsStore = {
  async get(subjectId: string): Promise<Relationship> {
    const all = await readAll();
    return all[subjectId] ?? { updatedAt: 0 };
  },
  async listMutedSubjects(): Promise<string[]> {
    const all = await readAll();
    return Object.keys(all).filter((k) => Boolean(all[k]?.muted));
  },
  async toggleFollow(subjectId: string) {
    const all = await readAll();
    const prev = all[subjectId] ?? { updatedAt: 0 };
    const next: Relationship = { ...prev, followed: !prev.followed, updatedAt: Date.now() };
    all[subjectId] = next;
    await writeAll(all);
    return next;
  },
  async toggleMute(subjectId: string) {
    const all = await readAll();
    const prev = all[subjectId] ?? { updatedAt: 0 };
    const next: Relationship = { ...prev, muted: !prev.muted, updatedAt: Date.now() };
    all[subjectId] = next;
    await writeAll(all);
    return next;
  },
};



