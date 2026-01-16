#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="${ROOT}/logs"
PID_FILE="${ROOT}/.pids/core-stack.json"
SERVICES=(identity cred discourse purge endorse safety trustgraph notifications search messaging lists gateway ops-gateway ops-agents agents ox-read)
URLS=(
  "http://localhost:4001/readyz"
  "http://localhost:4004/readyz"
  "http://localhost:4002/readyz"
  "http://localhost:4003/readyz"
  "http://localhost:4005/readyz"
  "http://localhost:4008/readyz"
  "http://localhost:4007/readyz"
  "http://localhost:4009/readyz"
  "http://localhost:4010/readyz"
  "http://localhost:4011/readyz"
  "http://localhost:4012/readyz"
  "http://localhost:4000/readyz"
  "http://localhost:4013/readyz"
  "http://localhost:4014/readyz"
  "http://localhost:4017/readyz"
  "http://localhost:4018/readyz"
)

mkdir -p "${LOG_DIR}"
mkdir -p "${ROOT}/.pids"

# Global PIDS array (written by start_all, read by write_pids)
PIDS=()

ensure_compose() {
  local host="${POSTGRES_HOST:-localhost}"
  local port="${POSTGRES_PORT:-5433}"
  if nc -z "${host}" "${port}" >/dev/null 2>&1; then
    echo "Postgres reachable on ${host}:${port}"
    return 0
  fi
  echo "Postgres not ready on ${host}:${port}, starting docker compose..."
  (cd "${ROOT}" && docker compose up -d)
}

start_service() {
  local name="$1"
  local log_file="${LOG_DIR}/${name}.log"
  echo "Starting ${name}..." >&2
  (cd "${ROOT}" && nohup pnpm --filter "@services/${name}" dev >"${log_file}" 2>&1 & echo $!)
}

wait_ready() {
  local url="$1"
  local name="$2"
  local deadline=$((SECONDS + 60))
  until curl -fsS "${url}" >/dev/null 2>&1; do
    if (( SECONDS > deadline )); then
      echo "Service ${name} failed to become ready (${url})"
      return 1
    fi
    sleep 2
  done
  echo "Service ${name} ready at ${url}"
  return 0
}

write_pids() {
  local json="{"
  for i in "${!SERVICES[@]}"; do
    local svc="${SERVICES[$i]}"
    local pid="${PIDS[$i]:-0}"
    # ensure numeric
    if [[ ! "${pid}" =~ ^[0-9]+$ ]]; then pid="0"; fi
    json+="\"${svc}\":${pid}"
    if (( i < ${#SERVICES[@]} -1 )); then
      json+=","
    fi
  done
  json+="}"
  echo "${json}" > "${PID_FILE}"
}

start_all() {
  ensure_compose
  PIDS=()
  for i in "${!SERVICES[@]}"; do
    svc="${SERVICES[$i]}"
    # skip if already healthy
    if curl -fsS "${URLS[$i]}" >/dev/null 2>&1; then
      echo "Service ${svc} already healthy, skipping start."
      PIDS+=("0")
      continue
    fi
    pid=$(start_service "${svc}")
    PIDS+=("${pid}")
  done
  write_pids

  # wait for readiness
  for i in "${!SERVICES[@]}"; do
    svc="${SERVICES[$i]}"
    wait_ready "${URLS[$i]}" "${svc}"
  done

  echo "Core stack started."
  echo "Service URLs:"
  echo "  identity    http://localhost:4001"
  echo "  cred        http://localhost:4004"
  echo "  discourse   http://localhost:4002"
  echo "  purge       http://localhost:4003"
  echo "  endorse     http://localhost:4005"
  echo "  safety      http://localhost:4008"
  echo "  trustgraph  http://localhost:4007"
  echo "  notifications http://localhost:4009"
  echo "  search        http://localhost:4010"
  echo "  messaging     http://localhost:4011"
  echo "  lists         http://localhost:4012"
  echo "  gateway       http://localhost:4000"
  echo "  ops-gateway   http://localhost:4013"
  echo "  ops-agents    http://localhost:4014"
  echo "  agents        http://localhost:4017"
  echo "  ox-read       http://localhost:4018"
}

stop_all() {
  if [[ -f "${PID_FILE}" ]]; then
    if node -e "const fs=require('fs');const f='${PID_FILE}';const raw=fs.readFileSync(f,'utf8');JSON.parse(raw);" >/dev/null 2>&1; then
      node -e "const fs=require('fs');const f='${PID_FILE}';const data=JSON.parse(fs.readFileSync(f,'utf8'));for(const pid of Object.values(data)){if(pid&&pid>0){try{process.kill(pid,'SIGTERM')}catch{}}}fs.rmSync(f,{force:true});"
      echo "Core stack stopped."
      return 0
    fi
    echo "PID file is invalid; falling back to port-based shutdown."
    rm -f "${PID_FILE}"
  fi

  # Fallback: kill any process listening on expected ports.
  for url in "${URLS[@]}"; do
    port="$(echo "${url}" | sed -E 's#^https?://[^:]+:([0-9]+)/.*#\\1#')"
    if [[ "${port}" =~ ^[0-9]+$ ]]; then
      pids="$(lsof -ti tcp:"${port}" 2>/dev/null || true)"
      if [[ -n "${pids}" ]]; then
        echo "${pids}" | xargs -n 1 kill -TERM >/dev/null 2>&1 || true
      fi
    fi
  done
  echo "Core stack stop attempted (port-based)."
}

cmd="${1:-up}"
case "${cmd}" in
  up) start_all ;;
  down) stop_all ;;
  *) echo "Usage: $0 {up|down}"; exit 1 ;;
esac

