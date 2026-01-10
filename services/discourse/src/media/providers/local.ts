import type { MediaProvider, MediaUploadPlan, MediaUploadRequest } from '../provider';

export const createLocalProvider = (opts: { publicBaseUrl: string }) => {
  const provider: MediaProvider = {
    name: 'local',
    async createUploadPlan(_req: MediaUploadRequest): Promise<MediaUploadPlan> {
      const id = (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}`;
      return {
        id,
        provider: 'local',
        upload_url: '/media/upload',
        headers: {},
        public_url: `${opts.publicBaseUrl}/${encodeURIComponent(id)}`,
        expires_at: null,
      };
    },
  };
  return provider;
};


