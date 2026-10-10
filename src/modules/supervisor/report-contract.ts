/**
 * NEW_PRODUCT 汇总输出契约（R1·new-product-conclusion/v1）
 * =======================================================
 * 研发任务完成后，对话里交给用户的汇总必须是一份「能直接拿去决策」的产品报告，
 * 而不是把上游输出复述一遍。本模块把这份报告的格式沉淀成可测试的契约：
 *
 * - 八节固定分节：结论摘要 / 产品定位 / 成本与经济性 / 销售机制与渠道 /
 *   营销策略 / 风险评估 / 合规边界 / 验证计划与待决策，缺一节即不合规；
 * - 每条关键结论以（事实|推断|UNKNOWN）之一标注——渲染层
 *   （src/app/muse/components/prose.tsx 的 m-tagline 芯片）按这组字面标注
 *   上色，所以字面必须逐字一致；
 * - 数字必须可追溯：联网/工具/组织事实数字附来源标记，模型判断标（推断），
 *   缺数据按「UNKNOWN：<缺什么>（需要 <如何补齐>）」逐条列出
 *   （该格式会被 response-format/from-mission.ts 的 extractUnknowns 解析成
 *   缺口清单）；
 * - 严禁编造数字：金额、市场规模、销量、转化率没有来源一律不写具体值。
 *
 * 下游既有解析器的兼容约束（改标题字面之前先看这里）：
 * - extractDecision（supervisor/report-format.ts）认「需要你决定」字样；
 * - extractRecommendation（同文件）认「推荐做「X」」；
 * - envelopeFromMission（response-format/from-mission.ts）的决策卡从
 *   「结论与建议 / 反对理由 / 主要风险」三段取料；风险节标题必须含「风险」，
 *   conclusions 摘要里必须有一行以「**结论与建议**：」开头；
 * - resolveSourceMarkers 认 [source:sourceId] 来源标记。
 *
 * 与 visual-intelligence/report-format.ts 的关系：那是「开品立项报告」的完整
 * 十二章标准（面向立项文档导出）；这里是 mission 汇总对话输出的最小必需集，
 * 两册语义一一对应、繁简不同，同一份格式教义（docs/PRODUCT_DEVELOPMENT_REPORT_FORMAT.md）。
 */

export const CONCLUSION_FORMAT_VERSION = "new-product-conclusion/v1";

export const REPORT_CLAIM_MARKS = ["事实", "推断", "UNKNOWN"] as const;
export type ReportClaimMark = (typeof REPORT_CLAIM_MARKS)[number];

export interface ConclusionSectionSpec {
  /** 稳定机器标识（测试与校验器使用，不对外显示）。 */
  id: string;
  /** 报告里的 `##` 分节标题（字面，多个下游解析器认它）。 */
  heading: string;
  /** 口径：这一节必须回答什么、不得写什么。 */
  scope: string;
  /** 来源标注：这一节的内容默认可追溯自哪些上游节点/数据。 */
  sourcedFrom: readonly string[];
}

export const NEW_PRODUCT_CONCLUSION_SECTIONS: readonly ConclusionSectionSpec[] = [
  {
    id: "executive-summary",
    heading: "结论摘要",
    scope:
      "一页之内说清推荐方向与取舍理由，以及最关键的 2–3 条依据（各带标注）。" +
      "必须含一行以「**结论与建议**：」开头列出推荐方向与关键取舍；第一句可写 **推荐做「方向名」**。" +
      "如有成形的反对理由，单独一行以「**反对理由**：」开头，没有就不写（不许编造）。",
    sourcedFrom: ["全部上游节点", "QA 复核结论"],
  },
  {
    id: "positioning",
    heading: "产品定位",
    scope:
      "目标人群与场景、核心价值主张、差异化，以及明确不做什么。" +
      "人群、买点、差异化如只有模型常识支撑，必须标（推断），禁止包装成市场事实。",
    sourcedFrom: ["opportunity 节点", "market 节点", "对话中用户已确认的约束"],
  },
  {
    id: "cost-economics",
    heading: "成本与经济性",
    scope:
      "六类成本结构（原材料/包材/加工/质检物流/平台佣金/隐性成本）与单位毛利估算口径。" +
      "金额必须标来源或（推断）；真实报价、起订量、测试费用缺失时逐条写 UNKNOWN 与补齐方式，严禁编造具体数字。",
    sourcedFrom: ["economics 节点"],
  },
  {
    id: "sales-channels",
    heading: "销售机制与渠道",
    scope:
      "候选销售渠道与机制、各自适合的条件、优劣势对比与最小验证方式。" +
      "渠道效率与转化率属推断范畴，不得当作事实；每个候选渠道须给出通向真实数据的下一步。",
    sourcedFrom: ["gtm 节点", "market 节点"],
  },
  {
    id: "marketing",
    heading: "营销策略",
    scope: "首批目标人群、核心信息、冷启动动作与衡量指标；指标目标值须标注（推断）或 UNKNOWN。",
    sourcedFrom: ["gtm 节点"],
  },
  {
    id: "risk",
    heading: "风险评估",
    scope:
      "主要失败路径、触发条件、早期信号与缓解措施。红队证伪意见必须体现在这一节，" +
      "不许只剩鼓劲式风险；每条风险保持原有标注。本节标题必须含「风险」（决策卡解析约定）。",
    sourcedFrom: ["red-team 节点", "qa 复核", "validation 节点"],
  },
  {
    id: "compliance",
    heading: "合规边界",
    scope:
      "产品品类资质、宣称边界、平台准入等硬约束，以及每条约束的法规/标准依据。" +
      "必须写清「可被审查」不等于「已获批准」；任何功效/医疗类宣称都按红区处理并提示官方复核。",
    sourcedFrom: ["compliance 节点", "red-team 节点"],
  },
  {
    id: "validation-decisions",
    heading: "验证计划与待决策",
    scope:
      "关键商业假设按风险排序、每个假设的最低成本验证方法与成功/失败阈值。" +
      "必须含一行以「**需要你决定**：」开头列出真正需要用户拍板的事项；没有就写「目前不需要你决定」。",
    sourcedFrom: ["validation 节点", "全部上游节点"],
  },
];

