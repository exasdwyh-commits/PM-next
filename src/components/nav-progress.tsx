"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

/**
 * 纯客户端的「顶部导航进度条」。
 *
 * 为什么不用路线级 `loading.tsx`（在 `src/app/loading.tsx` 挂 Suspense 兜底）：
 *   App Router 一旦给某段路由加了 `loading.tsx`，该段就改走**流式渲染**——
 *   响应头 200 会先发出，之后组件里再调 `notFound()` 只能改渲染内容、**改不了状态码**。
 *   本仓库有硬验收要求「页面 notFound → 404、接口 → 403」
 *   （tests/acceptance-product-center.test.ts），且几乎每个受保护页都靠
 *   `redirect("/login")` 做未登录跳转（流式会让 `domcontentloaded` 提前触发、
 *   在 hydrate 之前拿不到 /login）。因此路线级兜底在本项目**不成立**，
 *   改用下面的纯客户端手段：只观感、不碰任何服务端语义。
 *
 * 实现要点：
 *   - 模块级极简 store + `useSyncExternalStore`，没有 Context/provider 层级负担；
 *   - 只有「点击到**不同**路径」时才点亮（点当前页不亮）；
 *   - 路由落地（`usePathname()` 变化）即熄灭；
 *   - 8s 超时兜底，避免导航被取消 / 失败时永久亮着；
 *   - **server snapshot 恒为 `false`**，杜绝 SSR / 水合不一致。
 */

/** —— 模块级 store（同一客户端会话内共享，无需 provider） —— */
let pending = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setPending(next: boolean): void {
  if (pending === next) return;
  pending = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return pending;
}

/** 服务端 / 水合首帧必须返回 false，否则会出现「服务端没条、客户端有条」的错配。 */
function getServerSnapshot(): boolean {
  return false;
}

/** 导航超时兜底时长：超过它仍未落地就熄灭，避免卡死。 */
const NAV_TIMEOUT_MS = 8000;

/**
 * 顶部不确定进度条（indeterminate）。
 *
 * 视觉条为 `aria-hidden`；读屏播报交给下面独立的 `role="status"` 实时区。
 * 降动画（prefers-reduced-motion:reduce）下由 CSS 隐藏动画条、改为一张**静态**提示，
 * 避免「不确定进度条被冻结在中途」被误读成卡死的进度。
 */
export function NavProgress(): React.ReactElement | null {
  const pathname = usePathname();
  const isPending = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // 路由落地（pathname 变化）→ 熄灭。
  React.useEffect(() => {
    setPending(false);
  }, [pathname]);

  // 超时兜底：导航失败 / 被取消时不能永久亮着。
  React.useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(() => setPending(false), NAV_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isPending]);

  if (!isPending) return null;

  return (
    <>
      {/* 动画进度条（视觉）。降动画下由 CSS 隐藏。 */}
      <span className="hermes-nav-progress" aria-hidden="true">
        <i />
      </span>
      {/* 降动画下的静态可见替代（无动画、不冻结）。默认 CSS 隐藏，仅 reduce 时显示。 */}
      <span className="hermes-nav-progress-note" aria-hidden="true">
        正在加载页面…
      </span>
      {/* 读屏可见的播报（仅 pending 时存在）。 */}
      <span role="status" aria-live="polite" className="hermes-sr-only">
        正在加载页面…
      </span>
    </>
  );
}

/**
 * 侧栏导航链接：包装 `next/link`，点击到**不同**路径时点亮进度条。
 * 透传所有原始 props（className / title / aria-current / children 等），
 * 以保持 `AppShell.renderItem` 现有外观与无障碍属性完全不变。
 */
export function NavProgressLink({
  href,
  onClick,
  ...rest
}: React.ComponentProps<typeof Link>): React.ReactElement {
  const pathname = usePathname();

  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    // 以下情形不算「同页内客户端导航」，不点亮：
    //   - 默认已被阻止（下游处理了）
    //   - 带修饰键（新标签/新窗口打开）
    //   - 目标是当前路径（点当前页不亮）
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof href !== "string") return;
    if (href.startsWith("http")) return;
    if (href === pathname) return;
    setPending(true);
  };

  return <Link href={href} {...rest} onClick={handleClick} />;
}
