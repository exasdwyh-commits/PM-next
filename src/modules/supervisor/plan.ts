import type { ModelTaskClass } from "@/modules/model-gateway";
import type { KernGoalPlanShadow } from "@/modules/assistant-runtime/goal-plan";
import type { KernCollaborationPlanShadow } from "@/modules/assistant-runtime/collaboration-planner";
import { HUMAN_GATE_IDS } from "@/modules/governance/protected-actions";

/**
 * Kern Mission Plan — the *executable* form of a goal.
 * ==================================================
 *
 * GoalPlanShadow (assistant-runtime/goal-plan.ts) describes what Kern *would*
 * do. A MissionPlan is what Kern *will* do: a small DAG of agent nodes, a
 * revision budget and the human gates that stop automation.
 *
 * This file is pure (no DB / no model). All supervisor decisions are made by
 * `decideMissionStep`, so the control policy is unit-testable and replayable.
 */

import type { MissionNode, MissionNodeKind, MissionPlan, MissionPlaybook, MissionSignal } from "@/modules/kern-contracts";
export type { MissionNode, MissionNodeKind, MissionPlan, MissionPlaybook, MissionSignal };

const SIGNAL_WORDS: [RegExp, MissionSignal][] = [
  [/^(禁止|不可做|不可行|不建议做)/, "PROHIBITED"],
  [/^(有条件可做|有条件|需整改后可做)/, "CONDITIONAL"],
  [/^(可做|可行|无阻断)/, "CLEAR"],
];
/** 取最后一条「…判定：X」行（以最终结论为准）。 */
export function extractNodeSignals(text: string): MissionSignal[] {
  const lines = [...text.matchAll(/判定\s*[:：]\s*\**\s*([^\s*|。，,；;]+)/g)].map((m) => m[1]);
  const last = lines.at(-1);
  if (!last) return [];
  const hit = SIGNAL_WORDS.find(([re]) => re.test(last));
  return hit ? [hit[1]] : [];
}

/** 调度用的依赖：dependsOn + 条件节点。 */
export function effectiveDeps(n: MissionNode, plan?: MissionPlan): string[] {
  const cond = n.skipWhen?.nodeKey;
  if (!cond || n.dependsOn.includes(cond)) return n.dependsOn;
  if (plan && !plan.nodes.some((x) => x.key === cond)) return n.dependsOn;
  return [...n.dependsOn, cond];
}

export type MissionNodeStatus =
  | "PENDING"
  | "ACTIVE"
  | "SUCCEEDED"
  | "BLOCKED"
  | "FAILED"
  | "SKIPPED";

export interface MissionQaVerdict {
  verdict: "PASS" | "REVISE" | "FAIL";
  issues: { target: string | null; problem: string }[];
}

export interface MissionNodeState {
  status: MissionNodeStatus;
  taskId: string | null;
  attempts: number;
  summary: string | null;
  reason: string | null;
  revisionFeedback: string | null;
  qa: MissionQaVerdict | null;
  /** KX-54：本节点产出的判定信号。 */
  signals?: MissionSignal[];
}

export interface MissionState {
  nodes: Record<string, MissionNodeState>;
  tasksCreated: number;
  revisionRounds: number;
  resumes?: number;
  reruns?: number;
}

export type MissionOutcome = "COMPLETED" | "NEEDS_USER" | "CANCELLED";

/**
 * KX-53（Astron A2）：真实进度，而不是「完成数 / 总数」。
 *  - 按节点类型加权（综合最重、QA 最轻），进行中的节点算一半；
 *  - 跳过 / 受阻 / 失败都算「已结束」；
 *  - remainingDepth = 未结束节点沿依赖的最长链长度（还要排几轮）；
 *  - 未全部结束时最多 99%，避免“100% 但还在跑”。
 */
