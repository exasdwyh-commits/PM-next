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
} from "./llm";
import type { ScientificEvidenceInput } from "../research/scientific-evidence";
import { tryResolveGatewayPolicyForAgentCode } from "@/modules/model-control/service";
import {
  executePersistedModelGateway,
  hasEnabledPolicyCandidate,
  type ModelTaskClass,
} from "@/modules/model-gateway";

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

type Intent =
  | "WORKSPACE_STATUS"
  | "PENDING_DECISIONS"
  | "PRODUCT_STATUS"
  | "PENDING_PROPOSALS"
  | "PROPOSE_FIELD_CHANGE"
  | "PROPOSE_CREATE_WORK_ITEM"
  | "KNOWLEDGE_SEARCH"
  | "CHALLENGE_THESIS"
  | "UNSUPPORTED";

const TASK_VERB = /(?:创建任务|建立任务|安排任务|记个待办|生成任务|推进任务|新建任务|创建工作项|生成工作项)/;

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

function routeIntent(text: string, productBound: boolean): Intent {
  const t = text.toLowerCase();
  if (/挑战我的判断|证伪|最脆弱|哪里会失败|反方|复核/.test(t)) return "CHALLENGE_THESIS";
  if (/提议|草案|待确认|待我确认/.test(t)) return "PENDING_PROPOSALS";
  if (/决策|拍板|决定|审批/.test(t)) return "PENDING_DECISIONS";
  if (TASK_VERB.test(text) && parseWorkItemTask(text)) return "PROPOSE_CREATE_WORK_ITEM";
  if (productBound && CHANGE_VERB.test(text) && matchField(text)) return "PROPOSE_FIELD_CHANGE";
  if (/知识|公司|制度|政策|规则|定位|红线|禁用|规范|obsidian|背景|资料|查一下|找一下/.test(t)) return "KNOWLEDGE_SEARCH";
  if (/产品|入库|评分|上市|版本/.test(t)) return "PRODUCT_STATUS";
  if (/待办|今天|本周|进度|任务|项目/.test(t)) return "WORKSPACE_STATUS";
  return "UNSUPPORTED";
}

interface ToolContext {
  conversationId: string;
  productId: string | null;
  text: string;
}

interface ToolResult {
  toolKey: string;
  text: string;
  citations: { kind: string; ref: string; title: string }[];
  /** 本轮是否产出了待确认提议（写入链的前半段：提议，不是执行） */
  proposal?: { proposalId: string; created: boolean; actionType: string } | null;
  /** 挑战报告（证伪式审查富消息） */
  challengeReport?: ReturnType<typeof generateChallengeReport> | null;
}

async function runTool(session: SessionContext, intent: Intent, ctx: ToolContext): Promise<ToolResult> {
  switch (intent) {
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
      if (ctx.productId) {
        const proj = await prisma.project.findFirst({
          where: { productId: ctx.productId, organizationId: session.organizationId },
          select: { id: true },
        });
        targetProjectId = proj?.id ?? null;
      }
      if (!targetProjectId) {
        const anyProj = await prisma.project.findFirst({
          where: { organizationId: session.organizationId },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });
        targetProjectId = anyProj?.id ?? null;
      }

      if (!targetProjectId) {
        return {
          toolKey: "advisor.proposeWorkItem",
          text: "当前组织内暂无任何项目，无法关联工作项。请先在产品或项目模块建立一个项目。",
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
          (ctx.productId
            ? "也可以直接让我改方案字段，例如「把目标人群改成 25-35 岁办公室人群」——我会生成待确认提议，确认后才写入。"
            : "要修改产品方案字段，请从产品页的「AI 顾问」入口进入，让我绑定到具体产品。"),
        citations: [],
      };
    }
  }
}

function advisorModelRouteForIntent(intent: Intent): {
  agentCode: string;
  taskClass: ModelTaskClass;
} {
  if (intent === "CHALLENGE_THESIS") {
    return { agentCode: "red_team", taskClass: "RED_TEAM" };
  }
  if (intent === "KNOWLEDGE_SEARCH") {
    return { agentCode: "research_agent", taskClass: "QUICK_RESEARCH" };
  }
  if (intent === "PROPOSE_FIELD_CHANGE" || intent === "PROPOSE_CREATE_WORK_ITEM") {
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

  const intent = routeIntent(text, !!convo.productId);
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
    "advisor.challenge",
    "knowledge.search",
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

    const llmMessages = buildAdvisorLLMMessages({
      history: conversationHistory,
      currentQuery: text,
      toolKey: result.toolKey,
      toolResultText: result.text,
    });

    if (gatewayReady && gatewayPlan) {
      llmAttempted = true;
      executionBackend = "MODEL_GATEWAY";
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
          const llmResult = await llmClient.chat(llmMessages);
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
