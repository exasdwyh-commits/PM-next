import { AgentLifecycleStatus, AgentRunStatus, AgentTaskStatus } from "@prisma/client";
import type { SessionContext } from "@/modules/identity/session";
import { getConversation, listConversations } from "@/modules/advisor/service";
import { listProposals } from "@/modules/advisor/proposals";
import { getDesktopOverview } from "@/modules/desktop-runtime";
import { getWorkspaceOverview } from "@/modules/workspace/overview";
import prisma from "@/shared/db";
import { readKernGraphCitation } from "@/modules/visual-intelligence/contracts";
import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";
import type {
  ActivityItem,
  AiState,
  Decision,
  Employee,
  EvidenceRef,
  Message,
  Mission,
  StudioModel,
  TodayItem,
} from "@/app/muse/types";

const ACTIVE_TASK_STATUSES: AgentTaskStatus[] = [
  AgentTaskStatus.QUEUED,
  AgentTaskStatus.RUNNING,
  AgentTaskStatus.BLOCKED,
  AgentTaskStatus.WAITING_HUMAN,
  AgentTaskStatus.SUBMITTED,
];

function taskState(status: AgentTaskStatus): AiState {
  if (status === AgentTaskStatus.SUCCEEDED) return "success";
  if (status === AgentTaskStatus.FAILED) return "error";
  if (status === AgentTaskStatus.CANCELLED) return "cancelled";
  if (
    status === AgentTaskStatus.BLOCKED ||
    status === AgentTaskStatus.WAITING_HUMAN ||
    status === AgentTaskStatus.SUBMITTED
  ) {
    return "needs-review";
  }
  if (status === AgentTaskStatus.RUNNING) return "working";
  return "idle";
}

