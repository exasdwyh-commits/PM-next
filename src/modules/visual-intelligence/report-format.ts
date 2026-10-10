/**
 * 开品报告（产品开发立项报告）标准格式 —— 纯函数模块。
 *
 * 背景：本地测试反馈表明，任务 agent 生成的分析报告存在两类问题：
 *   1. 报告停留在复述输入，缺少产品分析、成本与销售机制、风险评估、营销策略等有价值输出；
 *   2. 详细分析字数过多被生成端截断，读者实际读到的「摘要」和「完整报告」效果不一致。
 *
 * 本模块把「一份好开品报告」沉淀成可执行的格式契约：
 *   - 固定章节（sections）与每章字数预算（budget），用于约束生成端输出；
 *   - 两层阅读结构：执行摘要层（summary layer）可独立成篇，详细层（detail layer）按需展开；
 *   - 预算收敛 helper（fitTextToBudget）在句边界截断，避免半句截断；
 *   - 给生成型 agent 的输出契约文本（REPORT_OUTPUT_CONTRACT），可直接拼入提示词约束输出。
 *
 * 本模块不访问数据库、不抓网页、不臆造任何数字。
 */

export interface ReportSectionBudget {
  /** 单章摘要字数上限（建议直接展示，不折叠） */
  summaryMaxChars: number;
  /** 单章详细内容总字数上限 */
  detailMaxChars: number;
  /** 单条详细条目字数上限 */
  detailItemMaxChars: number;
  /** 单章详细条目数上限 */
  maxDetailItems: number;
}

export interface ReportSectionSpec {
  id: string;
  title: string;
  /** 缺失时 validateReportSections 报错 */
  required: boolean;
  budget: ReportSectionBudget;
  description: string;
}

export interface ReportSection {
  id: string;
  title: string;
  required: boolean;
  summary: string;
  details: string[];
}

export interface StandardReportFormat {
  id: "PRODUCT_DEVELOPMENT_REPORT";
  version: string;
  name: string;
  description: string;
  /** 报告正文（Markdown 部分，不含 kern-ui 块）字数上限 */
  maxBodyChars: number;
  /** 执行摘要层字数上限 */
  summaryLayerMaxChars: number;
  /** 建议生成端 maxTokens 下限（按 1 token ≈ 1.5 汉字粗略估算并留余量） */
  recommendedMaxOutputTokens: number;
  sections: readonly ReportSectionSpec[];
}

/**
 * 开品报告标准格式 v1.0。
 * maxBodyChars = 8000 字；recommendedMaxOutputTokens = 6912
 * （≈ 8000 / 1.5 × 1.25，按 256 取整）。
 */
