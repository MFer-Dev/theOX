# Contributing

## Branching & Commits
- Use short, descriptive branches (e.g., `feature/identity-auth`, `chore/infra-compose`).
- Conventional Commits preferred (`feat:`, `fix:`, `chore:`) to keep history clean.

## Pull Requests
- Include scope, risk, and test notes.
- Required checks: `pnpm lint`, `pnpm test`, `pnpm build` (via Turbo pipelines).
- Keep changes small and reviewable; link to relevant docs or decisions.

## Code Owners & Reviews
- CODEOWNERS governs approvers; default is repo maintainers.
- Seek review from domain owners (services, mobile, ops console, platform).

## Quality Bar
- TypeScript strict mode; no implicit anys.
- Lint + format before pushing.
- Add or update tests for any logic change (unit/integration as applicable).

## Secrets & Security
- Never commit secrets or production credentials.
- Use local `.env` files; rotate credentials if exposure is suspected.

## How to Run
```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm dev   # turbo dev across packages
```

