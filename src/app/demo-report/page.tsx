import { ExecutiveReportView } from "@/components/executive-report";
import { ExecutiveReportV2 } from "@/components/executive-report-v2";
import { ExecutiveReportRoleBased } from "@/components/executive-report-role-based";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";

export const dynamic = "force-dynamic";

const mockReport: ExecutiveReportPayload = {
  title: "低糖多酚麦片 - 产品研发管理报告",
  summary: "建议进入打样，配方可行性高，成本10.2元/盒，供应链单一为最大风险，需补华南销量验证后推进G1。基于6条结论，4条已核实，67%高可信。",
  verificationStatus: "READY_FOR_HUMAN_REVIEW",
  contentVersion: 3,
  createdAt: new Date().toISOString(),
  artifactId: "demo-artifact",
  conclusions: [
    { claim: "80度烘焙30分钟多酚留存率 82%", claimKind: "FACT", evidenceLevel: "A", evidenceRef: "实验室报告 #2026-08", freshness: "7天内", verificationRefs: ["v1", "v2"] },
    { claim: "目标人群 25-45岁女性肠道健康需求增长 23%", claimKind: "FACT", evidenceLevel: "A", evidenceRef: "蝉妈妈数据", freshness: "15天内", verificationRefs: ["v1"] },
    { claim: "预估生产成本 10.2元/盒 (含包装)", claimKind: "ESTIMATE", evidenceLevel: "B", evidenceRef: "供应商报价", freshness: "3天内", verificationRefs: [] },
    { claim: "合规宣称“高纤维”符合 GB 28050", claimKind: "FACT", evidenceLevel: "A", evidenceRef: "法规库", freshness: "30天内", verificationRefs: ["v1"] },
    { claim: "竞品均价 299元/盒，价格带可行", claimKind: "INFERENCE", evidenceLevel: "B", evidenceRef: "市场调研", freshness: "10天内", verificationRefs: [] },
    { claim: "包装材质可降解，符合品牌调性", claimKind: "OPINION", evidenceLevel: "C", evidenceRef: "设计稿", freshness: "5天内", verificationRefs: [] },
  ],
  risks: ["供应链单一，仅1家核心原料供应商", "华南市场销量未验证，爆品跟进需谨慎"],
  unknowns: ["华南地区实际销量", "长期储存多酚衰减数据"],
  decisionsRequired: ["是否批准1000盒打样预算", "是否接受当前单一供应商风险"],
  recommendedActions: ["补华南渠道销量证据", "引入第二供应商报价", "进行90天留存稳定性测试"],
  assumptions: ["假设目标人群对价格敏感度中等", "假设当前法规不变"],
  advisoryNotes: [
    { agentCode: "market", agentName: "市场研究", status: "COMPLETED", summary: "低糖趋势明确，建议切入" },
    { agentCode: "science", agentName: "科学证据", status: "COMPLETED", summary: "多酚留存数据充分" },
    { agentCode: "cost", agentName: "成本", status: "COMPLETED", summary: "成本可控，需二供" },
  ],
  provenance: {
    sourceRefs: ["实验室报告", "蝉妈妈", "供应商A", "法规库"],
    agentRunRefs: ["run-1", "run-2"],
    modelRunRefs: ["model-1"],
    knowledgeDebtRefs: [],
    researchSnapshotRef: "snapshot-2026-10-08",
  },
};

export default function DemoReportPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto", display: "grid", gap: 32 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>PM-next 三角色优化演示</h1>
        <p style={{ color: "#666", lineHeight: 1.6, fontSize: 14 }}>
          按你最新要求：<strong>领导层直观 / 产品研发专业严谨可信度第一工具丰富 / 销售营销卖点突出工具型</strong><br />
          下方展示 V1现有 vs V2三视图 vs V3三角色专业版
        </p>
      </header>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>V3 - 三角色专业版 (最新) 👔领导直观 / 🔬研发严谨 / 💼销售卖点</h2>
        <p style={{ fontSize: 12, color: "#666", background: "#f6f7f9", padding: "8px 12px", borderRadius: 8 }}>
          领导层：KPI卡片+一句话结论+卡片式依据 | 产品研发：完整表格+证据溯源+工具流程丰富 | 销售营销：卖点提炼+竞品对比+一键生成PPT/话术
        </p>
        <ExecutiveReportRoleBased report={mockReport} defaultRole="leadership" />
      </section>

      <section style={{ display: "grid", gap: 12, borderTop: "1px solid #eee", paddingTop: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>V2 - 三视图版 (B/C/A)</h2>
        <ExecutiveReportV2 report={mockReport} projectTitle="低糖多酚麦片" viewMode="all" />
      </section>

      <section style={{ display: "grid", gap: 12, borderTop: "1px solid #eee", paddingTop: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#999" }}>V1 - 现有版本</h2>
        <ExecutiveReportView report={mockReport} />
      </section>
    </div>
  );
}
