/**
 * KX-65 · 开发环境示例配置（只加不删，可重复运行）
 * ================================================
 * 用法：npm run dev:models                 # 默认 free：只用免费的 Agnes Flash（KX-66 日常测试口径）
 *       npm run dev:models -- --mode=full  # 恢复 KX-65 的四模型路由（会产生付费调用）
 * - 只允许连开发库（库名以 _dev 结尾）；绝不清表。
 * - 为演示账号所在组织：安装数字员工 → 安装模型预设 → 新增四个云端模型位 → 把策略指向它们。
 * - 模型端点与密钥只从环境变量读取（MODEL_PROVIDER_<NAME>_BASE_URL / _API_KEY），本脚本不含任何密钥；
 *   对应端点没配置时，该模型位保持停用，不会假装可用。
 * - 开发环境没有本地模型，所以把「对话 / 规划 / 总结」三条策略改为允许云端（原预设为仅本地），
 *   原本地常驻位保留为第二候选。生产环境请按组织数据边界自行决定。
 * - free 模式（KX-66）：付费模型位一律停用；11 条策略只保留 Agnes Flash 一个候选（不会 fallback 到付费模型）；
 *   Agnes 不具备的能力要求（如 REASONING）在开发库里临时放宽并逐条打印。这只是开发测试口径，
 *   跑 --mode=full 会把能力要求和路由恢复为预设 / KX-65 配置。
 */
import { Prisma } from "@prisma/client";
import prisma from "../src/shared/db";
import { bootstrapDefaultWorkforce } from "../src/modules/workforce/service";
import { installRecommendedModelControlPresets, saveModelPolicy, saveModelProfile } from "../src/modules/model-control/service";
import { MODEL_POLICY_PRESETS } from "../src/modules/model-control/presets";
import { isProviderRuntimeConfigured } from "../src/modules/model-gateway/provider-runtime";

const DEMO_EMAIL = process.env.KERN_DEMO_EMAIL ?? "zhang_pm@hermes.test";

const modeArg = process.argv.find((a) => a.startsWith("--mode="))?.slice("--mode=".length) ?? "free";
if (modeArg !== "free" && modeArg !== "full") throw new Error(`--mode 只能是 free 或 full，收到：${modeArg}`);
const MODE: "free" | "full" = modeArg;
const FREE_PROFILE = "dev-agnes-flash";

