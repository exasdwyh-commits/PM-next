/**
 * 任务契约（KX-72）：一项工作开跑前先说清「要什么结果、拿什么、交什么、多久一次、
 * 怎样算完成、有什么约束、哪些事要先问人」；跑完后按条复核，不合格的按条打回。
 *
 * 只有类型；生成 / 检查 / 复核逻辑在 supervisor/contract.ts。
 */

export const TASK_CONTRACT_VERSION = "kern-task-contract/v1";

/** 完成标准一条。auto 由系统检查；human 由用户复核。 */
export interface AcceptanceCriterion {
  id: string;
  text: string;
  check: "auto" | "human";
  status: "PENDING" | "PASS" | "FAIL";
  /** 自动检查的证据，或用户打回时写的意见。 */
  note: string | null;
}

export interface ContractReview {
  at: string;
  byUserId: string;
  /** 打回的条目 id（空数组 = 全部通过）。 */
  rejected: string[];
  /** 第几轮复核（从 1 起）。 */
  round: number;
}

export interface TaskContract {
  version: typeof TASK_CONTRACT_VERSION;
  /** 要的结果（一句话）。 */
  expectedResult: string;
  /** 已有输入：用户回答、补充信息、套用的做法。 */
  inputs: string[];
  /** 产出：结论要有哪些部分、可导出的文件。 */
  deliverables: string[];
  frequency: { kind: "once" | "recurring"; cron: string | null };
  acceptance: AcceptanceCriterion[];
  constraints: string[];
  /** 需要先问人的事（受保护动作标签）。 */
  approvalGates: string[];
  /** 会用到的能力（KX-71 能力目录条目：label）。 */
  capabilities: string[];
  reviews: ContractReview[];
}
