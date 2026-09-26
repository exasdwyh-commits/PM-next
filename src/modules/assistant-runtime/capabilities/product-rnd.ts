import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { getProductRndProgramStatus, startProductRndProgram } from "@/modules/product-rnd";
import { labelAgentTaskStatus, labelWorkItemStatus } from "@/shared/status-labels";
import type {
  KernCapabilityContext,
  KernCapabilityHandler,
  KernCapabilityIntent,
  KernCapabilityResult,
} from "./contracts";

export const handleProductRndCapability: KernCapabilityHandler = async (
  session: SessionContext,
  intent: KernCapabilityIntent,
  ctx: KernCapabilityContext
): Promise<KernCapabilityResult | null> => {
  switch (intent) {
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

    default:
      return null;
  }
};
