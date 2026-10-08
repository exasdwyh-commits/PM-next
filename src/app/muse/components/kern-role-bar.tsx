"use client";

import { useRole } from "@/components/role-context";
import "@/components/role-switch.css";

export function KernRoleBar() {
  const { role, source, reason, confidence, setManualRole } = useRole();

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 12px",
      background: "#f6f7f9",
      borderRadius: 10,
      border: "1px solid #e7e9ef",
      marginBottom: 12,
      flexWrap: "wrap"
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280" }}>当前视角</span>
      <div className="role-switch" style={{ padding: 2 }}>
        <button className={role === "leadership" ? "is-active" : ""} onClick={() => setManualRole("leadership")} title="直观看的懂，一页看懂结论">👔 领导</button>
        <button className={role === "product" ? "is-active" : ""} onClick={() => setManualRole("product")} title="专业严谨，可信度第一">🔬 研发</button>
        <button className={role === "sales" ? "is-active" : ""} onClick={() => setManualRole("sales")} title="卖点突出，销售支撑">💼 销售</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9099a6" }}>
        <span className={`dot ${source}`} style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", background: source === "manual" ? "#0f1116" : source === "kern" ? "#7c3aed" : source === "auto" ? "#2563eb" : "#d1d5db" }} />
        <span>
          {source === "manual" ? "手动锁定" : source === "kern" ? `Kern建议: ${reason}` : source === "auto" ? `自动: ${reason}` : "默认"}
          {confidence > 0 && source !== "manual" && source !== "default" ? ` ${Math.round(confidence * 100)}%` : ""}
        </span>
      </div>
      <span style={{ marginLeft: "auto", fontSize: 10, color: "#9099a6" }}>
        提示：可直接说“切换到销售视角”让Kern调整
      </span>
    </div>
  );
}
