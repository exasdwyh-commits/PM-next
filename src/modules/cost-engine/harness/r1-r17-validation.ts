/**
 * Harness R1–R17 校验（本地补齐）
 * ------------------------------
 * Arena 工作区未交付本文件（api/harness/validate/route.ts 引用 `runHarnessValidation`）。
 * 17 条规则名取自交付物 REAL_TEST_REPORT.md「6. Harness R1-R17」一节，逐条实现。
 *
 * 设计取舍（与原交付不同，务请注意）：
 *   原报告在**不提供 htmlReport/richReport** 的情况下也自称 17/17 100%。
 *   但那 17 条里有多条本质上需要产物才能判断（组件数、动效、双路一致性…），
 *   无产物仍判「通过」等于假绿。本实现改为：
 *     缺少必要输入 → applicable = false（列出原因，不计入通过率）
 *     summary.passed / total 只统计 applicable 的规则，另外单列 skipped。
 *   allPass 的含义是「所有**可判**规则都通过」，而不是「什么都没查也算全绿」。
 */

export interface HarnessInput {
  category?: string;
  role?: string;
  htmlReport?: string;
  richReport?: string;
  costData?: unknown;
  evidenceCount?: number;
  verifiedCount?: number;
}

export interface HarnessRuleResult {
  id: string;
  name: string;
  applicable: boolean;
  passed: boolean;
  detail: string;
}

export interface HarnessSummary {
  passed: number;
  total: number;
  skipped: number;
  rate: number;
  allPass: boolean;
}

export interface HarnessOutput {
  summary: HarnessSummary;
  results: HarnessRuleResult[];
  category: string;
  role: string;
  generatedAt: string;
}

const REQUIRED_COMPONENTS = 15;
const REQUIRED_ANIMATIONS = 8;
const ANIMATION_KEYWORDS = [
  "fadeInUp",
  "countUp",
  "growWidth",
  "drawArc",
  "drawDonut",
  "pulse",
  "shimmer",
  "float",
];
const CATEGORY_MARKERS: Record<string, string[]> = {
  regular_food: ["普通食品", "🍪"],
  health_food: ["保健食品", "保健", "💊"],
  cross_border_food: ["跨境", "🌍"],
  cosmetics: ["化妆品", "💄"],
};

/** 以 `data-component="x"` 或注释标记计数，避免把任意 div 都算成组件。 */
function countComponents(html: string): number {
  const marked = html.match(/data-component=/g);
  if (marked) return new Set(html.match(/data-component=["']([^"']+)["']/g) || []).size;
  // 无显式标记时退回按已知组件名计数
  const known = [
    "AnimatedKPI",
    "ProfitGauge",
    "Waterfall",
    "Donut",
    "BarRace",
    "BomFlip",
    "SupplierRadar",
    "ComplianceTimeline",
    "DecisionCard",
  ];
  return known.filter((k) => html.includes(k)).length;
}

function rule(
  id: string,
  name: string,
  applicable: boolean,
  passed: boolean,
  detail: string
): HarnessRuleResult {
  return { id, name, applicable, passed: applicable ? passed : false, detail };
}

