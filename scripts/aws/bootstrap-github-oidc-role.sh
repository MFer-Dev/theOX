#!/usr/bin/env bash
set -euo pipefail

# Creates an IAM role that GitHub Actions can assume via OIDC.
# You still need to attach least-privilege policies appropriate for your Terraform/ECR/ECS usage.
#
# Usage:
#   AWS_REGION=us-east-1 \
#   ROLE_NAME=genme-dev-github-deploy \
#   GITHUB_OWNER=yourorg \
#   GITHUB_REPO=trybl \
#   ./scripts/aws/bootstrap-github-oidc-role.sh

: "${AWS_REGION:?set AWS_REGION}"
: "${ROLE_NAME:?set ROLE_NAME}"
: "${GITHUB_OWNER:?set GITHUB_OWNER}"
: "${GITHUB_REPO:?set GITHUB_REPO}"

OIDC_URL="token.actions.githubusercontent.com"

echo "Ensuring GitHub OIDC provider exists..."
PROVIDER_ARN="$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[].Arn" --output text | tr '\t' '\n' | grep "${OIDC_URL}" || true)"

if [[ -z "${PROVIDER_ARN}" ]]; then
  # Thumbprint list for GitHub Actions OIDC (can change; AWS recommends using the current root CA thumbprint).
  # If this fails in your account, update thumbprints per AWS docs.
  aws iam create-open-id-connect-provider \
    --url "https://${OIDC_URL}" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    >/dev/null
  PROVIDER_ARN="$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[].Arn" --output text | tr '\t' '\n' | grep "${OIDC_URL}" | head -n 1)"
fi

echo "OIDC provider ARN: ${PROVIDER_ARN}"

cat > /tmp/genme-github-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "${OIDC_URL}:aud": "sts.amazonaws.com" },
        "StringLike": {
          "${OIDC_URL}:sub": [
            "repo:${GITHUB_OWNER}/${GITHUB_REPO}:ref:refs/heads/main",
            "repo:${GITHUB_OWNER}/${GITHUB_REPO}:pull_request"
          ]
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name "${ROLE_NAME}" \
  --assume-role-policy-document file:///tmp/genme-github-trust.json \
  >/dev/null 2>&1 || true

echo "Role ensured: ${ROLE_NAME}"
echo "Next: attach policies for Terraform + ECR + ECS as needed."
echo "Suggested output to store in GitHub env secret AWS_ROLE_ARN:"
aws iam get-role --role-name "${ROLE_NAME}" --query "Role.Arn" --output text

