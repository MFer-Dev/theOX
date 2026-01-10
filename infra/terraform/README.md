# Terraform

Environment roots:
- `infra/terraform/environments/dev`
- `infra/terraform/environments/stage`
- `infra/terraform/environments/prod`

Modules:
- `infra/terraform/modules/media` (S3 + optional CloudFront scaffold)
- `infra/terraform/modules/postgres` (RDS Postgres)
- `infra/terraform/modules/redis` (ElastiCache Redis)
- `infra/terraform/modules/events` (placeholder)

## Remote state
This repo expects S3 + DynamoDB for Terraform state locking.
Use `scripts/aws/bootstrap-state.sh` to create them.

## GitHub Actions deploy
See `docs/runbooks/aws-setup.md` and `.github/workflows/deploy-dev.yml`.

