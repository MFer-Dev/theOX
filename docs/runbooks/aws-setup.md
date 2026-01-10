# AWS setup (from scratch) — GitHub Actions + Terraform + ECS-ready

This repo is set up so you can:
- bootstrap AWS once from your laptop (state + OIDC role)
- then run Terraform and deployments via GitHub Actions (no static AWS keys in GitHub)

## 0) Prereqs
- AWS CLI installed + authenticated (`aws sts get-caller-identity` works)
- Terraform installed (>= 1.5)
- A GitHub repo where this code lives

## 1) Decide your “first deploy slice”
Recommended minimum:
- `services/gateway` (public API entry)
- `apps/ops-console` (ops UI)
- `services/ops-gateway` + `services/ops-agents` (ops plane; can be private/internal later)

## 2) Bootstrap Terraform remote state (one-time per environment/account)
Pick names (example):
- `TF_STATE_BUCKET=genme-tf-state-dev`
- `TF_STATE_TABLE=genme-tf-locks-dev`

Run:

```bash
AWS_REGION=us-east-1 \
TF_STATE_BUCKET=genme-tf-state-dev \
TF_STATE_TABLE=genme-tf-locks-dev \
./scripts/aws/bootstrap-state.sh
```

## 3) Bootstrap GitHub Actions OIDC role (one-time per environment/account)
Run:

```bash
AWS_REGION=us-east-1 \
ROLE_NAME=genme-dev-github-deploy \
GITHUB_OWNER=YOUR_GITHUB_ORG \
GITHUB_REPO=YOUR_REPO_NAME \
./scripts/aws/bootstrap-github-oidc-role.sh
```

Copy the printed role ARN and store it in GitHub:
- **Environment**: `dev`
- **Secret**: `AWS_ROLE_ARN`

## 4) Configure GitHub environment variables
In GitHub → Settings → Environments → `dev`:
- **Variables**
  - `AWS_REGION` (e.g. `us-east-1`)
  - `TF_STATE_BUCKET` (e.g. `genme-tf-state-dev`)
  - `TF_STATE_TABLE` (e.g. `genme-tf-locks-dev`)
- **Secrets**
  - `AWS_ROLE_ARN` (from step 3)

## 5) Run the first deploy
Push to `main` or manually run workflow:
- `.github/workflows/deploy-dev.yml`

This first workflow only runs **terraform init/apply** for `infra/terraform/environments/dev`.
Next step is wiring that Terraform env to provision VPC/RDS/Redis/ECR/ECS and then extending the workflow to build+push images and roll ECS services.

