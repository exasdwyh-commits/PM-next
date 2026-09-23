# PM-next v0.1.0-rc1 交付说明

日期：2026-09-23  
交付分支：`release/v0.1.0-rc1`  
冻结提交：`c5285a48ae399c0ca019cd580d3632ded2f85411`  
运行时代码基线：`f05074648d79861f1d57f4218a675ce8bd8b4cae`

## 1. 交付结论

本分支是 PM-next 当前可交付 RC1，专门用于本地同步、演示、验收和 P0/P1 收尾修复。

它冻结在 VNext / Laya 实验层进入 main 之前，避免下一代 Judgment / Cognitive Fabric 研发影响当前稳定交付。

当前远程自动化基线已经通过项目收口文档记录的 8 条核心 CI：
- Quality CI
- Governance CI
- Workforce CI
- Decision CI
- Autopilot CI
- Experience CI
- Business Event CI
- Golden Organization CI

本分支不再接受新功能扩张，只接受交付阻断修复。

## 2. 已包含能力

- Product / ProductVersion / Evidence / Validation
- Product Potential V2 / Hard Gate
- 多渠道 ChannelSpecRoute 与渠道经济性
- G1 研发/打样授权
- G2 正式生产投入授权
- G3 正式上市授权
- Model Control / Model Gateway Runtime / ModelRun provenance
- Autonomous Workforce
- Decision Intelligence / Governance
- Autopilot / Business Event Outbox / Automation Trace
- Evaluation Harness / Experience
- AKG、骆驼奶+AOS、AKK Golden Organization 回归

## 3. 明确不进入 RC1 的内容

以下属于 VNext，不是 RC1 blocker：
- Laya / Judgment Runtime
- Context Governor
- Capability / Skill Router
- Adaptive Intelligence Router L0-L3
- Multi-Lane Coding Orchestration
- Completion Judge / Verification Fabric
- Controlled MoA
- VNext Intelligence / Workforce Control Center
- 手机端专项重构
- 大规模视觉重构

## 4. 本地同步

```bash
git fetch --all --prune
git switch release/v0.1.0-rc1
git pull --ff-only origin release/v0.1.0-rc1
git rev-parse HEAD
npm ci
npx prisma generate
```

预期 HEAD 应位于本交付分支最新提交；其祖先冻结基线必须包含：
`c5285a48ae399c0ca019cd580d3632ded2f85411`

## 5. 交付前最小门禁

```bash
npx prisma migrate deploy
npm run typecheck
npm run lint
npm run build
npm run test:golden
npm run test:potential
npm run test:channel-routes
npm run test:model-gateway
npm run test:model-control
npm run test:model-runtime
npm run test:governance
npm run test:g2
npm run test:g3
npm run test:workforce
npm run test:decision-run
npm run test:autopilot
npm run test:business-events
npm run test:experience
npm run test:golden-org
```

## 6. 人工验收必须项

至少完整走一遍：
1. 登录与组织权限；
2. 新建产品与确认 ProductVersion；
3. Evidence 导入、验证与 Product Potential；
4. 至少两个 Channel Route；
5. G1 研发/打样授权；
6. REAL 生产成果录入；
7. G2 创建、提交、独立审批；
8. 确认 G2 APPROVED 不会自动开工；
9. 执行真实开工；
10. PRODUCTION_RECORD 验收与交付确认；
11. G3 上市授权；
12. Model Control / Workforce / Autopilot / Audit Trace 检查。

## 7. 缺陷处理规则

- P0：必须修复后才能交付。
- P1：核心链路问题必须修复或明确接受。
- P2：记录到下一版本，不阻断 RC1。
- 禁止在 RC1 分支顺手加入 VNext、新模型架构或大规模 UI 重构。

## 8. 相关文档

- `README.md`
- `docs/PROJECT_CLOSEOUT_2026-09-22.md`
- `docs/FINAL_ACCEPTANCE_2026-09-22.md`
- `docs/LOCAL_HANDOFF_2026-09-22.md`
- `docs/FORMAL_G2_PRODUCTION_GATE.md`
- `docs/FORMAL_G3_LAUNCH_GATE.md`

## 9. 发布口径

当前可以称为：
**PM-next v0.1.0-rc1 — Stable Delivery Candidate**

适合：
- 本地部署验收
- 内部演示
- ToB Demo
- 真实业务链试跑
- P0/P1 收尾

完成本地真实数据库、真实 provider 和关键浏览器业务链验收后，可再冻结为正式 v0.1.0。
