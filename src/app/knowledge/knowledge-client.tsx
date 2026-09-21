"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, PageHeading, Button, Badge, Empty, Modal, Tabs } from "@/components/ui";
import { fmtDateTime } from "@/shared/datetime";
import { labelCompanyFactStatus, labelKnowledgeSourceKind } from "@/shared/status-labels";

interface KnowledgeClientProps {
  overview: {
    sources: any[];
    stats: {
      sourceCount: number;
      documentCount: number;
      chunkCount: number;
      confirmedFactsCount: number;
      pendingFactsCount: number;
    };
    facts: any[];
  };
  workItems: any[];
  /** 知识库管理员：可维护知识源/触发同步/录入事实，并查看事实技术字段 */
  isAdmin: boolean;
  /** 内容性质开关（P3）：示例模式下展示性质声明横幅，可由环境变量关闭 */
  contentMode: { knowledgeSampleMode: boolean };
  sampleModeBanner: string;
}

type KnowledgeTab = "browse" | "facts" | "outcomes";

export default function KnowledgeClient({ overview: initialOverview, workItems, isAdmin, contentMode, sampleModeBanner }: KnowledgeClientProps) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 操作后改用 router.refresh() 局部刷新；服务端重取后 props 变化，这里显式把 overview 同步进来
  // （useState 初始值只在首次挂载生效；依赖用可稳定比较的键，避免每次渲染都重置本地状态）。
  const overviewKey = [
    initialOverview.stats.sourceCount,
    initialOverview.stats.documentCount,
    initialOverview.stats.confirmedFactsCount,
    initialOverview.stats.pendingFactsCount,
    initialOverview.facts.map((f: any) => f.id).join(","),
    initialOverview.sources.map((s: any) => s.id).join(","),
  ].join("|");
  React.useEffect(() => {
    setOverview(initialOverview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewKey]);

  const showBanner = (text: string, type: "success" | "error" = "success") => {
    setBanner({ text, type });
    setTimeout(() => setBanner(null), 5000);
  };

  const [activeTab, setActiveTab] = useState<KnowledgeTab>("browse");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>(null);

  // Source management modal
  const [showManageSources, setShowManageSources] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [addingSource, setAddingSource] = useState(false);

  // Sync state
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Fact form state
  const [showAddFact, setShowAddFact] = useState(false);
  const [factKey, setFactKey] = useState("");
  const [factLabel, setFactLabel] = useState("");
  const [factValue, setFactValue] = useState("");
  const [factCategory, setFactCategory] = useState("policy");
  const [savingFact, setSavingFact] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setSearching(false);
    }
  }

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceName.trim() || !sourcePath.trim()) return;
    setAddingSource(true);
    try {
      const res = await fetch("/api/knowledge/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sourceName.trim(), rootPath: sourcePath.trim() }),
      });
      if (res.ok) {
        setSourceName("");
        setSourcePath("");
        setShowAddSource(false);
        // 局部刷新（服务端重取后 props 变化，overview 会跟随同步）
        router.refresh();
      } else {
        const data = await res.json();
        showBanner(data.error?.message || "添加知识源失败", "error");
      }
    } catch (err) {
      showBanner("添加知识源请求失败", "error");
    } finally {
      setAddingSource(false);
    }
  }

  async function handleSyncSource(sourceId: string) {
    setSyncingId(sourceId);
    setSyncMessage(null);
    try {
      const res = await fetch(`/api/knowledge/sources/${sourceId}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const r = data.result;
        setSyncMessage(`同步完成：扫描 ${r.scanned} 篇，新增 ${r.created}，更新 ${r.updated}，删除 ${r.deleted}，失败 ${r.failed}`);
        setTimeout(() => router.refresh(), 1500);
      } else {
        setSyncMessage(`同步失败：${data.error?.message || "未知错误"}`);
      }
    } catch (err: any) {
      setSyncMessage(`同步异常：${err?.message || err}`);
    } finally {
      setSyncingId(null);
    }
  }

  async function handleConfirmFact(factId: string) {
    try {
      const res = await fetch("/api/knowledge/facts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factId, action: "CONFIRM" }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddFact(e: React.FormEvent) {
    e.preventDefault();
    if (!factKey.trim() || !factLabel.trim() || !factValue.trim()) return;
    setSavingFact(true);
    try {
      const res = await fetch("/api/knowledge/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: factKey.trim(),
          label: factLabel.trim(),
          value: factValue.trim(),
          category: factCategory,
          status: "CONFIRMED", // 直接创建为已确认
        }),
      });
      if (res.ok) {
        setFactKey("");
        setFactLabel("");
        setFactValue("");
        setShowAddFact(false);
        router.refresh();
      }
    } finally {
      setSavingFact(false);
    }
  }

  // Group work items by project
  const byProject = new Map<string, typeof workItems>();
  for (const w of workItems) {
    const list = byProject.get(w.projectId) || [];
    list.push(w);
    byProject.set(w.projectId, list);
  }

  return (
    <div className="hermes-stack">
      <PageHeading
        eyebrow="COMPANY KNOWLEDGE BASE"
        title="公司知识"
        subtitle="集中检索公司制度、业务事实、Obsidian 文档切片与已验收项目成果。"
        actions={
          isAdmin ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowManageSources(true)}>
                管理知识源 ({overview.sources.length})
              </Button>
              <Button size="sm" variant="primary" onClick={() => setShowAddFact(true)}>
                + 录入公司事实
              </Button>
            </div>
          ) : (
            <span className="hermes-note">知识源配置与同步由管理员维护</span>
          )
        }
      />

      {banner && (
        <div
          className={`hermes-banner ${banner.type === "error" ? "is-danger" : "is-ok"}`}
          role={banner.type === "error" ? "alert" : "status"}
          aria-live={banner.type === "error" ? "assertive" : "polite"}
        >
          {banner.text}
        </div>
      )}

      {/* P3 内容性质声明：示例模式下常驻展示，专家审核替换后可经配置关闭 */}
      {contentMode.knowledgeSampleMode && (
        <div className="hermes-banner is-info" role="status">
          {sampleModeBanner}
        </div>
      )}

      {/* 公司概况一句话：先给结论，计数收进明细（分层信息设计 · 公司知识） */}
      <section className="hermes-theme-section" style={{ paddingTop: 4 }}>
        <p className="hermes-theme-conclusion">
          {overview.stats.confirmedFactsCount > 0
            ? `公司知识库现有已确认事实 ${overview.stats.confirmedFactsCount} 条${overview.stats.pendingFactsCount > 0 ? `，另有 ${overview.stats.pendingFactsCount} 条待确认` : ""}，可直接作为顾问回答的依据。`
            : "公司知识库还没有已确认的事实，先录入制度与红线，顾问回答才有依据。"}
        </p>
        <p className="hermes-theme-detail-p">
          {overview.stats.documentCount > 0
            ? `另有索引文档 ${overview.stats.documentCount} 篇，可用下方检索按需查阅原文。`
            : "尚未接入任何知识文档，可先接入本地目录。"}
        </p>
        <details className="hermes-details" style={{ marginTop: 10 }}>
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>
            查看计数明细（文档 {overview.stats.documentCount} · 切片 {overview.stats.chunkCount} · 事实 {overview.stats.confirmedFactsCount} · 知识源 {overview.stats.sourceCount}）
          </summary>
          <div className="hermes-kv" style={{ marginTop: 10, display: "grid" } as React.CSSProperties}>
            <p className="hermes-note">已索引文档 {overview.stats.documentCount} 篇（Markdown 文件）</p>
            <p className="hermes-note">知识切片 {overview.stats.chunkCount} 个（按标题层级切分）</p>
            <p className="hermes-note">
              已确认事实 {overview.stats.confirmedFactsCount} 条
              {overview.stats.pendingFactsCount > 0 ? ` · ${overview.stats.pendingFactsCount} 条待确认` : " · 全部已确认"}
            </p>
            <p className="hermes-note">知识源连接 {overview.stats.sourceCount} 个（本地目录 / Vault 挂载）</p>
          </div>
        </details>
      </section>

      <Tabs
        items={[
          { key: "browse", label: "资料检索与查阅" },
          { key: "facts", label: `业务事实与红线 (${overview.facts.length})` },
          { key: "outcomes", label: `已验收项目成果 (${workItems.length})` },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as KnowledgeTab)}
      />

      {/* 页签 1: 实时知识检索面板 */}
      {activeTab === "browse" && (
        <Panel
          eyebrow="INTELLIGENT RETRIEVAL"
          title="资料与文档检索"
          sub="支持自然语言及中文关键词匹配，检索包含制度政策、渠道规范与产品资料的引用段落。"
        >
          <form onSubmit={handleSearch} className="flex gap-2 mb-4">
            <input
              type="text"
              className="flex-1 bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus:border-teal-500"
              placeholder="输入搜索词，如：核心业务、品牌定位、禁用项、渠道政策..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button type="submit" disabled={searching} variant="primary" size="sm">
              {searching ? "搜索中..." : "检索"}
            </Button>
          </form>

          {searchResults ? (
            <div className="space-y-4 pt-2 border-t border-stone-800">
              {searchResults.facts?.length > 0 && (
                <div>
                  <div className="text-xs font-mono text-teal-400 mb-2">匹配的公司事实:</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {searchResults.facts.map((f: any) => (
                      <div key={f.id} className="p-3 bg-stone-800/40 rounded border border-stone-700/60">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-teal-300">{isAdmin ? `[${f.category}] ` : ""}{f.label}</span>
                          <Badge tone={f.status === "CONFIRMED" ? "ok" : "warn"}>{labelCompanyFactStatus(f.status)}</Badge>
                        </div>
                        <div className="text-sm text-stone-200 mt-1">{f.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.citations?.length > 0 && (
                <div>
                  <div className="text-xs font-mono text-teal-400 mb-2">
                    匹配的知识段落 ({searchResults.citations.length}):
                  </div>
                  <div className="space-y-2">
                    {searchResults.citations.map((c: any) => (
                      <div key={c.ref} className="p-3 bg-stone-800/40 rounded border border-stone-700/60 text-sm">
                        <div className="flex items-center justify-between text-xs text-stone-400 mb-1">
                          <span className="font-mono text-teal-400">{c.headingPath || c.docTitle}</span>
                          <span className="text-stone-500">匹配度: {c.score} · {c.relativePath}</span>
                        </div>
                        <div className="text-stone-300 text-xs leading-relaxed">{c.snippet}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchResults.facts?.length === 0 && searchResults.citations?.length === 0 && (
                <Empty>未找到与「{searchResults.query}」相关的知识切片或公司事实。</Empty>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-stone-400">常见检索分类：</div>
              <div className="flex flex-wrap gap-2">
                {["渠道政策", "成本模型", "品牌规范", "禁用红线", "分销与佣金"].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="hermes-outline-btn hermes-btn-sm"
                    onClick={() => {
                      setSearchQuery(tag);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <p className="hermes-note" style={{ marginTop: 12 }}>
                已索引 {overview.stats.documentCount} 篇文档与 {overview.stats.chunkCount} 个段落切片。在输入框输入关键词即可实时检索。
              </p>
            </div>
          )}
        </Panel>
      )}

      {/* 管理知识源弹窗 */}
      {showManageSources && (
        <Modal
          eyebrow="SOURCES MANAGEMENT"
          title="管理知识源"
          sub="查看挂载的本地 Obsidian 目录与扫描同步状态"
          onClose={() => {
            setShowManageSources(false);
            setShowAddSource(false);
          }}
          wide
        >
          <div className="hermes-stack">
            {syncMessage && (
              <div className="p-3 text-xs font-mono rounded bg-teal-950/60 border border-teal-700/60 text-teal-200">
                {syncMessage}
              </div>
            )}

            <div className="hermes-inline-end">
              <Button size="sm" variant="secondary" onClick={() => setShowAddSource(!showAddSource)}>
                {showAddSource ? "取消添加" : "+ 接入本地 Obsidian 目录"}
              </Button>
            </div>

            {showAddSource && (
              <Panel eyebrow="ADD SOURCE" title="接入本地 Obsidian 目录">
                <form onSubmit={handleAddSource} className="space-y-3">
                  <div>
                    <label className="block text-xs font-mono text-stone-400 mb-1">知识源名称</label>
                    <input
                      type="text"
                      className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100"
                      placeholder="例如：公司 Obsidian 核心库 / 研发参考文档"
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-stone-400 mb-1">目录绝对路径 (只读导入)</label>
                    <input
                      type="text"
                      className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100 font-mono"
                      placeholder="/Users/.../Documents/ObsidianVault"
                      value={sourcePath}
                      onChange={(e) => setSourcePath(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={addingSource} size="sm" variant="primary">
                      {addingSource ? "正在接入..." : "确认接入"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddSource(false)}>
                      取消
                    </Button>
                  </div>
                </form>
              </Panel>
            )}

            <div className="space-y-3">
              {overview.sources.length === 0 ? (
                <Empty>暂未接入任何本地或 Obsidian 知识源。点击上方按钮配置目录。</Empty>
              ) : (
                overview.sources.map((src: any) => (
                  <div key={src.id} className="p-3 rounded border border-stone-800 bg-stone-900/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-100 text-sm">{src.name}</span>
                        <Badge tone="brand">{labelKnowledgeSourceKind(src.kind)}</Badge>
                        <span className="text-xs text-stone-400 font-mono">
                          {src._count?.documents || 0} 篇文档
                        </span>
                      </div>
                      <div className="text-xs font-mono text-stone-500 truncate max-w-xl">{src.rootPath}</div>
                      <div className="text-xs text-stone-500">
                        上次同步：{src.lastSyncAt ? fmtDateTime(src.lastSyncAt) : "从未同步"}
                      </div>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={syncingId === src.id}
                        onClick={() => handleSyncSource(src.id)}
                      >
                        {syncingId === src.id ? "同步中..." : "立即扫描同步"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* 新增事实弹窗/表单 */}
      {showAddFact && (
        <Modal
          eyebrow="NEW FACT"
          title="录入公司事实与业务红线"
          sub="录入经确认的制度、佣金与禁用红线，作为 AI 顾问与研发核算的权威输入"
          onClose={() => setShowAddFact(false)}
        >
          <form onSubmit={handleAddFact} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-stone-400 mb-1">唯一标识 (Key)</label>
                <input
                  type="text"
                  className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100 font-mono"
                  placeholder="channel.douyin.commission_rate"
                  value={factKey}
                  onChange={(e) => setFactKey(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-stone-400 mb-1">类别 (Category)</label>
                <select
                  className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100"
                  value={factCategory}
                  onChange={(e) => setFactCategory(e.target.value)}
                >
                  <option value="policy">政策/制度 (policy)</option>
                  <option value="channel">渠道 (channel)</option>
                  <option value="cost">成本核算 (cost)</option>
                  <option value="forbidden">禁用红线 (forbidden)</option>
                  <option value="brand">品牌规范 (brand)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono text-stone-400 mb-1">事实名称 (Label)</label>
              <input
                type="text"
                className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100"
                placeholder="例如：抖音渠道扣点基准"
                value={factLabel}
                onChange={(e) => setFactLabel(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-stone-400 mb-1">事实内容 (Value)</label>
              <textarea
                className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-2 text-sm text-stone-100"
                rows={3}
                placeholder="例如：自营小店扣点 5%，达人带货统一预留 20% 佣金"
                value={factValue}
                onChange={(e) => setFactValue(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddFact(false)}>
                取消
              </Button>
              <Button type="submit" disabled={savingFact} size="sm" variant="primary">
                {savingFact ? "保存中..." : "保存事实"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 页签 2: 公司事实列表 */}
      {activeTab === "facts" && (
        <Panel
          eyebrow="COMPANY FACTS"
          title="公司业务事实与红线"
          titleSmall={`(${overview.facts.length})`}
          sub="只有经过确认的事实才会作为权威依据注入顾问提示词。"
        >
          {overview.facts.length === 0 ? (
            <Empty>{isAdmin ? "暂无公司事实记录。请点击上方「+ 录入公司事实」录入公司制度与业务红线。" : "暂无公司事实记录。"}</Empty>
          ) : (
            <div className="space-y-2">
              {overview.facts.map((f: any) => (
                <div key={f.id} className="p-3 rounded border border-stone-800/80 bg-stone-900/30 flex items-start justify-between gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <span className="font-mono text-xs text-teal-400">[{f.category}]</span>
                      )}
                      <span className="font-medium text-stone-200">{f.label}</span>
                      <Badge tone={f.status === "CONFIRMED" ? "ok" : "warn"}>{labelCompanyFactStatus(f.status)}</Badge>
                    </div>
                    <div className="text-stone-300 text-xs">{f.value}</div>
                    {isAdmin && (
                      <div className="text-xs text-stone-500 font-mono">key: {f.key}</div>
                    )}
                  </div>
                  {f.status === "PENDING" && isAdmin && (
                    <Button size="sm" variant="secondary" onClick={() => handleConfirmFact(f.id)}>
                      确认事实
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* 页签 3: 已验收工作项成果归档 */}
      {activeTab === "outcomes" && (
        <Panel
          eyebrow="ARCHIVED OUTCOMES"
          title="已验收项目成果归档"
          titleSmall={`(${workItems.length})`}
          sub="在项目作战室验收通过的工作项成果自动沉淀于此，保留基线与版本追溯。"
        >
          {workItems.length === 0 ? (
            <Empty>暂无已验收成果。在项目作战室验收工作项后自动归档于此。</Empty>
          ) : (
            <div className="hermes-list">
              {[...byProject.entries()].map(([pid, items]) => (
                <div key={pid} className="space-y-2">
                  <Link href={`/projects/${items[0].project.id}`} className="hermes-link">
                    {items[0].project.title}
                  </Link>
                  {items.map((w) => (
                    <div key={w.id} className="hermes-row is-flat space-y-1">
                      <div className="hermes-row-title">{w.title}</div>
                      {w.artifacts.length > 0 && (
                        <ul className="space-y-1">
                          {w.artifacts.map((a: any) => (
                            <li key={a.id}>
                              <span className="hermes-mono">[{a.type} v{a.contentVersion}]</span> {a.title}: {a.content.slice(0, 120)}
                            </li>
                          ))}
                        </ul>
                      )}
                      {w.applicabilities.length > 0 && (
                        <div className="hermes-row-meta">
                          沿用确认: {w.applicabilities.map((ap: any) => `基线 r${ap.baselineRevision} 由 ${ap.confirmedBy?.name || "负责人"} 确认`).join(" · ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
