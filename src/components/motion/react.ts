"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { morphHeightFrom } from "./collapse";
import { ENTER, play } from "./motion";

/** 挂载时淡入上移一次；降动画时直接显示。 */
export function useReveal<T extends HTMLElement>(ref: RefObject<T | null>, delay = 0): void {
  useEffect(() => {
    play(ref.current, ENTER, { key: "reveal", delay });
  }, [ref, delay]);
}

export type BtnState = "idle" | "busy" | "done" | "error";

/**
 * 包住一次异步操作：busy → done / error → 自动回到 idle。
 * 用法：const [state, run] = useBtnState(); <Btn state={state} onClick={() => run(save)}>保存</Btn>
 */
export function useBtnState(opts: { doneMs?: number; errorMs?: number } = {}): [BtnState, <R>(task: () => Promise<R>) => Promise<R | undefined>] {
  const [state, setState] = useState<BtnState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const settle = useCallback((next: BtnState, ms: number) => {
    if (!alive.current) return;
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => alive.current && setState("idle"), ms);
  }, []);
  const run = useCallback(
    async <R,>(task: () => Promise<R>): Promise<R | undefined> => {
      if (timer.current) clearTimeout(timer.current);
      setState("busy");
      try {
        const result = await task();
        settle("done", opts.doneMs ?? 1600);
        return result;
      } catch (error) {
        settle("error", opts.errorMs ?? 2400);
        throw error;
      }
    },
    [settle, opts.doneMs, opts.errorMs]
  );
  return [state, run];
}

/**
 * 只在「首次挂载且 enabled」时淡入上移一次（KX-27）。
 * 列表刷新、key 不变的重渲染都不会重播；减少动态效果时直接显示。
 */
export function useEnterOnce<T extends HTMLElement>(ref: RefObject<T | null>, enabled: boolean): void {
  const enabledAtMount = useRef(enabled);
  useEffect(() => {
    if (enabledAtMount.current) play(ref.current, ENTER, { key: "reveal" });
  }, [ref]);
}

/**
 * 内容切换时的高度过渡（KX-27）：在 setState 之前调用返回的 capture()，
 * 渲染完成后自动从旧高度过渡到新高度；收起时若 anchor 已滚出视野会先拉回。
 */
export function useHeightMorph<T extends HTMLElement>(
  ref: RefObject<T | null>,
  anchor?: RefObject<HTMLElement | null>
): () => void {
  const from = useRef<number | null>(null);
  useLayoutEffect(() => {
    const start = from.current;
    from.current = null;
    if (start !== null && ref.current) morphHeightFrom(ref.current, start, anchor?.current);
  });
  return useCallback(() => {
    if (ref.current) from.current = ref.current.getBoundingClientRect().height;
  }, [ref]);
}

/**
 * 退出动画（KX-27）：requestClose 先播放 exit() 返回的动画，全部结束后才调用 onClose 卸载。
 * - 退出进行中再次关闭会被忽略，不会重复触发 onClose；
 * - 组件被外部直接卸载时不再回调，避免误关后打开的新面板；
 * - exit() 没有返回任何动画（减少动态效果 / 不支持 WAAPI）时立即关闭。
 */
export function useExitAnimation(
  onClose: () => void,
  exit: () => Array<Animation | null>
): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ onClose, exit });
  useEffect(() => {
    latest.current = { onClose, exit };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    const animations = latest.current.exit().filter((a): a is Animation => a !== null);
    if (animations.length === 0) {
      latest.current.onClose();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    void Promise.all(animations.map((a) => a.finished.catch(() => undefined))).then(() => {
      if (alive.current) latest.current.onClose();
    });
  }, []);
  return { closing, requestClose };
}
