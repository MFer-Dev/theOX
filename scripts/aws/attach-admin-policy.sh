#!/usr/bin/env bash
set -euo pipefail

# DEV-ONLY helper: attach AdministratorAccess to the GitHub deploy role.
# This unblocks early Terraform + ECS iteration fast. Replace with least-privilege before real prod.
#
# Usage:
#   ROLE_NAME=genme-dev-github-deploy ./scripts/aws/attach-admin-policy.sh

: "${ROLE_NAME:?set ROLE_NAME}"

echo "Attaching AdministratorAccess to role: ${ROLE_NAME}"
aws iam attach-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

echo "OK. Reminder: remove AdministratorAccess and replace with least-privilege before production."

