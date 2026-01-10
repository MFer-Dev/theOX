import AsyncStorage from '@react-native-async-storage/async-storage';

export type InteractionState = {
  liked?: boolean;
  reposted?: boolean;
  bookmarked?: boolean;
  // lightweight counters for baseline-parity feel; not canonical for Trybl.
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  // snapshot for bookmark list rendering
  snapshot?: {
    id: string;
    body: string;
    author?: { handle?: string; display_name?: string; avatar_url?: string | null };
    created_at?: string;
  };
  updatedAt: number;
};

type StoreShape = Record<string, InteractionState>;

const KEY = 'ui:interactions:v1';

async function readAll(): Promise<StoreShape> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

async function writeAll(next: StoreShape) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export const interactionsStore = {
  async get(id: string): Promise<InteractionState | null> {
    const all = await readAll();
    return all[id] ?? null;
  },
  async getMany(ids: string[]): Promise<StoreShape> {
    const all = await readAll();
    const out: StoreShape = {};
    for (const id of ids) {
      if (all[id]) out[id] = all[id];
    }
    return out;
  },
  async listBookmarks(): Promise<InteractionState[]> {
    const all = await readAll();
    return Object.values(all)
      .filter((s) => s.bookmarked && s.snapshot?.id)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  },
  async toggleLike(id: string, snapshot?: InteractionState['snapshot']) {
    const all = await readAll();
    const prev = all[id] ?? { updatedAt: Date.now() };
    const nextLiked = !prev.liked;
    const next: InteractionState = {
      ...prev,
      liked: nextLiked,
      likeCount: Math.max(0, (prev.likeCount ?? 0) + (nextLiked ? 1 : -1)),
      snapshot: snapshot ?? prev.snapshot,
      updatedAt: Date.now(),
    };
    all[id] = next;
    await writeAll(all);
    return next;
  },
  async toggleRepost(id: string, snapshot?: InteractionState['snapshot']) {
    const all = await readAll();
    const prev = all[id] ?? { updatedAt: Date.now() };
    const nextReposted = !prev.reposted;
    const next: InteractionState = {
      ...prev,
      reposted: nextReposted,
      repostCount: Math.max(0, (prev.repostCount ?? 0) + (nextReposted ? 1 : -1)),
      snapshot: snapshot ?? prev.snapshot,
      updatedAt: Date.now(),
    };
    all[id] = next;
    await writeAll(all);
    return next;
  },
  async toggleBookmark(id: string, snapshot?: InteractionState['snapshot']) {
    const all = await readAll();
    const prev = all[id] ?? { updatedAt: Date.now() };
    const nextBookmarked = !prev.bookmarked;
    const next: InteractionState = {
      ...prev,
      bookmarked: nextBookmarked,
      snapshot: snapshot ?? prev.snapshot,
      updatedAt: Date.now(),
    };
    all[id] = next;
    await writeAll(all);
    return next;
  },
  async bumpReplyCount(id: string, delta: number, snapshot?: InteractionState['snapshot']) {
    const all = await readAll();
    const prev = all[id] ?? { updatedAt: Date.now() };
    const next: InteractionState = {
      ...prev,
      replyCount: Math.max(0, (prev.replyCount ?? 0) + delta),
      snapshot: snapshot ?? prev.snapshot,
      updatedAt: Date.now(),
    };
    all[id] = next;
    await writeAll(all);
    return next;
  },
};


