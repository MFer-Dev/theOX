#!/usr/bin/env bash
set -euo pipefail

# Creates an S3 bucket + DynamoDB lock table for Terraform remote state.
# You must have AWS credentials configured locally (aws sts get-caller-identity must work).
#
# Usage:
#   AWS_REGION=us-east-1 TF_STATE_BUCKET=genme-tf-state-dev TF_STATE_TABLE=genme-tf-locks ./scripts/aws/bootstrap-state.sh

: "${AWS_REGION:?set AWS_REGION}"
: "${TF_STATE_BUCKET:?set TF_STATE_BUCKET}"
: "${TF_STATE_TABLE:?set TF_STATE_TABLE}"

echo "Using region: ${AWS_REGION}"
echo "State bucket: ${TF_STATE_BUCKET}"
echo "Lock table:   ${TF_STATE_TABLE}"

if aws s3api head-bucket --bucket "${TF_STATE_BUCKET}" >/dev/null 2>&1; then
  echo "Bucket already exists: ${TF_STATE_BUCKET}"
else
  echo "Creating bucket: ${TF_STATE_BUCKET}"
  if [[ "${AWS_REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket \
      --bucket "${TF_STATE_BUCKET}" \
      --region "${AWS_REGION}" \
      >/dev/null
  else
    aws s3api create-bucket \
      --bucket "${TF_STATE_BUCKET}" \
      --region "${AWS_REGION}" \
      --create-bucket-configuration "LocationConstraint=${AWS_REGION}" \
      >/dev/null
  fi
fi

aws s3api put-bucket-versioning \
  --bucket "${TF_STATE_BUCKET}" \
  --versioning-configuration Status=Enabled \
  >/dev/null

aws s3api put-bucket-encryption \
  --bucket "${TF_STATE_BUCKET}" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }' >/dev/null

aws dynamodb create-table \
  --region "${AWS_REGION}" \
  --table-name "${TF_STATE_TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  >/dev/null 2>&1 || true

echo "OK: Terraform state backend is ready."

