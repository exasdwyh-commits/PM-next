#!/usr/bin/env bash
#
# LLM 润色链路 E2E 验收启动器
#
# 为什么存在：场景 2-6 需要**服务进程**以 ADVISOR_LLM_ENABLED=true 启动 ——
# Next.js 的环境变量在进程启动时读取，套件中途改不了。本脚本负责：
#   1. 起本地 mock OpenAI 兼容端点（scripts/mock-openai-server.cjs，仅 127.0.0.1）
#   2. 以 LLM 启用配置起生产模式 next start（端口 3182/3183，避开默认验收段）
#   3. 以 LLM_E2E_ENABLED=1 跑 acceptance-llm-advisor.test.ts（走真实 HTTP + 测试库）
#   4. 无论成败回收全部子进程
#
# 用法：bash scripts/acc-llm-e2e.sh [--skip-build]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

API_PORT="${LLM_E2E_API_PORT:-3182}"
MOCK_PORT="${MOCK_LLM_PORT:-3188}"
SKIP_BUILD=0
[[ "${1:-}" == "--skip-build" ]] && SKIP_BUILD=1

[[ -f .env ]] || { echo "❌ 缺少 .env"; exit 1; }
set -a; . ./.env; set +a
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL 未在 .env 中定义}"

bash scripts/prepare-test-database.sh

ROOT="$(pwd -P)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
  # 兜底：只回收本仓库 cwd 的监听
  for pt in $API_PORT $MOCK_PORT; do
    lpid="$(lsof -nP -iTCP:"$pt" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    [[ -z "$lpid" ]] && continue
    lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [[ "$lcwd" == "$ROOT" ]] && kill "$lpid" 2>/dev/null
  done
  sleep 0.5
}
trap cleanup EXIT

# 端口占用检查：不静默换端口、不杀占用者
for pt in $API_PORT $MOCK_PORT; do
  if lsof -nP -iTCP:"$pt" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 端口 $pt 已被占用（不静默换端口、不杀占用者）。释放后重跑，或设 LLM_E2E_API_PORT=<空闲端口>。"
    lsof -nP -iTCP:"$pt" -sTCP:LISTEN | sed -n '2,$p' | sed 's/^/      /'
    exit 3
  fi
done

# 构建产物新鲜度（同 acc-server.sh 的防假绿口径）
BUILD_ID_FILE=".next/BUILD_ID"
build_reason=""
if [[ $SKIP_BUILD -ne 1 ]]; then
  if [[ ! -f "$BUILD_ID_FILE" ]]; then
    build_reason=".next/BUILD_ID 缺失"
  else
    newer=$(find src prisma package.json tsconfig.json next.config.ts next.config.js next.config.mjs -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \
         -o -name '*.json' -o -name '*.prisma' -o -name '*.css' -o -name '*.sql' \) \
      -newer "$BUILD_ID_FILE" -print -quit 2>/dev/null || true)
    [[ -n "$newer" ]] && build_reason="源码比构建产物新（例：${newer}）"
  fi
fi
if [[ -n "$build_reason" ]]; then
  echo "⚙️  需要重新构建：$build_reason"
  if ! NODE_OPTIONS= NODE_ENV=production ./node_modules/.bin/next build > /tmp/llm-e2e-build.log 2>&1; then
    echo "❌ 构建失败："; tail -25 /tmp/llm-e2e-build.log; exit 1
  fi
fi
echo "🔨 BUILD_ID = $(cat .next/BUILD_ID)"

# 1. mock LLM 端点
(MOCK_LLM_PORT="$MOCK_PORT" nohup node scripts/mock-openai-server.cjs > /tmp/llm-e2e-mock.log 2>&1 &
echo $! > /tmp/llm-e2e-mock.pid)
PIDS+=("$(cat /tmp/llm-e2e-mock.pid)")

# 2. 生产模式 next start（LLM 启用配置注入服务进程环境）
(NODE_OPTIONS= NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL="$TEST_DATABASE_URL" \
  ADVISOR_LLM_ENABLED=true \
  ADVISOR_MODEL_PROVIDER="mock-openai-compatible" \
  ADVISOR_MODEL_ID="mock-llm-e2e" \
  ADVISOR_LLM_BASE_URL="http://127.0.0.1:$MOCK_PORT/v1" \
  ADVISOR_LLM_TIMEOUT_MS=1000 \
  ADVISOR_LLM_MAX_TOKENS=512 \
  nohup ./node_modules/.bin/next start -p "$API_PORT" > /tmp/llm-e2e-server.log 2>&1 &
echo $! > /tmp/llm-e2e-server.pid)
PIDS+=("$(cat /tmp/llm-e2e-server.pid)")

# 3. 探活 + 归属校验（端口启动前空闲 + 监听进程 cwd==本仓库）
up=0
for _ in $(seq 1 40); do
  c=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null)
  [[ "$c" == "200" ]] && { up=1; break; }
  sleep 1
done
if [[ "$up" != "1" ]]; then
  echo "❌ 服务未就绪（日志尾部）："; tail -10 /tmp/llm-e2e-server.log; exit 1
fi
lpid="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
if [[ "$lcwd" != "$ROOT" ]]; then
  echo "❌ ${API_PORT} 上服务器 cwd=「${lcwd}」≠ 本仓库「${ROOT}」"; exit 4
fi
echo "✅ 服务就绪（pid=${lpid} · LLM 已启用 · mock 端点 :${MOCK_PORT}）"

# 4. 跑套件
export BASE_URL="http://127.0.0.1:$API_PORT"
export MOCK_LLM_URL="http://127.0.0.1:$MOCK_PORT"
export LLM_E2E_ENABLED=1

NODE_OPTIONS= ./node_modules/.bin/tsx scripts/run-test.ts tests/acceptance-llm-advisor.test.ts
code=$?
echo ""
if [[ $code -eq 0 ]]; then echo "🏁 LLM E2E 验收通过"; else echo "🏁 LLM E2E 验收失败（退出码 ${code}）"; fi
exit "$code"