function uniqueToday(items: TodayItem[], limit: number): TodayItem[] {
  const seen = new Set<string>();
  const result: TodayItem[] = [];
  for (const item of items) {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function evidenceFromCitation(
  raw: unknown,
  index: number,
  capturedAt: Date
): EvidenceRef | null {
  const item = asRecord(raw);
  const ref = typeof item.ref === "string" ? item.ref : null;
  const title = typeof item.title === "string" ? item.title : null;
  if (!ref && !title) return null;
  const rawKind = typeof item.kind === "string" ? item.kind : "internal";
  return {
    id: ref || `citation-${capturedAt.getTime()}-${index}`,
    title: title || ref || "未命名来源",
    kind: rawKind.includes("desktop") ? "runtime" : "internal",
    source: rawKind,
    confidence: "unknown",
    verified: false,
    capturedAt: capturedAt.toISOString(),
  };
}

function messageView(row: {
  id: string;
  role: unknown;
  content: string;
  createdAt: Date;
  citations: unknown;
}): Message {
  const citations = Array.isArray(row.citations) ? row.citations : [];
  const graphs = citations
    .map((citation) => readKernGraphCitation(citation))
    .filter((graph): graph is KernGraphV1 => graph !== null);
  const refs = citations
    .map((citation, index) =>
      readKernGraphCitation(citation)
        ? null
        : evidenceFromCitation(citation, index, row.createdAt)
    )
    .filter((ref): ref is EvidenceRef => Boolean(ref));
  return {
    id: row.id,
    author: String(row.role) === "USER" ? "user" : "hermes",
    byEmployeeId: String(row.role) === "USER" ? null : "e-hermes",
    at: row.createdAt.toISOString(),
    state: "success",
    blocks: [
      { kind: "text", text: row.content },
      ...graphs.map((graph) => ({ kind: "graph" as const, graph })),
      ...(refs.length > 0
        ? ([{ kind: "evidence", title: "来源与回执", refs }] as Message["blocks"])
        : []),
    ],
  };
}

function proposalDecision(row: Awaited<ReturnType<typeof listProposals>>[number]): Decision {
  const payload = asRecord(row.payloadJson);
  const rationale =
    typeof payload.rationale === "string" && payload.rationale.trim()
      ? payload.rationale.trim()
      : "Kern 生成了一个业务变更提议。正式业务数据在你批准前不会被写入。";
  const scope = row.product?.name || row.project?.title || "当前工作";
  return {
    id: row.id,
    title: `${row.actionLabel} · ${scope}`,
    because: rationale,
    ifIgnored: "提议会继续保持待确认状态，不会自动写入业务数据。",
    tone: "warn",
    gate: "Proposal / Approval",
    missionId: row.conversationId ?? null,
    dueLabel: "等待你确认",
    raisedBy: row.proposedBy?.name || "Kern",
    options: [
      { id: "approve", label: "批准写入", kind: "approve" },
      { id: "reject", label: "拒绝", kind: "reject", hint: "拒绝需要填写理由并留痕" },
      { id: "defer", label: "稍后处理", kind: "defer" },
    ],
    evidence: [],
  };
}

export async function buildKernViewModel(
  session: SessionContext,
  input: {
    conversationId?: string | null;
    productId?: string | null;
    initialDraft?: string | null;
  } = {}
): Promise<StudioModel> {
  const conversations = await listConversations(session);
  const requested = input.conversationId?.trim() || null;
  const activeConversationId =
    requested && conversations.some((c) => c.id === requested) ? requested : null;

  const [
    activeConversation,
    proposals,
    desktop,
    workspace,
    agentRows,
    activeTasks,
    conversationRuns,
  ] = await Promise.all([
      activeConversationId
        ? getConversation(session, activeConversationId).catch(() => null)
        : Promise.resolve(null),
      listProposals(session, { status: "PENDING_CONFIRMATION", take: 50 }),
      getDesktopOverview(session, {
        conversationId: activeConversationId,
        limit: 12,
      }),
      getWorkspaceOverview(session),
      prisma.agent.findMany({
        where: {
          organizationId: session.organizationId,
          status: AgentLifecycleStatus.ACTIVE,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          roleKey: true,
          skillBindings: {
            where: { enabled: true },
            select: { skill: { select: { name: true } } },
          },
        },
      }),
      prisma.agentTask.findMany({
        where: {
          organizationId: session.organizationId,
          status: { in: ACTIVE_TASK_STATUSES },
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        take: 100,
        select: {
          id: true,
          agentId: true,
          goal: true,
          status: true,
          updatedAt: true,
        },
      }),
      prisma.agentRun.findMany({
        where: {
          organizationId: session.organizationId,
          userId: session.userId,
          conversationId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          conversationId: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

  const productIds = [
    ...new Set([
      ...conversations
        .map((conversation) => conversation.productId)
        .filter((id): id is string => Boolean(id)),
      ...(input.productId?.trim() ? [input.productId.trim()] : []),
    ]),
  ];
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({
          where: {
            organizationId: session.organizationId,
            id: { in: productIds },
          },
          select: { id: true, name: true },
        })
      : [];
  const productName = new Map(products.map((product) => [product.id, product.name]));
  const pendingByConversation = new Set(
    proposals
      .map((proposal) => proposal.conversationId)
      .filter((id): id is string => Boolean(id))
  );

  const employees: Employee[] = agentRows.map((agent) => {
    const tasks = activeTasks.filter((task) => task.agentId === agent.id);
    const reviewTask = tasks.find(
      (task) =>
        task.status === AgentTaskStatus.BLOCKED ||
        task.status === AgentTaskStatus.WAITING_HUMAN ||
        task.status === AgentTaskStatus.SUBMITTED
    );
    const current = reviewTask ?? tasks[0] ?? null;
    const state: AiState = reviewTask
      ? "needs-review"
      : current?.status === AgentTaskStatus.RUNNING
        ? "working"
        : "idle";
    return {
      id: agent.code === "hermes_pm" ? "e-hermes" : agent.id,
      name: agent.name,
      role: agent.roleKey,
      mark: agent.name.trim().slice(0, 1).toUpperCase() || "A",
      state,
      currentFocus: state === "idle" ? null : current?.goal ?? null,
      load: Math.min(100, tasks.length * 25),
      skills: agent.skillBindings.map((binding) => binding.skill.name),
    };
  });

  if (!employees.some((employee) => employee.id === "e-hermes")) {
    employees.unshift({
      id: "e-hermes",
      name: "Kern",
      role: "Department Assistant",
      mark: "K",
      state: "idle",
      currentFocus: null,
      load: 0,
      skills: [],
    });
  }

  const latestRunByConversation = new Map<string, AgentRunStatus>();
  for (const run of conversationRuns) {
    if (run.conversationId && !latestRunByConversation.has(run.conversationId)) {
      latestRunByConversation.set(run.conversationId, run.status);
    }
  }

  const missions: Mission[] = conversations.map((conversation) => {
    const latest = conversation.messages[0];
    const latestRun = latestRunByConversation.get(conversation.id);
    const state: AiState = pendingByConversation.has(conversation.id)
      ? "needs-review"
      : latestRun === AgentRunStatus.RUNNING
        ? "working"
        : latestRun === AgentRunStatus.WAITING_CONFIRMATION
          ? "needs-review"
          : latestRun === AgentRunStatus.FAILED
            ? "error"
            : latestRun === AgentRunStatus.CANCELLED
              ? "cancelled"
              : latestRun === AgentRunStatus.SUCCEEDED
                ? "success"
                : "idle";
    return {
      id: conversation.id,
      title: conversation.title || "未命名目标",
      goal: latest?.content || "这件事还没有消息记录。",
      state,
      productId: conversation.productId,
      productName: conversation.productId
        ? productName.get(conversation.productId) ?? null
        : null,
      ownerId: "e-hermes",
      startedAt: conversation.createdAt.toISOString(),
      progress: null,
      steps: [],
      evidence: [],
    };
  });

  const activity: ActivityItem[] = activeTasks.slice(0, 30).map((task) => ({
    id: task.id,
    at: task.updatedAt.toISOString(),
    state: taskState(task.status),
    actorId: task.agentId,
    text: task.goal,
    missionId: null,
  }));

  const messages = activeConversation
    ? activeConversation.messages.map((message) =>
        messageView({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          citations: message.citations,
        })
      )
    : [];

  const agentName = new Map(agentRows.map((agent) => [agent.id, agent.name]));
  const desktopTaskIds = new Set(desktop.tasks.map((task) => task.taskId));

  const proposalItems: TodayItem[] = proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.actionLabel,
    meta: proposal.product?.name || proposal.project?.title || "待确认业务变更",
    href: proposal.conversationId ? `/muse?c=${proposal.conversationId}` : "/manage",
    state: "needs-review",
    source: "proposal",
  }));

  const workspaceDecisionItems: TodayItem[] = workspace.pendingDecisions.items.map((item) => ({
    id: item.id,
    title: item.title,
    meta: item.meta ?? "等待负责人决策",
    href: item.href ?? "/manage",
    state: "needs-review",
    source: "decision",
  }));

  const blockerItems: TodayItem[] = workspace.blockers.items.map((item) => ({
    id: item.id,
    title: item.title,
    meta: item.meta ?? "真实阻塞项",
    href: item.href ?? "/manage",
    state: "error",
    source: "blocker",
  }));

  const todoItems: TodayItem[] = workspace.todos.items.map((item) => ({
    id: item.id,
    title: item.title,
    meta: item.meta ?? "待处理工作项",
    href: item.href ?? "/manage",
    state: "idle",
    source: "todo",
  }));

  const activeAgentItems: TodayItem[] = activeTasks
    .filter(
      (task) =>
        task.status === AgentTaskStatus.RUNNING && !desktopTaskIds.has(task.id)
    )
    .map((task) => ({
      id: task.id,
      title: task.goal,
      meta: agentName.get(task.agentId) ?? "数字员工",
      href: "/workforce",
      state: "working" as const,
      source: "agent-task" as const,
    }));

  const desktopWorkingItems: TodayItem[] = desktop.tasks
    .filter((task) => task.phase === "RUNNING")
    .map((task) => ({
      id: task.taskId,
      title: task.goal,
      meta: task.claim?.deviceId
        ? `本机执行 · ${task.claim.deviceId}`
        : "本机执行",
      href: task.conversationId ? `/muse?c=${task.conversationId}` : "/workforce",
      state: "working" as const,
      source: "desktop-task" as const,
    }));

  const taskNeedsYouItems: TodayItem[] = activeTasks
    .filter(
      (task) =>
        (task.status === AgentTaskStatus.BLOCKED ||
          task.status === AgentTaskStatus.WAITING_HUMAN ||
          task.status === AgentTaskStatus.SUBMITTED) &&
        !desktopTaskIds.has(task.id)
    )
    .map((task) => ({
      id: task.id,
      title: task.goal,
      meta:
        task.status === AgentTaskStatus.SUBMITTED
          ? "等待验收"
          : task.status === AgentTaskStatus.WAITING_HUMAN
            ? "等待人工输入"
            : "已阻塞",
      href: "/workforce",
      state: "needs-review" as const,
      source: "agent-task" as const,
    }));

  const desktopNeedsYouItems: TodayItem[] = desktop.tasks
    .filter((task) => task.phase === "NEEDS_YOU")
    .map((task) => ({
      id: task.taskId,
      title: task.goal,
      meta: "本机任务需要人工处理",
      href: task.conversationId ? `/muse?c=${task.conversationId}` : "/workforce",
      state: "needs-review" as const,
      source: "desktop-task" as const,
    }));

  const todayNeedsYou = uniqueToday(
    [
      ...proposalItems,
      ...workspaceDecisionItems,
      ...taskNeedsYouItems,
      ...desktopNeedsYouItems,
      ...blockerItems,
    ],
    10
  );
  const todayImportant = uniqueToday(
    [
      ...proposalItems,
      ...blockerItems,
      ...workspaceDecisionItems,
      ...todoItems,
    ],
    8
  );
  const todayWorking = uniqueToday(
    [...activeAgentItems, ...desktopWorkingItems],
    8
  );

  const requestedProductId = input.productId?.trim() || null;
  const requestedProductName = requestedProductId
    ? productName.get(requestedProductId) ?? null
    : null;

  return {
    activeMissionId: activeConversationId,
    managementHref: "/manage",
    newConversationProduct:
      requestedProductId && requestedProductName
        ? { id: requestedProductId, name: requestedProductName }
        : null,
    initialDraft: input.initialDraft?.trim() || "",
    user: {
      name: session.userName,
      role: "成员",
      org: session.organizationId,
    },
    brief: {
      greeting: "欢迎回来",
      today: {
        generatedAt: workspace.meta.generatedAt,
        scopeLabel: workspace.meta.scopeLabel,
        degraded: workspace.degraded,
        degradedNote: workspace.degradedNote,
        important: todayImportant,
        working: todayWorking,
        needsYou: todayNeedsYou,
      },
      decisions: proposals.map(proposalDecision),
      missions,
      suggestions: [
        {
          id: "s-products",
          title: "汇总产品进展",
          why: "让 Kern 从现有业务状态里找阻塞和下一步",
          prompt: "汇总正在推进的产品、阻塞和下一步。",
        },
        {
          id: "s-decisions",
          title: "今天要我决定什么",
          why: "只看真正需要人工拍板的事项",
          prompt: "本周哪些事情需要我决定？按紧急程度说明原因。",
        },
        {
          id: "s-work",
          title: "交代一项工作",
          why: "可以研究、拆解、委派或调用本机执行",
          prompt: "我有一件新的工作要推进：",
        },
      ],
    },
    employees,
    messages,
    activity,
    runtime: {
      connected: desktop.presence.status === "ONLINE",
      host: desktop.presence.deviceId || desktop.presence.label,
      lastHeartbeat: desktop.presence.lastSeenAt || "UNKNOWN",
      // Desktop Runtime 当前只上报连接与任务状态，并未上报逐能力授权。
      // 因此这里保持空列表，避免把“代码支持的动作”冒充为“当前设备已授权能力”。
      capabilities: [],
      activeAction:
        desktop.tasks.find((task) => task.phase === "RUNNING")?.goal ?? null,
    },
    evidence: [],
  };
}
