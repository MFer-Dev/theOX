import type { MediaProvider, MediaUploadPlan, MediaUploadRequest } from '../provider';

// S3 provider scaffold.
// Intentionally does NOT import AWS SDK packages (to keep repo install-free).
// When wiring production, install:
// - @aws-sdk/client-s3
// - @aws-sdk/s3-request-presigner
// and implement createUploadPlan with signed PUT (or POST) + CloudFront public_url.

export const createS3StubProvider = (): MediaProvider => {
  return {
    name: 's3',
    async createUploadPlan(_req: MediaUploadRequest): Promise<MediaUploadPlan> {
      throw new Error('media_provider_not_configured');
    },
  };
};


