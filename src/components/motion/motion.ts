/**
 * 动效原语（KX-11）：Web Animations API，零依赖。
 *
 * 规则与 CSS 令牌同源（docs/mcp-kern-experience-roadmap.md §5，tests/motion-primitives.test.ts 校验一致）：
 * - 只动合成层属性（transform / opacity / filter / clip-path）；
 * - 单次 ≤ 600ms；同一元素同一 key 的新动画会打断旧的，不锁输入；
 * - 用户开启「减少动态效果」时不播放，最终状态由 CSS 决定，信息不丢。
 */

export const MOTION = {
  fast: 140,
  base: 220,
  morph: 560,
  stagger: 45,
  maxStaggered: 8,
  maxDuration: 600,
  easeOut: "cubic-bezier(.22,1,.36,1)",
  easeMorph: "cubic-bezier(.32,.72,0,1)",
  easePress: "cubic-bezier(.3,0,.5,1)",
} as const;

export interface PlayOptions {
  /** 同一元素上同 key 的动画互相打断 */
  key?: string;
  duration?: number;
  easing?: string;
  delay?: number;
  fill?: FillMode;
}

type Animatable = Pick<Element, "animate">;

const running = new WeakMap<Animatable, Map<string, Animation>>();

export function reducedMotion(): boolean {
  // 设置页选了「始终播放」（html[data-motion="full"]）时覆盖系统的减少动态效果
  if (typeof document !== "undefined" && document.documentElement?.dataset.motion === "full") return false;
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export function play(el: Animatable | null | undefined, keyframes: Keyframe[], opts: PlayOptions = {}): Animation | null {
  if (!el || typeof el.animate !== "function" || reducedMotion()) return null;
  const key = opts.key ?? "default";
  const slots = running.get(el) ?? new Map<string, Animation>();
  running.set(el, slots);
  slots.get(key)?.cancel();
  const animation = el.animate(keyframes, {
    duration: Math.min(opts.duration ?? MOTION.base, MOTION.maxDuration),
    easing: opts.easing ?? MOTION.easeOut,
    delay: opts.delay ?? 0,
    fill: opts.fill ?? "none",
  });
  slots.set(key, animation);
  const clear = () => {
    if (slots.get(key) === animation) slots.delete(key);
  };
  animation.addEventListener?.("finish", clear);
  animation.addEventListener?.("cancel", clear);
  return animation;
}

/** 错峰延迟：每个子元素 45ms，最多错开 8 个，其余与第 8 个同时出现。 */
export function staggerDelays(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.min(i, MOTION.maxStaggered - 1) * MOTION.stagger);
}

export function stagger(els: ArrayLike<Animatable>, keyframes: Keyframe[], opts: PlayOptions = {}): Array<Animation | null> {
  const delays = staggerDelays(els.length);
  return Array.from(els, (el, i) => play(el, keyframes, { ...opts, delay: (opts.delay ?? 0) + delays[i] }));
}

/** 内容进入：轻微上移 + 淡入。 */
export const ENTER: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];

/**
 * FLIP 变形：先量、再改、再量，用 transform 从旧位置过渡到新位置。
 * 只动 transform，因此不受「尺寸动画仅限 [data-morph]」的限制。
 */
export function flip(el: HTMLElement | null, mutate: () => void, opts: PlayOptions = {}): Animation | null {
  if (!el) {
    mutate();
    return null;
  }
  const first = el.getBoundingClientRect();
  mutate();
  const last = el.getBoundingClientRect();
  if (!last.width || !last.height) return null;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = first.width / last.width;
  const sy = first.height / last.height;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return null;
  return play(
    el,
    [
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: "top left", transform: "none" },
    ],
    { key: "flip", duration: MOTION.morph, easing: MOTION.easeMorph, ...opts }
  );
}
