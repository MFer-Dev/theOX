// Ops console API adapter (local-first).
// Backend: @services/ops-gateway (cookie session)

import { Role } from '@platform/security';

type Session = { user: { id: string; email: string; role: Role } } | { user: null };

const baseUrl = process.env.NEXT_PUBLIC_OPS_API_BASE_URL ?? 'http://localhost:4013';
const agentsUrl = process.env.NEXT_PUBLIC_OPS_AGENTS_URL ?? 'http://localhost:4014';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'x-correlation-id': crypto.randomUUID() },
    cache: 'no-store',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export const opsClient = {
  async me(): Promise<Session> {
    return apiGet('/ops/auth/me');
  },
  async login(payload: { email: string; password: string; mfa?: string }) {
    const res = await fetch(`${baseUrl}/ops/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ email: payload.email, password: payload.password }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.json();
  },
  async mfa(_payload: { token: string }) {
    return { ok: true };
  },
  async logout() {
    const res = await fetch(`${baseUrl}/ops/auth/logout`, {
      method: 'POST',
      headers: { 'x-correlation-id': crypto.randomUUID() },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Logout failed: ${res.status}`);
    return res.json();
  },
  async usersSearch(query: string) {
    return apiGet(`/ops/users/search?q=${encodeURIComponent(query)}`);
  },
  async userDetail(id: string) {
    return apiGet(`/ops/users/${encodeURIComponent(id)}`);
  },
  async config() {
    return apiGet('/ops/config');
  },
  async audit() {
    return apiGet('/ops/audit');
  },
  async healthSummary() {
    return apiGet('/ops/observability/health');
  },
  async errorInbox() {
    return apiGet('/ops/observability/error-inbox');
  },
  async purgeSurgeRecommendations() {
    return apiGet('/ops/purge/surge-recommendations');
  },
  async integrityTriageSuggestions() {
    return apiGet('/ops/integrity/triage-suggestions');
  },
  async trustUser(userId: string) {
    return apiGet(`/ops/trust/user/${encodeURIComponent(userId)}`);
  },
  async credLedger(userId: string) {
    return apiGet(`/ops/cred/ledger?user_id=${encodeURIComponent(userId)}`);
  },
  async materializerStatus() {
    return apiGet('/ops/system/materializer/status');
  },
  async agentTasks() {
    const res = await fetch(`${agentsUrl}/tasks`, {
      headers: { 'x-correlation-id': crypto.randomUUID() },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async agentCreateTask(payload: { type: string; summary: string; evidence?: any }) {
    const res = await fetch(`${agentsUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async agentApproveTask(
    id: string,
    decision: 'approved' | 'rejected' = 'approved',
    reason?: string,
    patched_action?: any,
  ) {
    const me: any = await opsClient.me();
    const ops_user = me?.user?.email ?? 'ops';
    const ops_role = me?.user?.role ?? Role.CoreOps;
    const res = await fetch(`${agentsUrl}/tasks/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ decision, reason, ops_user, ops_role, patched_action: patched_action ?? null }),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async moderationQueue() {
    return apiGet('/ops/moderation/queue');
  },
  async moderationDetail(_id: string) {
    return apiGet(`/ops/moderation/${encodeURIComponent(_id)}`);
  },
  async moderationAction(_id: string, _action: string, _reason: string, _notes?: string) {
    const res = await fetch(`${baseUrl}/ops/moderation/${encodeURIComponent(_id)}/action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': crypto.randomUUID(),
      },
      body: JSON.stringify({ decision: _action, reason: _reason, notes: _notes }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async safetyRevokeFriction(frictionId: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/safety/friction/${encodeURIComponent(frictionId)}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async safetyClearFriction(frictionId: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/safety/friction/${encodeURIComponent(frictionId)}/clear`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async safetyLiftRestrictions(userId: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/safety/restrictions/lift`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ user_id: userId, reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async safetyLiftRestriction(restrictionId: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/safety/restrictions/${encodeURIComponent(restrictionId)}/lift`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async discourseRestoreEntry(entryId: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/discourse/entries/${encodeURIComponent(entryId)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async incidentsRecent() {
    return [];
  },
  async userAction(_id: string, _action: string, _reason: string, _notes?: string) {
    return { ok: true };
  },
  async safetyAppeals() {
    return apiGet('/ops/safety/appeals');
  },
  async safetyResolveAppeal(id: string, resolution: string, reason: string) {
    const res = await fetch(`${baseUrl}/ops/safety/appeals/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ resolution, reason }),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return res.json();
  },
  async safetyFriction() {
    return apiGet('/ops/safety/friction');
  },
};

