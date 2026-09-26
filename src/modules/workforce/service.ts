import {
  AgentAccessMode,
  AgentLifecycleStatus,
  AgentRunStatus,
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
import { enqueueBusinessEventInTx } from "@/modules/business-events/outbox";

const DEFAULT_AGENTS = [
  {
    code: "hermes_pm",
    name: "Kern PM",
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
    name: "Market Research Agent",
    roleKey: "MARKET_RESEARCH",
    description: "负责市场、竞品、用户与渠道事实研究，维护来源、时间范围和样本边界。",
    instructions: "优先获取一手/高可信市场证据；明确成交价/规格/渠道/时间范围，不把模板推断或模型意见包装成事实。",
    maxConcurrentTasks: 3,
  },
  {
    code: "scientific_evidence_agent",
    name: "Scientific Evidence Agent",
    roleKey: "SCIENTIFIC_EVIDENCE",
    description: "负责论文、临床、人群与机制证据审查，明确研究对象、剂量、终点和外推边界。",
    instructions: "区分原料级、成品级与人群级证据；优先原始研究/注册试验/权威资料；模型输出不作为事实证据。",
    maxConcurrentTasks: 2,
  },
  {
    code: "formulation_agent",
    name: "Formulation Agent",
    roleKey: "FORMULATION",
    description: "负责配方、剂量、剂型、原料组合、可制造性和规格设计。",
    instructions: "所有方案必须标明剂量、规格、依据、相容性、制造约束与未知项；不得把理论机制直接升级为成品功效。",
    maxConcurrentTasks: 2,
  },
  {
    code: "compliance_agent",
    name: "Compliance Agent",
    roleKey: "COMPLIANCE",
    description: "负责法规适用性、原料身份、宣称边界、渠道/进口路径和合规证据。",
    instructions: "高影响法规结论必须绑定官方依据与适用日期；证据不足时输出 UNKNOWN/待核实，不凭经验拍板。",
    maxConcurrentTasks: 2,
  },
  {
    code: "cost_bom_agent",
    name: "Cost & BOM Agent",
    roleKey: "COST_BOM",
    description: "负责 BOM、加工、包材、物流、渠道佣金和多情景单位经济性。",
    instructions: "成本必须区分已报价、历史价和估算；记录规格/MOQ/税费/佣金条件，输出 low/base/high 场景。",
    maxConcurrentTasks: 2,
  },
  {
    code: "qa_verifier",
    name: "QA Verifier",
    roleKey: "QA_VERIFIER",
    description: "独立复核专业结果、证据覆盖、冲突、未知项和交付完整性。",
    instructions: "不得替执行 Agent 自证；检查 claim→evidence、来源独立性、版本一致性和遗漏，必要时退回而不是润色掩盖问题。",
    maxConcurrentTasks: 2,
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
    name: "Supply & Ops Agent",
    roleKey: "SUPPLY_OPS",
    description: "负责供应商、打样、生产、交付、里程碑与运营闭环。",
    instructions: "把策略转为供应/生产/交付任务；报价、样品、产能和交期必须区分真实确认与假设，阻塞项及时升级。",
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
  {
    code: "tech_architect_agent",
    name: "Tech Architect Agent",
    roleKey: "TECH_ARCHITECT",
    description: "负责系统架构、接口、数据模型、技术方案、代码审查、测试策略与技术风险。",
    instructions:
      "先做架构与技术判断，明确变更边界、受影响文件/接口、验证方式与风险。Tech Architect 负责方案与复核，不伪装本机执行；真实修改仍由受控执行路径完成。",
    maxConcurrentTasks: 2,
  },
  {
    code: "desktop_operator",
    name: "Desktop Operator",
    roleKey: "DESKTOP_OPERATOR",
    description: "负责把 Kern 的受控任务交给用户本机 Runtime，执行文件、终端、Git、浏览器、剪贴板、通知和本机 Agent 工作。",
    instructions:
      "只执行 contextSnapshot.desktopAction 中的结构化动作；不得在服务端模拟本机执行。所有动作必须由已登录的用户本机 Runtime 领取并回传真实结果。",
    maxConcurrentTasks: 1,
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
    key: "scientific_evidence_review",
    name: "科学证据审查",
    description: "论文、临床、机制、人群、剂量与外推边界审查。",
    instructions:
      "形成 claim-evidence ledger；明确研究设计、样本、剂量、终点与局限；不能用多模型共识替代真实证据。",
  },
  {
    key: "formulation_design",
    name: "配方与规格设计",
    description: "配方、剂量、剂型、原料协同与制造约束。",
    instructions:
      "给出每个活性成分的角色、日剂量、单份规格、来源依据、制造/口感约束和备选路线。",
  },
  {
    key: "compliance_review",
    name: "法规与宣称审查",
    description: "原料身份、法规路径、宣称边界和渠道适用性。",
    instructions:
      "优先官方法规/公告/目录；标明国家、品类、日期和适用范围；未知时建立 KnowledgeDebt，不做确定性判断。",
  },
  {
    key: "cost_bom",
    name: "成本与 BOM",
    description: "原料、加工、包材、物流、税费、佣金和毛利场景。",
    instructions:
      "所有价格绑定规格、MOQ、时间和来源；已报价/历史价/估算分层；输出 low/base/high 场景与敏感项。",
  },
  {
    key: "independent_qa",
    name: "独立 QA 与事实复核",
    description: "独立验证交付完整性、证据覆盖和治理边界。",
    instructions:
      "核对 claim 支撑、UNKNOWN、版本/来源/冲突、执行回执和风险；证据不够就退回，不允许自证升级。",
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
  {
    key: "technical_architecture",
    name: "技术架构与代码审查",
    description: "架构、接口、数据模型、技术方案、代码审查、测试策略与技术风险评估。",
    instructions:
      "输出明确的架构判断、涉及文件/接口、兼容性影响、验证方式与风险。需要真实修改时交给受控执行路径，不把建议或审查结果表述成已执行。",
  },
  {
    key: "desktop_execution",
    name: "本机执行",
    description: "在用户授权的 Mac Runtime 上执行文件、终端、Git、浏览器、剪贴板与桌面 Agent 任务。",
    instructions:
      "仅接受结构化 desktopAction；结果必须回传 AgentRun/AgentTask。未知、失败或中断必须显式记录，不得伪造本机已执行。",
  },
] as const;

const DEFAULT_BINDINGS: Record<string, string[]> = {
  hermes_pm: ["pm_orchestration", "product_strategy", "red_team_challenge"],
  product_agent: ["product_strategy"],
  research_agent: ["evidence_research"],
  scientific_evidence_agent: ["scientific_evidence_review", "evidence_research"],
  formulation_agent: ["formulation_design", "product_strategy"],
  compliance_agent: ["compliance_review", "evidence_research"],
  cost_bom_agent: ["cost_bom"],
  qa_verifier: ["independent_qa", "red_team_challenge", "evidence_research"],
  marketing_agent: ["go_to_market"],
  ops_agent: ["operational_delivery"],
  red_team: ["red_team_challenge", "evidence_research"],
  tech_architect_agent: ["technical_architecture", "operational_delivery"],
  desktop_operator: ["desktop_execution", "operational_delivery"],
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
    if (!leader) throw new Error("Kern PM bootstrap invariant failed");

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
        name: "Kern Product Squad",
        description: "Kern PM 领导的核心产品数字员工团队。",
        instructions:
          "Leader 负责拆解与路由；成员提交结果后由 Leader 复核。需要改变业务事实时进入 Governance Kernel，需要人类判断时进入 WAITING_HUMAN。",
        leaderAgentId: leader.id,
        createdById: session.userId,
      },
      update: {
        leaderAgentId: leader.id,
        name: "Kern Product Squad",
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
      summary: "初始化 Kern 数字产品团队与默认 Skills",
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

  const [squads, taskGroups, waitingTasks, returnReviewRows] = await Promise.all([
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
    prisma.agentTask.findMany({
      where: {
        organizationId: session.organizationId,
        agentId: { in: visibleAgentIds },
        status: {
          in: [AgentTaskStatus.QUEUED, AgentTaskStatus.WAITING_HUMAN],
        },
        triggerDecisionRun: {
          is: { decisionKey: "workforce.resume_parent" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        goal: true,
        status: true,
        blockedReason: true,
        contextSnapshot: true,
        createdAt: true,
        updatedAt: true,
        agent: { select: { id: true, code: true, name: true } },
        triggerDecisionRun: {
          select: { id: true, decisionKey: true, specVersion: true },
        },
      },
    }),
  ]);

  const returnReviewIds = new Set(returnReviewRows.map((task) => task.id));

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
    waitingTasks: waitingTasks.filter((task) => !returnReviewIds.has(task.id)),
    returnReviews: returnReviewRows.map((task) => ({
      id: task.id,
      goal: task.goal,
      status: task.status,
      blockedReason: task.blockedReason,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      agent: task.agent,
      decisionRun: task.triggerDecisionRun,
      returned: returnReviewState(task.contextSnapshot),
    })),
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
  /** Stable creation key for retried Supervisor/automation dispatches. */
  idempotencyKey?: string | null;
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
          "ESCALATE_AGENT decision can only create a Kern PM review task"
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
              "Signal wake decision must be true and target Kern PM"
            );
          }
          break;

        case "product_version.should_red_team":
          if (result?.value !== true || agent.code !== "red_team") {
            throw new UnprocessableEntityError(
              "ProductVersion challenge decision must be true and target Red Team"
            );
          }
          break;

        case "evidence.should_wake_pm":
          if (result?.value !== true || agent.code !== "hermes_pm") {
            throw new UnprocessableEntityError(
              "Evidence wake decision must be true and target Kern PM"
            );
          }
          break;

        case "workforce.resume_parent":
          if (
            !result ||
            typeof result.value !== "string" ||
            result.value !== agent.code
          ) {
            throw new UnprocessableEntityError(
              "Parent return decision result does not match the selected Agent"
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
        idempotencyKey: input.idempotencyKey ?? null,
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
        triggerRef: task.triggerRef,
        idempotencyKey: task.idempotencyKey,
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
    // Supervising mission roots (Kern owns them while children work) are not
    // execution slots; counting them would starve Kern's own synthesis nodes.
    const supervising = await tx.agentTask.count({
      where: {
        agentId: task.agentId,
        status: AgentTaskStatus.RUNNING,
        contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" },
      },
    });
    if (running - supervising >= task.agent.maxConcurrentTasks) {
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
  input: {
    runId: string;
    outcome: AgentTaskOutcome;
    reason?: string | null;
    resultSummary?: string | null;
  }
) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      taskId,
      session.organizationId
    );

    const task = await tx.agentTask.findUnique({
      where: { id: taskId },
      include: {
        agent: true,
        parentTask: {
          select: {
            id: true,
            goal: true,
            agentId: true,
            contextSnapshot: true,
            agent: { select: { id: true, code: true, name: true } },
          },
        },
      },
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

    const resultSummary = input.resultSummary?.trim() || null;
    if (
      task.parentTaskId &&
      input.outcome === "SUCCEEDED" &&
      !resultSummary
    ) {
      throw new UnprocessableEntityError(
        "Delegated child task must return a non-empty resultSummary before SUCCEEDED"
      );
    }
    if (resultSummary && resultSummary.length > 4000) {
      throw new UnprocessableEntityError("resultSummary must be <= 4000 characters");
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
        outputSummary:
          input.outcome === "SUCCEEDED" ||
          input.outcome === "FAILED" ||
          // BLOCKED 也要保留摘要：执行器（Digital Employee Executor）在诚实缺省时
          // 写的是「缺什么」的可读说明，管理报告的 advisoryNotes 直接取这里；
          // 若丢掉，报告就只剩 blockedReason 一句机器原因，看不到具体缺口。
          input.outcome === "BLOCKED"
            ? resultSummary
            : run.outputSummary,
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
        resultSummary,
      } as Prisma.InputJsonValue,
    });

    let returnEventId: string | null = null;
    const parentContext = task.parentTask
      ? objectJson(task.parentTask.contextSnapshot)
      : {};
    const productRndParentTaskId =
      task.parentTask && parentContext.schemaVersion === "product-rnd-program/v1"
        ? task.parentTask.id
        : null;
    const kernMissionParentTaskId =
      task.parentTask && parentContext.schemaVersion === "kern-mission/v1"
        ? task.parentTask.id
        : null;

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

      // Only terminal child outcomes return control to the parent Agent.
      // BLOCKED / WAITING_HUMAN are not completion and must not be disguised
      // as a finished delegation.
      if (
        task.parentTask &&
        !productRndParentTaskId &&
        !kernMissionParentTaskId &&
        (input.outcome === "SUCCEEDED" || input.outcome === "FAILED")
      ) {
        const event = await enqueueBusinessEventInTx(tx, {
          organizationId: session.organizationId,
          eventKey: `agent-task:${task.id}:terminal`,
          eventType: "AGENT_CHILD_TERMINAL",
          aggregateType: "AgentTask",
          aggregateId: task.id,
          payload: {
            parentTaskId: task.parentTask.id,
            parentTaskGoal: task.parentTask.goal,
            parentAgentCode: task.parentTask.agent.code,
            childTaskId: task.id,
            childAgentCode: task.agent.code,
            childOutcome: input.outcome,
            resultSummary,
            reason: input.reason?.trim() || null,
          },
          contextRefs: [
            `agent-task:${task.parentTask.id}`,
            `agent-task:${task.id}`,
            `agent-run:${run.id}`,
          ],
          createdById: session.userId,
        });
        returnEventId = event.id;
      }
    }

    return {
      task: updatedTask,
      run: updatedRun,
      returnEventId,
      productRndParentTaskId,
      kernMissionParentTaskId,
    };
  });

  if (result.returnEventId) {
    // Dynamic import avoids a static cycle:
    // workforce → dispatcher → autopilot → workforce.
    // The outbox row is already durable, so dispatch failure is intentionally
    // non-fatal and can be recovered by the outbox drain.
    const { dispatchBusinessEvent } = await import(
      "@/modules/business-events/dispatcher"
    );
    await dispatchBusinessEvent(
      session.organizationId,
      result.returnEventId,
      { workerId: "child-return:" + taskId }
    ).catch(() => null);
  }

  if (result.productRndParentTaskId) {
    const parentTaskId = result.productRndParentTaskId;
    const { advanceProductRndProgram } = await import(
      "@/modules/product-rnd"
    );
    await advanceProductRndProgram(session, parentTaskId).catch(
      async (error: unknown) => {
        const message =
          error instanceof Error ? error.message : String(error);
        await prisma.agentTask.updateMany({
          where: {
            id: parentTaskId,
            organizationId: session.organizationId,
            status: AgentTaskStatus.RUNNING,
          },
          data: {
            blockedReason: ("AUTO_ADVANCE_FAILED: " + message).slice(0, 1000),
          },
        });
      }
    );
  }

  if (result.kernMissionParentTaskId) {
    const missionTaskId = result.kernMissionParentTaskId;
    const { advanceKernMission } = await import("@/modules/supervisor/service");
    // Non-fatal: the worker's mission sweep re-advances RUNNING missions.
    await advanceKernMission(session, missionTaskId).catch((error: unknown) => {
      console.error(
        `[kern-supervisor] advance after child failed mission=${missionTaskId}:`,
        error instanceof Error ? error.message : error
      );
    });
  }

  return { task: result.task, run: result.run };
}


function objectJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function returnReviewState(contextSnapshot: Prisma.JsonValue | null | undefined) {
  const context = objectJson(contextSnapshot);
  const state = objectJson(
    (context.state ?? null) as Prisma.JsonValue | null
  );
  return {
    parentTaskId:
      typeof state.parentTaskId === "string" ? state.parentTaskId : null,
    parentTaskGoal:
      typeof state.parentTaskGoal === "string" ? state.parentTaskGoal : null,
    childTaskId:
      typeof state.childTaskId === "string" ? state.childTaskId : null,
    childAgentCode:
      typeof state.childAgentCode === "string" ? state.childAgentCode : null,
    childOutcome:
      typeof state.childOutcome === "string" ? state.childOutcome : null,
    resultSummary:
      typeof state.resultSummary === "string" ? state.resultSummary : null,
    reason:
      typeof state.reason === "string" ? state.reason : null,
  };
}

export type ReturnedChildReviewAction =
  | "ACCEPT_RESULT"
  | "CONTINUE_DELEGATION"
  | "ESCALATE_HUMAN"
  | "CLOSE_PARENT";

export interface ResolveReturnedChildReviewInput {
  action: ReturnedChildReviewAction;
  reason?: string | null;
  toAgentId?: string | null;
  goal?: string | null;
}

export async function resolveReturnedChildReview(
  session: SessionContext,
  reviewTaskId: string,
  input: ResolveReturnedChildReviewInput
) {
  const review = await prisma.agentTask.findUnique({
    where: { id: reviewTaskId },
    include: {
      agent: true,
      triggerDecisionRun: {
        select: { id: true, decisionKey: true },
      },
    },
  });
  if (!review || review.organizationId !== session.organizationId) {
    throw new NotFoundError("Return review task not found");
  }
  await assertCanInvokeAgent(session, review.agent);
  if (review.triggerDecisionRun?.decisionKey !== "workforce.resume_parent") {
    throw new UnprocessableEntityError(
      "Agent task is not a returned-child review task"
    );
  }
  if (
    review.status === AgentTaskStatus.SUCCEEDED ||
    review.status === AgentTaskStatus.FAILED ||
    review.status === AgentTaskStatus.CANCELLED
  ) {
    throw new ConflictError("Return review task is already terminal");
  }

  const returnState = returnReviewState(review.contextSnapshot);
  if (!returnState.parentTaskId || !returnState.childTaskId) {
    throw new UnprocessableEntityError(
      "Return review task is missing parent/child provenance"
    );
  }
  const originalParentTaskId = returnState.parentTaskId;
  const returnedChildTaskId = returnState.childTaskId;

  const reason = input.reason?.trim() || null;

  if (input.action === "CONTINUE_DELEGATION") {
    const toAgentId = input.toAgentId?.trim();
    const goal = input.goal?.trim();
    if (!toAgentId || !goal || !reason) {
      throw new UnprocessableEntityError(
        "CONTINUE_DELEGATION requires toAgentId, goal and reason"
      );
    }

    const delegated = await delegateAgentTask(session, {
      parentTaskId: review.id,
      toAgentId,
      goal,
      reason,
    });

    const resolved = await prisma.$transaction(async (tx) => {
      const updated = await tx.agentTask.update({
        where: { id: review.id },
        data: {
          status: AgentTaskStatus.SUCCEEDED,
          completedAt: new Date(),
          blockedReason: null,
        },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "AGENT_RETURN_REVIEW_REDELEGATED",
        objectType: "AgentTask",
        objectId: review.id,
        summary: "子 Agent 结果已复核，并继续委派后续工作",
        details: {
          parentTaskId: originalParentTaskId,
          returnedChildTaskId: returnedChildTaskId,
          delegatedChildTaskId: delegated.childTask.id,
          toAgentId,
          goal,
          reason,
        } as Prisma.InputJsonValue,
      });
      return updated;
    });

    return {
      action: input.action,
      reviewTask: resolved,
      childTask: delegated.childTask,
      delegation: delegated.delegation,
    };
  }

  let followUpReturnEventId: string | null = null;

  const resolved = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      review.id,
      session.organizationId
    );

    const currentReview = await tx.agentTask.findUnique({
      where: { id: review.id },
      include: {
        agent: true,
        triggerDecisionRun: {
          select: { decisionKey: true },
        },
      },
    });
    if (
      !currentReview ||
      currentReview.organizationId !== session.organizationId ||
      currentReview.triggerDecisionRun?.decisionKey !== "workforce.resume_parent"
    ) {
      throw new NotFoundError("Return review task not found");
    }
    if (
      currentReview.status === AgentTaskStatus.SUCCEEDED ||
      currentReview.status === AgentTaskStatus.FAILED ||
      currentReview.status === AgentTaskStatus.CANCELLED
    ) {
      throw new ConflictError("Return review task is already terminal");
    }

    if (input.action === "ESCALATE_HUMAN") {
      if (!reason) {
        throw new UnprocessableEntityError(
          "ESCALATE_HUMAN requires a reason"
        );
      }
      const updated = await tx.agentTask.update({
        where: { id: currentReview.id },
        data: {
          status: AgentTaskStatus.WAITING_HUMAN,
          blockedReason: reason,
          completedAt: null,
        },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "AGENT_RETURN_REVIEW_ESCALATED",
        objectType: "AgentTask",
        objectId: currentReview.id,
        summary: "子 Agent 返回结果升级为人工判断",
        details: {
          parentTaskId: originalParentTaskId,
          childTaskId: returnedChildTaskId,
          reason,
        } as Prisma.InputJsonValue,
      });
      return { reviewTask: updated, parentTask: null };
    }

    if (input.action === "ACCEPT_RESULT") {
      const updated = await tx.agentTask.update({
        where: { id: currentReview.id },
        data: {
          status: AgentTaskStatus.SUCCEEDED,
          completedAt: new Date(),
          blockedReason: null,
        },
      });
      await createAuditEventInTx(tx, {
        actorId: session.userId,
        action: "AGENT_RETURN_REVIEW_ACCEPTED",
        objectType: "AgentTask",
        objectId: currentReview.id,
        summary: "接受子 Agent 返回结果，父工作保持原状态继续推进",
        details: {
          parentTaskId: originalParentTaskId,
          childTaskId: returnedChildTaskId,
          resultSummary: returnState.resultSummary,
          reason,
        } as Prisma.InputJsonValue,
      });
      return { reviewTask: updated, parentTask: null };
    }

    if (input.action !== "CLOSE_PARENT") {
      throw new UnprocessableEntityError("Unsupported return review action");
    }
    if (!reason) {
      throw new UnprocessableEntityError(
        "CLOSE_PARENT requires a closure reason"
      );
    }

    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "AgentTask" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE',
      originalParentTaskId,
      session.organizationId
    );
    const parent = await tx.agentTask.findUnique({
      where: { id: originalParentTaskId },
      include: {
        agent: true,
        parentTask: {
          select: {
            id: true,
            goal: true,
            agent: { select: { code: true } },
          },
        },
      },
    });
    if (!parent || parent.organizationId !== session.organizationId) {
      throw new NotFoundError("Original parent task not found");
    }
    await assertCanInvokeAgent(session, parent.agent);
    if (
      parent.status === AgentTaskStatus.SUCCEEDED ||
      parent.status === AgentTaskStatus.FAILED ||
      parent.status === AgentTaskStatus.CANCELLED
    ) {
      throw new ConflictError("Original parent task is already terminal");
    }

    const now = new Date();
    const closedParent = await tx.agentTask.update({
      where: { id: parent.id },
      data: {
        status: AgentTaskStatus.SUCCEEDED,
        completedAt: now,
        blockedReason: null,
      },
    });
    await tx.agentRun.updateMany({
      where: {
        organizationId: session.organizationId,
        agentTaskId: parent.id,
        status: {
          in: [
            AgentRunStatus.QUEUED,
            AgentRunStatus.RUNNING,
            AgentRunStatus.WAITING_CONFIRMATION,
          ],
        },
      },
      data: {
        status: AgentRunStatus.SUCCEEDED,
        finishedAt: now,
        errorReason: null,
      },
    });
    const closedReview = await tx.agentTask.update({
      where: { id: currentReview.id },
      data: {
        status: AgentTaskStatus.SUCCEEDED,
        completedAt: now,
        blockedReason: null,
      },
    });

    await createAuditEventInTx(tx, {
      actorId: session.userId,
      action: "AGENT_PARENT_TASK_CLOSED_FROM_RETURN",
      objectType: "AgentTask",
      objectId: parent.id,
      summary: "基于子 Agent 返回结果关闭父工作",
      details: {
        reviewTaskId: currentReview.id,
        returnedChildTaskId: returnedChildTaskId,
        resultSummary: returnState.resultSummary,
        closureReason: reason,
      } as Prisma.InputJsonValue,
    });

    if (parent.parentTask) {
      const parentReturnEvent = await enqueueBusinessEventInTx(tx, {
        organizationId: session.organizationId,
        eventKey: `agent-task:${parent.id}:terminal`,
        eventType: "AGENT_CHILD_TERMINAL",
        aggregateType: "AgentTask",
        aggregateId: parent.id,
        payload: {
          parentTaskId: parent.parentTask.id,
          parentTaskGoal: parent.parentTask.goal,
          parentAgentCode: parent.parentTask.agent.code,
          childTaskId: parent.id,
          childAgentCode: parent.agent.code,
          childOutcome: "SUCCEEDED",
          resultSummary: reason,
          reason: "Closed by returned-child review",
        },
        contextRefs: [
          `agent-task:${parent.parentTask.id}`,
          `agent-task:${parent.id}`,
          `agent-task:${currentReview.id}`,
        ],
        createdById: session.userId,
      });
      followUpReturnEventId = parentReturnEvent.id;
    }

    return { reviewTask: closedReview, parentTask: closedParent };
  });

  if (followUpReturnEventId) {
    const { dispatchBusinessEvent } = await import(
      "@/modules/business-events/dispatcher"
    );
    await dispatchBusinessEvent(
      session.organizationId,
      followUpReturnEventId,
      { workerId: "parent-close-return:" + reviewTaskId }
    ).catch(() => null);
  }

  return {
    action: input.action,
    reviewTask: resolved.reviewTask,
    parentTask: resolved.parentTask,
  };
}
