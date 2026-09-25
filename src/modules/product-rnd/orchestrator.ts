import {
  AgentTaskStatus,
  AgentTriggerType,
  Prisma,
  ResearchRunStatus,
  Role,
  RunMode,
  WorkExecutorType,
  WorkItemStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "@/shared/db";
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import {
  type SessionContext,
  requireProjectRole,
} from "@/modules/identity/session";
import { createWorkItem, submitWork } from "@/modules/work/service";
import {
  createAgentTask,
  delegateAgentTask,
  finishAgentTask,
  startAgentTask,
} from "@/modules/workforce/service";
import {
  getLatestPublishedRun,
  startResearchRun,
} from "@/modules/research/research-run";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";

const PRODUCT_RND_SPECIALISTS = [
  {
    code: "research_agent",
    label: "市场与竞品",
    goal:
      "研究市场、用户、竞品、渠道和真实价格/规格证据；明确时间范围、来源、样本与缺口。",
  },
  {
    code: "scientific_evidence_agent",
    label: "科学证据",
    goal:
      "审查原料/配方相关论文、临床、人群、剂量、终点、机制与外推边界；形成 claim-evidence 清单。",
  },
  {
    code: "formulation_agent",
    label: "配方与规格",
    goal:
      "提出配方、每日剂量、剂型、规格、制造与口感约束；把事实、推断和待验证项分开。",
  },
  {
    code: "compliance_agent",
    label: "法规与宣称",
    goal:
      "核实原料身份、法规路径、适用地区/品类/渠道和宣称边界；高影响结论必须绑定官方依据。",
  },
  {
    code: "cost_bom_agent",
    label: "成本与 BOM",
    goal:
      "建立原料、加工、包材、物流、税费、佣金与毛利 low/base/high 场景；价格必须绑定来源、规格、MOQ 和日期。",
  },
] as const;

const TERMINAL_SPECIALIST_STATES = new Set<AgentTaskStatus>([
  AgentTaskStatus.SUCCEEDED,
  AgentTaskStatus.FAILED,
  AgentTaskStatus.BLOCKED,
  AgentTaskStatus.WAITING_HUMAN,
  AgentTaskStatus.CANCELLED,
]);

export interface ProductRndExecutiveReport {
  schemaVersion: "1.0";
  sourceRefs: Array<{ id: string; hash: string; retrievedAt?: string }>;
  assumptions: string[];
  missingInputs: string[];
  summary: string;
  conclusions: Array<{
    claim: string;
    claimKind: string;
    evidenceLevel: string;
    evidenceRef: string;
    verificationRefs: string[];
    freshness: string;
  }>;
  risks: string[];
  unknowns: string[];
  decisionsRequired: string[];
  recommendedActions: string[];
  knowledgeDebtRefs: string[];
  advisoryNotes: Array<{
    agentCode: string;
    agentName: string;
    taskId: string;
    status: AgentTaskStatus;
    runId: string | null;
    summary: string | null;
    errorReason: string | null;
  }>;
  agentRunRefs: string[];
  modelRunRefs: string[];
  researchSnapshotRef: string | null;
  verificationStatus:
    | "READY_FOR_HUMAN_REVIEW"
    | "PARTIAL"
    | "BLOCKED_BY_QA";
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function objectOrEmpty(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const ACTIVE_PRODUCT_RND_WORK_STATUSES = [
  WorkItemStatus.TODO,
  WorkItemStatus.RUNNING,
  WorkItemStatus.SUBMITTED,
  WorkItemStatus.CHANGES_REQUESTED,
];

async function findActiveProductRndWorkItem(projectId: string) {
  return prisma.workItem.findFirst({
    where: {
      projectId,
      title: "产品研发综合评估",
      executorType: WorkExecutorType.DIGITAL_WORKER,
      status: { in: ACTIVE_PRODUCT_RND_WORK_STATUSES },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function describeExistingProductRndProgram(
  session: SessionContext,
  workItemId: string
) {
  const workItem = await prisma.workItem.findUnique({
    where: { id: workItemId },
  });
  if (!workItem) throw new NotFoundError("Product R&D work item not found");

  const parentTask = await prisma.agentTask.findFirst({
    where: {
      organizationId: session.organizationId,
      workItemId,
      parentTaskId: null,
      agent: { code: "hermes_pm" },
    },
    include: {
      agent: { select: { code: true, name: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      childTasks: {
        include: {
          agent: { select: { code: true, name: true } },
        },
      },
    },
  });

  if (!parentTask) {
    throw new ConflictError(
      "Product R&D bootstrap is still in progress; retry the same START request."
    );
  }
  const parentRun = parentTask.runs[0];
  if (!parentRun) {
    throw new ConflictError(
      "Product R&D parent run is not ready yet; retry the same START request."
    );
  }

  const context = objectOrEmpty(parentTask.contextSnapshot ?? null);
  const researchRunId =
    typeof context.researchRunId === "string" ? context.researchRunId : null;
  if (!researchRunId) {
    throw new ConflictError(
      "Product R&D research bootstrap is not ready yet; retry the same START request."
    );
  }
  const researchRun = await prisma.researchRun.findUnique({
    where: { id: researchRunId },
  });
  if (!researchRun) {
    throw new ConflictError(
      "Product R&D ResearchRun is not ready yet; retry the same START request."
    );
  }

  const specialistTasks = parentTask.childTasks
    .filter((task) =>
      PRODUCT_RND_SPECIALISTS.some(
        (specialist) => specialist.code === task.agent.code
      )
    )
    .map((task) => ({
      code: task.agent.code,
      label:
        PRODUCT_RND_SPECIALISTS.find(
          (specialist) => specialist.code === task.agent.code
        )?.label ?? task.agent.name,
      delegationId: null,
      task,
    }));

  if (specialistTasks.length !== PRODUCT_RND_SPECIALISTS.length) {
    throw new ConflictError(
      "Product R&D specialist bootstrap is still in progress; retry the same START request."
    );
  }

  return {
    schemaVersion: "product-rnd-program/v1" as const,
    projectId: workItem.projectId,
    workItem,
    parentTask,
    parentRun,
    specialistTasks,
    researchRun,
    researchCreated: false,
    reused: true as const,
    bootstrapIncomplete: false as const,
  };
}

async function loadProductRndWorkforce(organizationId: string) {
  const requiredCodes = [
    "hermes_pm",
    ...PRODUCT_RND_SPECIALISTS.map((item) => item.code),
    "qa_verifier",
  ];
  const agents = await prisma.agent.findMany({
    where: {
      organizationId,
      code: { in: [...requiredCodes] },
      status: "ACTIVE",
    },
    select: { id: true, code: true, name: true },
  });
  const byCode = new Map(agents.map((agent) => [agent.code, agent]));
  const missing = requiredCodes.filter((code) => !byCode.has(code));
  if (missing.length) {
    throw new ConflictError(
      `Product R&D workforce is not bootstrapped; missing: ${missing.join(", ")}`
    );
  }

  const squad = await prisma.squad.findUnique({
    where: {
      organizationId_code: {
        organizationId,
        code: "product_core",
      },
    },
    select: { id: true, code: true, leaderAgentId: true },
  });
  if (!squad) {
    throw new ConflictError("Product R&D squad product_core is not bootstrapped");
  }
  return { byCode, squad };
}

export async function startProductRndProgram(
  session: SessionContext,
  input: { projectId: string; brief: string }
) {
  const brief = input.brief?.trim();
  if (!brief) throw new UnprocessableEntityError("Product R&D brief is required");
  await requireProjectRole(session, input.projectId, [Role.OWNER]);

  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      organizationId: true,
      revision: true,
      title: true,
      productId: true,
      productVersionId: true,
    },
  });
  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }

  const existing = await findActiveProductRndWorkItem(project.id);
  if (existing) {
    return describeExistingProductRndProgram(session, existing.id);
  }

  const { byCode, squad } = await loadProductRndWorkforce(session.organizationId);

  let workItem;
  try {
    workItem = await createWorkItem(session, project.id, {
    title: "产品研发综合评估",
    target: brief.slice(0, 500),
    deliverableReq:
      "形成市场、科学、配方、法规、成本五路专业结论，经独立 QA 后提交 PRODUCT_RND_EXECUTIVE_REPORT；所有未知项必须显式保留。",
      executorType: WorkExecutorType.DIGITAL_WORKER,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await findActiveProductRndWorkItem(project.id);
      if (raced) {
        return describeExistingProductRndProgram(session, raced.id);
      }
    }
    throw error;
  }

  const parent = await createAgentTask(session, {
    agentId: byCode.get("hermes_pm")!.id,
    workItemId: workItem.id,
    squadId: squad.id,
    goal:
      "作为 Department Assistant / Product R&D Director 统筹本次产品研发评估，监督专业员工、证据、未知项、QA 与最终管理报告。",
    contextSnapshot: json({
      schemaVersion: "product-rnd-program/v1",
      projectId: project.id,
      projectRevision: project.revision,
      workItemId: workItem.id,
      brief,
      collaborationMode: "DELEGATION",
      requiredSpecialists: PRODUCT_RND_SPECIALISTS.map((item) => item.code),
      qaRequired: true,
    }),
    priority: 70,
    triggerType: AgentTriggerType.MANUAL,
    triggerRef: `product-rnd:${workItem.id}`,
  });

  const parentStarted = await startAgentTask(session, parent.id);

  const delegated = [];
  for (const specialist of PRODUCT_RND_SPECIALISTS) {
    const target = byCode.get(specialist.code)!;
    delegated.push(
      await delegateAgentTask(session, {
        parentTaskId: parent.id,
        toAgentId: target.id,
        goal: `${specialist.label}：${specialist.goal}\n\n产品研发 Brief：${brief}`,
        reason:
          "Department Assistant delegates specialist depth while retaining supervision and final synthesis responsibility.",
        sourceRunId: parentStarted.run.id,
      })
    );
  }

  const research = await startResearchRun(session, {
    projectId: project.id,
    question: brief,
  });

  const updatedContext = {
    ...objectOrEmpty(parent.contextSnapshot),
    researchRunId: research.run.id,
    specialistTaskIds: delegated.map((row) => row.childTask.id),
  };
  await prisma.$transaction([
    prisma.agentTask.update({
      where: { id: parent.id },
      data: { contextSnapshot: json(updatedContext) },
    }),
    prisma.agentRun.update({
      where: { id: parentStarted.run.id },
      data: { contextSnapshot: json(updatedContext) },
    }),
  ]);

  return {
    schemaVersion: "product-rnd-program/v1",
    projectId: project.id,
    workItem,
    parentTask: { ...parentStarted.task, contextSnapshot: updatedContext },
    parentRun: { ...parentStarted.run, contextSnapshot: updatedContext },
    specialistTasks: delegated.map((row, index) => ({
      code: PRODUCT_RND_SPECIALISTS[index].code,
      label: PRODUCT_RND_SPECIALISTS[index].label,
      delegationId: row.delegation.id,
      task: row.childTask,
    })),
    researchRun: research.run,
    researchCreated: research.created,
    reused: false as const,
    bootstrapIncomplete: false,
  };
}

/**
 * 原子抢占 Product R&D 的 QA 排队槽位（crash-safe lease + fencing token）。
 *
 * advanceProductRndProgram 中「读取 childTasks → 发现没有 QA → 排队」是典型的
 * check-then-act：两个并发 reconcile（用户点击 RECONCILE 的同时，最后一个专家
 * 任务完成触发了自动 advance）会同时看到没有 QA，各自创建一个 qa_verifier，
 * 而下游 synthesize 用 find() 只取第一个，第二个被静默丢弃。
 *
 * 这里用单条 UPDATE ... WHERE ... RETURNING 做 compare-and-swap：PostgreSQL
 * 对命中行加行锁，并发事务必然串行化，只有一个能拿到槽位。
 *
 * qaClaim 形态：
 * - 占位：{"token","claimedAt","expiresAt"} —— 抢占成功但进程在创建 QA 前崩溃时，
 *   lease 过期后可重新抢占（v1 的裸 "claimed" 会永久卡死槽位）；
 * - 落定：{"token","claimedAt","settledAt","taskId"} —— QA 任务已创建，**不带
 *   expiresAt**，因此不会被 lease 过期规则重抢；只有「最新 attempt 已终结失败」
 *   时才允许 retry 重抢；
 * - 兼容 v1：裸字符串 "claimed" 视为立即过期的占位；裸 taskId 字符串视为已落定。
 *
 * WHERE 额外要求「当前不存在活跃或成功的 QA attempt」，作为 retry 语义下的并发
 * 兜底：QA FAILED 后允许多次排队（attempt N+1），但任何时刻最多只有一个活跃 QA。
 *
 * ## fencing：token 不只是记录信息
 *
 * 光有 expiresAt 只解决「永久死锁」，不解决 stale owner 复活后的重复执行：
 *
 *   A 抢到 tokenA → A 卡住超过 lease → B 抢到 tokenB 并创建 QA-B → A 复活后
 *   继续创建 QA-A  ⟹  同一 parent 下两个活跃 QA。
 *
 * 因此本模块把 token 当真正的 fencing token 用：
 * 1. claim 返回 token；
 * 2. **创建 QA 之前**先 `renew`（token 匹配才续租）——失权则直接放弃，不创建任务；
 * 3. 创建之后 `settle` 也必须 token 匹配——失权说明已被更新 owner 夺权，
 *    此时对刚创建的孤儿 QA 执行**补偿性作废**（supersedeFencedQaTask），
 *    保证任一时刻最多只有一个活跃 QA；
 * 4. `release` 同样 token 匹配——旧 A 报错时**不可能删掉** B 的新 claim。
 *
 * 为什么不用「一个大事务包住 claim + 建 QA + settle」：建 QA 走
 * delegateAgentTask，它有自己独立的写入路径（审计事件等），把它塞进外部事务
 * 只会产生半回滚语义（外部回滚，内部已提交）。上面的「校验 + 补偿」协议在
 * 不改变 delegate 前提下同样能守住「至多一个活跃 QA」这一不变量。
 */
const QA_CLAIM_LEASE_MS = 5 * 60_000;
/** 抢不到槽位时，最多等这么久看并发的 attempt 是否浮现（避免把瞬时竞争暴露成 409）。 */
const QA_CLAIM_WAIT_MS = 1_200;
const QA_CLAIM_POLL_MS = 300;

/**
 * 抢占槽位，返回本次抢占的 **fencing token**；未抢到返回 null。
 * 调用方必须把 token 一路带到 renew / settle / release，否则它就只是装饰。
 */
export async function claimProductRndQaSlot(
  parentTaskId: string,
  organizationId: string
): Promise<string | null> {
  const now = new Date();
  const token = randomUUID();
  const claim = JSON.stringify({
    token,
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + QA_CLAIM_LEASE_MS).toISOString(),
  });
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentTask" parent
       SET "contextSnapshot" = jsonb_set(
             COALESCE(parent."contextSnapshot", '{}'::jsonb),
             '{qaClaim}',
             ${claim}::jsonb,
             true
           )
     WHERE parent.id = ${parentTaskId}
       AND parent."organizationId" = ${organizationId}
       AND (
            COALESCE(parent."contextSnapshot" ->> 'qaClaim', '') = ''
            -- v1 残留占位：视为立即过期
         OR parent."contextSnapshot" -> 'qaClaim' = '"claimed"'::jsonb
            -- v2 占位：lease 过期即可重抢（创建 QA 前崩溃的恢复路径）
         OR (
              jsonb_typeof(parent."contextSnapshot" -> 'qaClaim') = 'object'
          AND jsonb_exists(parent."contextSnapshot" -> 'qaClaim', 'expiresAt')
          AND (parent."contextSnapshot" -> 'qaClaim' ->> 'expiresAt')::timestamptz < now()
         )
            -- v2 落定 + 最新 QA attempt 已失败终结：retry 需要重抢槽位。
            -- 与下方 NOT EXISTS 组合：最新 attempt 失败 ⟹ 必无活跃/成功 QA，
            -- 并发 retry 仍被 NOT EXISTS 串行化。
         OR (
              jsonb_typeof(parent."contextSnapshot" -> 'qaClaim') = 'object'
          AND jsonb_exists(parent."contextSnapshot" -> 'qaClaim', 'taskId')
          AND COALESCE((
                SELECT qa.status::text
                  FROM "AgentTask" qa
                  JOIN "Agent" ag ON ag.id = qa."agentId"
                 WHERE qa."parentTaskId" = parent.id
                   AND ag.code = 'qa_verifier'
                   -- 被 fencing 作废的孤儿不算「最新 attempt」
                   AND COALESCE(qa."contextSnapshot" -> 'fencedOut', 'false'::jsonb) <> 'true'::jsonb
                 ORDER BY qa."createdAt" DESC
                 LIMIT 1
              ), 'NONE') IN ('FAILED', 'BLOCKED', 'CANCELLED')
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM "AgentTask" qa
           JOIN "Agent" ag ON ag.id = qa."agentId"
          WHERE qa."parentTaskId" = parent.id
            AND ag.code = 'qa_verifier'
            AND COALESCE(qa."contextSnapshot" -> 'fencedOut', 'false'::jsonb) <> 'true'::jsonb
            AND qa.status IN ('QUEUED', 'RUNNING', 'SUBMITTED', 'WAITING_HUMAN', 'SUCCEEDED')
       )
    RETURNING parent.id
  `;
  return claimed.length > 0 ? token : null;
}

/**
 * 续租 + ownership 校验（fencing 第 2 步）。
 *
 * 只有仍持有同一 token 的 owner 能延长 lease；返回 false 表示槽位已被别人拿走
 * （我们已失权），调用方必须放弃创建 QA，绝不能继续往下走。
 */
export async function renewProductRndQaSlot(
  parentTaskId: string,
  organizationId: string,
  token: string
): Promise<boolean> {
  const now = new Date();
  const renewed = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentTask"
       SET "contextSnapshot" = jsonb_set(
             COALESCE("contextSnapshot", '{}'::jsonb),
             '{qaClaim}',
             jsonb_build_object(
               'token', ${token}::text,
               'claimedAt', COALESCE("contextSnapshot" #>> '{qaClaim,claimedAt}', ${now.toISOString()}::text),
               'renewedAt', ${now.toISOString()}::text,
               'expiresAt', ${new Date(now.getTime() + QA_CLAIM_LEASE_MS).toISOString()}::text
             ),
             true
           )
     WHERE id = ${parentTaskId}
       AND "organizationId" = ${organizationId}
       AND COALESCE("contextSnapshot" -> 'qaClaim' ->> 'token', '') = ${token}
    RETURNING id
  `;
  return renewed.length > 0;
}

/**
 * 槽位落定（fencing 第 3 步）：把占位 lease 换成真实 QA 任务 id，且**必须**仍持有
 * 同一 token。返回 false = 已被更新的 owner 夺权，我们刚创建的那个 QA 是孤儿。
 *
 * 落定形态刻意**不带 expiresAt**：否则「lease 过期即可重抢」的规则会在 QA 还活跃时
 * 把它抢走。retry 重抢由「最新 attempt 已失败终结」那条规则负责。
 */
export async function settleProductRndQaSlot(
  parentTaskId: string,
  organizationId: string,
  token: string,
  qaTaskId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const settled = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "AgentTask"
       SET "contextSnapshot" = jsonb_set(
             COALESCE("contextSnapshot", '{}'::jsonb),
             '{qaClaim}',
             jsonb_build_object(
               'token', ${token}::text,
               'claimedAt', COALESCE("contextSnapshot" #>> '{qaClaim,claimedAt}', ${now}::text),
               'settledAt', ${now}::text,
               'taskId', ${qaTaskId}::text
             ),
             true
           )
     WHERE id = ${parentTaskId}
       AND "organizationId" = ${organizationId}
       AND COALESCE("contextSnapshot" -> 'qaClaim' ->> 'token', '') = ${token}
    RETURNING id
  `;
  return settled.length > 0;
}

/**
 * 释放槽位（fencing 第 4 步）。**必须**带 token：旧 owner 报错时不能删掉新 owner
 * 的 claim，否则会制造「B 以为持有槽位、槽位却空了」的第三种坏状态。
 */
export async function releaseProductRndQaSlot(
  parentTaskId: string,
  organizationId: string,
  token: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AgentTask"
       SET "contextSnapshot" = COALESCE("contextSnapshot", '{}'::jsonb) - 'qaClaim'
     WHERE id = ${parentTaskId}
       AND "organizationId" = ${organizationId}
       AND COALESCE("contextSnapshot" -> 'qaClaim' ->> 'token', '') = ${token}
  `;
}

/**
 * 补偿性作废：settle 失权后，把刚创建的孤儿 QA 标记为 CANCELLED + fencedOut。
 *
 * 不删除任务（审计留痕），而是打 `contextSnapshot.fencedOut = true` 标记；
 * `selectCurrentQaAttempt` 会跳过带该标记的任务，因此孤儿既不会被当成
 * 「最新有效 attempt」，也不会遮蔽真正 owner 的 QA。
 */
export async function supersedeFencedQaTask(qaTaskId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "AgentTask"
       SET "status" = 'CANCELLED',
           "blockedReason" = 'Superseded: a newer Product R&D QA claim took over this slot (fencing token mismatch).',
           "contextSnapshot" = jsonb_set(
             COALESCE("contextSnapshot", '{}'::jsonb),
             '{fencedOut}',
             'true'::jsonb,
             true
           )
     WHERE id = ${qaTaskId}
       AND "status" IN ('QUEUED', 'RUNNING', 'SUBMITTED')
  `;
}

/**
 * 「当前有效 QA attempt」：按创建时间取最新的 qa_verifier 任务。
 *
 * 历史 QA 任务永不删除（审计留痕），所以绝不能用 find() 任意取：
 * - 最新 attempt 处于 QUEUED/RUNNING/SUBMITTED/WAITING_HUMAN/SUCCEEDED → 有效；
 * - 最新 attempt 处于 FAILED/BLOCKED/CANCELLED → 该 attempt 已终结，
 *   表示允许排队 attempt N+1（retry）。
 */
function selectCurrentQaAttempt<
  T extends { agent: { code: string }; createdAt: Date; contextSnapshot?: unknown },
>(tasks: T[]): T | null {
  return (
    tasks
      .filter(
        (task) =>
          task.agent.code === "qa_verifier" &&
          // 被 fencing 作废的孤儿 attempt 不参与「当前有效 attempt」判定
          objectOrEmpty(task.contextSnapshot as Prisma.JsonValue | null)
            .fencedOut !== true
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

const ACTIVE_QA_STATUSES = new Set<AgentTaskStatus>([
  AgentTaskStatus.QUEUED,
  AgentTaskStatus.RUNNING,
  AgentTaskStatus.SUBMITTED,
  AgentTaskStatus.WAITING_HUMAN,
  AgentTaskStatus.SUCCEEDED,
]);

export async function queueProductRndQa(
  session: SessionContext,
  input: { parentTaskId: string }
) {
  const parent = await prisma.agentTask.findUnique({
    where: { id: input.parentTaskId },
    include: {
      workItem: { select: { id: true, projectId: true } },
      runs: {
        where: { status: "RUNNING" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true },
      },
      childTasks: {
        include: {
          agent: { select: { id: true, code: true, name: true } },
          runs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              outputSummary: true,
              errorReason: true,
            },
          },
        },
      },
    },
  });
  if (!parent || parent.organizationId !== session.organizationId || !parent.workItem) {
    throw new NotFoundError("Product R&D parent task not found");
  }
  await requireProjectRole(session, parent.workItem.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
  ]);

  const specialists = parent.childTasks.filter(
    (task) => task.agent.code !== "qa_verifier"
  );
  const active = specialists.filter(
    (task) => !TERMINAL_SPECIALIST_STATES.has(task.status)
  );
  if (active.length) {
    throw new ConflictError(
      `Specialist work is still active: ${active
        .map((task) => `${task.agent.code}:${task.status}`)
        .join(", ")}`
    );
  }

  const currentQaAttempt = selectCurrentQaAttempt(parent.childTasks);
  if (currentQaAttempt && ACTIVE_QA_STATUSES.has(currentQaAttempt.status)) {
    // 活跃或已成功的 QA 直接复用；只有 FAILED/BLOCKED/CANCELLED 才走 retry 路径。
    return { created: false as const, task: currentQaAttempt };
  }

  const qa = await prisma.agent.findUnique({
    where: {
      organizationId_code: {
        organizationId: session.organizationId,
        code: "qa_verifier",
      },
    },
  });
  if (!qa) throw new ConflictError("qa_verifier is not bootstrapped");

  // 并发护栏：existing 检查与真正创建之间存在窗口，用原子 CAS 抢占。
  // QA FAILED 后 retry 时，旧的落定 claim（taskId 形态）会被这里的新占位覆盖；
  // CAS 内置的「无活跃/成功 QA」条件保证并发 retry 仍然只产生一个活跃 attempt。
  const claimToken = await claimProductRndQaSlot(parent.id, session.organizationId);
  if (!claimToken) {
    // 没抢到槽位：可能是并发请求刚建好 attempt（此时应优雅复用），也可能是另一个
    // owner 正在创建中（稍等即会可见）。绝不能用 findFirst() 任意取——那会把
    // FAILED 的旧 attempt 当成结果返回，掩盖「新 QA 正在被创建」这一事实。
    // 因此：只认最新**有效** attempt，并给并发创建留一个很短的可见窗口；
    // 超时仍无有效 attempt 才返回可重试冲突，让调用方稍后重试。
    const deadline = Date.now() + QA_CLAIM_WAIT_MS;
    for (;;) {
      const latest = await prisma.agentTask.findFirst({
        where: {
          parentTaskId: parent.id,
          organizationId: session.organizationId,
          agent: { code: "qa_verifier" },
        },
        orderBy: { createdAt: "desc" },
      });
      if (latest && ACTIVE_QA_STATUSES.has(latest.status)) {
        return { created: false as const, task: latest };
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, QA_CLAIM_POLL_MS));
    }
    throw new ConflictError(
      "Product R&D QA slot is being claimed or created by a concurrent request; retry shortly"
    );
  }

  // fencing 第 2 步：创建 QA 之前重新确认 ownership（token 匹配才续租）。
  // 失权说明 lease 已被更晚的请求接管——此时必须放弃创建，否则会产生第二个
  // 活跃 QA（旧 owner 复活导致重复执行的经典场景）。
  const stillOwner = await renewProductRndQaSlot(
    parent.id,
    session.organizationId,
    claimToken
  );
  if (!stillOwner) {
    throw new ConflictError(
      "Product R&D QA claim was taken over by a concurrent request; aborting QA creation"
    );
  }

  const resultSnapshot = specialists.map((task) => ({
    taskId: task.id,
    agentCode: task.agent.code,
    status: task.status,
    runId: task.runs[0]?.id ?? null,
    outputSummary: task.runs[0]?.outputSummary ?? null,
    errorReason: task.runs[0]?.errorReason ?? task.blockedReason ?? null,
  }));

  try {
    const delegated = await delegateAgentTask(session, {
      parentTaskId: parent.id,
      toAgentId: qa.id,
      goal:
        "独立复核五路产品研发结果：检查 claim→evidence、来源独立性、UNKNOWN、冲突、法规/成本边界、版本一致性和是否满足提交管理报告的最低标准。",
      reason:
        "Final Product R&D report requires an independent QA role that did not produce the specialist conclusions.",
      sourceRunId: parent.runs[0]?.id ?? null,
    });

    await prisma.agentTask.update({
      where: { id: delegated.childTask.id },
      data: {
        contextSnapshot: json({
          ...objectOrEmpty(delegated.childTask.contextSnapshot),
          specialistResults: resultSnapshot,
          qaContract: {
            mustCheck: [
              "claim-evidence support",
              "unknowns and contradictions",
              "source provenance",
              "regulatory scope",
              "cost basis",
              "project revision",
            ],
            maySelfVerify: false,
          },
        }),
      },
    });

    // 槽位落定（fencing 第 3 步）：必须仍持有同一 token。
    const settled = await settleProductRndQaSlot(
      parent.id,
      session.organizationId,
      claimToken,
      delegated.childTask.id
    );
    if (!settled) {
      // 已被更新的 owner 夺权：我们刚创建的 QA 是孤儿，补偿性作废，
      // 保证任一时刻最多只有一个活跃 QA。
      // 抛出后由下面的 catch 用**已失权的 token** 调 release —— token 不匹配
      // 即 no-op，绝不会误删新 owner 的 claim。
      await supersedeFencedQaTask(delegated.childTask.id);
      throw new ConflictError(
        "Product R&D QA claim was fenced out by a newer claim; the orphaned QA task was cancelled"
      );
    }

    return {
      created: true as const,
      delegation: delegated.delegation,
      task: delegated.childTask,
    };
  } catch (error) {
    await releaseProductRndQaSlot(parent.id, session.organizationId, claimToken);
    throw error;
  }
}

export async function getProductRndProgramStatus(
  session: SessionContext,
  input: { projectId: string; workItemId: string }
) {
  await requireProjectRole(session, input.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
    Role.VIEWER,
  ]);
  const workItem = await prisma.workItem.findUnique({
    where: { id: input.workItemId },
    include: {
      agentTasks: {
        where: { parentTaskId: null },
        include: {
          agent: { select: { code: true, name: true } },
          childTasks: {
            include: {
              agent: { select: { code: true, name: true } },
              runs: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  outputSummary: true,
                  errorReason: true,
                },
              },
            },
          },
        },
      },
      artifacts: {
        where: { type: "PRODUCT_RND_EXECUTIVE_REPORT" },
        orderBy: { contentVersion: "desc" },
        take: 1,
        select: {
          id: true,
          type: true,
          title: true,
          schemaVersion: true,
          contentVersion: true,
          reviewStatus: true,
          content: true,
          createdAt: true,
        },
      },
    },
  });
  if (!workItem || workItem.projectId !== input.projectId) {
    throw new NotFoundError("Product R&D work item not found");
  }
  const parent = workItem.agentTasks.find(
    (task) => task.agent.code === "hermes_pm"
  );
  return {
    workItem: {
      id: workItem.id,
      status: workItem.status,
      inputRevision: workItem.inputRevision,
    },
    parentTaskId: parent?.id ?? null,
    tasks:
      parent?.childTasks.map((task) => ({
        id: task.id,
        agentCode: task.agent.code,
        agentName: task.agent.name,
        status: task.status,
        latestRun: task.runs[0] ?? null,
      })) ?? [],
    latestReport: (() => {
      const artifact = workItem.artifacts[0];
      if (!artifact) return null;
      const preview = buildExecutiveReportPreview(artifact.content);
      const { content: _content, ...publicArtifact } = artifact;
      return { ...publicArtifact, preview };
    })(),
  };
}

function stringList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, limit)
    : [];
}

function objectList(
  value: unknown,
  limit: number
): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
        )
        .slice(0, limit)
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 把完整的 `ProductRndExecutiveReport`（artifact.content）裁剪成「负责人视图」载荷。
 *
 * 为什么要专门做一个裁剪函数，而不是让前端直接解析原始 JSON：
 * - 原始报告含全量 sourceRefs / verificationRefs / agentRunRefs，长文档会把页面打爆；
 * - 前端需要的是**已定型**的结构（每类字段都有明确上限与类型），而不是 any；
 * - 契约放在 `@/shared/executive-report-types`，服务端裁剪与客户端渲染共用一份，
 *   避免字段一改两边漂移。
 *
 * 解析失败一律返回 null（页面走空态），绝不把非法 JSON 抛给渲染层。
 */
export function buildExecutiveReportPreview(
  content: string
): ExecutiveReportPayload | null {
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(content) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    parsed = raw as Record<string, unknown>;
  } catch {
    return null;
  }

  return {
    summary: optionalString(parsed.summary),
    verificationStatus: optionalString(parsed.verificationStatus),
    conclusions: objectList(parsed.conclusions, 20).map((row) => ({
      claim: optionalString(row.claim) ?? "(未命名 claim)",
      claimKind: optionalString(row.claimKind),
      evidenceLevel: optionalString(row.evidenceLevel),
      evidenceRef: optionalString(row.evidenceRef),
      verificationRefs: stringList(row.verificationRefs, 5),
      freshness: optionalString(row.freshness),
    })),
    unknowns: stringList(parsed.unknowns, 12),
    risks: stringList(parsed.risks, 8),
    decisionsRequired: stringList(parsed.decisionsRequired, 8),
    recommendedActions: stringList(parsed.recommendedActions, 8),
    assumptions: stringList(parsed.assumptions, 8),
    advisoryNotes: objectList(parsed.advisoryNotes, 12).map((row) => ({
      agentCode: optionalString(row.agentCode) ?? "unknown",
      agentName: optionalString(row.agentName),
      status: optionalString(row.status),
      summary: optionalString(row.summary),
      errorReason: optionalString(row.errorReason),
    })),
    provenance: {
      sourceRefs: objectList(parsed.sourceRefs, 50).map(
        (row) => `evidence:${optionalString(row.id) ?? "unknown"}`
      ),
      agentRunRefs: stringList(parsed.agentRunRefs, 50),
      modelRunRefs: stringList(parsed.modelRunRefs, 50),
      knowledgeDebtRefs: stringList(parsed.knowledgeDebtRefs, 50),
      researchSnapshotRef: optionalString(parsed.researchSnapshotRef),
    },
  };
}

export async function synthesizeProductRndExecutiveReport(
  session: SessionContext,
  input: {
    projectId: string;
    workItemId: string;
    parentTaskId: string;
  }
) {
  await requireProjectRole(session, input.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
  ]);

  const [project, workItem, parent, latestResearch] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        organizationId: true,
        revision: true,
        title: true,
        productId: true,
        productVersionId: true,
      },
    }),
    prisma.workItem.findUnique({
      where: { id: input.workItemId },
      select: {
        id: true,
        projectId: true,
        inputRevision: true,
        status: true,
        currentSubmissionId: true,
      },
    }),
    prisma.agentTask.findUnique({
      where: { id: input.parentTaskId },
      include: {
        agent: { select: { code: true } },
        childTasks: {
          include: {
            agent: { select: { code: true, name: true } },
            runs: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                modelRuns: {
                  select: { id: true, status: true, provider: true, modelId: true },
                },
              },
            },
          },
        },
      },
    }),
    getLatestPublishedRun(session, input.projectId),
  ]);

  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found");
  }
  if (!workItem || workItem.projectId !== project.id) {
    throw new NotFoundError("Product R&D work item not found");
  }
  if (
    !parent ||
    parent.organizationId !== session.organizationId ||
    parent.workItemId !== workItem.id ||
    parent.agent.code !== "hermes_pm"
  ) {
    throw new NotFoundError("Product R&D parent task not found");
  }

  if (workItem.status === "SUBMITTED" || workItem.status === "ACCEPTED") {
    const existing = await prisma.artifact.findFirst({
      where: {
        workItemId: workItem.id,
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
        ...(workItem.currentSubmissionId
          ? { submissionId: workItem.currentSubmissionId }
          : {}),
      },
      orderBy: [{ contentVersion: "desc" }, { createdAt: "desc" }],
    });
    if (existing) {
      let report: ProductRndExecutiveReport | null = null;
      try {
        report = JSON.parse(existing.content) as ProductRndExecutiveReport;
      } catch {
        report = null;
      }
      return {
        report,
        artifact: existing,
        submission: null,
        receipt: null,
        isLateArrival: false,
        alreadySynthesized: true as const,
      };
    }
  }

  const activeTasks = parent.childTasks.filter(
    (task) =>
      task.status === AgentTaskStatus.QUEUED ||
      task.status === AgentTaskStatus.RUNNING ||
      task.status === AgentTaskStatus.SUBMITTED
  );
  if (activeTasks.length) {
    throw new ConflictError(
      `Product R&D tasks are still active: ${activeTasks
        .map((task) => `${task.agent.code}:${task.status}`)
        .join(", ")}`
    );
  }

  const qaTask = selectCurrentQaAttempt(parent.childTasks);
  const verificationStatus =
    qaTask?.status === AgentTaskStatus.SUCCEEDED
      ? "READY_FOR_HUMAN_REVIEW"
      : qaTask
        ? "BLOCKED_BY_QA"
        : "PARTIAL";

  const [evidences, dataGaps, knowledgeDebts] = await Promise.all([
    prisma.evidence.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
      include: {
        claims: {
          include: {
            verifications: {
              orderBy: { checkedAt: "desc" },
              take: 5,
            },
          },
        },
      },
    }),
    prisma.dataGap.findMany({
      where: { projectId: project.id, status: "OPEN" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.knowledgeDebt.findMany({
      where: {
        organizationId: session.organizationId,
        status: "OPEN",
        OR: [{ projectId: project.id }, { projectId: null }],
      },
      orderBy: [{ importance: "desc" }, { lastSeenAt: "desc" }],
      take: 50,
    }),
  ]);

  const conclusions = evidences.flatMap((evidence) =>
    evidence.claims.map((claim) => ({
      claim: claim.value,
      claimKind: claim.kind,
      evidenceLevel: claim.evidenceLevel,
      evidenceRef: `evidence:${evidence.id}`,
      verificationRefs: claim.verifications.map(
        (verification) => `verification:${verification.id}`
      ),
      freshness: claim.freshness,
    }))
  );

  const specialistNotes = parent.childTasks.map((task) => {
    const run = task.runs[0];
    return {
      agentCode: task.agent.code,
      agentName: task.agent.name,
      taskId: task.id,
      status: task.status,
      runId: run?.id ?? null,
      summary: run?.outputSummary ?? null,
      errorReason: run?.errorReason ?? task.blockedReason ?? null,
    };
  });

  // 诚实守卫：专家任务可能「成功」但只留下叙述性摘要、没有把 claim / 缺口结构化落库。
  // 这种情况下 conclusions 为空、evidences 为空，报告会显示成一份「0 个未闭合项」的健康报告，
  // 而摘要区自己却写着「标注 2 个来源缺口 / 关键 claim 证据等级 UNKNOWN 待补」——
  // 这是报告自相矛盾，必须显式登记为未闭合项，而不是让它静默通过。
  // 注意：这里只做「零证据绑定」这种可判定的检查，不去解析专家自由文本（那会变成猜测）。
  const hasNoBoundEvidence = evidences.length === 0;

  // 诚实守卫（逐项）：任务被标记 SUCCEEDED，但**没有 AgentRun 回执**——
  // 「完成」没有执行留痕，等于没有可信证据支撑它是真跑完的（可能是状态被直接改写）。
  // 这类任务必须在报告里显式点名，而不是混在「已汇总 N 个数字员工任务」里当成正常产出。
  const succeededWithoutReceipt = specialistNotes.filter(
    (note) => note.status === AgentTaskStatus.SUCCEEDED && !note.runId
  );

  // 诚实守卫（逐项）：claim 没有「最新一次核验为 SUPPORTED」的来源验证。
  // verifications 已按 checkedAt desc 查询，[0] 即最新一次核验：
  // - 完全没有核验 → NO_VERIFICATION
  // - 最新一次是 CONTRADICTED / NOT_FOUND / AMBIGUOUS → 结论已不被来源支持
  // 两种情况都不能当作可用结论，必须列为未闭合项。
  const claimsWithoutSupportedVerification = evidences.flatMap((evidence) =>
    evidence.claims
      .filter((claim) => claim.verifications[0]?.supportStatus !== "SUPPORTED")
      .map((claim) => ({
        claim: claim.value,
        latest: claim.verifications[0]?.supportStatus ?? "NO_VERIFICATION",
      }))
  );

  const unknowns = [
    ...dataGaps.map(
      (gap) => `${gap.fieldName}: ${gap.description}`
    ),
    ...knowledgeDebts.map((debt) => `${debt.topic}: ${debt.reason}`),
    ...conclusions
      .filter((conclusion) => conclusion.evidenceLevel === "UNKNOWN")
      .map((conclusion) => `证据未闭合：${conclusion.claim}`),
    ...specialistNotes
      .filter((note) => note.status !== AgentTaskStatus.SUCCEEDED)
      .map(
        (note) =>
          `${note.agentName} 未成功完成：${note.errorReason ?? note.status}`
      ),
    ...succeededWithoutReceipt.map(
      (note) =>
        `${note.agentName} 标记为成功但没有 AgentRun 回执：无可信执行留痕，产出不得视为已验证。`
    ),
    ...claimsWithoutSupportedVerification.map(
      (item) =>
        `结论缺少 SUPPORTED 来源验证（最新核验：${item.latest}）：${item.claim}`
    ),
    ...(hasNoBoundEvidence
      ? [
          `报告未绑定任何结构化证据（${specialistNotes.length} 个专家任务均未落 claim）：` +
            "现有摘要属专家意见而非可追溯结论，不得作为业务批准依据。",
        ]
      : []),
  ];
  const uniqueUnknowns = [...new Set(unknowns.filter(Boolean))];

  const risks = [
    ...(latestResearch
      ? []
      : ["当前没有已发布 ResearchRunSnapshot；市场/研究汇总仍不完整。"]),
    ...(verificationStatus === "READY_FOR_HUMAN_REVIEW"
      ? []
      : ["独立 QA 尚未通过，报告不得作为自动业务批准依据。"]),
    ...(succeededWithoutReceipt.length
      ? [
          `存在 ${succeededWithoutReceipt.length} 个标记成功但无 AgentRun 回执的任务：其产出不可作为交付依据。`,
        ]
      : []),
    ...(claimsWithoutSupportedVerification.length
      ? [
          `存在 ${claimsWithoutSupportedVerification.length} 条最新核验非 SUPPORTED 的结论：不得直接作为业务批准依据。`,
        ]
      : []),
    ...(hasNoBoundEvidence
      ? ["报告零证据绑定：所有结论都无法沿引用回到原始来源。"]
      : []),
    ...(uniqueUnknowns.length
      ? ["仍存在未闭合证据/数据/专业任务缺口。"]
      : []),
  ];

  const agentRunRefs = [
    ...new Set(
      parent.childTasks
        .map((task) => task.runs[0]?.id)
        .filter((value): value is string => Boolean(value))
        .map((id) => `agent-run:${id}`)
    ),
  ];
  const modelRunRefs = [
    ...new Set(
      parent.childTasks.flatMap((task) =>
        (task.runs[0]?.modelRuns ?? []).map(
          (modelRun) => `model-run:${modelRun.id}`
        )
      )
    ),
  ];
  const evidenceIds = evidences.map((evidence) => evidence.id);
  const report: ProductRndExecutiveReport = {
    schemaVersion: "1.0",
    sourceRefs: evidences.map((evidence) => ({
      id: evidence.id,
      hash: evidence.hash,
      ...(evidence.fetchedAt
        ? { retrievedAt: evidence.fetchedAt.toISOString() }
        : {}),
    })),
    assumptions: [],
    missingInputs: uniqueUnknowns,
    summary:
      `已汇总 ${parent.childTasks.length} 个数字员工任务、${evidences.length} 条证据、${conclusions.length} 条 claim；` +
      `当前 ${uniqueUnknowns.length} 个未闭合项，QA 状态：${verificationStatus}。`,
    conclusions,
    risks,
    unknowns: uniqueUnknowns,
    decisionsRequired:
      uniqueUnknowns.length || verificationStatus !== "READY_FOR_HUMAN_REVIEW"
        ? ["是否继续补证/返工，直到关键 UNKNOWN 与 QA 阻断项闭合。"]
        : ["是否将本报告提交进入下一业务决策门（例如 G1 研发/打样授权）。"],
    recommendedActions: [
      ...(uniqueUnknowns.length
        ? ["优先处理高影响 DataGap / KnowledgeDebt，并对关键 claim 补官方/一级来源。"]
        : []),
      ...(verificationStatus !== "READY_FOR_HUMAN_REVIEW"
        ? ["完成或重新执行独立 QA，禁止由原执行 Agent 自证。"]
        : ["由负责人审查并验收本 WorkItem，再决定是否进入业务 Gate。"]),
    ],
    knowledgeDebtRefs: knowledgeDebts.map(
      (debt) => `knowledge-debt:${debt.id}`
    ),
    advisoryNotes: specialistNotes,
    agentRunRefs,
    modelRunRefs,
    researchSnapshotRef: latestResearch?.snapshot?.id
      ? `research-snapshot:${latestResearch.snapshot.id}`
      : null,
    verificationStatus,
  };

  const submitted = await submitWork(session, workItem.id, {
    inputRevision: workItem.inputRevision,
    runMode: RunMode.AUTOMATED,
    artifacts: [
      {
        type: "PRODUCT_RND_EXECUTIVE_REPORT",
        title: `${project.title} · 产品研发综合报告`,
        content: JSON.stringify(report),
        schemaVersion: "1.0",
        evidenceRefs: evidenceIds,
      },
    ],
  });

  return {
    report,
    artifact: submitted.artifacts[0] ?? null,
    submission: "submission" in submitted ? submitted.submission : null,
    receipt: submitted.receipt,
    isLateArrival: submitted.isLateArrival,
  };
}


export async function advanceProductRndProgram(
  session: SessionContext,
  parentTaskId: string
) {
  const parent = await prisma.agentTask.findUnique({
    where: { id: parentTaskId },
    include: {
      agent: { select: { code: true } },
      workItem: {
        select: {
          id: true,
          projectId: true,
          status: true,
        },
      },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, status: true },
      },
      childTasks: {
        include: {
          agent: { select: { code: true, name: true } },
        },
      },
    },
  });

  if (
    !parent ||
    parent.organizationId !== session.organizationId ||
    parent.agent.code !== "hermes_pm" ||
    !parent.workItem
  ) {
    throw new NotFoundError("Product R&D parent task not found");
  }
  const context = objectOrEmpty(parent.contextSnapshot);
  if (context.schemaVersion !== "product-rnd-program/v1") {
    throw new UnprocessableEntityError("AgentTask is not a Product R&D program");
  }
  await requireProjectRole(session, parent.workItem.projectId, [
    Role.OWNER,
    Role.DECISION_MAKER,
  ]);

  if (
    parent.status === AgentTaskStatus.SUCCEEDED ||
    parent.status === AgentTaskStatus.FAILED ||
    parent.status === AgentTaskStatus.CANCELLED
  ) {
    return {
      phase: "TERMINAL" as const,
      parentTaskId: parent.id,
      parentStatus: parent.status,
    };
  }

  const required = new Set(
    PRODUCT_RND_SPECIALISTS.map((specialist) => specialist.code)
  );
  const specialistTasks = parent.childTasks.filter((task) =>
    required.has(task.agent.code as (typeof PRODUCT_RND_SPECIALISTS)[number]["code"])
  );
  const missing = [...required].filter(
    (code) => !specialistTasks.some((task) => task.agent.code === code)
  );
  if (missing.length) {
    throw new ConflictError(
      `Product R&D program is missing specialist tasks: ${missing.join(", ")}`
    );
  }

  const activeSpecialists = specialistTasks.filter(
    (task) => !TERMINAL_SPECIALIST_STATES.has(task.status)
  );
  if (activeSpecialists.length) {
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: { blockedReason: null },
    });
    return {
      phase: "WAITING_SPECIALISTS" as const,
      parentTaskId: parent.id,
      activeTaskIds: activeSpecialists.map((task) => task.id),
    };
  }

  const researchRunId =
    typeof context.researchRunId === "string" ? context.researchRunId : null;
  if (!researchRunId) {
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: { blockedReason: "Product R&D program is missing researchRunId." },
    });
    return {
      phase: "BLOCKED_RESEARCH" as const,
      parentTaskId: parent.id,
      reason: "MISSING_RESEARCH_RUN",
    };
  }

  const researchRun = await prisma.researchRun.findUnique({
    where: { id: researchRunId },
    select: { id: true, projectId: true, status: true, errorReason: true },
  });
  if (!researchRun || researchRun.projectId !== parent.workItem.projectId) {
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: { blockedReason: "Product R&D ResearchRun is missing or mismatched." },
    });
    return {
      phase: "BLOCKED_RESEARCH" as const,
      parentTaskId: parent.id,
      reason: "RESEARCH_RUN_NOT_FOUND",
    };
  }
  if (researchRun.status === ResearchRunStatus.FAILED) {
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: {
        blockedReason:
          ("ResearchRun failed: " + (researchRun.errorReason ?? "unknown")).slice(0, 1000),
      },
    });
    return {
      phase: "BLOCKED_RESEARCH" as const,
      parentTaskId: parent.id,
      researchRunId: researchRun.id,
      reason: researchRun.errorReason ?? "RESEARCH_FAILED",
    };
  }
  if (researchRun.status !== ResearchRunStatus.PUBLISHED) {
    return {
      phase: "WAITING_RESEARCH" as const,
      parentTaskId: parent.id,
      researchRunId: researchRun.id,
      researchStatus: researchRun.status,
    };
  }

  const qaTask = selectCurrentQaAttempt(parent.childTasks);
  if (!qaTask) {
    const queued = await queueProductRndQa(session, {
      parentTaskId: parent.id,
    });
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: { blockedReason: null },
    });
    return {
      phase: "QA_QUEUED" as const,
      parentTaskId: parent.id,
      qaTaskId: queued.task.id,
    };
  }

  if (
    qaTask.status === AgentTaskStatus.QUEUED ||
    qaTask.status === AgentTaskStatus.RUNNING ||
    qaTask.status === AgentTaskStatus.SUBMITTED
  ) {
    return {
      phase: "WAITING_QA" as const,
      parentTaskId: parent.id,
      qaTaskId: qaTask.id,
      qaStatus: qaTask.status,
    };
  }

  if (qaTask.status !== AgentTaskStatus.SUCCEEDED) {
    await prisma.agentTask.update({
      where: { id: parent.id },
      data: {
        blockedReason:
          "Independent QA did not pass; human review or QA retry is required.",
      },
    });
    return {
      phase: "BLOCKED_BY_QA" as const,
      parentTaskId: parent.id,
      qaTaskId: qaTask.id,
      qaStatus: qaTask.status,
    };
  }

  const synthesized = await synthesizeProductRndExecutiveReport(session, {
    projectId: parent.workItem.projectId,
    workItemId: parent.workItem.id,
    parentTaskId: parent.id,
  });

  const runningParentRun = parent.runs.find((run) => run.status === "RUNNING");
  if (runningParentRun && parent.status === AgentTaskStatus.RUNNING) {
    await finishAgentTask(session, parent.id, {
      runId: runningParentRun.id,
      outcome: "SUCCEEDED",
      resultSummary:
        "产品研发专业分工、ResearchRun、独立 QA 与结构化 Executive Report 已完成，等待负责人审查并决定是否进入业务 Gate。",
    });
  }

  return {
    phase: "REPORT_READY" as const,
    parentTaskId: parent.id,
    qaTaskId: qaTask.id,
    artifactId: synthesized.artifact?.id ?? null,
    alreadySynthesized:
      "alreadySynthesized" in synthesized
        ? synthesized.alreadySynthesized
        : false,
  };
}
