#!/usr/bin/env python3
"""Muse Glimmer 本地推理服务 —— OpenAI 兼容端点（Harmony 格式适配）。

为什么不用 llama-cpp-python 自带的 server：
    Muse Glimmer 是 Harmony 格式的 reasoning 模型。它的原始输出形如

        to=self<|message|><内部思考><|start|>assistant to=user<|message|><正式回答><|eot|>

    llama-cpp-python 的 Jinja2ChatFormatter 能正确渲染 prompt，但**不解析输出**，
    会把思维链和格式标记一起塞进 content。本服务负责渲染与解析两端，
    对外返回干净的 OpenAI 格式，并把思考过程放进 reasoning_content。

端点：
    GET  /health
    GET  /v1/models
    POST /v1/chat/completions

用法：
    python scripts/muse-openai-server.py [--port 8080] [--n-ctx 32768]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import uuid
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from llama_cpp import Llama
from pydantic import BaseModel, Field

# ── Harmony 格式常量 ──────────────────────────────────────────────────────
BOS = "<|begin_of_text|>"
START = "<|start|>"
MESSAGE = "<|message|>"
EOT = "<|eot|>"
EOM = "<|eom|>"
END = "<|end|>"
STOP_SEQUENCES = [EOT, END, EOM]


def render_harmony(messages: list[dict[str, Any]]) -> str:
    """把 OpenAI messages 渲染成 Harmony prompt。

    格式：<|start|>{role}<|message|>{content}<|eot|>
    结尾留出 <|start|>assistant 让模型续写。
    """
    parts = [BOS]
    for m in messages:
        role = str(m.get("role", "user"))
        content = str(m.get("content", ""))
        if role == "system":
            parts.append(f"{START}system{MESSAGE}{content}{EOT}")
        elif role == "assistant":
            parts.append(f"{START}assistant{MESSAGE}{content}{EOT}")
        else:
            parts.append(f"{START}user{MESSAGE}{content}{EOT}")
    parts.append(f"{START}assistant")
    return "".join(parts)


def split_harmony(text: str) -> tuple[str, str]:
    """分离 reasoning 与正式回答。

    返回 (answer, reasoning)。若模型未使用思考通道，reasoning 为空串。
    """
    marker = f"{START}assistant"
    idx = text.rfind(marker)
    if idx == -1:
        # 没有 assistant 段：整体当作回答（去掉残留标记）
        return _clean(text), ""

    reasoning = text[:idx]
    rest = text[idx + len(marker) :]

    # rest 形如 " to=user<|message|>正式回答<|eot|>"
    # 注意：MESSAGE 常量本身已含结尾的 ">" ，不要再额外拼一个。
    m = re.search(re.escape(MESSAGE), rest)
    answer = rest[m.end() :] if m else rest

    return _clean(answer), _clean(reasoning)


def _clean(s: str) -> str:
    """去掉 Harmony 控制标记与残留的 to=recipient 片段。"""
    for tag in (EOT, END, EOM):
        s = s.split(tag)[0]
    s = s.replace(f"{START}assistant", "").replace(f"{START}user", "")
    s = s.replace(f"{START}system", "").replace(MESSAGE, "")
    s = s.replace(BOS, "")
    # 行首残留 " to=user" / " to=self"。只匹配已知 recipient，
    # 不能用 \w+ —— 那会把回答开头的数字一并吃掉（例如 "1+1=2" 变成 "+1=2"）。
    s = re.sub(r"^\s*to=(?:user|assistant|system|self|tool)\s*", "", s)
    return s.strip()


# ── OpenAI 兼容 schema ────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class ChatCompletionRequest(BaseModel):
    model: str = "muse-glimmer"
    messages: list[ChatMessage] = Field(default_factory=list)
    temperature: float = 0.2
    max_tokens: int = 2048
    top_p: float = 0.95
    stream: bool = False
    include_reasoning: bool = False


app = FastAPI(title="Muse Glimmer OpenAI-compatible server")
MODEL_ALIAS = "muse-glimmer"
_llm: Llama | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if _llm is not None else "loading",
        "provider": "muse-local",
        "model": MODEL_ALIAS,
        "chatFormat": "harmony",
    }


@app.get("/v1/models")
def models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [{"id": MODEL_ALIAS, "object": "model", "owned_by": "local"}],
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest) -> dict[str, Any]:
    if _llm is None:
        raise HTTPException(status_code=503, detail="model not loaded")
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages is empty")

    prompt = render_harmony([m.model_dump() for m in req.messages])
    started = time.time()

    out = _llm(
        prompt=prompt,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        top_p=req.top_p,
        stop=STOP_SEQUENCES,
        echo=False,
    )

    raw = out["choices"][0]["text"]
    answer, reasoning = split_harmony(raw)

    message: dict[str, Any] = {"role": "assistant", "content": answer}
    if req.include_reasoning and reasoning:
        message["reasoning_content"] = reasoning

    usage = out.get("usage", {}) or {}

    # Metrics-only 日志：只记耗时/token/长度摘要，绝不打印 raw 输出或 reasoning
    # 内容（Harmony 思维链可能包含内部策略与敏感推断，不得进入长期日志）。
    print(
        "[muse] chat completions: "
        f"duration_ms={int((time.time() - started) * 1000)} "
        f"prompt_tokens={usage.get('prompt_tokens')} "
        f"completion_tokens={usage.get('completion_tokens')} "
        f"answer_chars={len(answer)} reasoning_chars={len(reasoning)} "
        f"include_reasoning={req.include_reasoning}",
        flush=True,
    )

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(started),
        "model": MODEL_ALIAS,
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": out["choices"][0].get("finish_reason") or "stop",
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
    }


def main() -> None:
    global _llm

    default_model = (
        os.environ.get("MUSE_MODEL_PATH")
        or _discover_model()
    )

    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=default_model)
    ap.add_argument("--host", default=os.environ.get("MUSE_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("MUSE_PORT", "8080")))
    ap.add_argument("--n-ctx", type=int, default=int(os.environ.get("MUSE_N_CTX", "32768")))
    ap.add_argument("--n-gpu-layers", type=int, default=int(os.environ.get("MUSE_N_GPU_LAYERS", "-1")))
    args = ap.parse_args()

    if not args.model or not os.path.exists(args.model):
        raise SystemExit(f"model not found: {args.model}")

    print(f"[muse] loading {args.model}", flush=True)
    print(f"[muse] ctx={args.n_ctx} gpu_layers={args.n_gpu_layers}", flush=True)

    _llm = Llama(
        model_path=args.model,
        n_ctx=args.n_ctx,
        n_gpu_layers=args.n_gpu_layers,
        verbose=False,
    )
    print(f"[muse] ready on http://{args.host}:{args.port}/v1", flush=True)

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


def _discover_model() -> str:
    """在常见位置自动定位 GGUF。"""
    name = os.environ.get(
        "MUSE_MODEL_FILE", "Muse-Glimmer-30B-KQuant-17GB-Q4_K_M.gguf"
    )
    import glob

    patterns = [
        os.path.expanduser(f"~/models/muse-glimmer-30b-gguf/{name}"),
        os.path.expanduser(
            f"~/.cache/huggingface/hub/models--meta-models--Muse-Glimmer-30B-GGUF"
            f"/snapshots/*/{name}"
        ),
    ]
    for p in patterns:
        hits = glob.glob(p)
        if hits:
            return hits[0]
    return ""


if __name__ == "__main__":
    main()
