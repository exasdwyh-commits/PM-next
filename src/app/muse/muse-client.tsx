"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Decision, EvidenceRef, Message, StudioModel } from "./types";
import { readKernGraphCitation } from "@/modules/visual-intelligence/contracts";
import type { KernGraphV1 } from "@/modules/visual-intelligence/contracts";
import { Btn, I } from "./components/kit";
import { CheckIn, Turn, Working } from "./components/turn";
import { Palette, SourceSheet, TrailSheet, TrustSheet } from "./components/sheets";
import { Blank, Dock, Rail } from "./components/shell";

type SheetState =
  | { kind: "trail" }
  | { kind: "trust" }
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

  const refs: EvidenceRef[] = citations.flatMap((raw, index) => {
    if (readKernGraphCitation(raw)) return [];
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
    author: message.role === "USER" ? "user" : "hermes",
    byEmployeeId: message.role === "USER" ? null : "e-hermes",
    at: message.createdAt,
    state: "success",
    blocks: [
      { kind: "text", text: message.content },
      ...graphs.map((graph) => ({ kind: "graph" as const, graph })),
      ...(refs.length > 0
        ? ([{ kind: "evidence", title: "来源与回执", refs }] as Message["blocks"])
        : []),
    ],
  };
}

export default function KernClient({ model }: { model: StudioModel }) {
  const router = useRouter();
  const { brief, employees, runtime } = model;
  const [conversationId, setConversationId] = useState<string | null>(model.activeConversationId);
  const [messages, setMessages] = useState<Message[]>(model.messages);
  const [draft, setDraft] = useState(model.initialDraft);
  const [sending, setSending] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [palette, setPalette] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const tailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setConversationId(model.activeConversationId);
    setMessages(model.messages);
  }, [model.activeConversationId, model.messages]);

  const conversation = useMemo(
    () => brief.conversations.find((item) => item.id === conversationId) ?? null,
    [brief.conversations, conversationId]
  );
  const pending = brief.decisions.filter((decision) => !resolved[decision.id]);
  const conversationDecisions = pending.filter(
    (decision) =>
      goal &&
      decision.missionId === conversation.id &&
      decision.gate !== "Proposal / Approval"
  );

  useEffect(() => {
    if (!conversationId) return;
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversationId, messages.length, sending]);

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

    const refreshMessages = async () => {
      if (disposed || sending || document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.messages)) return;
        const next = (data.messages as ApiMessage[]).map(fromApiMessage);
        setMessages((current) => {
          const currentLast = current[current.length - 1]?.id;
          const nextLast = next[next.length - 1]?.id;
          return current.length === next.length && currentLast === nextLast
            ? current
            : next;
        });
      } catch {
        // 轮询失败不阻断当前对话；下一轮会继续尝试。
      }
    };

    void refreshMessages();
    const timer = window.setInterval(() => void refreshMessages(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [conversationId, sending]);

  const openSource = useCallback(
    (ref: EvidenceRef) => setSheet({ kind: "source", ref }),
    []
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setDraft("");
    const mine: Message = {
      id: `local-${Date.now()}`,
      author: "user",
      at: new Date().toISOString(),
      state: "success",
      blocks: [{ kind: "text", text }],
    };
    setMessages((current) => [...current, mine]);

    try {
      let conversationId = conversationId;
      if (!conversationId) {
        const create = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: text.slice(0, 60) || "新任务",
            productId: model.newConversationProduct?.id ?? null,
          }),
        });
        const created = await create.json();
        if (!create.ok) throw new Error(created.message || "创建会话失败");
        conversationId = created.id;
        setConversationId(conversationId);
        window.history.replaceState(null, "", `/muse?c=${conversationId}`);
      }

      const response = await fetch(
        `/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "发送失败");

      setMessages((current) => [
        ...current,
        fromApiMessage(data.message as ApiMessage),
      ]);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "发送失败，请稍后重试";
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          author: "hermes",
          byEmployeeId: "e-hermes",
          at: new Date().toISOString(),
          state: "error",
          blocks: [{ kind: "text", text: message }],
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [draft, conversationId, router, sending]);

  const resolve = useCallback(
    async (decision: Decision, choice: Decision["options"][number]) => {
      if (decisionBusy) return;

      if (choice.kind === "defer") {
        setResolved((current) => ({ ...current, [decision.id]: choice.label }));
        return;
      }

      let reason: string | null = null;
      if (choice.kind === "reject") {
        reason = window.prompt("请填写拒绝理由。该理由会进入正式审计记录。");
        if (!reason?.trim()) return;
      }

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
        setMessages((current) => [
          ...current,
          {
            id: `decision-${decision.id}-${Date.now()}`,
            author: "hermes",
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
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "处理失败，请刷新后重试";
        setMessages((current) => [
          ...current,
          {
            id: `decision-error-${Date.now()}`,
            author: "hermes",
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
      setRailOpen(false);
      if (!id) {
        setConversationId(null);
        setMessages([]);
        router.push("/muse");
        return;
      }
      setConversationId(id);
      router.push(`/muse?c=${id}`);
    },
    [router]
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
            <h1 className="m-top-title">{goal ? conversation.title : "Kern"}</h1>
            <div className="m-top-acts">
              <Btn size="sm" onClick={() => setPalette(true)}>
                <I.search />
                搜索
              </Btn>
              <Btn size="sm" onClick={() => setSheet({ kind: "trail" })}>
                <I.trail />
                轨迹
              </Btn>
            </div>
          </div>
        </header>

        <div className="m-scroll">
          <div className="m-lane">
            {conversation === null ? (
              <Blank seeds={brief.suggestions} onSeed={setDraft} />
            ) : (
              <>
                {conversation.productId ? (
                  <p className="m-hint">
                    已关联「{conversation.productName || conversation.productId}」
                    <a href={`/products/${conversation.productId}`}>查看工作台</a>
                  </p>
                ) : null}
                {messages.map((message) => (
                  <Turn
                    key={message.id}
                    m={message}
                    employees={employees}
                    onOpenSource={openSource}
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
                {sending ? <Working text="Kern 正在处理这条消息…" /> : null}
                <div ref={tailRef} aria-hidden />
              </>
            )}
          </div>
        </div>

        <Dock
          value={draft}
          onChange={setDraft}
          onSend={send}
          sending={sending || Boolean(decisionBusy)}
          capabilities={runtime.capabilities}
          onTrust={() => setSheet({ kind: "trust" })}
        />
      </main>

      {sheet?.kind === "trail" ? (
        <TrailSheet
          activity={model.activity}
          conversations={brief.conversations}
          onClose={() => setSheet(null)}
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
