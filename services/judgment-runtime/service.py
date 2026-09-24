#!/usr/bin/env python3
"""Local Laya System-1 runtime for PM-next.

This process is intentionally isolated from Next.js/Python/Torch dependencies.
It performs bounded typed judgments only. It never executes business actions.
"""

import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import laya
from laya import Router

SERVICE_VERSION = "pm-next-laya-runtime/v1"
MAX_BODY_BYTES = int(os.environ.get("JUDGMENT_RUNTIME_MAX_BODY_BYTES", "1048576"))


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_router() -> Router:
    device = os.environ.get("LAYA_DEVICE") or None
    max_loaded = int(os.environ.get("LAYA_MAX_LOADED", "2"))
    default = os.environ.get("LAYA_DEFAULT_MODEL", "english")
    router = Router(
        device=device,
        max_loaded=max_loaded,
        default=default,
        auto_task_detection=_bool_env("LAYA_AUTO_TASK_DETECTION", False),
        preload=False,
    )
    preload = [
        item.strip()
        for item in os.environ.get("LAYA_PRELOAD_MODELS", "").split(",")
        if item.strip()
    ]
    if preload:
        router.preload(preload)
    return router


ROUTER = _build_router()


def _health() -> dict[str, Any]:
    return {
        "status": "ok",
        "serviceVersion": SERVICE_VERSION,
        "provider": "laya",
        "providerVersion": getattr(laya, "__version__", None),
        "loadedModels": list(ROUTER.loaded),
    }


def _fingerprint(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        {
            "state": payload.get("state"),
            "questions": payload.get("questions"),
            "model": payload.get("model"),
            "task": payload.get("task"),
            "lang": payload.get("lang"),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class Handler(BaseHTTPRequestHandler):
    server_version = SERVICE_VERSION

    def log_message(self, fmt: str, *args: Any) -> None:
        # Do not log request state/content.
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        expected = os.environ.get("LAYA_API_KEY", "").strip()
        if not expected:
            return True
        return self.headers.get("authorization", "") == f"Bearer {expected}"

    def do_GET(self) -> None:
        if self.path in {"/health", "/version"}:
            self._json(200, _health())
            return
        self._json(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path not in {"/v1/systemone", "/evaluate"}:
            self._json(404, {"error": "NOT_FOUND"})
            return
        if not self._authorized():
            self._json(401, {"error": "UNAUTHORIZED"})
            return

        try:
            raw_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            raw_length = 0
        if raw_length <= 0 or raw_length > MAX_BODY_BYTES:
            self._json(413, {"error": "INVALID_BODY_SIZE"})
            return

        try:
            payload = json.loads(self.rfile.read(raw_length))
        except Exception:
            self._json(400, {"error": "INVALID_JSON"})
            return

        if not isinstance(payload, dict):
            self._json(400, {"error": "INVALID_PAYLOAD"})
            return
        if "state" not in payload or not isinstance(payload.get("questions"), dict):
            self._json(422, {"error": "STATE_AND_QUESTIONS_REQUIRED"})
            return

        try:
            result = ROUTER.predict(
                payload["state"],
                payload["questions"],
                model=payload.get("model"),
                task=payload.get("task"),
                lang=payload.get("lang"),
            )
            if not isinstance(result, dict):
                raise TypeError("Laya Router returned a non-object result")
            runtime = _health()
            runtime["inputFingerprint"] = _fingerprint(payload)
            result["runtime"] = runtime
            if "model" not in result and payload.get("model"):
                result["model"] = payload.get("model")
            self._json(200, result)
        except (KeyError, ValueError, TypeError) as exc:
            self._json(
                422,
                {"error": "LAYA_INPUT_REJECTED", "message": str(exc)[:500]},
            )
        except Exception as exc:
            self._json(
                503,
                {
                    "error": "LAYA_RUNTIME_FAILED",
                    "type": exc.__class__.__name__,
                },
            )


def main() -> None:
    host = os.environ.get("JUDGMENT_RUNTIME_HOST", "127.0.0.1")
    port = int(os.environ.get("JUDGMENT_RUNTIME_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(
        f"{SERVICE_VERSION} listening on http://{host}:{port}; "
        f"laya={getattr(laya, '__version__', 'unknown')}; "
        f"default={os.environ.get('LAYA_DEFAULT_MODEL', 'english')}; "
        f"loaded={ROUTER.loaded}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
