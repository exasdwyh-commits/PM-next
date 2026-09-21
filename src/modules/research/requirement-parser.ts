/**
 * 需求语义与约束精准解析模块 (F13)
 *
 * 核心功能：
 * 1. 否定语义识别与硬隔离：“禁止/不做/不得/免做/排除/严禁/不添加/不宣称”抽取为 forbidden 约束，杜绝反向污染为偏好；
 * 2. 识别提取零售价区间、成本上限、首批批量、上市周期诉求；
 * 3. 动态提炼已知事实 (FACTS)、待验证假设 (HYPOTHESES) 与信息缺口 (GAPS)；
 * 4. 目标人群与渠道特征感知。
 */

export interface ParsedRequirementConstraints {
  minRetailPrice: number | null;
  maxRetailPrice: number | null;
  targetPrice: number | null;
  maxCostLimit: number | null; // 成本上限 (如含包装成本不超过 X 元)
  targetBatchQuantity: number | null; // 首批批量诉求 (如 2000 盒)
  deliveryWeeks: number | null; // 周期诉求 (如 8 周内)
  preferredForms: string[]; // 偏好或指定剂型
  forbiddenForms: string[]; // 明确禁止剂型
  forbiddenClaims: string[]; // 明确禁止宣称
  forbiddenIngredients: string[]; // 明确禁止成分
  targetAudience: string | null;
  targetChannel: string | null;
}

export interface RequirementParseResult {
  facts: string[];
  hypotheses: string[];
  gaps: string[];
  allowed: string[];
  forbidden: string[];
  constraints: ParsedRequirementConstraints;
}

// 辅助：抽取否定前缀子句
function extractNegatedClauses(text: string): string[] {
  const regex = /(?:禁止|不做|不得|不要|免做|排除|严禁(?:出现|使用|采用)?|不添加|不宣称|严禁宣传|严禁包含|不含有?|不能有?|不采用)\s*([^；;。!\n]+)/g;
  const clauses: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) clauses.push(match[1].trim());
  }
  return clauses;
}

