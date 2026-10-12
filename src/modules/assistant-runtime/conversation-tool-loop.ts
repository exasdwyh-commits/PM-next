import type { SessionContext } from "@/modules/identity/session";
import {
  executePersistedModelGateway,
  type ModelGatewayMessage,
  type ModelNativeToolCall,
  type ModelPolicy,
  type ModelProfile,
  type ModelTaskClass,
  type ModelToolSchema,
  type ModelUsage,
} from "@/modules/model-gateway";
import {
  DEFAULT_TOOL_OUTPUT_LIMIT,
  filterToolsByConstraints,
  resolveToolStepLimit,
  resolveToolTimeoutMs,
  runToolLoop,
  toolInstructions,
  toolSchemasFor,
  toolsFor,
  type CapabilityToolConstraints,
  type ToolCallRecord,
  type ToolLoopIncomplete,
} from "@/modules/supervisor/tools";
import type { KernTool, ToolContext } from "@/modules/kern-contracts";
import { readDesktopPresence, type DesktopPresence } from "@/modules/desktop-runtime/presence";
import { searchKnowledge } from "@/modules/knowledge/search";
import { getWebSearch } from "@/modules/supervisor/web-search";
import { getWebCrawl } from "@/modules/supervisor/web-crawl";
import { fetchPageText } from "@/modules/supervisor/generic-executor";

/**
 * C2 对话工具循环：对话主入口的多步只读工具循环。
 *
 * 以前对话的模型调用是「确定性 capability 先跑一次 → 模型润色一次即终点」。
 * 这里把 C1 的 runToolLoop 接到对话的网关分支上：模型可以先查知识、先算数、
 * 先抓网页再作答，全程复用同一套步数/token/时长预算与 env 口径
 * （KERN_TOOL_MAX_STEPS / KERN_TOOL_BUDGET_TOKENS / KERN_TOOL_BUDGET_MS，
 * 与 Mission 节点执行器同源），不另写第二套循环或预算解析。
 *
 * 记账：每一次模型调用都走 executePersistedModelGateway（持久化 ModelRun +
 * usage 层额度），不存在绕过网关的裸 provider 调用。测试缝只替换 invoker
 * 本身（与 generic-executor 的 setMissionModelInvokerForTest 同一模式）；
 * 生产路径的记账证据由 tests/regression-kern-conversation-tool-loop.ts
 * 用真实网关 + 账本断言。
 *
 * 工具面：只开放 C1 工具表里 risk:"read" 的工具（knowledge_search /
 * calculate / web_search / web_fetch / web_crawl / desktop_status）。
 * ask_user（risk:"ask"）与任何写/审批类工具永不进入对话候选——即使
 * ToolContext 里注入了 askUser，也会在组装时被过滤掉。
 *
 * 中断：调用方的 AbortSignal 与 assertActive（ConversationExecution 提供）
 * 同时进入 ToolContext 与每次网关请求；runToolLoop 在每步前后检查，
 * ExecutionStoppedError / AbortError 如实向上抛，由 conversation-engine
 * 沿用既有中断语义处理。
 */

export type ConversationModelInvoker = (input: {
  organizationId: string;
  agentRunId: string;
  taskClass: ModelTaskClass;
  messages: ModelGatewayMessage[];
  signal?: AbortSignal;
  beforeAttempt?: () => Promise<void>;
  /** 原生 function calling 工具表：随请求下发，路由要求 TOOLS 能力。 */
  tools?: ModelToolSchema[];
}) => Promise<{
  text: string;
  provenance: Record<string, unknown>;
  nativeToolCalls?: ModelNativeToolCall[];
  usage?: ModelUsage | null;
}>;

let invokerOverride: ConversationModelInvoker | null = null;

/** Test seam: replace the model call (the persisted-gateway wiring stays the only production path). */
export function setConversationModelInvokerForTest(fn: ConversationModelInvoker | null) {
  invokerOverride = fn;
}

function positiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 与 Mission 执行器同源的工具预算（步数走 C1 的 resolveToolStepLimit，不另解析）。 */
export function conversationToolBudget() {
  return {
    maxSteps: resolveToolStepLimit(),
    maxTokens: positiveIntEnv("KERN_TOOL_BUDGET_TOKENS", 60_000),
    deadlineMs: positiveIntEnv("KERN_TOOL_BUDGET_MS", 600_000),
  };
}

/** 本机桌面运行时在线状态（只读查询，不执行任何本机动作）。 */
export function desktopStatusTool(readPresence: () => DesktopPresence): KernTool {
  return {
    name: "desktop_status",
    label: "本机状态",
    description:
      "查看用户本机（Mac）桌面运行时此刻是否在线（只读状态查询）。只能看状态，不能在本机执行任何动作；需要本机执行时如实告诉用户走本机任务流程。",
    inputHint: "{}",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const presence = readPresence();
      return {
        ok: true,
        output:
          `本机桌面运行时状态：${presence.label}` +
          (presence.lastSeenAt ? `（最近一次心跳 ${presence.lastSeenAt}）` : "") +
          (presence.hint ? `。${presence.hint}` : ""),
      };
    },
  };
}

