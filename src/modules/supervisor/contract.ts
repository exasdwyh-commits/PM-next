/**
 * 任务契约的生成 / 自动检查 / 复核（KX-72）。纯函数，不碰数据库。
 *
 * - buildTaskContract：由计划 + 澄清答案 + 做法 + 能力目录命中 生成契约卡。
 * - checkTaskContract：任务 COMPLETED 时跑自动项（关键步骤都成功、QA 通过、结论分节齐全、依据有事实 / 推断标注）。
 * - applyContractReview：用户按条通过 / 打回；打回条目变成重跑综合结论的反馈。
 * - contractMarkdown：统一交接格式（契约卡 → Markdown，附在导出与交接里）。
 */
import { HUMAN_GATE_LABEL } from "@/modules/governance/protected-actions";
import type { AcceptanceCriterion, MissionPlan, TaskContract } from "@/modules/kern-contracts";
import { TASK_CONTRACT_VERSION } from "@/modules/kern-contracts";
import type { MissionState } from "./plan";

/** 综合结论必须有的分节（与 generic-executor 的综合提示一致）。 */
export const REQUIRED_CONCLUSION_SECTIONS = ["结论与建议", "关键依据", "待验证与下一步", "主要风险", "需要你决定的事"] as const;

export const AUTO_CRITERIA = {
  CRITICAL_DONE: { id: "auto:critical-done", text: "所有关键步骤都成功完成（非关键步骤允许按条件跳过）" },
  QA_PASS: { id: "auto:qa-pass", text: "独立 QA 复核通过" },
  SECTIONS: { id: "auto:sections", text: `综合结论包含固定分节：${REQUIRED_CONCLUSION_SECTIONS.join(" / ")}` },
  EVIDENCE_TAGS: { id: "auto:evidence-tags", text: "关键依据标注了 事实 / 推断" },
} as const;

export interface BuildContractInput {
  plan: MissionPlan;
  /** 澄清问题的「问：答」。 */
  answers?: { question: string; answer: string }[];
  playbookName?: string | null;
  /** KX-71 能力目录里检索命中的条目 label。 */
  capabilities?: string[];
  /** 定时任务的 cron；一次性为 null。 */
  cron?: string | null;
}

function pending(c: { id: string; text: string }, check: AcceptanceCriterion["check"]): AcceptanceCriterion {
  return { id: c.id, text: c.text, check, status: "PENDING", note: null };
}

function headline(goal: string): string {
  return goal.split("\n")[0].trim().slice(0, 120);
}

export function buildTaskContract(input: BuildContractInput): TaskContract {
  const { plan } = input;
  const answers = input.answers ?? [];
  const specialists = plan.nodes.filter((n) => n.kind === "SPECIALIST");
  const hasQa = plan.nodes.some((n) => n.kind === "QA");
  const hasRedTeam = plan.nodes.some((n) => n.kind === "RED_TEAM");
  const humanCriteria = plan.successCriteria.slice(0, 8).map((text, i) => pending({ id: `human:${i + 1}`, text }, "human"));
  const auto: AcceptanceCriterion[] = [
    pending(AUTO_CRITERIA.CRITICAL_DONE, "auto"),
    ...(hasQa ? [pending(AUTO_CRITERIA.QA_PASS, "auto")] : []),
    pending(AUTO_CRITERIA.SECTIONS, "auto"),
    pending(AUTO_CRITERIA.EVIDENCE_TAGS, "auto"),
  ];
  return {
    version: TASK_CONTRACT_VERSION,
    expectedResult: headline(plan.goal),
    inputs: [
      ...answers.map((a) => `${a.question}：${a.answer}`),
      ...(input.playbookName ? [`套用做法「${input.playbookName}」`] : []),
    ],
    deliverables: [
      `综合结论（${REQUIRED_CONCLUSION_SECTIONS.join(" / ")}）`,
      ...specialists.map((n) => `${n.objective.split(/[。；\n]/)[0].slice(0, 40)}（${n.agentCode}）`),
      ...(hasRedTeam ? ["红队反例清单"] : []),
      "可导出 Markdown / Word / Excel / PowerPoint / PDF",
    ],
    frequency: { kind: input.cron ? "recurring" : "once", cron: input.cron ?? null },
    acceptance: [...auto, ...humanCriteria],
    constraints: answers.map((a) => `${a.question}：${a.answer}`),
    approvalGates: plan.humanGates.map((g) => HUMAN_GATE_LABEL[g] ?? g),
    capabilities: [...new Set(input.capabilities ?? [])].slice(0, 8),
    reviews: [],
  };
}

