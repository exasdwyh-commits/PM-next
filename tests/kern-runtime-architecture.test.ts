import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("Kern owns the primary conversation lifecycle", () => {
  const service = read("src/modules/assistant-runtime/service.ts");
  const engine = read("src/modules/assistant-runtime/conversation-engine.ts");
  const messagesRoute = read("src/app/api/conversations/[id]/messages/route.ts");
  const conversationsRoute = read("src/app/api/conversations/route.ts");

  assert.equal(
    service.includes("sendLegacyAdvisorMessage"),
    false,
    "primary Kern service must not delegate the whole turn to legacy Advisor"
  );
  assert.ok(
    service.includes("executeKernConversationTurn"),
    "Kern service must invoke its own conversation engine"
  );
  assert.ok(
    engine.includes('runtimeOwner: "KERN_ASSISTANT"'),
    "AgentRun context must record Kern as the runtime owner"
  );
  assert.ok(
    engine.includes('capabilityProvider: "KERN_CAPABILITY_REGISTRY"'),
    "AgentRun context must record the native capability registry"
  );
  assert.equal(
    engine.includes("@/modules/advisor/service"),
    false,
    "conversation engine must not depend on the legacy Advisor service facade"
  );
  assert.equal(
    messagesRoute.includes("@/modules/advisor/service"),
    false,
    "conversation message API must not import legacy Advisor directly"
  );
  assert.equal(
    conversationsRoute.includes("@/modules/advisor/service"),
    false,
    "conversation CRUD API must not import legacy Advisor directly"
  );
});


test("legacy Advisor service is a compatibility facade, not a runtime core", () => {
  const advisor = read("src/modules/advisor/service.ts");
  const registry = read("src/modules/assistant-runtime/capabilities/registry.ts");

  assert.ok(advisor.split("\n").length < 100, "Advisor service must stay a thin facade");
  for (const forbidden of [
    'case "START_PRODUCT_RND"',
    'case "PRODUCT_RND_STATUS"',
    'case "DESKTOP_EXECUTION"',
    'case "PROPOSE_FIELD_CHANGE"',
    'case "KNOWLEDGE_SEARCH"',
    "prisma.",
  ]) {
    assert.equal(advisor.includes(forbidden), false, `Advisor core logic returned: ${forbidden}`);
  }
  assert.equal(
    registry.includes("@/modules/advisor/service"),
    false,
    "native capability registry must never fall back to Advisor service"
  );
  assert.ok(
    registry.includes('"UNSUPPORTED"'),
    "registry must own the fallback capability path too"
  );
});

test("Kern Chat view model is conversation-first, not mission/today dashboard-first", () => {
  // KX-71：类型下沉到模块层，页面文件只 re-export。
  const types = read("src/modules/muse/types.ts");
  const readModel = read("src/modules/muse/read-model.ts");
  const client = read("src/app/muse/muse-client.tsx");

  for (const stale of [
    "interface Mission",
    "activeMissionId",
    "TodayBrief",
    "missionId:",
    "brief.missions",
  ]) {
    assert.equal(
      types.includes(stale) || readModel.includes(stale) || client.includes(stale),
      false,
      `stale dashboard semantic returned: ${stale}`
    );
  }

  assert.ok(types.includes("interface ConversationSummary"));
  assert.ok(types.includes("activeConversationId"));
  assert.ok(readModel.includes("conversationSummaries"));
  assert.equal(
    readModel.includes("getWorkspaceOverview(session)"),
    false,
    "Kern chat read model must not preload the management dashboard"
  );
});


test("Kern Chat exposes real conversation-level model advisor skill and function controls", () => {
  const schema = read("prisma/schema.prisma");
  const client = read("src/app/muse/muse-client.tsx");
  const shell = read("src/app/muse/components/shell.tsx");
  const engine = read("src/modules/assistant-runtime/conversation-engine.ts");
  const registry = read("src/modules/assistant-runtime/capabilities/registry.ts");

  assert.ok(schema.includes("runtimeConfig  Json?"));
  for (const label of ["模型", "顾问", "技能", "功能"]) {
    assert.ok(shell.includes(label), `missing dock control: ${label}`);
  }
  assert.ok(client.includes("/runtime-config"));
  assert.ok(client.includes("runtimeConfig"));
  assert.ok(engine.includes("resolveExplicitConversationModel"));
  assert.ok(engine.includes("buildKernConversationSelectionPrompt"));
  assert.ok(engine.includes("effectiveToolWhitelist"));
  assert.ok(registry.includes("kern.capability.disabled"));
});

