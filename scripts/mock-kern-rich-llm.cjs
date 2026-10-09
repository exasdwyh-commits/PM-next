#!/usr/bin/env node
/**
 * Fixed-sample OpenAI-compatible endpoint for verifying Kern rich replies end-to-end.
 *
 * NOT a model. It answers the Kern intent planner with {"intent":"UNSUPPORTED"} and
 * answers dialogue calls with the deterministic samples in scripts/fixtures/kern-rich-samples.cjs
 * (two-plan comparison + follow-up edit, cost breakdown, project schedule, short Q&A, and a
 * deliberately truncated artifact for the failure path). Everything else gets an explicit
 * "no fixed sample" reply — it never pretends to be a real model.
 *
 *   MOCK_LLM_PORT      (default 3189)
 *   MOCK_LLM_DELAY_MS  (default 1800) — lets the UI's waiting state be observed
 *   POST /__delay {"ms":0}  change the delay at runtime
 *
 * Usage with the dev stack:
 *   MODEL_PROVIDER_AGNES_BASE_URL=http://127.0.0.1:3189/v1 MODEL_PROVIDER_AGNES_API_KEY=fixed-sample \
 *   KERN_DEMO_EMAIL=<user> npm run dev:models
 */
const http = require("node:http");
const samples = require("./fixtures/kern-rich-samples.cjs");

const PORT = parseInt(process.env.MOCK_LLM_PORT || "3189", 10);
let delay = parseInt(process.env.MOCK_LLM_DELAY_MS || "1800", 10);
let calls = 0;
// What the last dialogue call could see — lets acceptance prove the model received the current artifact.
let lastContext = { artifactKeys: [], artifactHtmlChars: 0, user: "" };

function lastUserText(messages) {
  const users = (messages || []).filter((m) => m && m.role === "user");
  const last = users[users.length - 1];
  const content = last ? (typeof last.content === "string" ? last.content : JSON.stringify(last.content)) : "";
  const m = /本轮用户消息：([\s\S]*)$/.exec(content);
  return m ? m[1] : content;
}

function answer(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\n");
  if (/意图规划器/.test(system)) return JSON.stringify({ intent: "UNSUPPORTED" });
  const text = lastUserText(messages);
  const keys = [...system.matchAll(/- key=([a-z0-9-]+) · /g)].map((m) => m[1]);
  const html = /```html\n([\s\S]*?)```/.exec(system);
  lastContext = { artifactKeys: keys, artifactHtmlChars: html ? html[1].length : 0, user: text.slice(0, 80) };
  const kind = samples.pick(text);
  const reply = kind ? samples.reply(kind) : null;
  if (reply) return reply;
  return "（固定样例服务）这条消息没有对应的固定样例，所以这里没有真实的模型回答。请接入真实模型后再试。";
}

const server = http.createServer((req, res) => {
  const url = req.url || "";
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "POST" && url.endsWith("/__delay")) {
      try { delay = Math.max(0, Number(JSON.parse(raw || "{}").ms) || 0); } catch { /* keep */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, delay }));
    }
    if (req.method === "GET" && url.endsWith("/__stats")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ calls, delay, lastContext }));
    }
    if (req.method === "GET" && url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "agnes-3.0-flash", object: "model" }] }));
    }
    if (req.method !== "POST" || !url.endsWith("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "not found" } }));
    }
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { /* empty */ }
    calls += 1;
    const content = answer(body);
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: `fixed-sample-${calls}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || "agnes-3.0-flash",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 2), total_tokens: Math.ceil(raw.length / 4) + Math.ceil(content.length / 2) },
      }));
    }, /意图规划器/.test(raw) ? 120 : delay);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-kern-rich-llm] fixed samples on http://127.0.0.1:${PORT}/v1 (delay ${delay}ms)`));
