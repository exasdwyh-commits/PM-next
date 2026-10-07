import type { ModelTaskClass } from "@/modules/model-gateway";

/**
 * Kern 任务计划的契约类型（KX-71 从 supervisor/plan.ts 抽出）。
 *
 * 只有类型，没有实现。playbooks（做法）、schedule（定期重跑）、connectors 等下层模块
 * 需要理解「一个计划长什么样」但不应依赖 supervisor 的实现，于是都只依赖本文件。
 * supervisor/plan.ts 仍然 re-export 这些类型，上层代码不用改导入。
 */

export type MissionNodeKind = "SPECIALIST" | "RED_TEAM" | "QA" | "SYNTHESIS";

/** 节点在产出里写「XX判定：禁止」这类判定行，Supervisor 据此做条件跳过。 */
export type MissionSignal = "PROHIBITED" | "CONDITIONAL" | "CLEAR";

export interface MissionNode {
  key: string;
  kind: MissionNodeKind;
  agentCode: string;
  objective: string;
  dependsOn: string[];
  taskClass: ModelTaskClass;
  /** A critical node that ends BLOCKED/FAILED makes the mission need the user. */
  critical: boolean;
  /**
   * KX-54（Astron A5，只做条件，不做循环）：当 `nodeKey` 结束且产出了 `signal` 时跳过本节点。
   * 条件节点视同依赖：它结束前本节点不派发；它重跑时本节点也跟着重置。
   */
  skipWhen?: { nodeKey: string; signal: MissionSignal };
}

export type MissionPlaybook = "GENERIC" | "NEW_PRODUCT";

export interface MissionPlan {
  version: "kern-mission-plan/v1";
  goal: string;
  playbook: MissionPlaybook;
  successCriteria: string[];
  nodes: MissionNode[];
  budget: { maxTasks: number; maxRevisionRounds: number };
  humanGates: string[];
}
