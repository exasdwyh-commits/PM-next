# Kern 深度需求分析与智能角色系统 - 2026-10-08

## 核心定位

**Kern 是高智能主Agent，统筹一切**。我们只是完善它需要的功能，具体能力都是它调用其他专业Agent完成的。

```
用户 → Kern (主Agent) → 调度专业Agent → 综合输出 → 按角色呈现
         │
         ├─ research_agent (市场/竞品)
         ├─ scientific_evidence_agent (论文/临床)
         ├─ product_agent (产品定义)
         ├─ formulation_agent (配方)
         ├─ compliance_agent (合规)
         ├─ cost_bom_agent (成本)
         ├─ marketing_agent (营销)
         ├─ ops_agent (供应/生产)
         ├─ red_team (证伪)
         └─ qa_verifier (独立复核)
```

## Kern 自身的深度需求

### 1. 上下文感知 (Context Awareness)
Kern 需要知道：
- **用户角色偏好**：历史选择、手动锁定、自动识别
- **当前页面上下文**：总览/证据/营销/成本/决策
- **对话意图**：问卖点 vs 问证据 vs 问决策
- **组织角色**：OrgRole (ORG_ADMIN/MEMBER)
- **项目阶段**：立项/研发/上市/归档
- **证据状态**：已核实数量、可信度分布、缺口数量

**实现**：
- `kern-role-intelligence.ts` 纯函数，关键词匹配 + 页面上下文 + envelope分析
- `RoleProvider` 存储 manual/kern/auto 三层角色
- `useKernRoleIntelligence` hook 监听用户输入和 envelope

### 2. 能力调度 (Capability Orchestration)
Kern 需要根据角色自动选择调用哪些专业Agent：

| 用户角色 | Kern 调度策略 | 调用Agent |
|---------|--------------|-----------|
| 领导层 | 直接综合，不展开细节，10秒决策 | hermes_pm 直接综合 |
| 产品研发 | 深度研究，证据溯源，工具流程丰富 | research_agent, scientific_evidence_agent, compliance_agent, cost_bom_agent, qa_verifier, red_team |
| 销售营销 | 提炼卖点，客户价值，竞品对比 | marketing_agent, research_agent, cost_bom_agent |

**实现**：
- `KERN_NEEDS` 常量定义 Kern 需要的能力
- 前端工具按钮只是 Kern 能力的入口，实际调用由 Kern 在后端完成
- `office-export.ts` 动态导入，Kern 按需生成 PPT/Word

### 3. 输出适配 (Output Adaptation)
同一份结论，Kern 需要按角色输出不同形式：

**领导层 · 直观**：
- 一句话结论 24px
- 4张KPI卡片
- 卡片式依据，非表格
- 环形图+条形图
- 去学术化图标，10秒决策

**产品研发 · 严谨**：
- 完整表格，数字右对齐
- 证据溯源+信任度 A/B/C/D
- 验证计划+时间线+QA轨迹
- 工具流程丰富
- 可信度第一，UNKNOWN保持

**销售营销 · 卖点**：
- 卖点突出卡片，客户价值映射
- 竞品对比高亮优势
- 市场机会图表
- 一键生成PPT/话术/对比/报价
- 销售工具支撑

**实现**：
- `executive-report-role-based.tsx` 三视图
- `response-role-based.tsx` 12种Block × 3角色
- `overview-role-based.tsx` 总览三角色
- 每个组件都有 `data-role` 属性，CSS 按角色适配

### 4. 智能切换 (Intelligent Switching)

**三种切换方式**：

1. **自动**：
   - 关键词：老板/总结/决策 → 领导；证据/研发/验证 → 产品；卖点/销售/客户 → 销售
   - 页面：overview/decisions → 领导；evidence/tasks/rnd → 产品；marketing/launch → 销售
   - Envelope：根据 blocks 类型和 meta.suggestedRole 自动推断
   - 置信度 >0.5 才生效

2. **手动**：
   - 用户点击 RoleSwitcher pill 按钮
   - 30分钟内优先，localStorage持久化 `kern.user-role.v1`
   - 可点击"恢复自动"清除锁定

3. **Kern对话驱动**：
   - 用户说"切换到销售视角" → 正则匹配 `ROLE_SWITCH_PATTERNS`
   - Kern 在 `envelope.meta.suggestedRole` 中建议角色 → 前端自动切换
   - 存储在 `kern.kern-role.v1`，10分钟内优先

**优先级**：手动(30min) > Kern建议(10min) > 自动(置信度>0.5) > 默认(leadership)

