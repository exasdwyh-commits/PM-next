"use client";

import { useState } from "react";
import { RoleProvider, useRole } from "@/components/role-context";
import { RoleTools } from "@/components/role-tools";
import "@/components/role-tools.css";
import "@/components/role-switch.css";

function DemoInner() {
  const { role, source, reason, confidence, setManualRole, rememberPreference, clearMemory, memoryRole } = useRole();
  const [input, setInput] = useState("");

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", display: "grid", gap: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>记忆偏好 + 工具角色化演示</h1>

      <div style={{ padding: 16, background: "#f6f7f9", borderRadius: 12, display: "grid", gap: 12 }}>
        <h3>🧠 记忆偏好 (Kern Memory)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, fontSize: 12 }}>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>自动学习</strong><br/>
            手动切换同一角色2次 → 自动记忆<br/>
            例如：2次切到销售 → 记住偏好销售
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>对话记忆</strong><br/>
            说"记住我喜欢销售视角" → 存入 Kern Memory<br/>
            说"以后默认用领导视角" → 长期偏好
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button onClick={() => rememberPreference("sales", "用户测试记忆销售")} style={{ padding: "6px 12px", background: "#0f1116", color: "white", borderRadius: 8, border: 0, fontSize: 12 }}>🧠 记住偏好：销售</button>
          <button onClick={() => rememberPreference("product", "用户测试记忆产品")} style={{ padding: "6px 12px", background: "#0f1116", color: "white", borderRadius: 8, border: 0, fontSize: 12 }}>🧠 记住偏好：产品</button>
          <button onClick={() => rememberPreference("leadership", "用户测试记忆领导")} style={{ padding: "6px 12px", background: "#0f1116", color: "white", borderRadius: 8, border: 0, fontSize: 12 }}>🧠 记住偏好：领导</button>
          <button onClick={clearMemory} style={{ padding: "6px 12px", background: "white", border: "1px solid #e7e9ef", borderRadius: 8, fontSize: 12 }}>清除记忆</button>
        </div>
        {memoryRole && (
          <div style={{ background: "#e8f6ef", padding: 10, borderRadius: 8, fontSize: 12 }}>
            <strong>当前记忆：</strong>{memoryRole.role} - {memoryRole.reason} ({Math.round(memoryRole.confidence*100)}%)
          </div>
        )}
      </div>

      <div style={{ padding: 16, border: "1px solid #e7e9ef", borderRadius: 12, display: "grid", gap: 12 }}>
        <h3>当前角色：{role} ({source}) - {reason} {confidence > 0 ? `${Math.round(confidence*100)}%` : ""}</h3>
        <div className="role-switch">
          <button className={role === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")}>👔 领导层</button>
          <button className={role === "product" ? "is-active" : ""} onClick={() => setManualRole("product")}>🔬 产品研发</button>
          <button className={role === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")}>💼 销售营销</button>
        </div>
        <small style={{ color: "#6b7280", fontSize: 11 }}>点击切换，2次后自动记忆 · 也可说"记住我喜欢销售视角"</small>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <h3>🛠️ 工具角色化</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 11 }}>
          <div style={{ background: "#f6f7f9", padding: 12, borderRadius: 8, border: "1px dashed #d1d5db" }}>
            <strong>👔 领导层 · 隐藏工具</strong><br/>
            只显示极简操作，专注结论和决策<br/>
            隐藏：成本、合规、证据、QA等专业工具
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>🔬 产品研发 · 全部展开</strong><br/>
            6个专业工具全部展开，显示详情<br/>
            Kern会根据问题自动调用
          </div>
          <div style={{ background: "linear-gradient(135deg, #fff, #f6f7f9)", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
            <strong>💼 销售营销 · 转销售工具箱</strong><br/>
            转为一键生成PPT/话术/竞品/报价<br/>
            成本→利润分析，合规→合规卖点
          </div>
        </div>
        
        <RoleTools />
      </div>

      <div style={{ padding: 16, background: "#0f1116", color: "white", borderRadius: 12, display: "grid", gap: 12 }}>
        <h3>✅ 已实现</h3>
        <ul style={{ fontSize: 12, lineHeight: 1.8, margin: 0, paddingLeft: 16 }}>
          <li>记忆偏好：手动2次自动记忆 + 对话"记住我喜欢XX视角" → 存入Kern Memory (PREFERENCE, pinned)</li>
          <li>记忆召回：每次对话 recallRolePreference，注入到 system prompt，Kern自动按偏好呈现</li>
          <li>工具角色化：领导隐藏，产品全部展开，销售转为销售工具箱，一键生成</li>
          <li>API：POST/GET/DELETE /api/memory/role</li>
          <li>后端：conversation-engine + service 集成记忆</li>
        </ul>
      </div>
    </div>
  );
}

export default function Page() {
  return <RoleProvider><DemoInner /></RoleProvider>;
}
