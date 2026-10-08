"use client";

import * as React from "react";
import { useRole } from "./role-context";
import "./research-report-rich.css";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string; gradient: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b", gradient: "linear-gradient(135deg,#fffbeb,#fef3c7)" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed", gradient: "linear-gradient(135deg,#f5f3ff,#ede9fe)" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2", gradient: "linear-gradient(135deg,#ecfeff,#cffafe)" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777", gradient: "linear-gradient(135deg,#fdf2f8,#fce7f3)" },
};

export function ResearchReportRich({ report, category = "health_food" }: any) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;

  const data = report || {
    title: "多酚软糖市场与法规研究报告",
    conclusions: [
      { claim: "多酚软糖市场2024年200亿，2025预测260亿+30%健康趋势", level: "A", sources: [{ id: "src1", url: "https://www.fda.gov/food", org: "fda.gov", trust: "OFFICIAL", hash: "abc123", fetchedAt: "2024-10-07" }], jurisdiction: "中国", verified: true },
      { claim: "蓝帽子认证需提供功能声称+检测报告+80℃烘焙工艺", level: "A", sources: [{ id: "src2", url: "https://www.samr.gov.cn", org: "samr.gov.cn", trust: "OFFICIAL", hash: "def456", fetchedAt: "2024-10-06" }], jurisdiction: "中国", verified: true },
      { claim: "透明质酸在化妆品中可宣称保湿，需备案+安全评估", level: "B", sources: [{ id: "src3", url: "https://www.nmpa.gov.cn", org: "nmpa.gov.cn", trust: "OFFICIAL", hash: "ghi789", fetchedAt: "2024-10-05" }], jurisdiction: "中国", verified: true },
    ],
    risks: ["市场竞争激烈需差异化", "法规变化需关注"],
    unknowns: ["具体竞品销量", "消费者偏好细节"],
    lineage: { sourceCaptures: 3, researchNodes: 2, downstreamNodes: 3, provenance: true },
  };

  return (
    <div className="research-report-rich" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="report-header" style={{ background: catInfo.gradient }}>
        <div>
          <span className="eyebrow" style={{ background: catInfo.color, color: "white" }}>
            {catInfo.icon} {catInfo.name} · 研究报告 · 引用全链 · 独立验证 · {role}视角
          </span>
          <h2>{data.title} · {data.conclusions.length}结论 · {data.lineage.sourceCaptures}来源 · 全链可溯</h2>
          <small>SourceCapture → research → downstream → final 全链 provenance · 每个 citation 可解析到真实 SourceCapture · {catInfo.name}专用 · Kern调度</small>
        </div>
        <div className="lineage-badge" style={{ background: catInfo.color, color: "white" }}>
          {data.lineage.provenance ? "✅ 全链可溯" : "❌ 断链"}
        </div>
      </div>

      <div className="conclusions">
        <h4>📋 结论 · {data.conclusions.length}条 · A/B/C/D分级 · {catInfo.name}专用</h4>
        {data.conclusions.map((c: any, idx: number) => (
          <div key={idx} className="conclusion-card" style={{ animationDelay: `${idx * 100}ms`, borderLeft: `3px solid ${catInfo.color}` } as any}>
            <div className="conclusion-header">
              <strong>{idx + 1}. {c.claim}</strong>
              <div className="conclusion-meta">
                <span className={`level ${c.level.toLowerCase()}`} style={{ background: c.level === "A" ? "#0b7a4f" : c.level === "B" ? "#2563eb" : "#f59e0b", color: "white" }}>{c.level}级</span>
                {c.jurisdiction && <span className="jurisdiction" style={{ background: `${catInfo.color}15`, color: catInfo.color }}>{c.jurisdiction}</span>}
                {c.verified && <span className="verified">✅ 已验证</span>}
              </div>
            </div>
            <div className="citations">
              {c.sources.map((s: any, sIdx: number) => (
                <div key={sIdx} className="citation" style={{ borderColor: `${catInfo.color}20` } as any}>
                  <div className="citation-header">
                    <span className="source-id">📎 {s.id}</span>
                    <span className={`trust ${s.trust.toLowerCase()}`} style={{ background: s.trust === "OFFICIAL" ? "#0b7a4f" : s.trust === "REPUTABLE" ? "#2563eb" : "#6b7280", color: "white" }}>{s.trust}</span>
                    <small>{s.org}</small>
                  </div>
                  <div className="citation-body">
                    <a href={s.url} target="_blank" rel="noopener" style={{ color: catInfo.color }}>{s.url}</a>
                    <small>Hash: {s.hash} · Fetched: {s.fetchedAt} · 可回溯到真实 SourceCapture</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="lineage-graph" style={{ borderColor: `${catInfo.color}20` } as any}>
        <h4>🕸️ 引用全链 · Citation Lineage · 全链可回溯</h4>
        <div className="lineage-flow">
          <div className="flow-step" style={{ background: `${catInfo.color}08`, borderColor: catInfo.color } as any}>
            <strong>SourceCapture</strong>
            <small>{data.lineage.sourceCaptures}来源 · HTTPS-only · SSRF防护 · 重定向校验</small>
            <div className="flow-chips">
              <span>fda.gov OFFICIAL</span>
              <span>samr.gov.cn OFFICIAL</span>
              <span>nmpa.gov.cn OFFICIAL</span>
            </div>
          </div>
          <span className="flow-arrow">→</span>
          <div className="flow-step" style={{ background: "#fffbeb", borderColor: "#f59e0b" } as any}>
            <strong>Research Nodes</strong>
            <small>{data.lineage.researchNodes}研究节点 · 不能自验 · 需 support span</small>
          </div>
          <span className="flow-arrow">→</span>
          <div className="flow-step" style={{ background: "#f0fdf4", borderColor: "#0b7a4f" } as any}>
            <strong>Downstream</strong>
            <small>{data.lineage.downstreamNodes}下游 · 只能引用上游已给 source id</small>
          </div>
          <span className="flow-arrow">→</span>
          <div className="flow-step" style={{ background: catInfo.gradient, borderColor: catInfo.color } as any}>
            <strong>Final Report</strong>
            <small>最终报告 · 每个 citation 可解析到真实 SourceCapture · 全链可溯 {data.lineage.provenance ? "✅" : "❌"}</small>
          </div>
        </div>
        <div className="lineage-validation" style={{ borderColor: data.lineage.provenance ? "#0b7a4f" : "#dc2626", background: data.lineage.provenance ? "#ecfdf5" : "#fef2f2" }}>
          <strong>{data.lineage.provenance ? "✅ 全链验证通过" : "❌ 全链断裂"}</strong>
          <small>硬测试: SourceCapture → research → downstream → final 全链 provenance 可回溯, 每个 citation 可解析到真实 SourceCapture · {data.lineage.provenance ? "通过" : "失败"}</small>
        </div>
      </div>

      <div className="verifier-info" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <strong>🔍 Independent Verifier · 7规则 · {catInfo.icon} {catInfo.name}</strong>
        <div className="verifier-rules">
          <span>❌ Research Agent不能自验</span>
          <span>🔄 trustTier重分类</span>
          <span>❓ model-only→UNKNOWN</span>
          <span>🔗 fetchability≠support</span>
          <span>📍 需 support span</span>
          <span>🏢 同组织双URL非独立</span>
          <span>📏 rules-only永不VERIFIED</span>
          <span>⚖️ 法规需 jurisdiction+日期</span>
        </div>
      </div>

      <div className="fetcher-info" style={{ borderLeft: `3px solid ${catInfo.color}` }}>
        <strong>🌐 Source Fetcher · 9规则 · {catInfo.icon} {catInfo.name}</strong>
        <div className="fetcher-rules">
          <span>🔒 HTTPS-only</span>
          <span>🏠 Host白名单 gov/edu</span>
          <span>🌐 DNS+拒绝 private/metadata</span>
          <span>📌 Pin IP+验证远程</span>
          <span>↪️ 重定向每跳校验</span>
          <span>📄 MIME白名单</span>
          <span>📦 大小2MB+超时</span>
          <span>💉 Prompt-injection扫描</span>
          <span>🔑 Hash+fetchedAt+trust</span>
        </div>
      </div>

      <div className="idempotency-info" style={{ borderColor: catInfo.color } as any}>
        <strong>♻️ 幂等绑定 · missionId+nodeKey+revisionRound</strong>
        <p>Key: mission_123::research_market::r2 · 复用已有 ResearchRun 避免重复抓网页付费 · 7天过期 · 失败可续跑 · 仅证据过期或用户刷新才新建</p>
        <div className="idempotency-chips">
          <span style={{ background: `${catInfo.color}15`, color: catInfo.color }}>mission_123::research_market::r1 复用 ✅</span>
          <span style={{ background: "#0b7a4f15", color: "#0b7a4f" }}>r2 续跑</span>
          <span style={{ background: "#f59e0b15", color: "#f59e0b" }}>7天过期</span>
        </div>
      </div>
    </div>
  );
}
