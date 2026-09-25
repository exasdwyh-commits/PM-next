#!/usr/bin/env bash
#
# 全量测试扫描：跑完 package.json 里所有 test:* 脚本并汇总
# ==========================================================
#
# 交付报告指出：那份执行环境只跑了「与数据库无关」的一部分测试命令，
# 数据库相关的测试全部未验证。本脚本在本机（有 PostgreSQL）把全部 test:*
# 跑一遍，给出逐项退出码与日志位置，任一失败即非 0 退出。
#
# 用法：
#   bash scripts/run-test-sweep.sh                 # 全部
#   bash scripts/run-test-sweep.sh test:worker ... # 只跑指定项
#
# 环境变量：
#   SWEEP_TIMEOUT  单项超时秒数（默认 600）
#   SWEEP_LOG_DIR  日志目录（默认 /tmp/pm-test-sweep）

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------- 防重入（本脚本会枚举 package.json 里的全部 test:*） ----------------
#
# 本脚本按 `test:` 前缀枚举所有测试脚本，因此**必然**会枚举到 `test:sweep` 自己 ——
# 一旦无脑执行就是 self-recursion：外层扫描跑 test:sweep → 起内层扫描 → 再跑 test:sweep
# → …… 每层还会 `rm -rf` 同一个日志目录、抢占同样端口，表现为「莫名卡死 + 日志互相覆盖」，
# 排查时完全看不出根因。
#
# 两道闸：
#   ① 枚举时显式排除自身与组合别名（SKIP，见下）；
#   ② 进程环境里带 PM_SWEEP_ACTIVE=1 说明「已经在一次扫描里」，直接拒绝启动。
# 只靠 ① 也能工作，但 ② 能挡住未来新增的任何「包一层脚本」的别名（例如 test:all）。
if [ "${PM_SWEEP_ACTIVE:-}" = "1" ]; then
  echo "❌ 检测到递归调用：本脚本已在一次扫描中运行（PM_SWEEP_ACTIVE=1）。"
  echo "   若确实要嵌套扫描，请先 unset PM_SWEEP_ACTIVE。"
  exit 2
fi
export PM_SWEEP_ACTIVE=1

SWEEP_TIMEOUT="${SWEEP_TIMEOUT:-600}"
SWEEP_LOG_DIR="${SWEEP_LOG_DIR:-/tmp/pm-test-sweep}"
rm -rf "$SWEEP_LOG_DIR" && mkdir -p "$SWEEP_LOG_DIR"

export NODE_OPTIONS=

# 跳过项（不是失败，是「不该在这里再跑一遍」）：
#   test:critical —— product-center/authz/science/llm-e2e 的组合别名，各自会单独跑；
#   test:sweep    —— 就是本脚本，跑了即递归（见上方「防重入」）。
SKIP_TESTS="test:critical test:sweep"
is_skipped() {
  local t
  for t in $SKIP_TESTS; do [ "$t" = "$1" ] && return 0; done
  return 1
}

if [ "$#" -gt 0 ]; then
  TESTS=("$@")
else
  TESTS=($(node -e "
    const s = require('./package.json').scripts;
    console.log(Object.keys(s).filter(k => k.startsWith('test:')).sort().join(' '));
  "))
fi

# macOS 默认没有 timeout：用看门狗子进程替代
run_with_timeout() {
  local limit="$1"; shift
  "$@" >"$CURRENT_LOG" 2>&1 &
  local pid=$!
  ( sleep "$limit"; kill -TERM "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid"
  local code=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $code
}

PASSED=0
FAILED=0
SKIPPED=0
declare -a PASS_LIST=() FAIL_LIST=() SKIP_LIST=()

echo "测试扫描开始：共 ${#TESTS[@]} 项，单项超时 ${SWEEP_TIMEOUT}s"
echo "日志目录：${SWEEP_LOG_DIR}"
echo

for t in "${TESTS[@]}"; do
  if is_skipped "$t"; then
    echo "⏭  $t（别名或本脚本自身，跳过）"
    SKIPPED=$((SKIPPED + 1))
    SKIP_LIST+=("$t")
    continue
  fi

  CURRENT_LOG="${SWEEP_LOG_DIR}/${t#test:}.log"
  START=$(date +%s)
  run_with_timeout "$SWEEP_TIMEOUT" npm run --silent "$t"
  CODE=$?
  ELAPSED=$(( $(date +%s) - START ))

  if [ "$CODE" -eq 0 ]; then
    echo "✅ $t  (${ELAPSED}s)"
    PASSED=$((PASSED + 1))
    PASS_LIST+=("$t")
  else
    if [ "$CODE" -ge 143 ]; then
      echo "⏱  $t  超时/被终止  (${ELAPSED}s)  → ${CURRENT_LOG}"
    else
      echo "❌ $t  exit=${CODE}  (${ELAPSED}s)  → ${CURRENT_LOG}"
    fi
    FAILED=$((FAILED + 1))
    FAIL_LIST+=("$t")
  fi
done

echo
echo "================ 汇总 ================"
echo "通过 ${PASSED} / 失败 ${FAILED} / 跳过 ${SKIPPED}"

if [ "${#FAIL_LIST[@]}" -gt 0 ]; then
  echo
  echo "失败项："
  for t in "${FAIL_LIST[@]}"; do
    echo "  - $t"
    echo "    $(tail -3 "${SWEEP_LOG_DIR}/${t#test:}.log" | tr '\n' ' ')"
  done
fi

[ "$FAILED" -eq 0 ] && exit 0 || exit 1
