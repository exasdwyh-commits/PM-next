#!/usr/bin/env python3
"""Minimal local HTTP runtime for Hermes System-1 judgment.

The service intentionally exposes only health/version/evaluate. It does not
perform business actions and should be bound to localhost/private networking.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import laya
from laya import Router

SERVICE_VERSION = "hermes-judgment-runtime/v1"
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


class Handler(BaseHTTPRequestHandler):
    server_version = SERVICE_VERSION

    def log_message(self, fmt: str, *args: Any) -> None:
        # Avoid accidentally logging user state. Operators can put an access
        # proxy in front if request metadata logging is required.
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path in {"/health", "/version"}:
            self._json(200, _health())
            return
        self._json(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != "/evaluate":
            self._json(404, {"error": "NOT_FOUND"})
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
            # Per-run provenance travels with the answer so Hermes can freeze
            # the exact Laya package + routed checkpoint used for comparison.
            result["runtime"] = _health()
            self._json(200, result)
        except (KeyError, ValueError) as exc:
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
    port = int(os.environ.get("JUDGMENT_RUNTIME_PORT", "3310"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(
        f"{SERVICE_VERSION} listening on http://{host}:{port}; "
        f"laya={getattr(laya, '__version__', 'unknown')}; "
        f"loaded={ROUTER.loaded}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
