/**
 * 任务报告的交付计划（R1·report-quality/v1）
 * ==========================================
 * 把「这份报告能不能作为正式交付、以什么名义交付」从路由里抽出来，
 * 让 Markdown / PDF / Office / 卡片 / 报告页共用同一个判定，
 * 也让门禁可以被测试直接调用（不需要 HTTP 与登录态）。
 *
 * 规则（施工需求 §4）：
 * - 阻断态：不产出正式文件，任何格式都一样（此前 Office 分支在门禁前返回，等于绕过）；
 * - 待补证草稿：可以交付，但标题带状态戳、正文带问题清单，不混入正式统计；
 * - 可交付：原样交付。
 */

import { assessMissionReportQuality, REPORT_QUALITY_LABEL, type ReportQuality } from "./report-quality";
import type { MissionReport } from "./report-format";

export interface MissionDeliveryPlan {
  /** 非 NEW_PRODUCT / 未完成 / 还没有结论的任务不做质量判定（null）。 */
  quality: ReportQuality | null;
  /** 是否允许作为正式研究交付产出文件。 */
  blocked: boolean;
  /** 阻断原因（给用户看，逐条问题）。 */
  blockedReason: string;
  /** 交付用的标题：非可交付状态会带状态戳。 */
  title: string;
  /** 写进 Markdown / PDF 正文头部的状态块。 */
  gate: string[];
}

export function planMissionDelivery(report: MissionReport): MissionDeliveryPlan {
  const quality = report.playbook === "NEW_PRODUCT" && report.outcome === "COMPLETED" && report.conclusion
    ? assessMissionReportQuality(report)
    : null;

  if (quality?.status === "BLOCKED") {
    return {
      quality,
      blocked: true,
      blockedReason: `这份报告未通过质量检查，不能作为正式研究交付：${quality.issues
        .map((issue) => `${issue.where}：${issue.detail}`)
        .join("；")}`,
      title: report.title,
      gate: [],
    };
  }

  if (quality && quality.status !== "DELIVERABLE") {
    return {
      quality,
      blocked: false,
      blockedReason: "",
      title: `[${REPORT_QUALITY_LABEL[quality.status]}] ${report.title}`,
      gate: [
        `> **${REPORT_QUALITY_LABEL[quality.status]}**：这份报告还需补证才能定稿，不能当作最终结论使用。`,
        ...quality.issues.map((issue) => `> - ${issue.where}：${issue.detail}（补齐方式：${issue.fix}）`),
        "",
      ],
    };
  }

  return { quality, blocked: false, blockedReason: "", title: report.title, gate: [] };
}

