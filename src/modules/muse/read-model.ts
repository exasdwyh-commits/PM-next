import { AgentLifecycleStatus, AgentTaskStatus } from "@prisma/client";
import type { SessionContext } from "@/modules/identity/session";
import { getConversation, listConversations } from "@/modules/advisor/service";
import { listProposals } from "@/modules/advisor/proposals";
import { getDesktopOverview } from "@/modules/desktop-runtime";
import prisma from "@/shared/db";
import type {
  ActivityItem,
  AiState,
  Decision,
  Employee,
  EvidenceRef,
  Message,
  Mission,
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
  return "working";
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
    id: ref || \`citation-\${capturedAt.getTime()}-\${index}\`,
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
  const refs = Array.isArray(row.citations)
    ? row.citations
        .map((citation, index) => evidenceFromCitation(citation, index, row.createdAt))
        .filter((ref): ref is EvidenceRef => Boolean(ref))
    : [];
  return {
    id: row.id,
    author: String(row.role) === "USER" ? "user" : "hermes",
    byEmployeeId: String(row.role) === "USER" ? null : "e-hermes",
    at: row.createdAt.toISOString(),
    state: "success",
    blocks: [
      { kind: "text", text: row.content },
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
      : "Muse 生成了一个业务变更提议。正式业务数据在你批准前不会被写入。";
  const scope = row.product?.name || row.project?.title || "当前工作";
  return {
    id: row.id,
    title: \`\${row.actionLabel} · \${scope}\`,
    because: rationale,
    ifIgnored: "提议会继续保持待确认状态，不会自动写入业务数据。",
    tone: "warn",
    gate: "Proposal / Approval",
    missionId: row.conversationId ?? null,
    dueLabel: "等待你确认",
    raisedBy: row.proposedBy?.name || "Muse",
    options: [
      { id: "approve", label: "批准写入", kind: "approve" },
      { id: "reject", label: "拒绝", kind: "reject", hint: "拒绝需要填写理由并留痕" },
      { id: "defer", label: "稍后处理", kind: "defer" },
    ],
    evidence: [],
  };
}

export async function buildMuseViewModel(
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

  const [activeConversation, proposals, desktop, agentRows, activeTasks] =
    await Promise.all([
      activeConversationId
        ? getConversation(session, activeConversationId).catch(() => null)
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
      : current
        ? "working"
        : "idle";
    return {
      id: agent.code === "HERMES_PM" ? "e-hermes" : agent.id,
      name: agent.name,
      role: agent.roleKey,
      mark: agent.name.trim().slice(0, 1).toUpperCase() || "A",
      state,
      currentFocus: current?.goal ?? null,
      load: Math.min(100, tasks.length * 25),
      skills: agent.skillBindings.map((binding) => binding.skill.name),
    };
  });

  if (!employees.some((employee) => employee.id === "e-hermes")) {
    employees.unshift({
      id: "e-hermes",
      name: "Hermes",
      role: "Department Assistant",
      mark: "H",
      state: "idle",
      currentFocus: null,
      load: 0,
      skills: [],
    });
  }

  const missions: Mission[] = conversations.map((conversation) => {
    const latest = conversation.messages[0];
    const state: AiState = pendingByConversation.has(conversation.id)
      ? "needs-review"
      : latest && String(latest.role) === "USER"
        ? "working"
        : "success";
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
      decisions: proposals.map(proposalDecision),
      missions,
      suggestions: [
        {
          id: "s-products",
          title: "汇总产品进展",
          why: "让 Muse 从现有业务状态里找阻塞和下一步",
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
      capabilities: [
        "文件",
        "终端",
        "Git",
        "浏览器",
        "App",
        "剪贴板",
        "通知",
        "AppleScript",
      ],
      activeAction:
        desktop.tasks.find((task) => task.phase === "RUNNING")?.goal ?? null,
    },
    evidence: [],
  };
}
