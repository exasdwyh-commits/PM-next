"use client";

/**
 * 角色上下文（本地补齐）
 * ----------------------
 * Arena 工作区的多个组件（role-tools / overview-role-based / executive-report-role-based
 * / billing-dashboard-rich / cost-* / *-rich）都从本模块取角色，但**该文件未被交付**。
 * 本实现按调用点反推的契约编写，契约如下（已被 11 个调用点固定）：
 *
 *   const { role, source, reason, setManualRole, setAutoInference } = useRole();
 *
 *   role            "leadership" | "product" | "sales"
 *   source          "default"（无任何信号）| "auto"（Kern 自动推断）| "manual"（用户手选）
 *   reason          给用户看的一句话说明，仅在 source === "auto" 时展示
 *   setManualRole   用户手选，优先级最高，覆盖自动推断
 *   setAutoInference 接收 kern-role-intelligence 的推断结果；manual 存在时不生效
 */

import * as React from "react";

export type UserRole = "leadership" | "product" | "sales";

/** 角色来源。UI 依赖这三个字面量做分支，勿改名。 */
export type RoleSource = "default" | "auto" | "manual";

export interface RoleInference {
  role: UserRole;
  /** 推断依据的一句话说明 */
  reason: string;
  /** 0–1，调用方目前未使用，留给后续阈值判断 */
  confidence?: number;
}

export interface RoleContextValue {
  role: UserRole;
  source: RoleSource;
  reason: string;
  /**
   * 自动推断的置信度 0–1。仅 source === "auto" 时有意义，
   * 手选/默认分支恒为 0（UI 用 confidence > 0 决定是否展示百分比）。
   */
  confidence: number;
  setManualRole: (role: UserRole) => void;
  setAutoInference: (inference: RoleInference | null) => void;
  clearManualRole: () => void;
}

export const DEFAULT_ROLE: UserRole = "product";

export const ROLE_LABELS: Record<UserRole, string> = {
  leadership: "领导",
  product: "研发",
  sales: "销售",
};

const STORAGE_KEY = "kern.role.manual";

const RoleContext = React.createContext<RoleContextValue>({
  role: DEFAULT_ROLE,
  source: "default",
  reason: "",
  confidence: 0,
  setManualRole: () => {},
  setAutoInference: () => {},
  clearManualRole: () => {},
});

function isUserRole(value: unknown): value is UserRole {
  return value === "leadership" || value === "product" || value === "sales";
}

export function RoleProvider({
  children,
  initialRole,
}: {
  children: React.ReactNode;
  initialRole?: UserRole;
}) {
  const [manualRole, setManualRole] = React.useState<UserRole | null>(initialRole ?? null);
  const [inference, setInference] = React.useState<RoleInference | null>(null);

  // 手选结果跨刷新保留；SSR 阶段不读 localStorage，避免 hydration 不一致。
  React.useEffect(() => {
    if (initialRole) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (isUserRole(raw)) setManualRole(raw);
    } catch {
      /* 隐私模式下 localStorage 可能不可用，降级为不持久化 */
    }
  }, [initialRole]);

  const setManual = React.useCallback((next: UserRole) => {
    setManualRole(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 同上 */
    }
  }, []);

  const clearManualRole = React.useCallback(() => {
    setManualRole(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 同上 */
    }
  }, []);

  const setAutoInference = React.useCallback((next: RoleInference | null) => {
    setInference(next);
  }, []);

  const value = React.useMemo<RoleContextValue>(() => {
    if (manualRole) {
      return {
        role: manualRole,
        source: "manual",
        reason: `手动切换到${ROLE_LABELS[manualRole]}视角`,
        confidence: 0,
        setManualRole: setManual,
        setAutoInference,
        clearManualRole,
      };
    }
    if (inference) {
      return {
        role: inference.role,
        source: "auto",
        reason: inference.reason,
        confidence: inference.confidence ?? 0,
        setManualRole: setManual,
        setAutoInference,
        clearManualRole,
      };
    }
    return {
      role: DEFAULT_ROLE,
      source: "default",
      reason: "",
      confidence: 0,
      setManualRole: setManual,
      setAutoInference,
      clearManualRole,
    };
  }, [manualRole, inference, setManual, setAutoInference, clearManualRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/**
 * 读取当前角色。
 *
 * 没有 Provider 时**不抛错**：组件树里可能存在未被 Provider 包裹的用法
 * （role-tools.tsx 里就有一个 try/catch 包裹的 `require` 调用），
 * 此时降级为 default 角色，让页面仍可渲染。
 */
export function useRole(): RoleContextValue {
  return React.useContext(RoleContext);
}
