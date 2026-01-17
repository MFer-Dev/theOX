# theOX Monorepo Makefile
# Run `make help` for available targets

.PHONY: help install up down dev dev\:ops dev\:mobile lint typecheck format test smoke clean build migrate seed-ox replay-ox sim-throughput test-invariants test-physics-invariants test-world-invariants test-replay-invariants seed-physics smoke-world test-sponsor-policies test-arena-actions test-economy test-foundry smoke-phase7-10

# Default target
help:
	@echo "theOX Monorepo Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install      Install all dependencies"
	@echo "  make up           Start local infrastructure (Postgres, Redis, Redpanda)"
	@echo "  make down         Stop local infrastructure"
	@echo ""
	@echo "Development:"
	@echo "  make dev          Start all backend services"
	@echo "  make dev:ops      Start ops-console (Next.js)"
	@echo "  make dev:mobile   Start mobile Metro bundler"
	@echo ""
	@echo "Quality:"
	@echo "  make lint         Run ESLint across all packages"
	@echo "  make typecheck    Run TypeScript type checking"
	@echo "  make format       Format code with Prettier"
	@echo "  make test         Run all tests"
	@echo "  make smoke        Run smoke tests (requires services running)"
	@echo ""
	@echo "Build:"
	@echo "  make build        Build all packages"
	@echo "  make clean        Remove build artifacts and node_modules"
	@echo ""
	@echo "Database:"
	@echo "  make migrate      Run all service migrations"
	@echo ""
	@echo "OX Verification:"
	@echo "  make seed-ox                 Seed OX with test scenarios"
	@echo "  make replay-ox               Verify projection determinism"
	@echo "  make sim-throughput          Run throughput burst simulation"
	@echo "  make test-invariants         Run OX invariant tests"
	@echo "  make test-physics-invariants Run OX Physics invariant tests"
	@echo "  make test-world-invariants   Run OX World State invariant tests"
	@echo "  make test-replay-invariants  Run OX Replay Harness invariant tests"
	@echo "  make test-sponsor-policies   Run sponsor policy tests"
	@echo "  make test-arena-actions      Run arena action tests"
	@echo "  make test-economy            Run economy tests"
	@echo "  make test-foundry            Run Foundry tests"
	@echo "  make seed-physics            Seed physics with storm regime"
	@echo "  make smoke-world             Smoke test world state endpoints"
	@echo "  make smoke-phase7-10         Smoke test Phase 7-10 features"

# ============================================================================
# SETUP
# ============================================================================

install:
	pnpm install

up:
	docker compose up -d
	@echo "Waiting for services to be healthy..."
	@sleep 5
	@docker compose ps

down:
	docker compose down

# ============================================================================
# DEVELOPMENT
# ============================================================================

dev:
	bash scripts/dev/core-stack.sh up

dev\:ops:
	pnpm --filter @apps/ops-console dev

dev\:mobile:
	pnpm --filter @apps/mobile start

# ============================================================================
# QUALITY
# ============================================================================

lint:
	pnpm lint

typecheck:
	pnpm typecheck

format:
	pnpm exec prettier --write "**/*.{ts,tsx,js,jsx,json,md}" --ignore-path .gitignore

format\:check:
	pnpm exec prettier --check "**/*.{ts,tsx,js,jsx,json,md}" --ignore-path .gitignore

test:
	pnpm test

smoke:
	pnpm smoke

# ============================================================================
# BUILD
# ============================================================================

build:
	pnpm build

