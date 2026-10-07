/**
 * 尺寸过渡（KX-27）：展开 / 收起时平滑改变高度。
 *
 * 动效契约规定尺寸动画只允许出现在明确登记的位置，这里就是唯一入口：
 * - 只动 height（配合 overflow: hidden），时长按位移在 220ms～360ms 之间，短内容更快；
 * - 连续点击时从当前的中间高度接着走，不跳、不闪；
 * - 收起前若触发按钮已滚出可视区，先把它拉回视野，阅读位置不丢；
 * - 减少动态效果时不播放，直接切换，最终状态与动画结束时完全相同。
 */
import { MOTION, reducedMotion } from "./motion";

const running = new WeakMap<HTMLElement, Animation>();

export function morphDuration(distance: number): number {
  return Math.round(Math.min(360, Math.max(MOTION.base, distance * 0.6)));
}

function canAnimate(el: HTMLElement): boolean {
  return typeof el.animate === "function" && !reducedMotion();
}

function stop(el: HTMLElement): void {
  running.get(el)?.cancel();
  running.delete(el);
}

function animateHeight(el: HTMLElement, from: number, to: number, done?: () => void): Animation | null {
  stop(el);
  if (Math.abs(from - to) < 1 || !canAnimate(el)) {
    done?.();
    return null;
  }
  const animation = el.animate(
    [
      { height: `${from}px`, overflow: "hidden" },
      { height: `${to}px`, overflow: "hidden" },
    ],
    { duration: morphDuration(Math.abs(to - from)), easing: MOTION.easeOut }
  );
  running.set(el, animation);
  animation.onfinish = () => {
    if (running.get(el) === animation) running.delete(el);
    done?.();
  };
  return animation;
}

/** 最近的纵向滚动容器；返回 null 表示页面本身（window）在滚。 */
export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/** 收起前调用：锚点（通常是「收起」按钮或标题）若在可视区上方，瞬间把它放回顶部。 */
export function keepInView(anchor: HTMLElement): void {
  const box = scrollParent(anchor);
  const top = box ? box.getBoundingClientRect().top : 0;
  const delta = anchor.getBoundingClientRect().top - top;
  if (delta >= 0) return;
  if (box) box.scrollTo({ top: box.scrollTop + delta - 8, behavior: "instant" as ScrollBehavior });
  else window.scrollTo({ top: window.scrollY + delta - 8, behavior: "instant" as ScrollBehavior });
}

/**
 * 内容已由 React 换成新状态后调用：从记录的旧高度过渡到新的自然高度。
 * 先停掉进行中的同类动画再量，保证量到的是自然高度。
 */
export function morphHeightFrom(el: HTMLElement, from: number, anchor?: HTMLElement | null): Animation | null {
  stop(el);
  const to = el.getBoundingClientRect().height;
  if (to < from && anchor) keepInView(anchor);
  return animateHeight(el, from, to);
}

/** 当前（可能处于动画中途的）高度：用于下一次切换的起点。 */
export function currentHeight(el: HTMLElement): number {
  return el.getBoundingClientRect().height;
}

/**
 * <details> 的 <summary> 点击处理：用高度过渡代替瞬间开合。
 * 不支持动画或减少动态效果时什么也不做，交给浏览器原生开合（键盘、读屏行为不变）。
 * 收起过程中 details 仍是 open，带 data-closing，供箭头等样式提前转回。
 */
export function toggleDetails(event: { preventDefault(): void; currentTarget: Element }): void {
  const summary = event.currentTarget as HTMLElement;
  const details = summary.parentElement as HTMLDetailsElement | null;
  if (!details || details.tagName !== "DETAILS" || !canAnimate(details)) return;
  event.preventDefault();
  const opening = !details.open || details.dataset.closing === "true";
  const from = currentHeight(details);
  stop(details);
  delete details.dataset.closing;
  if (opening) {
    details.open = true;
    animateHeight(details, from, currentHeight(details));
    return;
  }
  keepInView(summary);
  details.open = false;
  const to = currentHeight(details);
  details.open = true;
  details.dataset.closing = "true";
  animateHeight(details, from, to, () => {
    delete details.dataset.closing;
    details.open = false;
  });
}