const PROGRESS_WEIGHT: Record<MissionNodeKind, number> = { SPECIALIST: 1, RED_TEAM: 1, QA: 0.6, SYNTHESIS: 1.5 };
export interface MissionProgress {
  pct: number;
  remainingSteps: number;
  remainingDepth: number;
}
export function estimateMissionProgress(plan: MissionPlan, state: MissionState): MissionProgress {
  let total = 0;
  let done = 0;
  const open = new Set<string>();
  for (const n of plan.nodes) {
    const w = PROGRESS_WEIGHT[n.kind] ?? 1;
    const st = state.nodes[n.key]?.status ?? "PENDING";
    total += w;
    if (isTerminalNodeStatus(st)) done += w;
    else {
      open.add(n.key);
      if (st === "ACTIVE") done += w * 0.5;
    }
  }
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const memo = new Map<string, number>();
  const depth = (key: string, seen: Set<string>): number => {
    if (!open.has(key)) return 0;
    if (memo.has(key)) return memo.get(key)!;
    if (seen.has(key)) return 1;
    seen.add(key);
    const deps = byKey.get(key)?.dependsOn ?? [];
    const d = 1 + Math.max(0, ...deps.map((k) => depth(k, seen)));
    memo.set(key, d);
    return d;
  };
  const remainingDepth = Math.max(0, ...[...open].map((k) => depth(k, new Set())));
  const raw = total ? Math.round((done / total) * 100) : 100;
  return { pct: open.size ? Math.min(99, raw) : 100, remainingSteps: open.size, remainingDepth };
}

export type MissionAction =
  | { type: "DISPATCH"; nodeKey: string }
  | { type: "REVISE"; nodeKeys: string[]; feedback: Record<string, string> }
  | { type: "SKIP"; nodeKey: string; reason: string }
  | { type: "FINISH"; outcome: MissionOutcome; reasons: string[] };

const TERMINAL: MissionNodeStatus[] = ["SUCCEEDED", "BLOCKED", "FAILED", "SKIPPED"];

export function isTerminalNodeStatus(status: MissionNodeStatus): boolean {
  return TERMINAL.includes(status);
}

/** 唯一事实源在 governance/protected-actions.ts；这里保留导出名以兼容既有引用。 */
export const MISSION_HUMAN_GATES: readonly string[] = HUMAN_GATE_IDS;

const TASK_CLASS_BY_AGENT: Record<string, ModelTaskClass> = {
  research_agent: "WEB_RESEARCH",
  scientific_evidence_agent: "WEB_RESEARCH",
  product_agent: "PRODUCT_ANALYSIS",
  formulation_agent: "PRODUCT_ANALYSIS",
  compliance_agent: "DECISION_REVIEW",
  cost_bom_agent: "PRODUCT_ANALYSIS",
  marketing_agent: "STRATEGIC_CONSULTING",
  ops_agent: "PRODUCT_ANALYSIS",
  red_team: "RED_TEAM",
  qa_verifier: "DECISION_REVIEW",
  tech_architect_agent: "CODING",
  hermes_pm: "ASSISTANT_SYNTHESIS",
};

export function taskClassForAgent(agentCode: string): ModelTaskClass {
  return TASK_CLASS_BY_AGENT[agentCode] ?? "STRATEGIC_CONSULTING";
}

const SYNTHESIS_OBJECTIVE =
  "综合所有已完成工作，给用户一份可以直接行动的结论：结论与建议、关键依据（事实/推断分开）、UNKNOWN 与下一步验证、主要风险，以及真正需要用户拍板的事项（没有就明确说没有）。";

const QA_OBJECTIVE =
  "独立复核上游产出：是否回答了目标、证据是否支撑结论、是否存在相互矛盾、是否把推断写成了事实、是否遗漏关键风险。给出 PASS / REVISE / FAIL 及具体到节点的问题。";

// ---------------------------------------------------------------------------
// Playbook detection
// ---------------------------------------------------------------------------

const NEW_PRODUCT_GOAL =
  /(开发|做|打造|推出|启动|孵化|立项).{0,6}(一个|一款|个|款)?.{0,4}新.{0,2}(产品|品|项目|业务)|新产品|找.{0,4}(产品)?机会|我想做一款|想做个产品|想开发/;

export function detectMissionPlaybook(text: string): MissionPlaybook | null {
  return NEW_PRODUCT_GOAL.test(text) ? "NEW_PRODUCT" : null;
}

/** 由单一受治理工具完整作答、不应再被 brief 取代的意图。 */
const DEDICATED_ANSWER_INTENTS: ReadonlySet<string> = new Set(["CHALLENGE_THESIS"]);

/**
 * Should Kern turn this message into a supervised multi-agent mission?
 *
 * Missions are analysis/research work: internal, reversible, advisory-only.
 * Per Kern's autonomy policy a clear instruction is enough authorization for
 * such work — so we launch without asking, and rely on human gates for
 * anything protected.
 */
