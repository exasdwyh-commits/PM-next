/**
 * Capability Resolver：把「这一轮要干什么」翻译成「用哪些能力包、找哪些知识域、
 * 请哪些 Agent、产出什么形态」。
 *
 * 四档优先级（前一档命中就不再往下猜，但候选分数仍然留着给 Inspector 解释）：
 *
 *   1. EXPLICIT   会话运行时配置里点名了能力包（用户显式圈定范围）
 *   2. INTENT     确定性意图语法 / 规划器给出的 intent 声明了它服务哪些能力
 *   3. TRIGGER    文本与能力包 triggers / label / description 的关键词打分
 *   4. NONE       都没命中 → 返回空选择 + 原因，**不编一个出来**
 *
 * 刻意的边界：
 *  - 只「选」不「执行」。执行仍走 Capability Registry（capabilities/registry.ts）
 *    和 supervisor 工具循环，权限与审批不动。
 *  - `modelPreference` 是偏好不是必选；选中能力不会改变模型路由，
 *    模型仍由 `modelRouteForIntent` + Model Gateway 决定（模型无关）。
 *  - 知识域只被**收集**，真正去哪找由 Knowledge Router 决定；
 *    能力包不能在这里绕开 provider 的权限过滤。
 */
import type { CapabilitySkillDefinition } from "@/modules/kern-contracts";
import { capabilityKeyForIntent } from "./catalog";
import { capabilityPackEntries, searchCapabilitiesScored } from "./directory";
import { loadCapabilitySkills } from "./skill-registry";

export type CapabilityResolutionSource =
  | "EXPLICIT"
  | "INTENT"
  | "TRIGGER"
  | "NONE";

export interface CapabilityCandidate {
  id: string;
  /** 综合分 = 关键词分 + intent 命中 + priority 权重。 */
  score: number;
  /** 命中解释：哪一条让它的分高。 */
  matchedOn: string[];
}

export interface CapabilityResolution {
  /** 沿用对话引擎的 intent（KernCapabilityIntent 字符串）。 */
  intent: string;
  /** 该 intent 对应的**原生** capability key（catalog 里的 7 项之一），没有则 null。 */
  nativeCapabilityKey: string | null;
  source: CapabilityResolutionSource;
  /** 给人看的解释，也进 Inspector。 */
  reason: string;
  /** 选中的能力包定义（按 score 排序）。 */
  skills: CapabilitySkillDefinition[];
  /** 全部候选与分数（含未选中的），用于解释与调参。 */
  candidates: CapabilityCandidate[];
  agents: string[];
  knowledgeScopes: string[];
  requiredTools: string[];
  forbiddenTools: string[];
  outputTypes: string[];
  modelPreference: string | null;
  /** 选中能力的证据要求并集；多个能力意见不同时用 `；` 连接，交给 Evidence Policy 层裁决。 */
  evidencePolicy: string | null;
}

const INTENT_BOOST = 60;
const PRIORITY_WEIGHT = 2;
/**
 * 关键词最低有效分：单靠一个字面擦边就进候选，会被高 priority 的能力包
 * （priority×2 是常数项）顶进来，出现「评估产品方案却选中法规评审」这种噪音。
 * 达不到这条线的只有 intent 明确声明了才放行。
 */
const MIN_KEYWORD_SCORE = 2;
const DEFAULT_KNOWLEDGE_SCOPES = ["project", "company-facts"];

function union(lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const v of list) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export interface ResolveCapabilitiesInput {
  text: string;
  intent: string;
  /** 会话运行时圈定的能力包 id（`<域>.<名称>`）；null 表示不设限。 */
  explicitSkillIds?: string[] | null;
  limit?: number;
  /** 测试注入；不传则从磁盘加载。 */
  skills?: CapabilitySkillDefinition[];
}

