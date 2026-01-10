const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const apiGet = async <T>(path: string, opts?: { opsRole?: string }): Promise<T> => {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      'x-correlation-id': crypto.randomUUID(),
      ...(opts?.opsRole ? { 'x-ops-role': opts.opsRole } : {}),
    },
    cache: 'no-store',
  } as any);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
};

