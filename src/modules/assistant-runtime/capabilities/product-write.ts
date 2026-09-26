import crypto from "crypto";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import type { ProductSpecField } from "@/modules/product-development/revision";
import {
  ADVISOR_FIELD_LABELS,
  ADVISOR_FIELD_WHITELIST,
  createProposal,
  listProposals,
  supersedeStaleProposals,
} from "@/modules/advisor/proposals";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

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


export const handleProductWriteCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
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

    default:
      return null;
  }
};
