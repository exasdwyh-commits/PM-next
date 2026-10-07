/**
 * 统一能力目录（KX-71）：把原生能力、工具、插件、做法、知识库拼成一份 CapabilityEntry 清单。
 *
 * 分两层：
 * - `buildCapabilityDirectory(inputs)`：纯函数，输入全部由调用方给（测试直接喂数据）。
 * - `loadCapabilityDirectory(session)`：从各模块读真实数据后调用上面那个。
 * - `searchCapabilities(items, query, limit)`：纯关键词打分，Kern 与界面都用它检索。
 *
 * 注意：这里只「登记 + 检索」，不执行。执行仍走各自的通道
 * （Capability Registry / supervisor 工具循环 / 连接器运行时 / 做法匹配）。
 */
import type { CapabilityAccess, CapabilityDirectory, CapabilityEntry, CapabilityKind } from "@/modules/kern-contracts";
import { KERN_CAPABILITY_CATALOG } from "./catalog";

// ---------------------------------------------------------------------------
// 输入形状（刻意与各模块的 View 类型解耦，只取需要的字段）
// ---------------------------------------------------------------------------

export interface DirectoryToolInput {
  name: string;
  label: string;
  description: string;
  inputHint: string;
  risk: "read" | "ask";
}

export interface DirectoryConnectorInput {
  id: string;
  name: string;
  host: string;
  lastError: string | null;
  tools: { name: string; title: string; description: string; effect: "read" | "write"; enabled: boolean }[];
}

export interface DirectoryPlaybookInput {
  id: string;
  name: string;
  sourceGoal: string;
  steps: number;
  useCount: number;
  successCount: number;
  failureCount: number;
}

export interface DirectoryKnowledgeInput {
  sources: { id: string; name: string; kind: string; enabled: boolean; documentCount: number }[];
  confirmedFactsCount: number;
}

export interface CapabilityDirectoryInputs {
  /** supervisor 工具循环里的内置工具（knowledge_search / calculate / ask_user …）。 */
  tools: DirectoryToolInput[];
  /** 网页检索是否配置了提供方（没配置则 web_search / web_fetch 登记为不可用）。 */
  webSearchConfigured: boolean;
  /** 本机 Desktop Runtime 是否在线。 */
  desktopOnline: boolean;
  connectors: DirectoryConnectorInput[];
  playbooks: DirectoryPlaybookInput[];
  knowledge: DirectoryKnowledgeInput;
  now?: Date;
}

// ---------------------------------------------------------------------------
// 各类条目
// ---------------------------------------------------------------------------

/** 原生能力的权限档：写产品 / 本机执行要问人，其余只读。 */
const NATIVE_ACCESS: Record<string, CapabilityAccess> = {
  "product-write": "ask",
  desktop: "ask",
};

function nativeEntries(desktopOnline: boolean): CapabilityEntry[] {
  return KERN_CAPABILITY_CATALOG.map((c) => {
    const isDesktop = c.key === "desktop";
    return {
      id: `native:${c.key}`,
      kind: "native",
      label: c.label,
      description: c.description,
      input: c.intents.length ? `对话里直接说；识别为 ${c.intents.join(" / ")}` : "对话里直接说",
      output: c.toolKeys.join("、"),
      access: NATIVE_ACCESS[c.key] ?? "read",
      source: "内置（Capability Registry）",
      audit: "对话工具调用记录（conversation tool call），可在会话里展开查看",
      available: isDesktop ? desktopOnline : true,
      unavailableReason: isDesktop && !desktopOnline ? "本机 Desktop Runtime 未在线" : null,
      tags: [c.key, ...c.intents.map((i) => i.toLowerCase()), ...c.toolKeys],
    };
  });
}

const WEB_TOOL_NAMES = new Set(["web_search", "web_fetch"]);

function toolEntries(tools: DirectoryToolInput[], webSearchConfigured: boolean): CapabilityEntry[] {
  const seen = new Set<string>();
  const out: CapabilityEntry[] = [];
  for (const t of tools) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    const isWeb = WEB_TOOL_NAMES.has(t.name);
    const unavailable = isWeb && !webSearchConfigured;
    out.push({
      id: `tool:${t.name}`,
      kind: "tool",
      label: t.label,
      description: t.description,
      input: t.inputHint,
      output: "文本结果；有来源时附引用",
      access: t.risk,
      source: isWeb ? "内置（网页）" : "内置",
      audit: "任务时间线里的 node.tool / node.cite 事件",
      available: !unavailable,
      unavailableReason: unavailable ? "未配置网页检索提供方" : null,
      tags: [t.name, isWeb ? "web" : "builtin"],
    });
  }
  // 办公导出不是工具循环里的工具，而是产出侧能力；一样登记，用户才知道 Kern 能交付什么文件。
  out.push({
    id: "tool:office_export",
    kind: "tool",
    label: "导出办公文件",
    description: "把任务结论导出为 Word / Excel / PowerPoint / Markdown / PDF（打印页）。",
    input: "任务 id + 格式（md / pdf / docx / xlsx / pptx）",
    output: "可下载文件；响应头带 SHA-256",
    access: "read",
    source: "内置（office-export）",
    audit: "下载请求日志；文件本身可回读校验",
    available: true,
    unavailableReason: null,
    tags: ["office", "docx", "xlsx", "pptx", "export", "导出"],
  });
  return out;
}

