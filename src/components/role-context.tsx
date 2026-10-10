"use client";

import * as React from "react";
import {
  inferRoleFromText,
  inferRoleFromPage,
  inferRoleFromEnvelope,
  detectRoleSwitchIntent,
  resolveEffectiveRole,
  type RoleInference,
} from "./kern-role-intelligence";

export type UserRole = "leadership" | "product" | "sales" | "operator";
export type RoleSource = "manual" | "auto" | "kern" | "memory" | "default";

export const ROLE_LABEL: Record<UserRole, string> = {
  leadership: "👔 领导层",
  product: "🔬 产品研发",
  sales: "💼 销售营销",
  operator: "🧭 操盘手",
};

export const ROLE_DESC: Record<UserRole, string> = {
  leadership: "直观看的懂，一页看懂结论",
  product: "专业严谨，可信度第一，工具流程丰富",
  sales: "卖点突出，工具型，销售支撑",
  operator: "节奏优先，排期卡点一目了然，复盘有据",
};

const STORAGE_KEY = "kern.user-role.v1";
const STORAGE_AT_KEY = "kern.user-role-at.v1";
const STORAGE_KERN_KEY = "kern.kern-role.v1";
const STORAGE_MEMORY_KEY = "kern.memory-role.v1";

interface RoleState {
  role: UserRole;
  source: RoleSource;
  reason: string;
  confidence: number;
  manualRole: { role: UserRole; at: number } | null;
  kernRole: { role: UserRole; at: number; reason: string } | null;
  memoryRole: { role: UserRole; at: number; reason: string; confidence: number } | null;
  autoRoles: RoleInference[];
}

interface RoleContextValue extends RoleState {
  setManualRole: (r: UserRole, reason?: string) => void;
  setKernRole: (r: UserRole, reason?: string) => void;
  setAutoInference: (inference: RoleInference) => void;
  clearManual: () => void;
  clearMemory: () => void;
  detectFromText: (text: string) => UserRole | null;
  rememberPreference: (role: UserRole, reason?: string) => Promise<void>;
}

const RoleContext = React.createContext<RoleContextValue | null>(null);

