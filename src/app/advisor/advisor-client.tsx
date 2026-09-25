"use client";

import React from "react";
import CollapsibleList from "@/components/collapsible-list";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, Thinking, cx } from "@/components/ui";
import Icon from "@/components/icons";
import ProposalCard from "@/components/proposal-card";
import ChallengeReportCard from "@/components/challenge-report-card";
import { fmtDateTime } from "@/shared/datetime";
import { labelCitationKind } from "@/shared/status-labels";

interface Conversation {
  id: string;
  title: string;
  kind: string;
  updatedAt: string;
  _count: { messages: number };
  messages: { content: string; createdAt: string; role: string }[];
}

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  citations?: { kind: string; ref: string; title: string; report?: any }[] | null;
}

const SUGGESTIONS = [
  "帮我梳理一个新产品想法，并告诉我最先要验证什么",
  "本周哪些事情需要我决定，按紧急程度说明原因",
  "帮我分析一个市场机会是否值得继续研究",
  "汇总正在推进的产品、阻塞和下一步",
  "创建任务 安排打样原料备料",
  "本机帮我执行 git status，并把结果告诉我",
];

/** 产品上下文已绑定时，才提示「对话改方案」与产品任务写入链入口 */
const PRODUCT_SUGGESTIONS = [
  "启动一轮完整产品研发，先整理研发 Brief 和缺失输入",
  "总结这个产品当前结论、最大风险和下一步",
  "接下来最应该补什么证据，为什么",
  "挑战我的判断：这个产品假设哪里最脆弱？",
];

const ROLE_LABEL: Record<string, string> = {
  USER: "我",
  ASSISTANT: "HERMES 助理",
  SYSTEM: "系统",
  TOOL: "工具",
};

/**
 * 分层信息设计 · 顾问默认先给简短结论，长报告收进「展开」。
 * 规则：结论取正文首段（或前约 200 字），完整原文只在主动展开时出现。
 *
 * 注意：顾问回复以一行「（本轮未接入语言模型…）」的免责声明开头
 * （见 modules/advisor/service.ts 的 header 拼接）。那是**元信息，不是结论**。
 * 早前把它和正文一起当首段处理，导致用户看到的"结论"其实是免责声明，
 * 而真正的回答被折进了展开区 —— 这里必须先把它拆出来单独放。
 */
function AdvisorMessageBody({ role, content }: { role: string; content: string }) {
  const CONCLUSION_BUDGET = 200;
  const EXPAND_BUDGET = 420;

  if (role === "USER") {
    return <div className="hermes-chat-body" style={{ whiteSpace: "pre-wrap" }}>{content}</div>;
  }

  const noteMatch = /^（[^）]*）\n\n/.exec(content);
  const note = noteMatch ? noteMatch[0].trim() : null;
  const body = noteMatch ? content.slice(noteMatch[0].length) : content;
  const noteEl = note ? (
    <p className="hermes-note" style={{ marginBottom: 6 }}>
      {note}
    </p>
  ) : null;

  if (body.length <= EXPAND_BUDGET) {
    return (
      <div>
        {noteEl}
        <div className="hermes-chat-body" style={{ whiteSpace: "pre-wrap" }}>{body}</div>
      </div>
    );
  }

  const firstBreak = body.indexOf("\n\n");
  const conclusion =
    firstBreak > 0 && firstBreak <= CONCLUSION_BUDGET * 2
      ? body.slice(0, firstBreak)
      : body.slice(0, CONCLUSION_BUDGET) + "…";
  return (
    <div>
      {noteEl}
      <div className="hermes-chat-body" style={{ whiteSpace: "pre-wrap" }}>{conclusion}</div>
      <details className="hermes-details" style={{ marginTop: 10 }}>
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>展开看完整依据与明细</summary>
        <div className="hermes-chat-body" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{body}</div>
      </details>
    </div>
  );
}

