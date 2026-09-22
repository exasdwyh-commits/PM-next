/**
 * 需求语义与约束精准解析模块 (F13)
 *
 * 核心功能：
 * 1. 否定语义识别与硬隔离：“禁止/不做/不得/免做/排除/严禁/不添加/不宣称”抽取为 forbidden 约束，杜绝反向污染为偏好；
 * 2. 识别提取零售价区间、套餐档位、成本上限、首批批量、周期诉求；
 * 3. 动态提炼已知事实 (FACTS)、待验证假设 (HYPOTHESES) 与信息缺口 (GAPS)；
 * 4. 目标年龄、人群、多渠道与主动功效诉求感知。
 */

export interface ParsedPriceOffer {
  price: number;
  quantity: number | null;
  unit: string | null;
  durationMonths: number | null;
}

export interface ParsedRequirementConstraints {
  minRetailPrice: number | null;
  maxRetailPrice: number | null;
  targetPrice: number | null;
  priceOffers: ParsedPriceOffer[];
  maxCostLimit: number | null; // 成本上限 (如含包装成本不超过 X 元)
  targetBatchQuantity: number | null; // 首批批量诉求 (如 2000 盒)
  deliveryWeeks: number | null; // 交付/上市周期诉求 (如 8 周内)
  targetDurationMonths: number | null; // 产品/套餐周期，如半年=6个月
  minAge: number | null;
  maxAge: number | null;
  preferredForms: string[]; // 偏好或指定剂型
  forbiddenForms: string[]; // 明确禁止剂型
  forbiddenClaims: string[]; // 明确禁止宣称
  requestedClaims: string[]; // 用户主动希望表达/验证的功效方向，不代表系统认可
  forbiddenIngredients: string[]; // 明确禁止成分
  targetAudience: string | null;
  targetChannel: string | null; // 兼容旧调用方的摘要字段
  targetChannels: string[]; // 可并存的渠道集合
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

function parseTargetDurationMonths(text: string): number | null {
  if (/半年/.test(text)) return 6;
  const monthMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?月(?:套餐|周期|量|装)?/);
  if (monthMatch) return Math.round(parseFloat(monthMatch[1]));
  const yearMatch = text.match(/(\d+(?:\.\d+)?)\s*年(?:套餐|周期|量|装)?/);
  if (yearMatch) return Math.round(parseFloat(yearMatch[1]) * 12);
  return null;
}