export function resolveCapabilities(input: ResolveCapabilitiesInput): CapabilityResolution {
  const limit = Math.max(1, input.limit ?? 3);
  const all = input.skills ?? loadCapabilitySkills().skills;
  const nativeCapabilityKey = capabilityKeyForIntent(input.intent);

  const empty = (source: CapabilityResolutionSource, reason: string): CapabilityResolution => ({
    intent: input.intent,
    nativeCapabilityKey,
    source,
    reason,
    skills: [],
    candidates: [],
    agents: [],
    knowledgeScopes:
      input.intent === "KNOWLEDGE_SEARCH" ? [...DEFAULT_KNOWLEDGE_SCOPES] : [],
    requiredTools: [],
    forbiddenTools: [],
    outputTypes: [],
    modelPreference: null,
    evidencePolicy: null,
  });

  if (all.length === 0) {
    return empty("NONE", "还没有可用的能力包（capabilities/**/SKILL.md 为空或全部加载失败）");
  }

  // ---- 打分：关键词 + intent 声明 + priority ----
  const entries = capabilityPackEntries(all);
  const byId = new Map(all.map((s) => [s.id, s]));
  const keywordScore = new Map<string, { score: number; matchedOn: string[] }>();
  for (const hit of searchCapabilitiesScored(entries, input.text, Math.max(all.length, 12))) {
    if (!hit.item.capabilityId) continue;
    keywordScore.set(hit.item.capabilityId, {
      score: hit.score,
      matchedOn: [`关键词 ${hit.score} 分`],
    });
  }

  const scored: { skill: CapabilitySkillDefinition; score: number; matchedOn: string[] }[] = [];
  for (const skill of all) {
    const kw = keywordScore.get(skill.id);
    const kwScore = kw?.score ?? 0;
    const hasIntent = skill.intents.includes(input.intent);
    if (!hasIntent && kwScore < MIN_KEYWORD_SCORE) continue;

    const matchedOn = kw ? [...kw.matchedOn] : [];
    let score = kwScore;
    if (hasIntent) {
      score += INTENT_BOOST;
      matchedOn.push(`intent ${input.intent}`);
    }
    if (score <= 0) continue;
    score += skill.priority * PRIORITY_WEIGHT;
    if (skill.priority) matchedOn.push(`priority ${skill.priority}`);
    scored.push({ skill, score, matchedOn });
  }
  scored.sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  // ---- 选人 ----
  const picked: typeof scored = [];
  const seen = new Set<string>();
  const push = (row: (typeof scored)[number]) => {
    if (seen.has(row.skill.id)) return;
    seen.add(row.skill.id);
    picked.push(row);
  };

  let source: CapabilityResolutionSource;
  let reason: string;

  const explicit = (input.explicitSkillIds ?? []).filter((id) => byId.has(id));
  if (explicit.length) {
    for (const id of explicit) {
      const row = scored.find((r) => r.skill.id === id);
      push(row ?? { skill: byId.get(id)!, score: 0, matchedOn: ["会话显式圈定"] });
    }
    source = "EXPLICIT";
    reason = `会话运行时配置点名了 ${explicit.length} 个能力包：${explicit.join("、")}`;
  } else if (scored.some((r) => r.skill.intents.includes(input.intent))) {
    for (const row of scored.slice(0, limit)) push(row);
    source = "INTENT";
    reason = `意图 ${input.intent} 由能力包声明服务，选中 ${picked.length} 个`;
  } else if (scored.length) {
    for (const row of scored.slice(0, limit)) push(row);
    source = "TRIGGER";
    reason = `按文本关键词打分选中 ${picked.length} 个能力包`;
  } else {
    return empty(
      "NONE",
      nativeCapabilityKey
        ? `没有能力包匹配本轮文本；原生能力 ${nativeCapabilityKey} 仍可用`
        : "没有能力包匹配本轮文本，也没有原生能力兜底"
    );
  }

  const skills = picked.map((p) => p.skill);
  const knowledgeScopes = union(skills.map((s) => s.knowledgeScopes));
  if (input.intent === "KNOWLEDGE_SEARCH") {
    for (const s of DEFAULT_KNOWLEDGE_SCOPES) {
      if (!knowledgeScopes.includes(s)) knowledgeScopes.push(s);
    }
  }

  const evidencePolicies = union(skills.map((s) => (s.evidencePolicy ? [s.evidencePolicy] : [])));

  return {
    intent: input.intent,
    nativeCapabilityKey,
    source,
    reason,
    skills,
    candidates: scored.map((s) => ({
      id: s.skill.id,
      score: s.score,
      matchedOn: s.matchedOn,
    })),
    agents: union(skills.map((s) => s.preferredAgents)),
    knowledgeScopes,
    requiredTools: union(skills.map((s) => s.requiredTools)),
    forbiddenTools: union(skills.map((s) => s.forbiddenTools)),
    outputTypes: union(skills.map((s) => s.outputTypes)),
    modelPreference: skills.find((s) => s.modelPreference)?.modelPreference ?? null,
    evidencePolicy: evidencePolicies.length ? evidencePolicies.join("；") : null,
  };
}