/**
 * 专家节点统一的证据纪律（SPECIALIST 指令在 generic-executor.ts 注入）。
 * 末尾的 UNKNOWN 行格式与 from-mission.ts 的 extractUnknowns 解析一致，
 * 缺口条目会出现在结论信封的「缺口清单」里。
 */
export const SPECIALIST_EVIDENCE_RULE =
  "标注纪律：每条关键结论结尾用（事实）、（推断）或（UNKNOWN）之一标注；" +
  "数字必须可追溯——来自工具/联网的带 [source:sourceId] 或写明出处，模型自己的估算标（推断）；" +
  "拿不到的数据逐条写「UNKNOWN：<缺什么>（需要 <如何补齐：真实报价、权威来源、试验或用户输入>）」；" +
  "严禁编造数字、来源与百分比，宁可标 UNKNOWN 也不凑数。";

export function buildNewProductConclusionContract(): string {
  const headingLines = NEW_PRODUCT_CONCLUSION_SECTIONS.map(
    (section, index) => `   ${index + 1}. ## ${section.heading} — ${section.scope}（可追溯自：${section.sourcedFrom.join("、")}）`,
  );
  return [
    `新产品研发汇总输出契约（${CONCLUSION_FORMAT_VERSION}）：`,
    "1. 分节固定：用 `##` 依次输出以下八节，标题字面不要改、不要增删、顺序不要换：",
    ...headingLines,
    "2. 标注：每条关键结论结尾用（事实）、（推断）或（UNKNOWN）之一标注；只标关键结论，不要每行都标。",
    "3. 数字可追溯：来自联网/工具/组织事实的数字附 [source:sourceId] 或写明出处；模型估算必须标（推断）；没有来源的金额/市场规模/销量/转化率一律不写具体值。",
    "4. 缺口不留白：拿不到的数据逐条写「UNKNOWN：<缺什么>（需要 <如何补齐>）」，使缺口能进入信封的缺口清单。",
    "5. 「结论摘要」里须有一行以「**结论与建议**：」开头；如有成形反对理由，单独一行以「**反对理由**：」开头，没有就不写。",
    "6. 「验证计划与待决策」里须有一行以「**需要你决定**：」开头；没有就写「目前不需要你决定」。",
    "7. 上游失败或缺失的部分，在对应分节里如实写「该部分未完成」并说明原因，不得假装做过。",
  ].join("\n");
}

export interface ConclusionValidation {
  ok: boolean;
  problems: string[];
}

const SECTION_REGEX = (heading: string) => new RegExp(`^##\\s*(?:\\d+[.、]\\s*)?${heading}\\s*$`, "m");
const MARK_REGEX = /（事实）|（推断）|（UNKNOWN）/g;

/**
 * 校验一份汇总文本是否满足契约。纯函数，供测试与未来的 harness 检查使用。
 * 设计为可列出全部问题（第一节不短路），方便一次性修齐。
 */
export function validateNewProductConclusion(text: string): ConclusionValidation {
  const problems: string[] = [];
  const body = (text ?? "").replace(/\r/g, "");

  for (const section of NEW_PRODUCT_CONCLUSION_SECTIONS) {
    if (!SECTION_REGEX(section.heading).test(body)) {
      problems.push(`缺少分节「## ${section.heading}」`);
    }
  }

  const markCount = (body.match(MARK_REGEX) ?? []).length;
  if (markCount < 3) {
    problems.push(`关键结论标注（事实|推断|UNKNOWN）不足（当前 ${markCount} 处，至少 3 处）`);
  }

  if (!/结论与建议/.test(body)) {
    problems.push("「结论摘要」内未找到以「**结论与建议**：」开头的行（决策卡会因此降级）");
  }

  if (!/需要你(来)?决定/.test(body)) {
    problems.push("「验证计划与待决策」内未找到「需要你决定」字样（decision probe 约定）");
  }

  return { ok: problems.length === 0, problems };
}
