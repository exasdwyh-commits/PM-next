import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { SessionContext, requireProjectRole } from "../identity/session";
import {
  Role,
  ResearchRunStatus,
  ResearchRunTaskStatus,
  ResearchTaskType,
} from "@prisma/client";
import { synthesizeMarketResearch } from "./market-research";
import { parseProjectRequirements } from "./requirement-parser";

/**
 * R: 五阶段研究编排（机制迁移自老版 research-run.ts，报告阶段接入本模块规则合成）
 *
 * 五阶段：明确问题 → 专项研究(市场/产品可行性/我方能力) → 证据核验与缺口 →
 * 生成详细报告与结构化结论 → 发布研究版本。任务全部落库(ResearchRunTask)，
 * 支持轮询恢复与重启接管；发布在事务内写不可变快照并切换运行指针；
 * (runId, reportVersion) 唯一防重复发布。
 *
 * 与老版差异：本模块无 LLM backend，报告阶段复用 synthesizeMarketResearch
 * （纯规则、证据驱动、推断项显式标为待验证草案），不引入外部模型。
 */

const RUN_STALE_RUNNING_MS = 2 * 60 * 1000;
const BOOT_ID = "research-run";

const RUN_TASK_PLAN: Array<{ taskType: ResearchTaskType; title: string }> = [
  { taskType: ResearchTaskType.CLARIFY_SCOPE, title: "明确问题与范围" },
  { taskType: ResearchTaskType.BRANCH_MARKET, title: "专项研究 · 市场与用户" },
  { taskType: ResearchTaskType.BRANCH_PRODUCT, title: "专项研究 · 产品与可行性" },
  { taskType: ResearchTaskType.BRANCH_CAPABILITY, title: "专项研究 · 我方能力与交付" },
  { taskType: ResearchTaskType.OTHER, title: "证据核验与缺口" },
  { taskType: ResearchTaskType.OTHER, title: "生成研究结论" },
  { taskType: ResearchTaskType.OTHER, title: "发布研究版本" },
];

// ---------------------------------------------------------------------------
// B6：对外字段白名单（投影）
//
// 研究批次 API 此前直接返回 Prisma 整行，把实现细节一并送到浏览器：
//   - runnerPid / runnerBootId：暴露服务进程号与进程启动标识（可被用于探测部署形态）
//   - inputJson：内部编排入参
//   - parentTaskId / createdById：内部关联与操作者 id
//   - scopeSnapshotJson：内部范围快照
// 上述字段在 src/app 下零引用（该 API 目前无 UI 消费），因此可以直接收窄。
// 采用显式 select 白名单而非「查出后再 delete」——新字段默认不泄露。
// ---------------------------------------------------------------------------

