/**
 * 质量状态的落点（R1·report-quality/v1）
 * ======================================
 * 写进既有 Artifact 的 `content` JSON 里，不新增字段、不做迁移。
 *
 * 约定：
 * - 写：报告被持久化/重新定稿时调用 `attachQuality`，状态与内容指纹一起存档；
 * - 读：`readQuality` 容忍缺失（历史报告没有这条记录）→ 返回 null，
 *   界面与接口据此显示「这份报告还没有经过当前质量检查」，**不得伪造通过**；
 * - 失效：传入期望的内容指纹后，指纹不一致即视为旧判定，同样返回 null。
 */

import { REPORT_QUALITY_VERSION, type ReportQuality, type ReportQualityStatus } from "./report-quality";

export const REPORT_QUALITY_KEY = "quality";

/** 存进 Artifact 元数据里的形状（只保留可对外展示的字段，内部诊断不进客户报告）。 */
export interface StoredReportQuality {
  schemaVersion: string;
  status: ReportQualityStatus;
  /** 内容指纹：内容变了，这条判定就不再适用。 */
  contentVersion: string;
  assessedAt: string;
  issues: { rule: string; where: string; detail: string; fix: string }[];
}

export function attachQuality(content: string, quality: ReportQuality, now: Date = new Date()): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // 内容不是 JSON（历史纯文本行）：不改写原文，交由调用方决定如何处理。
    return content;
  }
  if (!parsed || typeof parsed !== "object") return content;
  const stored: StoredReportQuality = {
    schemaVersion: REPORT_QUALITY_VERSION,
    status: quality.status,
    contentVersion: quality.version,
    assessedAt: now.toISOString(),
    issues: quality.issues.map((issue) => ({
      rule: issue.rule,
      where: issue.where,
      detail: issue.detail,
      fix: issue.fix,
    })),
  };
  return JSON.stringify({ ...parsed, [REPORT_QUALITY_KEY]: stored });
}

/**
 * 读取存档的判定；缺失、版本不匹配或内容已变（指纹不符）都返回 null。
 * null 的语义是「尚未经过当前质量检查」，不是「通过」。
 */
export function readQuality(content: string, expectedContentVersion?: string): StoredReportQuality | null {
  try {
    const parsed = JSON.parse(content) as { quality?: unknown };
    const raw = parsed?.quality as Partial<StoredReportQuality> | undefined;
    if (!raw || typeof raw.status !== "string") return null;
    if (raw.schemaVersion !== REPORT_QUALITY_VERSION) return null;
    if (expectedContentVersion && raw.contentVersion !== expectedContentVersion) return null;
    return raw as StoredReportQuality;
  } catch {
    return null;
  }
}