export function decideMissionLaunch(input: {
  text: string;
  intent: string;
  collaboration: KernCollaborationPlanShadow;
  /** R-03：未绑定产品时「挑战判断」没有专用报告可出，交给红队任务。缺省按已绑定处理（兼容旧调用）。 */
  productBound?: boolean;
}): { launch: boolean; playbook: MissionPlaybook | null; reason: string } {
  // Governed write / local execution paths keep their own policies.
  if (input.intent.startsWith("PROPOSE_") || input.intent === "DESKTOP_EXECUTION") {
    return { launch: false, playbook: null, reason: "GOVERNED_ACTION_PATH" };
  }
  // 专用工具已在本轮完整作答（挑战报告）：不得再升级为任务，否则 brief 会整体覆盖报告，
  // 用户点名要的证伪结论反而消失（acceptance-science 3.3–3.6）。「挑战…判断」同时命中红队信号，必须先于协作模式判断。
  if (DEDICATED_ANSWER_INTENTS.has(input.intent) && input.productBound !== false) {
    return { launch: false, playbook: null, reason: "DEDICATED_TOOL_ANSWERED" };
  }
  // Product R&D on a bound product already has a dedicated orchestrator.
  if (input.intent === "START_PRODUCT_RND" || input.collaboration.mode === "FULL_RND") {
    return { launch: false, playbook: null, reason: "PRODUCT_RND_PLAYBOOK_OWNS_IT" };
  }
  const playbook = detectMissionPlaybook(input.text);
  if (playbook) return { launch: true, playbook, reason: "NEW_PRODUCT_GOAL" };
  // A requested deliverable needs the worker's tools and export path even when
  // only one specialist is involved. Chat prose cannot substitute for execution.
  const explicitDeliverable = /(请|帮我|替我|为我).{0,12}(完成|生成|制作|做|交付|输出).{0,30}(报告|报表|测算|文档)/.test(input.text);
  const explicitToolExecution = /(?:请|必须|实际|调用).{0,12}(?:调用|使用)?(?:计算工具|工具核验)/.test(input.text);
  const declinesMission = /(不要|无需|不用|别).{0,8}(创建任务|启动任务|执行任务|调用工具)/.test(input.text);
  if (!declinesMission && (explicitDeliverable || explicitToolExecution)) {
    return { launch: true, playbook: "GENERIC", reason: "EXPLICIT_DELIVERABLE" };
  }
  if (["PAIR", "COUNCIL", "RED_TEAM"].includes(input.collaboration.mode)) {
    return { launch: true, playbook: "GENERIC", reason: `MULTI_AGENT_${input.collaboration.mode}` };
  }
  return { launch: false, playbook: null, reason: `SINGLE_TRACK_${input.collaboration.mode}` };
}

// ---------------------------------------------------------------------------
// Plan builders
// ---------------------------------------------------------------------------

function node(
  key: string,
  kind: MissionNodeKind,
  agentCode: string,
  objective: string,
  dependsOn: string[],
  critical = false
): MissionNode {
  return { key, kind, agentCode, objective, dependsOn, taskClass: taskClassForAgent(agentCode), critical };
}

/**
 * Product OS playbook: 发现机会 → 验证 → 产品判断 → 风险 → 营销 → QA → 综合。
 * Independent first pass (market / compliance / cost run in parallel), then
 * dependent judgement, then adversarial + QA, then synthesis.
 */
