"use client";

import { RoleProvider } from "@/components/role-context";
import { CostCalculatorModular } from "@/components/cost-calculator-modular";

export default function Page() {
  return (
    <RoleProvider>
      <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", display: "grid", gap: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>模块化成本计算器 · 4类专用：普通食品/保健食品/跨境食品/化妆品</h1>
        
        <div style={{ padding: 16, background: "#f6f7f9", borderRadius: 12, display: "grid", gap: 12 }}>
          <h3>🎯 4类专用模板</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 12 }}>
            <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
              <strong>🍪 普通食品</strong><br/>
              原料+加工+包装+检测+物流+渠道<br/>
              SC认证，成本较低<br/>
              零售价39.9，佣金20%
            </div>
            <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
              <strong>💊 保健食品</strong><br/>
              原料+配方+软糖/胶囊+检测+蓝帽备案+包装+物流+渠道<br/>
              备案5-20万需摊销<br/>
              零售价199，佣金25%
            </div>
            <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
              <strong>🌍 跨境食品</strong><br/>
              进口原料+国际物流+关税12%+清关+中文标签+检测+包装+物流+渠道<br/>
              关税+清关关键<br/>
              零售价129，佣金22%
            </div>
            <div style={{ background: "white", padding: 12, borderRadius: 8, border: "1px solid #e7e9ef" }}>
              <strong>💄 化妆品</strong><br/>
              原料+配方+灌装+包材(玻璃瓶)+安全/功效检测+备案+包装+物流+渠道<br/>
              包材贵，检测多<br/>
              零售价299，佣金30%
            </div>
          </div>
        </div>

        <CostCalculatorModular productName="多酚低糖软糖" productCategory="保健食品" />

        <div style={{ padding: 16, background: "#0f1116", color: "white", borderRadius: 12, display: "grid", gap: 12 }}>
          <h3>✅ 4类专用能力</h3>
          <ul style={{ fontSize: 12, lineHeight: 1.8, margin: 0, paddingLeft: 16 }}>
            <li>普通食品：SC认证，原料+加工+包装+物流，成本较低</li>
            <li>保健食品：蓝帽子备案/注册(5-20万摊销)+功能检测+软糖/胶囊剂型，多酚82%留存</li>
            <li>跨境食品：国际物流3.5+关税12%+报关1.2+清关0.8+中文标签0.5+保税仓</li>
            <li>化妆品：包材玻璃瓶5元+安全检测+功效检测+备案3万+功效宣称</li>
            <li>每个模板字段可配置，模块可启用/禁用，成本结构灵活</li>
            <li>角色化：领导KPI+一句话，产品全部可编辑，销售利润话术</li>
          </ul>
        </div>
      </div>
    </RoleProvider>
  );
}
