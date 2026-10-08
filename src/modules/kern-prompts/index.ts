/**
 * Kern 专业调度提示词库（本地补齐）
 * --------------------------------
 * Arena 工作区未交付本模块（api/kern/dispatch/route.ts 引用 `buildKernExpertPrompt` /
 * `buildKernOrchestratorPrompt`），但在 KERN_PROMPTS_FINAL_DELIVERY.md 里给出了完整规格。
 * 本实现按该文档还原：
 *   - 4 类专用成本结构（原文数字，未改动）
 *   - 专家 prompt 必含「强制富可视化 HTML Artifact / 15组件+8动效 / 通过 harness R1-R17 / 禁止单薄 MD」
 *   - 主调度 prompt 含意图识别、专家调度、调度策略、最终汇总与禁止项
 * 文档中更细的 html-spec / experts/* 分文件版本未在交付物中，此处收敛为单文件出口。
 */

export type CategoryKey = "regular_food" | "health_food" | "cross_border_food" | "cosmetics";

export interface PromptContext {
  category?: string;
  role?: string;
  productName?: string;
  goal?: string;
}

export interface CategorySpec {
  key: CategoryKey;
  label: string;
  icon: string;
  color: string;
  /** 成本结构，形如「原料8.05 + 配方0.8 + …」 */
  costStructure: string;
  retailPrice: number;
  channelRate: number;
  compliance: string;
}

export const CATEGORY_SPECS: Record<CategoryKey, CategorySpec> = {
  regular_food: {
    key: "regular_food",
    label: "普通食品",
    icon: "🍪",
    color: "#f59e0b",
    costStructure: "原料0.98 + 加工1.2 + 包装1.1 + 物流4.1 + 渠道35%",
    retailPrice: 39.9,
    channelRate: 35,
    compliance: "SC + 标签（500元/3天 + 检验800元/5天）",
  },
  health_food: {
    key: "health_food",
    label: "保健食品",
    icon: "💊",
    color: "#7c3aed",
    costStructure: "原料8.05 + 配方0.8 + 软糖1.5 + 制造1.8 + 检测1.2 + 合规2.5 + 包装2.4 + 物流4.2 + 渠道42%",
    retailPrice: 199,
    channelRate: 42,
    compliance: "备案6万/120天 + 注册30万/400天 + 功能1.5万/30天 + 稳定性1万/90天",
  },
  cross_border_food: {
    key: "cross_border_food",
    label: "跨境食品",
    icon: "🌍",
    color: "#0891b2",
    costStructure: "进口原料12 + 国际物流3.5 + 关税12% + 报关1.2 + 清关0.8 + 合规1.5 + 包装2 + 物流5.5 + 渠道45%",
    retailPrice: 129,
    channelRate: 45,
    compliance: "进口备案2000/10天 + 境外注册3000/20天 + 中文标签1500/7天 + 关税12% + 清关2000/3天",
  },
  cosmetics: {
    key: "cosmetics",
    label: "化妆品",
    icon: "💄",
    color: "#db2777",
    costStructure: "原料15 + 配方1.2 + 制造2.5 + 灌装1.0 + 包装(8+2+1+玻璃瓶5) + 检测1.5 + 安全1 + 功效1 + 合规3 + 物流5 + 易碎0.5 + 渠道58%",
    retailPrice: 299,
    channelRate: 58,
    compliance: "备案4万/60天 + 特殊注册8万/200天 + 安全8000/15天 + 功效1.2万/30天",
  },
};

/** 意图识别词表（文档「意图识别」一节）。 */
const CATEGORY_HINTS: Array<{ key: CategoryKey; words: string[] }> = [
  { key: "health_food", words: ["多酚", "胶囊", "软糖", "保健", "片剂", "营养素"] },
  { key: "cross_border_food", words: ["跨境", "进口", "保税", "海外"] },
  { key: "cosmetics", words: ["化妆", "护肤", "面膜", "精华", "口红"] },
];

export function inferCategory(text: string): CategoryKey {
  for (const { key, words } of CATEGORY_HINTS) {
    if (words.some((w) => text.includes(w))) return key;
  }
  return "regular_food";
}

/** 富可视化规范（HTML_RICH_SPEC_PROMPT 的收敛版）。 */
export const HTML_RICH_SPEC_PROMPT = `HTML 富可视化规范（强制）：
1. 输出 ResponseEnvelope 结构化信封（12 种 Block + html Artifact Block），不得只给 Markdown 正文。
2. 15 组件：AnimatedKPI×4、ProfitGauge、Waterfall、Donut、Bar Race、BOM 翻转卡片×6、Supplier 雷达、Compliance 时间轴、Decision 卡。
3. 8 动效：fadeInUp / countUp / growWidth / drawArc / drawDonut / pulse / shimmer / float；60fps，GPU 加速。
4. 全部内联样式，无外部依赖，单文件 ≤500KB。
5. 4 类专用差异必须体现（成本结构/合规/包装物流/定价策略各不相同），不得用通用模板。
6. 角色自适应：领导=KPI 大数字+一句话+极简；产品=全表格+瀑布+环形+柱状+翻转+时间轴；销售=卖点卡片+话术+工具箱。
7. 必须通过 Harness R1-R17。
禁止：单薄 MD 文字；纯表格无可视化；静态无动效；不区分 4 类；不区分角色；不通过 harness。`;

