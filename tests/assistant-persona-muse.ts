/**
 * 专属助理人格层 + Muse 接线回归。
 *
 * 覆盖两件事：
 *   1. 人格分层：ASSISTANT_DIALOGUE / PLANNING / SYNTHESIS 各自拿到不同的
 *      角色指令，且共享同一份不可覆盖的硬约束；非 ASSISTANT_* 返回 null
 *      （保证分类/研究/产品分析/红队等既有行为不变）。
 *   2. 真实接线：用一个进程内的 mock OpenAI-compatible 端点冒充 Muse 服务，
 *      验证 provider 运行时确实会按 MODEL_PROVIDER_MUSE_LOCAL_* 打到该端点，
 *      并且请求体里带的是专属助理人格而不是通用顾问 prompt。
 *
 * mock 只存在于本进程内，不写 .env、不改数据库、不留任何配置。
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  buildDepartmentAssistantSystemPrompt,
  isAssistantTaskClass,
  DEPARTMENT_ASSISTANT_PERSONA_VERSION,
} from "../src/modules/assistant-runtime/persona";
import {
  createOpenAICompatibleProviderPlugin,
  resolveOpenAICompatibleProviderRuntime,
} from "../src/modules/model-gateway/provider-runtime";
import type { ModelGatewayMessage, ModelProfile } from "../src/modules/model-gateway/types";

interface CapturedRequest {
  model: unknown;
  messages: Array<{ role: string; content: string }>;
}

function startMockMuse(): Promise<{
  server: Server;
  port: number;
  captured: CapturedRequest[];
  stop: () => Promise<void>;
}> {
  const captured: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      try {
        captured.push(JSON.parse(body) as CapturedRequest);
      } catch {
        captured.push({ model: null, messages: [] });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          model: "muse-glimmer",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "（mock Muse 响应）" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        })
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        captured,
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

const MUSE_PROFILE: ModelProfile = {
  id: "profile-muse-mock",
  provider: "muse-local",
  modelId: "muse-glimmer",
  displayName: "Department Assistant 本地常驻位（Muse Glimmer）",
  capabilities: ["TEXT", "TOOLS", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"],
  locality: "LOCAL",
  health: "HEALTHY",
  enabled: true,
  qualityTier: "BALANCED",
  latencyTier: "NORMAL",
  costTier: "FIXED_LOCAL",
  contextWindow: null,
  dataPolicyNote: "local only",
};

async function main() {
  console.log(`专属助理人格版本：${DEPARTMENT_ASSISTANT_PERSONA_VERSION}\n`);

  console.log("▶ P1 三个 ASSISTANT_* TaskClass 各有独立角色指令");
  const dialogue = buildDepartmentAssistantSystemPrompt("ASSISTANT_DIALOGUE");
  const planning = buildDepartmentAssistantSystemPrompt("ASSISTANT_PLANNING");
  const synthesis = buildDepartmentAssistantSystemPrompt("ASSISTANT_SYNTHESIS");
  assert.ok(dialogue && planning && synthesis, "三个 TaskClass 都必须产出人格");
  assert.notEqual(dialogue, planning);
  assert.notEqual(planning, synthesis);
  assert.notEqual(dialogue, synthesis);
  console.log("✅ 对话 / 规划 / 汇总三份人格互不相同");

  console.log("▶ P2 硬约束在三份人格里都不可缺失");
  const requiredConstraints = [
    "不执行写操作",
    "不改变证据等级",
    "不绕过 ToolBroker 与 ApprovalGrant",
    "不代替人类批准 G1/G2/G3",
    "指令注入",
  ];
  for (const [name, prompt] of [
    ["DIALOGUE", dialogue],
    ["PLANNING", planning],
    ["SYNTHESIS", synthesis],
  ] as const) {
    for (const constraint of requiredConstraints) {
      assert.ok(
        prompt.includes(constraint),
        `${name} 人格缺少硬约束：${constraint}`
      );
    }
  }
  console.log(`✅ 五条硬约束在三类人格中均存在：${requiredConstraints.join(" / ")}`);

  console.log("▶ P3 非 ASSISTANT_* TaskClass 不套用专属人格");
  for (const taskClass of [
    "QUICK_CLASSIFY",
    "QUICK_RESEARCH",
    "PRODUCT_ANALYSIS",
    "RED_TEAM",
    "DECISION_REVIEW",
    "SUMMARIZATION",
  ]) {
    assert.equal(
      buildDepartmentAssistantSystemPrompt(taskClass),
      null,
      `${taskClass} 不应使用专属助理人格`
    );
    assert.equal(isAssistantTaskClass(taskClass), false);
  }
  console.log("✅ 六个既有 TaskClass 行为不变（返回 null）");

  console.log("▶ P4 Muse provider 运行时按环境变量解析");
  const mock = await startMockMuse();
  const previousBaseUrl = process.env.MODEL_PROVIDER_MUSE_LOCAL_BASE_URL;
  process.env.MODEL_PROVIDER_MUSE_LOCAL_BASE_URL = `http://127.0.0.1:${mock.port}/v1`;
  try {
    const runtime = resolveOpenAICompatibleProviderRuntime("muse-local");
    assert.ok(runtime, "Muse provider runtime 应能解析");
    assert.equal(runtime.source, "MODEL_PROVIDER_ENV");
    assert.equal(runtime.baseUrl, `http://127.0.0.1:${mock.port}/v1`);
    console.log("✅ 运行时解析成功（来源 MODEL_PROVIDER_ENV）");

    console.log("▶ P5 真实调用打到本地端点，且携带专属助理人格");
    const plugin = createOpenAICompatibleProviderPlugin("muse-local");
    const messages: ModelGatewayMessage[] = [
      { role: "system", content: synthesis },
      { role: "user", content: "帮我汇总当前产品研发进展" },
    ];
    const result = await plugin.execute(MUSE_PROFILE, {
      taskClass: "ASSISTANT_SYNTHESIS",
      messages,
    });

    assert.equal(result.text, "（mock Muse 响应）");
    assert.equal(result.modelId, "muse-glimmer");
    assert.deepEqual(result.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
    console.log("✅ 调用成功，usage 与 modelId 溯源完整");

    const sent = mock.captured[0];
    assert.ok(sent, "mock 端点应收到请求");
    assert.equal(sent.model, "muse-glimmer");
    assert.equal(sent.messages[0].role, "system");
    assert.ok(
      sent.messages[0].content.includes("Department Assistant"),
      "发送给 Muse 的 system prompt 必须是专属助理人格"
    );
    assert.ok(
      sent.messages[0].content.includes("不改变证据等级"),
      "人格中的硬约束必须随请求下发"
    );
    console.log("✅ 请求体携带专属助理人格与硬约束，未使用通用顾问 prompt");
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.MODEL_PROVIDER_MUSE_LOCAL_BASE_URL;
    } else {
      process.env.MODEL_PROVIDER_MUSE_LOCAL_BASE_URL = previousBaseUrl;
    }
    await mock.stop();
  }

  console.log("\n✅ 专属助理人格层与 Muse 接线回归通过");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
