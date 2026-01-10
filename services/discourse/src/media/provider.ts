export type MediaUploadPlan = {
  id: string;
  provider: 'local' | 's3';
  upload_url: string;
  public_url: string;
  headers?: Record<string, string>;
  expires_at?: string | null;
  object_key?: string | null;
};

export type MediaUploadRequest = {
  user_id: string;
  type: 'image' | 'video';
  content_type?: string | null;
  byte_size?: number | null;
  filename?: string | null;
};

export interface MediaProvider {
  name: MediaUploadPlan['provider'];
  createUploadPlan: (req: MediaUploadRequest) => Promise<MediaUploadPlan>;
}


