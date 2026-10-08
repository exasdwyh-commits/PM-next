"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { KERN_ORCHESTRATOR_PROMPT, KERN_EXPERT_DISPATCH_PROMPTS, KERN_HTML_SPEC_INTEGRATION } from "@/modules/kern-prompts/kern-orchestrator-prompt";
import { HTML_RICH_SPEC_PROMPT } from "@/modules/kern-prompts/html-spec-prompt";
import { COST_BOM_EXPERT_PROMPT } from "@/modules/kern-prompts/experts/cost-bom-expert";
import { COMPLIANCE_EXPERT_PROMPT } from "@/modules/kern-prompts/experts/compliance-expert";
import { SUPPLIER_EXPERT_PROMPT } from "@/modules/kern-prompts/experts/supplier-expert";
import { MARKETING_EXPERT_PROMPT } from "@/modules/kern-prompts/experts/marketing-expert";
import "./kern-prompt-library.css";

export function KernPromptLibrary() {
  const { role } = useRole();
  const [selectedPrompt, setSelectedPrompt] = React.useState<string>("orchestrator");
  const [searchQuery, setSearchQuery] = React.useState("");

  const prompts: Record<string, { title: string; icon: string; content: string; category: string }> = {
    orchestrator: { title: "Kern主Agent调度", icon: "🎯", content: KERN_ORCHESTRATOR_PROMPT, category: "主调度" },
    html_spec: { title: "HTML富可视化规范", icon: "🎨", content: HTML_RICH_SPEC_PROMPT, category: "规范" },
    cost_bom: { title: "Cost & BOM专家", icon: "💰", content: COST_BOM_EXPERT_PROMPT, category: "专家" },
    compliance: { title: "Compliance合规专家", icon: "📋", content: COMPLIANCE_EXPERT_PROMPT, category: "专家" },
    supplier: { title: "Supplier供应商专家", icon: "🏭", content: SUPPLIER_EXPERT_PROMPT, category: "专家" },
    marketing: { title: "Marketing销售专家", icon: "💼", content: MARKETING_EXPERT_PROMPT, category: "专家" },
    integration: { title: "Kern+HTML集成", icon: "🔗", content: KERN_HTML_SPEC_INTEGRATION, category: "集成" },
  };

  const filteredPrompts = Object.entries(prompts).filter(([key, p]) => {
    if (!searchQuery) return true;
    return p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.content.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const currentPrompt = prompts[selectedPrompt];

  if (role === "leadership") {
    return (
      <div className="kern-prompt-library leadership">
        <h4>🎯 Kern提示词库 · {Object.keys(prompts).length}个专家 · 专业调度</h4>
        <div className="prompt-kpi">
          <span>主调度1个</span>
          <span>规范1个</span>
          <span>专家4个</span>
          <span>集成1个</span>
        </div>
        <div className="prompt-cards">
          {Object.entries(prompts).slice(0, 3).map(([key, p]) => (
            <div key={key} className="p-card"><strong>{p.icon} {p.title}</strong><small>{p.category}</small></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="kern-prompt-library" data-role={role}>
      <div className="prompt-header">
        <div>
          <h4>🎯 Kern专业调度提示词库 · 富可视化HTML规范</h4>
          <small>{Object.keys(prompts).length}个提示词 · 主调度+规范+4专家+集成 · 强制富可视化15组件+8动效 · 通过harness R1-R17 · 防止单薄MD</small>
        </div>
        <div className="prompt-search">
          <input placeholder="搜索提示词..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
      </div>

      <div className="prompt-layout">
        <div className="prompt-sidebar">
          {filteredPrompts.map(([key, p]) => (
            <button key={key} className={selectedPrompt === key ? "active" : ""} onClick={() => setSelectedPrompt(key)}>
              <span className="icon">{p.icon}</span>
              <div>
                <strong>{p.title}</strong>
                <small>{p.category}</small>
              </div>
            </button>
          ))}
        </div>

        <div className="prompt-content">
          {currentPrompt && (
            <>
              <div className="content-header">
                <div>
                  <h5>{currentPrompt.icon} {currentPrompt.title}</h5>
                  <small>{currentPrompt.category} · {currentPrompt.content.length}字符 · 富可视化强制</small>
                </div>
                <div className="content-actions">
                  <button onClick={() => navigator.clipboard.writeText(currentPrompt.content)}>📋 复制</button>
                  <button onClick={() => {
                    const blob = new Blob([currentPrompt.content], { type: "text/markdown;charset=utf-8;" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${currentPrompt.title}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>📥 下载</button>
                </div>
              </div>
              <div className="content-body">
                <pre><code>{currentPrompt.content}</code></pre>
              </div>
              <div className="content-footer">
                <small>💡 此提示词强制专家输出富可视化HTML Artifact，15组件+8动效，4类专用，角色自适应，通过harness R1-R17，禁止单薄MD文字回答</small>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="prompt-stats">
        <div className="stat"><strong>7个</strong><small>提示词</small></div>
        <div className="stat"><strong>15个</strong><small>可视化组件</small></div>
        <div className="stat"><strong>8种</strong><small>动效</small></div>
        <div className="stat"><strong>4类</strong><small>专用</small></div>
        <div className="stat"><strong>3档</strong><small>角色</small></div>
        <div className="stat"><strong>R1-R17</strong><small>校验</small></div>
      </div>

      {role === "sales" && (
        <div className="prompt-sales">
          <strong>💼 销售视角：提示词库优势</strong>
          <p>专业调度提示词库确保Kern主Agent能够调动4个专家Agent，每个专家都强制输出富可视化HTML Artifact，而非单薄MD文字，15组件+8动效，4类专用，角色自适应，通过harness校验，最终呈现Claude风格超越版。</p>
        </div>
      )}
    </div>
  );
}
