import type { ReactNode } from "react";
import Icon from "./icons";
import LogoutButton from "./logout-button";
import { NavProgress, NavProgressLink } from "./nav-progress";

/**
 * PM-next 专业管理后台 shell。
 *
 * Kern 是默认主操作界面；这里服务产品经理、项目负责人和管理员，
 * 以完整性、可追踪、可深入为优先，不再承担日常对话入口。
 */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  hint?: string;
}

/** Kern 与管理后台保持清晰分层：这里只提供返回主操作入口。 */
export const KERN_ITEM: NavItem = {
  key: "kern",
  label: "返回 Kern",
  href: "/muse",
  icon: "chat",
  hint: "回到 Kern 的日常对话、委派、进度沟通与 Check-in",
};

/** 专业管理入口：产品、项目、评估与组织知识。 */
export const NAV_ITEMS: NavItem[] = [
  { key: "manage", label: "管理总览", href: "/manage", icon: "grid", hint: "产品、项目、阻塞、决策与组织运行总览" },
  { key: "products", label: "产品管理", href: "/products", icon: "flask", hint: "覆盖所有产品的方案、版本、评估、研发、打样、生产与上市" },
  { key: "projects", label: "项目管理", href: "/projects", icon: "target", hint: "项目执行、任务、证据、决策包与进度管理" },
  { key: "opportunities", label: "市场机会", href: "/opportunities", icon: "signal", hint: "有来源的市场信号与待验证机会" },
  { key: "knowledge", label: "公司知识", href: "/knowledge", icon: "book", hint: "公司资料、证据、决策与复盘知识" },
];

/** 运维/高级用户入口。仍然可直接进入，但不与业务入口混在一起。 */
export const AUTOMATION_ITEM: NavItem = {
  key: "workforce",
  label: "自动化中心",
  href: "/workforce",
  icon: "nodes",
  hint: "查看数字员工运行、等待人工、失败与自动化因果链",
};

export const SETTINGS_ITEM: NavItem = {
  key: "settings",
  label: "设置",
  href: "/settings",
  icon: "settings",
  hint: "组织权限、知识连接、模型配置与用量审计",
};

/**
 * 兼容旧页面的 route metadata。
 * 这些入口不再渲染到主导航，但保留标题识别，避免旧 URL / 深链接丢失上下文。
 */
export const AUXILIARY_ITEMS: NavItem[] = [
  { key: "overview", label: "旧总览", href: "/manage", icon: "grid" },
  { key: "advisor", label: "旧 AI 助理", href: "/advisor", icon: "chat" },
  { key: "trace", label: "决策追溯", href: "/trace", icon: "search" },
  { key: "war-room", label: "项目决策", href: "/war-room", icon: "target" },
  { key: "consultation", label: "专家会诊", href: "/consultation", icon: "users" },
  { key: "dashboard", label: "数据明细", href: "/dashboard", icon: "chart" },
  { key: "organization", label: "组织与权限", href: "/organization", icon: "shield" },
];

export const ALL_NAV_ITEMS: NavItem[] = [
  KERN_ITEM,
  ...NAV_ITEMS,
  AUTOMATION_ITEM,
  SETTINGS_ITEM,
  ...AUXILIARY_ITEMS,
];

export interface RuntimeStatus {
  tone: "ok" | "warn" | "neutral";
  label: string;
  detail: string;
}

export default function AppShell({
  active,
  user,
  runtime,
  topbarLeft,
  topbarRight,
  children,
}: {
  active: string;
  user?: { name?: string | null; meta?: string | null };
  runtime?: RuntimeStatus;
  topbarLeft?: ReactNode;
  topbarRight?: ReactNode;
  children: ReactNode;
}) {
  const name = user?.name || "未登录";
  const initial = name.slice(0, 1);
  const current = ALL_NAV_ITEMS.find((it) => it.key === active);
  const activeNavKey =
    {
      overview: "manage",
      "war-room": "projects",
      consultation: "products",
      advisor: "manage",
      dashboard: "workforce",
      trace: "workforce",
      organization: "settings",
    }[active] ?? active;
  const status = runtime ?? {
    tone: "neutral" as const,
    label: "运行状态未知",
    detail: "未上报",
  };

  const renderItem = (it: NavItem, compact = false) => {
    const isActive = it.key === activeNavKey;
    return (
      <NavProgressLink
        key={it.key}
        href={it.href}
        title={it.hint || it.label}
        aria-label={it.label}
        aria-current={isActive ? "page" : undefined}
        className={`hermes-nav-item ${isActive ? "is-active" : ""} ${compact ? "is-compact" : ""}`}
      >
        <Icon name={it.icon} size={compact ? 15 : 17} />
        <span>{it.label}</span>
        {isActive && <i />}
      </NavProgressLink>
    );
  };

  return (
    <main className="hermes-shell">
      <aside className="hermes-sidebar">
        <div className="hermes-brand">
          <div className="hermes-monogram">K</div>
          <div className="hermes-wordmark">KERN</div>
          <div className="hermes-submark">DEPARTMENT OS</div>
        </div>

        <nav className="hermes-nav" aria-label="专业管理后台导航">
          <div className="hermes-nav-section" aria-label="主操作">
            <span className="hermes-nav-section-label">主操作</span>
            {renderItem(KERN_ITEM, true)}
          </div>

          <div className="hermes-nav-section" aria-label="专业管理">
            <span className="hermes-nav-section-label">专业管理</span>
            {NAV_ITEMS.map((it) => renderItem(it))}
          </div>

          <div className="hermes-nav-section" aria-label="系统">
            <span className="hermes-nav-section-label">系统</span>
            {renderItem(AUTOMATION_ITEM, true)}
          </div>

          <div className="hermes-nav-footer">{renderItem(SETTINGS_ITEM, true)}</div>
        </nav>

        <div className="hermes-sidebar-bottom">
          <div className={`hermes-status-dot is-${status.tone}`} />
          <div>
            <strong>{status.label}</strong>
            <span>{status.detail}</span>
          </div>
        </div>

        <div className="hermes-profile">
          <div className="hermes-avatar">{initial}</div>
          <div>
            <strong>{name}</strong>
            <span>{user?.meta || current?.label || "KERN"}</span>
          </div>
          <span className="profile-chevron">›</span>
        </div>
      </aside>

      <section className="hermes-content">
        <NavProgress />
        <div className="hermes-topbar">
          {topbarLeft ?? (
            <div className="hermes-topbar-title">
              <span className="eyebrow">KERN</span>
              <strong>{current?.label || "工作台"}</strong>
            </div>
          )}
          <div className="hermes-top-actions">
            {topbarRight}
            <span className="top-divider" />
            <LogoutButton />
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