export const PRODUCT_DEVELOPMENT_REPORT_FORMAT: StandardReportFormat = {
  id: "PRODUCT_DEVELOPMENT_REPORT",
  version: "1.0",
  name: "开品报告（产品开发立项报告）",
  description:
    "面向产品立项决策的标准报告格式：固定章节、字数预算、摘要先行、详细展开、禁止伪造数字。",
  maxBodyChars: 8000,
  summaryLayerMaxChars: 400,
  recommendedMaxOutputTokens: 6912,
  sections: [
    {
      id: "opportunity",
      title: "机会与市场洞察",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 500, detailItemMaxChars: 180, maxDetailItems: 4 },
      description: "一句话机会、目标人群、市场信号覆盖与缺口。",
    },
    {
      id: "positioning",
      title: "产品定位与目标用户",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 500, detailItemMaxChars: 180, maxDetailItems: 4 },
      description: "定位、价值主张、使用场景与明确不做什么。",
    },
    {
      id: "competition",
      title: "竞品格局与差异化",
      required: false,
      budget: { summaryMaxChars: 100, detailMaxChars: 400, detailItemMaxChars: 180, maxDetailItems: 3 },
      description: "竞品信号与差异化方向，推断须标注待验证。",
    },
    {
      id: "cost-structure",
      title: "成本结构与盈利模型",
      required: true,
      budget: { summaryMaxChars: 120, detailMaxChars: 700, detailItemMaxChars: 200, maxDetailItems: 8 },
      description: "六类成本列支、单位毛利与回本公式；金额一律待填写。",
    },
    {
      id: "sales-mechanism",
      title: "销售机制与渠道建议",
      required: true,
      budget: { summaryMaxChars: 120, detailMaxChars: 600, detailItemMaxChars: 200, maxDetailItems: 4 },
      description: "渠道选项、适合条件、优劣势、合规提示与最小验证方式。",
    },
    {
      id: "risk-assessment",
      title: "风险评估与缓解",
      required: true,
      budget: { summaryMaxChars: 120, detailMaxChars: 600, detailItemMaxChars: 200, maxDetailItems: 5 },
      description: "风险登记册：类别、可能性、影响、缓解措施、负责人与触发信号。",
    },
    {
      id: "marketing-strategy",
      title: "营销策略",
      required: true,
      budget: { summaryMaxChars: 120, detailMaxChars: 500, detailItemMaxChars: 200, maxDetailItems: 5 },
      description: "按生命周期阶段匹配的具体动作、指标与合规 guardrail。",
    },
    {
      id: "compliance",
      title: "合规边界",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 300, detailItemMaxChars: 150, maxDetailItems: 3 },
      description: "门禁状态、禁止事项与免责声明；可审查不等于已批准上市。",
    },
    {
      id: "roadmap",
      title: "研发里程碑",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 400, detailItemMaxChars: 150, maxDetailItems: 6 },
      description: "阶段、交付物与停止条件。",
    },
    {
      id: "growth",
      title: "增长指标与验证",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 400, detailItemMaxChars: 150, maxDetailItems: 5 },
      description: "AARRR 指标、guardrail 与数据需求。",
    },
    {
      id: "token-cost",
      title: "Token 与成本统计",
      required: false,
      budget: { summaryMaxChars: 120, detailMaxChars: 400, detailItemMaxChars: 160, maxDetailItems: 4 },
      description: "模型调用次数、token 用量与按公开参考价估算的成本。",
    },
    {
      id: "appendix",
      title: "附录：证据与未知",
      required: true,
      budget: { summaryMaxChars: 100, detailMaxChars: 400, detailItemMaxChars: 150, maxDetailItems: 4 },
      description: "证据清单概览、未知项与边界声明。",
    },
  ],
};

const SENTENCE_ENDINGS = new Set(["。", "！", "？", "；", ".", "!", "?", ";", "\n"]);

/**
 * 把文本收敛到字数预算内：优先在句边界截断并追加省略号；
 * 找不到句边界时硬切，并尽量避开切断英文单词。
 */
export function fitTextToBudget(text: string, maxChars: number): string {
  const input = (text ?? "").trim();
  if (maxChars <= 0) return "";
  if (input.length <= maxChars) return input;
  const slice = input.slice(0, Math.max(0, maxChars - 1));
  let cut = -1;
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    if (SENTENCE_ENDINGS.has(slice[i])) {
      cut = i + 1;
      break;
    }
  }
  if (cut < 1) {
    cut = slice.length;
    if (/[A-Za-z]/.test(slice[slice.length - 1] ?? "") && /\s/.test(input[slice.length] ?? "")) {
      const match = /[A-Za-z]+$/.exec(slice);
      if (match) cut = slice.length - match[0].length;
    }
  }
  return `${slice.slice(0, cut).trimEnd()}…`;
}

/**
 * 按章节预算构建一个报告章节：摘要与每条细节都会被收敛；
 * 超出总预算或条数上限的细节条目会被丢弃（内容设计上应避免触发）。
 */
export function buildReportSection(
  spec: ReportSectionSpec,
  summary: string,
  details: readonly string[],
): ReportSection {
  const fittedDetails: string[] = [];
  let used = 0;
  for (const raw of details) {
    if (fittedDetails.length >= spec.budget.maxDetailItems) break;
    const room = spec.budget.detailMaxChars - used;
    if (room <= 0) break;
    const item = fitTextToBudget(raw, Math.min(spec.budget.detailItemMaxChars, room));
    if (!item || item === "…") break;
    fittedDetails.push(item);
    used += item.length;
  }
  return {
    id: spec.id,
    title: spec.title,
    required: spec.required,
    summary: fitTextToBudget(summary, spec.budget.summaryMaxChars),
    details: fittedDetails,
  };
}

