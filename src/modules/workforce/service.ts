import {
  AgentAccessMode,
  AgentLifecycleStatus,
  AgentTaskStatus,
  AgentTriggerType,
  DelegationStatus,
  DecisionRunPolicyAction,
  Prisma,
  Role,
  SquadMemberType,
} from "@prisma/client";
import prisma from "@/shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "@/shared/errors";
import { createAuditEventInTx } from "@/shared/audit";
import { SessionContext, requireProjectRole } from "@/modules/identity/session";
import { isOrgAdmin } from "@/modules/identity/admin";

const DEFAULT_AGENTS = [
  {
    code: "hermes_pm",
    name: "Hermes PM",
    roleKey: "PRODUCT_LEAD",
    description: "产品负责人和数字员工团队 leader，负责拆解、路由、复核与需要人类拍板时升级。",
    instructions:
      "先判断目标、证据和约束，再决定自己分析还是委派。不得绕过治理写入；需要业务修改时生成受控提议并等待授权。",
    maxConcurrentTasks: 3,
  },
  {
    code: "product_agent",
    name: "Product Agent",
    roleKey: "PRODUCT",
    description: "负责产品定义、用户价值、差异化、方案结构和版本建议。",
    instructions: "围绕产品定义形成结构化结论，明确事实、推断、未知项和建议动作。",
    maxConcurrentTasks: 2,
  },
  {
    code: "research_agent",
    name: "Research Agent",
    roleKey: "RESEARCH",
    description: "负责市场、竞品、科学和外部证据研究。",
    instructions: "优先补证据与来源，区分 FACT / CLAIM / INFERENCE，不把推断包装成事实。",
    maxConcurrentTasks: 3,
  },
  {
    code: "marketing_agent",
    name: "Marketing Agent",
    roleKey: "MARKETING",
    description: "负责渠道、用户沟通、上市策略和市场表达。",
    instructions: "输出渠道与传播方案时绑定目标人群、场景、证据和可验证指标。",
    maxConcurrentTasks: 2,
  },
  {
    code: "ops_agent",
    name: "Ops Agent",
    roleKey: "OPS",
    description: "负责执行计划、供应链、交付风险、里程碑与运营闭环。",
    instructions: "把策略转为可执行任务、依赖、负责人、截止条件和风险升级规则。",
    maxConcurrentTasks: 2,
  },
  {
    code: "red_team",
    name: "Red Team",
    roleKey: "RED_TEAM",
    description: "负责证伪、反例、风险挑战和决策压力测试。",
    instructions: "优先寻找证据缺口、反例和失败路径；不为了唱反调而制造没有证据的风险。",
    maxConcurrentTasks: 2,
  },
] as const;

const DEFAULT_SKILLS = [
  {
    key: "pm_orchestration",
    name: "产品负责人编排",
    description: "任务拆解、路由、升级、复核与人类决策门。",
    instructions:
      "先识别任务属于分析、补证、执行还是决策；选择最合适的 Agent；定义可验收交付物；重大业务写入必须进入治理链。",
  },
  {
    key: "product_strategy",
    name: "产品策略",
    description: "产品定义、价值主张、路线比较和版本建议。",
    instructions:
      "输出 conclusion、facts/claims/inferences、unknowns、risks、recommended actions，并绑定当前 ProductVersion。",
  },
  {
    key: "evidence_research",
    name: "证据研究",
    description: "市场、竞品、科学证据检索与来源核验。",
    instructions:
      "优先一手和高可信来源；记录来源、时间和适用范围；冲突证据并列呈现，不自动合并。",
  },
  {
    key: "go_to_market",
    name: "上市与渠道",
    description: "渠道机制、内容表达、上市计划和增长实验。",
    instructions:
      "每条建议都说明目标人群、渠道、机制、成本/约束和验证指标。",
  },
  {
    key: "operational_delivery",
    name: "执行交付",
    description: "把方案拆成依赖、任务、里程碑和风险处置。",
    instructions:
      "明确依赖、输入、交付要求和阻塞升级条件；不把未完成动作标记为已完成。",
  },
  {
    key: "red_team_challenge",
    name: "红队挑战",
    description: "证伪关键假设、发现反例和决策风险。",
    instructions:
      "挑战最关键且最脆弱的假设；区分可证伪问题、未知项和主观偏好；给出补证据路径。",
  },
] as const;

