/**
 * 结果指标（KX-73）：每项工作结束后记 5 个数，做法按这 5 个数看趋势；
 * 「连续 3 次验收通过」才允许把做法转成定时任务。
 *
 * 只有类型与常量；计算在 supervisor/metrics.ts。
 */

export const MISSION_METRICS_VERSION = "kern-mission-metrics/v2";

/** 做法要连续验收通过多少次，才允许自动化（转定时）。 */
export const AUTOMATION_MIN_ACCEPTED = 3;

export interface MissionMetrics {
  version: typeof MISSION_METRICS_VERSION | "kern-mission-metrics/v1";
  /** 任务是否 COMPLETED。 */
  completed: boolean;
  /** 契约是否全部通过；没有契约或尚未复核为 null。 */
  accepted: boolean | null;
  /** 人工介入次数：暂停、补充输入、改计划、手动重跑、回答提问、打回。 */
  humanInterventions: number;
  /** 返工轮数：QA 打回 + 手动重跑 + 复核打回。 */
  reworkRounds: number;
  /** 从开跑到有结果的毫秒数；未结束为 null。 */
  timeToResultMs: number | null;
  /** 单次成本：模型调用次数、模型累计耗时、token（拿不到为 null）。 */
  cost: {
    /** Logical business calls; kept for older snapshots. */
    modelCalls: number;
    modelLatencyMs: number;
    tokens: number | null;
    /** Undefined on v1; null means transport provenance is incomplete. */
    logicalCalls?: number | null;
    actualAttempts?: number | null;
    successfulAttempts?: number | null;
    admittedAttempts?: number;
    unknownTransportAttempts?: number;
    knownTokens?: number;
  };
  computedAt: string;
}

/** 做法维度的汇总（窗口 B 看的就是这张表）。 */
export interface PlaybookMetrics {
  runs: number;
  completed: number;
  accepted: number;
  /** 连续验收通过次数（失败或取消清零）。 */
  acceptedStreak: number;
  avgHumanInterventions: number | null;
  avgReworkRounds: number | null;
  avgTimeToResultMs: number | null;
  avgModelCalls: number | null;
}

export interface AutomationEligibility {
  allowed: boolean;
  /** 不允许时的人话原因。 */
  reason: string | null;
  streak: number;
  required: number;
}
