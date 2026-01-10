import AsyncStorage from '@react-native-async-storage/async-storage';

export type SavedList = {
  id: string;
  name: string;
  description?: string;
  itemIds: string[];
  updatedAt: number;
};

type Store = {
  lists: SavedList[];
};

const KEY = 'ui:lists:v1';

const seed: Store = {
  lists: [
    { id: 'l1', name: 'Read later', description: 'Long-form to revisit', itemIds: [], updatedAt: Date.now() },
    { id: 'l2', name: 'Disagree / learn', description: 'Good-faith disagreement worth studying', itemIds: [], updatedAt: Date.now() },
  ],
};

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return { ...seed, ...parsed, lists: parsed.lists ?? seed.lists };
  } catch {
    return seed;
  }
}

async function write(next: Store) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export const listsStore = {
  async getLists() {
    const s = await read();
    return s.lists.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  },
  async createList(name: string, description?: string) {
    const s = await read();
    const next: SavedList = {
      id: `l_${Date.now()}`,
      name,
      description,
      itemIds: [],
      updatedAt: Date.now(),
    };
    s.lists = [next, ...s.lists];
    await write(s);
    return next;
  },
  async updateList(listId: string, patch: { name?: string; description?: string }) {
    const s = await read();
    s.lists = s.lists.map((l) =>
      l.id === listId
        ? {
            ...l,
            name: typeof patch.name === 'string' ? patch.name : l.name,
            description: typeof patch.description === 'string' ? patch.description : l.description,
            updatedAt: Date.now(),
          }
        : l,
    );
    await write(s);
  },
  async addItem(listId: string, itemId: string) {
    const s = await read();
    s.lists = s.lists.map((l) =>
      l.id === listId
        ? { ...l, itemIds: Array.from(new Set([itemId, ...l.itemIds])), updatedAt: Date.now() }
        : l,
    );
    await write(s);
  },
  async removeItem(listId: string, itemId: string) {
    const s = await read();
    s.lists = s.lists.map((l) =>
      l.id === listId ? { ...l, itemIds: l.itemIds.filter((id) => id !== itemId), updatedAt: Date.now() } : l,
    );
    await write(s);
  },
  async getList(listId: string) {
    const s = await read();
    return s.lists.find((l) => l.id === listId) ?? null;
  },
};