/**
 * 对话侧工具表：toolsFor 组装后按 risk:"read" 过滤，再加本机状态只读工具。
 * 写/审批/提问类工具在此被挡在候选之外，模型连名字都看不到。
 *
 * C4：再按本轮能力解析的工具约束（requiredTools/forbiddenTools 并集）过滤 ——
 * 约束只进提示词的时代结束了，执行侧的候选表同样受约束。
 */
export function conversationReadTools(
  ctx: ToolContext,
  readPresence: () => DesktopPresence,
  constraints: CapabilityToolConstraints = {}
): KernTool[] {
  return filterToolsByConstraints(
    [...toolsFor(ctx), desktopStatusTool(readPresence)],
    constraints
  ).filter((tool) => tool.risk === "read");
}

export interface ConversationToolLoopInput {
  session: SessionContext;
  agentRunId: string;
  policy: ModelPolicy;
  profiles: ModelProfile[];
  taskClass: ModelTaskClass;
  /** 对话消息（system 人设 + 历史 + 本轮），工具说明由本模块追加进 system。 */
  messages: { role: string; content: string }[];
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  /** 记账元数据（进 ModelRun.requestMeta / 网关 metadata）。 */
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * 测试缝：替换工具提供方（知识检索 / 网页抓取等）。只影响工具执行，
   * 模型调用路径（executePersistedModelGateway）不受影响。
   */
  toolContextOverrides?: Partial<
    Pick<ToolContext, "searchKnowledge" | "webSearch" | "webFetch" | "webCrawl" | "askUser">
  >;
  /** 测试缝：替换本机状态读取（默认读 desktop-runtime presence 注册表）。 */
  desktopPresenceReader?: () => DesktopPresence;
  /**
   * C4：本轮能力解析交过来的工具约束（requiredTools / forbiddenTools 并集，
   * 见 `CapabilityResolution`）。不传 = 不约束，行为与以前一致。
   */
  toolConstraints?: CapabilityToolConstraints;
}

export interface ConversationToolLoopResult {
  text: string;
  /** 预算耗尽/空输出时如实置位（BUDGET_STEPS / BUDGET_TOKENS / BUDGET_TIME / EMPTY_OUTPUT）。 */
  incomplete?: ToolLoopIncomplete;
  toolCalls: ToolCallRecord[];
  citations: { kind: string; ref: string; title: string }[];
  /** 循环内全部模型调用的 usage 合计；provider 全程未回 usage 时为 null。 */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  provider: string | null;
  modelId: string | null;
  /** 最后一次模型调用的持久化 ModelRun id。 */
  modelRunId: string | null;
  modelCalls: number;
  protocolUsed?: "native" | "text";
}