/** 任务完成时跑自动项。返回新契约（不改入参）。 */
export function checkTaskContract(
  contract: TaskContract,
  plan: MissionPlan,
  state: MissionState,
  conclusion: string | null
): TaskContract {
  const failedCritical = plan.nodes.filter((n) => n.critical && n.kind !== "SYNTHESIS" && state.nodes[n.key]?.status !== "SUCCEEDED");
  const qaNode = plan.nodes.find((n) => n.kind === "QA");
  const qaState = qaNode ? state.nodes[qaNode.key] : undefined;
  const qaPass = !qaNode || (qaState?.status === "SUCCEEDED" && (qaState.qa === null || qaState.qa?.verdict === "PASS"));
  const text = conclusion ?? "";
  const missing = REQUIRED_CONCLUSION_SECTIONS.filter((s) => !text.includes(s));
  const evidenceTagged = /事实|推断/.test(text);

  const results: Record<string, { pass: boolean; note: string }> = {
    [AUTO_CRITERIA.CRITICAL_DONE.id]: failedCritical.length
      ? { pass: false, note: `未成功：${failedCritical.map((n) => n.key).join("、")}` }
      : { pass: true, note: "关键步骤全部成功" },
    [AUTO_CRITERIA.QA_PASS.id]: qaPass
      ? { pass: true, note: qaState?.qa ? `QA：${qaState.qa.verdict}` : "QA 已完成" }
      : { pass: false, note: qaState?.qa ? `QA：${qaState.qa.verdict}，${qaState.qa.issues.length} 个问题` : `QA 状态 ${qaState?.status ?? "无"}` },
    [AUTO_CRITERIA.SECTIONS.id]: missing.length
      ? { pass: false, note: text ? `缺少分节：${missing.join(" / ")}` : "没有综合结论" }
      : { pass: true, note: "分节齐全" },
    [AUTO_CRITERIA.EVIDENCE_TAGS.id]: evidenceTagged
      ? { pass: true, note: "已标注" }
      : { pass: false, note: "结论里没有出现 事实 / 推断 标注" },
  };
  return {
    ...contract,
    acceptance: contract.acceptance.map((c) => {
      if (c.check !== "auto") return c;
      const r = results[c.id];
      return r ? { ...c, status: r.pass ? "PASS" : "FAIL", note: r.note } : c;
    }),
  };
}

export interface ReviewVerdict {
  id: string;
  pass: boolean;
  note?: string | null;
}

/** 用户按条复核。未提到的 human 条目视为通过；auto 条目不可被用户改成通过（只能打回）。 */
export function applyContractReview(
  contract: TaskContract,
  verdicts: ReviewVerdict[],
  by: { userId: string; at: string }
): { contract: TaskContract; rejected: AcceptanceCriterion[] } {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const acceptance = contract.acceptance.map<AcceptanceCriterion>((c) => {
    const v = byId.get(c.id);
    if (!v) return c.check === "human" && c.status === "PENDING" ? { ...c, status: "PASS" } : c;
    if (!v.pass) return { ...c, status: "FAIL", note: (v.note ?? "").trim().slice(0, 500) || c.note || "用户打回" };
    return c.check === "auto" && c.status === "FAIL" ? c : { ...c, status: "PASS", note: (v.note ?? "").trim().slice(0, 500) || c.note };
  });
  const rejected = acceptance.filter((c) => c.status === "FAIL");
  const review = { at: by.at, byUserId: by.userId, rejected: rejected.map((c) => c.id), round: contract.reviews.length + 1 };
  return { contract: { ...contract, acceptance, reviews: [...contract.reviews, review] }, rejected };
}

/** 打回条目 → 重跑综合结论时的反馈。 */
export function reviewFeedback(rejected: AcceptanceCriterion[]): string {
  return [
    "（用户复核未通过，按条修正后重新给出综合结论；每条都要在结论里能看出改了什么）",
    ...rejected.map((c, i) => `${i + 1}. ${c.text}${c.note ? ` —— 意见：${c.note}` : ""}`),
  ].join("\n");
}

export function contractAccepted(contract: TaskContract): boolean {
  return contract.acceptance.every((c) => c.status === "PASS");
}

/** 统一交接格式：契约卡 → Markdown。 */
export function contractMarkdown(c: TaskContract): string {
  const mark = (s: AcceptanceCriterion["status"]) => (s === "PASS" ? "[x]" : s === "FAIL" ? "[!]" : "[ ]");
  const list = (items: string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`);
  return [
    "## 任务契约",
    `**要的结果**：${c.expectedResult}`,
    `**频率**：${c.frequency.kind === "recurring" ? `定期（${c.frequency.cron}）` : "一次"}`,
    "",
    "**输入**",
    list(c.inputs, "无额外输入"),
    "",
    "**产出**",
    list(c.deliverables, "—"),
    "",
    "**完成标准**",
    ...c.acceptance.map((a) => `- ${mark(a.status)} ${a.text}${a.check === "auto" ? "（自动检查）" : ""}${a.note ? ` — ${a.note}` : ""}`),
    "",
    "**约束**",
    list(c.constraints, "无"),
    "",
    "**需要先问你的事**",
    list(c.approvalGates, "无"),
    "",
    "**会用到的能力**",
    list(c.capabilities, "内置能力"),
  ].join("\n");
}
