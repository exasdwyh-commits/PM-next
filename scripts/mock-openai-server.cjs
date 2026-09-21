#!/usr/bin/env node
/**
 * Mock OpenAI 兼容端点（LLM E2E 验收专用）
 *
 * 用途：为 advisor LLM 润色链路（src/modules/advisor/llm.ts）提供**本地可控**的
 * OpenAI 兼容 /v1/chat/completions 端点 —— 不调用付费 API、不依赖外部凭证。
 *
 * 可控行为（POST /__mode 切换，进程内生效，无需重启服务）：
 *   - ok（默认）：返回带 usage 的正常补全，content 回显用户消息长度，便于断言
 *   - fail：所有 /chat/completions 返回 HTTP 500（验证 AdvisorLLMError 路径与回落）
 *   - slow：延迟 8s 后才返回（超过 E2E 配置的 1s 超时，验证超时回落）
 *   - nousage：返回 200 但不带 usage 字段（验证 usage=null 时计量保持 unknown、不编造）
 *
 * 端口：MOCK_LLM_PORT（默认 3188）。仅绑定 127.0.0.1，测试结束即回收。
 */

const http = require("node:http");

const PORT = parseInt(process.env.MOCK_LLM_PORT || "3188", 10);
let mode = "ok";

const server = http.createServer((req, res) => {
  const url = req.url || "";

  if (req.method === "POST" && url.endsWith("/__mode")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (typeof parsed.mode === "string" && ["ok", "fail", "slow", "nousage"].includes(parsed.mode)) {
          mode = parsed.mode;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, mode }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid mode" }));
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad json" }));
      }
    });
    return;
  }

  if (req.method === "GET" && url.endsWith("/__mode")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ mode }));
    return;
  }

  if (req.method !== "POST" || !url.endsWith("/chat/completions")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (mode === "fail") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "mock upstream failure" } }));
      return;
    }

    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      /* ignore */
    }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const userMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const historyUserTurns = messages.filter((m) => m.role === "user").length;
    const historyAssistantTurns = messages.filter((m) => m.role === "assistant").length;
    const hasOmissionNotice = messages.some(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("被省略")
    );
    const model = typeof parsed.model === "string" ? parsed.model : "mock-llm";

    const finish = () => {
      const payload = {
        id: "chatcmpl-mock-" + Date.now(),
        object: "chat.completion",
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                `【LLM 润色】收到的结构化数据长度 ${userMsg.length} 字符；` +
                `历史注入 user=${historyUserTurns} / assistant=${historyAssistantTurns}` +
                (hasOmissionNotice ? "（含省略提示）" : "（无省略）") +
                "。要点：数据由白名单工具产出，本回复仅作自然语言转述。",
            },
            finish_reason: "stop",
          },
        ],
      };
      if (mode !== "nousage") {
        // token 数与收到的文本长度相关（每 ~3 字符计 1 token），便于断言「计量随输入变化」
        const promptTokens = Math.ceil(userMsg.length / 3);
        payload.usage = { prompt_tokens: promptTokens, completion_tokens: 33, total_tokens: promptTokens + 33 };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (mode === "slow") {
      // 固定 8s 延迟：超过 E2E 里配置的 1s 超时，触发客户端 AbortError → 回落
      setTimeout(finish, 8000);
    } else {
      finish();
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-llm listening on http://127.0.0.1:${PORT}/v1/chat/completions (mode=${mode})`);
});