const RUN_PUBLIC_SELECT = {
  id: true,
  projectId: true,
  question: true,
  inputRevision: true,
  status: true,
  publishedSnapshotId: true,
  errorReason: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RUN_TASK_PUBLIC_SELECT = {
  id: true,
  runId: true,
  projectId: true,
  taskType: true,
  title: true,
  status: true,
  attempt: true,
  resultJson: true,
  errorReason: true,
  seq: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const;

/** 幂等启动：同一项目存在 RUNNING 批次则直接返回，不重复执行 */
export async function startResearchRun(
  session: SessionContext,
  params: { projectId: string; question: string }
) {
  const { projectId, question } = params;
  await requireProjectRole(session, projectId, [Role.OWNER]);

  const active = await prisma.researchRun.findFirst({
    where: { projectId, status: ResearchRunStatus.RUNNING },
    orderBy: { createdAt: "desc" },
    select: RUN_PUBLIC_SELECT,
  });
  if (active) {
    const tasks = await prisma.researchRunTask.findMany({
      where: { runId: active.id },
      orderBy: { createdAt: "asc" },
      select: RUN_TASK_PUBLIC_SELECT,
    });
    return { run: active, tasks, created: false as const };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { revision: true, target: true, constraints: true },
  });
  if (!project) throw new NotFoundError("Project not found");

  const scopeSnapshot = {
    question: question.slice(0, 500),
    projectTarget: project.target,
    projectConstraints: project.constraints || null,
    inputRevision: project.revision,
  };

  const run = await prisma.researchRun.create({
    data: {
      projectId,
      question: question.slice(0, 500),
      inputRevision: project.revision,
      scopeSnapshotJson: JSON.stringify(scopeSnapshot),
      status: ResearchRunStatus.RUNNING,
      createdById: session.userId,
    },
  });

  await prisma.researchRunTask.createMany({
    data: RUN_TASK_PLAN.map((step, idx) => ({
      runId: run.id,
      projectId,
      taskType: step.taskType,
      title: step.title,
      seq: idx + 1,
      status: ResearchRunTaskStatus.QUEUED,
      inputJson: JSON.stringify({ question, inputRevision: project.revision }),
      createdById: session.userId,
    })),
  });

  await prisma.auditEvent.create({
    data: {
      actorId: session.userId,
      action: "RESEARCH_RUN_STARTED",
      objectType: "ResearchRun",
      objectId: run.id,
      revision: project.revision,
      summary: `负责人发起五阶段研究编排，输入基线 r${project.revision}`,
    },
  });

  const tasks = await prisma.researchRunTask.findMany({
    where: { runId: run.id },
    orderBy: { createdAt: "asc" },
    select: RUN_TASK_PUBLIC_SELECT,
  });

  // B6：对外只返回白名单字段（run 变量保留整行供内部编排使用，不外发）
  const publicRun = await prisma.researchRun.findUnique({
    where: { id: run.id },
    select: RUN_PUBLIC_SELECT,
  });
  if (!publicRun) throw new NotFoundError("Research run not found");
  return { run: publicRun, tasks, created: true as const };
}

/** 轮询/恢复入口：接管过期 RUNNING 任务并继续执行 queued 任务 */
export async function runResearchRunTasks(runId: string): Promise<void> {
  const running = await prisma.researchRunTask.findFirst({
    where: { runId, status: ResearchRunTaskStatus.RUNNING },
  });
  if (running) return;

  const tasks = await prisma.researchRunTask.findMany({
    where: { runId, status: ResearchRunTaskStatus.QUEUED },
    orderBy: { createdAt: "asc" },
  });

  for (const task of tasks) {
    const claimed = await prisma.researchRunTask.updateMany({
      where: { id: task.id, status: ResearchRunTaskStatus.QUEUED },
      data: {
        status: ResearchRunTaskStatus.RUNNING,
        attempt: { increment: 1 },
        runnerPid: process.pid,
        runnerBootId: BOOT_ID,
        startedAt: new Date(),
      },
    });
    if (claimed.count === 0) continue;

    const outcome = await executeRunTask(runId, task);
    await prisma.researchRunTask.update({
      where: { id: task.id },
      data: {
        status: outcome.status === "succeeded" ? ResearchRunTaskStatus.SUCCEEDED : ResearchRunTaskStatus.FAILED,
        resultJson: outcome.resultJson === undefined ? undefined : JSON.stringify(outcome.resultJson),
        errorReason: outcome.errorReason,
        finishedAt: new Date(),
      },
    });
  }

  // 全部任务完成且未发布 → 标记发布
  await finalizeIfDone(runId);
}

type TaskOutcome = { status: "succeeded" | "failed"; resultJson?: any; errorReason?: string };

async function executeRunTask(runId: string, task: { title: string; taskType: ResearchTaskType }): Promise<TaskOutcome> {
  switch (task.taskType) {
    case ResearchTaskType.CLARIFY_SCOPE:
      return { status: "succeeded", resultJson: { note: "范围已由项目目标/约束与输入基线冻结" } };
    case ResearchTaskType.BRANCH_MARKET:
      return branchMarket(runId);
    case ResearchTaskType.BRANCH_PRODUCT:
      return branchProduct(runId);
    case ResearchTaskType.BRANCH_CAPABILITY:
      return { status: "succeeded", resultJson: { capabilities: [], gaps: ["内部供应链/产能/成本结构资料待补"] } };
    default:
      if (task.title === "证据核验与缺口") return verifyGaps(runId);
      if (task.title === "生成研究结论") return generateConclusion(runId);
      if (task.title === "发布研究版本") return publishRun(runId);
      return { status: "failed", errorReason: `未知任务：${task.title}` };
  }
}

/** 专项研究 · 市场与用户：基于已核实证据与约束，调用规则合成生成市场洞察与标杆竞品 */
async function branchMarket(runId: string): Promise<TaskOutcome> {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "failed", errorReason: "研究批次不存在" };

  const project = await prisma.project.findUnique({
    where: { id: run.projectId },
    include: {
      evidences: { include: { claims: true } },
      productVersion: { include: { product: true } },
    },
  });
  if (!project) return { status: "failed", errorReason: "项目不存在" };

  const constraints = parseProjectRequirements(project.constraints || "").constraints;
  const verifiedSnippets = project.evidences
    .filter((e) => e.verifyStatus === "VERIFIED")
    .map((e) => ({ id: e.id, content: e.contentOrUri, source: e.source }));
  const categoryName = project.productVersion?.product?.name || "健康食品";

  try {
    const report = synthesizeMarketResearch(run.projectId, categoryName, constraints, verifiedSnippets);
    return { status: "succeeded", resultJson: report };
  } catch (e: any) {
    return { status: "failed", resultJson: {}, errorReason: `市场分支合成失败：${e?.message || "未知"}` };
  }
}

