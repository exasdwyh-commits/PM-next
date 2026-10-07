/**
 * 界面动效偏好（KX-27）。
 *
 * 默认「跟随系统」：系统开启了「减少动态效果」（Windows：设置 › 辅助功能 › 视觉效果 › 动画效果 关闭，
 * 或性能选项选了「调整为最佳性能」）时，浏览器会对网页报告 prefers-reduced-motion: reduce，
 * 全站动效随之改为静态反馈。
 * 选「始终播放」后在 <html> 上写 data-motion="full"，CSS 的降动画分支与 reducedMotion() 都会让路。
 */
export type MotionPref = "system" | "full";

export const MOTION_PREF_KEY = "kern-motion";

/** 放在 <head> 里同步执行：首帧之前就带上偏好，避免先静态后动画的闪动。 */
export const MOTION_BOOT_SCRIPT = `try{if(localStorage.getItem("${MOTION_PREF_KEY}")==="full")document.documentElement.dataset.motion="full"}catch(e){}`;

export function readMotionPref(): MotionPref {
  try {
    return window.localStorage.getItem(MOTION_PREF_KEY) === "full" ? "full" : "system";
  } catch {
    return "system";
  }
}

export function writeMotionPref(pref: MotionPref): void {
  try {
    if (pref === "full") window.localStorage.setItem(MOTION_PREF_KEY, "full");
    else window.localStorage.removeItem(MOTION_PREF_KEY);
  } catch {
    // 隐私模式等无法写入时，本次会话内仍然生效
  }
  if (pref === "full") document.documentElement.dataset.motion = "full";
  else delete document.documentElement.dataset.motion;
}
