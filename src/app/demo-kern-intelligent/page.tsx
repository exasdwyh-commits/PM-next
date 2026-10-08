"use client";

import { useState } from "react";
import { RoleProvider, useRole } from "@/components/role-context";
import { KernRoleBar } from "@/app/muse/components/kern-role-bar";
import ResponseRoleBased from "@/app/muse/response/response-role-based";
import type { ResponseEnvelope } from "@/modules/response-format/types";
import { detectRoleSwitchIntent, inferRoleFromText, KERN_NEEDS } from "@/components/kern-role-intelligence";

const mockEnvelopes: { label: string; question: string; envelope: ResponseEnvelope }[] = [
  {
    label: "领导层问题",
    question: "现在项目怎么样了，一句话总结",
    envelope: {
      v: 1,
      kind: "ANSWER",
      demo: true,
      lede: "项目进度65%，证据可信率82%，可推进",
      confidence: "HIGH",
      blocks: [
        { type: "prose", body: ["项目已完成6条核心证据核实，成本可控，风险主要是供应链单一。"] },
        { type: "keypoints", items: [{ kind: "fact", text: "多酚留存率82%，已通过实验室验证" }] },
      ],
      meta: { model: "kern-demo", elapsedMs: 1200, steps: 2, quota: null, memoriesUsed: [], sources: 3, suggestedRole: "leadership", roleReason: "用户问进度总结", roleConfidence: 0.9 },
    } as any,
  },
  {
    label: "产品研发问题",
    question: "这个多酚留存率的证据可信度怎么样？",
    envelope: {
      v: 1,
      kind: "ANSWER",
      demo: true,
      lede: "留存率82%，A级可信，已通过实验室验证",
      confidence: "HIGH",
      blocks: [
        { type: "table", cols: [{ label: "指标" }, { label: "值" }, { label: "等级" }], rows: [{ cells: ["留存率", "82%", "A级"], pick: true }] },
        { type: "evidence", items: [{ n: 1, title: "实验室报告", trust: "trusted", fetchedAt: "2026-10-08", url: "#" }] },
      ],
      meta: { model: "kern-demo", elapsedMs: 2300, steps: 3, quota: null, memoriesUsed: [], sources: 5, suggestedRole: "product", roleReason: "用户问证据可信度", roleConfidence: 0.95 },
    } as any,
  },
  {
    label: "销售营销问题",
    question: "这个卖点怎么向客户介绍？",
    envelope: {
      v: 1,
      kind: "ANSWER",
      demo: true,
      lede: "低糖多酚，健康趋势，成本优势明显",
      confidence: "MEDIUM",
      blocks: [
        { type: "keypoints", items: [{ kind: "fact", text: "多酚留存率82%，健康趋势" }, { kind: "fact", text: "成本10.2元，竞品299元" }] },
        { type: "chart", label: "市场增长", unit: "%", series: [{ label: "健康食品", value: 23, hi: true }], source: "市场报告" },
      ],
      meta: { model: "kern-demo", elapsedMs: 1800, steps: 2, quota: null, memoriesUsed: [], sources: 2, suggestedRole: "sales", roleReason: "用户问卖点话术", roleConfidence: 0.92 },
    } as any,
  },
];

function DemoInner() {
  const [input, setInput] = useState("");
  const [detected, setDetected] = useState<any>(null);
  const { role, source, reason } = useRole();

  const handleDetect = () => {
    const switchIntent = detectRoleSwitchIntent(input);
    const textInf = inferRoleFromText(input);
    setDetected({ switchIntent, textInf });
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", display: "grid", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Kern 智能角色系统演示 · 自动+手动+对话驱动</h1>
      
      <div style={{ padding: 16, background: "#f6f7f9", borderRadius: 12, display: "grid", gap: 12 }}>
        <h3>🎯 三种切换方式</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12 }}>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>1. 自动识别</strong><br/>
            根据关键词、页面、Envelope自动推断<br/>
            例如&quot;卖点&quot;→销售，&quot;证据&quot;→产品，&quot;总结&quot;→领导
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>2. 手动切换</strong><br/>
            点击顶部角色按钮，30分钟内优先<br/>
            localStorage持久化，可恢复自动
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>3. Kern对话驱动</strong><br/>
            说&quot;切换到销售视角&quot;或Kern在meta.suggestedRole建议<br/>
            10分钟内优先，Kern作为主Agent统筹
          </div>
        </div>
      </div>

      <KernRoleBar />

      <div style={{ display: "grid", gap: 12, padding: 16, border: "1px solid #e7e9ef", borderRadius: 12 }}>
        <h3>💬 测试智能识别</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="输入：切换到销售视角 / 这个证据可信度怎么样 / 现在怎么样了" style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #e7e9ef" }} />
          <button onClick={handleDetect} style={{ padding: "8px 16px", background: "#0f1116", color: "white", borderRadius: 8, border: 0 }}>检测角色</button>
        </div>
        {detected && (
          <div style={{ fontSize: 12, background: "#f6f7f9", padding: 12, borderRadius: 8 }}>
            <div>切换指令检测: {detected.switchIntent || "无"}</div>
            <div>文本推断: {detected.textInf ? `${detected.textInf.role} (${Math.round(detected.textInf.confidence*100)}%) - ${detected.textInf.reason}` : "无"}</div>
            <div>当前生效: {role} - {source} - {reason}</div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["切换到销售视角", "这个证据的可信度怎么样", "现在项目怎么样了，一句话总结", "这个卖点怎么向客户介绍", "成本核算一下"].map(t => (
            <button key={t} onClick={() => { setInput(t); setTimeout(() => { const sw = detectRoleSwitchIntent(t); const inf = inferRoleFromText(t); setDetected({ switchIntent: sw, textInf: inf }); }, 100); }} style={{ padding: "4px 8px", fontSize: 11, borderRadius: 99, border: "1px solid #e7e9ef", background: "white" }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: 24 }}>
        {mockEnvelopes.map((item, idx) => (
          <div key={idx} style={{ border: "1px solid #e7e9ef", borderRadius: 12, padding: 16, display: "grid", gap: 12 }}>
            <div>
              <strong>{item.label}</strong> - 用户问：{item.question}
              <br/><small style={{ color: "#6b7280" }}>Kern建议角色: {item.envelope.meta.suggestedRole} - {item.envelope.meta.roleReason}</small>
            </div>
            <ResponseRoleBased envelope={item.envelope} />
          </div>
        ))}
      </div>

      <div style={{ padding: 16, background: "#0f1116", color: "white", borderRadius: 12, display: "grid", gap: 12 }}>
        <h3>🧠 Kern 的深度需求</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 12 }}>
          <div>
            <strong>上下文感知</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{KERN_NEEDS.context.map((c,i) => <li key={i}>{c}</li>)}</ul>
          </div>
          <div>
            <strong>能力调度</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{KERN_NEEDS.capabilities.map((c,i) => <li key={i}>{c}</li>)}</ul>
          </div>
          <div>
            <strong>输出适配</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{KERN_NEEDS.outputAdaptation.map((c,i) => <li key={i}>{c}</li>)}</ul>
          </div>
          <div>
            <strong>统筹协调</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>{KERN_NEEDS.coordination.map((c,i) => <li key={i}>{c}</li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <RoleProvider><DemoInner /></RoleProvider>;
}
