"use client";

/**
 * 标签页动效（KX-28）。
 *
 * useTabInk：选中态是一块底板，切换时从旧标签滑到新标签。
 *   JS 只量位置、写 CSS 变量（--ink-x / --ink-y / --ink-w / --ink-h），动画交给 CSS 过渡；
 *   第一次定位不播放，之后每次切换、换行、窗口变宽变窄都跟着走。没量到选中项时退回原来的按钮底色。
 *
 * useTabSwap：内容区换内容时
 *   1. 如果内容顶部已经滚到标签栏下面（或标签栏本身滚出了视野），先瞬间把视野拉回标签栏下方，
 *      新内容总是从开头读起，也不会因为新内容更短而让页面跳一下；
 *   2. 高度从旧内容平滑过渡到新内容（collapse.ts 的唯一尺寸动画入口），连续切换从当前高度接着走；
 *   3. 新内容淡入 140ms，只动 opacity。
 *   减少动态效果时只保留第 1 步（它是位置稳定，不是动画）。
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { morphHeightFrom, scrollParent } from "./collapse";
import { MOTION, play } from "./motion";

export function useTabInk<T extends HTMLElement>(ref: RefObject<T | null>, active: string): void {
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    let frame = 0;
    const place = () => {
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (!tab || !tab.offsetWidth) {
        delete list.dataset.ink;
        return;
      }
      list.style.setProperty("--ink-x", `${tab.offsetLeft}px`);
      list.style.setProperty("--ink-y", `${tab.offsetTop}px`);
      list.style.setProperty("--ink-w", `${tab.offsetWidth}px`);
      list.style.setProperty("--ink-h", `${tab.offsetHeight}px`);
      if (!list.dataset.ink) {
        // 先无过渡地放到位，下一帧才允许过渡，避免首屏从左上角滑进来。
        list.dataset.ink = "placed";
        frame = requestAnimationFrame(() => {
          if (list.dataset.ink === "placed") list.dataset.ink = "ready";
        });
      }
    };
    place();
    if (typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(place);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, active]);
}

function keepTabsInView(panel: HTMLElement, anchor: HTMLElement | null): void {
  if (!anchor) return;
  const box = scrollParent(panel);
  const viewTop = box ? box.getBoundingClientRect().top : 0;
  const tabs = anchor.getBoundingClientRect();
  let delta = 0;
  if (getComputedStyle(anchor).position === "sticky") {
    // 标签栏吸顶：内容顶部被压到标签栏下面时，把内容顶部放回标签栏下方。
    const top = panel.getBoundingClientRect().top;
    if (top < tabs.bottom - 1) delta = top - tabs.bottom - 8;
  } else {
    // 普通标签栏：它被滚出视野（含吸顶顶栏的遮挡，由 CSS scroll-margin-top 给出）时拉回来。
    const limit = viewTop + (parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0);
    if (tabs.top < limit) delta = tabs.top - limit;
  }
  if (Math.abs(delta) < 1) return;
  (box ?? window).scrollBy({ top: delta, behavior: "instant" as ScrollBehavior });
}

export function useTabSwap<T extends HTMLElement>(ref: RefObject<T | null>, key: string, anchor?: RefObject<HTMLElement | null>): void {
  const lastHeight = useRef<number | null>(null);
  const lastKey = useRef(key);

  // 持续记下内容区的高度（含动画中途的高度），作为下一次切换的起点。
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    lastHeight.current = panel.getBoundingClientRect().height;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      lastHeight.current = panel.getBoundingClientRect().height;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [ref]);

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || lastKey.current === key) return;
    lastKey.current = key;
    const from = lastHeight.current;
    keepTabsInView(panel, anchor?.current ?? null);
    play(panel, [{ opacity: 0 }, { opacity: 1 }], { key: "tab-swap", duration: MOTION.fast });
    if (from !== null) morphHeightFrom(panel, from);
  }, [ref, key, anchor]);
}