export function buildNewProductMissionPlan(goal: string): MissionPlan {
  const nodes: MissionNode[] = [
    node("market", "SPECIALIST", "research_agent",
      "研究目标市场：需求与用户痛点、市场规模与趋势、主要竞品与价格带、渠道格局。每个判断标注来源或明确写 UNKNOWN。", [], true),
    node("compliance", "SPECIALIST", "compliance_agent",
      "识别该方向的法规、资质、宣称与渠道合规边界，列出可能阻断上市的硬约束。最后单独一行写「合规判定：可做 / 有条件可做 / 禁止」。", []),
    node("economics", "SPECIALIST", "cost_bom_agent",
      "给出单位经济性框架：成本结构、目标毛利、定价区间与关键成本假设；缺数据时列出需要的真实报价，不要编数字。", []),
    node("opportunity", "SPECIALIST", "product_agent",
      "基于市场研究形成 2–3 个候选机会：目标用户、核心价值主张、差异化、为何现在；给出推荐方向与取舍理由。", ["market"], true),
    node("validation", "SPECIALIST", "research_agent",
      "为推荐方向设计最小验证计划：关键假设排序、每个假设的验证方法、成功/失败阈值、预算与周期。", ["opportunity", "compliance", "economics"]),
    { ...node("gtm", "SPECIALIST", "marketing_agent",
      "为推荐方向制定上市与营销策略：首批目标人群、渠道优先级、核心信息、冷启动动作与衡量指标。", ["opportunity"]),
      skipWhen: { nodeKey: "compliance", signal: "PROHIBITED" } },
    node("red-team", "RED_TEAM", "red_team",
      "证伪推荐方向：最可能失败的三条路径、被忽略的竞争/合规/供应风险、哪些结论证据最弱。", ["opportunity", "compliance", "economics"]),
    node("qa", "QA", "qa_verifier", QA_OBJECTIVE, ["validation", "gtm", "red-team"]),
    node("synthesis", "SYNTHESIS", "hermes_pm", SYNTHESIS_OBJECTIVE, ["qa"], true),
  ];
  return {
    version: "kern-mission-plan/v1",
    goal: goal.trim(),
    playbook: "NEW_PRODUCT",
    successCriteria: [
      "给出推荐的产品方向与取舍理由",
      "市场、合规、经济性、竞争各有结论或明确的 UNKNOWN",
      "有可执行的验证计划和上市策略",
      "经过红队与独立 QA 复核",
      "只把真正的战略选择带给用户",
    ],
    nodes,
    budget: { maxTasks: 16, maxRevisionRounds: 1 },
    humanGates: [...MISSION_HUMAN_GATES],
  };
}

/** Turn the existing shadow GoalPlan into an executable mission (reuse, not rewrite). */
export function buildMissionPlanFromGoalPlan(goalPlan: KernGoalPlanShadow): MissionPlan {
  const keyMap = new Map<string, string>();
  const nodes: MissionNode[] = [];
  for (const task of goalPlan.tasks) {
    const kind: MissionNodeKind | null =
      task.kind === "SYNTHESIS" ? "SYNTHESIS"
        : task.kind === "QA" ? "QA"
          : task.kind === "RED_TEAM" ? "RED_TEAM"
            : task.kind === "SPECIALIST" || task.kind === "PRIMARY" ? "SPECIALIST"
              : null;
    if (!kind) continue;
    const key = kind === "SYNTHESIS" ? "synthesis" : kind === "QA" ? "qa" : task.taskKey;
    keyMap.set(task.taskKey, key);
    nodes.push({
      key,
      kind,
      agentCode: task.preferredAgentCode,
      objective:
        kind === "SYNTHESIS" ? SYNTHESIS_OBJECTIVE : kind === "QA" ? QA_OBJECTIVE : task.objective,
      dependsOn: task.dependencies,
      taskClass: taskClassForAgent(task.preferredAgentCode),
      critical: kind === "SYNTHESIS",
    });
  }
  for (const n of nodes) n.dependsOn = n.dependsOn.map((d) => keyMap.get(d) ?? d);
  return {
    version: "kern-mission-plan/v1",
    goal: goalPlan.goal,
    playbook: "GENERIC",
    successCriteria: goalPlan.successCriteria,
    nodes,
    budget: { maxTasks: Math.max(6, nodes.length * 2), maxRevisionRounds: 1 },
    humanGates: goalPlan.humanGates,
  };
}

export function validateMissionPlan(plan: MissionPlan): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const n of plan.nodes) {
    if (keys.has(n.key)) errors.push(`duplicate node ${n.key}`);
    keys.add(n.key);
  }
  for (const n of plan.nodes) {
    for (const d of n.dependsOn) if (!keys.has(d)) errors.push(`${n.key} depends on missing ${d}`);
    if (n.skipWhen && (n.skipWhen.nodeKey === n.key || !keys.has(n.skipWhen.nodeKey))) errors.push(`${n.key} skipWhen refers to invalid ${n.skipWhen.nodeKey}`);
  }
  const synth = plan.nodes.filter((n) => n.kind === "SYNTHESIS");
  if (synth.length !== 1) errors.push("plan must have exactly one SYNTHESIS node");
  // cycle check (Kahn)
  // 条件节点也算依赖（KX-54），否则 skipWhen 指向下游会死锁。
  const deps = new Map(plan.nodes.map((n) => [n.key, effectiveDeps(n, plan)]));
  const indeg = new Map(plan.nodes.map((n) => [n.key, deps.get(n.key)!.length]));
  const queue = plan.nodes.filter((n) => deps.get(n.key)!.length === 0).map((n) => n.key);
  let seen = 0;
  while (queue.length) {
    const k = queue.shift()!;
    seen++;
    for (const n of plan.nodes) {
      if (deps.get(n.key)!.includes(k)) {
        indeg.set(n.key, (indeg.get(n.key) ?? 0) - 1);
        if (indeg.get(n.key) === 0) queue.push(n.key);
      }
    }
  }
  if (seen !== plan.nodes.length) errors.push("plan has a dependency cycle");
  return errors;
}

