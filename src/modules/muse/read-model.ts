import { AgentLifecycleStatus, AgentRunStatus, AgentTaskStatus } from "@prisma/client";
import type { SessionContext } from "@/modules/identity/session";
import {
  getKernConversation,
  getKernConversationControlState,
  listKernConversations,
} from "@/modules/assistant-runtime";
import { listProposals } from "@/modules/advisor/proposals";
import { getDesktopOverview } from "@/modules/desktop-runtime";
import prisma from "@/shared/db";
import { buildAttentionBrief, type AttentionSignal } from "@/modules/supervisor/attention";
import { computePendingAsks, readMissionSnapshot } from "@/modules/supervisor/service";
import { isKernModelReady } from "@/modules/supervisor/generic-executor";
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
  MessageBlock,
  StudioModel,
} from "./types";

import { isMissionConclusionCitation } from "@/modules/supervisor/report-format";
import { artifactCitations, isArtifactCitation } from "@/modules/artifacts/protocol";

function conclusionBlock(text: string, citations: unknown[]): MessageBlock {
  const ref = citations.map(isMissionConclusionCitation).find((id): id is string => !!id);
  if (ref) return { kind: "conclusion", ref, text };
  const artifacts = artifactCitations(citations);
  return artifacts.length ? { kind: "text", text, artifacts } : { kind: "text", text };
}

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
  const isMission = (c: unknown) => asRecord(c).kind === "kern-mission" && typeof asRecord(c).ref === "string";
  const missionIds = [...new Set(citations.filter(isMission).map((c) => String(asRecord(c).ref)))];
  const isBrief = (c: unknown) => asRecord(c).kind === "kern-brief";
  const hasBrief = citations.some(isBrief);
  const refs = citations
    .map((citation, index) =>
      readKernGraphCitation(citation) || isMission(citation) || isBrief(citation) || isArtifactCitation(citation)
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
      conclusionBlock(row.content, citations),
      ...graphs.map((graph) => ({ kind: "graph" as const, graph })),
      ...(hasBrief ? [{ kind: "brief" as const, ref: row.id }] : []),
      ...missionIds.map((ref) => ({ kind: "mission" as const, ref })),
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


/** KX-34：每日简报复用同一套注意力判断（不分叉逻辑）。 */
export async function loadAttentionForUser(session: SessionContext) {
  const proposals = await listProposals(session, { status: "PENDING_CONFIRMATION", take: 50 });
  return loadAttention(session, proposals);
}

async function loadAttention(
  session: SessionContext,
  proposals: Awaited<ReturnType<typeof listProposals>>
) {
  const missions = await prisma.agentTask.findMany({
    where: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      contextSnapshot: { path: ["schemaVersion"], equals: "kern-mission/v1" },
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, goal: true, contextSnapshot: true },
  });
  const signals: AttentionSignal[] = [];
  // KX-51b/53：各任务未回答的提问数（一个任务聚合成一条「需要你」）。
  const askRows = missions.length
    ? await prisma.kernMissionEvent.findMany({
        where: { organizationId: session.organizationId, missionTaskId: { in: missions.map((m) => m.id) }, type: { in: ["node.ask", "node.answered"] } },
        orderBy: { seq: "asc" },
        select: { missionTaskId: true, type: true, nodeKey: true, payload: true, createdAt: true },
        take: 1000,
      })
    : [];
  const openQuestions = (rootTaskId: string) =>
    computePendingAsks(
      askRows
        .filter((r) => r.missionTaskId === rootTaskId)
        .map((r) => ({ type: r.type, nodeKey: r.nodeKey, payload: (r.payload ?? {}) as Record<string, unknown>, createdAt: r.createdAt.toISOString() }))
    ).length;
  for (const row of missions) {
    const snap = readMissionSnapshot(row.contextSnapshot);
    if (!snap) continue;
    const nodes = Object.values(snap.state.nodes);
    const done = nodes.filter((n) => ["SUCCEEDED", "BLOCKED", "FAILED", "SKIPPED"].includes(n.status)).length;
    let seen = false;
    if (snap.outcome?.messageId && snap.conversationId) {
      const report = await prisma.message.findUnique({ where: { id: snap.outcome.messageId }, select: { createdAt: true } });
      seen = report
        ? (await prisma.message.count({
            where: { conversationId: snap.conversationId, role: "USER", createdAt: { gt: report.createdAt } },
          })) > 0
        : false;
    }
    signals.push({
      kind: "MISSION",
      id: row.id,
      goal: row.goal.slice(0, 80),
      status: snap.outcome ? snap.outcome.status : "RUNNING",
      paused: !snap.outcome && !!snap.paused,
      progress: { done, total: nodes.length },
      reasons: snap.outcome?.reasons ?? [],
      finishedAt: snap.outcome?.finishedAt ?? null,
      conversationId: snap.conversationId,
      seenByUser: seen,
      openQuestions: snap.outcome?.status === "CANCELLED" ? 0 : openQuestions(row.id),
    });
  }
  for (const row of proposals) {
    signals.push({
      kind: "PROPOSAL",
      id: row.id,
      title: `${row.actionLabel} · ${row.product?.name || row.project?.title || "当前工作"}`,
      actionType: String((row as { actionType?: unknown }).actionType ?? ""),
      createdAt: new Date().toISOString(),
      conversationId: row.conversationId ?? null,
    });
  }
  // KX-35：等你确认的本机命令（WAITING_HUMAN + desktopConfirmation.PENDING）。
  const desktopWaiting = await getDesktopOverview(session, { limit: 20 }).catch(() => null);
  for (const t of desktopWaiting?.tasks ?? []) {
    if (!t.confirmation || !t.action) continue;
    signals.push({
      kind: "DESKTOP_CONFIRM",
      id: t.taskId,
      label: t.action.label,
      detail: t.action.detail,
      reason: t.confirmation.reason,
      conversationId: t.conversationId,
    });
  }
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const milestones = await prisma.launchMilestone
    .findMany({
      where: {
        ownerId: session.userId,
        status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
        OR: [{ status: "BLOCKED" }, { dueDate: { lte: soon } }],
      },
      orderBy: { dueDate: "asc" },
      take: 8,
      select: { id: true, title: true, dueDate: true, status: true },
    })
    .catch(() => []);
  const nowIso = new Date().toISOString();
  for (const m of milestones) {
    signals.push({
      kind: "DEADLINE",
      id: m.id,
      title: m.title,
      dueAt: m.dueDate ? m.dueDate.toISOString() : null,
      blocked: m.status === "BLOCKED",
      href: "/projects",
      now: nowIso,
    });
  }
  return buildAttentionBrief(signals);
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

  const controls = await getKernConversationControlState(
    session,
    activeConversation?.runtimeConfig
  );

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
        preview: plainPreview(latest?.content) || "这段对话还没有消息。",
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

  const attention = await loadAttention(session, proposals).catch(() => ({
    needsYou: [],
    inProgress: [],
    handledQuietly: 0,
    completedRecently: 0,
  }));

  const modelReady = await isKernModelReady(session.organizationId).catch(() => false);

  const requestedProductId = input.productId?.trim() || null;
  const requestedProductName = requestedProductId
    ? productName.get(requestedProductId) ?? null
    : null;

  return {
    activeConversationId,
    modelReady,
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
      attention,
      // 首屏示例（KX-21）：提示文案决定走哪条路径。新品目标或命中 ≥ 2 个专家会起「任务」（有计划与契约卡）；
      // 所以文案里避开「决策 / 拍板 / 待办 / 本周 / 项目 / 复核 / 本机」等会被关键词路由截胡的词（见 assistant-runtime/router.ts）。
      suggestions: [
        {
          id: "s-new-product",
          title: "评估一个新品方向",
          why: "市场、合规、成本逐项研究，红队证伪，给你一个带依据的结论",
          prompt: "我想开发一个新的产品，方向是：",
        },
        {
          id: "s-competitors",
          title: "做一份竞品调研",
          why: "对比定位、价格带和渠道，每个判断标来源，查不到的写明未知",
          prompt: "帮我做一份竞品调研：比较定位、价格带、渠道和差异化，每个判断标注来源，查不到的写明未知。调研对象是：",
        },
        {
          id: "s-compliance",
          title: "排查一个方向的合规风险",
          why: "宣称边界、资质备案、渠道限制，列出可能阻断上市的硬约束",
          prompt: "帮我排查一个方向的合规风险：宣称边界、资质备案和渠道限制，列出可能阻断上市的硬约束。方向是：",
        },
      ],
    },
    employees,
    messages,
    activity,
    controls,
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

/** Sidebar preview: strip markdown markers so "**" / "##" never leak into the list. */
function plainPreview(content?: string | null): string {
  if (!content) return "";
  return content
    .replace(/\[\[kern-artifact:[^\]]+\]\]/g, " 〔可视化成果〕 ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