test("autonomy is risk-based and Project Map is a first-class visual capability", () => {
  const autonomy = read("src/modules/assistant-runtime/autonomy.ts");
  const projectMap = read("src/modules/visual-intelligence/project-map-builder.ts");

  for (const dimension of [
    "reversibility",
    "externalSideEffect",
    "financialImpact",
    "permissionSensitive",
    "productionRelease",
    "formalBusinessGate",
    "destructive",
  ]) {
    assert.ok(autonomy.includes(dimension), `missing autonomy risk dimension: ${dimension}`);
  }

  assert.ok(projectMap.includes("buildProjectArchitectureGraph"));
  assert.ok(projectMap.includes("toArchifyArchitectureSpec"));
  assert.ok(projectMap.includes('"VERIFIED"'));
});


test("Kern V2 keeps advanced controls quiet and gates execution below the GoalPlan", () => {
  const shell = read("src/app/muse/components/shell.tsx");
  const workbench = read("src/app/workbench-client.tsx");
  const goalPlan = read("src/modules/assistant-runtime/goal-plan.ts");
  const service = read("src/modules/assistant-runtime/service.ts");

  assert.ok(shell.includes("m-advanced-controls"));
  assert.ok(shell.includes("Auto · Kern"));
  assert.ok(shell.includes("Conversation 高级运行配置"));
  assert.equal(
    workbench.includes("QUICK_ACTIONS"),
    false,
    "management workbench must not rebuild a prompt-template hero"
  );
  assert.equal(
    workbench.includes("hermes-command-copy"),
    false,
    "management workbench must keep the Kern handoff compact"
  );

  assert.ok(goalPlan.includes('"kern-goal-plan-shadow/v1"'));
  assert.ok(goalPlan.includes("autoCreateAgentTasks: false"));
  assert.ok(goalPlan.includes('specialistAutoDispatch: "READINESS_GATED"'));
  // human gate 清单已收敛到 governance/protected-actions.ts（行为断言见 kern-protected-actions PA2）
  assert.ok(goalPlan.includes("humanGates: [...HUMAN_GATE_IDS]"));
  assert.ok(
    read("src/modules/governance/protected-actions.ts").includes('"STRATEGIC_VALUE_TRADEOFF"')
  );
  assert.ok(service.includes("buildKernGoalPlanShadow"));
  assert.ok(service.includes("goalPlanShadow"));
  assert.ok(service.includes("resolveKernDispatchReadiness"));
  assert.ok(service.includes("enqueueKernSpecialistDispatch"));
});


test("Kern human attention excludes internal return-review work", () => {
  const activityBrief = read("src/modules/workforce/activity-brief.ts");
  assert.ok(
    activityBrief.includes("attentionCount: waitingHumanCount + waitingPolicyCount"),
    "human attention count must only include true human waits and policy gates"
  );
  assert.ok(
    activityBrief.includes("returned child results are Kern's internal supervision work"),
    "return reviews must be documented as Kern supervision, not default user interruption"
  );
});


test("Kern specialist AUTO is database-idempotent and provenance-bound", () => {
  const schema = read("prisma/schema.prisma");
  const dispatch = read("src/modules/assistant-runtime/specialist-dispatch.ts");
  const returnPath = read("src/modules/workforce/conversation-return.ts");
  // KX-71：worker 只留通用执行器，专员策略在 product-rnd，通过 worker/registry 注册。
  const executor = read("src/modules/worker/executor.ts") + read("src/modules/product-rnd/executor-strategies.ts") + read("src/modules/supervisor/worker-runtime.ts");

  assert.ok(schema.includes("idempotencyKey  String?          @unique"));
  assert.ok(dispatch.includes("sourceRun"));
  assert.ok(dispatch.includes("conversationId: input.conversationId"));
  assert.ok(dispatch.includes("idempotencyKey"));
  assert.ok(dispatch.includes('error.code === "P2002"'));
  assert.ok(returnPath.includes("FOR UPDATE"));
  assert.ok(returnPath.includes("kern-conversation-return-receipt/v1"));
  assert.ok(executor.includes("runTechArchitectAgent"));
  assert.ok(executor.includes("appendAgentTaskConversationReturn"));
});