export default function AdvisorClient({
  conversations,
  activeConversation,
  proposals: initialProposals,
  currentSession,
  runtime,
  productId,
  boundProduct,
  initialQuery = "",
}: {
  conversations: Conversation[];
  activeConversation: { id: string; title: string; messages: Message[] } | null;
  proposals: any[];
  currentSession: { userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string; modelConfigured: boolean };
  productId: string | null;
  boundProduct?: { id: string; name: string; identityCode: string; lifecycleStage: string; versions: { id: string; versionTag: string }[] } | null;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<Message[]>(activeConversation?.messages ?? []);
  const [proposals, setProposals] = React.useState<any[]>(initialProposals ?? []);
  // 回执由父级保管：确认后列表会刷新，卡片可能从「待确认」区移到「决策记录」区而重新挂载，
  // 若把回执放在卡片内部 state，服务端回执会在这一刻消失。
  const [receipts, setReceipts] = React.useState<Record<string, any>>({});
  const [input, setInput] = React.useState(initialQuery || "");
  const [busy, setBusy] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");

  const convoId = activeConversation?.id ?? null;

  React.useEffect(() => {
    setMessages(activeConversation?.messages ?? []);
    setProposals(initialProposals ?? []);
  }, [activeConversation?.id, activeConversation?.messages, initialProposals]);

  // Desktop Runtime 完成任务后会把真实结果写回原会话。
  // 轻量轮询让用户停留在对话页时也能直接看到结果，不需要手动刷新。
  React.useEffect(() => {
    if (!convoId) return;
    let disposed = false;

    const refreshMessages = async () => {
      if (disposed || busy || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/conversations/${convoId}/messages`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.messages)) return;
        setMessages((current) => {
          const next = data.messages as Message[];
          const currentLast = current[current.length - 1]?.id;
          const nextLast = next[next.length - 1]?.id;
          return current.length === next.length && currentLast === nextLast
            ? current
            : next;
        });
      } catch {
        // 桌面回执轮询失败不阻断当前对话。
      }
    };

    void refreshMessages();
    const timer = window.setInterval(() => void refreshMessages(), 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [convoId, busy]);

  /** 提议列表单独拉一次：会话切换与提议确认后都走这里，避免依赖整页刷新 */
  const reloadProposals = React.useCallback(async (forId?: string | null) => {
    const id = forId ?? convoId;
    if (!id) {
      setProposals([]);
      return;
    }
    try {
      const res = await fetch(`/api/proposals?conversationId=${id}&take=20`);
      const json = await res.json();
      if (res.ok) setProposals(json.items ?? []);
    } catch {
      // 提议列表拉取失败不阻断对话；静默保留上一次结果
    }
  }, [convoId]);

  const newConversation = async () => {
    setErrorMsg("");
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "创建会话失败");
      router.push(`/advisor?c=${data.id}${productId ? `&product=${productId}` : ""}`);
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setErrorMsg("");
    setBusy(true);
    let cid = activeConversation?.id;
    try {
      if (!cid) {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "创建会话失败");
        cid = data.id;
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/advisor?c=${cid}${productId ? `&product=${productId}` : ""}`);
        }
      }

      setMessages((m) => [
        ...m,
        { id: `local-${Date.now()}`, role: "USER", content: text, createdAt: new Date().toISOString() },
      ]);
      setInput("");

      const res = await fetch(`/api/conversations/${cid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "发送失败");

      setMessages((m) => [
        ...m,
        {
          id: data.message.id,
          role: "ASSISTANT",
          content: data.message.content,
          createdAt: data.message.createdAt || new Date().toISOString(),
          citations: data.message.citations ?? null,
        },
      ]);
      // 本轮若产出了待确认提议，立刻反映到列表里（提议 ≠ 执行，仍需人工确认）
      if (data.proposal) await reloadProposals(cid);
      router.refresh();
    } catch (e: any) {
      setErrorMsg(e.message || "发送失败");
    } finally {
      setBusy(false);
    }
  };

  /** 触发挑战我的判断：走 sendMessage 统一入口，持久化到 DB */
  const runChallenge = async () => {
    if (busy || !boundProduct) return;
    await send("挑战我的判断：这个产品假设哪里最脆弱？");
  };

  const disabled = !runtime.modelConfigured;
  const pendingProposals = proposals.filter((p) => p.status === "PENDING_CONFIRMATION");
  // 决策记录与挑战报告同一约定：默认 3 条，其余由 CollapsibleList「查看全部 / 收起」展开，不静默丢弃。
  const allDecidedProposals = proposals.filter((p) => p.status !== "PENDING_CONFIRMATION");
  const DECIDED_PREVIEW_COUNT = 3;
  const chips = productId ? [...PRODUCT_SUGGESTIONS, ...SUGGESTIONS] : SUGGESTIONS;

  const renderProposal = (p: any) => (
    <ProposalCard
      key={p.id}
      proposal={p}
      receipt={receipts[p.id]}
      onDone={(r: any) => {
        if (r) setReceipts((m) => ({ ...m, [p.id]: r }));
        reloadProposals();
      }}
    />
  );

  return (
    <AppShell
      active="advisor"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">DEPARTMENT ASSISTANT</span>
          <strong>AI 助理</strong>
        </div>
      }
      topbarRight={
        <button className="hermes-outline-btn hermes-btn-sm" onClick={newConversation}>
          <Icon name="plus" size={14} />
          新对话
        </button>
      }
    >
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">
            {boundProduct ? `当前产品 · ${boundProduct.identityCode}` : "公司上下文"}
          </p>
          <h1>{boundProduct ? `${boundProduct.name} AI 助理` : "AI 助理"}</h1>
          <p>
            {boundProduct
              ? `直接说这个产品要解决的问题。Hermes 会结合 ${boundProduct.name}（当前 ${boundProduct.versions[0]?.versionTag || "v1"}）的上下文回答、研究、拆任务或提出变更草案。`
              : "直接说你想完成什么。Hermes 会结合公司上下文回答、研究、拆解任务，并在需要业务确认时停下来等你决定。"}
          </p>
        </div>
        {boundProduct && (
          <div className="hermes-inline">
            <button className="hermes-challenge-btn" onClick={runChallenge} disabled={busy}>
              <Icon name="shield" size={14} />
              挑战我的判断
            </button>
            <Link href={`/products/${boundProduct.id}`} className="hermes-outline-btn hermes-btn-sm">
              <Icon name="arrow" size={13} />
              返回产品详情
            </Link>
          </div>
        )}
      </div>

      {boundProduct && (
        <div className="hermes-banner is-info" style={{ marginBottom: 14 }}>
          <strong>已锁定产品上下文：{boundProduct.name}（{boundProduct.versions[0]?.versionTag || "v1"}）</strong>
          <div style={{ marginTop: 3 }}>
            在该会话中的修改方案、创建任务与上市咨询提议，将全部严格绑定到该产品。
          </div>
        </div>
      )}

      <div className="hermes-advisor">
        <Panel eyebrow="SESSIONS" title="历史会话" titleSmall={`(${conversations.length})`}>
          {conversations.length === 0 ? (
            <Empty>还没有历史会话。直接在右侧告诉 Hermes 你想完成什么即可。</Empty>
          ) : (
            <div className="hermes-list">
              {conversations.map((c) => (
                <Link
                  key={c.id}
                  href={`/advisor?c=${c.id}${productId ? `&product=${productId}` : ""}`}
                  className={cx("hermes-row", c.id === activeConversation?.id && "is-selected")}
                >
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{c.title}</span>
                    <Badge tone="neutral">{c._count.messages} 条</Badge>
                  </div>
                  <div className="hermes-row-meta">
                    <span>{c.messages[0]?.content?.slice(0, 40) || "（暂无消息）"}</span>
                    <span>{fmtDateTime(c.updatedAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="CONVERSATION"
          title={activeConversation?.title || "新对话"}
          sub={activeConversation ? undefined : "首次发送会自动创建会话"}
        >
          {errorMsg && (
            <div className="hermes-banner is-danger" role="alert" aria-live="assertive">
              {errorMsg}
            </div>
          )}

          {(pendingProposals.length > 0 || allDecidedProposals.length > 0) && (
            <div className="hermes-stack" style={{ marginBottom: 16 }}>
              {pendingProposals.length > 0 && (
                <>
                  <div className="hermes-section-label">
                    待确认提议（{pendingProposals.length}）· 未经确认不会写入业务数据
                  </div>
                  {pendingProposals.map((p) => renderProposal(p))}
                </>
              )}
              {allDecidedProposals.length > 0 && (
                <>
                  <div className="hermes-section-label">最近的提议决策记录</div>
                  {/* 必须复用 renderProposal：确认后卡片会从「待确认」区移到这个区，
                      这里若另写一个不接 receipt 的 ProposalCard，服务端回执会在移动的瞬间消失。 */}
                  <CollapsibleList
                    items={allDecidedProposals}
                    previewCount={DECIDED_PREVIEW_COUNT}
                    unit="条记录"
                    toggleMarginTop={8}
                    renderItem={(p) => renderProposal(p)}
                  />
                </>
              )}
            </div>
          )}

          {messages.length === 0 ? (
            <div className="hermes-advisor-empty">
              <Empty>直接描述目标，不需要先选择 Agent 或工作流。也可以从下面的常用任务开始：</Empty>
              <div className="hermes-inline" style={{ flexWrap: "wrap", marginTop: 10 }}>
                {chips.map((s) => (
                  <button key={s} className="hermes-chip" onClick={() => send(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="hermes-chat">
              {messages.map((m) => {
                // 从 citations 中解析挑战报告（kind="challenge-report"）
                const reportCitation = m.citations?.find((c) => c.kind === "challenge-report");
                const normalCitations = m.citations?.filter((c) => c.kind !== "challenge-report") ?? [];
                const report = reportCitation?.report;

                return (
                  <div key={m.id} className={cx("hermes-chat-msg", m.role === "USER" ? "is-user" : "is-assistant")}>
                    <div className="hermes-chat-role">{ROLE_LABEL[m.role] ?? m.role}</div>
                    {report ? (
                      <ChallengeReportCard report={report} />
                    ) : (
                      <>
                        <AdvisorMessageBody role={m.role} content={m.content} />
                        {normalCitations.length > 0 && (
                          <div className="hermes-chat-cites">
                            {normalCitations.map((c, i) => (
                              <span key={i} className="hermes-chip">
                                {labelCitationKind(c.kind)} · {c.title}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {busy && <div className="hermes-chat-msg is-assistant"><div className="hermes-chat-role">HERMES 助理</div><Thinking label="正在检索公司资料并组织答案…" /></div>}
            </div>
          )}

          {/* 已有会话时快捷提问仍常驻，避免只有空会话才能拿到入口 */}
          {messages.length > 0 && !busy && (
            <div className="hermes-chat-suggest">
              <span className="hermes-chat-suggest-label">继续追问</span>
              <div className="hermes-inline" style={{ flexWrap: "wrap" }}>
                {chips.map((s) => (
                  <button key={s} className="hermes-chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="hermes-chat-composer">
            <textarea
              className="hermes-textarea"
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  if ((e.nativeEvent as any)?.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="告诉 Hermes 你想完成什么…（Enter 发送，Shift+Enter 换行）"
            />
            <button className="hermes-primary-btn" onClick={() => send(input)} disabled={busy || !input.trim()}>
              <Icon name="arrow" size={15} />
              发送
            </button>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
