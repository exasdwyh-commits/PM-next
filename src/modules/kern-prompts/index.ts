/**
 * Kern提示词库统一出口
 * 专业调度 + HTML富可视化规范 + 4类专用 + 角色自适应
 */

export { HTML_RICH_SPEC_PROMPT, HTML_RICH_EXAMPLE_PROMPT } from "./html-spec-prompt";
export { COST_BOM_EXPERT_PROMPT, COST_BOM_EXPERT_TASKS } from "./experts/cost-bom-expert";
export { COMPLIANCE_EXPERT_PROMPT } from "./experts/compliance-expert";
export { SUPPLIER_EXPERT_PROMPT } from "./experts/supplier-expert";
export { MARKETING_EXPERT_PROMPT } from "./experts/marketing-expert";
export { KERN_ORCHESTRATOR_PROMPT, KERN_EXPERT_DISPATCH_PROMPTS, KERN_HTML_SPEC_INTEGRATION } from "./kern-orchestrator-prompt";

// 统一调度提示词生成器
export interface KernDispatchContext {
  category: "regular_food" | "health_food" | "cross_border_food" | "cosmetics" | string;
  role: "leadership" | "product" | "sales" | string;
  productName: string;
  goal: string;
}

export function buildKernExpertPrompt(agentCode: string, context: KernDispatchContext): string {
  const { KERN_EXPERT_DISPATCH_PROMPTS } = require("./kern-orchestrator-prompt");
  const base = KERN_EXPERT_DISPATCH_PROMPTS[agentCode] || "";
  
  const categoryInfo: Record<string, string> = {
    regular_food: "普通食品🍪 #f59e0b，原料0.98+加工1.2+包装1.1+物流4.1+渠道35%零售39.9，SC+标签，性价比",
    health_food: "保健食品💊 #7c3aed，原料8.05+配方0.8+软糖1.5+制造1.8+检测1.2+合规2.5+包装2.4+物流4.2+渠道42%零售199，蓝帽子备案5万摊",
    cross_border_food: "跨境食品🌍 #0891b2，进口原料12+国际物流3.5+关税12%+报关1.2+清关0.8+合规1.5+包装2+物流5.5+渠道45%零售129，进口备案+关税",
    cosmetics: "化妆品💄 #db2777，原料15+配方1.2+制造2.5+灌装1.0+包装8+2+1+5玻璃瓶+检测1.5+安全1+功效1+合规3+物流5+易碎0.5+渠道58%零售299，备案3万+功效",
  };

  const roleInfo: Record<string, string> = {
    leadership: "领导层视角：KPI 3个大数字+一句话结论+进度条+极简卡片3个，隐藏表格细节，成本可控",
    product: "产品研发视角：全部可编辑表格+breakdown+warnings+瀑布图+环形图+柱状赛跑+BOM翻转卡片+时间轴，严谨",
    sales: "销售营销视角：卖点卡片2列+话术+工具箱+供应商雷达+方案对比，工具型，卖点突出",
  };

  return `
${base}

**当前上下文：**
- 类别：${categoryInfo[context.category] || context.category}
- 角色：${roleInfo[context.role] || context.role}
- 产品：${context.productName}
- 目标：${context.goal}

**强制要求：**
- 必须输出富可视化HTML Artifact，15组件+8动效，4类专用，角色自适应，通过harness R1-R17，禁止单薄MD
- 颜色：${context.category === "regular_food" ? "#f59e0b" : context.category === "health_food" ? "#7c3aed" : context.category === "cross_border_food" ? "#0891b2" : "#db2777"}
- 图标：${context.category === "regular_food" ? "🍪" : context.category === "health_food" ? "💊" : context.category === "cross_border_food" ? "🌍" : "💄"}
- 角色：${context.role}

**Harness R1-R17必须0 error，html Block内联样式无外部依赖≤500KB**
`;
}

export function buildKernOrchestratorPrompt(context: KernDispatchContext): string {
  const { KERN_ORCHESTRATOR_PROMPT } = require("./kern-orchestrator-prompt");
  return `
${KERN_ORCHESTRATOR_PROMPT}

**当前任务：**
- 类别：${context.category}
- 角色：${context.role}
- 产品：${context.productName}
- 目标：${context.goal}

**你必须：**
1. 识别意图，类别${context.category}，角色${context.role}
2. 调度专家：cost_bom_agent + compliance_agent + supply_ops_agent + marketing_agent + qa_verifier，全部强制富可视化HTML Artifact
3. 收集结果，Harness校验R1-R17，0 error
4. 双路渲染：左侧对话卡摘要层 + 右侧Artifact面板完整层富可视化15组件+8动效，数据同源
5. 角色自适应，工具下载复制打印保存全屏

**禁止单薄MD，必须富可视化，Claude Web超越版**
`;
}
