/**
 * 已标注主张的提取（纯函数，无 IO、无模型）。
 *
 * 依据的是 generic-executor 已经**强制**给节点的输出契约：
 *   「关键依据（标注 事实/推断）」
 *   「区分事实与推断；没有来源的数字或判断必须标注『推断』或『UNKNOWN』，不要编造数据。」
 *
 * 也就是说「哪些是推断、哪些还不知道」本来就写在产出里，只是此前只以正文形式
 * 存在——用户要自己读完整段才能发现。这里把它抽成结构化事实，交给事件流呈现，
 * 让「这是猜测」在时间线上就能看见，而不是藏在段落里。
 *
 * 刻意不做的事：不判断推断是否成立、不打分、不改写。只做提取。
 */

/** 指令性/标题性文字：它们本身含「推断」二字，但不是一条主张。 */
const INSTRUCTION_RE = /标注|区分事实|关键依据|不要编造/;

/** 「推断」可出现在任意位置；「假设」必须在括号内，避免命中表头「| 项目 | 假设 |」。 */
const HYPOTHESIS_RE = /推断|[（(]\s*假设/;
const UNKNOWN_RE = /\bUNKNOWN\b/i;

/** Markdown 表格分隔行 `|---|---|` */
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export interface MarkedClaims {
  /** 明确标注为推断/假设的判断 */
  hypotheses: string[];
  /** 明确标注为 UNKNOWN 的缺口 */
  unknowns: string[];
}

/** 去掉 Markdown 装饰，保留可读文本。 */
function clean(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.、)]\s*/, "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从节点产出里提取已标注的推断与 UNKNOWN。
 *
 * @param limit 每类最多保留几条（事件载荷要有上界，避免长文把事件表撑爆）
 */
export function extractMarkedClaims(text: string, limit = 8): MarkedClaims {
  const hypotheses: string[] = [];
  const unknowns: string[] = [];
  const seen = new Set<string>();

  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (TABLE_DIVIDER_RE.test(raw)) continue;
    if (INSTRUCTION_RE.test(raw)) continue;

    const isUnknown = UNKNOWN_RE.test(raw);
    const isHypothesis = HYPOTHESIS_RE.test(raw);
    if (!isUnknown && !isHypothesis) continue;

    const line = clean(raw);
    if (line.length < 2) continue;
    const item = line.length > 200 ? line.slice(0, 200) + "…" : line;
    const key = (isUnknown ? "u:" : "h:") + item;
    if (seen.has(key)) continue;
    seen.add(key);

    // UNKNOWN 优先：一行同时含两者时，缺口比推断更该被看见。
    const bucket = isUnknown ? unknowns : hypotheses;
    if (bucket.length < limit) bucket.push(item);
  }

  return { hypotheses, unknowns };
}