export function RoleProvider({
  children,
  defaultRole = "leadership",
}: {
  children: React.ReactNode;
  defaultRole?: UserRole;
}) {
  const [manualRole, setManualState] = React.useState<{ role: UserRole; at: number } | null>(null);
  const [kernRole, setKernState] = React.useState<{ role: UserRole; at: number; reason: string } | null>(null);
  const [memoryRole, setMemoryState] = React.useState<{ role: UserRole; at: number; reason: string; confidence: number } | null>(null);
  const [autoRoles, setAutoRoles] = React.useState<RoleInference[]>([]);
  const [pageContext, setPageContext] = React.useState<string>("");

  // Load from localStorage + memory API
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as UserRole | null;
      const savedAt = localStorage.getItem(STORAGE_AT_KEY);
      const savedKern = localStorage.getItem(STORAGE_KERN_KEY);
      const savedMemory = localStorage.getItem(STORAGE_MEMORY_KEY);
      if (saved && ["leadership", "product", "sales", "operator"].includes(saved)) {
        setManualState({ role: saved, at: savedAt ? Number(savedAt) : Date.now() });
      }
      if (savedKern) {
        const parsed = JSON.parse(savedKern);
        if (parsed?.role && ["leadership", "product", "sales", "operator"].includes(parsed.role)) {
          setKernState(parsed);
        }
      }
      if (savedMemory) {
        const parsed = JSON.parse(savedMemory);
        if (parsed?.role && ["leadership", "product", "sales", "operator"].includes(parsed.role)) {
          setMemoryState(parsed);
        }
      }
      setPageContext(window.location.pathname + " " + document.title);

      // Fetch from memory API (Kern's long-term memory)
      fetch("/api/memory/role", { cache: "no-store" })
        .then(r => r.json())
        .then(j => {
          if (j.preference?.role && ["leadership", "product", "sales", "operator"].includes(j.preference.role)) {
            const mem = {
              role: j.preference.role as UserRole,
              at: Date.now(),
              reason: j.preference.content || "Kern记忆中的偏好",
              confidence: j.preference.confidence || 0.8,
            };
            setMemoryState(mem);
            try { localStorage.setItem(STORAGE_MEMORY_KEY, JSON.stringify(mem)); } catch {}
          }
        })
        .catch(() => {});
    } catch {}
  }, []);

  // Page context inference
  React.useEffect(() => {
    if (!pageContext) return;
    const pageInf = inferRoleFromPage(pageContext);
    if (pageInf) {
      setAutoRoles((prev) => {
        const filtered = prev.filter((r) => r.reason !== pageInf.reason);
        return [...filtered, pageInf].slice(-5);
      });
    }
  }, [pageContext]);

  const effective = React.useMemo(() => {
    // Priority: manual (30min) > kern (10min) > memory (long-term) > auto (>0.5) > default
    const now = Date.now();
    const MANUAL_TTL = 30 * 60 * 1000;
    const KERN_TTL = 10 * 60 * 1000;

    if (manualRole && now - manualRole.at < MANUAL_TTL) {
      return { role: manualRole.role, source: "manual" as RoleSource, reason: "用户手动选择", confidence: 1 };
    }
    if (kernRole && now - kernRole.at < KERN_TTL) {
      return { role: kernRole.role, source: "kern" as RoleSource, reason: kernRole.reason, confidence: 0.9 };
    }
    if (memoryRole) {
      return { role: memoryRole.role, source: "memory" as RoleSource, reason: memoryRole.reason, confidence: memoryRole.confidence };
    }
    if (autoRoles.length > 0) {
      const sorted = [...autoRoles].sort((a, b) => b.confidence - a.confidence);
      const top = sorted[0];
      if (top.confidence > 0.5) {
        return { role: top.role, source: top.source, reason: top.reason, confidence: top.confidence };
      }
    }
    return { role: defaultRole, source: "default" as RoleSource, reason: "默认角色", confidence: 0.3 };
  }, [manualRole, kernRole, memoryRole, autoRoles, defaultRole]);

  const rememberPreference = React.useCallback(async (r: UserRole, reason?: string) => {
    try {
      await fetch("/api/memory/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: r, reason }),
      });
      const mem = { role: r, at: Date.now(), reason: reason || "用户偏好", confidence: 0.9 };
      setMemoryState(mem);
      localStorage.setItem(STORAGE_MEMORY_KEY, JSON.stringify(mem));
    } catch {}
  }, []);

  const setManualRole = React.useCallback((r: UserRole, reason?: string) => {
    const at = Date.now();
    setManualState({ role: r, at });
    try {
      localStorage.setItem(STORAGE_KEY, r);
      localStorage.setItem(STORAGE_AT_KEY, String(at));
    } catch {}
    // Auto-remember after 2 manual switches to same role (learning)
    try {
      const countKey = `kern.role-count.${r}`;
      const count = Number(localStorage.getItem(countKey) || "0") + 1;
      localStorage.setItem(countKey, String(count));
      if (count >= 2) {
        rememberPreference(r, reason || `用户多次选择${ROLE_LABEL[r]}`);
      }
    } catch {}
  }, [rememberPreference]);

  const setKernRole = React.useCallback((r: UserRole, reason = "Kern 建议") => {
    const at = Date.now();
    const val = { role: r, at, reason };
    setKernState(val);
    try {
      localStorage.setItem(STORAGE_KERN_KEY, JSON.stringify(val));
    } catch {}
  }, []);

  const setAutoInference = React.useCallback((inf: RoleInference) => {
    setAutoRoles((prev) => {
      const filtered = prev.filter((x) => x.reason !== inf.reason);
      return [...filtered, inf].slice(-6);
    });
  }, []);

  const clearManual = React.useCallback(() => {
    setManualState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_AT_KEY);
    } catch {}
  }, []);

  const clearMemory = React.useCallback(() => {
    setMemoryState(null);
    try {
      localStorage.removeItem(STORAGE_MEMORY_KEY);
      localStorage.removeItem("kern.role-count.leadership");
      localStorage.removeItem("kern.role-count.product");
      localStorage.removeItem("kern.role-count.sales");
      localStorage.removeItem("kern.role-count.operator");
      fetch("/api/memory/role", { method: "DELETE" }).catch(() => {});
    } catch {}
  }, []);

  const detectFromText = React.useCallback((text: string): UserRole | null => {
    // 1. Check for memory intent: "记住我喜欢销售视角"
    const memoryPatterns = [
      { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(领导|老板|直观)/i, role: "leadership" as UserRole },
      { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(产品|研发|技术)/i, role: "product" as UserRole },
      { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(销售|营销|卖点)/i, role: "sales" as UserRole },
      { pattern: /(记住|记一下).{0,10}(我|用户).{0,10}(喜欢|偏好|常用|通常).{0,10}(操盘|运营|排期|甘特|节奏)/i, role: "operator" as UserRole },
      { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(领导|老板|直观)/i, role: "leadership" as UserRole },
      { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(产品|研发|技术)/i, role: "product" as UserRole },
      { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(销售|营销|卖点)/i, role: "sales" as UserRole },
      { pattern: /(以后|今后|默认).{0,10}(用|切|显示).{0,10}(操盘|运营|排期|甘特|节奏)/i, role: "operator" as UserRole },
    ];
    for (const { pattern, role } of memoryPatterns) {
      if (pattern.test(text)) {
        rememberPreference(role, text.slice(0, 50));
        setKernRole(role, `已记住偏好: ${text.slice(0, 30)}`);
        return role;
      }
    }

    // 2. 显式切换指令
    const switchIntent = detectRoleSwitchIntent(text);
    if (switchIntent) {
      setKernRole(switchIntent, `对话指令: ${text.slice(0, 30)}`);
      return switchIntent;
    }
    // 3. 自动推断
    const inf = inferRoleFromText(text);
    if (inf) {
      setAutoInference(inf);
      if (inf.confidence > 0.7) return inf.role;
    }
    return null;
  }, [setKernRole, setAutoInference, rememberPreference]);

  const value: RoleContextValue = {
    role: effective.role,
    source: effective.source,
    reason: effective.reason,
    confidence: effective.confidence,
    manualRole,
    kernRole,
    memoryRole,
    autoRoles,
    setManualRole,
    setKernRole,
    setAutoInference,
    clearManual,
    clearMemory,
    detectFromText,
    rememberPreference,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = React.useContext(RoleContext);
  if (!ctx) {
    return {
      role: "leadership" as UserRole,
      source: "default" as RoleSource,
      reason: "fallback",
      confidence: 0,
      manualRole: null,
      kernRole: null,
      memoryRole: null,
      autoRoles: [],
      setManualRole: () => {},
      setKernRole: () => {},
      setAutoInference: () => {},
      clearManual: () => {},
      clearMemory: () => {},
      detectFromText: () => null,
      rememberPreference: async () => {},
    } as RoleContextValue;
  }
  return ctx;
}

