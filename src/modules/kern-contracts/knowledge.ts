/**
 * Knowledge 层的纯契约（KX-73）：路由、综合、冲突、证据绑定的形状。
 *
 * 只有类型与常量，没有实现；实现在 modules/knowledge/router.ts、synthesis.ts、evidence-bridge.ts。
 *
 * 分工：
 * - `KnowledgeResultItem`：**单个 provider 的一条命中**，还没跨源去重。
 * - `KnowledgeRouteResult`：一次路由的原始结果（按 scope 分组，含不可用原因）。
 * - `SynthesizedKnowledge`：综合后的产物（去重、聚类、权威排序、冲突、置信度），
 *   这一层才是喂给模型和写进 Evidence 的东西。
 *
 * Capability 不能绕过这里的权限：provider 只收 `SessionContext`，
 * 由 provider 自己按 organizationId / 用户可见性过滤，路由层不提供越权入口。
 */

/** 知识域（provider 的 scope）。新增 provider 先在这里登记，再在 knowledge/router.ts 实现。 */
export const KNOWLEDGE_SCOPES = [
  "project",
  "files",
  "company-facts",
  "db",
  "memory",
  "web",
  "github",
] as const;

export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/** 权威档（0-1，越大越权威）。默认值由可配置的优先级表给，不写死在综合逻辑里。 */
export type AuthorityTier = "first_party" | "curated" | "public" | "unknown";

export interface KnowledgeResultItem {
  /** 来源 scope，与请求的 scope 对应。 */
  scope: KnowledgeScope | string;
  /** provider 内稳定标识；跨源去重的键之一。 */
  ref: string;
  title: string;
  /** 摘要片段（已截断）。 */
  snippet: string;
  /** 可回溯 URI（文件路径 / 文档 id / URL / 表名）。Evidence 的 contentOrUri。 */
  uri: string | null;
  /** 捕获时间（ISO）。判定 freshness；未知为 null。 */
  capturedAt: string | null;
  /** 权威档；由 authority 表推导，不写死在 provider 里。 */
  authorityTier: AuthorityTier;
  /** 0-1 归一化权威分。 */
  authority: number;
  /** provider 自己给的相关度分（不同 provider 不可比，综合时归一化）。 */
  score: number;
  /** 是否有明确的确认状态（公司事实 CONFIRMED / 外部来源的可信校验）。 */
  verified: boolean;
  /** 冲突分组键（同一条业务主张的不同说法共享它）；无冲突为 null。 */
  conflictGroup: string | null;
  /** 该条的业务主张（用于冲突比对）；provider 给不出则为 null。 */
  statement: string | null;
}

export interface KnowledgeProviderUnavailable {
  scope: string;
  reason: string;
}

export interface KnowledgeRouteResult {
  query: string;
  /** 请求的 scope（原始顺序保留）。 */
  requested: KnowledgeScope[] | string[];
  /** 实际有实现并被执行的 scope。 */
  ran: string[];
  items: KnowledgeResultItem[];
  unavailable: KnowledgeProviderUnavailable[];
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// 综合（synthesis）
// ---------------------------------------------------------------------------

export interface KnowledgeCluster {
  id: string;
  title: string;
  items: KnowledgeResultItem[];
  /** 簇内一致性 0-1：越高越没有互相矛盾的说法。 */
  agreement: number;
  /** 簇内最高权威分。 */
  authority: number;
  /** 簇内最新捕获时间（ISO），未知为 null。 */
  freshestAt: string | null;
}

export interface KnowledgeConflictStatement {
  ref: string;
  title: string;
  statement: string;
  authority: number;
  capturedAt: string | null;
}

export interface KnowledgeConflict {
  group: string;
  statements: KnowledgeConflictStatement[];
  /** 为什么判定为冲突（比对到的差异点）。 */
  reason: string;
  /** 哪一边权威更高；打平为 null。 */
  winnerRef: string | null;
}

export interface SynthesizedKnowledge {
  query: string;
  clusters: KnowledgeCluster[];
  conflicts: KnowledgeConflict[];
  /** 置信度：来源数量、权威、一致性共同决定。 */
  confidence: "high" | "medium" | "low";
  /** 被丢弃的重复项（为什么丢）。 */
  dropped: { ref: string; reason: string }[];
  /** 直接可用的 top 条目（按 综合分 排序），喂给模型的紧凑列表。 */
  top: KnowledgeResultItem[];
}

/** Evidence Policy 层读的绑定结果：综合产物 → 现有 Evidence 的落点。 */
export interface KnowledgeEvidenceBinding {
  /** 创建/复用的 Evidence id。 */
  evidenceId: string;
  /** 该 Evidence 覆盖的 knowledge refs。 */
  refs: string[];
  /** 写入的冲突数（进 EvidenceClaim 的 conflictGroup）。 */
  conflictCount: number;
  created: boolean;
}