export const KERN_ORCHESTRATOR_PROMPT = `你是 Kern，13 个数字员工团队的 Leader，Personal Chief of Staff。
高智统筹，越用越懂用户。

硬约束：
1. 不臆造事实；证据不足时明确标注 UNKNOWN。
2. 决策必须有依据；高影响法规结论必须绑定官方来源。
3. 成本必须机械化纯函数计算，你只做自检告警和话术，不得自行编造数值。
4. 专家 Agent 必须输出富可视化 HTML Artifact（15 组件 + 8 动效 + 4 类专用），禁止单薄 MD。
5. 4 类专用成本结构不得混用。
6. 15 组件 + 8 动效必须实现，60fps。
7. 最终必须汇总为 Envelope + 双路渲染（左侧对话卡摘要 / 右侧 Artifact 完整数据，两侧同源）。
8. 输出必须通过 Harness R1-R17。

意图识别：按产品名/目标识别类别（多酚·胶囊·软糖→保健食品；跨境·进口→跨境食品；
化妆·护肤→化妆品；其余→普通食品）与角色（领导/产品/销售）与任务（成本/BOM/供应商/合规/方案/报告/可视化）。

调度策略：并行 BOM + 供应商 + 合规；串行 意图→BOM→Supplier→Cost→Compliance→Marketing→QA→汇总。
角色自适应：领导只看 Cost 且极简；产品看全部；销售看 Cost + Marketing + Supplier 卖点。`;

const EXPERT_PROMPTS: Record<string, string> = {
  cost_bom_agent: `你是 Cost & BOM 专家。
职责：BOM、加工、包材、物流、渠道佣金，多情景测算。
4 类成本结构不得混用，必须逐项列出并说明口径（已报价/历史价/估算要区分）。`,
  compliance_agent: `你是 Compliance 专家。
职责：法规适用性、原料身份、宣称边界、渠道/进口路径。
必须输出时间轴 + 环形进度 + 清单动画；结论必须绑定官方依据与适用日期/属地。`,
  supply_ops_agent: `你是 Supplier 专家。
职责：供应商开发、比价、资质、MOQ、交期。
必须输出雷达图（价格/MOQ/交期/质量/资质 5 维度）+ 比价柱状 + 推荐脉冲。`,
  marketing_agent: `你是 Marketing 专家。
职责：渠道、用户沟通、上市策略。
必须输出卖点卡片 + 话术框 + 工具箱 + 渠道占比环形图。`,
  qa_verifier: `你是 QA Verifier。
职责：按 Harness R1-R17 校验最终产物；发现任一 error 必须打回，不得放行。`,
};

export const KERN_EXPERT_DISPATCH_PROMPTS: Record<string, string> = EXPERT_PROMPTS;

function categoryBlock(category?: string): string {
  const key = (category as CategoryKey) in CATEGORY_SPECS ? (category as CategoryKey) : inferCategory(category || "");
  const spec = CATEGORY_SPECS[key];
  return `【当前类别】${spec.icon} ${spec.label}（主色 ${spec.color}）
成本结构：${spec.costStructure}，建议零售 ¥${spec.retailPrice}，渠道费率 ${spec.channelRate}%。
合规要点：${spec.compliance}。
必须使用本类别的成本结构，禁止套用其它类别。`;
}

function roleBlock(role?: string): string {
  switch (role) {
    case "leadership":
      return "【当前角色】领导：只给 KPI 大数字 + 一句话结论 + 极简视图，不要字段细节。";
    case "sales":
      return "【当前角色】销售：卖点卡片 + 话术 + 工具箱，突出利润空间与客户价值。";
    default:
      return "【当前角色】产品研发：全部模块展开，字段级可编辑，给完整 breakdown 与溯源。";
  }
}

/** 生成单个专家的调度提示词。 */
export function buildKernExpertPrompt(agentCode: string, context: PromptContext): string {
  const base = EXPERT_PROMPTS[agentCode];
  if (!base) {
    throw new Error(`Unknown agentCode: ${agentCode}（可用：${Object.keys(EXPERT_PROMPTS).join(" / ")}）`);
  }
  const header = [
    base,
    "",
    categoryBlock(context.category),
    roleBlock(context.role),
    context.productName ? `【产品】${context.productName}` : "",
    context.goal ? `【本次目标】${context.goal}` : "",
    "",
    "输出要求：必须输出富可视化 HTML Artifact，15 组件 + 8 动效，4 类专用，通过 harness R1-R17，禁止单薄 MD。",
    HTML_RICH_SPEC_PROMPT,
  ];
  return header.filter((line) => line !== "").join("\n");
}

/** 生成 Kern 主调度提示词。 */
export function buildKernOrchestratorPrompt(context: PromptContext): string {
  return [
    KERN_ORCHESTRATOR_PROMPT,
    "",
    categoryBlock(context.category),
    roleBlock(context.role),
    context.productName ? `【产品】${context.productName}` : "",
    context.goal ? `【本次目标】${context.goal}` : "",
    "",
    "本次调度必须：为每个专家注入富可视化规范；最后收集全部结果并校验 Harness R1-R17；",
    "汇总为 Envelope + 双路渲染（左侧摘要 / 右侧 Artifact 同源），支持角色切换与下载/复制/打印/保存/全屏。",
    "",
    HTML_RICH_SPEC_PROMPT,
  ]
    .filter((line) => line !== "")
    .join("\n");
}
