# Kern 智能角色系统 - 最终交付 2026-10-08

## 用户最新要求
- 可以自动切换，同时可以手动调整，或者和Kern对话让它自己调整
- 核心是主Agent，它是相对智能度比较高的存在，作为助理AI统筹一切
- 我们只是把需要的功能完善，具体能力都是它调用其他专业Agent完成
- 对于Kern本身的需求也要深度研究

## 已实现：智能三切换

### 1. 自动切换 (Auto)
- 关键词识别：老板/总结/决策→领导；证据/研发/验证→产品；卖点/销售/客户→销售
- 页面上下文：overview/decisions→领导；evidence/tasks/rnd→产品；marketing→销售
- Envelope分析：根据 blocks 类型和 meta.suggestedRole 自动推断
- 置信度>0.5生效，保留最近6次推断

### 2. 手动切换 (Manual)
- 点击 RoleSwitcher pill 按钮
- 30分钟内最优先，localStorage `kern.user-role.v1`
- 显示"手动锁定"，可点击"恢复自动"清除

### 3. Kern对话驱动 (Kern)
- 用户说"切换到销售视角" → 正则匹配 ROLE_SWITCH_PATTERNS
- Kern 在 envelope.meta.suggestedRole 建议 → 前端自动切换
- 存储 `kern.kern-role.v1`，10分钟内次优先
- 优先级：手动(30min) > Kern(10min) > 自动(>0.5) > 默认(leadership)

## Kern 深度需求分析

### Kern 需要什么？
1. **上下文感知**：用户角色偏好、页面上下文、对话意图、组织角色、项目阶段、证据状态
2. **能力调度**：根据角色自动选择专业Agent
   - 领导：hermes_pm 直接综合
   - 产品：research_agent, scientific_evidence_agent, compliance_agent, cost_bom_agent, qa_verifier, red_team
   - 销售：marketing_agent, research_agent, cost_bom_agent
3. **输出适配**：同一结论按角色呈现不同形式
4. **记忆学习**：记住偏好，越用越准

### 已实现的技术架构
```
用户输入 → muse-client.tsx send() 检测 role switch intent
  → localStorage kern.kern-role.v1
  → RoleProvider resolveEffectiveRole
  → Kern 后端根据 detectedRole 调度专业Agent
  → 返回 envelope.meta.suggestedRole
  → response-role-based onEnvelope() 自动切换
  → 用户看到对应角色视图
```

### 文件清单
- `src/components/kern-role-intelligence.ts` 纯函数引擎
- `src/components/role-context.tsx` 智能 RoleProvider
- `src/components/role-switch.css` 样式
- `src/app/muse/components/kern-role-bar.tsx` 对话页角色条
- `src/app/muse/response/response-role-based.tsx` Kern驱动版
- `src/components/executive-report-role-based.tsx` 智能版
- `src/app/projects/[id]/components/overview-role-based.tsx` 智能版
- `src/modules/response-format/types.ts` 增加 suggestedRole/audience
- `src/app/muse/muse-client.tsx` 集成角色检测
- `src/app/muse/page.tsx` 包裹 RoleProvider
- `src/app/projects/[id]/page.tsx` 包裹 RoleProvider
- `KERN_DEEP_NEEDS_AND_ROLE_INTELLIGENCE.md` 深度分析
- `src/app/demo-kern-intelligent/page.tsx` 智能演示

### 演示页
- `/demo-report` 项目报告三角色
- `/demo-kern` 对话全形态三角色
- `/demo-kern-intelligent` 智能切换演示 (新增)

### 如何验证
1. 打开 `/muse`，说"切换到销售视角" → 顶部角色条自动切到销售
2. 说"这个证据的可信度怎么样" → 自动切到产品研发
3. 说"一句话总结，现在怎么样了" → 自动切到领导
4. 手动点击"领导" → 锁定30分钟
5. 点击"恢复自动" → 恢复智能

### 下一步可接入后端
- 在 `assistant-runtime/context-builder` 加入 role 检测
- 在 `supervisor/plan.ts` 根据 role 选择 playbook
- 在 `response-format/from-mission.ts` 根据 role 生成不同 blocks
- 接入 `modules/memory` 记住用户偏好

## Patch
- `PM-next-INTELLIGENT-ROLE.patch` 400KB，31文件，5847行新增
- 向后兼容，不改业务语义
- 后端安全优化已包含
