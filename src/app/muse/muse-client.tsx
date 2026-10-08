"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { ConversationRuntimeConfig, Decision, EvidenceRef, Message, MessageBlock, StudioModel } from "./types";
import { readKernGraphCitation } from "@/modules/visual-intelligence/contracts";
import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";
import { Btn, I } from "./components/kit";
import { CheckIn, Turn, Working } from "./components/turn";
import { useDesktopNotify } from "./desktop-notify";
import { Blank, Dock, Rail } from "./components/shell";
import { ConversationRename } from "./components/conversation-rename";
import { reducedMotion } from "@/components/motion/motion";
import { RoleProvider, useRole } from "@/components/role-context";
import { KernRoleBar } from "./components/kern-role-bar";
import { DailyBriefing } from "./components/daily-briefing";
import "@/components/daily-briefing-rich.css";
import { detectRoleSwitchIntent, inferRoleFromText } from "@/components/kern-role-intelligence";
import { dedupeMissionCards } from "./conversation-view";
import { ConclusionDecisions } from "./components/conclusion-decisions";

const ConnectorSheet = dynamic(() => import("./components/sheets").then(module => module.ConnectorSheet));
const LibrarySheet = dynamic(() => import("./components/sheets").then(module => module.LibrarySheet));
const MemorySheet = dynamic(() => import("./components/sheets").then(module => module.MemorySheet));
const Palette = dynamic(() => import("./components/sheets").then(module => module.Palette));
const RejectSheet = dynamic(() => import("./components/sheets").then(module => module.RejectSheet));
const ScheduleSheet = dynamic(() => import("./components/sheets").then(module => module.ScheduleSheet));
const SourceSheet = dynamic(() => import("./components/sheets").then(module => module.SourceSheet));
const TrailSheet = dynamic(() => import("./components/sheets").then(module => module.TrailSheet));
const TrustSheet = dynamic(() => import("./components/sheets").then(module => module.TrustSheet));
const VaultSheet = dynamic(() => import("./components/sheets").then(module => module.VaultSheet));

import { isMissionConclusionCitation } from "@/modules/supervisor/report-format";

function conclusionBlock(text: string, citations: unknown[]): MessageBlock {
  const ref = citations.map(isMissionConclusionCitation).find((id): id is string => !!id);
  return ref ? { kind: "conclusion", ref, text } : { kind: "text", text };
}

type SheetState =
  | { kind: "trail" }
  | { kind: "trust" }
  | { kind: "memory" }
  | { kind: "vault" }
  | { kind: "connectors" }
  | { kind: "library" }
  | { kind: "schedules" }
  | { kind: "rename"; conversation: { id: string; title: string } }
  | { kind: "reject"; decision: Decision; choice: Decision["options"][number] }
  | { kind: "source"; ref: EvidenceRef }
  | null;

type ApiMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  citations?: unknown[] | null;
};

function fromApiMessage(message: ApiMessage): Message {
  const citations = Array.isArray(message.citations) ? message.citations : [];
  const graphs = citations
    .map((raw) => readKernGraphCitation(raw))
    .filter((graph): graph is KernGraphV1 => graph !== null);

  const missionIds = citations.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    return item.kind === "kern-mission" && typeof item.ref === "string" ? [item.ref] : [];
  });

  const hasBrief = citations.some((raw) => !!raw && typeof raw === "object" && (raw as Record<string, unknown>).kind === "kern-brief");
  const refs: EvidenceRef[] = citations.flatMap((raw, index) => {
    if (readKernGraphCitation(raw)) return [];
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>).kind === "kern-brief") return [];
    if (raw && typeof raw === "object" && (raw as Record<string, unknown>).kind === "kern-mission") return [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const ref = typeof item.ref === "string" ? item.ref : null;
    const title = typeof item.title === "string" ? item.title : null;
    if (!ref && !title) return [];
    const kind = typeof item.kind === "string" ? item.kind : "internal";
    return [
      {
        id: ref || `citation-${message.id}-${index}`,
        title: title || ref || "未命名来源",
        kind: kind.includes("desktop") ? ("runtime" as const) : ("internal" as const),
        source: kind,
        confidence: "unknown" as const,
        verified: false,
        capturedAt: message.createdAt,
      },
    ];
  });

  return {
    id: message.id,
    author: message.role === "USER" ? "user" : "kern",
    byEmployeeId: message.role === "USER" ? null : "e-hermes",
    at: message.createdAt,
    state: "success",
    blocks: [
      conclusionBlock(message.content, citations),
      ...graphs.map((graph) => ({ kind: "graph" as const, graph })),
      ...(hasBrief ? [{ kind: "brief" as const, ref: message.id }] : []),
      ...[...new Set(missionIds)].map((ref) => ({ kind: "mission" as const, ref })),
      ...(refs.length > 0
        ? ([{ kind: "evidence", title: "来源与回执", refs }] as Message["blocks"])
        : []),
    ],
  };
}