/** 执行摘要层：拼接各必需章节的摘要，整体再收敛到摘要层预算。 */
export function buildExecutiveSummary(
  sections: readonly ReportSection[],
  maxChars: number = PRODUCT_DEVELOPMENT_REPORT_FORMAT.summaryLayerMaxChars,
): string {
  const parts = sections
    .filter((section) => section.required && section.summary)
    .map((section) => `${section.title}：${section.summary}`);
  return fitTextToBudget(parts.join(""), maxChars);
}

/** 校验报告章节：必需章节齐全、id 不重复、预算不超。 */
export function validateReportSections(
  sections: readonly ReportSection[],
  format: StandardReportFormat = PRODUCT_DEVELOPMENT_REPORT_FORMAT,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const specs = new Map(format.sections.map((spec) => [spec.id, spec]));
  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) problems.push(`章节 id 重复：${section.id}`);
    seen.add(section.id);
    const spec = specs.get(section.id);
    if (!spec) {
      problems.push(`未知章节：${section.id}`);
      continue;
    }
    if (section.summary.length > spec.budget.summaryMaxChars) {
      problems.push(`${section.id} 摘要超预算（${section.summary.length}/${spec.budget.summaryMaxChars}）`);
    }
    const detailChars = section.details.reduce((sum, item) => sum + item.length, 0);
    if (detailChars > spec.budget.detailMaxChars) {
      problems.push(`${section.id} 细节超预算（${detailChars}/${spec.budget.detailMaxChars}）`);
    }
    if (section.details.length > spec.budget.maxDetailItems) {
      problems.push(`${section.id} 细节条数超预算（${section.details.length}/${spec.budget.maxDetailItems}）`);
    }
    for (const item of section.details) {
      if (item.length > spec.budget.detailItemMaxChars) {
        problems.push(`${section.id} 细节条目超预算（${item.length}/${spec.budget.detailItemMaxChars}）`);
      }
    }
  }
  for (const spec of format.sections) {
    if (spec.required && !seen.has(spec.id)) {
      problems.push(`缺少必需章节：${spec.id}（${spec.title}）`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** 粗略估算生成端需要的 maxTokens：1 token ≈ 1.5 汉字，留 25% 余量并按 256 取整，最小 1024。 */
export function estimateMaxOutputTokens(textChars: number): number {
  const base = Math.ceil(Math.max(0, textChars) / 1.5) * 1.25;
  return Math.max(1024, Math.ceil(base / 256) * 256);
}

/**
 * 给生成型任务 agent 的输出契约（可直接拼入提示词）。
 * 目标：约束输出篇幅、固定摘要先行结构、禁止伪造数字。
 */
export const REPORT_OUTPUT_CONTRACT = [
  "开品报告输出契约（PRODUCT_DEVELOPMENT_REPORT v1.0）：",
  `1. 先输出「执行摘要」（≤${PRODUCT_DEVELOPMENT_REPORT_FORMAT.summaryLayerMaxChars} 字），再输出各章节详细内容；即使后文被截断，摘要层也必须完整。`,
  "2. 每章首句是该章摘要（≤120 字）；只读每章首句应能掌握全文；详细条目每条 ≤200 字。",
  `3. 报告正文总字数 ≤${PRODUCT_DEVELOPMENT_REPORT_FORMAT.maxBodyChars} 字；生成端 maxTokens 建议 ≥${PRODUCT_DEVELOPMENT_REPORT_FORMAT.recommendedMaxOutputTokens}，不足时优先保摘要层完整、详细层分段输出。`,
  "4. 禁止伪造数字：金额、市场规模、销量、转化率、功效结论一律写「待填写」或「待验证」，未知即未知。",
  "5. 健康功效表达必须绑定证据等级与来源；疾病预防、治疗、治愈类表达直接暂停。",
  "6. Token 用量与估算成本单独成节；未提供用量数据时明确写「未提供」，不得估算。",
].join("\n");
