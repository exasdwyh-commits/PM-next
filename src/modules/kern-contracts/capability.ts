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
  /**
   * 条目背后的完整能力包定义 id（`<域>.<名称>`）；只有文件式能力包条目有值。
   * 界面/Resolver 拿它再回查 `CapabilitySkillDefinition` 拿做法正文与证据要求。
   */
  capabilityId?: string;
}

export interface CapabilityDirectory {
  items: CapabilityEntry[];
  /** 各类数量（含不可用），给界面和日志用。 */
  counts: Record<CapabilityKind, number>;
  /** 生成时间（ISO）。 */
  generatedAt: string;
}

/**
 * 文件式能力包（Capability Pack）的定义，来源是仓库根 `capabilities/<域>/<名称>/SKILL.md`。
 *
 * 与 `CapabilityEntry` 的分工：
 * - `CapabilityEntry` 是「目录条目」——给界面看、给模型做摘要、给检索打分，字段薄；
 * - `CapabilitySkillDefinition` 是「完整定义」——含做法正文、首选 Agent、知识域、
 *   证据要求，给 Capability Resolver 和 Context Builder 用，字段厚。
 *
 * 能力包 ≠ 顾问（advisor，人设与视角）≠ Agent（执行主体）≠ 知识（事实与依据）
 * ≠ 工具（一次具体调用）。四者只通过这里声明的字段互相引用，不互相继承。
 */
export interface CapabilitySkillDefinition {
  /** 稳定标识 `<域>.<名称>`，如 `research.knowledge-synthesis`。目录条目 id 为 `skill:<id>`。 */
  id: string;
  /** 所属域：research / product / marketing / software / nutrition-rd … */
  domain: string;
  /** 能力名（目录名），与 id 的第二段一致。 */
  name: string;
  label: string;
  description: string;
  /** 触发关键词（中英混排），用于按需检索；命中只提分，不独占。 */
  triggers: string[];
  /** 该能力声明服务的原生 intent（`KernCapabilityIntent`），命中即强相关。 */
  intents: string[];
  /** 首选执行 Agent 代码；只是偏好，不强制（模型无关）。 */
  preferredAgents: string[];
  /** 该能力需要的知识域（Knowledge Router 的 scope），如 project / company-facts / web。 */
  knowledgeScopes: string[];
  /** 需要的工具 key；缺省表示不限制。 */
  requiredTools: string[];
  /** 明确禁止的工具 key（能力声明的红线）。 */
  forbiddenTools: string[];
  /** 证据要求（写进 Evidence Policy 层的约束文案），如「结论须带 ≥2 个独立来源」。 */
  evidencePolicy: string | null;
  /** 期望的交付形态：brief / spec / review / digest … */
  outputTypes: string[];
  /** 模型偏好（如 fast / balanced / deep）。**偏好而非必选**，模型不可用时走网关既有降级。 */
  modelPreference: string | null;
  /** 同域内的排序权重，大的先选。 */
  priority: number;
  /** frontmatter 写 `enabled: false` 时该能力不进目录也不参与选择。 */
  enabled: boolean;
  /** 能力包版本（语义化或日期），改动要有意升版本。 */
  version: string;
  /** 进度式加载：摘要（首个二级标题之前的内容），注入 Prompt 的「metadata → summary → full」第二档。 */
  summary: string;
  /** 完整做法正文（frontmatter 之后的 markdown body）。 */
  instructions: string;
  /** 仓库相对路径，用于审计与界面跳转。 */
  sourcePath: string;
  /** frontmatter 解析或校验失败时的原因；成功为 null。 */
  error: string | null;
}

/** 单条能力包加载失败的诊断（目录构建时一并返回，界面能看到「为什么没生效」）。 */
export interface CapabilitySkillDiagnostic {
  sourcePath: string;
  reason: string;
}
