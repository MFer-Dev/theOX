import { Platform } from 'react-native';
import { mock } from './mock';
import { profileStore } from '../storage/profile';
import { sessionStore } from '../storage/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../observability';

const resolveBaseUrl = () => {
  const envBase = process.env.API_BASE_URL ?? process.env.MOBILE_API_BASE_URL;
  const base = envBase ?? 'http://localhost:4000';
  if (Platform.OS === 'android' && base.includes('localhost')) {
    return base.replace('localhost', '10.0.2.2');
  }
  return base;
};

export const apiBase = resolveBaseUrl();

type WorldHeader = 'tribal' | 'gathering';

const KEY_DEVICE_ID = 'device:id';
async function getDeviceId() {
  const existing = await AsyncStorage.getItem(KEY_DEVICE_ID);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await AsyncStorage.setItem(KEY_DEVICE_ID, id);
  return id;
}

const buildHeaders = (token?: string, world?: WorldHeader) => ({
  'x-correlation-id': crypto.randomUUID(),
  'content-type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(world ? { 'x-trybl-world': world } : {}),
});

let refreshInFlight: Promise<{ access_token: string; refresh_token: string } | null> | null = null;
async function refreshTokens(): Promise<{ access_token: string; refresh_token: string } | null> {
  const refresh = await sessionStore.getRefreshToken();
  if (!refresh) return null;
  const deviceId = await getDeviceId();
  const res = await fetch(`${apiBase}/identity/auth/refresh`, {
    method: 'POST',
    headers: { ...buildHeaders(undefined, undefined), 'x-device-id': deviceId },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  if (!json?.access_token || !json?.refresh_token) return null;
  await sessionStore.saveToken(json.access_token, json.refresh_token);
  return { access_token: json.access_token, refresh_token: json.refresh_token };
}

async function authedFetch(
  url: string,
  init: RequestInit,
  opts: { token?: string; world?: WorldHeader; retry?: boolean } = {},
) {
  const deviceId = await getDeviceId();
  const headers = { ...(init.headers as any), ...buildHeaders(opts.token, opts.world), 'x-device-id': deviceId };
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    captureException(e, { where: 'authedFetch', url });
    throw e;
  }
  if (res.status !== 401 || opts.retry === false) return res;
  if (!opts.token) return res;
  if (!refreshInFlight) refreshInFlight = refreshTokens().finally(() => (refreshInFlight = null));
  const refreshed = await refreshInFlight;
  if (!refreshed?.access_token) return res;
  const headers2 = { ...(init.headers as any), ...buildHeaders(refreshed.access_token, opts.world), 'x-device-id': deviceId };
  try {
    return await fetch(url, { ...init, headers: headers2 });
  } catch (e) {
    captureException(e, { where: 'authedFetch.retry', url });
    throw e;
  }
}

async function errorCodeFrom(res: Response): Promise<string | null> {
  try {
    const json: any = await res.json();
    return typeof json?.error === 'string' ? json.error : null;
  } catch {
    return null;
  }
}

async function throwWithCode(res: Response, fallback: string): Promise<never> {
  const code = await errorCodeFrom(res);
  throw new Error(code ?? fallback);
}

export const apiClient = {
  login: async (handle: string, password: string) => {
    const deviceId = await getDeviceId();
    const res = await fetch(`${apiBase}/identity/auth/login`, {
      method: 'POST',
      headers: { ...buildHeaders(), 'x-device-id': deviceId },
      body: JSON.stringify({ handle, password }),
    });
    if (!res.ok) throw new Error('login failed');
    return res.json();
  },
  register: async (email: string, handle: string, password: string) => {
    const res = await fetch(`${apiBase}/identity/register`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ email, handle, password }),
    });
    if (!res.ok) throw new Error('register failed');
    return res.json();
  },
  verifyOtp: async (contact: string, code: string) => {
    const res = await fetch(`${apiBase}/identity/verify-otp`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ contact, code }),
    });
    if (!res.ok) throw new Error('verify otp failed');
    return res.json();
  },
  otpSend: async (contact: string, purpose: string = 'verify') => {
    const deviceId = await getDeviceId();
    const res = await fetch(`${apiBase}/identity/otp/send`, {
      method: 'POST',
      headers: { ...buildHeaders(), 'x-device-id': deviceId },
      body: JSON.stringify({ contact, purpose }),
    });
    if (!res.ok) await throwWithCode(res, 'otp send failed');
    return res.json();
  },
  forgotPassword: async (contact: string) => {
    const res = await fetch(`${apiBase}/identity/password/forgot`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ contact }),
    });
    if (!res.ok) throw new Error('forgot failed');
    return res.json();
  },
  resetPassword: async (token: string, password: string) => {
    const res = await fetch(`${apiBase}/identity/password/reset`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) throw new Error('reset failed');
    return res.json();
  },
  verify2fa: async (code: string) => {
    const res = await fetch(`${apiBase}/identity/2fa/verify`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('2fa failed');
    return res.json();
  },
  sessions: async (token?: string) => {
    if (token === 'dev-session') return mock.sessions();
    const res = await authedFetch(`${apiBase}/identity/sessions`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('sessions failed');
    return res.json();
  },
  revokeSession: async (token: string, sessionId: string) => {
    if (token === 'dev-session') return mock.revokeSession();
    const res = await authedFetch(
      `${apiBase}/identity/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
      { token },
    );
    if (!res.ok) throw new Error('revoke session failed');
    return res.json();
  },
  logoutAll: async (token: string) => {
    const res = await authedFetch(`${apiBase}/identity/auth/logout_all`, { method: 'POST', body: JSON.stringify({}) }, { token });
    if (!res.ok) throw new Error('logout all failed');
    return res.json();
  },
  accountDelete: async (token: string, reason?: string) => {
    if (token === 'dev-session') return { ok: true, deleted: true };
    const res = await authedFetch(
      `${apiBase}/identity/account/delete`,
      { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'account delete failed');
    return res.json();
  },
  me: async (token: string) => {
    if (token === 'dev-session') {
      const base = mock.me(token);
      const o = await profileStore.getOverrides();
      const avatarKey = o.avatar_key ?? 'default';
      return {
        ...base,
        user: {
          ...base.user,
          display_name: o.display_name ?? base.user.display_name,
          bio: o.bio ?? base.user.bio,
          avatar_url: profileStore.avatars[avatarKey] ?? base.user.avatar_url,
        },
      };
    }
    const res = await authedFetch(`${apiBase}/identity/me`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('me failed');
    return res.json();
  },
  feed: async (token: string, topic?: string) => {
    if (token === 'dev-session') return mock.feed(token, topic, 'tribal');
    const url = topic ? `${apiBase}/discourse/feed?topic=${encodeURIComponent(topic)}` : `${apiBase}/discourse/feed`;
    const res = await authedFetch(url, { method: 'GET' }, { token, world: 'tribal' });
    if (!res.ok) throw new Error('feed failed');
    return res.json();
  },
  userFeed: async (token: string) => {
    if (token === 'dev-session') return mock.userFeed(token);
    const res = await fetch(`${apiBase}/discourse/my-feed`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('user feed failed');
    return res.json();
  },
  publicProfile: async (token: string, userId: string) => {
    if (token === 'dev-session') return mock.publicProfile(token, userId);
    const res = await fetch(`${apiBase}/identity/public/${encodeURIComponent(userId)}`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('public profile failed');
    return res.json();
  },
  userPublicFeed: async (token: string, userId: string) => {
    if (token === 'dev-session') return mock.userPublicFeed(token, userId);
    const res = await fetch(`${apiBase}/discourse/user/${encodeURIComponent(userId)}/feed`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('public feed failed');
    return res.json();
  },
  updateProfile: async (token: string, payload: { display_name?: string; bio?: string }) => {
    if (token === 'dev-session') {
      await profileStore.setOverrides({ display_name: payload.display_name, bio: payload.bio });
      return mock.updateProfile(token, payload);
    }
    const res = await authedFetch(
      `${apiBase}/identity/profile/update`,
      { method: 'POST', body: JSON.stringify(payload) },
      { token },
    );
    if (!res.ok) throw new Error('update profile failed');
    return res.json();
  },
  contentDetail: async (token: string, contentId: string) => {
    if (token === 'dev-session') return mock.contentDetail(token, contentId);
    const res = await authedFetch(
      `${apiBase}/discourse/content/${encodeURIComponent(contentId)}`,
      { method: 'GET' },
      { token },
    );
    if (!res.ok) throw new Error('content detail failed');
    return res.json();
  },
  submitEntry: async (
    token: string,
    assumption_type: string,
    content: string,
    topic?: string,
    ai_assisted?: boolean,
    media?: { url: string; type: string }[],
    quote_entry_id?: string,
    world?: WorldHeader,
  ) => {
    if (token === 'dev-session') return mock.submitEntry(token, { assumption_type, content, topic, ai_assisted, media });
    const res = await authedFetch(
      `${apiBase}/discourse/entries`,
      {
        method: 'POST',
        headers: { 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ assumption_type, content, topic, ai_assisted, media: media ?? [], quote_entry_id: quote_entry_id ?? null }),
      },
      { token, world },
    );
    if (!res.ok) await throwWithCode(res, 'create entry failed');
    return res.json();
  },
  discourseToggleInteraction: async (
    token: string,
    entryId: string,
    kind: 'like' | 'repost' | 'bookmark',
    world?: WorldHeader,
  ) => {
    const res = await authedFetch(
      `${apiBase}/discourse/entries/${encodeURIComponent(entryId)}/interactions/toggle`,
      { method: 'POST', body: JSON.stringify({ kind }) },
      { token, world },
    );
    if (!res.ok) await throwWithCode(res, 'interaction failed');
    return res.json();
  },
  discourseToggleReplyInteraction: async (
    token: string,
    replyId: string,
    kind: 'like' | 'repost' | 'bookmark',
    world?: WorldHeader,
  ) => {
    const res = await authedFetch(
      `${apiBase}/discourse/replies/${encodeURIComponent(replyId)}/interactions/toggle`,
      { method: 'POST', body: JSON.stringify({ kind }) },
      { token, world },
    );
    if (!res.ok) await throwWithCode(res, 'reply interaction failed');
    return res.json();
  },
  discourseBookmarks: async (token: string) => {
    const res = await authedFetch(`${apiBase}/discourse/bookmarks`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('bookmarks failed');
    return res.json();
  },
  discourseDeleteEntry: async (token: string, entryId: string) => {
    const res = await authedFetch(
      `${apiBase}/discourse/entries/${encodeURIComponent(entryId)}`,
      { method: 'DELETE' },
      { token },
    );
    if (!res.ok) throw new Error('delete failed');
    return res.json();
  },
  discourseMyMedia: async (token: string) => {
    const res = await authedFetch(`${apiBase}/discourse/my-media`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('media failed');
    return res.json();
  },
  discourseMyReplies: async (token: string) => {
    const res = await authedFetch(`${apiBase}/discourse/my-replies`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('replies failed');
    return res.json();
  },
  mediaUploadUrl: async (token: string, type: 'image' | 'video' = 'image') => {
    const res = await authedFetch(
      `${apiBase}/discourse/media/upload-url`,
      { method: 'POST', body: JSON.stringify({ type }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'media upload-url failed');
    return res.json();
  },
  mediaUpload: async (
    token: string,
    payload: { id?: string; filename?: string; content_type?: string; data_base64: string },
  ) => {
    const res = await authedFetch(
      `${apiBase}/discourse/media/upload`,
      { method: 'POST', body: JSON.stringify(payload) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'media upload failed');
    return res.json();
  },
  mediaFinalize: async (token: string, id: string) => {
    const res = await authedFetch(
      `${apiBase}/discourse/media/finalize`,
      { method: 'POST', body: JSON.stringify({ id }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'media finalize failed');
    return res.json();
  },
  replies: async (token: string, entryId: string, content: string, world?: WorldHeader) => {
    if (token === 'dev-session') return mock.replies(token, entryId, content);
    const res = await authedFetch(
      `${apiBase}/discourse/entries/${entryId}/reply`,
      { method: 'POST', headers: { 'x-idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ content }) },
      { token, world },
    );
    if (!res.ok) await throwWithCode(res, 'reply failed');
    return res.json();
  },
  endorse: async (token: string, entryId: string, intent: string) => {
    if (token === 'dev-session') return mock.endorse();
    const res = await fetch(`${apiBase}/endorse/endorse`, {
      method: 'POST',
      headers: { ...buildHeaders(token), 'content-type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ entry_id: entryId, intent }),
    });
    if (!res.ok) throw new Error('endorse failed');
    return res.json();
  },
  purgeStatus: async () => {
    // In dev-session, still provide deterministic event timing for layout
    // even if backend is offline.
    if (process.env.NODE_ENV !== 'production') {
      try {
        const res = await fetch(`${apiBase}/purge/status`);
        if (res.ok) return res.json();
      } catch {
        // ignore
      }
      return mock.purgeStatus();
    }
    const res = await fetch(`${apiBase}/purge/status`);
    if (!res.ok) throw new Error('purge status failed');
    return res.json();
  },
  gatheringEligibility: async (token?: string) => {
    if (token === 'dev-session') return mock.gatheringEligibility();
    try {
      const res = await authedFetch(`${apiBase}/purge/eligibility`, { method: 'GET' }, { token });
      if (!res.ok) throw new Error('gathering eligibility failed');
      return res.json();
    } catch {
      // Fallback stub to avoid blocking UX if backend not ready
      return { eligible: true, reasons: [], completed: ['activity'], ics_delta: 0, required_ics_delta: 10 };
    }
  },
  gatheringTimeline: async (token: string, params?: { historyId?: string; trybe?: string; topic?: string }) => {
    if (token === 'dev-session') return mock.gatheringTimeline(token, params);
    const qs = new URLSearchParams();
    if (params?.historyId) qs.append('history', params.historyId);
    if (params?.trybe) qs.append('trybe', params.trybe);
    if (params?.topic) qs.append('topic', params.topic);
    const url = `${apiBase}/discourse/gathering${qs.toString() ? `?${qs.toString()}` : ''}`;
    try {
      const res = await authedFetch(url, { method: 'GET' }, { token, world: 'gathering' });
      if (!res.ok) throw new Error('gathering timeline failed');
      return res.json();
    } catch {
      // Fallback to regular feed if gathering endpoint not available
      const feed = await apiClient.feed(token, params?.topic);
      return { feed: feed?.feed ?? feed };
    }
  },
  gatheringHistory: async (token: string) => {
    if (token === 'dev-session') return mock.gatheringHistory();
    try {
      const res = await authedFetch(`${apiBase}/discourse/gathering/history`, { method: 'GET' }, { token, world: 'gathering' });
      if (!res.ok) throw new Error('gathering history failed');
      return res.json();
    } catch {
      return {
        histories: [
          { id: 'current', label: 'Current Gathering', active: true },
          { id: 'last-week', label: 'Last week', active: false },
          { id: 'two-weeks', label: 'Two weeks ago', active: false },
        ],
      };
    }
  },
  balance: async (token: string) => {
    if (token === 'dev-session') return mock.balance();
    const res = await fetch(`${apiBase}/cred/cred/balances`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('balance failed');
    return res.json();
  },
  credLedger: async (token: string) => {
    if (token === 'dev-session') return mock.credLedger();
    const res = await authedFetch(`${apiBase}/cred/cred/ledger`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('ledger failed');
    return res.json();
  },
  thread: async (token: string, entryId: string) => {
    if (token === 'dev-session') return mock.thread(token, entryId);
    const res = await authedFetch(`${apiBase}/discourse/thread/${entryId}`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('thread failed');
    return res.json();
  },
  upvote: async (token: string, entryId: string) => {
    if (token === 'dev-session') return mock.upvote();
    const res = await fetch(`${apiBase}/discourse/upvote`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ entry_id: entryId }),
    });
    if (!res.ok) throw new Error('upvote failed');
    return res.json();
  },
  setGeneration: async (generation: string, token?: string) => {
    const res = await fetch(`${apiBase}/identity/generation/set`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ generation }),
    });
    if (!res.ok) throw new Error('set generation failed');
    return res.json();
  },
  verifyGeneration: async (code: string, token?: string) => {
    const res = await fetch(`${apiBase}/identity/generation/verify`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error('verify generation failed');
    return res.json();
  },
  notesByContent: async (token: string, contentId: string) => {
    const res = await fetch(`${apiBase}/notes/by-content/${contentId}`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('notes fetch failed');
    return res.json();
  },
  noteDetail: async (token: string, noteId: string) => {
    const res = await fetch(`${apiBase}/notes/${noteId}`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('note detail failed');
    return res.json();
  },
  noteCreate: async (token: string, contentId: string, body: string) => {
    const res = await fetch(`${apiBase}/notes`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ content_id: contentId, body }),
    });
    if (!res.ok) throw new Error('note create failed');
    return res.json();
  },
  noteUpdate: async (token: string, noteId: string, body: string, status?: string) => {
    const res = await fetch(`${apiBase}/notes/${noteId}/update`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify({ body, status }),
    });
    if (!res.ok) throw new Error('note update failed');
    return res.json();
  },
  noteCite: async (token: string, noteId: string, payload: { type: string; source?: string; url?: string }) => {
    const res = await fetch(`${apiBase}/notes/${noteId}/cite`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('note cite failed');
    return res.json();
  },
  noteFeature: async (noteId: string) => {
    const res = await fetch(`${apiBase}/notes/${noteId}/feature`, {
      method: 'POST',
      headers: buildHeaders(),
    });
    if (!res.ok) throw new Error('note feature failed');
    return res.json();
  },
  noteDeprecate: async (noteId: string) => {
    const res = await fetch(`${apiBase}/notes/${noteId}/deprecate`, {
      method: 'POST',
      headers: buildHeaders(),
    });
    if (!res.ok) throw new Error('note deprecate failed');
    return res.json();
  },
  safetyFlag: async (token: string, payload: { content_id: string; reason: string }) => {
    const res = await fetch(`${apiBase}/safety/flag`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('flag failed');
    return res.json();
  },
  safetyStatus: async (token: string) => {
    if (token === 'dev-session') return mock.safetyStatus();
    const res = await fetch(`${apiBase}/safety/my-status`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('safety status failed');
    return res.json();
  },
  safetyAppealSubmit: async (token: string, payload: { flag_id?: string; friction_id?: string; message: string }) => {
    if (token === 'dev-session') return mock.safetyAppealSubmit();
    const res = await fetch(`${apiBase}/safety/appeal/submit`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('appeal submit failed');
    return res.json();
  },
  safetyAppealStatus: async (token: string, id: string) => {
    if (token === 'dev-session') return mock.safetyAppealStatus();
    const res = await fetch(`${apiBase}/safety/appeal/${id}`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('appeal status failed');
    return res.json();
  },
  notifications: async (token: string) => {
    const res = await authedFetch(`${apiBase}/notifications/notifications`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('notifications failed');
    return res.json();
  },
  pushRegister: async (token: string, platform: 'ios' | 'android', deviceToken: string) => {
    if (token === 'dev-session') return { ok: true };
    const res = await authedFetch(
      `${apiBase}/notifications/devices/register`,
      { method: 'POST', body: JSON.stringify({ platform, token: deviceToken }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'push register failed');
    return res.json();
  },
  pushUnregister: async (token: string, platform: 'ios' | 'android', deviceToken: string) => {
    if (token === 'dev-session') return { ok: true };
    const res = await authedFetch(
      `${apiBase}/notifications/devices/unregister`,
      { method: 'POST', body: JSON.stringify({ platform, token: deviceToken }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'push unregister failed');
    return res.json();
  },
  relationshipsMuted: async (token: string) => {
    const res = await fetch(`${apiBase}/identity/relationships/muted`, { headers: buildHeaders(token) });
    if (!res.ok) throw new Error('relationships muted failed');
    return res.json();
  },
  relationshipToggleMute: async (token: string, handle: string) => {
    const res = await authedFetch(
      `${apiBase}/identity/relationships/mute`,
      { method: 'POST', body: JSON.stringify({ handle }) },
      { token },
    );
    if (!res.ok) throw new Error('mute failed');
    return res.json();
  },
  relationshipToggleFollow: async (token: string, handle: string) => {
    const res = await authedFetch(
      `${apiBase}/identity/relationships/follow`,
      { method: 'POST', body: JSON.stringify({ handle }) },
      { token },
    );
    if (!res.ok) throw new Error('follow failed');
    return res.json();
  },
  relationshipToggleBlock: async (token: string, handle: string) => {
    const res = await authedFetch(
      `${apiBase}/identity/relationships/block`,
      { method: 'POST', body: JSON.stringify({ handle }) },
      { token },
    );
    if (!res.ok) throw new Error('block failed');
    return res.json();
  },
  listsList: async (token: string) => {
    const res = await authedFetch(`${apiBase}/lists/lists`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('lists failed');
    return res.json();
  },
  listsCreate: async (token: string, payload: { name: string; description?: string }) => {
    const res = await authedFetch(
      `${apiBase}/lists/lists`,
      { method: 'POST', body: JSON.stringify(payload) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'create list failed');
    return res.json();
  },
  listsGet: async (token: string, id: string) => {
    const res = await authedFetch(`${apiBase}/lists/lists/${encodeURIComponent(id)}`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('get list failed');
    return res.json();
  },
  listsTimeline: async (token: string, id: string) => {
    const res = await authedFetch(
      `${apiBase}/lists/lists/${encodeURIComponent(id)}/timeline`,
      { method: 'GET' },
      { token },
    );
    if (!res.ok) throw new Error('list timeline failed');
    return res.json();
  },
  listsAddItem: async (token: string, id: string, entryId: string) => {
    const res = await authedFetch(
      `${apiBase}/lists/lists/${encodeURIComponent(id)}/items`,
      { method: 'POST', body: JSON.stringify({ entry_id: entryId }) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'add item failed');
    return res.json();
  },
  listsRemoveItem: async (token: string, id: string, entryId: string) => {
    const res = await authedFetch(
      `${apiBase}/lists/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(entryId)}`,
      { method: 'DELETE' },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'remove item failed');
    return res.json();
  },
  listsUpdate: async (token: string, id: string, payload: { name: string; description?: string }) => {
    const res = await authedFetch(
      `${apiBase}/lists/lists/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify(payload) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'update list failed');
    return res.json();
  },
  search: async (token: string, q: string, opts?: { type?: 'all' | 'posts' | 'users' | 'topics'; trybe?: string }) => {
    const qs = new URLSearchParams();
    qs.set('q', q);
    if (opts?.type) qs.set('type', opts.type);
    if (opts?.trybe) qs.set('trybe', opts.trybe);
    const res = await authedFetch(`${apiBase}/search/search?${qs.toString()}`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('search failed');
    return res.json();
  },
  dmThreads: async (token: string, filter?: 'all' | 'unread' | 'requests') => {
    const qs = new URLSearchParams();
    if (filter) qs.set('filter', filter);
    const res = await authedFetch(`${apiBase}/messaging/threads?${qs.toString()}`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('threads failed');
    return res.json();
  },
  dmThread: async (token: string, id: string) => {
    const res = await authedFetch(`${apiBase}/messaging/threads/${encodeURIComponent(id)}`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('thread failed');
    return res.json();
  },
  dmMessages: async (token: string, threadId: string) => {
    const res = await authedFetch(
      `${apiBase}/messaging/threads/${encodeURIComponent(threadId)}/messages`,
      { method: 'GET' },
      { token },
    );
    if (!res.ok) throw new Error('messages failed');
    return res.json();
  },
  dmMarkRead: async (token: string, threadId: string) => {
    const res = await authedFetch(
      `${apiBase}/messaging/threads/${encodeURIComponent(threadId)}/read`,
      { method: 'POST', body: JSON.stringify({}) },
      { token },
    );
    if (!res.ok) throw new Error('mark read failed');
    return res.json();
  },
  dmSend: async (token: string, threadId: string, body: string) => {
    const res = await authedFetch(
      `${apiBase}/messaging/send`,
      { method: 'POST', headers: { 'x-idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ thread_id: threadId, body }) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'send failed');
    return res.json();
  },
  dmAccept: async (token: string, threadId: string) => {
    const res = await authedFetch(
      `${apiBase}/messaging/threads/${encodeURIComponent(threadId)}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'accept failed');
    return res.json();
  },
  dmDecline: async (token: string, threadId: string) => {
    const res = await authedFetch(
      `${apiBase}/messaging/threads/${encodeURIComponent(threadId)}/decline`,
      { method: 'POST', body: JSON.stringify({}) },
      { token, world: 'gathering' },
    );
    if (!res.ok) await throwWithCode(res, 'decline failed');
    return res.json();
  },
  health: async () => {
    const res = await fetch(`${apiBase}/healthz`);
    return { ok: res.ok };
  },
  policyStatus: async (token: string) => {
    const res = await authedFetch(`${apiBase}/identity/policy/status`, { method: 'GET' }, { token });
    if (!res.ok) throw new Error('policy status failed');
    return res.json();
  },
  policyAccept: async (token: string) => {
    const res = await authedFetch(
      `${apiBase}/identity/policy/accept`,
      { method: 'POST', body: JSON.stringify({ terms: true, privacy: true }) },
      { token },
    );
    if (!res.ok) await throwWithCode(res, 'policy accept failed');
    return res.json();
  },
  // Dev-only: force Gathering start/end for QA (requires ops role header at purge service).
  devGatheringStart: async (token: string, minutes: number = 30) => {
    const deviceId = await getDeviceId();
    const res = await fetch(`${apiBase}/purge/admin/start`, {
      method: 'POST',
      headers: {
        ...buildHeaders(token, undefined),
        'x-device-id': deviceId,
        'x-ops-role': 'dev',
      } as any,
      body: JSON.stringify({ minutes }),
    });
    if (!res.ok) await throwWithCode(res, 'dev gathering start failed');
    return res.json();
  },
  devGatheringSchedule: async (token: string, minutes: number = 5, startsInSeconds: number = 10) => {
    const deviceId = await getDeviceId();
    const res = await fetch(`${apiBase}/purge/admin/schedule`, {
      method: 'POST',
      headers: {
        ...buildHeaders(token, undefined),
        'x-device-id': deviceId,
        'x-ops-role': 'dev',
      } as any,
      body: JSON.stringify({ minutes, starts_in_seconds: startsInSeconds }),
    });
    if (!res.ok) await throwWithCode(res, 'dev gathering schedule failed');
    return res.json();
  },
  devGatheringEnd: async (token: string) => {
    const deviceId = await getDeviceId();
    const res = await fetch(`${apiBase}/purge/reset`, {
      method: 'POST',
      headers: {
        ...buildHeaders(token, undefined),
        'x-device-id': deviceId,
        'x-ops-role': 'dev',
      } as any,
      body: JSON.stringify({}),
    });
    if (!res.ok) await throwWithCode(res, 'dev gathering end failed');
    return res.json();
  },
};

