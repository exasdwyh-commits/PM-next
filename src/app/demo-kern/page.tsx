import ResponseView from "@/app/muse/response/response-view";
import ResponseViewV2 from "@/app/muse/response/response-view-v2";
import ResponseRoleBased from "@/app/muse/response/response-role-based";
import type { ResponseEnvelope } from "@/modules/response-format/types";

export const dynamic = "force-dynamic";

const mockEnvelopes: { label: string; question: string; envelope: ResponseEnvelope }[] = [
  {
    label: "简单问答 (ANSWER + prose)",
    question: "什么是多酚？",
    envelope: {
      v: 1,
      kind: "ANSWER",
      demo: false,
      lede: "多酚是一类具有抗氧化活性的植物化合物",
      confidence: "HIGH",
      blocks: [
        { type: "prose", title: "定义", body: ["多酚是植物中广泛存在的次生代谢产物，具有抗氧化、抗炎等作用。", "在食品中，多酚的留存率受温度、时间、pH影响较大。"] },
        { type: "keypoints", title: "关键要点", items: [
          { kind: "fact", text: "80度烘焙30分钟留存率约82%，已通过实验室验证" },
          { kind: "inference", text: "推测高温长时间会显著降低留存率" },
          { kind: "unknown", text: "长期储存的衰减曲线尚未测定" },
        ]},
      ],
      meta: { model: "kern-demo", elapsedMs: 1200, steps: 1, quota: { used: 1, limit: 20 }, memoriesUsed: [], sources: 2 },
    },
  },
  {
    label: "对比分析 (ANSWER + table + chart)",
    question: "对比3个供应商的报价",
    envelope: {
      v: 1,
      kind: "ANSWER",
      demo: false,
      lede: "供应商B性价比最高，建议优先考虑",
      confidence: "MEDIUM",
      blocks: [
        { type: "prose", body: ["基于3家供应商的报价，B在价格和交期上最优，但需验证资质。"] },
        { type: "table", title: "供应商对比", cols: [{ label: "供应商" }, { label: "单价", num: true }, { label: "交期" }, { label: "MOQ", num: true }], rows: [
          { cells: ["供应商A", "¥11.2", "30天", "1000"], pick: false },
          { cells: ["供应商B", "¥10.2", "25天", "1000"], pick: true },
          { cells: ["供应商C", "¥12.5", "20天", "2000"], pick: false },
        ]},
        { type: "chart", title: "价格对比", label: "单价", unit: "元", series: [{ label: "A", value: 11.2 }, { label: "B", value: 10.2, hi: true }, { label: "C", value: 12.5 }], source: "供应商报价单" },
      ],
      meta: { model: "kern-demo", elapsedMs: 2300, steps: 2, quota: { used: 2, limit: 20 }, memoriesUsed: [], sources: 3 },
    },
  },
  {
    label: "决策卡 (CONCLUSION + decision)",
    question: "是否应该进入打样？",
    envelope: {
      v: 1,
      kind: "CONCLUSION",
      demo: false,
      lede: "建议进入打样，风险可控，收益明确",
      confidence: "MEDIUM",
      blocks: [
        { type: "prose", body: ["基于当前6条已核实结论，配方可行性高，成本可控，最大风险是供应链单一。"] },
        { type: "decision", headline: "是否进入打样", confidence: "MEDIUM", recommend: ["配方可行性A级，已通过实验室验证", "成本10.2元在预算内", "市场需求增长23%"], against: ["供应链单一，仅1家供应商", "华南销量未验证"], risks: ["供应商断供", "华南市场不接受"] },
      ],
      ask: { question: "是否批准1000盒打样？", why_you: "涉及预算和供应链风险，需要你拍板", options: [{ label: "批准打样", consequence: "进入打样阶段，生成后续任务" }, { label: "暂缓，先补证据", consequence: "停留在当前阶段" }, { label: "拒绝", consequence: "项目回到草稿" }] },
      meta: { model: "kern-demo", elapsedMs: 5400, steps: 5, quota: { used: 5, limit: 20 }, memoriesUsed: ["预算上限5万"], sources: 6 },
    },
  },
];

export default function DemoKernPage() {
  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto", display: "grid", gap: 40 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Kern 对话全形态 - 三角色优化演示</h1>
        <p style={{ color: "#666", lineHeight: 1.7, fontSize: 14 }}>
          按你最新要求：<strong>领导层直观 / 产品研发专业严谨可信度第一工具丰富 / 销售营销卖点突出工具型</strong><br />
          每种问题，Kern 会输出不同形态（表格、图表、决策卡等），现在每种形态都按三角色重构。
        </p>
      </header>

      <section style={{ padding: 16, background: "#f0f2f6", borderRadius: 12, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>🎯 三角色定义</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ background: "white", padding: 12, borderRadius: 10, border: "1px solid #e7e9ef" }}>
            <strong>👔 领导层 · 直观</strong><br />一页看懂结论，KPI卡片，图表，极简决策，无学术术语，10秒决策
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 10, border: "1px solid #e7e9ef" }}>
            <strong>🔬 产品研发 · 严谨</strong><br />专业严谨，可信度第一，工具流程丰富，证据溯源、验证计划、QA轨迹、成本计算
          </div>
          <div style={{ background: "white", padding: 12, borderRadius: 10, border: "1px solid #e7e9ef" }}>
            <strong>💼 销售营销 · 卖点</strong><br />卖点突出，工具型，销售支撑，竞品对比、市场数据、一键生成PPT/话术
          </div>
        </div>
      </section>

      {mockEnvelopes.map((item, idx) => (
        <section key={idx} style={{ display: "grid", gap: 16, borderTop: idx === 0 ? "none" : "1px solid #eee", paddingTop: idx === 0 ? 0 : 32 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>{idx + 1}. {item.label}</h2>
            <p style={{ fontSize: 13, color: "#666", background: "#f6f6f6", padding: "6px 10px", borderRadius: 8, width: "fit-content" }}>用户问：{item.question}</p>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "#999" }}>现有 V1</h3>
              <ResponseView envelope={item.envelope} />
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "#2563eb" }}>V2 领导友好 (B直观)</h3>
              <ResponseViewV2 envelope={item.envelope} defaultView="leadership" />
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: "#0f1116" }}>V3 三角色版 (领导/产品/销售) ← 最新</h3>
              <ResponseRoleBased envelope={item.envelope} role="leadership" />
            </div>
          </div>
        </section>
      ))}

      <section style={{ padding: 20, background: "#0f1116", color: "white", borderRadius: 16, display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>✅ 三角色优化总结</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, fontSize: 12, lineHeight: 1.7 }}>
          <div>
            <strong>👔 领导层 · 直观</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              <li>一句话结论 24px衬线</li>
              <li>4张KPI卡片</li>
              <li>卡片式依据，非表格</li>
              <li>环形图+条形图</li>
              <li>去学术化图标</li>
            </ul>
          </div>
          <div>
            <strong>🔬 产品研发 · 严谨</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              <li>完整表格，数字右对齐</li>
              <li>证据溯源+信任度</li>
              <li>验证计划+时间线+QA轨迹</li>
              <li>工具流程丰富</li>
              <li>可信度第一</li>
            </ul>
          </div>
          <div>
            <strong>💼 销售营销 · 卖点</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              <li>卖点突出卡片</li>
              <li>竞品对比高亮优势</li>
              <li>市场机会图表</li>
              <li>一键生成PPT/话术</li>
              <li>销售工具支撑</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
