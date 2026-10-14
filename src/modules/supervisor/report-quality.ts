/**
 * 研究报告质量门禁（R1·report-quality/v1）
 * ======================================
 * 把「这份报告能不能作为正式研究交付」写成可测试的判定，而不是靠提示词自觉：
 *
 * - 主题一致：正文必须围绕需求里的研究对象展开——需求说奶粉、结论讲海苔即阻断；
 * - 契约完整：复用 report-contract 的八节校验，缺节降级为待补证草稿；
 * - 约束覆盖：需求写明的人群 / 预算 / 主推要素要落进报告，否则降级并提示补齐；
 * - 缺口保留：UNKNOWN 逐条留在缺口清单里，没写补齐方式的仍保留并提示补；
 * - 演示隔离：演示脚本与本次需求不一致时阻断，示例不冒充真实研究。
 *
 * 判定只看报告自身、不调用模型；状态与内容版本一起返回，内容改了旧判定自然失效。
 */

import { validateNewProductConclusion } from "./report-contract";
import { goalConstraintPhrases, reportSubject, type MissionReport } from "./report-format";

export const REPORT_QUALITY_VERSION = "report-quality/v1";

export type ReportQualityStatus = "DELIVERABLE" | "DRAFT_UNVERIFIED" | "BLOCKED";

export interface ReportQualityIssue {
  /** 稳定规则 id，供测试与诊断引用。 */
  rule: string;
  /** block 停止正式交付；draft 只降级为待补证草稿。 */
  level: "block" | "draft";
  /** 出问题的位置（分节 / 字段），写给用户看。 */
  where: string;
  detail: string;
  fix: string;
}

export interface ReportQuality {
  status: ReportQualityStatus;
  issues: ReportQualityIssue[];
  /** 内容指纹：内容变了，旧判定就不再适用。 */
  version: string;
}

/** 状态展示文案：界面与导出共用一张表，避免各处自己拼词。 */
export const REPORT_QUALITY_LABEL: Record<ReportQualityStatus, string> = {
  DELIVERABLE: "可交付",
  DRAFT_UNVERIFIED: "待补证草稿",
  BLOCKED: "未通过质量检查",
};

/** djb2 指纹，纯函数、无 node 依赖，客户端也能算。 */
export function reportContentVersion(report: MissionReport): string {
  const text = [report.title, report.goal, report.conclusion ?? "", ...report.steps.map((step) => step.output ?? "")].join("\n");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * 研究对象是否真的出现在正文里。判据取研究对象尾部的品类词（尾 2 字 / 尾 3 字），
 * 而不是任意公共子串——否则「红参胶原蛋白肽女士奶粉」与「高蛋白海苔脆」会因为都含
 * 「蛋白」而被误判成同一主题。
 */
function topicMissing(subject: string, body: string): boolean {
  const cores = [subject.slice(-2), subject.slice(-3)].filter((core) => core.length >= 2);
  return cores.length > 0 && !cores.some((core) => body.includes(core));
}

/** 约束有没有落进报告：数字或连续二字片段命中即算覆盖（宽松，只用于降级提示）。 */
function constraintMissing(text: string, body: string): boolean {
  const digits = text.match(/\d+/g) ?? [];
  if (digits.some((digit) => body.includes(digit))) return false;
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= text.length; i++) grams.add(text.slice(i, i + 2));
  for (const gram of grams) if (body.includes(gram)) return false;
  return grams.size > 0;
}

export function assessMissionReportQuality(report: MissionReport): ReportQuality {
  const issues: ReportQualityIssue[] = [];
  const conclusion = (report.conclusion ?? "").trim();
  const body = [conclusion, ...report.steps.map((step) => step.output ?? "")].join("\n");

  if (!conclusion) {
    issues.push({
      rule: "R-CONTENT",
      level: "block",
      where: "结论",
      detail: "这份任务还没有形成综合结论，不能作为正式研究报告交付。",
      fix: "先完成任务、形成结论，再打开报告。",
    });
  }

  const subject = reportSubject(report.goal);
  if (subject && conclusion && topicMissing(subject, body)) {
    issues.push({
      rule: "R-TOPIC",
      level: "block",
      where: "研究对象",
      detail: `需求的研究对象是「${subject}」，报告正文没有围绕它展开。`,
      fix: "按需求的研究对象重新生成结论；示例内容或其他品类的分析不能当作本次研究结果。",
    });
  }

  if (report.demo && issues.some((issue) => issue.rule === "R-TOPIC")) {
    issues.push({
      rule: "R-DEMO",
      level: "block",
      where: "演示",
      detail: "演示脚本的内容与本次需求不一致。",
      fix: "演示只用于流程演练；本次需求需要真实运行才能得到结论。",
    });
  }

  for (const problem of validateNewProductConclusion(conclusion).problems) {
    issues.push({
      rule: "R-CONTRACT",
      level: "draft",
      where: "报告结构",
      detail: problem,
      fix: "补齐该分节或按契约标注后重新生成。",
    });
  }

  for (const constraint of goalConstraintPhrases(report.goal)) {
    if (body && constraintMissing(constraint.text, body)) {
      issues.push({
        rule: "R-CONSTRAINT",
        level: "draft",
        where: `需求约束 · ${constraint.kind}`,
        detail: `需求写明了${constraint.kind}「${constraint.text}」，报告里没有对应分析。`,
        fix: `在报告里补上对${constraint.kind}的分析，或说明为什么无法覆盖。`,
      });
    }
  }

  const unknownLines = body.split(/\r?\n/).filter((line) => /UNKNOWN\s*[：:]/i.test(line));
  if (unknownLines.some((line) => !/需要/.test(line))) {
    issues.push({
      rule: "R-UNKNOWN",
      level: "draft",
      where: "缺口清单",
      detail: "有缺口条目没有写补齐方式。",
      fix: "每条缺口补上「（需要 <如何补齐>）」，让人知道下一步怎么补。",
    });
  }

  const status: ReportQualityStatus = issues.some((issue) => issue.level === "block")
    ? "BLOCKED"
    : issues.length
      ? "DRAFT_UNVERIFIED"
      : "DELIVERABLE";

  return { status, issues, version: reportContentVersion(report) };
}