const DEFAULT_BINDINGS: Record<string, string[]> = {
  hermes_pm: ["pm_orchestration", "product_strategy", "red_team_challenge"],
  product_agent: ["product_strategy"],
  research_agent: ["evidence_research"],
  marketing_agent: ["go_to_market"],
  ops_agent: ["operational_delivery"],
  red_team: ["red_team_challenge", "evidence_research"],
};

const DEFAULT_SQUAD_CODE = "product_core";

async function assertWorkforceAdmin(session: SessionContext) {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError("Only organization admins can configure the digital workforce");
  }
}

async function assertCanInvokeAgent(
  session: SessionContext,
  agent: {
    organizationId: string;
    ownerId: string | null;
    accessMode: AgentAccessMode;
    status: AgentLifecycleStatus;
  }
) {
  if (agent.organizationId !== session.organizationId) {
    throw new NotFoundError("Agent not found");
  }
  if (agent.status !== AgentLifecycleStatus.ACTIVE) {
    throw new ConflictError("Agent is not active");
  }
  if (
    agent.ownerId === session.userId ||
    agent.accessMode === AgentAccessMode.ORGANIZATION
  ) {
    return;
  }
  // OWNER_ONLY 同时是调用权限与可见性边界；不要用 403 暴露一个不可见 Agent 的存在。
  throw new NotFoundError("Agent not found");
}

export async function bootstrapDefaultWorkforce(session: SessionContext) {
  await assertWorkforceAdmin(session);

  return prisma.$transaction(async (tx) => {
    const agents = new Map<string, { id: string; code: string }>();
    for (const spec of DEFAULT_AGENTS) {
      const agent = await tx.agent.upsert({
        where: {
          organizationId_code: {
            organizationId: session.organizationId,
            code: spec.code,
          },
        },
        create: {
          organizationId: session.organizationId,
          ...spec,
          ownerId: session.userId,
          accessMode: AgentAccessMode.ORGANIZATION,
          isSystem: true,
        },
        update: {
          name: spec.name,
          roleKey: spec.roleKey,
          description: spec.description,
          instructions: spec.instructions,
          maxConcurrentTasks: spec.maxConcurrentTasks,
          accessMode: AgentAccessMode.ORGANIZATION,
          isSystem: true,
        },
        select: { id: true, code: true },
      });
      agents.set(agent.code, agent);
    }

    const skills = new Map<string, { id: string; key: string }>();
    for (const spec of DEFAULT_SKILLS) {
      const skill = await tx.skill.upsert({
        where: {
          organizationId_key: {
            organizationId: session.organizationId,
            key: spec.key,
          },
        },
        create: {
          organizationId: session.organizationId,
          ...spec,
          createdById: session.userId,
        },
        update: {
          name: spec.name,
          description: spec.description,
          instructions: spec.instructions,
        },
        select: { id: true, key: true },
      });
      skills.set(skill.key, skill);
    }

    for (const [agentCode, skillKeys] of Object.entries(DEFAULT_BINDINGS)) {
      const agent = agents.get(agentCode);
      if (!agent) continue;
      for (const skillKey of skillKeys) {
        const skill = skills.get(skillKey);
        if (!skill) continue;
        await tx.agentSkill.upsert({
          where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
          create: {
            agentId: agent.id,
            skillId: skill.id,
            assignedById: session.userId,
          },
          update: { enabled: true },
        });
      }
    }

    const leader = agents.get("hermes_pm");
    if (!leader) throw new Error("Hermes PM bootstrap invariant failed");

    const squad = await tx.squad.upsert({
      where: {
        organizationId_code: {
          organizationId: session.organizationId,
          code: DEFAULT_SQUAD_CODE,
        },
      },
      create: {
        organizationId: session.organizationId,
        code: DEFAULT_SQUAD_CODE,
        name: "Hermes Product Squad",
        description: "Hermes PM 领导的核心产品数字员工团队。",
        instructions:
          "Leader 负责拆解与路由；成员提交结果后由 Leader 复核。需要改变业务事实时进入 Governance Kernel，需要人类判断时进入 WAITING_HUMAN。",
        leaderAgentId: leader.id,
        createdById: session.userId,
      },
      update: {
        leaderAgentId: leader.id,
        name: "Hermes Product Squad",
      },
      select: { id: true, code: true, leaderAgentId: true },
    });

    for (const agent of agents.values()) {
      await tx.squadMember.upsert({
        where: { squadId_agentId: { squadId: squad.id, agentId: agent.id } },
        create: {
          squadId: squad.id,
          memberType: SquadMemberType.AGENT,
          agentId: agent.id,
          roleDescription:
            agent.code === "hermes_pm"
              ? "Leader：拆解、路由、复核与升级"
              : "Specialist：" + agent.code,
        },
        update: {},
      });
    }

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "WORKFORCE_BOOTSTRAPPED",
      objectType: "Squad",
      objectId: squad.id,
      summary: "初始化 Hermes 数字产品团队与默认 Skills",
      details: {
        agentCodes: [...agents.keys()],
        skillKeys: [...skills.keys()],
        squadCode: squad.code,
      } as Prisma.InputJsonValue,
    });

    return {
      agents: [...agents.values()],
      skills: [...skills.values()],
      squad,
    };
  });
}