function pluginEntries(connectors: DirectoryConnectorInput[]): CapabilityEntry[] {
  return connectors.flatMap((c) =>
    c.tools.map((t) => {
      const access: CapabilityAccess = !t.enabled ? "off" : t.effect === "write" ? "ask" : "read";
      return {
        id: `plugin:${c.id}/${t.name}`,
        kind: "plugin" as const,
        label: `${c.name} · ${t.title}`,
        description: t.description || "（连接器未提供说明）",
        input: "按该工具的输入模式（连接器刷新时读取）",
        output: "连接器返回的文本 / 结构化结果",
        access,
        source: `连接器 ${c.host}`,
        audit: t.effect === "write" ? "连接器审批记录（先问人）+ 任务时间线" : "任务时间线里的 node.tool 事件",
        available: !c.lastError && t.enabled,
        unavailableReason: c.lastError ? `连接器最近出错：${c.lastError}` : !t.enabled ? "该工具已关闭" : null,
        tags: [c.name, c.host, t.name, t.effect, "mcp", "connector", "插件"],
      };
    })
  );
}

function skillEntries(playbooks: DirectoryPlaybookInput[]): CapabilityEntry[] {
  return playbooks.map((p) => ({
    id: `skill:${p.id}`,
    kind: "skill",
    label: p.name,
    description: `做法：${p.steps} 步；用过 ${p.useCount} 次，成功 ${p.successCount} 次${p.failureCount ? `，失败 ${p.failureCount} 次` : ""}。`,
    input: `与「${p.sourceGoal.slice(0, 60)}」相近的目标`,
    output: "按该做法生成的任务计划",
    access: "read",
    source: "由完成的任务沉淀（playbooks）",
    audit: "任务记录里的 playbook 使用与成败计数",
    available: true,
    unavailableReason: null,
    tags: ["playbook", "做法", "skill", ...p.sourceGoal.split(/\s+/).slice(0, 8)],
  }));
}

function knowledgeEntries(k: DirectoryKnowledgeInput): CapabilityEntry[] {
  const sources = k.sources.map<CapabilityEntry>((s) => ({
    id: `knowledge:${s.id}`,
    kind: "knowledge",
    label: s.name,
    description: `知识源（${s.kind}）：${s.documentCount} 篇文档。`,
    input: "自然语言问题（knowledge_search）",
    output: "相关片段 + 引用",
    access: "read",
    source: `知识源 ${s.kind}`,
    audit: "node.cite 引用事件",
    available: s.enabled && s.documentCount > 0,
    unavailableReason: !s.enabled ? "知识源已停用" : s.documentCount === 0 ? "还没有同步到文档" : null,
    tags: ["knowledge", "知识库", s.kind.toLowerCase(), s.name],
  }));
  sources.push({
    id: "knowledge:company-facts",
    kind: "knowledge",
    label: "公司事实",
    description: `已确认的公司事实 ${k.confirmedFactsCount} 条（规模、品类、渠道等）。`,
    input: "自动注入对话上下文；也可直接问",
    output: "事实与确认状态",
    access: "read",
    source: "知识模块（company facts）",
    audit: "事实的确认 / 作废记录",
    available: k.confirmedFactsCount > 0,
    unavailableReason: k.confirmedFactsCount > 0 ? null : "还没有确认过公司事实",
    tags: ["facts", "公司事实", "knowledge"],
  });
  return sources;
}

// ---------------------------------------------------------------------------
// 组装与检索
// ---------------------------------------------------------------------------

const KINDS: CapabilityKind[] = ["native", "tool", "plugin", "skill", "knowledge"];

export function buildCapabilityDirectory(inputs: CapabilityDirectoryInputs): CapabilityDirectory {
  const items = [
    ...nativeEntries(inputs.desktopOnline),
    ...toolEntries(inputs.tools, inputs.webSearchConfigured),
    ...pluginEntries(inputs.connectors),
    ...skillEntries(inputs.playbooks),
    ...knowledgeEntries(inputs.knowledge),
  ];
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<CapabilityKind, number>;
  for (const it of items) counts[it.kind] += 1;
  return { items, counts, generatedAt: (inputs.now ?? new Date()).toISOString() };
}

function tokens(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9_.-]{2,}/g) ?? [];
  // 中文按 2 字切片，够用且不引入分词依赖（与 playbooks/match 同思路）。
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  const bigrams: string[] = [];
  for (const run of cjk) for (let i = 0; i + 1 < run.length; i += 1) bigrams.push(run.slice(i, i + 2));
  return [...latin, ...bigrams];
}

/** 关键词打分：标签命中 3 分、标签部分命中 2 分、标题命中 2 分、描述命中 1 分；不可用条目降权但不剔除。 */
export function searchCapabilities(items: CapabilityEntry[], query: string, limit = 8): CapabilityEntry[] {
  const q = tokens(query);
  if (!q.length) return items.slice(0, limit);
  const scored = items
    .map((it) => {
      const tagSet = it.tags.map((t) => t.toLowerCase());
      const label = it.label.toLowerCase();
      const desc = it.description.toLowerCase();
      let score = 0;
      for (const t of q) {
        if (tagSet.includes(t)) score += 3;
        else if (tagSet.some((g) => g.includes(t))) score += 2;
        if (label.includes(t)) score += 2;
        if (desc.includes(t)) score += 1;
      }
      if (!it.available) score *= 0.5;
      return { it, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.it.label.localeCompare(b.it.label, "zh"));
  return scored.slice(0, limit).map((s) => s.it);
}

/** 给模型看的紧凑清单（一行一条），只列可用条目。 */
export function capabilityDigest(items: CapabilityEntry[], limit = 12): string {
  return items
    .filter((it) => it.available)
    .slice(0, limit)
    .map((it) => `- [${it.kind}/${it.access}] ${it.label}：${it.description.slice(0, 80)}`)
    .join("\n");
}
