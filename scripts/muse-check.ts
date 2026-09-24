/**
 * 专属助理（Department Assistant）× Muse Glimmer 接线自检。
 *
 * 用法：
 *   npx tsx scripts/muse-check.ts
 *
 * 只读检查，不修改任何数据。依次核验五件事：
 *   1. Provider 运行时环境变量（MODEL_PROVIDER_MUSE_LOCAL_*）
 *   2. 本地 Muse 端点是否真的能响应（OpenAI-compatible /v1/models）
 *   3. 数据库里的 Muse Profile 是否存在且启用
 *   4. ASSISTANT_* Policy 是否绑定到 Muse slot
 *   5. hermes_pm 是否有 Agent × TaskClass 绑定
 *
 * 任何一项缺失都只给出结论与修复命令，不会自动改配置，也不会为了"能跑"
 * 把请求静默转发到云端模型。
 */

import prisma from "../src/shared/db";
import {
  resolveOpenAICompatibleProviderRuntime,
} from "../src/modules/model-gateway/provider-runtime";

const MUSE_PROVIDER = "muse-local";
const MUSE_PROFILE_KEY = "muse-glimmer-resident-slot";
const ASSISTANT_POLICY_KEYS = [
  "assistant-dialogue-resident",
  "assistant-planning-resident",
  "assistant-synthesis-resident",
];
const ASSISTANT_TASK_CLASSES = [
  "ASSISTANT_DIALOGUE",
  "ASSISTANT_PLANNING",
  "ASSISTANT_SYNTHESIS",
];

type Level = "PASS" | "FAIL" | "NOT CONFIGURED";

function line(level: Level, label: string, detail: string) {
  const marker =
    level === "PASS" ? "[PASS]" : level === "FAIL" ? "[FAIL]" : "[----]";
  console.log(`${marker} ${label.padEnd(28)} ${detail}`);
}

async function probeEndpoint(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const json = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = Array.isArray(json.data)
      ? json.data
          .map((item) => (typeof item?.id === "string" ? item.id : null))
          .filter((id): id is string => !!id)
      : [];
    return {
      ok: true,
      detail: ids.length ? `models: ${ids.slice(0, 5).join(", ")}` : "no models listed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `unreachable: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("=== 专属助理 × Muse Glimmer 接线自检 ===\n");

  // 1. Provider 运行时
  const runtime = resolveOpenAICompatibleProviderRuntime(MUSE_PROVIDER);
  if (!runtime) {
    line("NOT CONFIGURED", "Provider runtime", `${MUSE_PROVIDER} 未配置，专属助理保持 safe-off`);
  } else {
    line(
      "PASS",
      "Provider runtime",
      `${runtime.source} baseUrl=${runtime.baseUrl} timeout=${runtime.timeoutMs}ms`
    );
  }

  // 2. 端点真实可达性
  if (runtime) {
    const probe = await probeEndpoint(runtime.baseUrl);
    line(
      probe.ok ? "PASS" : "FAIL",
      "Muse endpoint",
      probe.ok ? probe.detail : probe.detail
    );
  } else {
    line("NOT CONFIGURED", "Muse endpoint", "跳过：无 baseUrl");
  }

  // 3. Muse Profile
  const profile = await prisma.modelProfileConfig
    .findFirst({ where: { key: MUSE_PROFILE_KEY } })
    .catch(() => null);
  if (!profile) {
    line("NOT CONFIGURED", "Muse profile", `${MUSE_PROFILE_KEY} 未安装（Model Control → INSTALL_PRESETS）`);
  } else {
    line(
      profile.enabled ? "PASS" : "NOT CONFIGURED",
      "Muse profile",
      `enabled=${profile.enabled} provider=${profile.provider} modelId=${profile.modelId} locality=${profile.locality}`
    );
  }

  // 4. ASSISTANT_* Policy
  const policies = await prisma.modelPolicyConfig
    .findMany({ where: { key: { in: ASSISTANT_POLICY_KEYS } } })
    .catch(() => []);
  if (policies.length === 0) {
    line("NOT CONFIGURED", "Assistant policies", "三个 resident 策略均未安装");
  } else {
    const missing = ASSISTANT_POLICY_KEYS.filter(
      (key) => !policies.some((policy) => policy.key === key)
    );
    line(
      missing.length ? "FAIL" : "PASS",
      "Assistant policies",
      missing.length ? `缺失：${missing.join(", ")}` : `${policies.length}/3 已安装`
    );
  }

  // 5. hermes_pm 绑定
  const agent = await prisma.agent
    .findFirst({ where: { code: "hermes_pm" }, select: { id: true } })
    .catch(() => null);
  let bindingDetail = "hermes_pm 未 bootstrap";
  let bindingLevel: Level = "NOT CONFIGURED";
  if (agent) {
    const bindings = await prisma.agentModelPolicyBinding
      .findMany({
        where: { agentId: agent.id, taskClass: { in: ASSISTANT_TASK_CLASSES } },
        select: { taskClass: true },
      })
      .catch(() => [] as Array<{ taskClass: string }>);
    const bound = bindings.map((item: { taskClass: string }) => item.taskClass);
    const missing = ASSISTANT_TASK_CLASSES.filter((tc) => !bound.includes(tc));
    bindingLevel = bound.length === 0 ? "NOT CONFIGURED" : missing.length ? "FAIL" : "PASS";
    bindingDetail =
      bound.length === 0
        ? "hermes_pm 无 ASSISTANT_* 绑定"
        : missing.length
          ? `已绑 ${bound.join(", ")}；缺 ${missing.join(", ")}`
          : `${bound.length}/3 已绑定`;
  }
  line(bindingLevel, "hermes_pm bindings", bindingDetail);

  // 结论
  console.log("\n=== 结论 ===");
  const ready =
    !!runtime &&
    !!profile?.enabled &&
    policies.length === ASSISTANT_POLICY_KEYS.length;
  if (ready) {
    console.log("Muse 已接线。发一条专属助理消息后检查 ModelRun：");
    console.log("  provider 应为 muse-local，modelId 应为配置的 Muse 模型，");
    console.log("  policy 应为 assistant-*-resident，且 cloudAllowed=false。");
  } else {
    console.log("Muse 尚未接线。专属助理当前保持 safe-off，系统主体不受影响。");
    console.log("\n接通步骤：");
    console.log("  1) 启动本地 OpenAI-compatible 服务（Mac 推荐 Metal 版 llama.cpp）");
    console.log("  2) .env 增加：");
    console.log('     MODEL_PROVIDER_MUSE_LOCAL_BASE_URL="http://127.0.0.1:8080/v1"');
    console.log('     MODEL_PROVIDER_MUSE_LOCAL_API_KEY=""');
    console.log("  3) Model Control 安装官方 preset（若尚未安装）");
    console.log("  4) 启用 muse-glimmer-resident-slot");
    console.log("  5) 重新运行本脚本确认全绿");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
