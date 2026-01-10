type Generation = 'boomer' | 'genx' | 'millennial' | 'genz' | 'genalpha';

const pick = <T,>(arr: T[], idx: number) => arr[idx % arr.length];

const nowIso = () => new Date().toISOString();

export const mock = {
  me: (token: string) => ({
    user: {
      id: 'u_demo',
      handle: 'matt',
      display_name: 'Matt (Dev)',
      bio: 'Testing mode — mock data enabled.',
      generation: 'genz' as Generation,
      scs: 742,
      avatar_url: null,
    },
    token,
  }),

  sessions: () => ({
    sessions: [
      { id: 's_current', device: 'This device', created_at: nowIso(), current: true, last_active: 'now' },
      { id: 's_mac', device: 'MacOS Safari', created_at: nowIso(), current: false, last_active: '2d' },
      { id: 's_ios', device: 'iPhone', created_at: nowIso(), current: false, last_active: '7d' },
    ],
  }),

  revokeSession: () => ({ ok: true }),

  feed: (_token: string, topic?: string, mode: 'tribal' | 'gathering' = 'tribal') => {
    const topics = ['culture', 'safety', 'economy', 'relationships', 'tech', 'health'];
    const gen: Generation[] = ['boomer', 'genx', 'millennial', 'genz', 'genalpha'];
    const assumptions = ['lived_experience', 'meta', 'observation', 'question'];
    const itemsAll = Array.from({ length: 18 }).map((_, i) => ({
      id: `e_${i + 1}`,
      body:
        i % 3 === 0
          ? 'Long-form example: This is what a realistic entry looks like when someone is writing thoughtfully. It should wrap to multiple lines and test truncation and spacing across cards.'
          : 'Short entry example — quick take with a punchy premise.',
      generation: pick(gen, i),
      topic: topic || pick(topics, i),
      assumption_type: pick(assumptions, i),
      ics: 600 + (i % 9) * 17,
      created_at: nowIso(),
      author: {
        handle: `user${i + 1}`,
        display_name: `User ${i + 1}`,
        avatar_url: null,
      },
    }));
    // Tribal world = Trybe-scoped. In mocks, we scope to Gen Z by default.
    const items = mode === 'tribal' ? itemsAll.filter((it) => it.generation === 'genz') : itemsAll;
    return { feed: items };
  },

  userFeed: (token: string) => {
    const base = mock.feed(token, undefined, 'tribal');
    return { feed: base.feed, restricted: false };
  },

  publicProfile: (_token: string, userId: string) => ({
    user: {
      id: userId,
      handle: `user_${userId.slice(-4)}`,
      display_name: 'Other User',
      bio: 'Mock public profile bio — used to validate other-user profile layout.',
      generation: 'millennial' as Generation,
      scs: 615,
    },
  }),

  userPublicFeed: (token: string, _userId: string) => {
    const base = mock.feed(token, undefined, 'tribal');
    return { feed: base.feed.slice(0, 6), restricted: false };
  },

  thread: (_token: string, entryId: string) => ({
    thread: {
      id: entryId,
      body: 'Thread starter body — shows full content detail and reply list below.',
      generation: 'genz' as Generation,
      topic: 'culture',
      assumption_type: 'lived_experience',
      ics: 731,
      replies: Array.from({ length: 5 }).map((_, i) => ({
        id: `r_${entryId}_${i + 1}`,
        body:
          i === 0
            ? 'Reply example with a bit more detail to test multi-line layout and spacing.'
            : 'Reply example.',
        generation: pick(['genx', 'millennial', 'genz'] as Generation[], i),
        created_at: nowIso(),
      })),
    },
  }),

  contentDetail: (_token: string, contentId: string) => ({
    id: contentId,
    title: 'Entry',
    body:
      'Full content detail mock. This should be long enough to test spacing, typography, and the action sheet.\n\nSecond paragraph to validate multi-paragraph rendering.',
    author: 'matt',
    timestamp: nowIso(),
    metadata: 'Trybe: Gen Z · Topic: culture · SCS: 742',
  }),

  updateProfile: (_token: string, payload: { display_name?: string; bio?: string }) => ({
    ok: true,
    updated: payload,
  }),

  submitEntry: (_token: string, payload: any) => {
    const id = `e_${Math.floor(Math.random() * 10000)}`;
    return {
      ok: true,
      id,
      entry: {
        id,
        ...payload,
        created_at: nowIso(),
      },
    };
  },

  replies: (_token: string, entryId: string, content: string) => ({
    ok: true,
    reply: { id: `r_${entryId}_${Math.floor(Math.random() * 10000)}`, body: content, created_at: nowIso() },
  }),

  endorse: () => ({ ok: true }),
  upvote: () => ({ ok: true }),

  balance: () => ({ balance: 120 }),
  credLedger: () => ({ ledger: [{ id: 'l1', delta: +5, description: 'Mock delta', ts: nowIso() }], items: [{ id: 'l1', delta: +5, reason: 'Mock delta', ts: nowIso() }] }),

  safetyStatus: () => ({ status: 'ok', restricted: false }),
  safetyAppealSubmit: () => ({ appeal_id: 'a_demo_1' }),
  safetyAppealStatus: () => ({ appeal: { id: 'a_demo_1', status: 'received' }, history: [{ ts: nowIso(), status: 'received' }] }),

  purgeStatus: () => ({
    // Default: Tribal world. Provide upcoming event timing for the unobtrusive indicator.
    active: false,
    starts_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    ends_at: new Date(Date.now() + 1000 * 60 * 60 * 30).toISOString(),
  }),

  gatheringEligibility: () => ({
    eligible: true,
    reasons: [],
    completed: ['activity', 'reply'],
    ics_delta: 3,
    required_ics_delta: 10,
  }),

  gatheringHistory: () => ({
    histories: [
      { id: 'current', label: 'Current Gathering', active: true },
      { id: 'last-week', label: 'Last week', active: false },
      { id: 'two-weeks', label: 'Two weeks ago', active: false },
    ],
  }),

  gatheringTimeline: (token: string, params?: { historyId?: string; trybe?: string; topic?: string }) => {
    const base = mock.feed(token, params?.topic, 'gathering');
    return { feed: base.feed };
  },

  notifications: () => ({
    items: [
      {
        id: 'n_1',
        title: 'Welcome to Trybl',
        body: 'You’re in dev mode. This is mock content to validate layout.',
        ts: 'now',
        unread: true,
        target: { route: 'Home' },
      },
      {
        id: 'n_2',
        title: 'The Gathering is live',
        body: 'Cross-Trybe visibility is open for a limited time.',
        ts: '2h',
        unread: false,
        target: { route: 'GatheringTimeline' },
      },
    ],
  }),

  profile: () => ({
    profile: {
      display_name: 'Matt (Dev)',
      bio: 'Mock profile bio. Longer text here to test wrapping and spacing in profile header.',
      scs: 742,
      generation: 'genz' as Generation,
    },
    posts: Array.from({ length: 8 }).map((_, i) => ({
      id: `p_${i + 1}`,
      body: 'Profile post example.',
      topic: pick(['culture', 'tech', 'safety'], i),
      ics: 700 + i * 5,
    })),
  }),
};


