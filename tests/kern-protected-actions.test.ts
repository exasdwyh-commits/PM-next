/**
 * 受保护动作清单 guard（docs/KERN_AGENT_FIELD_REPORT_MUSE_2026-09-27.md §4-3）。
 *
 * 目标不是「再写一份清单」，而是锁住：清单只有一份，并且每一个会产生受保护副作用的
 * 入口（autonomy 维度 / ToolBroker 能力 / 本机动作 / 模型 prompt / UI 标签）都映射到它。
 * 新增入口而未登记 → 失败；登记了但覆盖不上 → 失败；已知缺口必须显式写明原因。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  AUTONOMY_DIMENSION_GATES,
  DESKTOP_TOOL_RISK,
  HUMAN_GATES,
  HUMAN_GATE_IDS,
  HUMAN_GATE_LABEL,
  PERSONA_COVERAGE_GAPS,
  PROTECTED_CAPABILITY_GATES,
  desktopActionGates,
  isHumanGateId,
  type HumanGateId,
} from "../src/modules/governance/protected-actions";
import { PROTECTED_CAPABILITIES } from "../src/modules/governance/capability-policy";
import { ToolBroker, ToolBrokerDeniedError } from "../src/modules/governance/tool-broker";
import {
  assessChatProposalAutonomy,
  assessKernCapabilityRisk,
  type KernCapabilityRisk,
} from "../src/modules/assistant-runtime/autonomy";
import { buildDepartmentAssistantSystemPrompt } from "../src/modules/assistant-runtime/persona";
import { buildKernGoalPlanShadow } from "../src/modules/assistant-runtime/goal-plan";
import { MISSION_HUMAN_GATES, buildMissionPlanFromGoalPlan } from "../src/modules/supervisor/plan";
import { GATE_LABEL } from "../src/app/muse/mission-timeline";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const SAFE_RISK: KernCapabilityRisk = {
  capability: "test.capability",
  explicitUserInstruction: true,
  targetResolved: true,
  reversibility: "REVERSIBLE",
  externalSideEffect: false,
  financialImpact: false,
  permissionSensitive: false,
  productionRelease: false,
  formalBusinessGate: false,
  destructive: false,
};

test("PA1 清单本身完整：id 唯一、标签与范围非空、kind 合法", () => {
  const ids = HUMAN_GATES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "gate id 重复");
  for (const gate of HUMAN_GATES) {
    assert.match(gate.id, /^[A-Z][A-Z_]+[A-Z]$/, `${gate.id} 不是 UPPER_SNAKE`);
    assert.ok(gate.label.trim().length > 0, `${gate.id} 缺标签`);
    assert.ok(gate.scope.trim().length > 0, `${gate.id} 缺范围说明`);
    assert.ok(gate.kind === "ACTION" || gate.kind === "DECISION");
  }
  // 来自实测记录的最小清单：花钱 / 发布 / 删除 / 对外发送 / 个人肖像 / 凭证
  for (const required of [
    "PAYMENT_OR_FINANCIAL_COMMITMENT",
    "EXTERNAL_PUBLISH_OR_SEND",
    "IRREVERSIBLE_DELETE_OR_OVERWRITE",
    "PERSONAL_DATA_OR_LIKENESS",
    "CREDENTIAL_USE_OR_DISCLOSURE",
  ]) {
    assert.ok(isHumanGateId(required), `缺少必备 gate ${required}`);
  }
});

test("PA2 任务计划与 GoalPlan 不再各抄一份：都等于清单", () => {
  assert.deepEqual([...MISSION_HUMAN_GATES], [...HUMAN_GATE_IDS]);

  const goalPlan = buildKernGoalPlanShadow({
    goal: "评估一个新方向是否值得继续",
    collaboration: {
      version: "kern-collaboration-shadow/v1" as const,
      mode: "COUNCIL" as const,
      experts: ["research_agent", "product_agent"],
      synthesisTier: "FRONTIER" as const,
      researchRequired: true,
      independentFirstPass: true,
      qaRequired: true,
      redTeamRequired: false,
      autoDispatchCandidate: false,
      autoDispatchEligible: false,
      authority: "ADVISORY_ONLY" as const,
      source: "DETERMINISTIC" as const,
      reasons: ["TEST"],
    },
  });
  assert.deepEqual(goalPlan.humanGates, [...HUMAN_GATE_IDS]);
  assert.deepEqual(buildMissionPlanFromGoalPlan(goalPlan).humanGates, [...HUMAN_GATE_IDS]);

  // 计划里的 gate 数组是快照的一部分，不能与清单共享同一引用（防止被就地修改污染全局）
  assert.notStrictEqual(goalPlan.humanGates, HUMAN_GATE_IDS);
});

test("PA3 UI 标签覆盖每一个 gate，且与清单一致", () => {
  for (const gate of HUMAN_GATES) {
    assert.equal(GATE_LABEL[gate.id], gate.label, `${gate.id} 在工作区里会显示成原始 id`);
    assert.equal(HUMAN_GATE_LABEL[gate.id], gate.label);
  }
});

test("PA4 autonomy：每个风险维度都映射到 gate，且确实触发 ASK", () => {
  const booleanDims = Object.keys(SAFE_RISK).filter(
    (k) =>
      typeof SAFE_RISK[k as keyof KernCapabilityRisk] === "boolean" &&
      k !== "explicitUserInstruction" &&
      k !== "targetResolved"
  );
  // 反向：KernCapabilityRisk 新增维度而未映射 → 失败
  for (const dim of booleanDims) {
    assert.ok(dim in AUTONOMY_DIMENSION_GATES, `autonomy 维度 ${dim} 未映射到任何 gate`);
  }
  assert.ok("irreversible" in AUTONOMY_DIMENSION_GATES);

  for (const [dim, gates] of Object.entries(AUTONOMY_DIMENSION_GATES)) {
    assert.ok(gates.length > 0);
    for (const g of gates) assert.ok(isHumanGateId(g), `${dim} → 未知 gate ${g}`);
    const risk: KernCapabilityRisk =
      dim === "irreversible"
        ? { ...SAFE_RISK, reversibility: "IRREVERSIBLE" }
        : { ...SAFE_RISK, [dim]: true };
    assert.equal(assessKernCapabilityRisk(risk).decision, "ASK", `${dim}=true 却没有 ASK`);
  }
});

test("PA5 autonomy：声明触及任一 gate 的能力一律 ASK，且原因可追溯到 gate", () => {
  assert.equal(assessKernCapabilityRisk(SAFE_RISK).decision, "AUTO");
  for (const id of HUMAN_GATE_IDS) {
    const assessment = assessKernCapabilityRisk({ ...SAFE_RISK, gates: [id] });
    assert.equal(assessment.decision, "ASK", `${id} 未触发 ASK`);
    assert.ok(assessment.reasons.includes(`GATE:${id}`));
  }
  // 自动执行白名单里的提案不得触及任何 gate
  for (const [intent, actionType] of [
    ["PROPOSE_FIELD_CHANGE", "UPDATE_FIELD"],
    ["PROPOSE_CREATE_WORK_ITEM", "CREATE_WORK_ITEM"],
    ["NEW_PRODUCT_INTAKE", "CREATE_PRODUCT"],
  ] as const) {
    const a = assessChatProposalAutonomy({ intent, actionType });
    assert.equal(a.decision, "AUTO");
    assert.ok(!a.reasons.some((r) => r.startsWith("GATE:")));
  }
});

test("PA6 ToolBroker 受保护能力与清单一一对应", () => {
  const protectedCaps = [...PROTECTED_CAPABILITIES].map(String).sort();
  assert.deepEqual(Object.keys(PROTECTED_CAPABILITY_GATES).sort(), protectedCaps);
  for (const [cap, gates] of Object.entries(PROTECTED_CAPABILITY_GATES)) {
    assert.ok(gates.length > 0, `${cap} 没有说明为何受保护`);
    for (const g of gates) assert.ok(isHumanGateId(g), `${cap} → 未知 gate ${g}`);
  }
});

test("PA7 ToolBroker 对每个受保护能力：无 ApprovalGrant 一律拒绝（真实拦截，不只是清单）", async () => {
  let executed = 0;
  const broker = new ToolBroker({
    identity: { actorId: "u1", organizationId: "org1" },
    tools: { probe: async () => { executed += 1; return "ran"; } },
    authorizer: () => true,
    approvalService: { consume: async () => { throw new Error("no grant"); } } as never,
  });
  for (const capability of PROTECTED_CAPABILITIES) {
    await assert.rejects(
      broker.call({ tool: "probe", capability, resource: "r", taskRef: "t", runId: "run", input: null }),
      (err: unknown) => err instanceof ToolBrokerDeniedError && err.reason === "approval-grant-required",
      `${capability} 未带授权却没有被拒绝`
    );
    await assert.rejects(
      broker.call({
        tool: "probe", capability, resource: "r", taskRef: "t", runId: "run", input: null,
        approvalGrantId: "forged", actionHash: "sha256:x",
      }),
      (err: unknown) => err instanceof ToolBrokerDeniedError && err.reason === "approval-grant-invalid"
    );
  }
  assert.equal(executed, 0, "受保护能力在未授权时被执行了");
});

test("PA8 模型侧 persona 覆盖每个 gate；未覆盖的必须显式登记原因（且登记表不能过期）", () => {
  const prompt = buildDepartmentAssistantSystemPrompt("ASSISTANT_DIALOGUE");
  assert.ok(prompt, "ASSISTANT_DIALOGUE 必须有 persona prompt");
  for (const gate of HUMAN_GATES) {
    const gap = PERSONA_COVERAGE_GAPS[gate.id as HumanGateId];
    if (gate.personaCue) {
      assert.ok(prompt.includes(gate.personaCue), `persona 未提到 ${gate.id}（关键词「${gate.personaCue}」）`);
      assert.equal(gap, undefined, `${gate.id} 已被 persona 覆盖，请从 PERSONA_COVERAGE_GAPS 删除`);
    } else {
      assert.ok(gap && gap.trim().length > 0, `${gate.id} 没有 persona 关键词，也没有登记缺口原因`);
    }
  }
  for (const key of Object.keys(PERSONA_COVERAGE_GAPS)) {
    assert.ok(isHumanGateId(key), `PERSONA_COVERAGE_GAPS 含未知 gate ${key}`);
  }
});

test("PA9 本机动作：类型定义与执行端出现的每个工具都已分级", () => {
  const contracts = read("src/modules/desktop-runtime/contracts.ts");
  const union = contracts.slice(
    contracts.indexOf("export type DesktopAction ="),
    contracts.indexOf("export interface DesktopTaskEnvelope")
  );
  const typeTools = [...union.matchAll(/tool:\s*"([a-z_.]+)"/g)].map((m) => m[1]);
  assert.ok(typeTools.length >= 10, "没能从 contracts.ts 解析出 DesktopAction 工具列表");

  const executor = read("scripts/hermes-desktop.ts");
  const executorTools = [...executor.matchAll(/case\s+"([a-z]+\.[a-z_]+)":/g)].map((m) => m[1]);
  assert.ok(executorTools.length >= 10, "没能从执行端解析出工具分支");

  const classified = new Set(Object.keys(DESKTOP_TOOL_RISK));
  for (const tool of new Set([...typeTools, ...executorTools])) {
    assert.ok(classified.has(tool), `本机工具 ${tool} 未在 DESKTOP_TOOL_RISK 中分级`);
  }
  for (const tool of classified) {
    assert.ok(typeTools.includes(tool), `DESKTOP_TOOL_RISK 含已不存在的工具 ${tool}`);
  }
});

test("PA10 本机动作分级自洽；触及 gate 的工具必须写明拦截方式或缓解措施", () => {
  for (const [tool, risk] of Object.entries(DESKTOP_TOOL_RISK)) {
    for (const g of risk.gates) assert.ok(isHumanGateId(g), `${tool} → 未知 gate ${g}`);
    if (risk.effect === "READ_ONLY") {
      assert.equal(risk.gates.length, 0, `${tool} 标为只读却触及 gate`);
    }
    if (risk.effect === "LOCAL_OVERWRITE" || risk.effect === "UNBOUNDED") {
      assert.ok(risk.gates.length > 0, `${tool}（${risk.effect}）必须至少触及一个 gate`);
    }
    if (risk.capability) {
      assert.ok(
        (PROTECTED_CAPABILITIES as ReadonlySet<string>).has(risk.capability),
        `${tool} 声明的能力 ${risk.capability} 不在 PROTECTED_CAPABILITIES`
      );
      assert.ok(risk.gates.length > 0);
    }
    if (risk.gates.length > 0) {
      assert.ok(risk.mitigation && risk.mitigation.trim().length > 0, `${tool} 触及 gate 但没写拦截方式或缓解措施`);
    } else {
      assert.equal(risk.enforcement, "NONE", `${tool} 不触及 gate，不应声明拦截`);
    }
  }
});

test("PA11 具体动作按参数判定：追加写入不算覆盖，覆盖写入要过 gate", () => {
  assert.deepEqual(desktopActionGates({ tool: "fs.write_text", path: "a.md", content: "x", append: true }), []);
  assert.deepEqual(desktopActionGates({ tool: "fs.write_text", path: "a.md", content: "x" }), [
    "IRREVERSIBLE_DELETE_OR_OVERWRITE",
  ]);
  assert.deepEqual(desktopActionGates({ tool: "git.status" }), []);
  assert.ok(desktopActionGates({ tool: "shell.run", command: "npm test" }).length > 0);
});

test("PA12 声明为执行端拦截的工具：执行端对应分支确实走覆盖保护，不是只改了表", () => {
  const executor = read("scripts/hermes-desktop.ts");
  const executorTools = Object.entries(DESKTOP_TOOL_RISK).filter(([, r]) => r.enforcement === "EXECUTOR");
  assert.ok(executorTools.length > 0);
  for (const [tool] of executorTools) {
    const start = executor.indexOf(`case "${tool}":`);
    assert.ok(start >= 0, `执行端没有 ${tool} 分支`);
    const next = executor.indexOf("case \"", start + 1);
    const branch = executor.slice(start, next < 0 ? undefined : next);
    assert.match(branch, /overwriteConfirmationResult\(/, `${tool} 分支未在已存在时转为等人`);
    assert.match(branch, /\b(?:writeTextFile|moveEntry)\(/, `${tool} 分支未使用带覆盖保护的 local-fs`);
    assert.doesNotMatch(branch, /\bfs\.(?:writeFile|rename)\(/, `${tool} 分支仍直接调用会覆盖的 fs API`);
  }
  // 没有任何工具声称服务端拦截，除非真的实现（当前 enqueueDesktopTask 不经 gate）
  const service = read("src/modules/desktop-runtime/service.ts");
  for (const [tool, r] of Object.entries(DESKTOP_TOOL_RISK)) {
    if (r.enforcement === "SERVER") {
      assert.match(service, /ApprovalGrant|approvalGrant/, `${tool} 声称服务端拦截，但 service.ts 没有任何授权校验`);
    }
  }
});
