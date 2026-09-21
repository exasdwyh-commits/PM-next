"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, Modal, Tabs, cx } from "@/components/ui";
import { BubbleChart } from "@/components/viz";
import Icon from "@/components/icons";
import { pickTopSignals, shouldRenderThemeLayer, themeGroupsForDisplay, type ThemeSignal } from "./theme-grouping";
import { fmtDate, fmtDateTime } from "@/shared/datetime";
import { labelEvidenceVerifyStatus } from "@/shared/status-labels";

interface Signal {
  id: string;
  title: string;
  summary: string | null;
  url: string | null;
  category: string;
  sourceName: string;
  importance: number;
  productRef: string | null;
  channel: string | null;
  nature: string;
  verifyStatus: string;
  valueTier: string | null;
  valueReason: string | null;
  collectedAt: string;
}

interface Source {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  mode: string;
  enabled: boolean;
  organizationId: string | null;
  lastStatus: string | null;
  _count: { items: number };
}

const EMPTY = {
  title: "",
  summary: "",
  url: "",
  productRef: "",
  channel: "",
  valueTier: "",
  valueReason: "",
};

export default function OpportunitiesClient({
  signals,
  sources,
  currentSession,
  runtime,
}: {
  signals: Signal[];
  sources: Source[];
  currentSession: { userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string };
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"signals" | "hypotheses" | "sources">("signals");
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg("");
    try {
      const payload: Record<string, unknown> = { title: form.title };
      if (form.summary) payload.summary = form.summary;
      if (form.url) payload.url = form.url;
      if (form.productRef) payload.productRef = form.productRef;
      if (form.channel) payload.channel = form.channel;
      if (form.valueTier) payload.valueTier = form.valueTier;
      if (form.valueReason) payload.valueReason = form.valueReason;

      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "录入失败");
      setShowAdd(false);
      setForm(EMPTY);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err.message || "录入失败");
    } finally {
      setBusy(false);
    }
  };

  const hypotheses = signals.filter((s) => s.verifyStatus === "UNVERIFIED");
  // 分层信息设计 · 市场机会：先归纳主题及公司相关性，未分析的明确「待判断」。
  const highValue = signals.filter((s) => s.valueTier === "high");
  const pendingJudgment = signals.filter((s) => s.verifyStatus === "UNVERIFIED" && !s.valueReason);
  const unevaluated = signals.filter((s) => !s.valueTier);
  const TIER_LABEL: Record<string, string> = { high: "高价值", normal: "一般", low: "低" };

  // 第二层「按主题归纳」：纯函数分组（见 theme-grouping.ts）。
  //
  // 「未归类」桶（既无 productRef 也无 channel）不作为主题展示 —— 该不变式由
  // themeGroupsForDisplay / shouldRenderThemeLayer 保证（可被单测直接证明）。
  // 这些信号不会被丢掉：下方第三层 Panel 的扁平列表始终展示全部信号。
  const themeGroups = themeGroupsForDisplay(signals as unknown as ThemeSignal[]);
  // 渲染门槛：不同真实主题键 ≥ 2 才渲染分组层；否则回退到第三层 Panel 的扁平列表（不渲染任何分组标题）。
  const showThemeLayer = shouldRenderThemeLayer(themeGroups);

  const opportunitySummary =
    signals.length === 0
      ? "尚无市场信号，先录入有来源的观察。"
      : highValue.length > 0
        ? `值得关注 ${highValue.length} 条高价值信号${pendingJudgment.length > 0 ? `，另有 ${pendingJudgment.length} 条待判断（缺价值依据）` : ""}。原始信号在下方列表中按需查看。`
        : pendingJudgment.length > 0
          ? `${pendingJudgment.length} 条信号待判断：已有来源但还没有价值分析，先补「价值判断依据」再决定是否跟进。`
          : `页面内 ${signals.length} 条信号均已有初步分级；原始出处在每条记录中可查。`;

  const signalList = (rows: Signal[], emptyText: string) =>
    rows.length === 0 ? (
      <Empty>{emptyText}</Empty>
    ) : (
      <div className="hermes-list">
        {rows.map((s) => (
          <div key={s.id} className="hermes-row">
            <div className="hermes-row-head">
              <span className="hermes-row-title">{s.title}</span>
              <span className="hermes-inline">
                {s.valueTier && <Badge tone={s.valueTier === "high" ? "ok" : s.valueTier === "low" ? "neutral" : "info"}>{TIER_LABEL[s.valueTier] ?? s.valueTier}</Badge>}
                {s.verifyStatus === "UNVERIFIED" && !s.valueReason ? (
                  <Badge tone="warn">待判断</Badge>
                ) : (
                  <Badge status={s.verifyStatus}>{labelEvidenceVerifyStatus(s.verifyStatus)}</Badge>
                )}
              </span>
            </div>
            <div className="hermes-row-meta">
              <span>来源 {s.sourceName}</span>
              {s.productRef && <span>适用产品 {s.productRef}</span>}
              {s.channel && <span>渠道 {s.channel}</span>}
              <span>{fmtDateTime(s.collectedAt)}</span>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="hermes-link">
                  原始链接
                </a>
              )}
            </div>
            {s.summary && <div className="hermes-row-body">{s.summary}</div>}
            {s.valueReason && <div className="hermes-row-meta"><span>价值判断依据：{s.valueReason}</span></div>}
            <div className="hermes-inline-end" style={{ marginTop: 8 }}>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hermes-ghost-btn hermes-btn-sm"
                >
                  <Icon name="search" size={13} />
                  查看原始来源
                </a>
              )}
              <Link
                href={`/advisor?query=${encodeURIComponent(`关于市场机会「${s.title}」，我们公司是否有相关产品布局或渠道政策？`)}`}
                className="hermes-outline-btn hermes-btn-sm"
              >
                <Icon name="chat" size={13} />
                问顾问验证
              </Link>
              <Link
                href={`/products?new=1&name=${encodeURIComponent(s.productRef || s.title)}&coreIdea=${encodeURIComponent(s.summary || s.title)}&targetChannels=${encodeURIComponent(s.channel || "")}`}
                className="hermes-outline-btn hermes-btn-sm"
              >
                <Icon name="plus" size={13} />
                转为产品想法
              </Link>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <AppShell
      active="opportunities"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">MARKET SIGNALS</span>
          <strong>市场机会</strong>
        </div>
      }
    >
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">机会库</p>
          <h1>市场机会</h1>
          <p>有来源的信号、机会摘要与待验证假设</p>
        </div>
        <button className="hermes-primary-btn" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={16} />
          手工录入信号
        </button>
      </div>

      <div className="hermes-banner is-warn">
        <strong>关于数据来源（如实标注）</strong>
        <div style={{ marginTop: 4 }}>
          自动监测尚未接入：所有外部平台 adapter 当前均未真实接入，采集时会跳过而非伪造。
          现阶段仅支持手工录入来源明确的观察，录入后核验状态保持「未核实」，需人工补充证据后再转为决策依据。
        </div>
      </div>

      <section className="hermes-theme-section" style={{ paddingTop: 4 }}>
        <p className="hermes-theme-conclusion">{opportunitySummary}</p>
        {signals.length > 0 && (
          <p className="hermes-theme-detail-p">
            高价值 {highValue.length} 条 · 待判断 {pendingJudgment.length} 条 · 未评估分级 {unevaluated.length} 条。
          </p>
        )}
      </section>

      {/* 机会雷达：两轴当前无可靠连续数值来源 → 不画点，只出坐标框 + 来源说明（证据契约）。 */}
      <Panel eyebrow="OPPORTUNITY RADAR" title="机会雷达" sub="价值轴 × 匹配度轴：无可靠数据源时不绘制。">
        <BubbleChart data={[]} xLabel="价值轴" yLabel="匹配度轴" source="none" />
        <p className="viz-source-note">
          匹配度轴无数据：SignalItem.relevance 无任何写入（唯一写入点恒为 null）；价值轴仅人工序数 valueTier
          （high / normal / low，且可空），importance 恒为 1。两轴都不满足可靠连续数值，故不绘制。
        </p>
      </Panel>

      {/* 第二层 · 按主题归纳：仅当存在 ≥2 个不同主题键（productRef/channel）才分组渲染；
          否则整段不渲染，直接由下方第三层 Panel 的扁平列表呈现。空数据（0 条）同样不渲染。 */}
      {showThemeLayer && (
        <div className="hermes-themes" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div className="hermes-brief-section-head" style={{ marginBottom: 6 }}>
            <h2 className="hermes-brief-section-title">按主题归纳</h2>
            <span className="hermes-brief-section-hint">按「适用产品 / 渠道」分组，每组列最重要的 3 条</span>
          </div>
          {themeGroups.map((g) => {
            // 每组最多 3 条重点信号；其余收进可展开入口，不占首屏。
            const top = pickTopSignals(g.signals, 3);
            const rest = g.signals.slice(3);
            // 只统计真实存在的维度，不推算：高价值 = valueTier 为 high；待判断 = 未核实且无价值依据。
            const hv = g.signals.filter((s) => s.valueTier === "high").length;
            const pj = g.signals.filter((s) => s.verifyStatus === "UNVERIFIED" && !s.valueReason).length;
            return (
              <section key={g.key} className="hermes-theme-section">
                <div className="hermes-theme-head">
                  <h3 className="hermes-theme-title">{g.key}</h3>
                  <Badge tone="neutral">{g.signals.length} 条</Badge>
                </div>
                <p className="hermes-theme-conclusion">
                  该主题共 {g.signals.length} 条信号，其中高价值 {hv} 条、待判断 {pj} 条。
                </p>
                <div className="hermes-theme-detail">
                  {top.map((s) => {
                    // 每条给一条关键元信息：有渠道显示渠道，再补来源与时间（有才显示，不编造）。
                    const metaBits: string[] = [];
                    if (s.channel) metaBits.push(`渠道 ${s.channel}`);
                    metaBits.push(`来源 ${s.sourceName}`);
                    metaBits.push(fmtDate(s.collectedAt));
                    return (
                      <p key={s.id}>
                        <span className="hermes-row-title" style={{ fontSize: 13.5 }}>
                          {s.title}
                        </span>
                        <span className="hermes-row-meta" style={{ marginLeft: 8 }}>
                          {metaBits.join(" · ")}
                        </span>
                      </p>
                    );
                  })}
                </div>
                {rest.length > 0 && (
                  <details className="hermes-details" style={{ marginTop: 10 }}>
                    <summary style={{ fontWeight: 600, padding: "4px 0" }}>展开其余 {rest.length} 条</summary>
                    <div style={{ marginTop: 12 }}>{signalList(rest as unknown as Signal[], "该主题下没有更多信号。")}</div>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Panel
        eyebrow="SIGNALS"
        title="信号"
        titleSmall={`(${signals.length})`}
        actions={
          <Tabs
            items={[
              { key: "signals", label: "全部信号" },
              { key: "hypotheses", label: "待验证假设" },
              { key: "sources", label: "来源清单" },
            ]}
            active={tab}
            onChange={(k) => setTab(k as typeof tab)}
          />
        }
      >
        {tab === "signals" &&
          signalList(
            signals,
            "还没有信号。点右上角「手工录入信号」记下一条有来源的市场观察；录入后可在产品分析中作为证据线索。"
          )}

        {tab === "hypotheses" &&
          signalList(
            hypotheses,
            "没有待验证假设。所有已录入信号都尚未核实 —— 补充来源证据并由负责人核验后，这里会相应减少。"
          )}

        {tab === "sources" && (
          <>
            <div className="hermes-note" style={{ marginBottom: 10 }}>
              来源分为两类：<b>公共来源配置</b>（组织归属为空，所有组织共用，仅登记来源本身）与
              <b>组织私有来源</b>（携带组织归属，内容不跨组织共享）。
            </div>
            {sources.length === 0 ? (
              <Empty>注册表中还没有来源配置。</Empty>
            ) : (
              <div className="hermes-list">
                {sources.map((s) => (
                  <div key={s.id} className="hermes-row">
                    <div className="hermes-row-head">
                      <span className="hermes-row-title">{s.name}</span>
                      <span className="hermes-inline">
                        <Badge tone={s.mode === "auto" ? "info" : "neutral"}>{s.mode === "auto" ? "自动" : "人工"}</Badge>
                        {s.organizationId ? <Badge tone="warn">组织私有</Badge> : <Badge tone="neutral">公共配置</Badge>}
                      </span>
                    </div>
                    <div className="hermes-row-meta">
                      <span>key {s.key}</span>
                      <span>已有信号 {s._count.items}</span>
                      <span>最近状态 {s.lastStatus || "未运行"}</span>
                    </div>
                    {s.description && <div className="hermes-row-body">{s.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Panel>

      {showAdd && (
        <Modal
          eyebrow="MANUAL SIGNAL"
          title="手工录入信号"
          sub="只登记你能给出出处的观察；录入不改变核验状态，也不会被当作已核实证据。"
          onClose={() => setShowAdd(false)}
        >
          {errorMsg && <div className="hermes-banner is-danger">{errorMsg}</div>}
          <form onSubmit={submit}>
            <div className="hermes-form-grid">
              <label className="hermes-label">
                <span>标题 *</span>
                <input required className="hermes-input" value={form.title} onChange={set("title")} placeholder="一句话描述这条市场观察" />
              </label>
              <label className="hermes-label">
                <span>摘要</span>
                <textarea rows={3} className="hermes-textarea" value={form.summary} onChange={set("summary")} placeholder="具体数据、时间、口径" />
              </label>
              <label className="hermes-label">
                <span>原始链接</span>
                <input className="hermes-input" value={form.url} onChange={set("url")} placeholder="https://" />
              </label>
              <label className="hermes-label">
                <span>适用产品</span>
                <input className="hermes-input" value={form.productRef} onChange={set("productRef")} placeholder="竞品或自有产品名称" />
              </label>
              <label className="hermes-label">
                <span>渠道</span>
                <input className="hermes-input" value={form.channel} onChange={set("channel")} placeholder="抖音 / 快手 / 私域…" />
              </label>
              <label className="hermes-label">
                <span>价值分级</span>
                <select className="hermes-select" value={form.valueTier} onChange={set("valueTier")}>
                  <option value="">未评估</option>
                  <option value="high">高</option>
                  <option value="normal">中</option>
                  <option value="low">低</option>
                </select>
              </label>
              <label className="hermes-label">
                <span>价值判断依据</span>
                <input className="hermes-input" value={form.valueReason} onChange={set("valueReason")} placeholder="为什么认为它值得关注" />
              </label>
              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" onClick={() => setShowAdd(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={busy}>
                  {busy ? "录入中…" : "保存"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}
