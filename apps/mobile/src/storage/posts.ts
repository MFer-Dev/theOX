import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocalPost = {
  id: string;
  body: string;
  topic?: string | null;
  created_at: string;
  author: { handle: string; display_name?: string; avatar_url?: any };
  ai_assisted?: boolean;
  media?: any[]; // Metro assets or remote URLs
  deleted?: boolean;
  updatedAt: number;
};

type Store = {
  posts: LocalPost[];
  deletedIds: string[];
};

const KEY = 'ui:posts:v1';

const seed: Store = { posts: [], deletedIds: [] };

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      posts: parsed.posts ?? seed.posts,
      deletedIds: parsed.deletedIds ?? seed.deletedIds,
    };
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

export const postsStore = {
  async add(post: LocalPost) {
    const s = await read();
    s.posts = [post, ...s.posts.filter((p) => p.id !== post.id)];
    await write(s);
  },
  async markDeleted(id: string) {
    const s = await read();
    s.deletedIds = Array.from(new Set([id, ...s.deletedIds]));
    s.posts = s.posts.map((p) => (p.id === id ? { ...p, deleted: true, updatedAt: Date.now() } : p));
    await write(s);
  },
  async get(id: string) {
    const s = await read();
    return s.posts.find((p) => p.id === id) ?? null;
  },
  async getDeletedIds() {
    const s = await read();
    return s.deletedIds;
  },
  async list(params?: { topic?: string; handle?: string }) {
    const s = await read();
    let list = s.posts.filter((p) => !p.deleted);
    if (params?.topic) list = list.filter((p) => (p.topic ?? '').toLowerCase() === params.topic!.toLowerCase());
    if (params?.handle) list = list.filter((p) => (p.author?.handle ?? '').toLowerCase() === params.handle!.toLowerCase());
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  },
};



