import type { ProductSpecField } from "@/modules/product-development/revision";

export const TASK_VERB =
  /(?:创建任务|建立任务|安排任务|记个待办|生成任务|推进任务|新建任务|创建工作项|生成工作项)/;

export const PRODUCT_RND_START =
  /(?:(?:开始|启动|发起|跑一轮|继续|推进).{0,10}(?:AI\s*)?(?:产品研发|研发评估)|(?:AI\s*)?(?:产品研发|研发评估).{0,10}(?:开始|启动|发起|跑一轮|继续|推进))/i;

export const PRODUCT_RND_STATUS =
  /(?:(?:产品研发|AI\s*研发|研发评估).{0,12}(?:进度|状态|到哪|做到哪|怎么样|如何了|怎样了)|(?:进度|状态|到哪|做到哪|怎么样|如何了|怎样了).{0,12}(?:产品研发|AI\s*研发|研发评估))/i;

export const PRODUCT_RND_REPORT =
  /(?:(?:产品研发|AI\s*研发|研发评估|研发报告).{0,16}(?:报告|结论|风险|UNKNOWN|未知|决策|建议|结果)|(?:报告|结论|风险|UNKNOWN|未知|决策|建议|结果).{0,16}(?:产品研发|AI\s*研发|研发评估|研发报告))/i;

export function parseWorkItemTask(text: string): { title: string } | null {
  const match = TASK_VERB.exec(text);
  if (!match) return null;
  const rawTitle = text
    .slice(match.index + match[0].length)
    .trim()
    .replace(/^[:：\s]+/, "")
    .replace(/^[「"'“”『]+/, "")
    .replace(/[」"'“”』]+$/, "")
    .replace(/[。！!，,；;]+$/, "")
    .trim();
  return rawTitle.length >= 2 ? { title: rawTitle.slice(0, 60) } : null;
}

const FIELD_ALIASES: { pattern: RegExp; field: ProductSpecField }[] = [
  { pattern: /(核心卖点|卖点|主打点|主打)/, field: "coreSellingPoints" },
  { pattern: /(目标人群|目标用户|目标受众|人群|受众)/, field: "targetAudience" },
  { pattern: /(预期渠道|渠道|铺货|上架渠道)/, field: "targetChannels" },
  { pattern: /(价格预期|定价|售价|价格)/, field: "priceExpectation" },
  { pattern: /(剂型|规格|包装形式|净含量)/, field: "formSpec" },
  { pattern: /(禁用项|禁用|不能添加|不添加|不加)/, field: "forbiddenItems" },
  { pattern: /(一句话想法|核心想法|一句话|想法)/, field: "coreIdea" },
];

export const CHANGE_VERB =
  /(?:改为|改成|调整为|修改为|更新为|设为|设置为|变成|换为|换成)/;

export function matchField(text: string): ProductSpecField | null {
  for (const alias of FIELD_ALIASES) {
    if (alias.pattern.test(text)) return alias.field;
  }
  return null;
}

export function parseFieldChange(
  text: string
): { field: ProductSpecField; value: string } | null {
  const verb = CHANGE_VERB.exec(text);
  if (!verb) return null;
  const value = text
    .slice(verb.index + verb[0].length)
    .trim()
    .replace(/^[「"'“”『]+/, "")
    .replace(/[」"'“”』]+$/, "")
    .replace(/[。！!，,；;]+$/, "")
    .trim();
  if (!value) return null;
  const field = matchField(text.slice(0, verb.index)) ?? matchField(text);
  return field ? { field, value } : null;
}

export const NEW_PRODUCT_VERB =
  /(我想做|我要做|想做一款|想做个|想做一个|想开发|做一款新|新建产品|新产品立项|开个新产品|立个产品|产品想法|帮我立项)/;

export const INTAKE_FIELDS = [
  { key: "name", label: "名称", pattern: /(?:产品名称|产品名|名称|名字)/ },
  { key: "coreIdea", label: "一句话想法", pattern: /(?:一句话想法|核心想法|想法|定位)/ },
  {
    key: "targetAudience",
    label: "目标人群与场景",
    pattern: /(?:目标人群与场景|目标人群|目标用户|目标受众|人群|受众|使用场景|场景)/,
  },
  { key: "coreSellingPoints", label: "核心卖点", pattern: /(?:核心卖点|卖点|主打点|主打)/ },
  { key: "targetChannels", label: "预期渠道", pattern: /(?:预期渠道|上架渠道|铺货渠道|渠道|铺货)/ },
] as const;

export type IntakeKey = (typeof INTAKE_FIELDS)[number]["key"];
export type IntakeDraft = Partial<Record<IntakeKey, string>>;

export function parseIntakeLabels(text: string): IntakeDraft {
  const draft: IntakeDraft = {};
  const segments = text.split(/[\n\r；;]+/);
  for (const segment of segments) {
    const line = segment.trim().replace(/^[-•*·]\s*/, "");
    for (const field of INTAKE_FIELDS) {
      const match = new RegExp(
        `^${field.pattern.source}\\s*[:：]\\s*(.+)$`
      ).exec(line);
      if (!match) continue;
      const value = match[1]
        .trim()
        .replace(/^[「"'“”『]+/, "")
        .replace(/[」"'“”』]+$/, "")
        .replace(/[。！!，,]+$/, "")
        .trim();
      if (
        !value ||
        /^(待定|未定|暂无|不知道|没想好|tbd|todo|\?+|？+)$/i.test(value)
      ) {
        continue;
      }
      draft[field.key] = value.slice(0, 200);
      break;
    }
  }
  return draft;
}

const META_REQUEST =
  /(帮我梳理|帮我想|怎么做|如何做|该怎么|要注意|需要什么|有什么流程|是什么意思|告诉我)/;

export function freeFormIdea(text: string): string | null {
  if (!NEW_PRODUCT_VERB.test(text)) return null;
  const trimmed = text.trim().replace(/[。！!]+$/, "");
  const remainder = trimmed
    .replace(NEW_PRODUCT_VERB, "")
    .replace(/^[，,、:：\s]+/, "");
  if (remainder.length < 6 || META_REQUEST.test(trimmed)) return null;
  return trimmed.slice(0, 200);
}

export function accumulateIntakeDraft(userTexts: string[]): IntakeDraft {
  const draft: IntakeDraft = {};
  for (const text of userTexts) {
    Object.assign(draft, parseIntakeLabels(text));
    if (!draft.coreIdea) {
      const idea = freeFormIdea(text);
      if (idea) draft.coreIdea = idea;
    }
  }
  return draft;
}

export function missingIntakeFields(draft: IntakeDraft) {
  return INTAKE_FIELDS.filter((field) => !draft[field.key]);
}
