import { AgentLifecycleStatus, AgentRunStatus, AgentTaskStatus } from "@prisma/client";
import type { SessionContext } from "@/modules/identity/session";
import {
  getKernConversation,
  listKernConversations,
} from "@/modules/assistant-runtime";
import { listProposals } from "@/modules/advisor/proposals";
import { getDesktopOverview } from "@/modules/desktop-runtime";
import prisma from "@/shared/db";
import { readKernGraphCitation } from "@/modules/visual-intelligence/contracts";
import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";
import type {
  ActivityItem,
  AiState,
  ConversationSummary,
  Decision,
  Employee,
  EvidenceRef,
  Message,
  StudioModel,
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
    author: String(row.role) === "USER" ? "user" : "kern",
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

function proposalDecision(
  row: Awaited<ReturnType<typeof listProposals>>[number]
): Decision {
  const payload = asRecord(row.payloadJson);
  const rationale =
    typeof payload.rationale === "string" && payload.rationale.trim()
      ? payload.rationale.trim()
      : "Kern 生成了一个受保护业务变更，需要人工 Gate 才能继续。";
  const scope = row.product?.name || row.project?.title || "当前工作";

  return {
    id: row.id,
    title: `${row.actionLabel} · ${scope}`,
    because: rationale,
    ifIgnored: "该受保护动作会保持待确认，不会自动写入业务数据。",
    tone: "warn",
    gate: "Proposal / Approval",
    conversationId: row.conversationId ?? null,
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
  const conversations = await listKernConversations(session);
  const requested = input.conversationId?.trim() || null;
  const activeConversationId =
    requested && conversations.some((conversation) => conversation.id === requested)
      ? requested
      : null;

  const [
    activeConversation,
    proposals,
    desktop,
    agentRows,
    activeTasks,
    conversationRuns,
  ] = await Promise.all([
    activeConversationId
      ? getKernConversation(session, activeConversationId).catch(() => null)
      : Promise.resolve(null),
    listProposals(session, { status: "PENDING_CONFIRMATION", take: 50 }),
    getDesktopOverview(session, {
      conversationId: activeConversationId,
      limit: 12,
    }),
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
      role: "Agent Assistant",
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

  const conversationSummaries: ConversationSummary[] = conversations.map(
    (conversation) => {
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
        title: conversation.title || "未命名对话",
        preview: latest?.content || "这段对话还没有消息。",
        state,
        productId: conversation.productId,
        productName: conversation.productId
          ? productName.get(conversation.productId) ?? null
          : null,
        startedAt: conversation.createdAt.toISOString(),
      };
    }
  );

  const activity: ActivityItem[] = activeTasks.slice(0, 30).map((task) => ({
    id: task.id,
    at: task.updatedAt.toISOString(),
    state: taskState(task.status),
    actorId: task.agentId,
    text: task.goal,
    conversationId: null,
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

  const requestedProductId = input.productId?.trim() || null;
  const requestedProductName = requestedProductId
    ? productName.get(requestedProductId) ?? null
    : null;

  return {
    activeConversationId,
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
      decisions: proposals.map(proposalDecision),
      conversations: conversationSummaries,
      suggestions: [
        {
          id: "s-products",
          title: "汇总产品进展",
          why: "让 Kern 找阻塞和下一步",
          prompt: "汇总正在推进的产品、阻塞和下一步。",
        },
        {
          id: "s-decisions",
          title: "需要我决定什么",
          why: "只看真正需要人工 Gate 的事项",
          prompt: "现在有哪些事情必须由我决定？只列真正需要我拍板的。",
        },
        {
          id: "s-work",
          title: "交代一项工作",
          why: "研究、拆解、委派或调用本机执行",
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
      capabilities: [],
      activeAction:
        desktop.tasks.find((task) => task.phase === "RUNNING")?.goal ?? null,
    },
    evidence: [],
  };
}