test("PAIR and COUNCIL are not silently promoted to AUTO", () => {
  const planner = read("src/modules/assistant-runtime/collaboration-planner.ts");
  const readiness = read("src/modules/assistant-runtime/dispatch-readiness.ts");

  assert.ok(planner.includes('(mode === "SOLO" || mode === "SPECIALIST")'));
  assert.ok(readiness.includes('plan.mode !== "SPECIALIST" || plan.experts.length !== 1'));
  assert.ok(readiness.includes('"REVIEW_REQUIRED"'));
  assert.ok(readiness.includes('"AGENT_UNAVAILABLE"'));
  assert.ok(readiness.includes('status: "ACTIVE"'));
  assert.ok(readiness.includes("CHAT_SPECIALIST_EXECUTION"));
  assert.ok(readiness.includes('tech_architect_agent: { taskClass: "CODING"'));
});

test("来源可靠度：五档全中文、未评级中性，且不再有红标 UNKNOWN", async () => {
  const { confidenceOf } = await import("@/modules/muse/confidence");
  const { SOURCE_AUTHORITIES, SOURCE_AUTHORITY_LABEL } = await import("@/shared/vocabulary");

  // 档位映射：知识层 authorityTier → 显示档
  assert.equal(confidenceOf({ authorityTier: "first_party", verified: true }), "confirmed");
  assert.equal(confidenceOf({ authorityTier: "first_party", verified: false }), "internal");
  assert.equal(confidenceOf({ authorityTier: "curated" }), "curated");
  assert.equal(confidenceOf({ authorityTier: "public" }), "public");
  assert.equal(confidenceOf({ authorityTier: "unknown" }), "unrated");
  // 上游没给档位时必须落到未评级 —— 猜一个档等于造假绿标
  assert.equal(confidenceOf({}), "unrated");
  assert.equal(confidenceOf({ authorityTier: 123, verified: "yes" }), "unrated");

  // 五档文案全中文（唯一来源：@/shared/vocabulary）
  for (const key of SOURCE_AUTHORITIES) {
    const label = SOURCE_AUTHORITY_LABEL[key];
    assert.ok(/^[\u4e00-\u9fa5]+$/.test(label), `来源标签必须是纯中文：${key} → ${label}`);
  }
  assert.equal(SOURCE_AUTHORITY_LABEL.unrated, "未评级");

  const kit = read("src/app/muse/components/kit.tsx").replace(/\r/g, "");
  // 文案必须取自 vocabulary，不得在 kit 里另抄一份（否则两处必然漂移）
  assert.ok(
    kit.includes("SOURCE_AUTHORITY_LABEL"),
    "kit 的五档文案必须取自 @/shared/vocabulary"
  );
  assert.ok(
    /unrated:\s*\{\s*label:\s*SOURCE_AUTHORITY_LABEL\.unrated,\s*tone:\s*"neutral"\s*\}/.test(kit),
    "「未评级」必须是中性语气，不得是 bad/warn"
  );
  assert.equal(kit.includes('label: "UNKNOWN"'), false, "来源卡片不得再出现英文 UNKNOWN 红标");
  assert.equal(kit.includes('label: "已确认"'), false, "五档文案不得在 kit 里重复定义");

  // 映射层不得再写死占位档
  for (const file of ["src/app/muse/muse-client.tsx", "src/modules/muse/read-model.ts"]) {
    assert.equal(
      read(file).includes('confidence: "unknown"'),
      false,
      `${file} 不得再把来源可靠度写死成 unknown`
    );
  }
});
