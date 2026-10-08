/**
 * Kern 角色智能（本地补齐）
 * ------------------------
 * Arena 工作区未交付本文件，但 overview-role-based.tsx 与 executive-report-role-based.tsx
 * 都用它做「自动判断当前用户该看哪个视角」。契约由调用点固定：
 *
 *   inferRoleFromPage(text) -> RoleInference | null   // 页面标题 + 上下文
 *   inferRoleFromText(text) -> RoleInference | null   // 用户对 Kern 说的话（R17：对话驱动角色切换）
 *
 * 实现策略：纯关键词打分，不做任何模型调用 —— 关键词命中即给分，
 * 最高分超过阈值才返回，避免"随便一句都判成销售"。命中不了返回 null，
 * 由调用方回落到默认视角（默认 product）。
 */

import type { RoleInference, UserRole } from "./role-context";

interface Rule {
  role: UserRole;
  /** 权重越高的词越能决定结论 */
  strong: string[];
  weak: string[];
  reason: string;
}

const RULES: Rule[] = [
  {
    role: "leadership",
    strong: ["领导视角", "决策视角", "管理层", "老板", "总览", "一页看懂", "拍板", "董事会", "汇报给"],
    weak: ["决策", "进度", "风险", "概览", "总览", "overview", "里程碑", "KPI", "看板"],
    reason: "检测到总览/决策类语境，切换为领导视角",
  },
  {
    role: "product",
    strong: ["研发视角", "技术视角", "配方", "工艺", "打样", "中试", "实验室", "质检", "工艺参数"],
    weak: ["证据", "缺口", "字段", "BOM", "标准", "参数", "研究", "文献", "测试"],
    reason: "检测到研发/证据类语境，切换为研发视角",
  },
  {
    role: "sales",
    strong: ["销售视角", "卖点", "话术", "客户视角", "招商", "渠道视角", "spiel"],
    weak: ["客户", "报价", "竞品", "利润", "推广", "带货", "经销商", "零售", "marketing"],
    reason: "检测到销售/客户类语境，切换为销售视角",
  },
];

/** 强命中一次记 3 分，弱命中记 1 分；最高分需 ≥3 且严格高于次高分才判定。 */
const STRONG_SCORE = 3;
const WEAK_SCORE = 1;
const MIN_SCORE = 3;

function score(text: string): RoleInference | null {
  if (!text) return null;
  const haystack = text.toLowerCase();

  let best: RoleInference | null = null;
  let bestScore = 0;
  let runnerUpScore = 0;

  for (const rule of RULES) {
    let current = 0;
    for (const word of rule.strong) if (haystack.includes(word.toLowerCase())) current += STRONG_SCORE;
    for (const word of rule.weak) if (haystack.includes(word.toLowerCase())) current += WEAK_SCORE;

    if (current > bestScore) {
      runnerUpScore = bestScore;
      bestScore = current;
      best = { role: rule.role, reason: rule.reason, confidence: 0 };
    } else if (current > runnerUpScore) {
      runnerUpScore = current;
    }
  }

  if (!best || bestScore < MIN_SCORE || bestScore === runnerUpScore) return null;

  // 置信度：最高分占全部命中得分的比例，仅作参考
  return { ...best, confidence: Math.min(1, bestScore / (bestScore + runnerUpScore || 1)) };
}

/** 从页面标题/路径推断（用于进入项目总览时自动选视角）。 */
export function inferRoleFromPage(text: string): RoleInference | null {
  return score(text);
}

/** 从用户对 Kern 说的话推断（R17：对话驱动角色切换）。 */
export function inferRoleFromText(text: string): RoleInference | null {
  return score(text);
}

/** 供 UI 展示的稳定顺序，避免各组件各写一份。 */
export const ROLE_ORDER: UserRole[] = ["leadership", "product", "sales"];
