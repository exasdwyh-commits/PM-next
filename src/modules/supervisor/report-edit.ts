/**
 * 报告编辑步骤（R1·report-quality/v1 · 有界自动修复）
 * ==================================================
 * 执行顺序（施工需求 §4）：候选内容 → 编辑 → 校验 → **最多一次**自动修复 → 重新校验 → 交付。
 *
 * 边界：
 * - 只对「待补证草稿」尝试自动补齐；阻断态（主题错配、演示污染）必须重跑任务，
 *   改写只会把错误结论包装得更像真的；
 * - 只调用一次模型，带超时与取消路径；
 * - 空响应、畸形结构、主题漂移、修完反而更差 —— 一律放弃并原样返回，
 *   由交付层按三态呈现，绝不兜底成「已核实」；
 * - 模型通道由执行器注入（`call`），本模块不自己拼模型配置，方便测试替换。
 */

import { assessMissionReportQuality, type ReportQuality, type ReportQualityIssue } from "./report-quality";
import { reportSubject, type MissionReport } from "./report-format";

/** 编辑用的模型通道：与任务节点同一条模型通路，由执行器传入。 */
export type ReportEditCall = (
  messages: { role: "system" | "user"; content: string }[],
  opts?: { signal?: AbortSignal },
) => Promise<{ text: string } | { unavailable: string }>;

/** 可以自动补齐的规则；其余（主题、演示）需要重跑而不是改写。 */
const AUTO_FIXABLE = new Set(["R-CONTRACT", "R-UNKNOWN", "R-NUMBER", "R-WORDING", "R-CONSTRAINT"]);

export const REPORT_EDIT_TIMEOUT_MS = 20_000;

export interface ReportEditOutcome {
  attempted: boolean;
  applied: boolean;
  /** 采用后的结论（未采用即原文）。 */
  conclusion: string;
  /** 采用后重新判定的结果（未采用即原判定）。 */
  quality: ReportQuality;
  /** 内部诊断，不进客户报告。 */
  note: string;
}

export function buildEditMessages(report: MissionReport, issues: ReportQualityIssue[]): { role: "system" | "user"; content: string }[] {
  const checklist = issues
    .map((issue, index) => `${index + 1}. [${issue.where}] ${issue.detail} → 补齐方式：${issue.fix}`)
    .join("\n");
  return [
    {
      role: "system",
      content: [
        "你是研究报告编辑，只做一次有界修改。",
        "原则：保留原文的事实、来源与数字；不得新增没有标注来源的数字；",
        "不得更换研究对象；没有依据的内容保持「待验证」；未知项保留并写补齐方式。",
        "输出：只输出修改后的完整报告正文，不要解释修改了什么。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `需求：${report.goal}`,
        `研究对象：${reportSubject(report.goal) ?? report.title}`,
        "",
        "待补齐的问题清单：",
        checklist,
        "",
        "原始正文：",
        report.conclusion ?? "",
      ].join("\n"),
    },
  ];
}

/** 主题漂移：编辑后正文里找不到研究对象的核心词（尾 2 / 尾 3 字）。 */
function drifted(subject: string, body: string): boolean {
  if (!subject) return false;
  const cores = [subject.slice(-2), subject.slice(-3)].filter((core) => core.length >= 2);
  return cores.length > 0 && !cores.some((core) => body.includes(core));
}

export async function autoFixMissionReport(input: {
  report: MissionReport;
  quality: ReportQuality;
  call: ReportEditCall;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ReportEditOutcome> {
  const { report, quality, call, signal } = input;
  const timeoutMs = input.timeoutMs ?? REPORT_EDIT_TIMEOUT_MS;
  const original = report.conclusion ?? "";

  const keep = (attempted: boolean, note: string): ReportEditOutcome => ({
    attempted,
    applied: false,
    conclusion: original,
    quality,
    note,
  });

  if (quality.status === "BLOCKED") {
    return keep(false, "阻断态不自动改写：主题错配或演示污染需要重跑任务，而不是把错误结论改写得更好看。");
  }
  if (quality.status === "DELIVERABLE") return keep(false, "已可交付，无需编辑。");

  const fixable = quality.issues.filter((issue) => AUTO_FIXABLE.has(issue.rule));
  if (fixable.length === 0) return keep(false, "没有可自动补齐的问题，保留原稿。");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const out = await Promise.race([
      call(buildEditMessages(report, fixable), { signal: controller.signal }),
      new Promise<{ timeout: true }>((resolve) => controller.signal.addEventListener("abort", () => resolve({ timeout: true }))),
    ]);
    if ("timeout" in out) return keep(true, `自动补齐超时（${timeoutMs}ms），保留原稿与待补证状态。`);
    if ("unavailable" in out) return keep(true, `模型不可用：${out.unavailable}`);

    const edited = (out.text ?? "").trim();
    if (!edited) return keep(true, "编辑返回空内容，保留原稿。");
    if (edited.length < original.length * 0.6) return keep(true, "编辑结果明显短于原稿，判定为畸形响应，保留原稿。");
    const subject = reportSubject(report.goal);
    if (subject && drifted(subject, edited)) return keep(true, "编辑结果偏离研究对象，保留原稿。");

    const next = assessMissionReportQuality({ ...report, conclusion: edited });
    if (next.status === "BLOCKED") return keep(true, "编辑后反而阻断，保留原稿。");
    const improved = next.issues.length < quality.issues.length || next.status === "DELIVERABLE";
    if (!improved) return keep(true, "编辑后问题没有减少，不采用。");

    return {
      attempted: true,
      applied: true,
      conclusion: edited,
      quality: next,
      note: `自动补齐已采用：问题 ${quality.issues.length} → ${next.issues.length} 条，状态 ${quality.status} → ${next.status}。`,
    };
  } catch (error) {
    return keep(true, `自动补齐异常：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

