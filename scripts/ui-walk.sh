#!/usr/bin/env bash
# 全流程可视化走查 + 小屏验收度量（单次调用内闭环）
#
# 为什么要把「起服务 + 跑走查 + 收工」放进同一个 bash 调用：
#   本沙箱会在 Bash 工具调用结束时回收该调用派生的进程组，`nohup ... & disown` 也留不住
#   （实测：起完 6s 内监听正常，调用返回后再查已消失，日志无任何报错）。
#   所以跨回合常驻 dev server 不可依赖，必须由本脚本自己起、自己收。
#
# 端口段（2026-09-18 起）：本团队 3180/3181/3182（默认走查端口 3182）。
#   旧段 3100/3110/3111 已让给并行 agent —— 本脚本**绝不触碰**它们。
#
# 并发纪律（重要）：
#   同一时刻只允许一个进程写 .next。若发现 3180–3189 上跑着**本仓 dev server**，本脚本**直接退出、
#   不启动任何服务**，避免两个 next 争抢 .next。
#   ⚠️ 判定口径 = 「是不是**本仓** dev server」，而**不是**「端口是否被占用」：
#      ① 用本仓匿名签名 `{"status":"UP"|"DOWN"}`（见 api/health/route.ts）识别「是个 next 应用」；
#      ② 再要求监听进程 **cwd == 本仓库根** —— 否则可能是别人跑的同款服务（会打到别人的构建）。
#
# 服务器归属（2026-09-18 新增）：
#   目标是**绝不把走查打到别人的服务器上**（=假绿/假红）。故：
#     - 目标端口被**非本仓**服务占用 → 明确拒绝并打印占用者（不静默换端口、不杀占用者）；
#     - 本脚本自己起 dev 后 → 校验**监听进程 cwd == 本仓库根**（+ 端口启动前空闲）。
#       （不以「$! 后代」为主判据：`next dev` 会 daemonize，父进程 $! 退出、监听进程被 init 收养。）
#
# 用法：
#   bash scripts/ui-walk.sh                # 快路径（1440/390，含交互步骤 + 全截图）
#   bash scripts/ui-walk.sh --full         # 全矩阵（1440/390 + 6 小屏档，18 route-entry，仅红屏截图）
#   bash scripts/ui-walk.sh --keep         # 跑完不杀 dev server（仅限同一回合内人工接着看）
#   bash scripts/ui-walk.sh --full --keep
# 环境变量：WALK_PORT(默认 3182) / WALK_SHOTS(all|red|none) / WALK_STEP_WAIT / WALK_CLICK_MIN
#           WALK_GUARD_ONLY=1（自检：只跑并发守卫判定后退出，不启动服务、不写 .next）
set -uo pipefail

PORT="${WALK_PORT:-3182}"
KEEP=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--keep" ]; then KEEP=1; else ARGS+=("$a"); fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"   # 物理路径（与 lsof 回报的 cwd 对齐；macOS 上 /tmp→/private/tmp）
cd "$ROOT"

DEV_LOG=/tmp/hermes-ui-walk-dev.log
STARTED=0
DEV_PID=""

port_in_use() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }

# —— 并发守卫：识别「**本仓** dev server」——
#   ① /api/health 回本仓匿名签名；② 监听进程 cwd == 本仓库根（否则可能是别人跑的同款服务）。
is_our_dev() {
  local p="$1" body lpid lcwd
  for _ in 1 2; do
    body="$(curl -sS --noproxy '*' --max-time 5 "http://127.0.0.1:${p}/api/health" 2>/dev/null)" || continue
    if [[ "$body" == *'"status":"UP"'* || "$body" == *'"status":"DOWN"'* ]]; then
      lpid="$(lsof -nP -iTCP:"${p}" -sTCP:LISTEN -t 2>/dev/null | head -1)"
      lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      [[ "$lcwd" == "$ROOT" ]] && return 0
      return 1
    fi
  done
  return 1
}

# 监听进程是否为本脚本启动进程（$1）的后代 —— 证明是「这一轮」起来的，而非残留
is_descendant() {
  local pid="$1"
  local anc="$2"
  local cur="$1"
  local i=0
  while [[ -n "$cur" && "$cur" != "1" && $i -lt 15 ]]; do
    [[ "$cur" == "$anc" ]] && return 0
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')"
    i=$((i + 1))
  done
  return 1
}

