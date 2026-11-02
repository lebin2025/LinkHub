#!/usr/bin/env bash
# 一键端到端（macOS / Linux / Git Bash）：启动后端 → 等就绪 → 跑 smoke.py → 关服务
# 用法：pnpm e2e:sh   或   bash scripts/e2e.sh [port]
set -euo pipefail

PORT="${1:-3001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="http://127.0.0.1:$PORT"
LOG="$ROOT/scripts/e2e-server.log"

cd "$ROOT"
echo "[e2e] 工作目录: $ROOT"
echo "[e2e] 启动后端服务 (port=$PORT) ..."
SERVER_PORT="$PORT" pnpm --filter @unimsg/server start > "$LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  echo "[e2e] 关闭服务..."
  kill "$SERVER_PID" 2>/dev/null || true
  pkill -P "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 40); do
  if curl -sf "$BASE/api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "[e2e] 服务未在 20 秒内就绪，日志如下："
  tail -n 20 "$LOG" || true
  exit 1
fi

echo "[e2e] 服务就绪，开始冒烟..."
python3 scripts/smoke.py "$BASE"
