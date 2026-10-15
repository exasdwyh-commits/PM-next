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
 *
 * 为什么放在 shared（L5）：写入方在 L2 supervisor（`report-delivery` 等），
 * 读取方在 L3 product-rnd（`report-view` 读取报告页/接口的质量状态）。
 * 若把本模块留在 supervisor，product-rnd 读质量就会构成
 * 「L3 领域 → L2 Kern 核心」的跨层向上依赖（架构守卫 AL2 会拦下）。
 * 它是纯序列化逻辑、不依赖任何模块，下沉到 shared 后两方都能合规引用。
 */

/** 与 supervisor/report-quality.ts 的 REPORT_QUALITY_VERSION 同源；此处为唯一真源。 */
export const REPORT_QUALITY_SCHEMA_VERSION = "report-quality/v2";

export const REPORT_QUALITY_KEY = "quality";

/** 存进 Artifact 元数据里的形状（只保留可对外展示的字段，内部诊断不进客户报告）。 */
export interface StoredReportQuality {
  schemaVersion: string;
  status: "DELIVERABLE" | "DRAFT_UNVERIFIED" | "BLOCKED";
  /** 内容指纹：内容变了，这条判定就不再适用。 */
  contentVersion: string;
  assessedAt: string;
  issues: { rule: string; where: string; detail: string; fix: string }[];
}

/**
 * 可归档的质量判定：结构上兼容 supervisor 的 `ReportQuality`，
 * 但本模块不反向 import 它（避免 shared → L2 的越界）。
 */
export interface ArchivableReportQuality {
  status: StoredReportQuality["status"];
  /** 内容指纹。 */
  version: string;
  issues: { rule: string; where: string; detail: string; fix: string }[];
}

export function attachQuality(content: string, quality: ArchivableReportQuality, now: Date = new Date()): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // 内容不是 JSON（历史纯文本行）：不改写原文，交由调用方决定如何处理。
    return content;
  }
  if (!parsed || typeof parsed !== "object") return content;
  const stored: StoredReportQuality = {
    schemaVersion: REPORT_QUALITY_SCHEMA_VERSION,
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
    if (raw.schemaVersion !== REPORT_QUALITY_SCHEMA_VERSION) return null;
    if (expectedContentVersion && raw.contentVersion !== expectedContentVersion) return null;
    return raw as StoredReportQuality;
  } catch {
    return null;
  }
}
