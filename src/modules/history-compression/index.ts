/**
 * C3 上下文压缩：历史装配改为「近期原文 + 远期滚动摘要」。
 *
 * 环境变量：
 * - KERN_HISTORY_KEEP_RECENT_TURNS：近期原文保留轮数（默认 10）
 * - KERN_SUMMARY_MAX_CHARS：摘要块总字符上限，含约束区（默认 2000）
 * - KERN_MISSION_KEEP_RECENT_UPSTREAM：Mission 上游节点原文保留数（默认 5）
 */
import { assembleCompressedHistory } from "./assembly";

export * from "./tokens";
export * from "./constraints";
export * from "./assembly";

function positiveIntEnv(key: string, fallback: number): number {
  const v = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

/** 近期原文保留轮数（默认 10） */
export function historyKeepRecentTurns(): number {
  return positiveIntEnv("KERN_HISTORY_KEEP_RECENT_TURNS", 10);
}

/** 摘要块总字符上限，含约束区（默认 2000） */
export function summaryMaxChars(): number {
  return positiveIntEnv("KERN_SUMMARY_MAX_CHARS", 2000);
}

/** Mission 上游节点原文保留数（默认 5） */
export function missionKeepRecentUpstream(): number {
  return positiveIntEnv("KERN_MISSION_KEEP_RECENT_UPSTREAM", 5);
}

export { assembleCompressedHistory };