clean:
	rm -rf node_modules
	rm -rf apps/*/node_modules
	rm -rf services/*/node_modules
	rm -rf platform/*/node_modules
	rm -rf workers/*/node_modules
	rm -rf apps/*/.next
	rm -rf apps/*/dist
	rm -rf services/*/dist
	rm -rf platform/*/dist
	rm -rf workers/*/dist
	rm -rf .turbo
	rm -rf apps/*/.turbo
	rm -rf services/*/.turbo
	rm -rf platform/*/.turbo
	rm -rf workers/*/.turbo

# ============================================================================
# DATABASE
# ============================================================================

migrate:
	@echo "Running migrations for all services..."
	-pnpm --filter @services/identity migrate
	-pnpm --filter @services/discourse migrate
	-pnpm --filter @services/safety migrate
	-pnpm --filter @services/cred migrate
	-pnpm --filter @services/endorse migrate
	-pnpm --filter @services/notes migrate
	-pnpm --filter @services/purge migrate
	-pnpm --filter @services/notifications migrate
	-pnpm --filter @services/ops-gateway migrate
	-pnpm --filter @services/ops-agents migrate
	-pnpm --filter @services/agents migrate
	-pnpm --filter @services/ox-read migrate
	-pnpm --filter @services/ox-physics migrate
	-pnpm --filter @workers/materializer migrate
	-pnpm --filter @workers/integrity migrate
	@echo "Migrations complete."

migrate\:identity:
	pnpm --filter @services/identity migrate

migrate\:discourse:
	pnpm --filter @services/discourse migrate

migrate\:safety:
	pnpm --filter @services/safety migrate

# ============================================================================
# OX VERIFICATION
# ============================================================================

seed-ox:
	@echo "Seeding OX scenarios..."
	pnpm exec tsx scripts/seed/ox_scenarios.ts

replay-ox:
	@echo "Running OX replay verification..."
	pnpm exec tsx scripts/replay/ox_read_replay.ts

sim-throughput:
	@echo "Running throughput burst simulation..."
	pnpm exec tsx scripts/sim/throughput_burst.ts

test-invariants:
	@echo "Running OX invariant tests..."
	node --import tsx --test tests/invariants/ox_invariants.test.ts

test-physics-invariants:
	@echo "Running OX Physics invariant tests..."
	node --import tsx --test tests/invariants/ox_physics_invariants.test.ts

test-world-invariants:
	@echo "Running OX World State invariant tests..."
	node --import tsx --test tests/invariants/ox_world_state_invariants.test.ts

test-replay-invariants:
	@echo "Running OX Replay Harness invariant tests..."
	pnpm exec tsx --test tests/invariants/ox_replay_invariants.test.ts

seed-physics:
	@echo "Seeding physics with test regime..."
	curl -s -X POST http://localhost:4019/deployments/ox-sandbox/apply-regime \
		-H "Content-Type: application/json" \
		-H "x-ops-role: test" \
		-d '{"regime_name":"storm"}' | jq .
	@echo "Triggering physics tick..."
	curl -s -X POST http://localhost:4019/deployments/ox-sandbox/tick \
		-H "x-ops-role: test" | jq .

smoke-world:
	@echo "Smoke testing world state endpoints..."
	@echo "GET /ox/world (viewer):"
	curl -s http://localhost:4018/ox/world \
		-H "x-observer-id: smoke-test" \
		-H "x-observer-role: viewer" | jq .
	@echo ""
	@echo "GET /ox/world (analyst):"
	curl -s http://localhost:4018/ox/world \
		-H "x-observer-id: smoke-test" \
		-H "x-observer-role: analyst" | jq .
	@echo ""
	@echo "GET /ox/world/ox-sandbox (auditor):"
	curl -s http://localhost:4018/ox/world/ox-sandbox \
		-H "x-observer-id: smoke-test" \
		-H "x-observer-role: auditor" | jq .
	@echo ""
	@echo "GET /ox/world/ox-sandbox/history (analyst):"
	curl -s http://localhost:4018/ox/world/ox-sandbox/history \
		-H "x-observer-id: smoke-test" \
		-H "x-observer-role: analyst" | jq .
	@echo ""
	@echo "GET /ox/world/ox-sandbox/effects (analyst):"
	curl -s http://localhost:4018/ox/world/ox-sandbox/effects \
		-H "x-observer-id: smoke-test" \
		-H "x-observer-role: analyst" | jq .

# ============================================================================
# PHASE 7-10 TESTS
# ============================================================================

test-sponsor-policies:
	@echo "Running sponsor policy invariant tests..."
	pnpm exec tsx --test tests/invariants/ox_sponsor_policies.test.ts

test-arena-actions:
	@echo "Running arena action invariant tests..."
	pnpm exec tsx --test tests/invariants/ox_arena_actions.test.ts

test-economy:
	@echo "Running economy invariant tests..."
	pnpm exec tsx --test tests/invariants/ox_economy.test.ts

test-foundry:
	@echo "Running Foundry invariant tests..."
	pnpm exec tsx --test tests/invariants/ox_foundry.test.ts

smoke-phase7-10:
	@echo "Smoke testing Phase 7-10 features..."
	@echo "=== Creating test sponsor and agent ==="
	$(eval SPONSOR_ID := $(shell uuidgen | tr '[:upper:]' '[:lower:]'))
	@echo "Sponsor ID: $(SPONSOR_ID)"
	@echo ""
	@echo "--- Purchasing credits ---"
	curl -s -X POST http://localhost:4017/sponsor/$(SPONSOR_ID)/credits/purchase \
		-H "Content-Type: application/json" \
		-d '{"amount": 1000}' | jq .
	@echo ""
	@echo "--- Creating agent via Foundry ---"
	curl -s -X POST http://localhost:4017/foundry/agents \
		-H "Content-Type: application/json" \
		-d '{"handle": "smoke-agent", "deployment_target": "ox-lab", "sponsor_id": "$(SPONSOR_ID)", "config": {"cognition_provider": "none"}}' | jq .
	@echo ""
	@echo "--- Creating sponsor policy ---"
	curl -s -X POST http://localhost:4017/sponsor/$(SPONSOR_ID)/policies \
		-H "Content-Type: application/json" \
		-d '{"policy_type": "capacity", "cadence_seconds": 60, "rules": [{"if": [{"field": "env.weather_state", "op": "eq", "value": "stormy"}], "then": {"action": "allocate_delta", "params": {"delta": 10}}}]}' | jq .
	@echo ""
	@echo "--- Listing sponsor policies ---"
	curl -s http://localhost:4017/sponsor/$(SPONSOR_ID)/policies | jq .
	@echo ""
	@echo "--- Listing Foundry agents ---"
	curl -s http://localhost:4017/foundry/agents?limit=5 | jq .
	@echo ""
	@echo "=== Phase 7-10 smoke test complete ==="
