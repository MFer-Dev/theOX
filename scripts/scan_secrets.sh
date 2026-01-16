#!/usr/bin/env bash
# Simple secrets scanner for theOX repository
# Scans for common patterns that might indicate leaked secrets

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Scanning for potential secrets..."
echo ""

FOUND=0

# Patterns to search for (excluding common false positives)
PATTERNS=(
  "AKIA[0-9A-Z]{16}"                    # AWS Access Key ID
  "aws_secret_access_key"               # AWS Secret Key
  "sk-[a-zA-Z0-9]{48}"                  # OpenAI API Key
  "ghp_[a-zA-Z0-9]{36}"                 # GitHub Personal Access Token
  "gho_[a-zA-Z0-9]{36}"                 # GitHub OAuth Token
  "github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}"  # GitHub Fine-grained PAT
  "xox[baprs]-[0-9a-zA-Z-]{10,}"        # Slack tokens
  "-----BEGIN.*PRIVATE KEY-----"        # Private keys
  "password.*=.*['\"][^'\"]{8,}"        # Hardcoded passwords
)

# Files/dirs to exclude
EXCLUDE_DIRS="node_modules|\.git|dist|build|\.next|\.turbo|coverage|logs"
EXCLUDE_FILES="\.lock$|\.png$|\.jpg$|\.svg$|\.ico$|\.woff"
EXCLUDE_PATTERNS="smoke/|seed/|test|\.tsx|password_hash|Password123"

for pattern in "${PATTERNS[@]}"; do
  # Use grep with extended regex, exclude common dirs/files/patterns
  matches=$(grep -rEn "$pattern" . \
    --include="*.ts" --include="*.js" \
    --include="*.json" --include="*.yml" --include="*.yaml" --include="*.env*" \
    --include="*.sh" \
    2>/dev/null | grep -Ev "$EXCLUDE_DIRS" | grep -Ev "$EXCLUDE_PATTERNS" | grep -Ev "\.example|scan_secrets" || true)

  if [[ -n "$matches" ]]; then
    echo -e "${RED}Potential secret found matching pattern: $pattern${NC}"
    echo "$matches"
    echo ""
    FOUND=1
  fi
done

# Check for .env files that shouldn't be committed
ENV_FILES=$(find . -name ".env" -o -name ".env.local" -o -name ".env.production" 2>/dev/null | grep -v node_modules || true)
if [[ -n "$ENV_FILES" ]]; then
  echo -e "${YELLOW}Warning: .env files found (ensure they're in .gitignore):${NC}"
  echo "$ENV_FILES"
  echo ""
fi

# Verify .gitignore contains .env
if ! grep -q "^\.env" .gitignore 2>/dev/null; then
  echo -e "${YELLOW}Warning: .gitignore may not exclude .env files${NC}"
  FOUND=1
fi

if [[ $FOUND -eq 0 ]]; then
  echo -e "${GREEN}No obvious secrets found.${NC}"
  exit 0
else
  echo -e "${RED}Review the above findings.${NC}"
  exit 1
fi
