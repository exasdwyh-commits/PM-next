#!/usr/bin/env bash
#
# 生产模式验收服务运行器
#
# 为什么存在：本仓有 4 套验收需要真实 HTTP 服务 ——
#   acceptance-authz-matrix / acceptance-product-center / acceptance-b01-http（HTTP 套件）
#   ui-b01-evidence / ui-feedback-layer / ui-quiet-enterprise（Playwright 套件）
# 手动「起服务 → 探活 → 跑套件」踩过的坑，每个坑的报错文案都指向错误的方向：
#
#   1. `.next/BUILD_ID` 会莫名缺失 → `next start` 报
#      "Could not find a production build"，看起来像构建问题，实际只是缺一个标识文件。
#      （实测：build → start → kill 三步都不删它，所以是环境里别的东西删的；本脚本不追因，缺了就重建。）
#   2. 用 run_in_background 托管 `(cmd &)` 时，任务一结束进程即被回收。下一条命令再跑套件就
#      只看到 `fetch failed` —— 会被误读成业务失败。
#   3. 忘了先探活就开始跑，失败信息同样是 `fetch failed`，看不出「服务没起来」。
#   4. **改了源码但没重建 → 假绿**：`next start` 服务 `.next` 构建产物而非源码，套件跑的是旧代码，
#      全绿却什么都没验证。旧版只在 BUILD_ID 缺失时才构建，必然假绿（已改为按源码新鲜度自动重建，
#      见下方「构建产物新鲜度」一段）。这是四个坑里唯一会**给出与事实相反结论**的一个。
#   5. **跑到别人的服务器上 → 假绿/假红**（2026-09-18 新增防护）：
#      套件默认 `BASE_URL/UI_BASE_URL` 写死在端口上；若这些端口上跑着**别人的**服务器，
#      套件会把请求打到别人的构建上 —— 它要是旧构建就**假绿**（「验过了」其实验的是别人），
#      它要是另一份夹具就 ENOENT→500→**假红**。故本脚本：
#        a) 默认端口段迁到 **3180/3181**（旧 3100/3110/3111 让给并行 agent，脚本绝不触碰）；
#        b) 显式把 `BASE_URL/UI_BASE_URL` 指向本脚本自己起的端口；
#        c) 起服务后**校验服务器归属**（见下「服务器归属校验」），不属于本次启动的直接报错退出；
#        d) 端口被占用时**不静默换端口、不杀占用者**，明确失败并打印占用者。
#
# 用法：scripts/acc-server.sh [--port <p_api> [p_ui]] <测试文件> [更多测试文件...]
#   --port 不给时默认 3180（HTTP 套件）/ 3181（Playwright 套件）。
# 退出码：任一套件失败即非 0；端口被占 / 归属校验不通过 → 非 0（且绝不跑测试）。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# ---------------- 端口解析（默认 3180/3181；本团队段 3180/3181/3182） ----------------
API_PORT="${ACC_API_PORT:-3180}"
UI_PORT="${ACC_UI_PORT:-3181}"
TESTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      shift
      if [[ $# -lt 1 || ! "$1" =~ ^[0-9]+$ ]]; then
        echo "❌ --port 需要一个数字端口，例如 --port 3180 3181"; exit 2
      fi
      API_PORT="$1"; UI_PORT=$((API_PORT + 1)); shift
      if [[ $# -ge 1 && "$1" =~ ^[0-9]+$ ]]; then UI_PORT="$1"; shift; fi
      ;;
    *) TESTS+=("$1"); shift ;;
  esac
done

if [[ ${#TESTS[@]} -eq 0 ]]; then
  echo "用法：scripts/acc-server.sh [--port <p_api> [p_ui]] <测试文件> [<测试文件> ...]"
  exit 2
fi

[[ -f .env ]] || { echo "❌ 缺少 .env"; exit 1; }
set -a; . ./.env; set +a
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL 未在 .env 中定义}"

# The test database may predate Prisma's migration ledger. This validates that
# exact baseline before recording it, then applies pending migrations. It never
# resets a database and refuses every schema it cannot identify.
bash scripts/prepare-test-database.sh

ROOT="$(pwd -P)"   # 物理路径（macOS 上 /tmp 是指向 /private/tmp 的符号链接；lsof 回报物理路径，须对齐）
PORTS="$API_PORT $UI_PORT"

# ---------------- 端口占用检查：不静默换端口、不杀占用者 ----------------
occupied=""
for pt in $PORTS; do
  lsof -nP -iTCP:"$pt" -sTCP:LISTEN >/dev/null 2>&1 && occupied="$occupied $pt"
done
if [[ -n "${occupied// /}" ]]; then
  echo "❌ 拒绝在这些被占用的端口上跑测试（不会静默换端口、也不会杀占用者）：$occupied"
  for pt in $occupied; do
    echo "   —— $pt 上的占用者："
    lsof -nP -iTCP:"$pt" -sTCP:LISTEN | sed -n '2,$p' | sed 's/^/      /'
  done
  echo "   处理：① 释放这些端口后重跑；或 ② 显式指定空闲端口："
  echo "         scripts/acc-server.sh --port <p_api> <p_ui> ${TESTS[0]}"
  echo "   （即使显式指定端口，仍会做下方「服务器归属校验」。）"
  exit 3
fi

# ---------- 构建产物新鲜度（本脚本最容易造成「假绿」的地方，勿回退） ----------
#
# ⚠️ `next start` 服务的是 `.next` 里的**构建产物**，不是 `src/` 源码。所以「改了源码但没重建」
# 时，验收跑的是**旧代码**：套件全绿，而这次的改动根本没被验证过 —— 比"失败"更危险，
# 因为它会让人得出与事实相反的结论。旧写法只在 `.next/BUILD_ID` **缺失**时才构建，
# 于是任何"改源码 → 跑验收"的流程都会假绿（QA 实测踩到：把缺陷修复注释掉后矩阵仍报 529 全绿）。
# 现在改为：BUILD_ID 缺失，**或**任一被监视的源文件比 BUILD_ID 新 → 重建。
# （落地前的唯一可靠手工办法是 `rm -rf .next`；本条就是把它自动化。）
BUILD_ID_FILE=".next/BUILD_ID"
build_reason=""
if [[ ! -f "$BUILD_ID_FILE" ]]; then
  build_reason=".next/BUILD_ID 缺失（该文件为 next start 的准入标识）"
else
  watch_paths=()
  for p in src prisma package.json tsconfig.json next.config.ts next.config.js next.config.mjs; do
    [[ -e "$p" ]] && watch_paths+=("$p")
  done
  if [[ ${#watch_paths[@]} -gt 0 ]]; then
    # 只按源码类后缀判定，避免 prisma/*.db、日志等运行期产物把构建判定带偏
    newer=$(find "${watch_paths[@]}" -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \
         -o -name '*.json' -o -name '*.prisma' -o -name '*.css' -o -name '*.sql' \) \
      -newer "$BUILD_ID_FILE" -print -quit 2>/dev/null || true)
    [[ -n "$newer" ]] && build_reason="源码比构建产物新（例：${newer}）"
  fi
fi

if [[ -n "$build_reason" ]]; then
  echo "⚙️  需要重新构建：$build_reason"
  # NODE_ENV 必须显式钉成 production，且这里有**实测复现过的失败**（勿删、勿改写成"加固"）：
  # 本脚本 `set -a; . ./.env` 会把 `.env` 里的 `NODE_ENV=development` **导出进进程环境**，
  # 而 `next build` 在该变量已被导出为 development 时，会在 /404 prerender 阶段失败并报：
  #   "<Html> should not be imported outside of pages/_document"
  # 报错文案指向 HTML 结构，实际只是 NODE_ENV 被导出带偏 —— 归因极易跑偏。
  #
  # 反直觉之处（QA 四场景实测，别按直觉下结论）：
  #   裸跑 `next build`（不导出 NODE_ENV）= exit 0 —— Next 内部强制 production，且不采用 .env 里的
  #   NODE_ENV；所以"我手动单独跑一次构建是好的"**不能**证明这行 pin 多余。
  #   只有把它**导出进环境**（本脚本正是如此）才会 exit 1。
  #   （曾有一版注释写"本机加了与不加都能成功、该失败无法复现"，正是踩了这个反直觉点，已按实测改写。）
  if ! NODE_OPTIONS= NODE_ENV=production ./node_modules/.bin/next build > /tmp/acc-build.log 2>&1; then
    echo "❌ 构建失败："; tail -25 /tmp/acc-build.log; exit 1
  fi
fi
LOCAL_BUILD_ID="$(cat .next/BUILD_ID)"
echo "🔨 BUILD_ID = $LOCAL_BUILD_ID"

# ---------------- 起服务（记录本次启动的 PID，供归属校验与收工回收） ----------------
STARTED_PIDS=()
cleanup() {
  # 只回收「本仓库 cwd」的监听，绝不误杀别人的服务
  local pt lpid lcwd
  for pt in $PORTS; do
    lpid="$(lsof -nP -iTCP:"$pt" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    [[ -z "$lpid" ]] && continue
    lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    [[ "$lcwd" == "$ROOT" ]] || continue
    kill "$lpid" 2>/dev/null
  done
  if [[ ${#STARTED_PIDS[@]} -gt 0 ]]; then
    local p
    for p in "${STARTED_PIDS[@]}"; do kill "$p" 2>/dev/null; done
  fi
  sleep 1
}
trap cleanup EXIT

for pt in $PORTS; do
  nohup env NODE_OPTIONS= NODE_ENV=production DEV_MOCK_AUTH=false DATABASE_URL="$TEST_DATABASE_URL" \
    ./node_modules/.bin/next start -p "$pt" > "/tmp/acc-server-$pt.log" 2>&1 &
  STARTED_PIDS+=("$!")
  disown
done

# ---------------- 就绪探活 + 服务器归属校验 ----------------
# 归属校验口径（确定性方案；文件头「坑 5」）：
#   ① 端口在启动前是空闲的（上面已强制；被占则直接退出）；
#   ② 端口上**监听进程的 cwd 必须 == 本仓库根（物理路径）** —— 证明它服务的是本仓库的 `.next`。
#   ①② 同时成立 ⇒ 这台服务器 = 本次构建产出的那台。
#   为什么不直接比 BUILD_ID：`/api/health` 匿名只回 `{"status":...}`（不暴露构建标识，见
#     src/app/api/health/route.ts）；而「端口启动前空闲 + 监听进程 cwd==本仓库」已能确定性地
#     锁定「是本仓库、且是这一次起来的」。
#   为什么不用「监听进程是 $! 后代」当主判据：Next 各子命令进程模型不同 —— 实测 `next start`
#     父进程常驻（血统成立），但 `next dev` 会 **daemonize**（父进程 $! 退出、监听进程被 init 收养），
#     血统恒不成立。故血统只作**打印佐证**，不作判据（否则 dev 场景会假拒绝 = 另一种危险）。
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

idx=0
for pt in $PORTS; do
  ourpid="${STARTED_PIDS[$idx]}"; idx=$((idx + 1))
  up=0
  for _ in $(seq 1 40); do
    c=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$pt/api/health" 2>/dev/null)
    if [[ "$c" == "200" ]]; then up=1; break; fi
    sleep 1
  done
  if [[ "$up" != "1" ]]; then
    echo "❌ 127.0.0.1:$pt 未就绪（日志尾部）："; tail -10 "/tmp/acc-server-$pt.log"; exit 1
  fi
  lpid="$(lsof -nP -iTCP:"$pt" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  if [[ -z "$lpid" ]]; then echo "❌ $pt 探活通过但查不到监听进程，异常退出"; exit 1; fi
  lcwd="$(lsof -a -p "$lpid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  if [[ "$lcwd" != "$ROOT" ]]; then
    echo "❌ 拒绝跑测试：${pt} 上服务器的 cwd=「${lcwd}」≠ 本仓库「${ROOT}」——这不是本次启动的服务器。"
    echo "   占用者："; lsof -nP -iTCP:"$pt" -sTCP:LISTEN | sed -n '2,$p' | sed 's/^/      /'
    exit 4
  fi
  # 辅助佐证（非判据）：监听进程是否为本次启动进程的后代。Next 各子命令进程模型不同
  # （实测：`next start` 父进程常驻；`next dev` 会 daemonize —— 父进程 $! 退出、监听进程被 init 收养），
  # 故**不以血统为主判据**；归属由「端口启动前空闲 + cwd==本仓库」确定，血统仅作打印佐证。
  if is_descendant "$lpid" "$ourpid"; then
    echo "✅ 127.0.0.1:$pt 就绪且归属校验通过（pid=$lpid · cwd=$lcwd · BUILD_ID=$LOCAL_BUILD_ID · 血统✔）"
  else
    echo "✅ 127.0.0.1:$pt 就绪且归属校验通过（pid=$lpid · cwd=$lcwd · BUILD_ID=$LOCAL_BUILD_ID · 血统：非 $ourpid 后代［daemonize/fork，正常］）"
  fi
done

# ---------------- 跑套件（显式把 BASE_URL/UI_BASE_URL 指向本轮端口，杜绝打到别人的服务） ----------------
export BASE_URL="http://127.0.0.1:$API_PORT"
export UI_BASE_URL="http://127.0.0.1:$UI_PORT"

rc=0
for f in "${TESTS[@]}"; do
  echo ""
  echo "##### $f"
  NODE_OPTIONS= ./node_modules/.bin/tsx scripts/run-test.ts "$f" > /tmp/acc-suite.log 2>&1
  code=$?
  cp /tmp/acc-suite.log "/tmp/acc-$(basename "$f" | tr '. ' '__').log" 2>/dev/null
  echo "  退出码=$code"
  tail -6 /tmp/acc-suite.log | sed 's/^/  /'
  if [[ $code -ne 0 ]]; then rc=$code; fi
done

echo ""
if [[ $rc -eq 0 ]]; then echo "🏁 全部套件通过"; else echo "🏁 存在失败套件（退出码 ${rc}）"; fi
exit "$rc"
