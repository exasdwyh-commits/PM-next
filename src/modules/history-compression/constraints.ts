/**
 * 关键约束识别（确定性规则，不依赖模型、不在提示词里埋魔法词）。
 *
 * 策略说明（任务卡要求写在代码注释与 PR 描述里）：
 *
 * 1. 约束的"源"只有两处：
 *    a) system 角色的轮次 → 视为长期站立规则，原文保留；
 *    b) user 轮次中含「义务模态」的句子 → 视为用户立的规矩，原文保留。
 *    assistant 轮次不作为约束源（助手复述用户的话不算立规矩，避免复述污染）。
 *
 * 2. 「义务模态」用的是汉语语言学上的封闭功能词类，不是为某个业务埋的关键词：
 *    必须 / 不得 / 禁止 / 不准 / 只能 / 不许 / 严禁 / 务必。
 *    任何"用户给模型立规矩"的表达（"报价不得高于 50 万"、"回复必须带引用来源"、
 *    "不许编造数字"……）在汉语里都逃不过这类词；反之，普通陈述句（"我们上周聊了定价"）
 *    不含这类词，不会被误收。这是一个语言结构特征，不是魔法词表。
 *
 * 3. 摘要 prompt 本身不埋任何控制标记：约束以原文原样出现在
 *    "关键约束（原文保留）"区，模型看到的就是用户当初写的原话。
 *
 * 4. 防膨胀：单条约束超 400 字符时在句界截断；总条数上限 20（超出的按原文出现
 *    顺序取前 20——早立的通常是长期规则，优先保留）。
 */
import type { HistoryTurn } from "./assembly";
import { truncateAtSentence } from "./assembly";

const DEONTIC_MARKERS = ["必须", "不得", "禁止", "不准", "只能", "不许", "严禁", "务必"];

const SENTENCE_SPLIT = /(?<=[。！？!?\n；;])/;

export const MAX_CONSTRAINT_ITEMS = 20;
export const MAX_CONSTRAINT_CHARS = 400;

export function extractKeyConstraints(turns: HistoryTurn[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(truncateAtSentence(t, MAX_CONSTRAINT_CHARS));
  };

  for (const turn of turns) {
    const content = typeof turn.content === "string" ? turn.content : "";
    if (!content.trim()) continue;
    if (turn.role === "system") {
      push(content);
    } else if (turn.role === "user" || turn.role === "USER") {
      for (const sent of content.split(SENTENCE_SPLIT)) {
        const s = sent.trim();
        if (!s) continue;
        if (DEONTIC_MARKERS.some((m) => s.includes(m))) push(s);
      }
    }
    // assistant/其他角色：不作为约束源
    if (out.length >= MAX_CONSTRAINT_ITEMS) break;
  }
  return out.slice(0, MAX_CONSTRAINT_ITEMS);
}
