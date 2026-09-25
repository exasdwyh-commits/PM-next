"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/app-shell";
import { Panel, Badge, Empty, Modal, Tabs, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { identityHeaders } from "@/shared/client-identity";
import { fmtDate } from "@/shared/datetime";
import { labelProductLifecycleStage } from "@/shared/status-labels";

const STAGE_ORDER = ["IDEA", "ANALYSIS", "SAMPLING", "LAUNCH_PREP", "LAUNCHED", "REVIEW", "PAUSED"];

interface BoardProduct {
  id: string;
  name: string;
  identityCode: string;
  coreIdea: string | null;
  lifecycleStage: string;
  owner: { id: string; name: string } | null;
  targetLaunchDate: string | null;
  actualLaunchDate: string | null;
  versionTag: string | null;
  projectCount: number;
  projects: { id: string; title: string; stage: string }[];
  scorecard: {
    weightedScore: number | null;
    coverageRatio: number;
    provisional: boolean;
    ruleVersion: string;
    computedAt: string;
  } | null;
  launchBlockedCount: number;
  hasLaunchPlan: boolean;
}

const EMPTY_FORM = {
  name: "",
  coreIdea: "",
  targetAudience: "",
  coreSellingPoints: "",
  targetChannels: "",
  priceExpectation: "",
  targetCost: "",
  formSpec: "",
  forbiddenItems: "",
  targetLaunchDate: "",
};

export default function ProductsClient({
  products,
  allUsers,
  currentSession,
  runtime,
  openIngest,
  mockAuth,
  initialForm,
}: {
  products: BoardProduct[];
  allUsers: { id: string; name: string; email: string }[];
  currentSession: { userId: string; userName: string; userEmail: string };
  runtime: { tone: "ok" | "warn" | "neutral"; label: string; detail: string };
  openIngest: boolean;
  mockAuth: boolean;
  initialForm?: Partial<typeof EMPTY_FORM>;
}) {
  const router = useRouter();
  const [activeUserId, setActiveUserId] = React.useState(currentSession?.userId || allUsers[0]?.id || "");
  const activeUser = allUsers.find((u) => u.id === activeUserId) || allUsers[0];

  const [view, setView] = React.useState<"list" | "board">("list");
  const [showIngest, setShowIngest] = React.useState(openIngest);
  const [form, setForm] = React.useState({ ...EMPTY_FORM, ...initialForm });
  const [errorMsg, setErrorMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState<string>("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (stageFilter && p.lifecycleStage !== stageFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.coreIdea ?? ""} ${p.identityCode}`.toLowerCase().includes(q);
    });
  }, [products, query, stageFilter]);

  const set = (k: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        coreIdea: form.coreIdea,
        targetAudience: form.targetAudience,
        coreSellingPoints: form.coreSellingPoints,
        targetChannels: form.targetChannels,
      };
      if (form.priceExpectation) payload.priceExpectation = form.priceExpectation;
      if (form.targetCost) payload.targetCost = Number(form.targetCost);
      if (form.formSpec) payload.formSpec = form.formSpec;
      if (form.forbiddenItems) payload.forbiddenItems = form.forbiddenItems;
      if (form.targetLaunchDate) payload.targetLaunchDate = form.targetLaunchDate;

      const res = await fetch("/api/products/ingest", {
        method: "POST",
        headers: identityHeaders(mockAuth, activeUserId, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "入库失败");
      setShowIngest(false);
      setForm(EMPTY_FORM);
      router.push(`/products/${data.productId}`);
    } catch (err: any) {
      setErrorMsg(err.message || "入库失败");
    } finally {
      setBusy(false);
    }
  };

  const stageLabel = (s: string) => labelProductLifecycleStage(s);

  const rowCells = (p: BoardProduct) => {
    const score = p.scorecard;
    return (
      <>
        <span className="project-name">
          {/* 首字母块取代原来的「◆」小菱形：列表里可扫读、也携带一点信息 */}
          <span className="project-mark" aria-hidden="true">
            {p.name.trim().slice(0, 1)}
          </span>
          <strong>{p.name}</strong>
          <small>{p.identityCode}</small>
        </span>
        <span data-label="生命周期">
          <b className="stage-badge">{stageLabel(p.lifecycleStage)}</b>
        </span>
        <span data-label="评分">
          {score ? (
            score.weightedScore === null ? (
              <span className="muted-line">无已评维度</span>
            ) : (
              <span className="health-score">
                <i />
                {score.weightedScore}
                {score.provisional && <em className="muted-line"> 暂评</em>}
              </span>
            )
          ) : (
            <span className="muted-line">未分析</span>
          )}
        </span>
        <span data-label="负责人">{p.owner?.name || <span className="muted-line">未设置</span>}</span>
        <span data-label="目标上市">
          {p.targetLaunchDate ? (
            fmtDate(p.targetLaunchDate)
          ) : (
            <span className="muted-line">未设置</span>
          )}
        </span>
        <span data-label="项目">{p.projectCount}</span>
        <span>
          {p.launchBlockedCount > 0 ? (
            <Badge tone="danger">阻塞 {p.launchBlockedCount}</Badge>
          ) : (
            <span className="muted-line">—</span>
          )}
        </span>
      </>
    );
  };

  return (
    <AppShell
      active="products"
      user={{ name: activeUser?.name || currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarLeft={
        <div className="hermes-topbar-title">
          <span className="eyebrow">PRODUCT DEVELOPMENT</span>
          <strong>产品</strong>
        </div>
      }
      topbarRight={
        mockAuth ? (
          <div className="hermes-identity">
            <span>当前身份（开发态）</span>
            <select value={activeUserId} onChange={(e) => setActiveUserId(e.target.value)} aria-label="切换操作人">
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        ) : undefined
      }
    >
      <div className="hermes-page-heading">
        <div>
          <p className="eyebrow">产品库</p>
          <h1>产品</h1>
          <p>已有明确想法 → 入库 → 分析评分 → 多轮优化 → 打样验证 → 上市准备 → 上市复盘</p>
        </div>
        <button className="hermes-primary-btn" onClick={() => setShowIngest(true)}>
          <Icon name="plus" size={16} />
          新产品入库
        </button>
      </div>

      <Panel
        eyebrow="PORTFOLIO"
        title="产品列表"
        titleSmall={`(${filtered.length}${filtered.length !== products.length ? ` / 共 ${products.length}` : ""})`}
        sub="阶段与负责人为真实字段，未填写即显示「未设置」"
        actions={
          <div className="hermes-inline">
            <div className="hermes-search is-compact">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索产品名称或编码..." />
            </div>
            <select className="hermes-select is-compact" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="">全部阶段</option>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </select>
            <Tabs
              items={[
                { key: "list", label: "列表" },
                { key: "board", label: "阶段看板" },
              ]}
              active={view}
              onChange={(k) => setView(k as "list" | "board")}
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <Empty>
            {products.length === 0
              ? "还没有产品。点右上角「新产品入库」，只需填写名称、一句话想法、目标人群、核心卖点与预期渠道即可保存。"
              : "没有匹配的产品，请调整搜索或阶段筛选。"}
          </Empty>
        ) : view === "list" ? (
          <>
            <div className="project-table-head">
              <span>产品</span>
              <span>生命周期</span>
              <span>评分</span>
              <span>负责人</span>
              <span>目标上市</span>
              <span>项目</span>
              <span>阻塞</span>
            </div>
            <div className="project-list">
              {filtered.map((p) => (
                <Link key={p.id} href={`/products/${p.id}`} className="project-row">
                  {rowCells(p)}
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="hermes-board">
            {STAGE_ORDER.map((stage) => {
              const col = filtered.filter((p) => p.lifecycleStage === stage);
              return (
                <div key={stage} className="hermes-board-col">
                  <div className="hermes-board-col-head">
                    <span>{stageLabel(stage)}</span>
                    <strong>{col.length}</strong>
                  </div>
                  {col.length === 0 ? (
                    <div className="hermes-board-empty">—</div>
                  ) : (
                    col.map((p) => (
                      <Link key={p.id} href={`/products/${p.id}`} className="hermes-board-card">
                        <strong>{p.name}</strong>
                        <small>{p.identityCode}</small>
                        <div className="hermes-board-card-meta">
                          <span>{p.owner?.name || "未设置负责人"}</span>
                          {p.scorecard?.weightedScore !== null && p.scorecard?.weightedScore !== undefined && (
                            <span className="health-score">
                              <i />
                              {p.scorecard.weightedScore}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {showIngest && (
        <Modal
          eyebrow="NEW PRODUCT"
          title="新产品入库"
          sub="首屏只要求五项；价格、成本、规格、禁用项、上市日为选填，可稍后补充。保存后立即进入产品总览。"
          wide
          onClose={() => setShowIngest(false)}
        >
          {errorMsg && <div className="hermes-banner is-danger">{errorMsg}</div>}
          <form onSubmit={handleIngest}>
            <div className="hermes-form-grid">
              <label className="hermes-label">
                <span>名称 *</span>
                <input required className="hermes-input" value={form.name} onChange={set("name")} placeholder="例如：低 GI 慢碳代餐燕麦脆" />
              </label>
              <label className="hermes-label">
                <span>一句话想法 *</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea"
                  value={form.coreIdea}
                  onChange={set("coreIdea")}
                  placeholder="用一句话说清这个产品要解决什么问题"
                />
              </label>
              <label className="hermes-label">
                <span>目标人群与场景 *</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea"
                  value={form.targetAudience}
                  onChange={set("targetAudience")}
                  placeholder="谁、在什么场景下用它"
                />
              </label>
              <label className="hermes-label">
                <span>核心卖点 *</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea"
                  value={form.coreSellingPoints}
                  onChange={set("coreSellingPoints")}
                  placeholder="与同类相比，最值得被记住的一点"
                />
              </label>
              <label className="hermes-label">
                <span>预期渠道 *</span>
                <input required className="hermes-input" value={form.targetChannels} onChange={set("targetChannels")} placeholder="例如：抖音自播 + 私域复购" />
              </label>

              <details className="hermes-details">
                <summary>选填项（可稍后补充）</summary>
                <div className="hermes-form-grid">
                  <label className="hermes-label">
                    <span>价格预期</span>
                    <input className="hermes-input" value={form.priceExpectation} onChange={set("priceExpectation")} placeholder="例如：99 元 / 盒" />
                  </label>
                  <label className="hermes-label">
                    <span>目标成本（元）</span>
                    <input type="number" step="0.01" className="hermes-input" value={form.targetCost} onChange={set("targetCost")} placeholder="单位目标成本" />
                  </label>
                  <label className="hermes-label">
                    <span>剂型 / 规格</span>
                    <input className="hermes-input" value={form.formSpec} onChange={set("formSpec")} placeholder="例如：片剂 60 片 / 瓶" />
                  </label>
                  <label className="hermes-label">
                    <span>禁用项</span>
                    <input className="hermes-input" value={form.forbiddenItems} onChange={set("forbiddenItems")} placeholder="例如：不含蔗糖、不含防腐剂" />
                  </label>
                  <label className="hermes-label">
                    <span>目标上市日</span>
                    <input type="date" className="hermes-input" value={form.targetLaunchDate} onChange={set("targetLaunchDate")} />
                  </label>
                </div>
              </details>

              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" onClick={() => setShowIngest(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={busy}>
                  <Icon name="plus" size={16} />
                  {busy ? "入库中…" : "保存并进入总览"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}