export function RoleSwitcher({ compact = false, showSource = true }: { compact?: boolean; showSource?: boolean }) {
  const { role, source, reason, setManualRole, clearManual, clearMemory, memoryRole } = useRole();
  return (
    <div className="role-switch-wrap">
      <div className={`role-switch ${compact ? "is-compact" : ""}`}>
        {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
          <button
            key={r}
            className={role === r ? "is-active" : ""}
            onClick={() => setManualRole(r)}
            title={ROLE_DESC[r]}
          >
            {compact ? r[0].toUpperCase() : ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      {showSource && source !== "manual" && (
        <div className="role-source-hint">
          <span className={`dot ${source}`} />
          <small>
            {source === "memory" ? `🧠 记忆偏好: ${reason}` : source === "auto" ? `自动识别: ${reason}` : source === "kern" ? `Kern建议: ${reason}` : reason}
          </small>
          {source !== "default" && (
            <button className="role-clear" onClick={clearManual} title="清除手动锁定，恢复自动">
              ×
            </button>
          )}
        </div>
      )}
      {showSource && source === "manual" && (
        <div className="role-source-hint">
          <span className="dot manual" />
          <small>手动锁定 · {memoryRole ? `已记忆${memoryRole.confidence > 0.8 ? " (已学习)" : ""}` : "2次后自动记忆"}</small>
          <button className="role-clear" onClick={clearManual}>恢复自动</button>
          {memoryRole && <button className="role-clear" onClick={clearMemory} title="清除记忆偏好">清除记忆</button>}
        </div>
      )}
      {showSource && source === "memory" && (
        <div className="role-source-hint">
          <span className="dot memory" />
          <small>🧠 记忆偏好 · Kern越用越懂你</small>
          <button className="role-clear" onClick={clearMemory}>清除记忆</button>
          <button className="role-clear" onClick={clearManual}>恢复自动</button>
        </div>
      )}
    </div>
  );
}

// Hook for Kern dialogue to auto-detect and suggest role
export function useKernRoleIntelligence() {
  const { setAutoInference, setKernRole, detectFromText } = useRole();

  const onUserMessage = React.useCallback((text: string) => {
    const switched = detectFromText(text);
    return switched;
  }, [detectFromText]);

  const onEnvelope = React.useCallback((envelope: any) => {
    const inf = inferRoleFromEnvelope(envelope);
    if (inf) {
      setAutoInference(inf);
      if (inf.source === "kern" && inf.confidence > 0.8) {
        setKernRole(inf.role, inf.reason);
      }
      return inf;
    }
    return null;
  }, [setAutoInference, setKernRole]);

  return { onUserMessage, onEnvelope, detectFromText };
}