OUR_DEV_PORTS=""
for p in $(seq 3180 3189); do
  lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || continue
  if is_our_dev "$p"; then OUR_DEV_PORTS="${OUR_DEV_PORTS} ${p}"; fi
done
if [ -n "${OUR_DEV_PORTS// /}" ]; then
  echo "✗ 检测到 3180–3189 上有【本仓 dev server】在跑（端口:${OUR_DEV_PORTS}）。"
  echo "  同一时刻只允许一个进程写 .next —— 本次不启动服务，直接退出。等它收工后重跑。"
  exit 3
fi

# 自检/诊断：只跑并发守卫判定后退出，不启动服务、不写 .next（供守卫回归与人工核验用）。
if [ "${WALK_GUARD_ONLY:-0}" = "1" ]; then
  echo "· 守卫自检：3180–3189 上未发现本仓 dev server → 可安全启动（guard-only 退出，未起服务）。"
  exit 0
fi

cleanup() {
  if [ "$STARTED" = "1" ] && [ "$KEEP" = "0" ]; then
    echo "· 回收 $PORT 上的 dev server"
    local lpid lcwd
    lpid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    if [ -n "$lpid" ]; then
      lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      # 只杀「本仓库 cwd」的监听，绝不误杀别人的服务
      [ "$lcwd" = "$ROOT" ] && kill "$lpid" 2>/dev/null
    fi
    [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null
    sleep 1
    # 复验端口已释放（lsof 实测，不凭经验推断）
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "⚠ 端口 $PORT 仍被占用："
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed -n '2,$p'
    else
      echo "· 已复验：端口 $PORT 空闲（lsof 实测）"
    fi
  fi
}
trap cleanup EXIT

if port_in_use; then
  if is_our_dev "$PORT"; then
    echo "· $PORT 已有【本仓】dev server 在监听，直接复用（不视为 STARTED，退出时不杀）"
  else
    echo "✗ $PORT 被**非本仓**服务占用，拒绝复用（否则走查会打到别人的构建 = 假绿/假红）："
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | sed -n '2,$p' | sed 's/^/   /'
    echo "  处理：释放该端口，或用 WALK_PORT=<空闲端口> 重跑。"
    exit 4
  fi
else
  echo "· 启动 next dev -p $PORT（日志 $DEV_LOG）"
  : > "$DEV_LOG"
  NODE_OPTIONS= ./node_modules/.bin/next dev -p "$PORT" >>"$DEV_LOG" 2>&1 &
  DEV_PID=$!
  STARTED=1
fi

echo -n "· 等待 $PORT 就绪"
ready=0
for _ in $(seq 1 90); do
  if curl -sS --noproxy '*' -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/login" 2>/dev/null; then
    ready=1
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if [ "$ready" != "1" ]; then
  echo "✗ $PORT 在 90s 内未就绪，dev 日志尾部："
  tail -30 "$DEV_LOG" 2>/dev/null
  exit 1
fi

# 服务器归属校验（仅本脚本启动的服务需要；复用的本仓 dev 已在上方校验过）
# 主判据 = 「端口启动前空闲」+「监听进程 cwd == 本仓库根」，确定性证明是本仓库这一次起来的服务。
# 血统仅作佐证：`next dev` 会 daemonize（父进程 $! 退出、监听进程被 init 收养），血统恒不成立。
if [ "$STARTED" = "1" ]; then
  lpid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  if [ "$lcwd" != "$ROOT" ]; then
    echo "✗ 归属校验失败：$PORT 就绪但监听进程 cwd=「$lcwd」≠ 本仓库「$ROOT」——拒绝走查。"
    exit 4
  fi
  if is_descendant "$lpid" "$DEV_PID"; then
    echo "· 归属校验通过（pid=$lpid · cwd=$lcwd · 血统✔）"
  else
    echo "· 归属校验通过（pid=$lpid · cwd=$lcwd · 血统：非 $DEV_PID 后代［daemonize/fork，正常］）"
  fi
fi

echo "· 服务已就绪，开始走查"

if [ "${#ARGS[@]}" -gt 0 ]; then
  WALK_BASE="http://127.0.0.1:$PORT" NODE_OPTIONS= ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts "${ARGS[@]}"
else
  WALK_BASE="http://127.0.0.1:$PORT" NODE_OPTIONS= ./node_modules/.bin/tsx scripts/verify-ui-walkthrough.ts
fi
RC=$?

echo "· 走查退出码 $RC"
exit "$RC"
