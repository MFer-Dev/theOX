import AsyncStorage from '@react-native-async-storage/async-storage';

export type Message = {
  id: string;
  threadId: string;
  from: 'me' | 'them';
  body: string;
  ts: string;
};

export type Thread = {
  id: string;
  name: string;
  handle: string;
  avatar?: any;
  lastBody: string;
  lastTs: string;
  unread: number;
  isRequest?: boolean;
};

type Store = {
  threads: Thread[];
  messages: Message[];
};

const KEY = 'ui:messaging:v1';

const seed: Store = {
  threads: [
    { id: 't1', name: 'User 7', handle: 'user7', lastBody: 'Quick question about your last post…', lastTs: '2h', unread: 1 },
    { id: 't2', name: 'User 2', handle: 'user2', lastBody: 'Good faith disagreement — want to compare notes?', lastTs: '1d', unread: 0 },
    { id: 'r1', name: 'New person', handle: 'new_person', lastBody: 'Hey — can I message you?', lastTs: 'now', unread: 1, isRequest: true },
  ],
  messages: [
    { id: 'm1', threadId: 't1', from: 'them', body: 'Quick question about your last post…', ts: '2h' },
    { id: 'm2', threadId: 't1', from: 'me', body: 'Sure — what part are you reacting to?', ts: '2h' },
    { id: 'm3', threadId: 't2', from: 'them', body: 'Good faith disagreement — want to compare notes?', ts: '1d' },
    { id: 'm4', threadId: 'r1', from: 'them', body: 'Hey — can I message you?', ts: 'now' },
  ],
};

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return seed;
    return { ...seed, ...(JSON.parse(raw) as Partial<Store>) };
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

export const messagingStore = {
  async getThreads() {
    const s = await read();
    return s.threads;
  },
  async getThread(id: string) {
    const s = await read();
    return s.threads.find((t) => t.id === id) ?? null;
  },
  async getMessages(threadId: string) {
    const s = await read();
    return s.messages.filter((m) => m.threadId === threadId);
  },
  async markRead(threadId: string) {
    const s = await read();
    s.threads = s.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t));
    await write(s);
  },
  async acceptRequest(threadId: string) {
    const s = await read();
    s.threads = s.threads.map((t) => (t.id === threadId ? { ...t, isRequest: false } : t));
    await write(s);
  },
  async declineRequest(threadId: string) {
    const s = await read();
    s.threads = s.threads.filter((t) => t.id !== threadId);
    s.messages = s.messages.filter((m) => m.threadId !== threadId);
    await write(s);
  },
  async send(threadId: string, body: string) {
    const s = await read();
    const msg: Message = { id: `m_${Date.now()}`, threadId, from: 'me', body, ts: 'now' };
    s.messages = [msg, ...s.messages];
    s.threads = s.threads.map((t) => (t.id === threadId ? { ...t, lastBody: body, lastTs: 'now' } : t));
    await write(s);
    return msg;
  },
};


