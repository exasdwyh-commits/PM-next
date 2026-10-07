"use client";

/**
 * 列表位置反馈（KX-28）：列表刷新时只动发生变化的项。
 *
 * - 列表第一次出现：前 8 项按 45ms 轻错峰淡入上移，其余和第 8 项同时出现；
 * - 新增的项：淡入上移；
 * - 位置变了的项（置顶后上移、删除后补位、新增后下移）：从旧位置滑到新位置；
 * - 位置没变的项不动。子项自身尺寸变化（展开全文等）会通过 ResizeObserver 刷新基线，
 *   不会在下一次渲染时被误判为「移动」；
 * - 只动 transform / opacity；减少动态效果时什么都不播，列表直接是最终状态。
 *
 * 约定：子元素带 `data-key`；列表本身是定位容器（position: relative），
 * 这样 offsetTop 以列表为基准，不受滚动和进行中的 transform 影响。
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { ENTER, MOTION, play, staggerDelays } from "./motion";

function keyed(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter((el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.key));
}

function snapshot(list: HTMLElement): Map<string, number> {
  return new Map(keyed(list).map((el) => [el.dataset.key as string, el.offsetTop]));
}

export function useListFlip<T extends HTMLElement>(ref: RefObject<T | null>): void {
  const base = useRef<{ list: HTMLElement; tops: Map<string, number> } | null>(null);

  // 每次提交后：对比上一次的位置，只给新增项和移动过的项播放动画，然后记下新基线。
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) {
      base.current = null;
      return;
    }
    const items = keyed(list);
    const prev = base.current?.list === list ? base.current.tops : null;
    if (prev === null) {
      const delays = staggerDelays(items.length);
      items.forEach((el, i) => play(el, ENTER, { key: "list-enter", delay: delays[i] }));
    } else {
      for (const el of items) {
        const before = prev.get(el.dataset.key as string);
        if (before === undefined) {
          play(el, ENTER, { key: "list-enter" });
          continue;
        }
        const dy = before - el.offsetTop;
        if (Math.abs(dy) < 1) continue;
        play(el, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
          key: "list-move",
          duration: MOTION.morph,
          easing: MOTION.easeMorph,
        });
      }
    }
    base.current = { list, tops: snapshot(list) };
  });

  // 子项展开 / 收起改变了列表高度：刷新基线，下一次渲染不把它当成移动。
  useEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (base.current?.list === list) base.current = { list, tops: snapshot(list) };
    });
    observer.observe(list);
    return () => observer.disconnect();
  });
}