/** 专项研究 · 产品与可行性：如实列出合规知识基线，无则标缺口 */
async function branchProduct(runId: string): Promise<TaskOutcome> {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "failed", errorReason: "研究批次不存在" };

  const project = await prisma.project.findUnique({
    where: { id: run.projectId },
    include: { productVersion: { include: { product: true } } },
  });
  const productName = project?.productVersion?.product?.name || null;

  return {
    status: "succeeded",
    resultJson: {
      productRef: productName,
      compliance: {
        note: "暂无结构化法规规则库，合规判断需人工补充或检索外部来源",
        gaps: ["法规规则库未初始化（迁移自老版 compliance.ts 资产，见 P3）"],
      },
    },
  };
}

/** 证据核验与缺口：汇总未验证证据与缺口条目 */
async function verifyGaps(runId: string): Promise<TaskOutcome> {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "failed", errorReason: "研究批次不存在" };

  const project = await prisma.project.findUnique({
    where: { id: run.projectId },
    include: { evidences: true },
  });
  if (!project) return { status: "failed", errorReason: "项目不存在" };

  const unverified = project.evidences.filter((e) => e.verifyStatus !== "VERIFIED").length;
  return {
    status: "succeeded",
    resultJson: {
      note: `共 ${project.evidences.length} 条证据，其中 ${unverified} 条未独立核实`,
      gaps: unverified > 0 ? [`${unverified} 条证据待负责人核实后纳入决策依据`] : [],
      unverifiedCount: unverified,
    },
  };
}

/** 生成研究结论：汇总各成功分支，标记为待验证草案 */
async function generateConclusion(runId: string): Promise<TaskOutcome> {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "failed", errorReason: "研究批次不存在" };

  const marketTask = await prisma.researchRunTask.findFirst({
    where: { runId, taskType: ResearchTaskType.BRANCH_MARKET, status: ResearchRunTaskStatus.SUCCEEDED },
    orderBy: { finishedAt: "desc" },
  });

  if (!marketTask?.resultJson) {
    return { status: "failed", errorReason: "市场分支未成功，无法生成研究结论（可重启补充证据后重试）" };
  }

  return {
    status: "succeeded",
    resultJson: {
      report: marketTask.resultJson,
      verification: {
        status: "DRAFT_UNVERIFIED",
        note: "本结论为待验证草案，推断项不得作为打样门批准的唯一依据；须补充工厂报价/渠道成交/人工核实后升级为正式研究。",
      },
    },
  };
}

