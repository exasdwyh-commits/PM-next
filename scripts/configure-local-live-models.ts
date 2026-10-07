/** Verified remote models for the reserved local workspace; credentials stay in environment files. */
import prisma from "../src/shared/db";
import { LOCAL_TEST_EMAIL, LOCAL_TEST_ORG } from "../src/modules/identity/local-test-policy";
import { saveModelPolicy, saveModelProfile } from "../src/modules/model-control/service";
import { MODEL_POLICY_PRESETS, type ModelProfilePreset } from "../src/modules/model-control/presets";
import { isProviderRuntimeConfigured } from "../src/modules/model-gateway/provider-runtime";

async function main() {
  const database = (await prisma.$queryRaw<{ name: string }[]>`select current_database() as name`)[0].name;
  if (!database.endsWith("_dev")) throw new Error("Only a development database is allowed");
  const user = await prisma.user.findUniqueOrThrow({ where: { email: LOCAL_TEST_EMAIL }, include: { organization: true } });
  if (user.organization.code !== LOCAL_TEST_ORG || user.isSystem || !user.isActive) throw new Error("Invalid local workspace");
  const session = { userId: user.id, organizationId: user.organizationId, userEmail: user.email, userName: user.name };
  const profiles: Array<Pick<ModelProfilePreset, "key" | "displayName" | "provider" | "modelId" | "capabilities" | "qualityTier">> = [
    { key: "live-agnes-flash", displayName: "Agnes 3.0 Flash", provider: "agnes", modelId: "agnes-3.0-flash", capabilities: ["TEXT", "STRUCTURED_OUTPUT"], qualityTier: "FAST" },
    { key: "live-mimo-pro", displayName: "MiMo v2.6 Pro", provider: "mimo", modelId: "mimo-v2.6-pro", capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"], qualityTier: "FRONTIER" },
    { key: "live-sensenova-flash", displayName: "日日新 6.8 Flash Lite", provider: "sensenova", modelId: "sensenova-6.8-flash-lite", capabilities: ["TEXT", "STRUCTURED_OUTPUT", "REASONING"], qualityTier: "BALANCED" },
  ];
  if (process.argv.includes("--gateway-verified")) profiles.push({ key: "live-gateway-glm", displayName: "GLM 5.3（网关）", provider: "kern-gateway", modelId: "glm-5.3", capabilities: ["TEXT", "STRUCTURED_OUTPUT"], qualityTier: "BALANCED" });
  for (const profile of profiles) {
    if (!isProviderRuntimeConfigured(profile.provider)) throw new Error(`Missing provider configuration: ${profile.provider}`);
    await saveModelProfile(session, { ...profile, description: "已通过实际接口连接与 JSON 回答验证。", locality: "CLOUD", enabled: true, health: "HEALTHY", latencyTier: "NORMAL", costTier: "STANDARD", contextWindow: null, dataPolicyNote: "远程服务；费用以供应商账单为准。密钥来自服务环境，不写入数据库。" });
  }
  for (const preset of MODEL_POLICY_PRESETS) {
    if (preset.key === "private-local-extraction") continue;
    const complex = preset.requiredCapabilities.includes("REASONING");
    const candidates = complex ? ["live-mimo-pro", "live-sensenova-flash"] : ["live-agnes-flash", "live-sensenova-flash"];
    await saveModelPolicy(session, { ...preset, description: "本地测试工作区使用用户指定并验证的远程服务。", cloudAllowed: true, candidates: candidates.map((profileKey, i) => ({ profileKey, priority: (i + 1) * 10 })) });
  }
  console.log(JSON.stringify({ workspace: user.organization.name, profiles: profiles.map(p => ({ key: p.key, model: p.modelId })), privateExtractionCloudAllowed: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Configuration failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