**实现**：
```ts
resolveEffectiveRole({ manualRole, kernRole, autoRoles, defaultRole })
```

### 5. 记忆与学习 (Memory & Learning)
Kern 需要记住：
- 用户历史角色偏好
- 哪些类型的问题用户常问
- 项目阶段变化时角色自动调整

**实现**：
- localStorage 存储手动和Kern角色
- autoRoles 数组保留最近6次推断
- 后续可接入 `modules/memory` 存储到后端

## 技术架构

### 文件清单
```
src/components/
  kern-role-intelligence.ts      # 纯函数，角色推断引擎
  role-context.tsx               # 智能 RoleProvider，支持三层优先级
  role-switch.css                # 切换器样式
  executive-report-role-based.tsx # 项目报告三角色
  executive-report-role.css
  role-context.tsx (enhanced)    # 智能版

src/app/muse/
  components/kern-role-bar.tsx   # 对话页角色条
  response/response-role-based.tsx # 对话全形态三角色 + Kern驱动
  muse-client.tsx (patched)      # 集成角色检测到 send
  page.tsx (patched)             # 包裹 RoleProvider

src/app/projects/[id]/
  components/overview-role-based.tsx # 总览三角色 + Kern提示
  page.tsx (patched)             # 包裹 RoleProvider
  project-detail-client.tsx (patched) # 总览使用智能版

src/modules/response-format/
  types.ts (patched)             # Meta 增加 suggestedRole/audience
```

### 数据流
```
用户输入 "切换到销售视角，这个卖点怎么讲？"
  ↓
muse-client.tsx send() 检测到 detectRoleSwitchIntent → sales
  ↓
localStorage kern.kern-role.v1 = { role: sales, reason: "对话指令" }
  ↓
RoleProvider resolveEffectiveRole → sales (kern, 10min TTL)
  ↓
Kern 后端根据 detectedRole=sales 调度 marketing_agent + cost_bom_agent
  ↓
返回 envelope.meta.suggestedRole = sales, roleConfidence=0.9
  ↓
response-role-based.tsx onEnvelope() → 自动切换到销售视图
  ↓
用户看到：卖点卡片 + 竞品对比 + 销售工具箱
```

## Kern 的下一步能力 (待实现)

### 1. 后端角色感知
- 在 `assistant-runtime` 的 `context-builder` 中加入 role 检测
- 在 `supervisor/plan.ts` 的 `decideMissionLaunch` 中根据 role 选择不同的 playbook
- 在 `response-format/from-mission.ts` 中根据 role 生成不同的 blocks 组合

### 2. 专业Agent的角色化输出
- 每个专业Agent返回结果时，标注 `suggestedRole`
- 例如 `marketing_agent` 默认 `sales`，`qa_verifier` 默认 `product`
- Kern 综合时，取多数Agent的建议角色作为最终 suggestedRole

### 3. 工具的角色化
- 领导层：工具隐藏，只显示结论和决策
- 产品研发：工具全部展开，显示调用轨迹
- 销售营销：工具转为销售工具箱，一键生成

### 4. 学习优化
- 记录用户每次手动切换，分析模式
- 例如用户在 overview 总是切到领导，在 evidence 总是切到产品 → 自动学习
- 接入 `modules/memory` 的 `rememberForUser`

## 验证方式

### 手动测试
1. 打开 `/muse`，说"切换到销售视角" → 顶部角色条自动切到销售
2. 说"这个证据的可信度怎么样" → 自动切到产品研发
3. 说"一句话总结，现在怎么样了" → 自动切到领导
4. 手动点击"领导"按钮 → 锁定30分钟，显示"手动锁定"
5. 点击"恢复自动" → 恢复智能识别

### 自动测试
```ts
// kern-role-intelligence.ts 是纯函数，可单元测试
detectRoleSwitchIntent("切换到销售视角") === "sales"
inferRoleFromText("这个卖点怎么向客户介绍") → { role: "sales", confidence: >0.6 }
inferRoleFromPage("overview") → { role: "leadership" }
```

## 总结

Kern 作为高智能主Agent，核心需求是：
1. **上下文感知**：知道用户是谁、在哪、问什么
2. **能力调度**：根据角色自动选择专业Agent
3. **输出适配**：同一结论按角色呈现不同形式
4. **智能切换**：自动+手动+对话驱动，三层优先级
5. **记忆学习**：记住偏好，越用越准

我们已实现前端智能角色系统，后端可在 `assistant-runtime` 和 `supervisor` 中进一步接入 `kern-role-intelligence` 的逻辑，让 Kern 真正成为统筹一切的助理AI。
