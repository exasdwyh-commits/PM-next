/**
 * 独立 QA 的**人工签字**入口。
 *
 * 为什么需要这个模块（而不是给 qa_verifier 注册一个执行器）：
 * 产品研发链路的设计是「专业数字员工完成研究 → **独立** QA 复核 → 合成管理报告」
 * （见 DESIGN 三章、`tests/acceptance-product-rnd-e2e.test.ts` 顶部表格）。
 * QA 的独立性恰恰来自「**不由 Worker 自动执行**」——`EXECUTOR_STRATEGIES` 里
 * 刻意没有 qa_verifier，worker 也就永远不会领取它。
 *
 * 但这带来一个真实缺口：worker 不领取 ⇒ 程序停在 `WAITING_QA` ⇒
 * `advanceProductRndProgram` 永远走不到合成报告那一步。此前只能由脚本直调
 * `startAgentTask` / `finishAgentTask` 代签，产品面上没有任何入口。
 *
 * 本模块把「代签」变成一个正式、可审计、有权限门禁的产品动作：
 *   - 只有**项目负责人 / 决策人**（`Role.OWNER` / `Role.DECISION_MAKER`）能签，
 *     即签字方与执行研究的数字员工是两条身份；
 *   - 只能签**当前有效**的那一次 QA attempt，且必须处于 QUEUED（未被领取）；
 *   - 必须写下复核说明（核对了什么、依据是什么），空说明直接拒绝 —— 与
 *     `finishAgentTask` 对子任务 SUCCEEDED 的要求一致，也符合「防编造」铁律；
 *   - 签字后 `finishAgentTask` 会自动 advance，通过时一并合成 Executive Report。
 *
 * 不做的事：**不**注册 qa_verifier 执行器。那会让 QA 退回自动执行，
 * 破坏独立性与设计意图。
 */
import { AgentTaskStatus, Role } from "@prisma/client";
import prisma from "@/shared/db";
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import { type SessionContext, requireProjectRole } from "@/modules/identity/session";
import { finishAgentTask, startAgentTask } from "@/modules/workforce/service";

/** QA 复核可以下的三种结论。与 `AgentTaskOutcome` 的取值对齐。 */
export type ProductRndQaVerdict = "SUCCEEDED" | "FAILED" | "BLOCKED";

const VERDICT_LABELS: Record<ProductRndQaVerdict, string> = {
  SUCCEEDED: "通过",
  FAILED: "不通过",
  BLOCKED: "证据不足，暂缓",
};

const VERDICTS = new Set<string>(Object.keys(VERDICT_LABELS));

export function labelProductRndQaVerdict(verdict: string): string {
  return VERDICT_LABELS[verdict as ProductRndQaVerdict] ?? verdict;
}

export const PRODUCT_RND_QA_VERDICTS = Object.keys(
  VERDICT_LABELS
) as ProductRndQaVerdict[];

export interface SignOffProductRndQaInput {
  parentTaskId: string;
  verdict: ProductRndQaVerdict;
  /** 复核说明：核对了什么、依据是什么。必填。 */
  resultSummary: string;
  /** 不通过 / 暂缓时的原因。 */
  reason?: string | null;
}

export interface SignOffProductRndQaResult {
  parentTaskId: string;
  qaTaskId: string;
  verdict: ProductRndQaVerdict;
  verdictLabel: string;
  qaTaskStatus: string;
  /** 通过且合成成功时的报告；未通过或尚未合成时为 null。 */
  report: {
    id: string;
    title: string;
    contentVersion: number;
    /** 相对路径，交给前端做 <a href>；绝对化由 report-links 在服务端负责。 */
    path: string;
  } | null;
}

const EXECUTIVE_REPORT_ARTIFACT_TYPE = "PRODUCT_RND_EXECUTIVE_REPORT";

/**
 * 对当前有效的 QA attempt 下达人工复核结论。
 *
 * 调用方（API 路由）负责鉴权之外的入参形状校验；这里做业务态校验。
 */
