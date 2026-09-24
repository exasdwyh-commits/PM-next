# 本地模型资产清单 — Muse Glimmer + Laya

本文件记录 PM-next 两个**可选本地模型**的真实身份、落盘位置、体积与启停方式。

两者都遵循同一原则：**未配置/不可用时系统主体照常运行**，Model Gateway 按策略 fail closed，
不会为了"能用"而悄悄回落到云端模型。

---

## 一、总览

| | Muse Glimmer | Laya |
|---|---|---|
| 角色 | 生成式常驻模型（Department Assistant 对话/规划/汇总） | 判断式 Shadow（意图/复杂度/是否需研究/专家类别） |
| 真实身份 | Meta Superintelligence Labs `Muse-Glimmer-30B` | `convaiinnovations/laya` 系列 RL 路由模型 |
| 规模 | 30B dense | 小型分类器（非 LLM） |
| 许可 | Apache 2.0 | 见 HF model card |
| 运行形态 | 本地 OpenAI-compatible HTTP 端点 :8080/v1 | 项目内 Python 服务 :8000 |
| 治理约束 | 结果只作为候选，不得绕过 SourceCapture / Evidence | confidence **不得**当作事实可信度；`abstained=true` 绝不 AUTO |
| 本机状态 | 见下文 | ✅ 已下载并验证可用 |

---

## 二、Muse Glimmer

### 真实身份

文档里只写了 `modelId: muse-glimmer`，未指明来源。核实结论：

- Hugging Face 官方仓库：`meta-models/Muse-Glimmer-30B`（BF16 权重）
- GGUF 量化仓库：**`meta-models/Muse-Glimmer-30B-GGUF`**
- 参数：30B dense，Apache 2.0，针对本地 agentic 场景（工具调用、结构化输出、多步规划）优化
- 多模态：是（需额外 `mmproj-*.gguf` 投影文件）

### 本机选型

| 候选 | 体积 | 结论 |
|---|---|---|
| BF16 全精度 | ~60 GB | 64GB 内存下过于吃紧 |
| **KQuant Q4_K_M** | **17 GB** | ✅ 选定 |
| KQuant Dynamic Q4_K_XL | 更大 | 质量略高但内存占用上升 |

硬件前提：**Apple M5 Pro / 64 GB 统一内存 / 246 GB 可用磁盘** —— Q4_K_M 有余量。

### 落盘位置

```
~/.cache/huggingface/hub/models--meta-models--Muse-Glimmer-30B-GGUF/
  └── snapshots/<hash>/Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf
```

### 运行时

llama-cpp-python（Metal 后端）提供 OpenAI 兼容端点，与 `.env` 的
`MODEL_PROVIDER_MUSE_LOCAL_BASE_URL` 直接对齐：

```bash
# 安装（一次性）
CMAKE_ARGS="-DGGML_METAL=on" \
  pip install "llama-cpp-python[server]"

# 启动
bash scripts/muse-server-start.sh          # 后台，日志 /tmp/muse-server.log
bash scripts/muse-server-start.sh --once   # 前台调试
```

产物端点：`http://127.0.0.1:8080/v1`

---

## 三、Laya

### 落盘位置与体积

| checkpoint | 体积 | 用途 |
|---|---|---|
| `convaiinnovations/laya` | 804 MB | 英文默认 |
| `convaiinnovations/laya-multilingual` | 614 MB | 非拉丁脚本（中文）自动路由到此 |
| `convaiinnovations/laya-typed-decisions` | 804 MB | 结构化判定 |

注意：这些是**小型 RL 路由/判定模型，不是生成式 LLM**，所以体积只有几百 MB，
不要按 LLM 的规模去期待它的输出。

### 启停

```bash
cd services/judgment-runtime
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt

LAYA_DEFAULT_MODEL=multilingual \
LAYA_PRELOAD_MODELS=multilingual \
./.venv/bin/python service.py
```

端点：`http://127.0.0.1:8000`

| 端点 | 说明 |
|---|---|
| `GET /health` | `{"provider":"laya","providerVersion":"0.3.6","loadedModels":["multilingual"]}` |
| `GET /version` | 同上 |
| `POST /v1/systemone` | 判定入口，**每个 question 必须带 `type:"choice"` + `criteria`** |

### 调用约束

- `LAYA_ALLOW_REMOTE=false` —— 禁止远端调用（默认）
- 失败时：对话照常，`reflex mode = SHADOW_FAILED`，不因此授权任何操作动作
- **confidence 不是事实可信度**，仅用于 Shadow 观测与校准

---

## 四、网络注意事项（本机实测）

`huggingface.co` 在本机代理下返回 `502 Bad Gateway` / 连接失败，
而 `hf-mirror.com` 直连可用。下载模型时：

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  HF_ENDPOINT=https://hf-mirror.com \
  hf download meta-models/Muse-Glimmer-30B-GGUF Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf
```

即：**清掉代理环境变量 + 指定镜像端点**。

---

## 五、验证记录（2026-09-25 本机实测）

### Muse Glimmer — PASS

| 项 | 结果 |
|---|---|
| 下载 | ✅ 16 GB（`Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf`） |
| 运行时 | ✅ llama-cpp-python 0.3.35，`libggml-metal.dylib` 已编译（`ggml_backend_metal_init` 符号存在） |
| 端点 | ✅ `http://127.0.0.1:8080/v1`，`/v1/models` 返回 `muse-glimmer` |
| 真实生成 | ✅ 中文长回答，思维链与正式答案分离 |
| 接入 PM-next | ✅ `muse:check` 5/5 全绿 |
| ModelRun 溯源 | ✅ `ASSISTANT_DIALOGUE → assistant-dialogue-resident → muse-glimmer-resident-slot`，`provider=muse-local`，`SUCCEEDED`，67631 ms |

### Laya — PASS

| 项 | 结果 |
|---|---|
| 三个 checkpoint | ✅ 804 MB / 614 MB / 804 MB 全部完整 |
| 服务 | ✅ `http://127.0.0.1:8000`，laya 0.3.6，`loadedModels: ["multilingual"]` |
| 真实推理 | ✅ `/v1/systemone` 返回 typed answers，汉字检测 76% 自动路由 multilingual |
| Shadow 边界 | ✅ confidence 0.16 极低——正好说明它不能当事实用 |
