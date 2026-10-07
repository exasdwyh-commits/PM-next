/**
 * 统一能力目录的条目契约（KX-71）。
 *
 * 技能（做法）、知识库、插件（连接器 / MCP）、工具（内置 / 网页 / 办公导出 / 本机）、
 * 原生能力（Capability Registry）都登记成同一种条目：说明、输入输出、权限档、来源、审计落点。
 * Kern 按需求检索这份目录再决定调用什么；界面也用它来展示「Kern 现在会什么」。
 *
 * 这里只有类型，没有实现；实现在 assistant-runtime/capabilities/directory.ts。
 */

export type CapabilityKind = "native" | "skill" | "knowledge" | "plugin" | "tool";

/**
 * 权限档：
 * - read  只读，自动执行
 * - ask   执行前必须问人（写操作 / 花钱 / 对外发送 / 不可逆）
 * - write 用户已明确授权可写（如连接器档位 interact）
 * - off   已登记但当前关闭
 */
export type CapabilityAccess = "read" | "ask" | "write" | "off";

export interface CapabilityEntry {
  /** 稳定标识：`<kind>:<key>`，如 `tool:web_search`、`plugin:<connectorId>/<tool>`、`skill:<playbookId>`。 */
  id: string;
  kind: CapabilityKind;
  label: string;
  description: string;
  /** 输入是什么（人话或示例 JSON）。 */
  input: string;
  /** 输出是什么。 */
  output: string;
  access: CapabilityAccess;
  /** 来源：内置 / 连接器主机 / 由哪次任务沉淀 / 知识源类型。 */
  source: string;
  /** 审计落点：这类调用记录在哪里、用户在哪里能看到。 */
  audit: string;
  /** 现在能不能用（网页检索没配置、连接器报错、本机离线 → false）。 */
  available: boolean;
  /** 不可用时的原因；可用时为 null。 */
  unavailableReason: string | null;
  /** 检索用关键词。 */
  tags: string[];
}

export interface CapabilityDirectory {
  items: CapabilityEntry[];
  /** 各类数量（含不可用），给界面和日志用。 */
  counts: Record<CapabilityKind, number>;
  /** 生成时间（ISO）。 */
  generatedAt: string;
}
