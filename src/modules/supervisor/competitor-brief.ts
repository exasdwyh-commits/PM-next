import type { BriefQuestion } from "./brief";

export const COMPETITOR_DEFAULT_SCOPE = "区域以对象官网公开销售市场为准，分市场呈现；公开渠道；价格按来源币种与采集日期记录；优先近 90 天资料，较旧信息标注日期；比较定位、价格带、渠道、差异化，无法确认写未知。";

export function detectCompetitorResearch(goal: string): boolean {
  return /竞品|竞争对手|competitor\s+(research|analysis|comparison)/i.test(goal);
}

/**
 * Did the user explicitly rule competitor research out for this mission?
 *
 * "线下门店，暂不做竞品调研" contains the keyword 竞品 while meaning the exact
 * opposite, so keyword matching alone turns an explicit opt-out into a competitor
 * mission. An explicit decline outranks any keyword hit.
 */
export function competitorResearchDeclined(text: string): boolean {
  return /(暂不|不做|不需要|无需|先不|不再|跳过).{0,8}(竞品|竞争对手).{0,8}(调研|研究|分析|对比|比较)|(竞品|竞争对手).{0,8}(调研|研究|分析|对比|比较).{0,8}(暂不|不做|不需要|无需|先不|跳过)/.test(text);
}

/**
 * Competitor-research intent for a mission.
 *
 * Intent comes from the original request plus what the user explicitly changed —
 * never from the concatenated clarifying answers. A constraint that merely
 * mentions 竞品 ("主要卖给谁：竞品公司的目标用户") must not silently turn a normal
 * product brief into a competitor study, or the launch check will demand a
 * research subject the user never asked for.
 *
 * Clarifying answers may only turn intent *off* (an explicit opt-out) or supply
 * the research subject / links / scope for a mission that already is one.
 */
export function competitorResearchIntent(goal: string, clarification?: string | null): boolean {
  if (competitorResearchDeclined(goal)) return false;
  if (clarification && competitorResearchDeclined(clarification)) return false;
  return detectCompetitorResearch(goal);
}

export function validCompetitorSubject(text: string): boolean {
  return !!text.trim() && !/^(定位|价格带|渠道|差异化|每个判断|未知|待填写|未填写|待补充|对象|待定|UNKNOWN|TBD)/i.test(text.trim());
}

export function competitorSubject(goal: string): string | null {
  if (!detectCompetitorResearch(goal)) return null;
  const explicit = [...goal.matchAll(/(?:(?:调研|研究|比较|对比)对象(?:是)?|要调研哪些品牌或产品)\s*[：:]\s*([^\n]*)/g)].at(-1);
  const candidate = explicit?.[1] ?? /(?:比较|对比)\s+([^\n：:]{2,100})/.exec(goal)?.[1];
  if (!candidate) return null;
  const text = candidate.split(/[。；;]/)[0].replace(/[。；;]+$/, "").trim();
  if (!validCompetitorSubject(text)) return null;
  return text;
}

export function requiredCompetitorQuestions(goal: string): BriefQuestion[] {
  if (!detectCompetitorResearch(goal) || competitorSubject(goal)) return [];
  return [{
    id: "competitor-subject", text: "要调研哪些品牌或产品？", required: true,
    why: "明确对象后才能确定搜索范围和比较依据。可以写品牌名单，或具体品类与目标市场。",
    options: [], remembered: null, answer: null,
  }];
}
