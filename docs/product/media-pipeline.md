# Media pipeline (v1)

This document defines the production-ready media pipeline contract. Current implementation is **dev QA friendly** (JSON base64 upload to Discourse). Production requires **signed object storage** and moderation hooks.

## Current (dev/local)
- Client calls: `POST /discourse/media/upload-url`
- Server returns:
  - `upload.id`
  - `upload.upload_url` (local endpoint)
  - `upload.public_url` (served via gateway)
- Client uploads base64 JSON to `POST /discourse/media/upload`
- Media served via `GET /discourse/media/:id` with long cache headers.

## Target (production)

### 1) Upload plan
`POST /discourse/media/upload-url`

Request:
- `type`: `image` | `video`
- `content_type`
- `byte_size`
- `filename`

Response:
- `upload.id`
- `upload.provider`: `s3` | `gcs`
- `upload.upload_url`: presigned URL (PUT) or multipart form POST
- `upload.headers` or `upload.fields`
- `upload.public_url`: CDN URL
- `upload.expires_at`

### 2) Finalize (optional)
For multi-part uploads, client calls `POST /discourse/media/finalize` with ETags/parts.

### 3) Moderation hooks (required)
On finalize:
- hash + store perceptual hash
- enqueue moderation pipeline:
  - CSAM checks
  - policy scanning (nudity/violence)
  - spam signals

### 4) Transformations
- thumbnails (small/medium/large)
- image metadata strip
- video poster frame
- content-type normalization

### 5) Failure states (mobile UX)
- upload plan error
- upload timeout
- unsupported type/size
- moderation rejection