const PROFILES = [
  { key: "dev-gateway-glm", displayName: "GLM 5.3（网关）· 常驻对话", provider: "kern-gateway", modelId: "glm-5.3", capabilities: ["TEXT", "TOOLS", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"], qualityTier: "BALANCED", latencyTier: "FAST", costTier: "LOW" },
  { key: "dev-agnes-flash", displayName: "Agnes 3.0 Flash · 日常快速（免费）", provider: "agnes", modelId: "agnes-3.0-flash", capabilities: ["TEXT", "STRUCTURED_OUTPUT"], qualityTier: "FAST", latencyTier: "FAST", costTier: "FREE" },
  { key: "dev-mimo-pro", displayName: "MiMo v2.6 Pro · 核心研发", provider: "mimo", modelId: "mimo-v2.6-pro", capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING", "LONG_CONTEXT"], qualityTier: "FRONTIER", latencyTier: "NORMAL", costTier: "PREMIUM" },
  { key: "dev-gateway-gpt55", displayName: "GPT-5.5（网关）· 红队复核", provider: "kern-gateway", modelId: "gpt-5.5", capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"], qualityTier: "FRONTIER", latencyTier: "SLOW", costTier: "PREMIUM" },
] as const;

/** 策略 → 候选（按优先级）。未列出的策略保持预设不变。 */
const ROUTES: Record<string, { candidates: string[]; cloudAllowed?: boolean }> = {
  "assistant-dialogue-resident": { candidates: ["dev-gateway-glm", "muse-glimmer-resident-slot"], cloudAllowed: true },
  "assistant-planning-resident": { candidates: ["dev-gateway-glm", "muse-glimmer-resident-slot"], cloudAllowed: true },
  "assistant-synthesis-resident": { candidates: ["dev-gateway-glm", "muse-glimmer-resident-slot"], cloudAllowed: true },
  "routine-quick-classify": { candidates: ["dev-agnes-flash", "dev-gateway-glm"] },
  "routine-quick-research": { candidates: ["dev-agnes-flash", "dev-gateway-glm"] },
  "routine-summarization": { candidates: ["dev-agnes-flash", "dev-gateway-glm"] },
  "strategic-product-analysis": { candidates: ["dev-mimo-pro", "dev-gateway-glm"] },
  "strategic-consulting": { candidates: ["dev-mimo-pro", "dev-gateway-glm"] },
  "tech-architecture-coding": { candidates: ["dev-mimo-pro", "dev-gateway-glm"] },
  "red-team-review": { candidates: ["dev-gateway-gpt55", "dev-mimo-pro"] },
  "decision-review": { candidates: ["dev-gateway-gpt55", "dev-mimo-pro"] },
};

async function main() {
  const db = ((await prisma.$queryRawUnsafe(`select current_database() as d`)) as { d: string }[])[0].d;
  if (!/_dev$/.test(db)) throw new Error(`只允许在开发库运行，当前库：${db}`);

  const demo = await prisma.user.findFirstOrThrow({ where: { email: DEMO_EMAIL } });
  const admin = await prisma.organizationMember.findFirst({
    where: { organizationId: demo.organizationId, role: "ORG_ADMIN" },
    include: { user: true },
  });
  if (!admin) throw new Error("该组织没有管理员账号，无法配置模型");
  const session = { userId: admin.user.id, organizationId: demo.organizationId, userEmail: admin.user.email, userName: admin.user.name };
  console.log(`组织 ${demo.organizationId.slice(0, 8)}… 管理员 ${admin.user.email}`);
  console.log(`模式：${MODE === "free" ? "free（只用免费的 Agnes Flash）" : "full（KX-65 四模型路由，会产生付费调用）"}`);

  await bootstrapDefaultWorkforce(session);
  console.log("数字员工：", await prisma.agent.count({ where: { organizationId: demo.organizationId } }), "个");

  // 先装预设（含员工 ↔ 策略绑定），再覆盖模型位与路由；顺序不能反，否则预设会把路由改回去。
  await installRecommendedModelControlPresets(session);

  for (const p of PROFILES) {
    const ready = isProviderRuntimeConfigured(p.provider);
    const allowed = MODE === "full" || p.costTier === "FREE";
    const enabled = ready && allowed;
    await saveModelProfile(session, {
      ...p,
      capabilities: [...p.capabilities],
      description: "KX-65 开发环境示例模型位。端点与密钥来自环境变量，不存数据库。",
      locality: "CLOUD",
      health: ready ? "HEALTHY" : "UNAVAILABLE",
      enabled,
      contextWindow: null,
      dataPolicyNote: "开发环境示例；生产环境请按组织数据边界重新配置。",
    });
    console.log(`模型位 ${p.key}: ${enabled ? "已启用" : !ready ? "端点未配置，保持停用" : "付费模型，free 模式下停用"}`);
  }

  const freeCaps = new Set<string>(PROFILES.find((p) => p.key === FREE_PROFILE)?.capabilities ?? []);
  if (MODE === "free" && !isProviderRuntimeConfigured("agnes")) {
    console.warn("警告：Agnes 端点未配置（MODEL_PROVIDER_AGNES_BASE_URL），free 模式下没有可用模型。");
  }

  for (const preset of MODEL_POLICY_PRESETS) {
    const route = ROUTES[preset.key];
    if (!route) continue;
    const free = MODE === "free";
    const requiredCapabilities = free
      ? preset.requiredCapabilities.filter((c) => freeCaps.has(c))
      : preset.requiredCapabilities;
    const relaxed = preset.requiredCapabilities.filter((c) => !requiredCapabilities.includes(c));
    if (relaxed.length) console.log(`策略 ${preset.key}: free 模式临时放宽能力要求 ${relaxed.join(", ")}`);
    await saveModelPolicy(session, {
      key: preset.key,
      name: preset.name,
      description: preset.description,
      version: preset.version,
      taskClass: preset.taskClass,
      requiredCapabilities,
      maxContextRequirement: preset.maxContextRequirement,
      cloudAllowed: free ? true : route.cloudAllowed ?? preset.cloudAllowed,
      candidates: (free ? [FREE_PROFILE] : route.candidates).map((profileKey, i) => ({ profileKey, priority: (i + 1) * 10 })),
    });
    // KX-66：免费档每分钟额度很小（实测约 10 次）：429 冷却缩短到 10 秒，网关内等待重试放宽到 5 次 / 120 秒
    // （5s → 10s → 20s → 40s → 余额 退避可跨过两个分钟窗口；2026-09-30 kx66 报告：3 次 / 45 秒下
    // synthesis 在并发节点吃满限流仍会失败，mission 收在 NEEDS_USER）。
    // full 模式清空，回到默认失败策略。
    await prisma.modelPolicyConfig.update({
      where: { organizationId_key: { organizationId: session.organizationId, key: preset.key } },
      data: {
        failurePolicy: free
          ? { rateLimitCooldownMs: 10_000, rateLimitRetries: 5, rateLimitMaxWaitMs: 120_000 }
          : Prisma.DbNull,
      },
    });
  }
  console.log("策略：已更新", Object.keys(ROUTES).length, "条", MODE === "free" ? `（全部只指向 ${FREE_PROFILE}）` : "");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
