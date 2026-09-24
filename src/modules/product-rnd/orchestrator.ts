import {
  AgentTaskStatus,
  AgentTriggerType,
  Prisma,
  ResearchRunStatus,
  Role,
  RunMode,
  WorkExecutorType,
} from "@prisma/client";
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

  const { byCode, squad } = await loadProductRndWorkforce(session.organizationId);

  const workItem = await createWorkItem(session, project.id, {
    title: "产品研发综合评估",
    target: brief.slice(0, 500),
    deliverableReq:
      "形成市场、科学、配方、法规、成本五路专业结论，经独立 QA 后提交 PRODUCT_RND_EXECUTIVE_REPORT；所有未知项必须显式保留。",
    executorType: WorkExecutorType.DIGITAL_WORKER,
  });

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
  };
}

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

  const existing = parent.childTasks.find(
    (task) => task.agent.code === "qa_verifier"
  );
  if (existing) return { created: false as const, task: existing };

  const qa = await prisma.agent.findUnique({
    where: {
      organizationId_code: {
        organizationId: session.organizationId,
        code: "qa_verifier",
      },
    },
  });
  if (!qa) throw new ConflictError("qa_verifier is not bootstrapped");

  const resultSnapshot = specialists.map((task) => ({
    taskId: task.id,
    agentCode: task.agent.code,
    status: task.status,
    runId: task.runs[0]?.id ?? null,
    outputSummary: task.runs[0]?.outputSummary ?? null,
    errorReason: task.runs[0]?.errorReason ?? task.blockedReason ?? null,
  }));

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

  return {
    created: true as const,
    delegation: delegated.delegation,
    task: delegated.childTask,
  };
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
      let preview: {
        summary?: string;
        verificationStatus?: string;
        unknowns?: string[];
        risks?: string[];
        decisionsRequired?: string[];
      } | null = null;
      try {
        const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
        preview = {
          summary:
            typeof parsed.summary === "string" ? parsed.summary : undefined,
          verificationStatus:
            typeof parsed.verificationStatus === "string"
              ? parsed.verificationStatus
              : undefined,
          unknowns: Array.isArray(parsed.unknowns)
            ? parsed.unknowns.filter(
                (item): item is string => typeof item === "string"
              ).slice(0, 8)
            : [],
          risks: Array.isArray(parsed.risks)
            ? parsed.risks.filter(
                (item): item is string => typeof item === "string"
              ).slice(0, 6)
            : [],
          decisionsRequired: Array.isArray(parsed.decisionsRequired)
            ? parsed.decisionsRequired.filter(
                (item): item is string => typeof item === "string"
              ).slice(0, 6)
            : [],
        };
      } catch {
        preview = null;
      }
      const { content: _content, ...publicArtifact } = artifact;
      return { ...publicArtifact, preview };
    })(),
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

  const qaTask = parent.childTasks.find(
    (task) => task.agent.code === "qa_verifier"
  );
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
  ];
  const uniqueUnknowns = [...new Set(unknowns.filter(Boolean))];

  const risks = [
    ...(latestResearch
      ? []
      : ["当前没有已发布 ResearchRunSnapshot；市场/研究汇总仍不完整。"]),
    ...(verificationStatus === "READY_FOR_HUMAN_REVIEW"
      ? []
      : ["独立 QA 尚未通过，报告不得作为自动业务批准依据。"]),
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

  const qaTask = parent.childTasks.find(
    (task) => task.agent.code === "qa_verifier"
  );
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
