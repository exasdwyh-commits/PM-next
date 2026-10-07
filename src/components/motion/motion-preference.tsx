"use client";

import { useEffect, useState } from "react";
import { readMotionPref, writeMotionPref, type MotionPref } from "./preference";

const OPTIONS: Array<{ value: MotionPref; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "full", label: "始终播放" },
];

/** 设置页「界面动效」：说明系统当前状态，并允许在本浏览器里覆盖。 */
export function MotionPreference() {
  const [pref, setPref] = useState<MotionPref>("system");
  const [systemReduce, setSystemReduce] = useState<boolean | null>(null);
  useEffect(() => {
    setPref(readMotionPref());
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setSystemReduce(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const choose = (next: MotionPref) => {
    setPref(next);
    writeMotionPref(next);
  };
  const status = systemReduce === null
    ? "正在读取系统设置…"
    : systemReduce
      ? "系统已开启「减少动态效果」（Windows 的「动画效果」已关闭，或性能选项为「最佳性能」），跟随系统时界面只做静态反馈。"
      : "系统允许动画，界面动效正常播放。";
  return (
    <section className="kx-st-card" aria-labelledby="kx-st-motion">
      <div className="kx-st-card-h">
        <h2 id="kx-st-motion">界面动效</h2>
        <small>只影响本浏览器</small>
      </div>
      <div className="kx-st-card-b">
        <p className="kx-st-l1" role="status">{status}</p>
        <div className="kx-st-motion" role="radiogroup" aria-label="界面动效">
          {OPTIONS.map((option) => (
            <label key={option.value}>
              <input type="radio" name="kern-motion" value={option.value} checked={pref === option.value} onChange={() => choose(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