function parsePriceOffers(text: string, durationMonths: number | null): ParsedPriceOffer[] {
  const offers: ParsedPriceOffer[] = [];
  const regex = /(\d+(?:\.\d+)?)\s*元(?:\s*(\d+)\s*(盒|瓶|袋|条|份|件|套))?/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const prefix = text.slice(Math.max(0, match.index - 12), match.index);
    // 成本/运费/佣金等金额不是零售套餐价，避免污染 targetPrice。
    if (/成本|运费|佣金|扣点|利润|原料/.test(prefix)) continue;

    const price = parseFloat(match[1]);
    const quantity = match[2] ? parseInt(match[2], 10) : null;
    const unit = match[3] || null;
    if (!offers.some((o) => o.price === price && o.quantity === quantity && o.unit === unit)) {
      offers.push({ price, quantity, unit, durationMonths });
    }
  }

  return offers;
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

  const candidateClaims = [
    "护肝",
    "解酒",
    "醒酒",
    "抗衰",
    "抗初老",
    "减龄",
    "逆龄",
    "生物年龄",
    "甲基化年龄",
    "减肥",
    "降糖",
    "降压",
    "助眠",
    "壮阳",
    "美白",
    "免疫",
  ];
  const forbiddenClaims: string[] = [];
  const requestedClaims: string[] = [];
  for (const claim of candidateClaims) {
    if (negatedText.includes(claim)) {
      forbiddenClaims.push(claim);
      forbidden.push(`禁止宣称: ${claim}`);
    } else if (text.includes(claim)) {
      requestedClaims.push(claim);
    }
  }
  if (requestedClaims.length > 0) {
    facts.push(`用户提出待验证功效方向: ${requestedClaims.join("、")}（仅记录诉求，不代表证据成立）`);
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

  // 3. 周期与价格识别
  const targetDurationMonths = parseTargetDurationMonths(text);
  if (targetDurationMonths !== null) {
    facts.push(`用户明确产品/套餐周期: ${targetDurationMonths} 个月`);
  }

  let minRetailPrice: number | null = null;
  let maxRetailPrice: number | null = null;
  let targetPrice: number | null = null;

  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*[-~至到]\s*(\d+(?:\.\d+)?)\s*元/);
  if (rangeMatch) {
    minRetailPrice = parseFloat(rangeMatch[1]);
    maxRetailPrice = parseFloat(rangeMatch[2]);
    facts.push(`用户明确零售价区间: ¥${minRetailPrice} - ¥${maxRetailPrice}`);
  }

  const priceOffers = parsePriceOffers(text, targetDurationMonths);
  if (!rangeMatch) {
    const keywordPriceMatch = text.match(/(?:零售价|售价|定价|客单价?|套餐价|价格|每盒|每瓶|单价)\s*(?:为|约|目标|控制在)?\s*(\d+(?:\.\d+)?)\s*元/);
    if (keywordPriceMatch) {
      targetPrice = parseFloat(keywordPriceMatch[1]);
    } else if (priceOffers.length > 0) {
      targetPrice = priceOffers[0].price;
    }
    if (targetPrice !== null) {
      facts.push(`用户指定零售价目标: ¥${targetPrice}`);
    }
  }

  if (priceOffers.length > 1) {
    const offerText = priceOffers
      .map((o) => `¥${o.price}${o.quantity && o.unit ? `/${o.quantity}${o.unit}` : ""}`)
      .join("；");
    facts.push(`用户提供多档套餐价格: ${offerText}`);
  }

  // 4. 成本上限识别
  let maxCostLimit: number | null = null;
  const costMatch = text.match(/(?:成本上限|单盒成本|总成本|生产成本).*?(?:不超过|控制在|小于|≤|<=|为)?\s*(\d+(?:\.\d+)?)\s*元/);
  if (costMatch) {
    maxCostLimit = parseFloat(costMatch[1]);
    facts.push(`用户明确成本控制红线: 单品不超过 ¥${maxCostLimit}`);
  }

  // 5. 首批批量与交付周期识别
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

  // 6. 年龄、人群与渠道识别
  let minAge: number | null = null;
  let maxAge: number | null = null;
  const ageRange = text.match(/(\d{1,3})\s*[-~至到]\s*(\d{1,3})\s*岁/);
  const minAgeMatch = text.match(/(\d{1,3})\s*岁\s*(?:以上|及以上|起)/);
  const maxAgeMatch = text.match(/(\d{1,3})\s*岁\s*(?:以下|以内)/);
  if (ageRange) {
    minAge = parseInt(ageRange[1], 10);
    maxAge = parseInt(ageRange[2], 10);
  } else {
    if (minAgeMatch) minAge = parseInt(minAgeMatch[1], 10);
    if (maxAgeMatch) maxAge = parseInt(maxAgeMatch[1], 10);
  }

  let targetAudience: string | null = null;
  if (minAge !== null || maxAge !== null) {
    targetAudience =
      minAge !== null && maxAge !== null
        ? `${minAge}-${maxAge}岁人群`
        : minAge !== null
          ? `${minAge}岁以上人群`
          : `${maxAge}岁以下人群`;
  } else if (/银发|老年|中老年|爸妈|长辈/.test(text)) {
    targetAudience = "中老年及银发族";
  } else if (/年轻|白领|上班族|女性|学生|精致妈妈/.test(text)) {
    targetAudience = "新锐白领/年轻消费群体";
  }
  if (targetAudience) facts.push(`目标人群: ${targetAudience}`);

  const targetChannels: string[] = [];
  if (/私域|微信|社群|会销|团购|会所|直销/.test(text)) {
    targetChannels.push("私域/社群电商渠道");
  }
  if (/抖音|快手|直播|公域|电商|短视频/.test(text)) {
    targetChannels.push("公域短视频/直播电商");
  }
  if (/门店|药店|商超|线下零售/.test(text)) {
    targetChannels.push("线下零售渠道");
  }
  const targetChannel = targetChannels.length > 0 ? targetChannels.join(" + ") : null;
  if (targetChannel) facts.push(`主攻渠道: ${targetChannel}`);

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
      priceOffers,
      maxCostLimit,
      targetBatchQuantity,
      deliveryWeeks,
      targetDurationMonths,
      minAge,
      maxAge,
      preferredForms,
      forbiddenForms,
      forbiddenClaims,
      requestedClaims,
      forbiddenIngredients,
      targetAudience,
      targetChannel,
      targetChannels,
    },
  };
}
