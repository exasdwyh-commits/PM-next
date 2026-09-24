# PM-next Laya Judgment Runtime

这是 Department Assistant 的本地 **System-1 typed decision** 服务，用于快速分类、路由和优先级判断。

它不是聊天模型，也没有业务写权限。当前融合版默认只以 **Shadow** 方式使用 Laya；没有 workload benchmark / calibration 前，Laya 结果不能授权高风险 AUTO。

## 安装

```bash
cd services/judgment-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 启动

最小配置：

```bash
python service.py
```

默认：

- host: `127.0.0.1`
- port: `8000`
- Router default model: `english`

中文/多语言场景可显式配置：

```bash
LAYA_DEFAULT_MODEL=multilingual \
LAYA_PRELOAD_MODELS=multilingual \
python service.py
```

如果本机希望限制 POST 调用，可同时给 Next.js 和本服务设置相同的：

```bash
LAYA_API_KEY="<local-random-secret>"
```

## Next.js 连接

在项目根目录 `.env`：

```env
LAYA_BASE_URL="http://127.0.0.1:8000"
LAYA_API_KEY=""
# 留空 = 使用 Router 自己的 default checkpoint。
LAYA_MODEL=""
LAYA_TIMEOUT_MS=1500
LAYA_ALLOW_REMOTE=false
```

不要为了“有默认值”随意填写不存在的模型名。

## Endpoint

- `GET /health`
- `GET /version`
- `POST /v1/systemone` — 当前融合版正式路径
- `POST /evaluate` — 兼容早期 VNext Judgment Runtime

POST body 直接映射到 Laya `Router.predict(state, questions, ...)`。

响应会附加：

- Laya package version
- loaded checkpoints
- input fingerprint

这些只用于 provenance / benchmark，不代表事实置信度。

## 安全边界

- 默认只监听 localhost；
- 不记录 request body；
- request body 上限默认 1 MB；
- 远端 Laya 仍由 Next.js 的 `LAYA_ALLOW_REMOTE=false` 默认阻断；
- Laya confidence 只能用于分类/路由质量分析；
- Model confidence ≠ factual evidence confidence；
- Laya 不得直接触发生产、支付、外发、数据库破坏、Gate 批准等受保护动作。
