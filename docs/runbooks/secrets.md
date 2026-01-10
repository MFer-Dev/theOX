## Secrets management (placeholder)

### Requirements
- No secrets committed to git.
- Separate secrets per environment (dev/stage/prod).
- Rotation plan for: JWT secrets, DB creds, push creds, S3 keys (if used), Redis auth.

### Recommended approach (AWS)
- **AWS Secrets Manager**: long-lived credentials (DB password, Redis auth token).
- **SSM Parameter Store**: non-secret config and some low-risk values.
- **IAM roles**: services assume roles; avoid static AWS keys for production.

### Naming convention
- `/genme/{env}/identity/ACCESS_TOKEN_SECRET`
- `/genme/{env}/identity/REFRESH_TOKEN_SECRET`
- `/genme/{env}/db/{service}/DATABASE_URL`
- `/genme/{env}/redis/REDIS_URL`
- `/genme/{env}/events/REDPANDA_BROKERS`