export function initialMissionState(plan: MissionPlan): MissionState {
  const nodes: Record<string, MissionNodeState> = {};
  for (const n of plan.nodes) {
    nodes[n.key] = {
      status: "PENDING",
      taskId: null,
      attempts: 0,
      summary: null,
      reason: null,
      revisionFeedback: null,
      qa: null,
    };
  }
  return { nodes, tasksCreated: 0, revisionRounds: 0 };
}

// ---------------------------------------------------------------------------
// Supervisor policy (pure)
// ---------------------------------------------------------------------------

/**
 * Decide the next supervisor actions for a mission.
 *
 * Policy:
 * 1. A node is dispatched once every dependency is terminal. Upstream
 *    BLOCKED/FAILED does not stop the mission — downstream nodes receive the
 *    gap as UNKNOWN (graceful degradation beats silent stall).
 * 2. QA verdict REVISE triggers one bounded re-delegation round of the named
 *    nodes (or all non-QA producers) with the QA feedback, then QA again.
 * 3. The task budget is hard: once spent, pending nodes are SKIPPED and
 *    synthesis reports the gap.
 * 4. The mission finishes when synthesis is terminal. It needs the user when
 *    synthesis did not succeed, or a critical node never succeeded.
 */
export function decideMissionStep(plan: MissionPlan, state: MissionState): MissionAction[] {
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]));
  const synthesis = plan.nodes.find((n) => n.kind === "SYNTHESIS")!;
  const synthState = state.nodes[synthesis.key];

  if (synthState && isTerminalNodeStatus(synthState.status)) {
    const reasons: string[] = [];
    if (synthState.status !== "SUCCEEDED") reasons.push(`SYNTHESIS_${synthState.status}`);
    for (const n of plan.nodes) {
      if (n.critical && n.kind !== "SYNTHESIS" && state.nodes[n.key]?.status !== "SUCCEEDED") {
        reasons.push(`CRITICAL_${n.key}_${state.nodes[n.key]?.status ?? "MISSING"}`);
      }
    }
    return [{ type: "FINISH", outcome: reasons.length ? "NEEDS_USER" : "COMPLETED", reasons }];
  }

  // QA revision loop
  const qaNode = plan.nodes.find((n) => n.kind === "QA");
  if (qaNode) {
    const qa = state.nodes[qaNode.key];
    if (
      qa?.status === "SUCCEEDED" &&
      (qa.qa?.verdict === "REVISE" || qa.qa?.verdict === "FAIL") &&
      state.revisionRounds < plan.budget.maxRevisionRounds
    ) {
      const producers = plan.nodes.filter((n) => n.kind === "SPECIALIST" || n.kind === "RED_TEAM");
      const named = new Set(
        (qa.qa.issues ?? [])
          .map((i) => i.target)
          .filter((t): t is string => !!t && byKey.has(t) && byKey.get(t)!.kind !== "QA" && byKey.get(t)!.kind !== "SYNTHESIS")
      );
      const targets = named.size ? [...named] : producers.map((p) => p.key);
      const remaining = plan.budget.maxTasks - state.tasksCreated;
      if (remaining >= targets.length + 1) {
        const feedback: Record<string, string> = {};
        for (const t of targets) {
          const items = named.size ? qa.qa.issues.filter((i) => i.target === t) : qa.qa.issues;
          feedback[t] = items.map((i) => `- ${i.problem}`).join("\n") || "QA 要求补强该部分的证据与结论边界。";
        }
        return [{ type: "REVISE", nodeKeys: targets, feedback }];
      }
    }
  }

  const actions: MissionAction[] = [];
  let budgetLeft = plan.budget.maxTasks - state.tasksCreated;
  for (const n of plan.nodes) {
    const s = state.nodes[n.key];
    if (!s || s.status !== "PENDING") continue;
    const depsDone = effectiveDeps(n, plan).every((d) => {
      const ds = state.nodes[d];
      return ds && isTerminalNodeStatus(ds.status);
    });
    if (!depsDone) continue;
    const cond = n.skipWhen;
    if (cond && byKey.has(cond.nodeKey) && state.nodes[cond.nodeKey]?.signals?.includes(cond.signal)) {
      actions.push({ type: "SKIP", nodeKey: n.key, reason: `CONDITION_${cond.nodeKey}_${cond.signal}` });
      continue;
    }
    if (budgetLeft <= 0) {
      actions.push({ type: "SKIP", nodeKey: n.key, reason: "TASK_BUDGET_EXHAUSTED" });
      continue;
    }
    actions.push({ type: "DISPATCH", nodeKey: n.key });
    budgetLeft--;
  }
  return actions;
}

