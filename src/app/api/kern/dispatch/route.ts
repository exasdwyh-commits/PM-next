/**
 * Kern Expert Dispatch API - P2-1
 * 使用专业调度提示词库，强制富可视化
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/modules/identity/session";
import { handleApiError } from "@/shared/api-handler";
import { buildKernExpertPrompt, buildKernOrchestratorPrompt } from "@/modules/kern-prompts";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const body = await req.json();
    const { goal, category = "health_food", role = "product", productName = "未命名产品", agentCode } = body;

    if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });

    const context = {
      category,
      role,
      productName,
      goal,
    };

    // 如果指定了agentCode，返回该专家的提示词
    if (agentCode) {
      const prompt = buildKernExpertPrompt(agentCode, context);
      return NextResponse.json({
        agentCode,
        prompt,
        context,
        instruction: `调度${agentCode}，强制富可视化HTML Artifact，15组件+8动效，4类专用，通过harness R1-R17，禁止单薄MD`,
      });
    }

    // 否则返回Kern主调度提示词 + 所有专家提示词
    const orchestratorPrompt = buildKernOrchestratorPrompt(context);
    const expertPrompts = {
      cost_bom_agent: buildKernExpertPrompt("cost_bom_agent", context),
      compliance_agent: buildKernExpertPrompt("compliance_agent", context),
      supply_ops_agent: buildKernExpertPrompt("supply_ops_agent", context),
      marketing_agent: buildKernExpertPrompt("marketing_agent", context),
      qa_verifier: buildKernExpertPrompt("qa_verifier", context),
    };

    return NextResponse.json({
      orchestratorPrompt,
      expertPrompts,
      context,
      dispatchPlan: {
        parallel: ["compliance_agent", "supply_ops_agent"],
        sequential: [
          { step: 1, agent: "cost_bom_agent", dependsOn: ["bom", "supplier"], task: "计算4类专用成本，BOM+供应商比价，富可视化" },
          { step: 2, agent: "compliance_agent", task: "合规清单，时间轴+环形进度" },
          { step: 3, agent: "supply_ops_agent", task: "供应商雷达+比价脉冲" },
          { step: 4, agent: "marketing_agent", task: "卖点卡片+话术+工具箱" },
          { step: 5, agent: "qa_verifier", task: "Harness校验R1-R17" },
        ],
        final: "Kern汇总Envelope+富HTML Artifact，左侧对话卡+右侧Artifact数据同源",
      },
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(req);
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || "health_food";
    const role = searchParams.get("role") || "product";
    const productName = searchParams.get("productName") || "多酚软糖";
    const goal = searchParams.get("goal") || "计算成本";

    const context = { category, role, productName, goal } as any;
    const orchestratorPrompt = buildKernOrchestratorPrompt(context);

    return NextResponse.json({
      prompts: {
        orchestrator: orchestratorPrompt,
        html_spec: "HTML富可视化规范：15组件+8动效，4类专用，角色自适应，通过harness R1-R17",
        experts: {
          cost_bom: "Cost & BOM专家：12模块，BOM+供应商，瀑布+环形+柱状+BOM翻转",
          compliance: "Compliance专家：4类清单，时间轴+环形进度",
          supplier: "Supplier专家：雷达+比价脉冲",
          marketing: "Marketing专家：卖点卡片+话术+工具箱",
          qa: "QA Verifier：Harness校验R1-R17",
        },
      },
      context,
      count: 7,
    });
  } catch (error) {
    return handleApiError(error, req);
  }
}
