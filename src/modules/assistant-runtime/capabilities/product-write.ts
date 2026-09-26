import crypto from "crypto";
import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
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

import {
  INTAKE_FIELDS,
  accumulateIntakeDraft,
  missingIntakeFields,
  parseFieldChange,
  parseWorkItemTask,
} from "../intent-grammar";

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
          text: "当前会话没有需要人工确认的受保护变更。",
          citations: [],
        };
      }
      return {
        toolKey: "advisor.pendingProposals",
        text: `待你确认的提议共 ${items.length} 条：\n${items
          .map((p, n) => `${n + 1}. ${p.actionLabel}`)
          .join("\n")}\n这些都是命中人工 Gate 的受保护变更；批准后才会写入业务数据。`,
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
            "请从产品页进入 Kern 后再提出修改，这样操作才能绑定到具体产品与版本。",
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
          `已生成受治理变更：把「${ADVISOR_FIELD_LABELS[parsed.field]}」改为「${parsed.value}」。`,
          created.created ? "" : "（命中幂等：这条提议此前已生成，未重复创建）",
          "",
          "Kern 会按风险策略决定直接应用还是进入人工 Gate；",
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
            "补齐后我会生成受治理的新建产品动作；低风险内部动作直接执行，命中受保护 Gate 才会再问你。",
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
          `已整理出一条受治理的新建产品动作：「${draft.name}」。`,
          "",
          INTAKE_FIELDS.map((f) => `- ${f.label}：${draft[f.key]}`).join("\n"),
          "",
          created.created ? "" : "（命中幂等：同样内容的提议此前已生成，未重复创建）",
          "通过风险策略后会一次建好产品、初始版本 v1 和对应项目；只有受保护动作才停在人工 Gate。",
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
          `已生成受治理工作项动作：「${parsedTask.title}」。`,
          created.created ? "" : "（命中幂等：该任务提议此前已生成，未重复创建）",
          "",
          "Kern 会按风险策略直接创建低风险内部工作项；只有命中受保护 Gate 才会要求确认。",
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
