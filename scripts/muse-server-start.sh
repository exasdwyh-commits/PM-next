#!/usr/bin/env bash
# 启动 Muse Glimmer 本地推理服务（llama.cpp / Metal，OpenAI 兼容端点）。
#
# 产物：http://127.0.0.1:8080/v1  —— 与 .env 的 MODEL_PROVIDER_MUSE_LOCAL_BASE_URL 对齐。
#
# 用法：
#   bash scripts/muse-server-start.sh            # 后台启动，日志 /tmp/muse-server.log
#   MUSE_N_GPU_LAYERS=40 bash scripts/muse-server-start.sh
#   bash scripts/muse-server-start.sh --once     # 前台运行（调试用）
#
# 说明：Muse 是可选能力。服务不启动时系统主体照常运行，Model Gateway 按策略 fail closed，
# 不会偷偷回落到云端模型。

set -euo pipefail

MODEL_FILE="${MUSE_MODEL_FILE:-Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf}"
PORT="${MUSE_PORT:-8080}"
HOST="${MUSE_HOST:-127.0.0.1}"
CTX="${MUSE_N_CTX:-32768}"
GPU_LAYERS="${MUSE_N_GPU_LAYERS:--1}"   # -1 = 全部 offload 到 Metal
LOG="${MUSE_LOG:-/tmp/muse-server.log}"
PY="${MUSE_PYTHON:-$HOME/.workbuddy/binaries/python/envs/muse/bin/python}"

# ── 1. 定位 GGUF：优先显式目录，其次 HF cache ────────────────────────────
locate_model() {
  local candidates=(
    "$HOME/models/muse-glimmer-30b-gguf/$MODEL_FILE"
    "$HOME/.cache/huggingface/hub/models--meta-models--Muse-Glimmer-30B-GGUF/snapshots/"*/"$MODEL_FILE"
  )
  for c in "${candidates[@]}"; do
    [ -f "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

MODEL_PATH="${MUSE_MODEL_PATH:-}"
if [ -z "$MODEL_PATH" ]; then
  MODEL_PATH="$(locate_model)" || {
    echo "❌ 未找到 $MODEL_FILE"
    echo "   先下载：hf download meta-models/Muse-Glimmer-30B-GGUF $MODEL_FILE"
    echo "   （本机 huggingface.co 需走镜像：HF_ENDPOINT=https://hf-mirror.com）"
    exit 1
  }
fi

if [ ! -x "$PY" ]; then
  echo "❌ 未找到 Muse 运行时 Python: $PY"
  echo "   安装：CMAKE_ARGS=\"-DGGML_METAL=on\" pip install \"llama-cpp-python[server]\""
  exit 1
fi

echo "── Muse Glimmer 本地推理服务 ──"
echo "   模型: $MODEL_PATH"
echo "   端点: http://$HOST:$PORT/v1"
echo "   ctx : $CTX | gpu_layers: $GPU_LAYERS"
echo "   日志: $LOG"

# Muse Glimmer 是 Harmony 格式的 reasoning 模型：思维链会混进 content，
# 因此走项目自带的适配服务（渲染 + 解析），而不是 llama_cpp.server。
CMD=(
  "$PY" "$(dirname "$0")/muse-openai-server.py"
  --model "$MODEL_PATH"
  --host "$HOST"
  --port "$PORT"
  --n-ctx "$CTX"
  --n-gpu-layers "$GPU_LAYERS"
)

if [ "${1:-}" = "--once" ]; then
  exec "${CMD[@]}"
fi

# 若端口已被占用则直接复用，不重复拉起（避免占两次内存）
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 端口 $PORT 已在监听，跳过启动"
  exit 0
fi

nohup "${CMD[@]}" > "$LOG" 2>&1 &
echo "   已后台启动，等待就绪..."

for i in $(seq 1 60); do
  if curl -s --noproxy '*' --max-time 3 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
    echo "✅ 就绪（${i}s）"
    curl -s --noproxy '*' "http://$HOST:$PORT/v1/models" | head -c 300
    echo
    exit 0
  fi
  sleep 2
done

echo "⚠️  60s 内未就绪，检查日志：tail -f $LOG"
exit 1