/** 输入草稿本机持久化（OpenDots 式"失败也保留草稿"）：按对话存一份，空值不存，最多 20 份、每份 4000 字。 */
const DRAFTS_KEY = "kern.muse.drafts.v1";
function loadDrafts(): Map<string, string> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string" && v.trim()) map.set(k, v.slice(0, 4000));
      if (map.size >= 20) break;
    }
    return map;
  } catch {
    return new Map();
  }
}
function persistDrafts(drafts: Map<string, string>) {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of drafts) {
      if (!v.trim()) continue;
      obj[k] = v.slice(0, 4000);
      if (Object.keys(obj).length >= 20) break;
    }
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(obj));
  } catch {
    /* 无痕模式等直接忽略，内存草稿照常工作 */
  }
}

type PendingSend = { clientMessageId: string; conversationId: string; text: string; runId?: string };
type MessageExecution = { runId: string; status: string; clientMessageId: string; error?: string | null };
const PENDING_KEY = "kern.muse.pending.v1";
function loadPending(key: string): PendingSend | null {
  try {
    const item = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}")[key];
    return item && typeof item.clientMessageId === "string" && typeof item.conversationId === "string" && typeof item.text === "string" ? item : null;
  } catch { return null; }
}
function persistPending(key: string, item: PendingSend | null) {
  try {
    const items = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
    if (item) items[key] = item; else delete items[key];
    localStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch { /* 内存保留同一标识，服务器记录仍可在刷新后恢复。 */ }
}

export default function KernClient({ model }: { model: StudioModel }) {
  const router = useRouter();
  const { brief, employees, runtime } = model;
  const [conversationId, setConversationId] = useState<string | null>(model.activeConversationId);
  const [messages, setMessages] = useState<Message[]>(model.messages);
  const displayedMessages = useMemo(() => dedupeMissionCards(messages), [messages]);
  const [draft, setDraft] = useState(model.initialDraft);
  const [runtimeConfig, setRuntimeConfig] = useState<ConversationRuntimeConfig>(
    model.controls.config
  );
  const [sending, setSending] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const processingRef = useRef(false);
  const pendingSendRef = useRef<PendingSend | null>(null);
  const completedRunRef = useRef<string | null>(null);
  const activeRunRef = useRef<string | null>(null);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  useDesktopNotify();
  const [palette, setPalette] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; archivedId?: string } | null>(null);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 用户是否停在底部附近：只有这时新回复才自动滚到底；在读历史时改为显示「有新消息」。 */
  const stickRef = useRef(true);
  const lastTopRef = useRef(0);
  const [unread, setUnread] = useState(false);
  const scrollStateRef = useRef<{ conversationId: string | null | undefined; count: number; sending: boolean }>({ conversationId: undefined, count: 0, sending: false });
  /** 入场动画基线：只有基线之后追加的消息播放一次入场；轮询刷新、切换对话不重播。 */
  const enterRef = useRef({ conversationId, count: messages.length });
  const viewRef = useRef(0);
  const activeIdRef = useRef(model.activeConversationId);
  const modelIdRef = useRef(model.activeConversationId);
  const sendingRef = useRef(false);
  const failedRef = useRef<string | null>(null);
  const pollBoostRef = useRef(0);
  const configRequestRef = useRef(0);
  const draftsRef = useRef(new Map<string, string>());
  const saveTimer = useRef(0);
  const [draftSaved, setDraftSaved] = useState(false);
  // 挂载时从本机恢复草稿（URL query 带来的种子文案优先，不覆盖）。
  useEffect(() => {
    pendingSendRef.current = loadPending(model.activeConversationId ?? "new");
    const unsent = pendingSendRef.current;
    if (unsent && !unsent.runId) {
      failedRef.current = unsent.text;
      setDraft(unsent.text);
      setFeedback({ text: "上次发送的回执尚未确认，可重试同一条消息。" });
    }
    const stored = loadDrafts();
    for (const [k, v] of stored) draftsRef.current.set(k, v);
    if (!model.initialDraft) {
      const s = draftsRef.current.get(model.activeConversationId ?? "new") ?? "";
      if (s) {
        setDraft(s);
        setDraftSaved(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const updateDraft = useCallback((v: string) => {
    setDraft(v);
    draftsRef.current.set(activeIdRef.current ?? "new", v);
    persistDrafts(draftsRef.current);
    window.clearTimeout(saveTimer.current);
    if (v.trim()) {
      saveTimer.current = window.setTimeout(() => setDraftSaved(true), 800);
    } else {
      setDraftSaved(false);
    }
  }, []);

  useEffect(() => {
    if (modelIdRef.current !== model.activeConversationId) {
      modelIdRef.current = model.activeConversationId;
      if (activeIdRef.current !== model.activeConversationId) {
        viewRef.current += 1;
        activeIdRef.current = model.activeConversationId;
        sendingRef.current = false;
        setSending(false);
        processingRef.current = false;
        setProcessing(null);
        pendingSendRef.current = loadPending(model.activeConversationId ?? "new");
        const restored = draftsRef.current.get(model.activeConversationId ?? "new") ?? "";
        setDraft(restored);
        setDraftSaved(!!restored.trim());
      }
    }
    setConversationId(model.activeConversationId);
    if (!sendingRef.current) setMessages(model.messages);
    setRuntimeConfig(model.controls.config);
  }, [model.activeConversationId, model.messages, model.controls.config]);

  const conversation = useMemo(
    () => brief.conversations.find((item) => item.id === conversationId) ?? null,
    [brief.conversations, conversationId]
  );
  const pending = brief.decisions.filter((decision) => !resolved[decision.id]);
  const conversationDecisions = pending.filter(
    (decision) =>
      conversation &&
      decision.conversationId === conversation.id &&
      decision.gate !== "Proposal / Approval"
  );
  const copyThread = useCallback(async () => {
    if (!conversation || messages.length === 0) return;
    const lines = [`# ${conversation.title}`, ""];
    for (const m of messages) {
      const text = m.blocks
        .map((b) => ("text" in b && typeof b.text === "string" ? b.text.trim() : ""))
        .filter(Boolean)
        .join("\n\n");
      if (!text) continue;
      lines.push(m.author === "user" ? "**你**" : "**Kern**", "", text, "");
    }
    const text = `${lines.join("\n").trimEnd()}\n`;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch { /* 降级到传统方式 */ }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch { ok = false; }
    }
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } else {
      setFeedback({ text: "复制失败：浏览器没有给剪贴板权限", error: true });
    }
  }, [conversation, messages]);

  useEffect(() => {
    enterRef.current = { conversationId, count: messages.length };
  }, [conversationId, messages.length]);
  const enterFrom = enterRef.current.conversationId === conversationId ? enterRef.current.count : Number.POSITIVE_INFINITY;

  // 滚到真正的底部（含底部留白），而不是让尾标记贴着视口底边——后者会把最后一条消息压在输入区下面。
  const scrollToLatest = useCallback(() => {
    const box = scrollRef.current;
    box?.scrollTo({ top: box.scrollHeight, behavior: reducedMotion() ? ("instant" as ScrollBehavior) : "smooth" });
  }, []);

  // 滚动策略：切换对话直接定位到底部；自己刚发出消息时滚到底；
  // 其他新消息只在用户本来就在底部时跟随，否则保留阅读位置并提示「有新消息」。
  useEffect(() => {
    const previous = scrollStateRef.current;
    scrollStateRef.current = { conversationId, count: messages.length, sending };
    const box = scrollRef.current;
    if (!conversationId || !box) return;
    if (previous.conversationId !== conversationId) {
      box.scrollTo({ top: box.scrollHeight, behavior: "instant" as ScrollBehavior });
      stickRef.current = true;
      setUnread(false);
      return;
    }
    const justSent = sending && !previous.sending;
    if (justSent || stickRef.current) {
      scrollToLatest();
      setUnread(false);
    } else if (messages.length > previous.count) {
      setUnread(true);
    }
  }, [conversationId, messages.length, sending, scrollToLatest]);

  // 只有用户向上滚才取消跟随；平滑滚到底的过程中（scrollTop 递增）不会被误判为「在读历史」。
  const onScroll = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const top = box.scrollTop;
    const nearBottom = box.scrollHeight - top - box.clientHeight < 120;
    if (nearBottom) {
      stickRef.current = true;
      setUnread(false);
    } else if (top < lastTopRef.current - 2) {
      stickRef.current = false;
    }
    lastTopRef.current = top;
  }, []);

  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    setUnread(false);
    scrollToLatest();
  }, [scrollToLatest]);

  // 面板代码在空闲时预取：第一次点开「记忆 / 凭证 / 连接…」不用等分包下载，动画从点击那一刻开始。
  useEffect(() => {
    const prefetch = () => { void import("./components/sheets"); };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(prefetch, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let disposed = false;
    const view = viewRef.current;
    let refreshing = false;

    const refreshMessages = async () => {
      if (disposed || refreshing || sendingRef.current || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed || viewRef.current !== view || sendingRef.current) return;
        const executions = Array.isArray(data.executions) ? data.executions as MessageExecution[] : [];
        const active = executions.find(run => run.status === "QUEUED" || run.status === "RUNNING");
        if (active) activeRunRef.current = active.runId;
        else if (activeRunRef.current && completedRunRef.current !== activeRunRef.current) {
          completedRunRef.current = activeRunRef.current;
          activeRunRef.current = null;
          router.refresh();
        }
        processingRef.current = Boolean(active);
        setProcessing(active ? (active.status === "QUEUED" ? (data.workerReady ? "消息已保存，等待执行…" : "消息已保存，等待后台执行器启动…") : "Kern 正在处理这条消息…") : null);
        const pendingSend = pendingSendRef.current;
        const own = pendingSend && executions.find(run => run.clientMessageId === pendingSend.clientMessageId);
        if (own && pendingSend) {
          setDraft(current => current === pendingSend.text ? "" : current);
          if (draftsRef.current.get(conversationId) === pendingSend.text) {
            draftsRef.current.delete(conversationId); persistDrafts(draftsRef.current);
          }
        }
        if (own && own.status !== "QUEUED" && own.status !== "RUNNING") {
          persistPending(conversationId, null);
          pendingSendRef.current = null;
          failedRef.current = null;
          if (own.error) setFeedback({ text: own.error, error: true });
          if (completedRunRef.current !== own.runId) {
            completedRunRef.current = own.runId;
            router.refresh();
          }
        } else if (own && pendingSend) {
          pendingSend.runId = own.runId;
          persistPending(conversationId, pendingSend);
          failedRef.current = null;
        }
        if (!Array.isArray(data.messages)) return;
        const next = (data.messages as ApiMessage[]).map(fromApiMessage);
        setMessages((current) => {
          return JSON.stringify(current) === JSON.stringify(next)
            ? current
            : next;
        });
      } catch {
        // 轮询失败不阻断当前对话；下一轮会继续尝试。
      } finally {
        refreshing = false;
      }
    };

    // 发送后前几轮用 1.2s 加速首字，之后回到 2.5s 常态。
    void refreshMessages();
    let timer = 0;
    const tick = () => {
      if (disposed) return;
      void refreshMessages();
      const fast = pollBoostRef.current > 0;
      if (fast) pollBoostRef.current -= 1;
      timer = window.setTimeout(tick, fast ? 1200 : 2500);
    };
    timer = window.setTimeout(tick, 1200);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [conversationId, sending, router]);

  const openSource = useCallback(
    (ref: EvidenceRef) => setSheet({ kind: "source", ref }),
    []
  );

  const updateRuntimeConfig = useCallback(
    async (next: ConversationRuntimeConfig) => {
      const previous = runtimeConfig;
      const view = viewRef.current;
      const request = ++configRequestRef.current;
      setRuntimeConfig(next);
      if (!conversationId) return;

      try {
        const response = await fetch(
          `/api/conversations/${conversationId}/runtime-config`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: next }),
          }
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "保存 Conversation 配置失败");
        }
        if (viewRef.current !== view || configRequestRef.current !== request) return;
        setRuntimeConfig(data.config as ConversationRuntimeConfig);
      } catch (error) {
        if (viewRef.current !== view || configRequestRef.current !== request) return;
        setRuntimeConfig(previous);
        const message =
          error instanceof Error ? error.message : "保存 Conversation 配置失败";
        setMessages((current) => [
          ...current,
          {
            id: `config-error-${Date.now()}`,
            author: "kern",
            byEmployeeId: "e-hermes",
            at: new Date().toISOString(),
            state: "error",
            blocks: [{ kind: "text", text: message }],
          },
        ]);
      }
    },
    [conversationId, runtimeConfig]
  );


  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
    // --- Kern Role Intelligence: auto-detect role switch from user input ---
    try {
      const mod = require("@/components/kern-role-intelligence");
      const switched = mod.detectRoleSwitchIntent(text);
      if (switched) {
        try {
          localStorage.setItem("kern.kern-role.v1", JSON.stringify({ role: switched, at: Date.now(), reason: `对话指令: ${text.slice(0, 30)}` }));
        } catch {}
      } else {
        const inf = mod.inferRoleFromText(text);
        if (inf && inf.confidence > 0.6) {
          try {
            const existing = JSON.parse(localStorage.getItem("kern.auto-roles.v1") || "[]");
            existing.push(inf);
            localStorage.setItem("kern.auto-roles.v1", JSON.stringify(existing.slice(-6)));
          } catch {}
        }
      }
    } catch {}

    if (sendingRef.current || processingRef.current || decisionBusy) {
      if (text) setFeedback({ text: "Kern 还在处理上一条，稍等一下。" });
      return false;
    }
    if (!text) return false;

    const view = viewRef.current;
    const draftKey = conversationId ?? "new";
    const storedPending = pendingSendRef.current ?? loadPending(draftKey);
    const request: PendingSend = storedPending?.text === text ? storedPending : {
      clientMessageId: crypto.randomUUID(), conversationId: conversationId ?? crypto.randomUUID(), text,
    };
    pendingSendRef.current = request;
    persistPending(draftKey, request);
    let targetDraftKey = draftKey;
    sendingRef.current = true;
    setSending(true);
    setFeedback(null);
    if (override === undefined) {
      draftsRef.current.set(draftKey, "");
      persistDrafts(draftsRef.current);
      setDraft("");
      setDraftSaved(false);
    }
    const mine: Message = {
      id: `local-${request.clientMessageId}`,
      author: "user",
      at: new Date().toISOString(),
      state: "success",
      blocks: [{ kind: "text", text }],
    };
    setMessages((current) => current.some(message => message.id === mine.id) ? current : [...current, mine]);

    try {
      let activeId = conversationId;
      if (!activeId) {
        const create = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientConversationId: request.conversationId,
            title: text.slice(0, 60) || "新任务",
            productId: model.newConversationProduct?.id ?? null,
            runtimeConfig,
          }),
        });
        const created = await create.json();
        if (!create.ok) throw new Error(created.message || "创建会话失败");
        activeId = created.id;
        targetDraftKey = created.id;
        persistPending(created.id, request);
        persistPending("new", null);
        if (viewRef.current === view) {
          activeIdRef.current = activeId;
          setConversationId(activeId);
          window.history.replaceState(null, "", `/muse?c=${activeId}`);
        }
      }

      const response = await fetch(
        `/api/conversations/${activeId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, clientMessageId: request.clientMessageId }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "发送失败");

      request.runId = data.execution.runId;
      persistPending(targetDraftKey, request);
      failedRef.current = null;
      pollBoostRef.current = 4;
      if (viewRef.current === view) {
        setMessages((current) => current.map(message => message.id === mine.id ? fromApiMessage(data.message as ApiMessage) : message));
        const busy = data.execution.status === "QUEUED" || data.execution.status === "RUNNING";
        processingRef.current = busy;
        setProcessing(busy ? (data.workerReady ? "消息已保存，等待执行…" : "消息已保存，等待后台执行器启动…") : null);
      }
      return true;
    } catch (error) {
      if (viewRef.current !== view) {
        if (override === undefined && !draftsRef.current.get(targetDraftKey)) {
          draftsRef.current.set(targetDraftKey, text);
          persistDrafts(draftsRef.current);
        }
        return false;
      }
      failedRef.current = text;
      if (override === undefined) {
        draftsRef.current.set(targetDraftKey, text);
        persistDrafts(draftsRef.current);
        setDraftSaved(true);
        setDraft((current) => current || text);
      }
      const message =
        error instanceof Error ? error.message : "发送失败，请稍后重试";
      setFeedback({ text: message, error: true });
      setMessages((current) => [
        ...current.map(m => m.id === mine.id ? { ...m, state: "error" as const } : m),
        {
          id: `error-${Date.now()}`,
          author: "kern",
          byEmployeeId: "e-hermes",
          at: new Date().toISOString(),
          state: "error",
          blocks: [{ kind: "text", text: message }],
        },
      ]);
      return false;
    } finally {
      if (viewRef.current === view) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }, [draft, conversationId, model.newConversationProduct?.id, runtimeConfig, decisionBusy]);

  const retryFailed = useCallback(() => {
    const text = failedRef.current;
    if (text && !sendingRef.current && !decisionBusy) void send(text);
  }, [send, decisionBusy]);

  const resolve = useCallback(
    async (decision: Decision, choice: Decision["options"][number], givenReason?: string) => {
      if (decisionBusy) return;

      if (choice.kind === "defer") {
        setResolved((current) => ({ ...current, [decision.id]: choice.label }));
        return;
      }

      let reason: string | null = null;
      if (choice.kind === "reject") {
        reason = givenReason ?? null;
        if (!reason?.trim()) {
          // In-app reason sheet (no native dialogs): the reason is audited.
          setSheet({ kind: "reject", decision, choice });
          return;
        }
      }

      const view = viewRef.current;
      setDecisionBusy(decision.id);
      try {
        const endpoint =
          choice.kind === "approve"
            ? `/api/proposals/${decision.id}/confirm`
            : `/api/proposals/${decision.id}/reject`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (choice.kind === "approve") {
          headers["Idempotency-Key"] = `muse:proposal:${decision.id}:approve`;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(
            choice.kind === "reject" ? { reason: reason?.trim() } : {}
          ),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "处理失败");

        setResolved((current) => ({ ...current, [decision.id]: choice.label }));
        router.refresh();
        if (viewRef.current !== view) return;
        setMessages((current) => [
          ...current,
          {
            id: `decision-${decision.id}-${Date.now()}`,
            author: "kern",
            byEmployeeId: "e-hermes",
            at: new Date().toISOString(),
            state: "success",
            blocks: [
              {
                kind: "text",
                text:
                  choice.kind === "approve"
                    ? "已按你的批准执行并写入回执。"
                    : "已记录拒绝理由；没有写入这项业务变更。",
              },
            ],
          },
        ]);
      } catch (error) {
        if (viewRef.current !== view) return;
        const message =
          error instanceof Error ? error.message : "处理失败，请刷新后重试";
        setMessages((current) => [
          ...current,
          {
            id: `decision-error-${Date.now()}`,
            author: "kern",
            byEmployeeId: "e-hermes",
            at: new Date().toISOString(),
            state: "error",
            blocks: [{ kind: "text", text: message }],
          },
        ]);
      } finally {
        setDecisionBusy(null);
      }
    },
    [decisionBusy, router]
  );

  const pickConversation = useCallback(
    (id: string | null) => {
      draftsRef.current.set(activeIdRef.current ?? "new", draft);
      persistDrafts(draftsRef.current);
      viewRef.current += 1;
      activeIdRef.current = id;
      sendingRef.current = false;
      setSending(false);
      setMessages([]);
      const loaded = draftsRef.current.get(id ?? "new") ?? "";
      setDraft(loaded);
      setDraftSaved(!!loaded.trim());
      setFeedback(null);
      setRailOpen(false);
      if (!id) {
        setConversationId(null);
        setMessages([]);
        setRuntimeConfig({
          version: "kern-conversation-config/v1",
          modelProfileKey: null,
          advisorCodes: null,
          skillKeys: null,
          capabilityKeys: null,
        });
        router.push("/muse");
        return;
      }
      setConversationId(id);
      router.push(`/muse?c=${id}`);
    },
    [draft, router]
  );

  const renameConversation = useCallback(
    async (conversation: { id: string; title: string }, title: string) => {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "重命名失败，请重试");
      }
    },
    [router]
  );

  const archiveConversation = useCallback(
    async (conversation: { id: string }, archived = true) => {
      if (conversationBusy) return;
      setConversationBusy(true);
      try {
        const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        if (archived && activeIdRef.current === conversation.id) pickConversation(null);
        setFeedback({ text: archived ? "对话已归档，内容仍然保留。" : "对话已恢复。", archivedId: archived ? conversation.id : undefined });
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "更新对话失败，请重试");
      }
      } catch (error) {
        setFeedback({ text: error instanceof Error ? error.message : "网络连接失败，请重试", error: true, archivedId: archived ? undefined : conversation.id });
      } finally {
        setConversationBusy(false);
      }
    },
    [conversationBusy, pickConversation, router]
  );

  return (
    <div className="muse" data-rail={railOpen ? "open" : undefined}>
      <Rail
        user={model.user}
        conversations={brief.conversations}
        activeId={conversationId}
        runtime={runtime}
        onPick={pickConversation}
        onNew={() => pickConversation(null)}
        onTrust={() => setSheet({ kind: "trust" })}
        onClose={() => setRailOpen(false)}
        onRename={(conversation) => setSheet({ kind: "rename", conversation })}
        onArchive={(conversation) => void archiveConversation(conversation)}
      />

      <main className="m-main">
        <header className="m-top">
          <div className="m-top-in">
            <button
              type="button"
              className="m-btn m-rail-open"
              data-v="ghost"
              data-size="sm"
              onClick={() => setRailOpen(true)}
              aria-label="展开侧栏"
            >
              <I.menu />
            </button>
            {/* KX-20 方案 B：顶部上下文栏——区域切换 · 我在哪 · 关联对象 · 需要你 · ⌘K */}
            <nav className="m-seg m-area" aria-label="区域">
              <a href="/muse" aria-current="page">对话</a>
              <a href="/manage">工作台</a>
            </nav>
            <div className="m-crumb">
              {conversation ? <span className="m-crumb-root">对话</span> : null}
              {conversation ? <span aria-hidden>›</span> : null}
              <h1 className="m-top-title">{conversation ? conversation.title : "Kern"}</h1>
            </div>
            {conversation?.productId ? (
              <a className="m-chip" href={`/products/${conversation.productId}`} title="打开关联产品的工作台">
                关联：{conversation.productName || "产品"}
              </a>
            ) : null}
            {brief.attention.needsYou.length > 0 ? (
              <button type="button" className="m-chip" data-t="warn" onClick={() => pickConversation(null)} title="回到首页查看需要你决定的事">
                需要你 {brief.attention.needsYou.length}
              </button>
            ) : null}
            <div className="m-top-acts">
              <button type="button" className="m-cmdk" onClick={() => setPalette(true)} aria-label="搜索或跳转（⌘K）">
                <I.search />
                <span>搜索或跳转</span>
                <kbd>⌘K</kbd>
              </button>
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "memory" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "memory"} aria-label="记忆" title="Kern 记住的关于你的事">
                <I.spark />
                <span>记忆</span>
              </Btn>
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "vault" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "vault"} aria-label="凭证" title="Kern 替你保管的凭证（永不显示明文）">
                <I.shield />
                <span>凭证</span>
              </Btn>
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "connectors" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "connectors"} aria-label="连接" title="接入外部系统（MCP），Kern 就能用它们的工具">
                <I.source />
                <span>连接</span>
              </Btn>
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "library" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "library"} aria-label="产出" title="Kern 完成的任务，随时再下载成文档、表格或演示稿">
                <I.plan />
                <span>产出</span>
              </Btn>
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "schedules" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "schedules"} aria-label="定时" title="每日简报、提醒与定期重跑：Kern 按时主动来找你">
                <I.clock />
                <span>定时</span>
              </Btn>
              {conversation && messages.length > 0 ? (
                <Btn size="sm" v="ghost" onClick={() => void copyThread()} aria-label={copied ? "已复制全文" : "复制全文"} title={copied ? "已复制到剪贴板" : "复制全文为 Markdown"}>
                  {copied ? <I.check /> : <I.copy />}
                </Btn>
              ) : null}
              <Btn size="sm" v="ghost" onClick={() => setSheet({ kind: "trail" })} aria-haspopup="dialog" aria-expanded={sheet?.kind === "trail"} aria-label="轨迹" title="Kern 做过的每一步">
                <I.trail />
                <span>轨迹</span>
              </Btn>
            </div>
          </div>
        </header>

        {!model.modelReady ? (
          <div className="m-notice" role="status">
            <i aria-hidden />
            <span>当前没有可用的模型配置。可以先补齐任务信息、查看计划或演示；正式开始前请检查模型、检索和后台执行服务。</span>
            <a href="/settings#models">查看状态</a>
          </div>
        ) : null}
        {feedback ? (
          <div className="m-feedback" role={feedback.error ? "alert" : "status"}>
            <span>{feedback.text}</span>
            {feedback.archivedId ? <Btn size="sm" disabled={conversationBusy} onClick={() => void archiveConversation({ id: feedback.archivedId! }, false)}>撤销归档</Btn> : null}
            <Btn size="sm" v="ghost" onClick={() => setFeedback(null)} aria-label="关闭提示"><I.close /></Btn>
          </div>
        ) : null}
        <div style={{ padding: '0 16px' }}><DailyBriefing category="health_food" />
      <KernRoleBar /></div>
        <div className="m-scroll" ref={scrollRef} onScroll={onScroll}>
          <ConclusionDecisions key={conversationId ?? "new"}
            replies={messages.filter(m => m.author === "user" && m.state === "success" && !m.id.startsWith("local-")).flatMap(m => m.blocks.flatMap(b => b.kind === "text" ? [b.text] : []))}
            disabled={sending || Boolean(processing) || Boolean(decisionBusy)} send={send}>
          <div className="m-lane">
            {conversationId === null && !sending && messages.length === 0 ? (
              <Blank seeds={brief.suggestions} attention={brief.attention} userName={model.user.name} onSeed={updateDraft} onOpen={pickConversation} />
            ) : (
              <>
                {displayedMessages.map((message, index) => (
                  <Turn
                    key={message.id}
                    enter={index >= enterFrom}
                    m={message}
                    employees={employees}
                    onOpenSource={openSource}
                    onRetry={message.state === "error" ? retryFailed : undefined}
                  />
                ))}
                {conversationDecisions.map((decision) => (
                  <CheckIn
                    key={decision.id}
                    d={decision}
                    onOpenSource={openSource}
                    onResolve={resolve}
                  />
                ))}
                {sending || processing ? <Working text={processing || "正在保存消息…"} /> : null}
              </>
            )}
          </div>
          </ConclusionDecisions>
        </div>

        {unread ? (
          <button type="button" className="m-jump" onClick={jumpToLatest}>
            有新消息 <span aria-hidden>↓</span>
          </button>
        ) : null}
        <Dock
          value={draft}
          onChange={updateDraft}
          draftSaved={draftSaved}
          onSend={send}
          sending={sending || Boolean(processing) || Boolean(decisionBusy)}
          controls={model.controls}
          config={runtimeConfig}
          onConfigChange={updateRuntimeConfig}
          capabilities={runtime.capabilities}
          onTrust={() => setSheet({ kind: "trust" })}
        />
      </main>

      {sheet?.kind === "trail" ? (
        <TrailSheet
          activity={model.activity}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === "memory" ? <MemorySheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "vault" ? <VaultSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "connectors" ? <ConnectorSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "library" ? <LibrarySheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "schedules" ? <ScheduleSheet onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "rename" ? <ConversationRename key={sheet.conversation.id} conversation={sheet.conversation} onClose={() => setSheet(null)} onSave={(title) => renameConversation(sheet.conversation, title)} /> : null}
      {sheet?.kind === "reject" ? (
        <RejectSheet
          title={sheet.decision.title}
          onClose={() => setSheet(null)}
          onSubmit={(reason) => {
            const { decision, choice } = sheet;
            setSheet(null);
            void resolve(decision, choice, reason);
          }}
        />
      ) : null}
      {sheet?.kind === "trust" ? (
        <TrustSheet runtime={runtime} onClose={() => setSheet(null)} />
      ) : null}
      {sheet?.kind === "source" ? (
        <SourceSheet ref_={sheet.ref} onClose={() => setSheet(null)} />
      ) : null}
      {palette ? (
        <Palette
          conversations={brief.conversations}
          onClose={() => setPalette(false)}
          onPick={pickConversation}
        />
      ) : null}
    </div>
  );
}