/** 发布研究版本：事务写不可变快照 + 版本锁，不覆盖已发布同输入版本的更晚批次 */
async function publishRun(runId: string): Promise<TaskOutcome> {
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "failed", errorReason: "研究批次不存在" };

  const conclusion = await prisma.researchRunTask.findFirst({
    where: { runId, title: "生成研究结论", status: ResearchRunTaskStatus.SUCCEEDED },
    orderBy: { finishedAt: "desc" },
  });
  if (!conclusion?.resultJson) {
    return { status: "failed", errorReason: "研究结论未生成，无法发布" };
  }

  const newerPublished = await prisma.researchRun.findFirst({
    where: {
      projectId: run.projectId,
      status: ResearchRunStatus.PUBLISHED,
      id: { not: run.id },
      OR: [
        { inputRevision: { gt: run.inputRevision } },
        { inputRevision: run.inputRevision, createdAt: { gt: run.createdAt } },
      ],
    },
    select: { id: true, inputRevision: true },
  });
  if (newerPublished) {
    return {
      status: "failed",
      errorReason: `已有更新输入基线（r${newerPublished.inputRevision}）的研究版本发布，本批次（r${run.inputRevision}）不覆盖当前结果（历史可查）`,
    };
  }

  // 版本锁：(runId, reportVersion) 唯一；事务内发布快照并切换指针
  const version = (await prisma.researchRunSnapshot.count({ where: { runId } })) + 1;
  const snap = await prisma.$transaction(async (tx) => {
    const s = await tx.researchRunSnapshot.create({
      data: { runId, reportVersion: version, reportJson: JSON.stringify(conclusion.resultJson) },
    });
    await tx.researchRun.update({
      where: { id: runId },
      data: { status: ResearchRunStatus.PUBLISHED, publishedSnapshotId: s.id, publishedAt: new Date(), errorReason: null },
    });
    return s;
  });

  return { status: "succeeded", resultJson: { snapshotId: snap.id, reportVersion: version } };
}

async function finalizeIfDone(runId: string): Promise<void> {
  const pending = await prisma.researchRunTask.count({
    where: { runId, status: { in: [ResearchRunTaskStatus.QUEUED, ResearchRunTaskStatus.RUNNING] } },
  });
  const run = await prisma.researchRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== ResearchRunStatus.RUNNING) return;
  if (pending > 0) return;

  const published = await prisma.researchRunSnapshot.findFirst({ where: { runId } });
  if (published) return;

  // 无发布结果但任务跑完 → 判定失败并记录原因
  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: ResearchRunStatus.FAILED, errorReason: "未产出可发布的研究结论" },
  });
}

/** 轮询恢复：接管跨进程/超时 running 任务后重新排队 */
export async function resumeResearchRun(runId: string): Promise<void> {
  await prisma.researchRunTask.updateMany({
    where: {
      runId,
      status: ResearchRunTaskStatus.RUNNING,
      startedAt: { lt: new Date(Date.now() - RUN_STALE_RUNNING_MS) },
      NOT: { runnerBootId: BOOT_ID },
    },
    data: { status: ResearchRunTaskStatus.QUEUED, runnerPid: null, runnerBootId: null },
  });
  await runResearchRunTasks(runId);
}

/** 查询批次状态（含接管），供前端轮询 */
export async function getResearchRunState(session: SessionContext, runId: string) {
  // B6：用显式 select 白名单查询 —— 不再把 runnerPid / runnerBootId /
  // inputJson / parentTaskId / createdById / scopeSnapshotJson 送到客户端。
  const run = await prisma.researchRun.findUnique({
    where: { id: runId },
    select: {
      ...RUN_PUBLIC_SELECT,
      tasks: { orderBy: { createdAt: "asc" }, select: RUN_TASK_PUBLIC_SELECT },
    },
  });
  if (!run) throw new NotFoundError("Research run not found");

  await requireProjectRole(session, run.projectId, [Role.OWNER, Role.DECISION_MAKER, Role.VIEWER]);

  if (run.status === ResearchRunStatus.RUNNING) {
    await resumeResearchRun(runId);
  }
  const snapshot = run.publishedSnapshotId
    ? await prisma.researchRunSnapshot.findUnique({ where: { id: run.publishedSnapshotId } })
    : null;

  return { run, snapshot };
}

/** 最近一次已发布研究（供项目详情页展示） */
export async function getLatestPublishedRun(session: SessionContext, projectId: string) {
  await requireProjectRole(session, projectId, [Role.OWNER, Role.DECISION_MAKER, Role.VIEWER]);
  const run = await prisma.researchRun.findFirst({
    where: { projectId, status: ResearchRunStatus.PUBLISHED },
    orderBy: { publishedAt: "desc" },
  });
  if (!run?.publishedSnapshotId) return null;
  const snapshot = await prisma.researchRunSnapshot.findUnique({
    where: { id: run.publishedSnapshotId },
  });
  return run && snapshot ? { run, snapshot } : null;
}