/**
 * AI 顾问（蓝图 §5、§6、§8）
 *
 * 本版定位（**必须如实标注，不得宣称已具备通用对话能力**）：
 * - 未配置模型端点时 runMode = TEST_STUB，回复由**确定性工具**产出，不是语言模型生成；
 * - 意图路由走受约束的白名单执行器，模型不直接写数据库；
 * - 写入链留痕：AgentRun + ToolCall 全程落库，可查回执；
 * - 费用未知即标 unknown，不编造 token 与金额。
 *
 * 接入真实模型后，只需替换 runAgent 中的 reply 生成部分，其余链路不变。
 */

import crypto from "crypto";
import prisma from "@/shared/db";
import { NotFoundError, UnprocessableEntityError } from "@/shared/errors";
import { RunMode } from "@prisma/client";
import { SessionContext } from "../identity/session";
import { getWorkspaceOverview } from "../workspace/overview";
import { listProductBoard } from "../products/service";
import {
  ADVISOR_FIELD_LABELS,
  ADVISOR_FIELD_WHITELIST,
  createProposal,
  listProposals,
  supersedeStaleProposals,
} from "./proposals";
import { searchKnowledge } from "../knowledge/service";
import type { ProductSpecField } from "../product-development/revision";
import { fmtDateTime } from "@/shared/datetime";
import { generateChallengeReport, matchRelevantIngredients, parseIngredientFrontmatter } from "./challenge";
import {
  ADVISOR_LLM_SYSTEM_PROMPT_VERSION,
  buildAdvisorLLMMessages,
  createAdvisorLLMClient,
  isAdvisorLLMEnabled,
  type AdvisorLLMMessage,
} from "./llm";
import { buildDepartmentAssistantSystemPrompt } from "@/modules/assistant-runtime/persona";
import { applyExplicitChatProposal } from "@/modules/assistant-runtime/proposal-executor";
import { buildKernPlannerMessages, parseKernPlannerIntent } from "@/modules/assistant-runtime/planner";
import type { ScientificEvidenceInput } from "../research/scientific-evidence";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executePersistedModelGateway,
  hasEnabledPolicyCandidate,
  type ModelTaskClass,
} from "@/modules/model-gateway";
import {
  describeDesktopAction,
  enqueueDesktopTask,
  isDesktopInstruction,
  readDesktopPresence,
} from "@/modules/desktop-runtime";
import { getProductRndProgramStatus, startProductRndProgram } from "@/modules/product-rnd";
import { labelAgentTaskStatus, labelWorkItemStatus } from "@/shared/status-labels";

export async function listConversations(
  session: SessionContext,
  options?: { productId?: string | null }
) {
  const where: any = { organizationId: session.organizationId, ownerId: session.userId, archivedAt: null };
  if (options?.productId !== undefined) {
    where.productId = options.productId;
  }
  return prisma.conversation.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, createdAt: true, role: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function createConversation(
  session: SessionContext,
  params: { title?: string; productId?: string | null }
) {
  const title = params.title?.trim() || "新对话";
  return prisma.conversation.create({
    data: {
      organizationId: session.organizationId,
      ownerId: session.userId,
      kind: params.productId ? "PRODUCT" : "ADVISOR",
      title,
      productId: params.productId || null,
    },
  });
}

export async function getConversation(session: SessionContext, conversationId: string) {
  const convo = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      runs: { orderBy: { createdAt: "desc" }, take: 5, include: { toolCalls: true } },
    },
  });
  if (!convo || convo.organizationId !== session.organizationId || convo.ownerId !== session.userId) {
    throw new NotFoundError("Conversation not found");
  }
  return convo;
}

// ---------------------------------------------------------------------------
// 意图路由：受约束的白名单执行器（蓝图 §8：免费模型无原生工具调用时也用同一层）
// ---------------------------------------------------------------------------

export type Intent =
  | "WORKSPACE_STATUS"
  | "PENDING_DECISIONS"
  | "PRODUCT_STATUS"
  | "PENDING_PROPOSALS"
  | "PROPOSE_FIELD_CHANGE"
  | "PROPOSE_CREATE_WORK_ITEM"
  | "NEW_PRODUCT_INTAKE"
  | "START_PRODUCT_RND"
  | "PRODUCT_RND_STATUS"
  | "PRODUCT_RND_REPORT"
  | "KNOWLEDGE_SEARCH"
  | "CHALLENGE_THESIS"
  | "DESKTOP_EXECUTION"
  | "UNSUPPORTED";

const TASK_VERB = /(?:创建任务|建立任务|安排任务|记个待办|生成任务|推进任务|新建任务|创建工作项|生成工作项)/;

/**
 * Product R&D 是会产生 WorkItem / AgentTask / ResearchRun 的真实执行动作，
 * 只允许由明确动词触发。它不属于 Kern Planner 的可选 intent，
 * 避免模型把“聊聊研发”误判成“现在启动一套研发程序”。
 */
const PRODUCT_RND_START =
  /(?:(?:开始|启动|发起|跑一轮|继续|推进).{0,10}(?:AI\s*)?(?:产品研发|研发评估)|(?:AI\s*)?(?:产品研发|研发评估).{0,10}(?:开始|启动|发起|跑一轮|继续|推进))/i;

const PRODUCT_RND_STATUS =
  /(?:(?:产品研发|AI\s*研发|研发评估).{0,12}(?:进度|状态|到哪|做到哪|怎么样|如何了|怎样了)|(?:进度|状态|到哪|做到哪|怎么样|如何了|怎样了).{0,12}(?:产品研发|AI\s*研发|研发评估))/i;

const PRODUCT_RND_REPORT =
  /(?:(?:产品研发|AI\s*研发|研发评估|研发报告).{0,16}(?:报告|结论|风险|UNKNOWN|未知|决策|建议|结果)|(?:报告|结论|风险|UNKNOWN|未知|决策|建议|结果).{0,16}(?:产品研发|AI\s*研发|研发评估|研发报告))/i;

