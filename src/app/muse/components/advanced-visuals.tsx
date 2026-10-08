"use client";
import { useEffect, useId, useRef, useState } from "react";

/** Visual count-up follows a real value; assistive technology always receives the final count. */
export function VisualCount({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / 550);
        element.textContent = String(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); element.textContent = String(value); };
  }, [value]);
  return <><span className="m-sr">{value}</span><span ref={ref} aria-hidden="true">{value}</span></>;
}

/** A count distribution, not a completion or confidence percentage. */
export function WorkDistribution({ needs, active, unavailable }: { needs: number; active: number; unavailable?: boolean }) {
  const id = useId();
  const total = needs + active;
  const share = total ? active / total * 100 : 0;
  return <div className="ka-distribution">
    <svg viewBox="0 0 120 120" role="img" aria-label={unavailable ? `已读取事项：待处理 ${needs}，推进中 ${active}；部分状态待更新` : `已读取事项：待处理 ${needs}，推进中 ${active}`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--m-accent)" /><stop offset="1" stopColor="var(--m-accent-2)" /></linearGradient></defs>
      <circle className="ka-ring-track" cx="60" cy="60" r="45" />
      {total ? <><circle className="ka-ring-needs" cx="60" cy="60" r="45" /><circle className="ka-ring-active" cx="60" cy="60" r="45" pathLength="100" stroke={`url(#${id})`} strokeDasharray={`${share} 100`} transform="rotate(-90 60 60)" /></> : null}
      <text x="60" y="59" className="ka-ring-number">{unavailable ? "—" : total}</text>
      <text x="60" y="78" className="ka-ring-caption">{unavailable ? "状态待更新" : total ? "当前事项" : "暂无事项"}</text>
    </svg>
    <div><h3>当前事项分布</h3><p><i className="ka-dot" />推进中 <b>{active}</b></p><p><i className="ka-dot needs" />待处理 <b>{needs}</b></p><small>当前已读取的工作记录</small></div>
  </div>;
}

type Theme = "system" | "light" | "dark";
export function useMuseAppearance(scope: string) {
  const key = `kern.appearance.v1:${scope}`;
  const [theme, setTheme] = useState<Theme>("system");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    try { const saved = localStorage.getItem(key); if (saved === "light" || saved === "dark" || saved === "system") setTheme(saved); } catch { /* Use system appearance when storage is disabled. */ }
    return () => media.removeEventListener("change", update);
  }, [key]);
  return { theme, resolved: theme === "system" ? systemDark ? "dark" : "light" : theme, select: (next: Theme) => {
    setTheme(next); try { localStorage.setItem(key, next); } catch { /* Session selection still works. */ }
  } };
}
export function AppearanceControl({ theme, onSelect }: { theme: Theme; onSelect: (theme: Theme) => void }) {
  return <div className="ka-appearance" role="group" aria-label="Kern 外观"><span>外观</span><div>{([{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }] as const).map(item => <button type="button" key={item.value} aria-pressed={theme === item.value} onClick={() => onSelect(item.value)}>{item.label}</button>)}</div></div>;
}