export async function getWorkforceOverview(session: SessionContext) {
  const admin = await isOrgAdmin(session);
  const agents = await prisma.agent.findMany({
    where: {
      organizationId: session.organizationId,
      ...(admin
        ? {}
        : {
            OR: [
              { ownerId: session.userId },
              { accessMode: AgentAccessMode.ORGANIZATION },
            ],
          }),
    },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    include: {
      skillBindings: {
        where: { enabled: true },
        include: { skill: true },
      },
      _count: { select: { tasks: true, runs: true } },
    },
  });
  const visibleAgentIds = agents.map((agent) => agent.id);

  const [squads, taskGroups, waitingTasks] = await Promise.all([
    prisma.squad.findMany({
      where: {
        organizationId: session.organizationId,
        leaderAgentId: { in: visibleAgentIds },
      },
      orderBy: { createdAt: "asc" },
      include: {
        leader: { select: { id: true, code: true, name: true } },
        members: {
          include: {
            agent: { select: { id: true, code: true, name: true, status: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.agentTask.groupBy({
      by: ["agentId", "status"],
      where: {
        organizationId: session.organizationId,
        agentId: { in: visibleAgentIds },
      },
      _count: { _all: true },
    }),
    prisma.agentTask.findMany({
      where: {
        organizationId: session.organizationId,
        agentId: { in: visibleAgentIds },
        status: AgentTaskStatus.WAITING_HUMAN,
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        goal: true,
        blockedReason: true,
        updatedAt: true,
        agent: { select: { id: true, code: true, name: true } },
        workItem: { select: { id: true, title: true, projectId: true } },
      },
    }),
  ]);

  const counts = new Map<string, Partial<Record<AgentTaskStatus, number>>>();
  for (const row of taskGroups) {
    const current = counts.get(row.agentId) ?? {};
    current[row.status] = row._count._all;
    counts.set(row.agentId, current);
  }

  return {
    agents: agents.map((agent) => {
      const count = counts.get(agent.id) ?? {};
      const running = count.RUNNING ?? 0;
      const queued = count.QUEUED ?? 0;
      const waitingHuman = count.WAITING_HUMAN ?? 0;
      return {
        ...agent,
        presence: {
          availability:
            agent.status === AgentLifecycleStatus.ARCHIVED
              ? "ARCHIVED"
              : agent.status === AgentLifecycleStatus.PAUSED
                ? "PAUSED"
                : "READY",
          workload: running > 0 ? "WORKING" : queued > 0 ? "QUEUED" : "IDLE",
          running,
          queued,
          waitingHuman,
          capacity: agent.maxConcurrentTasks,
        },
      };
    }),
    squads: squads.map((squad) => ({
      ...squad,
      members: squad.members.filter(
        (member) =>
          member.userId !== null ||
          member.agentId === null ||
          visibleAgentIds.includes(member.agentId)
      ),
    })),
    waitingTasks,
  };
}

export interface CreateAgentTaskInput {
  agentId: string;
  workItemId?: string | null;
  squadId?: string | null;
  goal: string;
  contextSnapshot?: Prisma.InputJsonValue;
  priority?: number;
  triggerType?: AgentTriggerType;
  triggerRef?: string | null;
  /** Primary Decision Intelligence provenance for autonomous/event routing. */
  triggerDecisionRunId?: string | null;
}

export async function createAgentTask(
  session: SessionContext,
  input: CreateAgentTaskInput
) {
  const goal = input.goal?.trim();
  if (!goal) throw new UnprocessableEntityError("Agent task goal is required");
  const priority = input.priority ?? 50;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    throw new UnprocessableEntityError("priority must be an integer between 0 and 100");
  }

  const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || agent.organizationId !== session.organizationId) {
    throw new NotFoundError("Agent not found");
  }
  await assertCanInvokeAgent(session, agent);

  if (input.workItemId) {
    const workItem = await prisma.workItem.findUnique({
      where: { id: input.workItemId },
      select: { id: true, projectId: true, project: { select: { organizationId: true } } },
    });
    if (!workItem || workItem.project.organizationId !== session.organizationId) {
      throw new NotFoundError("Work item not found");
    }
    await requireProjectRole(session, workItem.projectId, [Role.OWNER, Role.DECISION_MAKER]);
  }

  let triggerDecisionRun:
    | {
        id: string;
        organizationId: string;
        decisionKey: string;
        policyAction: DecisionRunPolicyAction;
        resultJson: Prisma.JsonValue;
      }
    | null = null;

  if (input.triggerDecisionRunId) {
    triggerDecisionRun = await prisma.decisionRun.findUnique({
      where: { id: input.triggerDecisionRunId },
      select: {
        id: true,
        organizationId: true,
        decisionKey: true,
        policyAction: true,
        resultJson: true,
      },
    });

    if (
      !triggerDecisionRun ||
      triggerDecisionRun.organizationId !== session.organizationId
    ) {
      throw new NotFoundError("Decision run not found");
    }

    if (
      triggerDecisionRun.policyAction === DecisionRunPolicyAction.ESCALATE_HUMAN ||
      triggerDecisionRun.policyAction === DecisionRunPolicyAction.BLOCK
    ) {
      throw new UnprocessableEntityError(
        "Decision run does not authorize creation of an AgentTask"
      );
    }

    const result =
      triggerDecisionRun.resultJson &&
      typeof triggerDecisionRun.resultJson === "object" &&
      !Array.isArray(triggerDecisionRun.resultJson)
        ? (triggerDecisionRun.resultJson as Record<string, unknown>)
        : null;

    if (triggerDecisionRun.policyAction === DecisionRunPolicyAction.ESCALATE_AGENT) {
      // Escalation means “send to the PM/reviewer”, never “trust the model's
      // proposed specialist anyway”.
      if (agent.code !== "hermes_pm") {
        throw new UnprocessableEntityError(
          "ESCALATE_AGENT decision can only create a Hermes PM review task"
        );
      }
    } else if (triggerDecisionRun.policyAction === DecisionRunPolicyAction.AUTO) {
      const autonomousTriggerTypes: AgentTriggerType[] = [
        AgentTriggerType.AUTOPILOT,
        AgentTriggerType.EVENT,
        AgentTriggerType.SYSTEM,
      ];
      if (
        !autonomousTriggerTypes.includes(
          input.triggerType ?? AgentTriggerType.MANUAL
        )
      ) {
        throw new UnprocessableEntityError(
          "AUTO decision provenance requires AUTOPILOT, EVENT, or SYSTEM triggerType"
        );
      }

      switch (triggerDecisionRun.decisionKey) {
        case "workforce.route_agent":
          if (!result || typeof result.value !== "string" || result.value !== agent.code) {
            throw new UnprocessableEntityError(
              "Route decision result does not match the selected Agent"
            );
          }
          break;

        case "signal.should_wake_pm":
          if (result?.value !== true || agent.code !== "hermes_pm") {
            throw new UnprocessableEntityError(
              "Signal wake decision must be true and target Hermes PM"
            );
          }
          break;

        default:
          throw new UnprocessableEntityError(
            "DecisionSpec is not allowed to directly trigger an AgentTask"
          );
      }
    }
  }

  if (input.squadId) {
    const squad = await prisma.squad.findUnique({
      where: { id: input.squadId },
      include: { members: { where: { agentId: input.agentId } } },
    });
    if (
      !squad ||
      squad.organizationId !== session.organizationId ||
      (squad.leaderAgentId !== input.agentId && squad.members.length === 0)
    ) {
      throw new UnprocessableEntityError("Agent is not an active member of the selected squad");
    }
  }

  return prisma.$transaction(async (tx) => {
    const task = await tx.agentTask.create({
      data: {
        organizationId: session.organizationId,
        agentId: input.agentId,
        workItemId: input.workItemId ?? null,
        squadId: input.squadId ?? null,
        goal,
        contextSnapshot: input.contextSnapshot,
        priority,
        triggerType: input.triggerType ?? AgentTriggerType.MANUAL,
        triggerRef: input.triggerRef ?? null,
        triggerDecisionRunId: triggerDecisionRun?.id ?? null,
        createdByUserId: session.userId,
      },
    });
    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_TASK_CREATED",
      objectType: "AgentTask",
      objectId: task.id,
      summary: "创建数字员工任务：" + goal.slice(0, 120),
      details: {
        agentId: task.agentId,
        workItemId: task.workItemId,
        squadId: task.squadId,
        triggerType: task.triggerType,
        triggerDecisionRunId: task.triggerDecisionRunId,
      } as Prisma.InputJsonValue,
    });
    return task;
  });
}

export interface DelegateAgentTaskInput {
  parentTaskId: string;
  toAgentId: string;
  goal: string;
  reason: string;
  sourceRunId?: string | null;
}

export async function delegateAgentTask(
  session: SessionContext,
  input: DelegateAgentTaskInput
) {
  const reason = input.reason?.trim();
  const goal = input.goal?.trim();
  if (!reason || !goal) {
    throw new UnprocessableEntityError("Delegation goal and reason are required");
  }

  const parent = await prisma.agentTask.findUnique({
    where: { id: input.parentTaskId },
    include: {
      agent: true,
      workItem: { select: { projectId: true } },
      squad: {
        include: { members: { where: { agentId: input.toAgentId } } },
      },
    },
  });
  if (!parent || parent.organizationId !== session.organizationId) {
    throw new NotFoundError("Parent agent task not found");
  }
  await assertCanInvokeAgent(session, parent.agent);

  if (parent.workItem) {
    await requireProjectRole(session, parent.workItem.projectId, [Role.OWNER, Role.DECISION_MAKER]);
  }

  const target = await prisma.agent.findUnique({ where: { id: input.toAgentId } });
  if (!target || target.organizationId !== session.organizationId) {
    throw new NotFoundError("Target agent not found");
  }
  if (target.status !== AgentLifecycleStatus.ACTIVE) {
    throw new ConflictError("Target agent is not active");
  }
  if (target.id === parent.agentId) {
    throw new UnprocessableEntityError("Agent cannot delegate a task to itself");
  }
  if (
    parent.squad &&
    parent.squad.leaderAgentId !== target.id &&
    parent.squad.members.length === 0
  ) {
    throw new UnprocessableEntityError("Target agent is not a member of the source squad");
  }

  if (input.sourceRunId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: input.sourceRunId },
      select: { id: true, agentTaskId: true, agentId: true, organizationId: true },
    });
    if (
      !run ||
      run.organizationId !== session.organizationId ||
      run.agentTaskId !== parent.id ||
      run.agentId !== parent.agentId
    ) {
      throw new UnprocessableEntityError("sourceRunId does not belong to the delegating task");
    }
  }

  return prisma.$transaction(async (tx) => {
    const child = await tx.agentTask.create({
      data: {
        organizationId: session.organizationId,
        agentId: target.id,
        workItemId: parent.workItemId,
        squadId: parent.squadId,
        parentTaskId: parent.id,
        goal,
        contextSnapshot: parent.contextSnapshot ?? undefined,
        priority: parent.priority,
        triggerType: AgentTriggerType.DELEGATION,
        triggerRef: parent.id,
        createdByUserId: session.userId,
      },
    });
    const delegation = await tx.agentDelegation.create({
      data: {
        organizationId: session.organizationId,
        fromAgentId: parent.agentId,
        toAgentId: target.id,
        parentTaskId: parent.id,
        childTaskId: child.id,
        sourceRunId: input.sourceRunId ?? null,
        reason,
        createdByUserId: session.userId,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_TASK_DELEGATED",
      objectType: "AgentDelegation",
      objectId: delegation.id,
      summary: parent.agent.name + " → " + target.name + "：" + goal.slice(0, 100),
      details: {
        parentTaskId: parent.id,
        childTaskId: child.id,
        fromAgentId: parent.agentId,
        toAgentId: target.id,
        sourceRunId: input.sourceRunId ?? null,
        reason,
      } as Prisma.InputJsonValue,
    });

    return { delegation, childTask: child };
  });
}

export async function startAgentTask(session: SessionContext, taskId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      taskId,
      session.organizationId
    );

    const task = await tx.agentTask.findUnique({
      where: { id: taskId },
      include: { agent: true, workItem: { select: { projectId: true } } },
    });
    if (!task || task.organizationId !== session.organizationId) {
      throw new NotFoundError("Agent task not found");
    }
    await assertCanInvokeAgent(session, task.agent);

    if (task.workItem) {
      await requireProjectRole(session, task.workItem.projectId, [Role.OWNER, Role.DECISION_MAKER]);
    }
    if (task.status !== AgentTaskStatus.QUEUED) {
      throw new ConflictError("Agent task is " + task.status + ", expected QUEUED");
    }
    if (task.availableAt > new Date()) {
      throw new ConflictError("Agent task is not available yet");
    }

    // 同一 Agent 的并发 claim 必须串行化。只锁各自 AgentTask 会产生：
    // task A / task B 同时 count(RUNNING)=0 → 两个都启动，突破 maxConcurrentTasks。
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "Agent" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      task.agentId,
      session.organizationId
    );

    const running = await tx.agentTask.count({
      where: {
        agentId: task.agentId,
        status: AgentTaskStatus.RUNNING,
      },
    });
    if (running >= task.agent.maxConcurrentTasks) {
      throw new ConflictError("Agent has reached its concurrency limit");
    }

    const startedAt = new Date();
    const updated = await tx.agentTask.update({
      where: { id: task.id },
      data: { status: AgentTaskStatus.RUNNING, startedAt },
    });
    const run = await tx.agentRun.create({
      data: {
        organizationId: session.organizationId,
        userId: session.userId,
        agentId: task.agentId,
        agentTaskId: task.id,
        goal: task.goal,
        contextSnapshot: task.contextSnapshot ?? undefined,
        status: "RUNNING",
        runMode: "AUTOMATED",
        triggerType: task.triggerType,
        triggerRef: task.triggerRef,
        startedAt,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_TASK_STARTED",
      objectType: "AgentTask",
      objectId: task.id,
      summary: task.agent.name + " 开始任务",
      details: { runId: run.id, agentId: task.agentId } as Prisma.InputJsonValue,
    });

    return { task: updated, run };
  });
}

