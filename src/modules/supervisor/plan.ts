import type { ModelTaskClass } from "@/modules/model-gateway";
import type { KernGoalPlanShadow } from "@/modules/assistant-runtime/goal-plan";
import type { KernCollaborationPlanShadow } from "@/modules/assistant-runtime/collaboration-planner";

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

export type MissionNodeKind = "SPECIALIST" | "RED_TEAM" | "QA" | "SYNTHESIS";

export interface MissionNode {
  key: string;
  kind: MissionNodeKind;
  agentCode: string;
  objective: string;
  dependsOn: string[];
  taskClass: ModelTaskClass;
  /** A critical node that ends BLOCKED/FAILED makes the mission need the user. */
  critical: boolean;
}

export type MissionPlaybook = "GENERIC" | "NEW_PRODUCT";

export interface MissionPlan {
  version: "kern-mission-plan/v1";
  goal: string;
  playbook: MissionPlaybook;
  successCriteria: string[];
  nodes: MissionNode[];
  budget: { maxTasks: number; maxRevisionRounds: number };
  humanGates: string[];
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
}

export interface MissionState {
  nodes: Record<string, MissionNodeState>;
  tasksCreated: number;
  revisionRounds: number;
}

export type MissionOutcome = "COMPLETED" | "NEEDS_USER";

export type MissionAction =
  | { type: "DISPATCH"; nodeKey: string }
  | { type: "REVISE"; nodeKeys: string[]; feedback: Record<string, string> }
  | { type: "SKIP"; nodeKey: string; reason: string }
  | { type: "FINISH"; outcome: MissionOutcome; reasons: string[] };

const TERMINAL: MissionNodeStatus[] = ["SUCCEEDED", "BLOCKED", "FAILED", "SKIPPED"];

export function isTerminalNodeStatus(status: MissionNodeStatus): boolean {
  return TERMINAL.includes(status);
}

export const MISSION_HUMAN_GATES = [
  "PAYMENT_OR_FINANCIAL_COMMITMENT",
  "EXTERNAL_PUBLISH_OR_SEND",
  "IRREVERSIBLE_DELETE_OR_OVERWRITE",
  "SENSITIVE_PERMISSION_CHANGE",
  "FORMAL_BUSINESS_GATE",
  "LEGAL_OR_CONTRACT_COMMITMENT",
  "STRATEGIC_VALUE_TRADEOFF",
];

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
}): { launch: boolean; playbook: MissionPlaybook | null; reason: string } {
  // Governed write / local execution paths keep their own policies.
  if (input.intent.startsWith("PROPOSE_") || input.intent === "DESKTOP_EXECUTION") {
    return { launch: false, playbook: null, reason: "GOVERNED_ACTION_PATH" };
  }
  // Product R&D on a bound product already has a dedicated orchestrator.
  if (input.intent === "START_PRODUCT_RND" || input.collaboration.mode === "FULL_RND") {
    return { launch: false, playbook: null, reason: "PRODUCT_RND_PLAYBOOK_OWNS_IT" };
  }
  const playbook = detectMissionPlaybook(input.text);
  if (playbook) return { launch: true, playbook, reason: "NEW_PRODUCT_GOAL" };
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
      "识别该方向的法规、资质、宣称与渠道合规边界，列出可能阻断上市的硬约束。", []),
    node("economics", "SPECIALIST", "cost_bom_agent",
      "给出单位经济性框架：成本结构、目标毛利、定价区间与关键成本假设；缺数据时列出需要的真实报价，不要编数字。", []),
    node("opportunity", "SPECIALIST", "product_agent",
      "基于市场研究形成 2–3 个候选机会：目标用户、核心价值主张、差异化、为何现在；给出推荐方向与取舍理由。", ["market"], true),
    node("validation", "SPECIALIST", "research_agent",
      "为推荐方向设计最小验证计划：关键假设排序、每个假设的验证方法、成功/失败阈值、预算与周期。", ["opportunity", "compliance", "economics"]),
    node("gtm", "SPECIALIST", "marketing_agent",
      "为推荐方向制定上市与营销策略：首批目标人群、渠道优先级、核心信息、冷启动动作与衡量指标。", ["opportunity"]),
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
    humanGates: MISSION_HUMAN_GATES,
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
  }
  const synth = plan.nodes.filter((n) => n.kind === "SYNTHESIS");
  if (synth.length !== 1) errors.push("plan must have exactly one SYNTHESIS node");
  // cycle check (Kahn)
  const indeg = new Map(plan.nodes.map((n) => [n.key, n.dependsOn.length]));
  const queue = plan.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.key);
  let seen = 0;
  while (queue.length) {
    const k = queue.shift()!;
    seen++;
    for (const n of plan.nodes) {
      if (n.dependsOn.includes(k)) {
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
      qa.qa?.verdict === "REVISE" &&
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
    const depsDone = n.dependsOn.every((d) => {
      const ds = state.nodes[d];
      return ds && isTerminalNodeStatus(ds.status);
    });
    if (!depsDone) continue;
    if (budgetLeft <= 0) {
      actions.push({ type: "SKIP", nodeKey: n.key, reason: "TASK_BUDGET_EXHAUSTED" });
      continue;
    }
    actions.push({ type: "DISPATCH", nodeKey: n.key });
    budgetLeft--;
  }
  return actions;
}

/** Apply a REVISE action to state (pure) — used by the service and tests. */
export function applyRevision(
  plan: MissionPlan,
  state: MissionState,
  action: Extract<MissionAction, { type: "REVISE" }>
): MissionState {
  const next: MissionState = JSON.parse(JSON.stringify(state));
  next.revisionRounds += 1;
  const reset = new Set(action.nodeKeys);
  const qa = plan.nodes.find((n) => n.kind === "QA");
  if (qa) reset.add(qa.key);
  // Anything downstream of a revised node must also be recomputed.
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of plan.nodes) {
      if (n.kind === "SYNTHESIS" || reset.has(n.key)) continue;
      if (n.dependsOn.some((d) => reset.has(d))) {
        reset.add(n.key);
        grew = true;
      }
    }
  }
  for (const key of reset) {
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
      if (!reset.has(n.key) && n.dependsOn.some((d) => reset.has(d))) {
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
