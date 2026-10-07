/**
 * KX-74 每周复盘（纯函数）：看过去一段时间的任务指标、记忆使用、做法表现，
 * 提出「章程 / 记忆 / 做法」三类修改建议。这里只算不写——每条建议都要用户
 * 点「采纳」才生效（review-service.ts 负责执行）。
 */

import type { MissionMetrics, PlaybookMetrics } from "@/modules/kern-contracts";
import { AUTOMATION_MIN_ACCEPTED } from "@/modules/kern-contracts";
import { topicOverlap } from "@/modules/memory";

export interface ReviewMissionInput {
  id: string;
  goal: string;
  createdAt: Date;
  metrics: MissionMetrics | null;
  playbookRef: { id: string; name: string } | null;
}

export interface ReviewMemoryInput {
  id: string;
  kind: string;
  content: string;
  pinned: boolean;
  topics: string[];
  useCount: number;
  createdAt: Date;
}

export interface ReviewPlaybookInput {
  id: string;
  name: string;
  metrics: PlaybookMetrics;
}

export type ReviewProposalOp =
  | { op: "memory.remember"; content: string }
  | { op: "memory.pin"; memoryId: string }
  | { op: "memory.forget"; memoryId: string }
  | { op: "playbook.delete"; playbookId: string }
  | { op: "note" };

export interface ReviewProposal {
  id: string;
  /** charter = 章程（置顶偏好）；memory = 记忆整理；playbook = 做法 */
  kind: "charter" | "memory" | "playbook";
  title: string;
  reason: string;
  apply: ReviewProposalOp;
}

export interface WeeklyReview {
  period: { since: string; until: string };
  summary: {
    runs: number;
    completed: number;
    accepted: number;
    avgHumanInterventions: number | null;
    avgReworkRounds: number | null;
    avgTimeToResultMs: number | null;
    modelCalls: number;
  };
  proposals: ReviewProposal[];
}

const STALE_DAYS = 30;
const MAX_FORGET = 5;

function avg(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

export function buildWeeklyReview(input: {
  since: Date;
  until: Date;
  missions: ReviewMissionInput[];
  memories: ReviewMemoryInput[];
  playbooks: ReviewPlaybookInput[];
}): WeeklyReview {
  const ms = input.missions.map((m) => m.metrics).filter((m): m is MissionMetrics => !!m);
  const summary = {
    runs: input.missions.length,
    completed: ms.filter((m) => m.completed).length,
    accepted: ms.filter((m) => m.accepted === true).length,
    avgHumanInterventions: avg(ms.map((m) => m.humanInterventions)),
    avgReworkRounds: avg(ms.map((m) => m.reworkRounds)),
    avgTimeToResultMs: avg(ms.map((m) => m.timeToResultMs).filter((x): x is number => x !== null)),
    modelCalls: ms.reduce((a, m) => a + m.cost.modelCalls, 0),
  };

  const proposals: ReviewProposal[] = [];
  const pinnedText = input.memories.filter((m) => m.pinned).map((m) => m.content);

  // 1) 章程：同一主题被纠正 ≥ 2 次 → 建议升级为长期规则（置顶偏好）
  const corrections = input.memories.filter((m) => m.kind === "CORRECTION" && !m.pinned);
  const used = new Set<string>();
  for (const c of corrections) {
    if (used.has(c.id)) continue;
    const group = corrections.filter((o) => o.id !== c.id && !used.has(o.id) && topicOverlap(c.topics, o.topics) >= 0.34);
    if (group.length === 0) continue;
    const all = [c, ...group];
    for (const g of all) used.add(g.id);
    const notes = all.map((g) => g.content.replace(/^做「[^」]*」这类工作时：/, "").replace(/（针对「[^」]*」）$/, "")).filter(Boolean);
    const content = `做${c.content.match(/^做「[^」]*」/)?.[0].slice(1) ?? "这类工作"}这类工作时：${[...new Set(notes)].join("；")}`.slice(0, 300);
    if (pinnedText.some((t) => t === content)) continue;
    proposals.push({
      id: `charter:${c.id}`,
      kind: "charter",
      title: "把反复出现的纠正写进章程",
      reason: `过去被纠正 ${all.length} 次，主题相近。写成长期规则后每次工作都会先遵守。`,
      apply: { op: "memory.remember", content },
    });
  }

  // 2) 记忆：用到 ≥ 3 次的纠正 → 建议置顶；30 天没用过的结论 → 建议忘掉
  for (const m of corrections.filter((x) => x.useCount >= 3)) {
    if (used.has(m.id)) continue;
    proposals.push({ id: `pin:${m.id}`, kind: "memory", title: "把常用的纠正置顶", reason: `这条纠正已经用了 ${m.useCount} 次。`, apply: { op: "memory.pin", memoryId: m.id } });
  }
  const staleBefore = input.until.getTime() - STALE_DAYS * 86_400_000;
  const stale = input.memories
    .filter((m) => !m.pinned && m.kind !== "PREFERENCE" && m.kind !== "CORRECTION" && m.useCount === 0 && m.createdAt.getTime() < staleBefore)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, MAX_FORGET);
  for (const m of stale) {
    proposals.push({ id: `forget:${m.id}`, kind: "memory", title: "忘掉没再用过的旧结论", reason: `${STALE_DAYS} 天以上没有在任何工作里用到。`, apply: { op: "memory.forget", memoryId: m.id } });
  }

  // 3) 做法：连续验收达标 → 提示可转定时；跑了 ≥ 3 次完成率低于一半 → 建议停用
  for (const p of input.playbooks) {
    if (p.metrics.acceptedStreak >= AUTOMATION_MIN_ACCEPTED) {
      proposals.push({ id: `automate:${p.id}`, kind: "playbook", title: `「${p.name}」可以转成定时任务`, reason: `已连续 ${p.metrics.acceptedStreak} 次验收通过。在最近一次产出页点「定期重跑」即可。`, apply: { op: "note" } });
    } else if (p.metrics.runs >= 3 && p.metrics.completed / p.metrics.runs < 0.5) {
      proposals.push({ id: `retire:${p.id}`, kind: "playbook", title: `停用做法「${p.name}」`, reason: `跑了 ${p.metrics.runs} 次只完成 ${p.metrics.completed} 次。`, apply: { op: "playbook.delete", playbookId: p.id } });
    }
  }

  return { period: { since: input.since.toISOString(), until: input.until.toISOString() }, summary, proposals };
}

/** 给对话 / 简报用的一段话。 */
export function reviewSummaryLine(r: WeeklyReview): string {
  const s = r.summary;
  if (s.runs === 0) return "这段时间没有跑过任务。";
  const bits = [
    `跑了 ${s.runs} 项，完成 ${s.completed} 项，验收通过 ${s.accepted} 项`,
    s.avgHumanInterventions === null ? null : `平均人工介入 ${s.avgHumanInterventions} 次`,
    s.avgReworkRounds === null ? null : `返工 ${s.avgReworkRounds} 轮`,
    `已记录的逻辑模型调用 ${s.modelCalls} 次`,
  ].filter(Boolean);
  return `${bits.join("，")}。${r.proposals.length ? `有 ${r.proposals.length} 条建议等你决定。` : "没有需要你决定的建议。"}`;
}