export function runHarnessValidation(input: HarnessInput): HarnessOutput {
  const category = input.category || "health_food";
  const role = input.role || "product";
  const html = input.htmlReport || "";
  const rich = input.richReport || "";
  const hasHtml = html.length > 0;
  const hasRich = rich.length > 0;
  const both = hasHtml && hasRich;

  const results: HarnessRuleResult[] = [];

  // R1 双路渲染一致性
  results.push(
    rule(
      "R1",
      "双路渲染一致性",
      both,
      both && html === rich,
      both ? (html === rich ? "两份产物字节一致" : "两份产物内容不一致") : "需要同时提供 htmlReport 与 richReport"
    )
  );

  // R2 4类专用
  const markers = CATEGORY_MARKERS[category] || [];
  results.push(
    rule(
      "R2",
      "4类专用",
      hasHtml,
      hasHtml && markers.some((m) => html.includes(m)),
      hasHtml ? `检查类别标记：${markers.join(" / ")}` : "需要 htmlReport"
    )
  );

  // R3–R5 角色自适应
  const roleCheck: Array<[string, string, string[]]> = [
    ["R3", "角色自适应-领导直观", ["KPI", "结论", "净利"]],
    ["R4", "角色自适应-研发严谨", ["breakdown", "字段", "模块"]],
    ["R5", "角色自适应-销售卖点突出", ["卖点", "话术", "客户"]],
  ];
  for (const [id, name, keywords] of roleCheck) {
    const expectedRole = id === "R3" ? "leadership" : id === "R4" ? "product" : "sales";
    const active = hasHtml && role === expectedRole;
    results.push(
      rule(
        id,
        name,
        active,
        active && keywords.some((k) => html.includes(k)),
        active
          ? `当前角色 ${role}，检查关键词：${keywords.join(" / ")}`
          : `当前角色为 ${role}，本规则仅在角色为 ${expectedRole} 时适用`
      )
    );
  }

  // R6 富可视化 15 组件
  const componentCount = hasHtml ? countComponents(html) : 0;
  results.push(
    rule(
      "R6",
      "富可视化 15 组件",
      hasHtml,
      hasHtml && componentCount >= REQUIRED_COMPONENTS,
      hasHtml ? `识别到 ${componentCount} 个组件（要求 ≥${REQUIRED_COMPONENTS}）` : "需要 htmlReport"
    )
  );

  // R7 8 动效
  const foundAnimations = hasHtml ? ANIMATION_KEYWORDS.filter((k) => html.includes(k)) : [];
  results.push(
    rule(
      "R7",
      "8 动效",
      hasHtml,
      hasHtml && foundAnimations.length >= REQUIRED_ANIMATIONS,
      hasHtml
        ? `命中 ${foundAnimations.length}/${REQUIRED_ANIMATIONS}：${foundAnimations.join(",") || "无"}`
        : "需要 htmlReport"
    )
  );

  // R8 projectId 过滤
  const hasCostData = input.costData != null;
  results.push(
    rule(
      "R8",
      "projectId 过滤",
      hasCostData,
      hasCostData && JSON.stringify(input.costData).includes("projectId"),
      hasCostData ? "检查 costData 是否带 projectId 维度" : "需要 costData"
    )
  );

  // R9 / R10 拖拽导入
  results.push(
    rule(
      "R9",
      "drag-drop Excel",
      hasHtml,
      hasHtml && /drop|dragover|Excel|xlsx/i.test(html),
      hasHtml ? "检查拖拽/Excel 导入标记" : "需要 htmlReport"
    )
  );
  results.push(
    rule(
      "R10",
      "drag-drop evidence/qualification",
      hasHtml,
      hasHtml && /evidence|qualification|资质/i.test(html),
      hasHtml ? "检查证据/资质导入标记" : "需要 htmlReport"
    )
  );

  // R11 角色化导出
  results.push(
    rule(
      "R11",
      "role-based Word/HTML/PDF export",
      hasHtml,
      hasHtml && /export|导出/i.test(html) && /(Word|HTML|PDF)/i.test(html),
      hasHtml ? "检查 Word/HTML/PDF 导出入口" : "需要 htmlReport"
    )
  );

  // R12 Kern 调度
  results.push(
    rule(
      "R12",
      "Kern 调度",
      hasHtml,
      hasHtml && /Kern/i.test(html),
      hasHtml ? "检查是否体现 Kern 调度" : "需要 htmlReport"
    )
  );

  // R13 审批流
  results.push(
    rule(
      "R13",
      "审批流",
      hasHtml,
      hasHtml && /审批|approval/i.test(html),
      hasHtml ? "检查审批流节点" : "需要 htmlReport"
    )
  );

  // R14 协作 @提及 + 版本历史
  results.push(
    rule(
      "R14",
      "协作@提及+版本历史",
      hasHtml,
      hasHtml && /@|提及|mention/i.test(html) && /版本|version/i.test(html),
      hasHtml ? "检查 @提及与版本历史" : "需要 htmlReport"
    )
  );

  // R15 证据可信度 A/B/C/D —— 由证据统计推导
  const total = input.evidenceCount ?? 0;
  const verified = input.verifiedCount ?? 0;
  const hasEvidenceStats = typeof input.evidenceCount === "number";
  results.push(
    rule(
      "R15",
      "证据可信度 A/B/C/D",
      hasEvidenceStats,
      hasEvidenceStats && verified <= total,
      hasEvidenceStats ? `已核实 ${verified} / 共 ${total}` : "需要 evidenceCount / verifiedCount"
    )
  );

  // R16 成本计算 4 类差异化
  results.push(
    rule(
      "R16",
      "成本计算4类差异化",
      hasHtml || hasCostData,
      hasHtml || hasCostData
        ? markers.some((m) => html.includes(m)) || JSON.stringify(input.costData || {}).includes(category)
        : false,
      `检查产物是否体现类别 ${category} 的专属成本结构`
    )
  );

  // R17 角色切换 / 内联样式体积
  const sizeKb = Math.ceil(html.length / 1024);
  results.push(
    rule(
      "R17",
      "Kern对话驱动角色切换（含内联样式 ≤500KB）",
      hasHtml,
      hasHtml && /useRole|inferRoleFromText|角色切换/i.test(html) && sizeKb <= 500,
      hasHtml ? `角色切换标记 + 体积 ${sizeKb}KB（限 500KB）` : "需要 htmlReport"
    )
  );

  const applicable = results.filter((r) => r.applicable);
  const passed = applicable.filter((r) => r.passed).length;
  const totalCount = applicable.length;
  const skipped = results.length - totalCount;

  return {
    summary: {
      passed,
      total: totalCount,
      skipped,
      rate: totalCount ? Math.round((passed / totalCount) * 100) : 0,
      allPass: totalCount > 0 && passed === totalCount,
    },
    results,
    category,
    role,
    generatedAt: new Date().toISOString(),
  };
}

/** 供 /api/harness/validate 的探活输出使用。 */
export function describeHarness(): { rules: number; ids: string[]; note: string } {
  return {
    rules: 17,
    ids: [
      "R1 双路渲染一致性",
      "R2 4类专用",
      "R3 角色自适应-领导直观",
      "R4 角色自适应-研发严谨",
      "R5 角色自适应-销售卖点突出",
      "R6 富可视化15组件",
      "R7 8动效",
      "R8 projectId过滤",
      "R9 drag-drop Excel",
      "R10 drag-drop evidence/qualification",
      "R11 role-based Word/HTML/PDF export",
      "R12 Kern调度",
      "R13 审批流",
      "R14 协作@提及+版本历史",
      "R15 证据可信度A/B/C/D",
      "R16 成本计算4类差异化",
      "R17 角色切换+内联样式≤500KB",
    ],
    note: "缺少产物/参数的规则会标记 applicable=false 并单列 skipped，不计入通过率；allPass 表示所有可判规则均通过。",
  };
}
