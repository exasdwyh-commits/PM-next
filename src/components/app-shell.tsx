import type { ReactNode } from "react";
import Icon from "./icons";
import LogoutButton from "./logout-button";
import { NavProgress, NavProgressLink } from "./nav-progress";

/**
 * 应用壳层：全局侧边导航 + 顶栏。
 *
 * 导航分三层，按「每日必用 → 偶尔用 → 一次性配置」排列：
 *   1. NAV_ITEMS —— 五个工作入口（蓝图 §3），常驻可见；
 *   2. MORE_ITEMS —— 决策追溯 / 项目作战室 / 顾问议事厅 / 数据看板 / 组织与权限，
 *      **默认收起**在「更多」里。它们仍需可达：早前这一组被整体删掉过，
 *      结果是这 5 个页面在界面上完全点不到、只能手敲 URL（其中「组织与权限」
 *      还是成员与角色的入口）。收起 ≠ 删除。
 *   3. SETTINGS_ITEM —— 固定在底部，与上面两组用分隔线隔开。
 *
 * 侧栏底部展示**真实运行状态**，由调用方传入；未接模型时不得显示「AI 在线」（蓝图 §5.1）。
 */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  hint?: string;
}

/** 每日主导航：五个工作入口（蓝图 §3） */
export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "工作总览", href: "/", icon: "grid", hint: "今天待办、待我决策、产品推进、风险阻塞" },
  { key: "products", label: "产品开发", href: "/products", icon: "flask", hint: "产品列表与阶段看板" },
  { key: "advisor", label: "AI 顾问", href: "/advisor", icon: "chat", hint: "公司上下文咨询与任务草案" },
  { key: "workforce", label: "数字员工", href: "/workforce", icon: "users", hint: "Agent、Squad、Skills、任务负载与等待拍板" },
  { key: "opportunities", label: "市场机会", href: "/opportunities", icon: "signal", hint: "有来源的信号与待验证假设" },
  { key: "knowledge", label: "公司知识", href: "/knowledge", icon: "book", hint: "公司概况、文档、决策与复盘" },
];

/** 设置入口（固定在侧栏底部） */
export const SETTINGS_ITEM: NavItem = {
  key: "settings",
  label: "设置",
  href: "/settings",
  icon: "settings",
  hint: "组织权限、知识连接、模型配置与用量审计",
};

/**
 * 「更多」：低频但必须可达的页面。默认收起，不占每日主导航的注意力。
 * 图标尽量与页面语义对应；改动本组后务必同步 ALL_NAV_ITEMS（高亮判定依赖它）。
 */
export const MORE_ITEMS: NavItem[] = [
  { key: "trace", label: "决策追溯", href: "/trace", icon: "search", hint: "决策与留痕的回溯查询" },
  { key: "war-room", label: "项目作战室", href: "/war-room", icon: "target", hint: "项目推进与阻塞协调" },
  { key: "consultation", label: "顾问议事厅", href: "/consultation", icon: "users", hint: "多方评审与意见汇总" },
  { key: "dashboard", label: "数据看板", href: "/dashboard", icon: "chart", hint: "组织级指标看板" },
  { key: "organization", label: "组织与权限", href: "/organization", icon: "shield", hint: "成员、角色与权限范围" },
];

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...MORE_ITEMS, SETTINGS_ITEM];

/** 侧栏底部运行时状态。label 必须反映真实情况，不得固定写「在线」。 */
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
  // 当前页面属于「更多」时自动展开该分组，避免"当前位置不可见"
  const moreActive = MORE_ITEMS.some((it) => it.key === active);
  const status = runtime ?? { tone: "neutral" as const, label: "运行状态未知", detail: "未上报" };

  const renderItem = (it: NavItem, compact: boolean) => {
    const isActive = it.key === active;
    // NavProgressLink 是客户端组件（点击时点亮顶部进度条），此处保持本文件为服务端组件、
    // 仅引用客户端子组件（与 LogoutButton 同一姿势），避免把整棵子树拖成客户端边界。
    // key 是 React 保留属性、不进 props，照常写在元素上即可。
    return (
      <NavProgressLink
        key={it.key}
        href={it.href}
        title={it.hint || it.label}
        // ≤1180 起 `.hermes-nav-item span{display:none}` 会抹掉导航项文字 → 可访问名丢失。
        // 用 aria-label 补回可访问名（与 <span>{it.label}</span> 同值）；title 仅作鼠标 tooltip 补充。
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
          <div className="hermes-monogram">H</div>
          <div className="hermes-wordmark">HERMES</div>
          <div className="hermes-submark">AI PRODUCT OS</div>
        </div>

        <nav className="hermes-nav" aria-label="主导航">
          {NAV_ITEMS.map((it) => renderItem(it, false))}

          {/* 「更多」：低频页面默认收起。当前页面就在这一组时自动展开，
              否则用户看不出自己在哪（收起不等于把当前位置藏起来）。 */}
          <details className="hermes-nav-more" open={moreActive}>
            <summary className="hermes-nav-divider">
              <span>更多</span>
            </summary>
            {MORE_ITEMS.map((it) => renderItem(it, true))}
          </details>

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
            <span>{user?.meta || current?.label || "HERMES"}</span>
          </div>
          <span className="profile-chevron">›</span>
        </div>
      </aside>

      <section className="hermes-content">
        {/* 顶部导航进度条：客户端导航开始即出现、路由落地即消失。fixed 定位，放哪都不影响布局。 */}
        <NavProgress />
        {/* 顶栏：静默企业风 —— 68px 吸顶 + 毛玻璃（样式见 globals.css .hermes-topbar）。 */}
        <div className="hermes-topbar">
          {topbarLeft ?? (
            <div className="hermes-topbar-title">
              <span className="eyebrow">HERMES</span>
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
