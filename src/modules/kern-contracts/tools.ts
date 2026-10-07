/**
 * Kern 工具的契约类型（KX-71 从 supervisor/tools.ts 抽出）。
 *
 * 连接器（MCP / 外部系统）、本机、网页、办公导出等工具提供方只需要实现 `KernTool`，
 * 不需要知道 supervisor 的工具循环怎么跑。supervisor/tools.ts 仍 re-export 这些类型。
 */

export type AskOutcome =
  | { mode: "answer"; text: string }
  | { mode: "ignore" | "timeout" | "deferred" }
  | { mode: "abort" };

export interface ToolContext {
  organizationId: string;
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  /** 只读知识检索；由调用方注入，便于测试替换。 */
  searchKnowledge?: (query: string) => Promise<{ title: string; snippet: string; ref: string }[]>;
  /**
   * KX-51：节点中途向用户提问。由执行器注入（写 node.ask，等 node.answered）；
   * 没注入时 ask_user 不出现在工具列表里。
   */
  askUser?: (q: { question: string; defaultAssumption: string }) => Promise<AskOutcome>;
  /** KX-52：网页检索（未配置提供方时为空，工具不出现）。 */
  webSearch?: (query: string, limit: number, signal?: AbortSignal) => Promise<{ title: string; url: string; snippet: string }[]>;
  /** KX-52：抓取网页正文（生产为 safeFetch + htmlToText；测试可替换）。 */
  webFetch?: (url: string, signal?: AbortSignal) => Promise<{ url: string; title: string | null; text: string; truncated: boolean }>;
}

export interface ToolCitation {
  title: string;
  ref: string;
  url?: string | null;
  sourceId?: string;
  sourceKind?: "SEARCH_RESULT" | "FETCHED_PAGE";
  fetchedAt?: string;
  contentHash?: string;
  snapshot?: string;
  truncated?: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** 可引用的来源（会作为 node.cite 事件展示）。 */
  citations?: ToolCitation[];
}

export interface KernTool {
  name: string;
  label: string;
  description: string;
  inputHint: string;
  /** read：只读，自动执行；ask：需要用户确认（写操作 / 花钱 / 对外发送）。 */
  risk: "read" | "ask";
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