export type AgentTaskOutcome =
  | "SUCCEEDED"
  | "FAILED"
  | "BLOCKED"
  | "WAITING_HUMAN";

export async function finishAgentTask(
  session: SessionContext,
  taskId: string,
  input: { runId: string; outcome: AgentTaskOutcome; reason?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      taskId,
      session.organizationId
    );

    const task = await tx.agentTask.findUnique({
      where: { id: taskId },
      include: { agent: true },
    });
    if (!task || task.organizationId !== session.organizationId) {
      throw new NotFoundError("Agent task not found");
    }
    await assertCanInvokeAgent(session, task.agent);
    if (task.status !== AgentTaskStatus.RUNNING) {
      throw new ConflictError("Agent task is " + task.status + ", expected RUNNING");
    }

    const run = await tx.agentRun.findUnique({ where: { id: input.runId } });
    if (
      !run ||
      run.organizationId !== session.organizationId ||
      run.agentTaskId !== task.id ||
      run.agentId !== task.agentId
    ) {
      throw new UnprocessableEntityError("runId does not belong to this agent task");
    }

    const taskStatus =
      input.outcome === "SUCCEEDED"
        ? AgentTaskStatus.SUCCEEDED
        : input.outcome === "FAILED"
          ? AgentTaskStatus.FAILED
          : input.outcome === "BLOCKED"
            ? AgentTaskStatus.BLOCKED
            : AgentTaskStatus.WAITING_HUMAN;
    const runStatus =
      input.outcome === "SUCCEEDED"
        ? "SUCCEEDED"
        : input.outcome === "FAILED"
          ? "FAILED"
          : "WAITING_CONFIRMATION";
    const now = new Date();

    const updatedTask = await tx.agentTask.update({
      where: { id: task.id },
      data: {
        status: taskStatus,
        blockedReason:
          input.outcome === "BLOCKED" || input.outcome === "WAITING_HUMAN"
            ? input.reason?.trim() || null
            : null,
        completedAt:
          input.outcome === "SUCCEEDED" || input.outcome === "FAILED" ? now : null,
      },
    });
    const updatedRun = await tx.agentRun.update({
      where: { id: run.id },
      data: {
        status: runStatus,
        errorReason:
          input.outcome === "FAILED"
            ? input.reason?.trim() || "Agent task failed"
            : null,
        finishedAt: now,
        durationMs: run.startedAt
          ? Math.max(0, now.getTime() - run.startedAt.getTime())
          : null,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_TASK_FINISHED",
      objectType: "AgentTask",
      objectId: task.id,
      summary: task.agent.name + " 任务状态 → " + taskStatus,
      details: {
        runId: run.id,
        outcome: input.outcome,
        reason: input.reason ?? null,
      } as Prisma.InputJsonValue,
    });

    if (task.parentTaskId) {
      await tx.agentDelegation.updateMany({
        where: { childTaskId: task.id },
        data: {
          status:
            input.outcome === "SUCCEEDED"
              ? DelegationStatus.COMPLETED
              : input.outcome === "FAILED"
                ? DelegationStatus.FAILED
                : DelegationStatus.ACCEPTED,
        },
      });
    }

    return { task: updatedTask, run: updatedRun };
  });
}