/**
 * 一次 REVISE 到底波及到谁（纯函数）。
 *
 * - `refuted`   ：被复核点名推翻的节点 —— 它自己的结论不成立。
 * - `retracted` ：没被点名，但依赖链上游被推翻、因而**连带作废**的下游节点。
 * - `reset`     ：以上两者 + QA 节点，即需要退回 PENDING 重做的全集。
 *
 * 抽成独立函数是为了让「事件里对用户说作废了谁」和「状态机实际重置了谁」共用
 * 同一份计算：否则两处各写一遍，迟早漂移成两套口径，而口径不一致的诚实等于不诚实。
 */
export interface MissionRevisionImpact {
  refuted: string[];
  retracted: string[];
  reset: string[];
}

export function revisionImpact(
  plan: MissionPlan,
  action: Extract<MissionAction, { type: "REVISE" }>
): MissionRevisionImpact {
  const known = new Set(plan.nodes.map((n) => n.key));
  const refuted = [...new Set(action.nodeKeys)].filter((k) => known.has(k));
  const reset = new Set(refuted);
  const qa = plan.nodes.find((n) => n.kind === "QA");
  if (qa) reset.add(qa.key);
  // Anything downstream of a revised node must also be recomputed.
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of plan.nodes) {
      if (n.kind === "SYNTHESIS" || reset.has(n.key)) continue;
      if (effectiveDeps(n).some((d) => reset.has(d))) {
        reset.add(n.key);
        grew = true;
      }
    }
  }
  // QA 是发起推翻的一方，它要重跑但不算「结论被作废」。
  const notRetracted = new Set([...refuted, ...(qa ? [qa.key] : [])]);
  return { refuted, retracted: [...reset].filter((k) => !notRetracted.has(k)), reset: [...reset] };
}

/** Apply a REVISE action to state (pure) — used by the service and tests. */
export function applyRevision(
  plan: MissionPlan,
  state: MissionState,
  action: Extract<MissionAction, { type: "REVISE" }>
): MissionState {
  const next: MissionState = JSON.parse(JSON.stringify(state));
  next.revisionRounds += 1;
  for (const key of revisionImpact(plan, action).reset) {
    const s = next.nodes[key];
    if (!s) continue;
    s.status = "PENDING";
    s.revisionFeedback = action.feedback[key] ?? s.revisionFeedback;
    s.qa = null;
  }
  return next;
}

export function parseQaVerdict(text: string): MissionQaVerdict | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const verdict = String(raw.verdict ?? "").toUpperCase();
    if (!["PASS", "REVISE", "FAIL"].includes(verdict)) return null;
    const issues = Array.isArray(raw.issues)
      ? raw.issues
          .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
          .map((i) => ({
            target: typeof i.target === "string" && i.target.trim() ? i.target.trim() : null,
            problem: String(i.problem ?? i.issue ?? "").slice(0, 600),
          }))
          .filter((i) => i.problem)
          .slice(0, 12)
      : [];
    return { verdict: verdict as MissionQaVerdict["verdict"], issues };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resume (pure): user said “继续” after fixing the cause (e.g. connected a model)
// ---------------------------------------------------------------------------

export const MAX_MISSION_RESUMES = 3;

/**
 * Reset every unfinished node — and everything downstream of it — to PENDING,
 * grant a budget top-up equal to the reset count, and keep successful work.
 */
