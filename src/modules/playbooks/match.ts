import type { MissionPlan } from "@/modules/kern-contracts";

/**
 * KX-36 · 做法（playbook）的匹配与模板化。纯函数，客户端安全。
 *
 * 匹配不调用模型：中文按相邻字二元组，英文和数字按词，用 Dice 系数比较新目标与做法的
 * 「名称 + 来源目标」。宁可漏配也不错配：错配的代价（套错计划）远大于漏配（回到默认计划）。
 */

export const GOAL_TOKEN = "{{goal}}";
export const MATCH_THRESHOLD = 0.3;

const STOP = new Set(["我想", "想开", "想做", "一个", "个新", "新的", "的产", "帮我", "我们", "可以", "一下", "看看", "这个", "那个", "做一", "开发"]);

export function goalTokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const w of lower.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bi = run.slice(i, i + 2);
      if (!STOP.has(bi)) out.add(bi);
    }
  }
  return out;
}

export function goalSimilarity(a: string, b: string): number {
  const A = goalTokens(a);
  const B = goalTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export type PlaybookCandidate = { id: string; name: string; matchText: string; useCount: number; successCount: number; failureCount: number };

/** 选最相近的做法；分数相同看成功率，再看用过的次数。 */
export function pickPlaybook<T extends PlaybookCandidate>(goal: string, candidates: T[], threshold = MATCH_THRESHOLD): { playbook: T; score: number } | null {
  let best: { playbook: T; score: number; rate: number } | null = null;
  for (const c of candidates) {
    const score = goalSimilarity(goal, c.matchText);
    if (score < threshold) continue;
    const runs = c.successCount + c.failureCount;
    const rate = runs ? c.successCount / runs : 0.5;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && (rate > best.rate || (rate === best.rate && c.useCount > best.playbook.useCount)))) {
      best = { playbook: c, score, rate };
    }
  }
  return best ? { playbook: best.playbook, score: Math.round(best.score * 100) / 100 } : null;
}

/** 来源目标的主体（去掉澄清后追加的「已确认的约束」）。 */
export function goalCore(goal: string): string {
  return goal.split(/\n\s*\n已确认的约束/)[0].trim();
}

const replaceAll = (s: string, from: string, to: string) => (from ? s.split(from).join(to) : s);

/** 把一次成功的计划变成模板：目标本身换成占位符，节点目标里引用到原目标的地方也换掉。 */
export function templatizePlan(plan: MissionPlan): MissionPlan {
  const core = goalCore(plan.goal);
  return {
    ...plan,
    goal: GOAL_TOKEN,
    successCriteria: plan.successCriteria.map((c) => replaceAll(c, core, GOAL_TOKEN)),
    nodes: plan.nodes.map((n) => ({ ...n, objective: replaceAll(n.objective, core, GOAL_TOKEN) })),
  };
}

/** 用新目标实例化模板（goal 可以带「已确认的约束」）。 */
export function instantiatePlan(template: MissionPlan, goal: string): MissionPlan {
  const core = goalCore(goal);
  return {
    ...template,
    goal,
    successCriteria: template.successCriteria.map((c) => replaceAll(c, GOAL_TOKEN, core)),
    nodes: template.nodes.map((n) => ({ ...n, objective: replaceAll(n.objective, GOAL_TOKEN, core) })),
  };
}
