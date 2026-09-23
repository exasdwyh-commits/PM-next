# Hermes Judgment Runtime (Laya shadow)

This service isolates Python/Torch/Laya from the Next.js process.

P2 is **shadow only**. A Laya result must never authorize a business mutation,
Governance Gate, code merge, or AgentTask by itself.

## Install

```bash
cd services/judgment-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
JUDGMENT_RUNTIME_PORT=3310 \
LAYA_MAX_LOADED=2 \
LAYA_PRELOAD_MODELS=english,multilingual \
python service.py
```

For machines without a supported GPU, omit `LAYA_DEVICE`; Laya can run on CPU
with higher latency.

## Endpoints

- `GET /health`
- `GET /version`
- `POST /evaluate`

`/evaluate` mirrors the Laya `Router.predict(state, questions, ...)` shape.

The service does not log request bodies. Bind it to localhost or a private
network; do not expose it directly to the public internet.