export async function signOffProductRndQa(
  session: SessionContext,
  input: SignOffProductRndQaInput
): Promise<SignOffProductRndQaResult> {
  const verdict = input.verdict;
  if (!VERDICTS.has(verdict)) {
    throw new UnprocessableEntityError(
      `verdict 必须是 ${PRODUCT_RND_QA_VERDICTS.join(" / ")} 之一`
    );
  }
  const resultSummary = (input.resultSummary ?? "").trim();
  if (!resultSummary) {
    throw new UnprocessableEntityError(
      "复核说明不能为空：QA 签字必须写清楚核对了什么、依据是什么。"
    );
  }
  if (resultSummary.length > 4000) {
    throw new UnprocessableEntityError("复核说明不能超过 4000 字");
  }

  const parent = await prisma.agentTask.findUnique({
    where: { id: input.parentTaskId },
    include: {
      workItem: { select: { id: true, projectId: true } },
      childTasks: {
        where: { agent: { code: "qa_verifier" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, contextSnapshot: true, createdAt: true },
      },
    },
  });
  if (
    !parent ||
    parent.organizationId !== session.organizationId ||
    !parent.workItem
  ) {
    throw new NotFoundError("Product R&D parent task not found");
  }
  const projectId = parent.workItem.projectId;
  const workItemId = parent.workItem.id;

  // 独立性门禁：签字方必须是项目负责人 / 决策人，与执行研究的数字员工是两条身份。
  // 与 startAgentTask 内部的判定同口径，这里提前调用是为了在状态校验之前
  // 就把「谁有权签」定下来 —— 无权限的人不应该看到任何状态细节。
  await requireProjectRole(session, projectId, [Role.OWNER, Role.DECISION_MAKER]);

  const qaTask = parent.childTasks[0];
  if (!qaTask) {
    throw new ConflictError(
      "当前没有待签字的独立 QA 任务：请先推进流程到 QA 阶段（RECONCILE）。"
    );
  }
  const snapshot = qaTask.contextSnapshot;
  if (
    snapshot &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    (snapshot as Record<string, unknown>).fencedOut === true
  ) {
    throw new ConflictError(
      "这次 QA 已被新的尝试取代（fenced out），请刷新后对当前有效的 QA 签字。"
    );
  }

  if (qaTask.status === AgentTaskStatus.RUNNING) {
    throw new ConflictError("这次 QA 已被领取并在复核中，不能重复签字。");
  }
  if (qaTask.status === AgentTaskStatus.SUBMITTED) {
    throw new ConflictError("这次 QA 已提交复核结果，不能重复签字。");
  }
  if (qaTask.status === AgentTaskStatus.SUCCEEDED) {
    throw new ConflictError(
      "本轮 QA 已经通过，无需重复签字；如需重新复核请先重新排队 QA。"
    );
  }
  if (qaTask.status !== AgentTaskStatus.QUEUED) {
    throw new ConflictError(
      `这次 QA 已终结（${qaTask.status}），不能签字；请在流程里重新排队 QA。`
    );
  }

  // 先 claim 再落结论：startAgentTask 会把 QA 从 QUEUED 置为 RUNNING 并开出一次执行，
  // finishAgentTask 要求 runId 属于该任务 —— 这两步合成一个原子的签字动作。
  const started = await startAgentTask(session, qaTask.id);
  await finishAgentTask(session, qaTask.id, {
    runId: started.run.id,
    outcome: verdict,
    resultSummary,
    reason: input.reason?.trim() || null,
  });

  // finishAgentTask 对 product-rnd 父任务会自动 advance（通过时合成报告）。
  // 这里只读取**真实结果**回给界面，不替它宣布成功 —— 报告没合成就是没合成。
  const [qaAfter, report] = await Promise.all([
    prisma.agentTask.findUniqueOrThrow({
      where: { id: qaTask.id },
      select: { status: true },
    }),
    prisma.artifact.findFirst({
      where: { workItemId, type: EXECUTIVE_REPORT_ARTIFACT_TYPE },
      orderBy: { contentVersion: "desc" },
      select: { id: true, title: true, contentVersion: true },
    }),
  ]);

  await prisma.$transaction(async (tx) => {
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "PRODUCT_RND_QA_SIGNED_OFF",
      objectType: "AgentTask",
      objectId: qaTask.id,
      summary: `独立 QA 人工复核：${VERDICT_LABELS[verdict]}`,
      details: {
        parentTaskId: parent.id,
        projectId,
        qaTaskId: qaTask.id,
        verdict,
        resultSummary,
        reason: input.reason?.trim() || null,
        reportArtifactId: report?.id ?? null,
      },
    });
  });

  return {
    parentTaskId: parent.id,
    qaTaskId: qaTask.id,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    qaTaskStatus: qaAfter.status,
    report: report
      ? {
          id: report.id,
          title: report.title,
          contentVersion: report.contentVersion,
          path: `/reports/${encodeURIComponent(report.id)}`,
        }
      : null,
  };
}