export function parseProjectRequirements(rawText: string): RequirementParseResult {
  const text = rawText.trim();
  const facts: string[] = [];
  const hypotheses: string[] = [];
  const gaps: string[] = [];
  const allowed: string[] = [];
  const forbidden: string[] = [];

  // 1. 抽取否定前缀与禁止项
  const negatedClauses = extractNegatedClauses(text);
  const negatedText = negatedClauses.join(" ");

  const candidateForms = ["胶囊", "软糖", "口服液", "条包", "片剂", "粉剂", "压片糖果", "茶包", "速溶茶粉", "干粉", "凝胶糖果"];
  const forbiddenForms: string[] = [];
  for (const form of candidateForms) {
    if (negatedText.includes(form)) {
      forbiddenForms.push(form);
      forbidden.push(`禁止剂型: ${form}`);
    }
  }

  const candidateClaims = ["护肝", "解酒", "醒酒", "抗衰", "抗初老", "减肥", "降糖", "降压", "助眠", "壮阳", "美白"];
  const forbiddenClaims: string[] = [];
  for (const claim of candidateClaims) {
    if (negatedText.includes(claim)) {
      forbiddenClaims.push(claim);
      forbidden.push(`禁止宣称: ${claim}`);
    }
  }

  const candidateIngredients = ["功能性菌株", "益生菌", "西药成分", "人工色素", "防腐剂", "蔗糖", "阿斯巴甜"];
  const forbiddenIngredients: string[] = [];
  for (const ing of candidateIngredients) {
    if (negatedText.includes(ing)) {
      forbiddenIngredients.push(ing);
      forbidden.push(`禁止成分/添加: ${ing}`);
    }
  }

  // 2. 识别偏好与指定剂型
  const preferredForms: string[] = [];
  const allowedMatch = text.match(/(?:仅允许|仅做|只做|指定|限定为?|偏好为?|剂型为?)\s*([^；;。!\n，,]+)/);
  if (allowedMatch && allowedMatch[1]) {
    const rawAllowed = allowedMatch[1];
    for (const form of candidateForms) {
      if (rawAllowed.includes(form) && !forbiddenForms.includes(form)) {
        preferredForms.push(form);
        allowed.push(`指定/偏好剂型: ${form}`);
      }
    }
  }

  // 3. 价格区间识别
  let minRetailPrice: number | null = null;
  let maxRetailPrice: number | null = null;
  let targetPrice: number | null = null;

  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*[-~至到]\s*(\d+(?:\.\d+)?)\s*元/);
  if (rangeMatch) {
    minRetailPrice = parseFloat(rangeMatch[1]);
    maxRetailPrice = parseFloat(rangeMatch[2]);
    facts.push(`用户明确零售价区间: ¥${minRetailPrice} - ¥${maxRetailPrice}`);
  } else {
    const singlePriceMatch = text.match(/(?:零售价|售价|定价|每盒|每瓶|单价).*?(\d+(?:\.\d+)?)\s*元/);
    if (singlePriceMatch) {
      targetPrice = parseFloat(singlePriceMatch[1]);
      facts.push(`用户指定零售价目标: ¥${targetPrice}`);
    }
  }

  // 4. 成本上限识别
  let maxCostLimit: number | null = null;
  const costMatch = text.match(/(?:成本上限|单盒成本|总成本|生产成本).*?(?:不超过|控制在|小于|为)?\s*(\d+(?:\.\d+)?)\s*元/);
  if (costMatch) {
    maxCostLimit = parseFloat(costMatch[1]);
    facts.push(`用户明确成本控制红线: 单品不超过 ¥${maxCostLimit}`);
  }

  // 5. 首批批量与周期识别
  let targetBatchQuantity: number | null = null;
  const batchMatch = text.match(/(?:首单|首批|批量|试产).*?(\d+)\s*(?:盒|瓶|件|袋|份)/);
  if (batchMatch) {
    targetBatchQuantity = parseInt(batchMatch[1], 10);
    facts.push(`用户设定首批试产规模: ${targetBatchQuantity} 单元`);
  }

  let deliveryWeeks: number | null = null;
  const weekMatch = text.match(/(\d+)\s*(?:周|个星期)(?:内|上市|完成)?/);
  if (weekMatch) {
    deliveryWeeks = parseInt(weekMatch[1], 10);
    facts.push(`用户期望交付周期: ${deliveryWeeks} 周以内`);
  }

  // 6. 人群与渠道识别
  let targetAudience: string | null = null;
  if (/银发|老年|中老年|爸妈|长辈/.test(text)) {
    targetAudience = "中老年及银发族";
    facts.push(`目标人群: ${targetAudience}`);
  } else if (/年轻|白领|上班族|女性|学生|精致妈妈/.test(text)) {
    targetAudience = "新锐白领/年轻消费群体";
    facts.push(`目标人群: ${targetAudience}`);
  }

  let targetChannel: string | null = null;
  if (/私域|微信|社群|会销|团购|会所/.test(text)) {
    targetChannel = "私域/社群电商渠道";
    facts.push(`主攻渠道: ${targetChannel}`);
  } else if (/抖音|快手|直播|公域|电商|短视频/.test(text)) {
    targetChannel = "公域短视频/直播电商";
    facts.push(`主攻渠道: ${targetChannel}`);
  }

  // 7. 动态提炼缺口 GAPS
  if (!minRetailPrice && !targetPrice) {
    gaps.push("尚未明确目标零售定价区间，待竞品价格带分析补充");
  }
  if (!maxCostLimit) {
    gaps.push("尚未明确单品目标成本上限，待成本引擎根据渠道扣点反推");
  }
  if (!targetAudience) {
    gaps.push("目标人群画像尚不聚焦，需结合真实消费画像细化");
  }
  if (!targetChannel) {
    gaps.push("主营渠道尚未指定，影响包装形态与达人抽成假设");
  }
  if (preferredForms.length === 0 && forbiddenForms.length === 0) {
    hypotheses.push("未指定剂型偏好，需根据供应链可行性生成多路线比选");
  }

  return {
    facts,
    hypotheses,
    gaps,
    allowed,
    forbidden,
    constraints: {
      minRetailPrice,
      maxRetailPrice,
      targetPrice,
      maxCostLimit,
      targetBatchQuantity,
      deliveryWeeks,
      preferredForms,
      forbiddenForms,
      forbiddenClaims,
      forbiddenIngredients,
      targetAudience,
      targetChannel,
    },
  };
}