export function prepareMissionResume(
  plan: MissionPlan,
  state: MissionState & { resumes?: number }
): { plan: MissionPlan; state: MissionState & { resumes: number }; resetKeys: string[] } | { error: string } {
  const resumes = state.resumes ?? 0;
  if (resumes >= MAX_MISSION_RESUMES) return { error: "RESUME_LIMIT" };
  const reset = new Set(
    plan.nodes.filter((n) => state.nodes[n.key].status !== "SUCCEEDED").map((n) => n.key)
  );
  if (!reset.size) return { error: "NOTHING_TO_RESUME" };
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of plan.nodes) {
      if (!reset.has(n.key) && effectiveDeps(n).some((d) => reset.has(d))) {
        reset.add(n.key);
        grew = true;
      }
    }
  }
  const nodes = { ...state.nodes };
  for (const key of reset) {
    nodes[key] = { ...nodes[key], status: "PENDING", taskId: null, summary: null, reason: null, qa: null, revisionFeedback: null };
  }
  return {
    plan: { ...plan, budget: { ...plan.budget, maxTasks: plan.budget.maxTasks + reset.size } },
    state: { ...state, nodes, revisionRounds: 0, resumes: resumes + 1 },
    resetKeys: [...reset],
  };
}

// ---------------------------------------------------------------------------
// User interventions (pure): rerun a step, edit the plan
// ---------------------------------------------------------------------------

export const MAX_MISSION_RERUNS = 5;

function downstreamClosure(plan: MissionPlan, seed: Iterable<string>): Set<string> {
  const reset = new Set(seed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of plan.nodes) {
      if (!reset.has(n.key) && effectiveDeps(n).some((d) => reset.has(d))) {
        reset.add(n.key);
        grew = true;
      }
    }
  }
  return reset;
}

/**
 * 契约打回时该从哪个节点重跑。
 * - 打回 auto:qa-pass：QA 点名的上游节点里最靠前的那个（连带 QA 与综合结论一起重做）；没点名就重跑 QA。
 * - 打回 auto:critical-done：第一个没成功的关键节点。
 * - 其余（分节 / 标注 / 人工项）：null，由调用方退回综合结论。
 */
export function rejectionRerunRoot(plan: MissionPlan, state: MissionState, rejectedIds: string[]): string | null {
  const order = new Map(plan.nodes.map((n, i) => [n.key, i] as const));
  const earliest = (keys: string[]) => keys.filter((k) => order.has(k)).sort((a, b) => order.get(a)! - order.get(b)!)[0] ?? null;
  if (rejectedIds.includes("auto:critical-done")) {
    const failed = plan.nodes.filter((n) => n.critical && n.kind !== "SYNTHESIS" && state.nodes[n.key]?.status !== "SUCCEEDED").map((n) => n.key);
    const hit = earliest(failed);
    if (hit) return hit;
  }
  if (rejectedIds.includes("auto:qa-pass")) {
    const qaNode = plan.nodes.find((n) => n.kind === "QA");
    if (!qaNode) return null;
    const blamed = (state.nodes[qaNode.key]?.qa?.issues ?? [])
      .map((i) => i.target)
      .filter((t): t is string => !!t && order.has(t) && plan.nodes[order.get(t)!].kind !== "QA" && plan.nodes[order.get(t)!].kind !== "SYNTHESIS");
    return earliest(blamed) ?? qaNode.key;
  }
  return null;
}

/**
 * Rerun one finished step: it and everything downstream go back to PENDING
 * (successful sibling work is kept). The budget is topped up by the reset
 * count so a rerun never starves the rest of the mission.
 */
export function prepareNodeRerun(
  plan: MissionPlan,
  state: MissionState,
  nodeKey: string,
  feedback?: string | null
): { plan: MissionPlan; state: MissionState; resetKeys: string[] } | { error: string } {
  const node = plan.nodes.find((n) => n.key === nodeKey);
  const ns = state.nodes[nodeKey];
  if (!node || !ns) return { error: "NODE_NOT_FOUND" };
  if (!isTerminalNodeStatus(ns.status)) return { error: "NODE_NOT_FINISHED" };
  const reruns = state.reruns ?? 0;
  if (reruns >= MAX_MISSION_RERUNS) return { error: "RERUN_LIMIT" };
  const reset = downstreamClosure(plan, [nodeKey]);
  for (const key of reset) {
    if (state.nodes[key]?.status === "ACTIVE") return { error: "DOWNSTREAM_ACTIVE" };
  }
  const nodes = { ...state.nodes };
  for (const key of reset) {
    nodes[key] = {
      ...nodes[key],
      status: "PENDING",
      taskId: null,
      summary: null,
      reason: null,
      qa: null,
      revisionFeedback: key === nodeKey ? (feedback?.trim() || null) : null,
    };
  }
  return {
    plan: { ...plan, budget: { ...plan.budget, maxTasks: plan.budget.maxTasks + reset.size } },
    state: { ...state, nodes, reruns: reruns + 1 },
    resetKeys: [...reset],
  };
}

