// Mobile observability baseline (v1).
// - No external networked vendor required; safe no-op hooks.
// - Swap in Sentry/OTel later without changing call sites.

type Scope = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

let scope: Scope = { tags: {}, extra: {} };

export const setTag = (key: string, value: string) => {
  scope.tags = { ...(scope.tags ?? {}), [key]: value };
};

export const setExtra = (key: string, value: unknown) => {
  scope.extra = { ...(scope.extra ?? {}), [key]: value };
};

export const captureException = (err: unknown, context?: Record<string, unknown>) => {
  // eslint-disable-next-line no-console
  console.error('captureException', err, { ...(scope.extra ?? {}), ...(context ?? {}), tags: scope.tags ?? {} });
};

export const breadcrumb = (message: string, data?: Record<string, unknown>) => {
  // eslint-disable-next-line no-console
  console.log('breadcrumb', message, { ...(data ?? {}), tags: scope.tags ?? {} });
};