function parseWorkItemTask(text: string): { title: string } | null {
  const match = TASK_VERB.exec(text);
  if (!match) return null;
  const rawTitle = text
    .slice(match.index + match[0].length)
    .trim()
    .replace(/^[:：\s]+/, "")
    .replace(/^[「"'“”『]+/, "")
    .replace(/[」"'“”』]+$/, "")
    .replace(/[。！!，,；;]+$/, "")
    .trim();
  if (rawTitle.length >= 2) {
    return { title: rawTitle.slice(0, 60) };
  }
  return null;
}

/** 字段口语别名 → 白名单字段。顺序即优先级：更具体的说法放前面。 */
const FIELD_ALIASES: { pattern: RegExp; field: ProductSpecField }[] = [
  { pattern: /(核心卖点|卖点|主打点|主打)/, field: "coreSellingPoints" },
  { pattern: /(目标人群|目标用户|目标受众|人群|受众)/, field: "targetAudience" },
  { pattern: /(预期渠道|渠道|铺货|上架渠道)/, field: "targetChannels" },
  { pattern: /(价格预期|定价|售价|价格)/, field: "priceExpectation" },
  { pattern: /(剂型|规格|包装形式|净含量)/, field: "formSpec" },
  { pattern: /(禁用项|禁用|不能添加|不添加|不加)/, field: "forbiddenItems" },
  { pattern: /(一句话想法|核心想法|一句话|想法)/, field: "coreIdea" },
];

const CHANGE_VERB = /(?:改为|改成|调整为|修改为|更新为|设为|设置为|变成|换为|换成)/;

function matchField(text: string): ProductSpecField | null {
  for (const a of FIELD_ALIASES) if (a.pattern.test(text)) return a.field;
  return null;
}

/**
 * 从口语指令里解析「字段 + 新值」。
 * 只认「<字段说法> … <变更动词> <新值>」这一种句式；解析不出就如实说没听懂，
 * 不做模糊猜测 —— 猜错字段会把真实业务数据改歪。
 */
function parseFieldChange(text: string): { field: ProductSpecField; value: string } | null {
  const verb = CHANGE_VERB.exec(text);
  if (!verb) return null;
  const value = text
    .slice(verb.index + verb[0].length)
    .trim()
    .replace(/^[「"'“”『]+/, "")
    .replace(/[」"'“”』]+$/, "")
    .replace(/[。！!，,；;]+$/, "")
    .trim();
  if (!value) return null;
  // 字段说法通常在变更动词之前；动词前没提到再退回全句匹配
  const field = matchField(text.slice(0, verb.index)) ?? matchField(text);
  if (!field) return null;
  return { field, value };
}

// ── 新建产品：从一句话想法到入库提议 ──
//
// 产品入库要五项（名称 / 一句话想法 / 目标人群与场景 / 核心卖点 / 预期渠道），
// 一句口语几乎不可能同时给全。这里不猜、不补默认值，改成跨消息累积：
// 用户先说一句想法，Hermes 如实说清还缺哪几项，用户分几条补齐，齐了才生成提议。
// 提议卡上的每个字都必须是用户自己说过的话 —— 确认后它们会原样成为产品 v1 版本内容。

const NEW_PRODUCT_VERB =
  /(我想做|我要做|想做一款|想做个|想做一个|想开发|做一款新|新建产品|新产品立项|开个新产品|立个产品|产品想法|帮我立项)/;

/** 入库五项的口语标签。顺序即回复里的展示与追问顺序。 */
const INTAKE_FIELDS = [
  { key: "name", label: "名称", pattern: /(?:产品名称|产品名|名称|名字)/ },
  { key: "coreIdea", label: "一句话想法", pattern: /(?:一句话想法|核心想法|想法|定位)/ },
  {
    key: "targetAudience",
    label: "目标人群与场景",
    pattern: /(?:目标人群与场景|目标人群|目标用户|目标受众|人群|受众|使用场景|场景)/,
  },
  { key: "coreSellingPoints", label: "核心卖点", pattern: /(?:核心卖点|卖点|主打点|主打)/ },
  { key: "targetChannels", label: "预期渠道", pattern: /(?:预期渠道|上架渠道|铺货渠道|渠道|铺货)/ },
] as const;

type IntakeKey = (typeof INTAKE_FIELDS)[number]["key"];
type IntakeDraft = Partial<Record<IntakeKey, string>>;

/**
 * 从一条消息里取出「标签：值」形式的字段。
 * 只认显式标签，不从散句里猜字段 —— 猜错会把用户的人群描述写进卖点，
 * 而这些值确认后就是产品的正式方案内容。
 */
function parseIntakeLabels(text: string): IntakeDraft {
  const draft: IntakeDraft = {};
  const segments = text.split(/[\n\r；;]+/);
  for (const segment of segments) {
    const line = segment.trim().replace(/^[-•*·]\s*/, "");
    for (const field of INTAKE_FIELDS) {
      const m = new RegExp(`^${field.pattern.source}\\s*[:：]\\s*(.+)$`).exec(line);
      if (!m) continue;
      const value = m[1]
        .trim()
        .replace(/^[「"'“”『]+/, "")
        .replace(/[」"'“”』]+$/, "")
        .replace(/[。！!，,]+$/, "")
        .trim();
      // 「名称：待定」这类占位词按没填处理：写进产品比留空更难发现。
      if (!value || /^(待定|未定|暂无|不知道|没想好|tbd|todo|\?+|？+)$/i.test(value)) continue;
      draft[field.key] = value.slice(0, 200);
      break;
    }
  }
  return draft;
}

/**
 * 按会话里用户自己说过的话累积草稿，后说的覆盖先说的。
 * 不带标签又是产品意图的那句，整句记为「一句话想法」（这是用户的原话，不是推断）；
 * 名称不从想法里生造 —— 产品叫什么必须由用户自己给。
 */
/** 求助式的说法，本身不含产品内容。把它们当成想法会让提议卡上出现一句用户没打算写进产品的话。 */
const META_REQUEST = /(帮我梳理|帮我想|怎么做|如何做|该怎么|要注意|需要什么|有什么流程|是什么意思|告诉我)/;

/**
 * 判断一句自由表述能不能当「一句话想法」。
 * 去掉意图动词后必须还剩下真正描述产品的内容 ——「帮我立项」剩不下任何东西，
 * 「我想做一款给敏感肌的氨基酸洁面」剩下的才是想法本身。
 */
function freeFormIdea(text: string): string | null {
  if (!NEW_PRODUCT_VERB.test(text)) return null;
  const trimmed = text.trim().replace(/[。！!]+$/, "");
  const remainder = trimmed.replace(NEW_PRODUCT_VERB, "").replace(/^[，,、:：\s]+/, "");
  if (remainder.length < 6) return null;
  if (META_REQUEST.test(trimmed)) return null;
  return trimmed.slice(0, 200);
}

function accumulateIntakeDraft(userTexts: string[]): IntakeDraft {
  const draft: IntakeDraft = {};
  for (const text of userTexts) {
    Object.assign(draft, parseIntakeLabels(text));
    if (!draft.coreIdea) {
      const idea = freeFormIdea(text);
      if (idea) draft.coreIdea = idea;
    }
  }
  return draft;
}

function missingIntakeFields(draft: IntakeDraft) {
  return INTAKE_FIELDS.filter((f) => !draft[f.key]);
}

function routeIntent(text: string, productBound: boolean): Intent {
  const t = text.toLowerCase();
  if (/挑战我的判断|证伪|最脆弱|哪里会失败|反方|复核/.test(t)) return "CHALLENGE_THESIS";
  if (/提议|草案|待确认|待我确认/.test(t)) return "PENDING_PROPOSALS";
  // 研发报告/进度查询必须先于通用“决策/进度”关键词：
  // “研发报告里需要我决定什么”中的“决定”不能把整句误路由到全局待决策列表。
  if (PRODUCT_RND_REPORT.test(text)) return "PRODUCT_RND_REPORT";
  if (PRODUCT_RND_STATUS.test(text)) return "PRODUCT_RND_STATUS";
  if (/决策|拍板|决定|审批/.test(t)) return "PENDING_DECISIONS";
  if (TASK_VERB.test(text) && parseWorkItemTask(text)) return "PROPOSE_CREATE_WORK_ITEM";
  if (productBound && CHANGE_VERB.test(text) && matchField(text)) return "PROPOSE_FIELD_CHANGE";
  if (isDesktopInstruction(text)) return "DESKTOP_EXECUTION";
  if (PRODUCT_RND_START.test(text)) return "START_PRODUCT_RND";
  // 新建产品只在未绑定产品的会话里接：产品会话已经锁定在某个产品上，
  // 在那里再建一个别的产品，用户无法判断自己到底在改哪一个。
  // 补齐字段的后续消息（只有「标签：值」、没有动词）也要落到这里，否则会被
  // 下面的关键词兜走，用户补了三条也看不到进度。
  if (
    !productBound &&
    (NEW_PRODUCT_VERB.test(text) || Object.keys(parseIntakeLabels(text)).length > 0)
  ) {
    return "NEW_PRODUCT_INTAKE";
  }
  if (/知识|公司|制度|政策|规则|定位|红线|禁用|规范|obsidian|背景|资料|查一下|找一下/.test(t)) return "KNOWLEDGE_SEARCH";
  if (/产品|入库|评分|上市|版本/.test(t)) return "PRODUCT_STATUS";
  if (/待办|今天|本周|进度|任务|项目/.test(t)) return "WORKSPACE_STATUS";
  return "UNSUPPORTED";
}

export interface IntentRoutingDecision {
  intent: Intent;
  source: "DETERMINISTIC" | "KERN_PLANNER" | "DETERMINISTIC_FALLBACK";
  plannerModelRunId: string | null;
  plannerError: string | null;
}

/**
 * Kern Planner 只在旧确定性路由无法识别时介入。
 *
 * 安全边界：
 * - 明确的 Desktop / Proposal 写入语义继续由 routeIntent 的确定性规则优先处理；
 * - Planner 的可选 intent 集合不包含 DESKTOP_EXECUTION / PROPOSE_*；
 * - 模型未配置、失败、输出非法时回落 UNSUPPORTED，不假装已经理解。
 */
export async function resolveIntentWithKernPlanner(
  session: SessionContext,
  input: {
    conversationId: string;
    text: string;
    productBound: boolean;
    history: { role: string; content: string }[];
  }
): Promise<IntentRoutingDecision> {
  const deterministic = routeIntent(input.text, input.productBound);
  if (deterministic !== "UNSUPPORTED") {
    return {
      intent: deterministic,
      source: "DETERMINISTIC",
      plannerModelRunId: null,
      plannerError: null,
    };
  }

  try {
    const plannerPlan = await tryResolveGatewayPolicyForAgentCode({
      organizationId: session.organizationId,
      agentCode: "hermes_pm",
      taskClass: "ASSISTANT_PLANNING",
    });
    if (
      !plannerPlan ||
      !hasEnabledPolicyCandidate({
        policy: plannerPlan.policy,
        profiles: plannerPlan.profiles,
      })
    ) {
      return {
        intent: "UNSUPPORTED",
        source: "DETERMINISTIC_FALLBACK",
        plannerModelRunId: null,
        plannerError: plannerPlan
          ? "ASSISTANT_PLANNING policy has no enabled candidate"
          : "ASSISTANT_PLANNING policy is not configured",
      };
    }

    const planned = await executePersistedModelGateway({
      organizationId: session.organizationId,
      policy: plannerPlan.policy,
      profiles: plannerPlan.profiles,
      request: {
        taskClass: "ASSISTANT_PLANNING",
        messages: buildKernPlannerMessages({
          text: input.text,
          productBound: input.productBound,
          history: input.history,
        }),
        metadata: {
          source: "kern.intent-planner",
          conversationId: input.conversationId,
          productBound: input.productBound,
        },
      },
      requestMeta: {
        source: "kern.intent-planner",
        conversationId: input.conversationId,
      },
    });

    const intent = parseKernPlannerIntent(planned.result.text);
    if (!intent) {
      return {
        intent: "UNSUPPORTED",
        source: "DETERMINISTIC_FALLBACK",
        plannerModelRunId: planned.modelRunId,
        plannerError: "Planner returned an invalid or out-of-whitelist intent",
      };
    }

    return {
      intent: intent as Intent,
      source: "KERN_PLANNER",
      plannerModelRunId: planned.modelRunId,
      plannerError: null,
    };
  } catch (error: unknown) {
    return {
      intent: "UNSUPPORTED",
      source: "DETERMINISTIC_FALLBACK",
      plannerModelRunId: null,
      plannerError:
        error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
    };
  }
}

export interface ToolContext {
  conversationId: string;
  productId: string | null;
  text: string;
}

export interface ToolResult {
  toolKey: string;
  text: string;
  citations: { kind: string; ref: string; title: string }[];
  /** 本轮是否产出了待确认提议（写入链的前半段：提议，不是执行） */
  proposal?: { proposalId: string; created: boolean; actionType: string } | null;
  /** 挑战报告（证伪式审查富消息） */
  challengeReport?: ReturnType<typeof generateChallengeReport> | null;
}



export async function runTool(session: SessionContext, intent: Intent, ctx: ToolContext): Promise<ToolResult> {
  switch (intent) {
    case "DESKTOP_EXECUTION": {
      const queued = await enqueueDesktopTask(session, {
        instruction: ctx.text,
        conversationId: ctx.conversationId,
      });
      const described = describeDesktopAction(queued.action);
      // 关键诚实点：以前这里不分在线状态，一律回「已发送到你的 Mac 执行队列」。
      // runtime 没启动时任务会永远停在 QUEUED，而用户以为 Hermes 正在执行。
      // 现在按真实连接状态分别说明，并且未连接时明确告诉用户「还不会执行」。
      const presence = readDesktopPresence({
        organizationId: session.organizationId,
        userId: session.userId,
      });
      const online = presence.status === "ONLINE";
      return {
        toolKey: "desktop.runtime",
        text: [
          online
            ? `已排入你的 Mac 执行队列，${presence.deviceId} 正在连接中，会自动领取。`
            : "已排入你的 Mac 执行队列，但现在还不会执行。",
          `动作：${described.kind} · ${described.detail}`,
          "",
          online
            ? "执行完成后，真实结果会自动回到这个对话。"
            : `${presence.label}。${presence.hint ?? ""}连接恢复后这项任务会被自动领取，结果回到这个对话。`,
        ]
          .filter((line) => line !== null)
          .join("\n"),
        citations: [
          {
            kind: "desktop-task",
            ref: queued.task.id,
            title: `本机任务：${ctx.text.slice(0, 60)}`,
          },
        ],
      };
    }
    case "START_PRODUCT_RND": {
      if (!ctx.productId) {
        return {
          toolKey: "product-rnd.start",
          text:
            "当前 Kern 会话没有绑定产品，因此没有启动研发。请先在这个会话里建立并确认产品，或从产品页进入 Kern 后再明确说“启动产品研发”。",
          citations: [],
        };
      }

      const product = await prisma.product.findFirst({
        where: {
          id: ctx.productId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          name: true,
          coreIdea: true,
          targetAudience: true,
          coreSellingPoints: true,
          targetChannels: true,
          marketPath: true,
          projects: {
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              title: true,
              stage: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!product) {
        return {
          toolKey: "product-rnd.start",
          text: "当前会话绑定的产品已不存在，因此没有启动研发。",
          citations: [],
        };
      }

      if (product.projects.length === 0) {
        return {
          toolKey: "product-rnd.start",
          text: `产品「${product.name}」还没有关联项目，因此没有启动研发。请先在产品后台建立或关联项目。`,
          citations: [{ kind: "product", ref: product.id, title: product.name }],
        };
      }

      let project = product.projects[0];
      if (product.projects.length > 1) {
        const mentioned = product.projects.filter((item) => ctx.text.includes(item.title));
        if (mentioned.length !== 1) {
          return {
            toolKey: "product-rnd.start",
            text: [
              `产品「${product.name}」关联了 ${product.projects.length} 个项目，我没有猜要在哪一个项目启动研发，因此没有执行。`,
              "请在指令里明确写出项目名称，例如“在「项目名称」启动产品研发”。",
              "",
              ...product.projects.map(
                (item, index) => `${index + 1}. ${item.title}（${item.stage}）`
              ),
            ].join("\n"),
            citations: product.projects.map((item) => ({
              kind: "project",
              ref: item.id,
              title: item.title,
            })),
          };
        }
        project = mentioned[0];
      }

      const brief = [
        `产品：${product.name}`,
        `一句话想法：${product.coreIdea || "UNKNOWN"}`,
        `目标人群：${product.targetAudience || "UNKNOWN"}`,
        `核心卖点：${product.coreSellingPoints || "UNKNOWN"}`,
        `预期渠道：${product.targetChannels || product.marketPath || "UNKNOWN"}`,
        `用户本轮指令：${ctx.text}`,
      ].join("\n");

      const started = await startProductRndProgram(session, {
        projectId: project.id,
        brief,
      });

      return {
        toolKey: "product-rnd.start",
        text: [
          started.reused
            ? "这个项目已经有一套正在推进的产品研发程序，我没有重复创建。"
            : "已启动真实 Product R&D 程序。",
          `项目：${project.title}`,
          `工作项：${started.workItem.title}`,
          `父运行状态：${started.parentRun.status}`,
          `专业分工：${started.specialistTasks.length} 个数字员工任务`,
          `ResearchRun：${started.researchRun.id}`,
          "",
          "现在只表示研发程序已真实启动/复用，不代表研发已经完成。最终结论必须等专业任务、Evidence 与独立 QA 完成后再生成 Executive Report。",
        ].join("\n"),
        citations: [
          { kind: "product", ref: product.id, title: product.name },
          { kind: "project", ref: project.id, title: project.title },
          {
            kind: "work-item",
            ref: started.workItem.id,
            title: started.workItem.title,
          },
          {
            kind: "agent-run",
            ref: started.parentRun.id,
            title: "Product R&D parent run",
          },
        ],
      };
    }
    case "PRODUCT_RND_STATUS": {
      if (!ctx.productId) {
        return {
          toolKey: "product-rnd.status",
          text:
            "当前 Kern 会话没有绑定产品，因此无法判断某个产品的研发进度。请先进入具体产品会话，或在这个会话里建立并确认产品。",
          citations: [],
        };
      }

      const product = await prisma.product.findFirst({
        where: {
          id: ctx.productId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          name: true,
          projects: {
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              title: true,
              stage: true,
              workItems: {
                where: {
                  title: "产品研发综合评估",
                  executorType: "DIGITAL_WORKER",
                },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });

      if (!product) {
        return {
          toolKey: "product-rnd.status",
          text: "当前会话绑定的产品已不存在，无法读取研发进度。",
          citations: [],
        };
      }

      if (product.projects.length === 0) {
        return {
          toolKey: "product-rnd.status",
          text: `产品「${product.name}」还没有关联项目，因此也没有 Product R&D 进度。`,
          citations: [{ kind: "product", ref: product.id, title: product.name }],
        };
      }

      const mentioned = product.projects.filter((item) => ctx.text.includes(item.title));
      const withRnd = product.projects.filter((item) => item.workItems.length > 0);

      let project:
        | (typeof product.projects)[number]
        | null = null;

      if (mentioned.length === 1) {
        project = mentioned[0];
      } else if (mentioned.length > 1) {
        project = null;
      } else if (product.projects.length === 1) {
        project = product.projects[0];
      } else if (withRnd.length === 1) {
        project = withRnd[0];
      }

      if (!project) {
        return {
          toolKey: "product-rnd.status",
          text: [
            withRnd.length > 1
              ? `产品「${product.name}」有多个项目存在 Product R&D 记录，我没有猜要看哪一个。`
              : `产品「${product.name}」关联了多个项目，我无法唯一确定要看哪一个研发进度。`,
            "请直接说项目名称，例如“「项目名称」的产品研发进度怎么样”。",
            "",
            ...product.projects.map((item, index) => {
              const latest = item.workItems[0];
              return latest
                ? `${index + 1}. ${item.title}：${labelWorkItemStatus(latest.status)}`
                : `${index + 1}. ${item.title}：尚未启动 Product R&D`;
            }),
          ].join("\n"),
          citations: product.projects.map((item) => ({
            kind: "project",
            ref: item.id,
            title: item.title,
          })),
        };
      }

      const workItem = project.workItems[0] ?? null;
      if (!workItem) {
        return {
          toolKey: "product-rnd.status",
          text: [
            `项目「${project.title}」尚未启动 Product R&D。`,
            "如果要现在开始，请明确说“启动产品研发”。",
          ].join("\n"),
          citations: [
            { kind: "product", ref: product.id, title: product.name },
            { kind: "project", ref: project.id, title: project.title },
          ],
        };
      }

      const status = await getProductRndProgramStatus(session, {
        projectId: project.id,
        workItemId: workItem.id,
      });

      const taskLines = status.tasks.length
        ? status.tasks.map(
            (task) =>
              `- ${task.agentName}：${labelAgentTaskStatus(task.status)}` +
              (task.latestRun?.errorReason
                ? `（失败原因：${task.latestRun.errorReason}）`
                : "")
          )
        : ["- 还没有专业数字员工任务记录"];

      const taskCounts = new Map<string, number>();
      for (const task of status.tasks) {
        taskCounts.set(task.status, (taskCounts.get(task.status) ?? 0) + 1);
      }
      const countSummary = [...taskCounts.entries()]
        .map(([key, value]) => `${labelAgentTaskStatus(key)} ${value}`)
        .join("、");

      const report = status.latestReport;
      const preview = report?.preview ?? null;
      const reportLine = report
        ? `Executive Report：已生成 v${report.contentVersion}（${report.reviewStatus}）`
        : "Executive Report：尚未生成";

      return {
        toolKey: "product-rnd.status",
        text: [
          `产品：${product.name}`,
          `项目：${project.title}`,
          `研发工作项：${labelWorkItemStatus(status.workItem.status)}`,
          `专业任务：${status.tasks.length} 项${countSummary ? `（${countSummary}）` : ""}`,
          reportLine,
          preview
            ? `报告当前 UNKNOWN：${(preview.unknowns ?? []).length} 项；需要负责人决定：${(preview.decisionsRequired ?? []).length} 项。`
            : "当前还不能把“已启动/正在运行”说成“研发已完成”。",
          "",
          "专业任务状态：",
          ...taskLines,
        ].join("\n"),
        citations: [
          { kind: "product", ref: product.id, title: product.name },
          { kind: "project", ref: project.id, title: project.title },
          {
            kind: "work-item",
            ref: status.workItem.id,
            title: "产品研发综合评估",
          },
          ...(report
            ? [
                {
                  kind: "artifact",
                  ref: report.id,
                  title: report.title,
                },
              ]
            : []),
        ],
      };
    }
    case "PRODUCT_RND_REPORT": {
      if (!ctx.productId) {
        return {
          toolKey: "product-rnd.report",
          text:
            "当前 Kern 会话没有绑定产品，因此无法读取某个产品的研发报告。请先进入具体产品会话。",
          citations: [],
        };
      }

      const product = await prisma.product.findFirst({
        where: {
          id: ctx.productId,
          organizationId: session.organizationId,
        },
        select: {
          id: true,
          name: true,
          projects: {
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              title: true,
              stage: true,
              workItems: {
                where: {
                  title: "产品研发综合评估",
                  executorType: "DIGITAL_WORKER",
                },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  artifacts: {
                    where: { type: "PRODUCT_RND_EXECUTIVE_REPORT" },
                    orderBy: { contentVersion: "desc" },
                    take: 1,
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!product) {
        return {
          toolKey: "product-rnd.report",
          text: "当前会话绑定的产品已不存在，无法读取研发报告。",
          citations: [],
        };
      }

      const mentioned = product.projects.filter((item) => ctx.text.includes(item.title));
      const withReport = product.projects.filter(
        (item) => (item.workItems[0]?.artifacts.length ?? 0) > 0
      );
      const withRnd = product.projects.filter((item) => item.workItems.length > 0);

      let project:
        | (typeof product.projects)[number]
        | null = null;

      if (mentioned.length === 1) {
        project = mentioned[0];
      } else if (mentioned.length > 1) {
        project = null;
      } else if (product.projects.length === 1) {
        project = product.projects[0];
      } else if (withReport.length === 1) {
        project = withReport[0];
      } else if (withReport.length === 0 && withRnd.length === 1) {
        project = withRnd[0];
      }

      if (!project) {
        return {
          toolKey: "product-rnd.report",
          text: [
            withReport.length > 1
              ? `产品「${product.name}」有多个项目已经生成研发报告，我没有猜要读哪一份。`
              : `产品「${product.name}」关联了多个项目，我无法唯一确定要读哪一个研发报告。`,
            "请直接说项目名称，例如“「项目名称」的研发报告结论是什么”。",
            "",
            ...product.projects.map((item, index) => {
              const latest = item.workItems[0];
              const hasReport = (latest?.artifacts.length ?? 0) > 0;
              return `${index + 1}. ${item.title}：${hasReport ? "已有 Executive Report" : latest ? "研发已启动，报告尚未生成" : "尚未启动 Product R&D"}`;
            }),
          ].join("\n"),
          citations: product.projects.map((item) => ({
            kind: "project",
            ref: item.id,
            title: item.title,
          })),
        };
      }

      const workItem = project.workItems[0] ?? null;
      if (!workItem) {
        return {
          toolKey: "product-rnd.report",
          text: `项目「${project.title}」尚未启动 Product R&D，因此没有 Executive Report。`,
          citations: [
            { kind: "product", ref: product.id, title: product.name },
            { kind: "project", ref: project.id, title: project.title },
          ],
        };
      }

      const status = await getProductRndProgramStatus(session, {
        projectId: project.id,
        workItemId: workItem.id,
      });
      const report = status.latestReport;
      const preview = report?.preview ?? null;

      if (!report || !preview) {
        return {
          toolKey: "product-rnd.report",
          text: [
            `项目「${project.title}」的 Product R&D 已经启动，但 Executive Report 尚未生成。`,
            `当前研发工作项：${labelWorkItemStatus(status.workItem.status)}。`,
            "我不会在正式报告生成前把中间任务输出拼成最终结论。",
          ].join("\n"),
          citations: [
            { kind: "product", ref: product.id, title: product.name },
            { kind: "project", ref: project.id, title: project.title },
            {
              kind: "work-item",
              ref: status.workItem.id,
              title: "产品研发综合评估",
            },
          ],
        };
      }

      const conclusions = preview.conclusions ?? [];
      const unknowns = preview.unknowns ?? [];
      const risks = preview.risks ?? [];
      const decisions = preview.decisionsRequired ?? [];
      const actions = preview.recommendedActions ?? [];

      const lines = [
        `产品：${product.name}`,
        `项目：${project.title}`,
        `Executive Report：v${report.contentVersion}（${report.reviewStatus}）`,
        "",
        `当前结论：${preview.summary || "报告没有提供总摘要。"}`,
        "",
        "关键依据 / 结论：",
        ...(conclusions.length
          ? conclusions.slice(0, 5).map((item, index) =>
              `${index + 1}. ${item.claim}${item.evidenceLevel ? `（证据等级 ${item.evidenceLevel}）` : ""}`
            )
          : ["- 报告没有登记可展示的结论条目"]),
        "",
        "最大风险：",
        ...(risks.length ? risks.slice(0, 5).map((item) => `- ${item}`) : ["- 未登记显式风险"]),
        "",
        "UNKNOWN：",
        ...(unknowns.length
          ? unknowns.slice(0, 5).map((item) => `- ${item}`)
          : ["- 报告未登记 UNKNOWN"]),
        "",
        "需要你决定：",
        ...(decisions.length
          ? decisions.slice(0, 5).map((item) => `- ${item}`)
          : ["- 当前报告未登记必须由负责人决定的事项"]),
        "",
        "下一步：",
        ...(actions.length ? actions.slice(0, 5).map((item) => `- ${item}`) : ["- 报告未登记建议动作"]),
      ];

      return {
        toolKey: "product-rnd.report",
        text: lines.join("\n"),
        citations: [
          { kind: "product", ref: product.id, title: product.name },
          { kind: "project", ref: project.id, title: project.title },
          {
            kind: "artifact",
            ref: report.id,
            title: report.title,
          },
        ],
      };
    }
    case "PENDING_DECISIONS": {
      const ov = await getWorkspaceOverview(session);
      const items = ov.pendingDecisions.items;
      if (items.length === 0) {
        return {
          toolKey: "workspace.pendingDecisions",
          text: `当前没有需要你拍板的决策包（统计时间 ${fmtDateTime(ov.meta.generatedAt)}）。`,
          citations: [],
        };
      }
      return {
        toolKey: "workspace.pendingDecisions",
        text: `需要你拍板的决策包共 ${items.length} 项：\n${items
          .map((i, n) => `${n + 1}. ${i.title}${i.meta ? `（${i.meta}）` : ""}`)
          .join("\n")}`,
        citations: items.map((i) => ({ kind: "decision", ref: i.id, title: i.title })),
      };
    }
    case "PRODUCT_STATUS": {
      const board = await listProductBoard(session);
      if (board.length === 0) {
        return {
          toolKey: "products.board",
          text: "当前组织内还没有产品。可以到「产品开发」新建一个产品入库。",
          citations: [],
        };
      }
      const byStage = new Map<string, number>();
      for (const p of board) byStage.set(p.lifecycleStage, (byStage.get(p.lifecycleStage) ?? 0) + 1);
      return {
        toolKey: "products.board",
        text: `组织内共 ${board.length} 个产品。生命周期分布：${[...byStage.entries()]
          .map(([k, v]) => `${k} ${v}`)
          .join("、")}。`,
        citations: board.slice(0, 10).map((p) => ({ kind: "product", ref: p.id, title: p.name })),
      };
    }
    case "WORKSPACE_STATUS": {
      const ov = await getWorkspaceOverview(session);
      return {
        toolKey: "workspace.overview",
        text: [
          `统计时间：${fmtDateTime(ov.meta.generatedAt)}`,
          `范围：${ov.meta.scopeLabel}`,
          `待办 ${ov.todos.count} 项；待我决策 ${ov.pendingDecisions.count} 项；在推进产品 ${ov.productsInFlight.count} 个；风险阻塞 ${ov.blockers.count} 项。`,
          ov.blockers.count > 0
            ? `阻塞示例：${ov.blockers.items.slice(0, 3).map((b) => b.title).join("；")}`
            : "当前未发现阻塞项。",
        ].join("\n"),
        citations: ov.pendingDecisions.items.map((i) => ({ kind: "decision", ref: i.id, title: i.title })),
      };
    }
    case "PENDING_PROPOSALS": {
      // 顺手作废"依据版本已失效"的提议，避免用户点到必然失败的按钮
      if (ctx.productId) await supersedeStaleProposals(session, ctx.productId);
      const items = await listProposals(session, {
        conversationId: ctx.conversationId,
        status: "PENDING_CONFIRMATION",
      });
      if (items.length === 0) {
        return {
          toolKey: "advisor.pendingProposals",
          text: "当前会话没有待确认的提议。",
          citations: [],
        };
      }
      return {
        toolKey: "advisor.pendingProposals",
        text: `待你确认的提议共 ${items.length} 条：\n${items
          .map((p, n) => `${n + 1}. ${p.actionLabel}`)
          .join("\n")}\n确认后才会写入业务数据；未确认前数据库里只有提议本身。`,
        citations: items.map((p) => ({ kind: "proposal", ref: p.id, title: p.actionLabel })),
      };
    }
    case "PROPOSE_FIELD_CHANGE": {
      const parsed = parseFieldChange(ctx.text);
      const whitelist = ADVISOR_FIELD_WHITELIST.map((f) => ADVISOR_FIELD_LABELS[f]).join("、");

      if (!parsed) {
        return {
          toolKey: "advisor.proposeFieldChange",
          text:
            "没听懂要改哪个字段，因此没有生成任何提议。\n" +
            `可以这样说：「把目标人群改成 25-35 岁办公室人群」「价格预期改为 39.9 元/盒」。\n` +
            `当前可改字段：${whitelist}。（目标成本、证据、审批与上市日期不在对话改写范围内）`,
          citations: [],
        };
      }
      if (!ctx.productId) {
        return {
          toolKey: "advisor.proposeFieldChange",
          text:
            "当前会话没有绑定产品，无法生成方案字段修改提议。\n" +
            "请从产品页的「AI 顾问」入口进入后再提出修改，这样提议才能绑定到具体产品与版本。",
          citations: [],
        };
      }

      const created = await createProposal(session, {
        actionType: "UPDATE_FIELD",
        payload: { productId: ctx.productId, field: parsed.field, value: parsed.value },
        productId: ctx.productId,
        conversationId: ctx.conversationId,
        rationale: `来自对话指令：「${ctx.text.slice(0, 120)}」`,
      });

      return {
        toolKey: "advisor.proposeFieldChange",
        text: [
          `已生成 1 条待确认提议：把「${ADVISOR_FIELD_LABELS[parsed.field]}」改为「${parsed.value}」。`,
          created.created ? "" : "（命中幂等：这条提议此前已生成，未重复创建）",
          "",
          "未确认前不会写入数据库。请在下方提议卡片点「确认并应用」；",
          "确认时服务端会重新做权限与版本检查，若产品已产生更新版本，该提议会被作废并提示重新生成。",
        ]
          .filter((x) => x !== "")
          .join("\n"),
        citations: [
          { kind: "proposal", ref: created.proposalId, title: `修改${ADVISOR_FIELD_LABELS[parsed.field]}` },
        ],
        proposal: { proposalId: created.proposalId, created: created.created, actionType: "UPDATE_FIELD" },
      };
    }
    case "NEW_PRODUCT_INTAKE": {
      // 当前这句在 sendMessage 里已经先落库，所以按会话历史取就够，不必另外拼上 ctx.text。
      const history = await prisma.message.findMany({
        where: { conversationId: ctx.conversationId, role: "USER" },
        orderBy: { createdAt: "asc" },
        select: { content: true },
        take: 100,
      });
      const draft = accumulateIntakeDraft(history.map((m) => m.content));
      const missing = missingIntakeFields(draft);
      const captured = INTAKE_FIELDS.filter((f) => draft[f.key]);

      if (missing.length > 0) {
        return {
          toolKey: "advisor.proposeProduct",
          text: [
            captured.length > 0
              ? `已记下：\n${captured.map((f) => `- ${f.label}：${draft[f.key]}`).join("\n")}`
              : "还没有能用来建产品的内容。",
            "",
            `入库还缺 ${missing.length} 项：${missing.map((f) => f.label).join("、")}。`,
            "把缺的几行补上就行（一条消息里给全，或者分几条都可以）：",
            "",
            missing.map((f) => `${f.label}：`).join("\n"),
            "",
            "补齐后我会生成一条待确认的新建产品提议，确认之前不会写入任何数据。",
          ].join("\n"),
          citations: [],
        };
      }

      const created = await createProposal(session, {
        actionType: "CREATE_PRODUCT",
        payload: {
          name: draft.name,
          coreIdea: draft.coreIdea,
          targetAudience: draft.targetAudience,
          coreSellingPoints: draft.coreSellingPoints,
          targetChannels: draft.targetChannels,
        },
        conversationId: ctx.conversationId,
        // 幂等键按会话 + 内容指纹：同一套字段重复说一次不再多生成一条提议，
        // 但用户改了任何一项就是一份新方案，应当另生成一条。
        idempotencyKey: `advisor-product:${ctx.conversationId}:${crypto
          .createHash("sha256")
          .update(INTAKE_FIELDS.map((f) => `${f.key}=${draft[f.key]}`).join("|"))
          .digest("hex")
          .slice(0, 16)}`,
        rationale: `来自本会话对话内容整理，五项均为用户原话`,
      });

      return {
        toolKey: "advisor.proposeProduct",
        text: [
          `已整理出一条**待确认**的新建产品提议：「${draft.name}」。`,
          "",
          INTAKE_FIELDS.map((f) => `- ${f.label}：${draft[f.key]}`).join("\n"),
          "",
          created.created ? "" : "（命中幂等：同样内容的提议此前已生成，未重复创建）",
          "确认之后会一次建好产品、初始版本 v1 和对应项目；在此之前不写入任何业务数据。",
          "价格、目标成本、剂型规格、禁用项这些没提到的，会如实记为未知，不会替你编一个数。",
        ]
          .filter((x) => x !== "")
          .join("\n"),
        citations: [
          { kind: "proposal", ref: created.proposalId, title: `新建产品: ${draft.name}` },
        ],
        proposal: {
          proposalId: created.proposalId,
          created: created.created,
          actionType: "CREATE_PRODUCT",
        },
      };
    }
    case "PROPOSE_CREATE_WORK_ITEM": {
      const parsedTask = parseWorkItemTask(ctx.text);
      if (!parsedTask) {
        return {
          toolKey: "advisor.proposeWorkItem",
          text: "未能解析出任务名称，未生成提议。可以这样说：「创建任务 安排打样原料备料」「记个待办 确认下周供应商排期」。",
          citations: [],
        };
      }

      let targetProjectId: string | null = null;
      const candidates = await prisma.project.findMany({
        where: {
          organizationId: session.organizationId,
          ...(ctx.productId ? { productId: ctx.productId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { id: true, title: true },
      });

      if (candidates.length === 1) {
        targetProjectId = candidates[0].id;
      } else if (candidates.length > 1) {
        const mentioned = candidates.filter((project) =>
          ctx.text.includes(project.title)
        );
        if (mentioned.length === 1) {
          targetProjectId = mentioned[0].id;
        } else {
          return {
            toolKey: "advisor.proposeWorkItem",
            text: [
              "这个任务可以直接创建，但当前有多个可能的项目，我不替你猜。",
              "请只补一个项目名，例如：",
              `“在「${candidates[0].title}」创建任务 ${parsedTask.title}”`,
            ].join("\n"),
            citations: candidates.slice(0, 5).map((project) => ({
              kind: "project",
              ref: project.id,
              title: project.title,
            })),
          };
        }
      }

      if (!targetProjectId) {
        return {
          toolKey: "advisor.proposeWorkItem",
          text: "当前没有可关联的项目，所以这次没有创建工作项。先建立一个项目后，我可以直接继续。",
          citations: [],
        };
      }

      const created = await createProposal(session, {
        actionType: "CREATE_WORK_ITEM",
        payload: {
          projectId: targetProjectId,
          title: parsedTask.title,
          target: parsedTask.title,
          deliverableReq: "完成工作项交付物归档与负责人验收",
          description: `来自顾问对话指令：「${ctx.text.slice(0, 120)}」`,
        },
        productId: ctx.productId,
        conversationId: ctx.conversationId,
        rationale: `来自对话指令：「${ctx.text.slice(0, 120)}」`,
      });

      return {
        toolKey: "advisor.proposeWorkItem",
        text: [
          `已生成 1 条**待确认**任务提议：「${parsedTask.title}」。`,
          created.created ? "" : "（命中幂等：该任务提议此前已生成，未重复创建）",
          "",
          "未确认前不会写入数据库任务系统。请在下方提议卡片点击「确认并应用」以真正创建工作项。",
        ]
          .filter((x) => x !== "")
          .join("\n"),
        citations: [
          { kind: "proposal", ref: created.proposalId, title: `创建工作项: ${parsedTask.title}` },
        ],
        proposal: { proposalId: created.proposalId, created: created.created, actionType: "CREATE_WORK_ITEM" },
      };
    }
    case "CHALLENGE_THESIS": {
      if (!ctx.productId) {
        return {
          toolKey: "advisor.challenge",
          text: "当前会话未绑定产品，无法生成挑战报告。请从产品页的「AI 顾问」入口进入，或先绑定一个产品。",
          citations: [],
        };
      }

      const product = await prisma.product.findUnique({
        where: { id: ctx.productId },
        select: {
          id: true,
          name: true,
          identityCode: true,
          coreIdea: true,
          coreSellingPoints: true,
          formSpec: true,
          targetAudience: true,
        },
      });
      if (!product) {
        return {
          toolKey: "advisor.challenge",
          text: "未找到绑定的产品，无法生成挑战报告。",
          citations: [],
        };
      }

      // 从知识库同步的原料卡中解析科学证据（hermes-brain/30-science/ingredients/*.md）
      const ingredientDocs = await prisma.knowledgeDocument.findMany({
        where: {
          organizationId: session.organizationId,
          relativePath: { startsWith: "30-science/ingredients/" },
          deletedAt: null,
        },
        select: { title: true, frontmatter: true, relativePath: true },
      });

      const allIngredients: ScientificEvidenceInput[] = [];
      for (const doc of ingredientDocs) {
        const fm = doc.frontmatter as Record<string, string> | null;
        if (!fm) continue;
        const parsed = parseIngredientFrontmatter(fm, doc.relativePath.split("/").pop() || doc.title);
        if (parsed) allIngredients.push(parsed);
      }

      // 原料相关性匹配：产品名 + 用户消息 + 产品规格字段（核心概念/卖点/剂型规格/目标人群）。
      // 规格字段是成分信息的主要落点（如核心卖点写「含 AKG 与骆驼奶」），只看产品名会漏配。
      // 诚实口径：无关原料不得塞入报告，缺口保持未知而非掩盖。
      const productText = [
        product.name,
        ctx.text,
        product.coreIdea,
        product.coreSellingPoints,
        product.formSpec,
        product.targetAudience,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchedIngredients = matchRelevantIngredients(allIngredients, productText);

      // 宣称解析：只取「挑战我的判断：」后的明确宣称，疑问句/空内容不当作宣称
      // 正则用懒惰匹配到「哪里/最/？/。/结尾」，但需排除「这个产品假设」这类无意义前缀
      const claimMatch = ctx.text.match(/挑战我的判断[:：]\s*(.+?)(?:哪里|最|？|。|$)/);
      const rawClaim = claimMatch?.[1]?.trim();
      // 若提取结果为空、过短、以疑问词开头、或只是「这个产品假设」等无意义前缀，则回退到产品名
      const isMeaningless = !rawClaim || rawClaim.length < 2 || /^(哪里|如何|是否|为什么|这个产品|该)/.test(rawClaim);
      const proposedClaim = isMeaningless ? product.name : rawClaim!;

      const report = generateChallengeReport({
        productName: product.name,
        proposedClaim,
        ingredients: matchedIngredients,
        advisorVerdict: null,
        evidenceScope: {
          considered: allIngredients.length,
          matched: matchedIngredients.length,
          ingredientNames: matchedIngredients.map((i) => i.ingredient),
          note:
            matchedIngredients.length > 0
              ? `从 ${allIngredients.length} 张原料卡中匹配到 ${matchedIngredients.length} 张相关卡（匹配范围：产品名、宣称与产品规格字段）。`
              : `知识库共 ${allIngredients.length} 张原料卡，但与产品「${product.name}」的名称、宣称及规格字段均无匹配，科学证据维度无依据。`,
        },
      });

      return {
        toolKey: "advisor.challenge",
        text: `已完成对「${product.name}」的证伪式审查。`,
        citations: [{ kind: "challenge", ref: product.id, title: `挑战报告：${product.name}` }],
        challengeReport: report,
      };
    }
    case "KNOWLEDGE_SEARCH": {
      const searchResult = await searchKnowledge(session, { query: ctx.text, limit: 5 });
      const facts = searchResult.facts;
      const citations = searchResult.citations;

      if (facts.length === 0 && citations.length === 0) {
        return {
          toolKey: "knowledge.search",
          text: `在公司知识库中未检索到与「${ctx.text}」相关的事实或已索引文档。当前已接入知识库尚未录入此项规则或内容（知识缺口）。`,
          citations: [],
        };
      }

      const parts: string[] = [];
      if (facts.length > 0) {
        parts.push("【公司已确认事实依据】:\n" + facts.map((f, i) => `${i + 1}. [${f.category}] ${f.label}: ${f.value}`).join("\n"));
      }
      if (citations.length > 0) {
        parts.push("【相关知识文档切片引用】:\n" + citations.map((c, i) => `${i + 1}. ${c.headingPath || c.docTitle}（来源: ${c.relativePath}）：\n   "${c.snippet}"`).join("\n"));
      }

      return {
        toolKey: "knowledge.search",
        text: parts.join("\n\n"),
        citations: citations.map((c) => ({
          kind: "knowledge",
          ref: c.ref,
          title: `${c.docTitle}${c.headingPath ? ` > ${c.headingPath}` : ""}`,
        })),
      };
    }
    default: {
      const searchResult = await searchKnowledge(session, { query: ctx.text, limit: 3 });
      if (searchResult.facts.length > 0 || searchResult.citations.length > 0) {
        const parts: string[] = [];
        if (searchResult.facts.length > 0) {
          parts.push("【相关公司事实】:\n" + searchResult.facts.map((f, i) => `${i + 1}. ${f.label}: ${f.value}`).join("\n"));
        }
        if (searchResult.citations.length > 0) {
          parts.push("【参考知识切片】:\n" + searchResult.citations.map((c, i) => `${i + 1}. ${c.headingPath || c.docTitle}：${c.snippet}`).join("\n"));
        }
        return {
          toolKey: "knowledge.search",
          text: parts.join("\n\n"),
          citations: searchResult.citations.map((c) => ({
            kind: "knowledge",
            ref: c.ref,
            title: c.docTitle,
          })),
        };
      }

      return {
        toolKey: "none",
        text:
          "当前尚未接入语言模型，我只能回答与项目、产品、决策状态及公司知识库相关的结构化问题。\n" +
          "可以试着问：「本周哪些项目需要我决定」「组织里产品推进到什么阶段了」「公司有哪些渠道政策」「查一下禁用成分」。\n" +
          "要开一个新产品，直接说想做什么就行，例如「我想做一款给敏感肌的氨基酸洁面」——我会问齐入库要的几项，生成待确认提议。\n" +
          (ctx.productId
            ? "也可以直接让我改方案字段，例如「把目标人群改成 25-35 岁办公室人群」——我会生成待确认提议，确认后才写入。"
            : "要修改产品方案字段，请从产品页的「AI 顾问」入口进入，让我绑定到具体产品。"),
        citations: [],
      };
    }
  }
}

export function advisorModelRouteForIntent(intent: Intent): {
  agentCode: string;
  taskClass: ModelTaskClass;
} {
  if (intent === "CHALLENGE_THESIS") {
    return { agentCode: "red_team", taskClass: "RED_TEAM" };
  }
  if (intent === "KNOWLEDGE_SEARCH") {
    return { agentCode: "research_agent", taskClass: "QUICK_RESEARCH" };
  }
  if (
    intent === "PROPOSE_FIELD_CHANGE" ||
    intent === "PROPOSE_CREATE_WORK_ITEM" ||
    intent === "NEW_PRODUCT_INTAKE"
  ) {
    return { agentCode: "hermes_pm", taskClass: "QUICK_CLASSIFY" };
  }
  return { agentCode: "hermes_pm", taskClass: "ASSISTANT_DIALOGUE" };
}

export async function sendMessage(
  session: SessionContext,
  conversationId: string,
  content: string,
  options?: { runId?: string }
) {
  const text = content?.trim();
  if (!text) throw new UnprocessableEntityError("消息内容不能为空");

  const convo = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!convo || convo.organizationId !== session.organizationId || convo.ownerId !== session.userId) {
    throw new NotFoundError("Conversation not found");
  }

  const plannerHistoryRows = await prisma.message.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { role: true, content: true },
  });
  const intentRouting = await resolveIntentWithKernPlanner(session, {
    conversationId,
    text,
    productBound: Boolean(convo.productId),
    history: plannerHistoryRows.reverse(),
  });
  const intent = intentRouting.intent;
  const modelRoute = advisorModelRouteForIntent(intent);
  const startedAt = new Date();

  let gatewayPlan: Awaited<ReturnType<typeof tryResolveGatewayPolicyForAgentCode>> = null;
  let gatewayResolutionError: string | null = null;
  try {
    gatewayPlan = await tryResolveGatewayPolicyForAgentCode({
      organizationId: session.organizationId,
      agentCode: modelRoute.agentCode,
      taskClass: modelRoute.taskClass,
    });
  } catch (error: unknown) {
    gatewayResolutionError = error instanceof Error ? error.message : String(error);
  }

  const gatewayReady =
    !!gatewayPlan &&
    hasEnabledPolicyCandidate({
      policy: gatewayPlan.policy,
      profiles: gatewayPlan.profiles,
    });

  // Compatibility bridge: legacy Advisor env may run only when no Model Control
  // binding exists. Once a binding exists, it is authoritative and must not be
  // bypassed by a hidden legacy model.
  const legacyEnabled = !gatewayPlan && !gatewayResolutionError && isAdvisorLLMEnabled();
  const modelPlanned = gatewayReady || legacyEnabled;

  const toolWhitelist = [
    "workspace.overview",
    "workspace.pendingDecisions",
    "products.board",
    "advisor.pendingProposals",
    "advisor.proposeFieldChange",
    "advisor.proposeWorkItem",
    "advisor.proposeProduct",
    "advisor.challenge",
    "knowledge.search",
    "desktop.runtime",
    "product-rnd.start",
    "product-rnd.status",
    "product-rnd.report",
  ];

  let run;
  if (options?.runId) {
    const { claimRun } = await import("./runs");
    await claimRun({ session, runId: options.runId });

    run = await prisma.agentRun.findUnique({ where: { id: options.runId } });
    if (!run) throw new NotFoundError("AgentRun not found");

    run = await prisma.agentRun.update({
      where: { id: options.runId },
      data: {
        conversationId,
        agentId: gatewayPlan?.agent.id || null,
        goal: text.slice(0, 200),
        runMode: modelPlanned ? RunMode.LLM : RunMode.TEST_STUB,
        provider: null,
        modelId: null,
        promptTemplateVersion: modelPlanned
          ? ADVISOR_LLM_SYSTEM_PROMPT_VERSION
          : "deterministic-tools/v1",
        toolWhitelist,
        contextSnapshot: {
          capturedAt: startedAt.toISOString(),
          organizationId: session.organizationId,
          permissionScope: "own organization only",
          llmEnabled: modelPlanned,
          modelBackend: gatewayReady
            ? "MODEL_GATEWAY"
            : legacyEnabled
              ? "LEGACY_ADVISOR_LLM"
              : "DETERMINISTIC_TOOL",
          modelTaskClass: modelRoute.taskClass,
          modelAgentCode: modelRoute.agentCode,
          modelPolicyKey: gatewayPlan?.policy.id || null,
          gatewayResolutionError,
          intentRouting: {
            source: intentRouting.source,
            intent: intentRouting.intent,
            plannerModelRunId: intentRouting.plannerModelRunId,
            plannerError: intentRouting.plannerError,
          },
        },
      },
    });
  } else {
    run = await prisma.agentRun.create({
      data: {
        organizationId: session.organizationId,
        conversationId,
        userId: session.userId,
        agentId: gatewayPlan?.agent.id || null,
        goal: text.slice(0, 200),
        status: "RUNNING",
        runMode: modelPlanned ? RunMode.LLM : RunMode.TEST_STUB,
        provider: null,
        modelId: null,
        promptTemplateVersion: modelPlanned
          ? ADVISOR_LLM_SYSTEM_PROMPT_VERSION
          : "deterministic-tools/v1",
        toolWhitelist,
        contextSnapshot: {
          capturedAt: startedAt.toISOString(),
          organizationId: session.organizationId,
          permissionScope: "own organization only",
          llmEnabled: modelPlanned,
          modelBackend: gatewayReady
            ? "MODEL_GATEWAY"
            : legacyEnabled
              ? "LEGACY_ADVISOR_LLM"
              : "DETERMINISTIC_TOOL",
          modelTaskClass: modelRoute.taskClass,
          modelAgentCode: modelRoute.agentCode,
          modelPolicyKey: gatewayPlan?.policy.id || null,
          gatewayResolutionError,
          intentRouting: {
            source: intentRouting.source,
            intent: intentRouting.intent,
            plannerModelRunId: intentRouting.plannerModelRunId,
            plannerError: intentRouting.plannerError,
          },
        },
        startedAt,
        costStatus: "unknown",
      },
    });
  }

  const ctx: ToolContext = { conversationId, productId: convo.productId ?? null, text };

  let historyTurns = 0;
  let conversationHistory: { role: string; content: string }[] = [];
  try {
    const historyRows = await prisma.message.findMany({
      where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    conversationHistory = historyRows.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    historyTurns = conversationHistory.length;
  } catch {
    conversationHistory = [];
  }

  await prisma.message.create({
    data: { conversationId, role: "USER", content: text, runId: run.id },
  });

  let result: ToolResult;
  let failed = false;
  let errorReason: string | null = gatewayResolutionError
    ? `Model Gateway 配置解析失败，已使用确定性工具：${gatewayResolutionError}`
    : null;
  let llmUsage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null = null;
  let llmModelId: string | null = null;
  let actualProvider: string | null = null;
  let modelRunId: string | null = null;
  let llmAttempted = false;
  let modelOutputUsed = false;
  let executionBackend: "MODEL_GATEWAY" | "LEGACY_ADVISOR_LLM" | "DETERMINISTIC_TOOL" =
    "DETERMINISTIC_TOOL";

  try {
    result = await runTool(session, intent, ctx);
    result = await applyExplicitChatProposal(session, {
      intent,
      runId: run.id,
      result,
    });

    const baseMessages = buildAdvisorLLMMessages({
      history: conversationHistory,
      currentQuery: text,
      toolKey: result.toolKey,
      toolResultText: result.text,
    });
    // 专属助理人格：只对 ASSISTANT_* TaskClass 生效，且只在 Model Gateway 路径使用。
    // 其它 TaskClass（分类 / 研究 / 产品分析 / 红队）以及旧 Advisor 兼容路径继续沿用
    // 既有 prompt，不改变已验证的行为。
    const assistantPersona = buildDepartmentAssistantSystemPrompt(
      modelRoute.taskClass
    );

    if (gatewayReady && gatewayPlan) {
      llmAttempted = true;
      executionBackend = "MODEL_GATEWAY";
      const llmMessages: AdvisorLLMMessage[] = assistantPersona
        ? [
            { role: "system", content: assistantPersona },
            ...baseMessages.slice(1),
          ]
        : baseMessages;
      try {
        const gatewayExecution = await executePersistedModelGateway({
          organizationId: session.organizationId,
          agentRunId: run.id,
          policy: gatewayPlan.policy,
          profiles: gatewayPlan.profiles,
          request: {
            taskClass: modelRoute.taskClass,
            messages: llmMessages,
            metadata: {
              source: "advisor",
              conversationId,
              intent,
            },
          },
          requestMeta: {
            source: "advisor",
            intent,
            historyTurns,
          },
        });

        modelRunId = gatewayExecution.modelRunId;
        const gatewayResult = gatewayExecution.result;
        result = { ...result, text: gatewayResult.text };
        modelOutputUsed = true;
        llmModelId = gatewayResult.resolvedModelId;
        actualProvider = gatewayResult.provider;
        llmUsage = gatewayResult.usage
          ? {
              promptTokens: gatewayResult.usage.inputTokens,
              completionTokens: gatewayResult.usage.outputTokens,
              totalTokens: gatewayResult.usage.totalTokens,
            }
          : null;
      } catch (modelError: unknown) {
        errorReason =
          "Model Gateway 调用失败已回落工具原文：" +
          (modelError instanceof Error ? modelError.message : String(modelError));
      }
    } else if (legacyEnabled) {
      const llmClient = createAdvisorLLMClient();
      llmAttempted = !!llmClient;
      executionBackend = llmClient ? "LEGACY_ADVISOR_LLM" : "DETERMINISTIC_TOOL";
      if (llmClient) {
        actualProvider = process.env.ADVISOR_MODEL_PROVIDER?.trim() || "openai-compatible";
        try {
          const llmResult = await llmClient.chat(baseMessages);
          result = { ...result, text: llmResult.text };
          modelOutputUsed = true;
          llmUsage = llmResult.usage;
          llmModelId = llmResult.modelId;
        } catch (llmErr: unknown) {
          errorReason =
            "LLM 润色失败已回落工具原文：" +
            (llmErr instanceof Error ? llmErr.message : String(llmErr));
        }
      }
    }
  } catch (error: unknown) {
    failed = true;
    errorReason = error instanceof Error ? error.message : "工具执行失败";
    result = {
      toolKey: "none",
      text: `执行失败：${errorReason}`,
      citations: [],
    };
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await prisma.toolCall.create({
    data: {
      runId: run.id,
      toolKey: result.toolKey,
      inputJson: { intent, query: text } as any,
      resultJson: {
        text: result.text,
        ...(result.proposal ? { proposal: result.proposal } : {}),
      } as any,
      status: failed ? "FAILED" : "SUCCEEDED",
      errorReason,
      startedAt,
      finishedAt,
      durationMs,
    },
  });

  if (result.proposal?.proposalId) {
    await prisma.actionProposal.update({
      where: { id: result.proposal.proposalId },
      data: { runId: run.id },
    });
  }

  const header = modelOutputUsed
    ? ""
    : llmAttempted
      ? "（模型调用失败，本轮已安全回落到确定性工具结果）\n\n"
      : gatewayPlan && !gatewayReady
        ? "（模型策略已配置但暂无启用的候选 Profile，本轮使用确定性工具结果）\n\n"
        : "（本轮未接入语言模型，以下为按白名单工具查得的真实数据）\n\n";

  const citationsWithReport: any[] = result.challengeReport
    ? [
        {
          kind: "challenge-report",
          ref: ctx.productId,
          title: "挑战报告",
          report: result.challengeReport,
        },
      ]
    : result.citations;

  const assistantMsg = await prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: header + result.text,
      runId: run.id,
      citations: citationsWithReport as any,
    },
  });

  const usageJson = llmUsage
    ? {
        promptTokens: llmUsage.promptTokens,
        completionTokens: llmUsage.completionTokens,
        totalTokens: llmUsage.totalTokens,
        modelId: llmModelId,
        historyTurns,
        backend: executionBackend,
        modelRunId,
        policyKey: gatewayPlan?.policy.id || null,
      }
    : llmAttempted
      ? {
          note: "模型已调用，但 provider 未返回 usage 或调用失败",
          modelId: llmModelId,
          historyTurns,
          backend: executionBackend,
          modelRunId,
          policyKey: gatewayPlan?.policy.id || null,
        }
      : {
          note: "未接入模型，无 token 计量",
          historyTurns,
          backend: executionBackend,
          policyKey: gatewayPlan?.policy.id || null,
        };

  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: failed ? "FAILED" : "SUCCEEDED",
      runMode: llmAttempted ? RunMode.LLM : RunMode.TEST_STUB,
      provider: actualProvider,
      modelId: llmModelId,
      finishedAt,
      durationMs,
      outputMessageId: assistantMsg.id,
      errorReason,
      usageJson: usageJson as any,
      costStatus: "unknown",
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: finishedAt,
      ...(convo.title === "新对话" ? { title: text.slice(0, 24) } : {}),
    },
  });

  return {
    runId: run.id,
    message: assistantMsg,
    proposal: result.proposal ?? null,
    modelRunId,
  };
}