export type MissionPlanEdit =
  | {
      op: "add";
      node: { key: string; agentCode: string; objective: string; dependsOn?: string[]; critical?: boolean };
    }
  | { op: "remove"; key: string }
  | { op: "reassign"; key: string; agentCode: string }
  | { op: "objective"; key: string; objective: string };

const NODE_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Apply user edits to a running plan. Only PENDING specialist / red-team
 * steps may change; QA and synthesis are structural. New steps feed QA and
 * synthesis automatically so their output is never orphaned.
 */
export function applyPlanEdit(
  plan: MissionPlan,
  state: MissionState,
  edits: MissionPlanEdit[]
): { plan: MissionPlan; state: MissionState; summary: string[] } | { error: string } {
  if (!edits.length) return { error: "NO_EDITS" };
  const next: MissionPlan = JSON.parse(JSON.stringify(plan));
  const nextState: MissionState = JSON.parse(JSON.stringify(state));
  const summary: string[] = [];
  const editable = (key: string) => {
    const n = next.nodes.find((x) => x.key === key);
    if (!n) return "NODE_NOT_FOUND:" + key;
    if (n.kind === "QA" || n.kind === "SYNTHESIS") return "NODE_STRUCTURAL:" + key;
    if (nextState.nodes[key]?.status !== "PENDING") return "NODE_NOT_PENDING:" + key;
    return null;
  };
  for (const e of edits) {
    if (e.op === "add") {
      const key = e.node.key.trim();
      if (!NODE_KEY_RE.test(key)) return { error: "INVALID_KEY:" + key };
      if (next.nodes.some((n) => n.key === key)) return { error: "DUPLICATE_KEY:" + key };
      const objective = e.node.objective.trim().slice(0, 1000);
      if (!objective) return { error: "EMPTY_OBJECTIVE" };
      next.nodes.splice(
        Math.max(0, next.nodes.findIndex((n) => n.kind === "QA" || n.kind === "SYNTHESIS")),
        0,
        {
          key,
          kind: "SPECIALIST",
          agentCode: e.node.agentCode,
          objective,
          dependsOn: [...new Set(e.node.dependsOn ?? [])],
          taskClass: taskClassForAgent(e.node.agentCode),
          critical: e.node.critical ?? false,
        }
      );
      for (const n of next.nodes) {
        if ((n.kind === "QA" || n.kind === "SYNTHESIS") && !n.dependsOn.includes(key)) {
          // A step can only be added while its consumers have not started.
          if (nextState.nodes[n.key] && nextState.nodes[n.key].status !== "PENDING") {
            return { error: "CONSUMER_STARTED:" + n.key };
          }
          n.dependsOn.push(key);
        }
      }
      nextState.nodes[key] = {
        status: "PENDING",
        taskId: null,
        attempts: 0,
        summary: null,
        reason: null,
        revisionFeedback: null,
        qa: null,
      };
      next.budget.maxTasks += 1;
      summary.push(`新增 ${key}（${e.node.agentCode}）`);
    } else if (e.op === "remove") {
      const err = editable(e.key);
      if (err) return { error: err };
      next.nodes = next.nodes.filter((n) => n.key !== e.key);
      for (const n of next.nodes) n.dependsOn = n.dependsOn.filter((d) => d !== e.key);
      delete nextState.nodes[e.key];
      summary.push(`移除 ${e.key}`);
    } else if (e.op === "reassign") {
      const err = editable(e.key);
      if (err) return { error: err };
      const n = next.nodes.find((x) => x.key === e.key)!;
      const from = n.agentCode;
      n.agentCode = e.agentCode;
      n.taskClass = taskClassForAgent(e.agentCode);
      summary.push(`${e.key}：${from} → ${e.agentCode}`);
    } else {
      const err = editable(e.key);
      if (err) return { error: err };
      const objective = e.objective.trim().slice(0, 1000);
      if (!objective) return { error: "EMPTY_OBJECTIVE" };
      next.nodes.find((x) => x.key === e.key)!.objective = objective;
      summary.push(`${e.key}：更新目标`);
    }
  }
  const errors = validateMissionPlan(next);
  if (errors.length) return { error: "INVALID_PLAN:" + errors.join("; ") };
  return { plan: next, state: nextState, summary };
}