export async function runConversationToolLoop(
  input: ConversationToolLoopInput
): Promise<ConversationToolLoopResult> {
  const { session } = input;
  const toolCtx: ToolContext = {
    organizationId: session.organizationId,
    signal: input.signal,
    assertActive: input.assertActive,
    searchKnowledge: async (query) => {
      const r = await searchKnowledge(session, { query, limit: 5 });
      return [
        ...r.facts.map((f) => ({ title: `公司事实 · ${f.label}`, snippet: f.value.slice(0, 300), ref: `fact:${f.id}` })),
        ...r.citations.map((c) => ({ title: c.docTitle, snippet: c.snippet, ref: `knowledge:${c.ref}` })),
      ].slice(0, 6);
    },
    webSearch: getWebSearch() ?? undefined,
    webFetch: process.env.KERN_WEB_FETCH === "off" ? undefined : fetchPageText,
    webCrawl: process.env.KERN_CRAWL === "off" ? undefined : getWebCrawl() ?? undefined,
    ...input.toolContextOverrides,
  };
  const readPresence =
    input.desktopPresenceReader ??
    (() => readDesktopPresence({ organizationId: session.organizationId, userId: session.userId }));
  // C4：能力包的工具约束进执行侧 —— 声明了 required/forbidden 的包，
  // 模型实际能用的候选表就被约束住，不只是提示词里写一行字。
  const tools = conversationReadTools(toolCtx, readPresence, input.toolConstraints ?? {});
  const budget = conversationToolBudget();

  // 工具说明追加进既有 system 消息（人设/输出契约在前，工具用法在后）；没有 system 时补一条。
  const instructions = toolInstructions(tools, budget.maxSteps);
  const messages: ModelGatewayMessage[] = input.messages.map((m) => ({
    role: m.role as ModelGatewayMessage["role"],
    content: m.content,
  }));
  const systemIndex = messages.findIndex((m) => m.role === "system");
  if (systemIndex >= 0) {
    messages[systemIndex] = { ...messages[systemIndex], content: `${messages[systemIndex].content}\n\n${instructions}` };
  } else {
    messages.unshift({ role: "system", content: instructions });
  }

  // 原生 function calling：候选里存在启用且具备 TOOLS 能力的模型时才下发 tools；
  // 否则维持文本协议。原生调用运行时失败由 runToolLoop 自动回落文本协议。
  const nativeTools = input.profiles.some((p) => p.enabled && p.capabilities.includes("TOOLS"))
    ? toolSchemasFor(tools)
    : undefined;

  const invoker: ConversationModelInvoker =
    invokerOverride ??
    (async (call) => {
      const executed = await executePersistedModelGateway({
        organizationId: call.organizationId,
        agentRunId: call.agentRunId,
        policy: input.policy,
        profiles: input.profiles,
        request: {
          taskClass: input.taskClass,
          messages: call.messages,
          signal: call.signal,
          beforeAttempt: call.beforeAttempt,
          metadata: { source: "kern.conversation", ...(input.metadata ?? {}) },
          ...(call.tools?.length
            ? { tools: call.tools, requiredCapabilities: ["TOOLS" as const] }
            : {}),
        },
        requestMeta: {
          source: "kern.conversation",
          ...(input.metadata ?? {}),
          toolProtocol: call.tools?.length ? "native" : "text",
        },
      });
      return {
        text: executed.result.text,
        provenance: {
          modelRunId: executed.modelRunId,
          provider: executed.result.provider,
          modelId: executed.result.resolvedModelId,
          policyId: executed.result.policyId,
        },
        ...(executed.result.toolCalls ? { nativeToolCalls: executed.result.toolCalls } : {}),
        usage: executed.result.usage ?? null,
      };
    });

  let modelCalls = 0;
  let usage: ConversationToolLoopResult["usage"] = null;
  let provider: string | null = null;
  let modelId: string | null = null;
  let modelRunId: string | null = null;

  const out = await runToolLoop({
    messages,
    invoke: (msgs, opts) =>
      invoker({
        organizationId: session.organizationId,
        agentRunId: input.agentRunId,
        taskClass: input.taskClass,
        messages: msgs as ModelGatewayMessage[],
        signal: input.signal,
        beforeAttempt: input.assertActive,
        ...(opts?.nativeTools?.length ? { tools: opts.nativeTools } : {}),
      }),
    tools,
    ctx: toolCtx,
    budget,
    perToolTimeoutMs: resolveToolTimeoutMs(),
    maxToolOutputChars: positiveIntEnv("KERN_TOOL_OUTPUT_LIMIT", DEFAULT_TOOL_OUTPUT_LIMIT),
    ...(nativeTools ? { nativeTools } : {}),
    onModelCall: (r) => {
      if ("unavailable" in r) return;
      modelCalls += 1;
      if (r.usage) {
        usage = {
          inputTokens: (usage?.inputTokens ?? 0) + (r.usage.inputTokens ?? 0),
          outputTokens: (usage?.outputTokens ?? 0) + (r.usage.outputTokens ?? 0),
          totalTokens:
            (usage?.totalTokens ?? 0) +
            (r.usage.totalTokens ?? (r.usage.inputTokens ?? 0) + (r.usage.outputTokens ?? 0)),
        };
      }
      if (typeof r.provenance.provider === "string") provider = r.provenance.provider;
      if (typeof r.provenance.modelId === "string") modelId = r.provenance.modelId;
      if (typeof r.provenance.modelRunId === "string") modelRunId = r.provenance.modelRunId;
    },
  });

  if ("unavailable" in out) {
    // 本模块的生产 invoker 失败时直接抛错（由 engine 沿用既有回落），不会返回 unavailable；
    // 测试缝若返回 unavailable，按未完成如实上报，不冒充答案。
    return {
      text: `模型当前不可用（${out.unavailable}），本轮未能通过工具循环作答。`,
      incomplete: "EMPTY_OUTPUT",
      toolCalls: [],
      citations: [],
      usage,
      provider,
      modelId,
      modelRunId,
      modelCalls,
    };
  }

  const toolCalls = out.toolCalls ?? [];
  const seenCitations = new Set<string>();
  const citations: ConversationToolLoopResult["citations"] = [];
  for (const call of toolCalls) {
    for (const c of call.citations) {
      const key = `${c.ref}::${c.title}`;
      if (seenCitations.has(key)) continue;
      seenCitations.add(key);
      citations.push({ kind: c.sourceKind ?? "tool", ref: c.ref, title: c.title });
    }
  }

  return {
    text: out.text,
    ...(out.incomplete ? { incomplete: out.incomplete } : {}),
    toolCalls,
    citations,
    usage,
    provider,
    modelId,
    modelRunId,
    modelCalls,
    ...(out.protocolUsed ? { protocolUsed: out.protocolUsed } : {}),
  };
}
