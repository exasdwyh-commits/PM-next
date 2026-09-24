# PM-next 本地部署验收报告（2026-09-25）

基线：`main @ 7fca8ffd`（Merge PM OS fusion: Department Assistant + governed Product R&D）
机器：macOS（Apple Silicon），Node 22.22.2，PostgreSQL 17.10（Postgres.app，独立实例 127.0.0.1:5433）

---

## A. 部署结果

| 项目 | 结果 | 说明 |
|---|---|---|
| 安装（npm ci） | **PASS** | 依赖完整安装 |
| PostgreSQL | **PASS** | Postgres.app 17.10，独立数据目录 `.pgdata_hermes_next`，端口 5433，`hermes_app`/`hermes_test` 最小权限角色分离 |
| Migration | **PASS** | `prisma migrate deploy` 在开发库与测试库均成功；`pm_os_fusion_core` / `evidence_source_capture` / `product_rnd_active_uniqueness` 三份融合迁移全部应用；数据库级部分唯一索引 `WorkItem_one_active_product_rnd_per_project` 已验证存在 |
| Seed | **PASS** | 3 个样例项目 + 种子账号（zhang_pm / li_vp / wang_eval @hermes.test，口令仅在 seed 控制台输出一次，不入 Git） |
| Dev server | **PASS** | `npm run dev` @ 3100，全链路 API 全 200，无持续 500，无 Prisma 连接异常 |
| Production build | **PASS** | `next build` 成功（21s，全部路由编译） |

## B. 核心能力

| 能力 | 结果 | 验证方式 |
|---|---|---|
| Workforce bootstrap | **PASS** | 连续两次 `POST /api/workforce/bootstrap`，HTTP 201×2；落库仍为 11 Agent / 11 Skill / 19 AgentSkill / 1 Squad(product_core) / 11 SquadMember，hermes_pm 仅 1 个，幂等成立 |
| Department Assistant | **PASS** | hermes_pm 父任务 RUNNING 统筹，子任务全部 return 后自动推进 |
| Product R&D START | **PASS** | 真实项目「女性餐前轻体饮」：1 WorkItem + 1 父任务 + 5 专业子任务 + 1 ResearchRun，结构精确匹配 |
| 并发/重复 START 防护 | **PASS** | 并发双击：#1=201，#2=**409 Conflict**（"bootstrap is still in progress; retry"）；顺序重复：201 `reused:true` 复用同一 WorkItem；唯一约束在数据库层兜底 |
| 5 专业数字员工 | **PASS** | research / scientific_evidence / formulation / compliance / cost_bom 全部 start+finish 成功，AgentRun 摘要持久化 |
| ResearchRun | **PASS** | 轮询驱动 2 次即 PUBLISHED；未 PUBLISHED 时 RECONCILE 返回 WAITING_RESEARCH（不提前 QA） |
| Evidence SourceCapture | **PASS** | 拒绝空/伪造 captureId；只认服务端持久化抓取回执（sourceUri/hash/trustTier/injectionStatus） |
| Independent Verifier | **PASS** | 跨项目/跨组织 capture 拒绝；规则验证永不产生 VERIFIED；同源组织双 URL 不得 STRONG |
| Independent QA | **PASS** | 5 专业任务终态 + ResearchRun PUBLISHED 后 qa_verifier **自动排队**；QA 成功才放行合成 |
| Executive Report | **PASS** | QA 成功后自动生成 `PRODUCT_RND_EXECUTIVE_REPORT` v1，WorkItem→SUBMITTED，父任务/父 Run 自动 SUCCEEDED；报告状态 READY_FOR_HUMAN_REVIEW 等人审 |
| Gate Governance | **PASS** | G1/G2 均"未建档"，报告通过也不自动批准；决策包需负责人起草、独立决策人裁决、负责人禁止自批 |
| Laya Shadow | **PASS** | `service.py` py_compile 通过；/health /version 正常；/v1/systemone 返回 typed answers（multilingual checkpoint 按汉字脚本自动路由，confidence=0.0045 仅作路由）；abstained=true → 一律 ESCALATE 不 AUTO；HIGH/CRITICAL 风险永不自动（policy-gate.ts 硬编码） |
| Muse Slot | **PASS / NOT CONFIGURED** | preset 5 槽位全部 `enabled=false`（safe-off），muse-local/muse-glimmer LOCAL 槽存在且禁用；`MODEL_PROVIDER_MUSE_LOCAL_BASE_URL` 保持空；系统不因模型未配置崩溃 |

## C. 实际发现的 Bug

### Bug 1：测试库缺少融合迁移
- **问题**：`test:product-rnd-fusion` 首跑报 `Evidence.sourceType does not exist`（P2022）
- **根因**：开发库跑了 `migrate deploy`，测试库 `hermes_next_test` 从未应用融合迁移
- **修改文件**：无代码修改（部署问题）
- **修复方式**：对测试库执行 `DATABASE_URL=<TEST_DATABASE_URL> npx prisma migrate deploy`
- **验证**：重跑 `npm run test:product-rnd-fusion` 全绿
- **commit**：无（环境操作）

### Bug 2：product-rnd-fusion 测试清理 FK 冲突
- **问题**：测试主体通过，但清理时报 `AuditEvent_actorId_fkey`、`ResearchRun_createdById_fkey` 违规，组织删不掉，测试库残留脏数据
- **根因**：`AuditEvent.actor` / `ResearchRun.createdBy` / `WorkSubmission.submittedBy` / `AgentRun.user` 对 User 均无级联删除；审计记录按设计不随主体级联消失，测试清理必须按 FK 安全顺序显式删子表
- **修改文件**：`tests/product-rnd-fusion.ts`
- **修复方式**：按 `regression-workforce-kernel.ts` 的既有模式，先删 workSubmission / auditEvent / researchRun / agentRun / analysisRun，再删组织
- **验证**：重跑 `npm run test:product-rnd-fusion`，主链 + 清理均无报错
- **commit**：见本次提交

### Bug 3：typecheck 被陈旧 `.next` 构建产物污染
- **问题**：`npm run typecheck` 报 7 个 TS2307，引用 main 上不存在的 kernel 路由文件
- **根因**：旧分支遗留的 `.next/types` 生成物引用已删除的 `src/app/api/kernel/*`、`src/app/product-rnd/*`
- **修复方式**：删除 `.next` 重新生成（构建缓存，非用户数据）
- **验证**：typecheck / lint / build 三项全 PASS
- **commit**：无（构建缓存清理）

## D. 未完成项（非代码 Bug）

- **Muse Glimmer 本地模型未部署**：无本地 OpenAI-compatible 服务，槽位按设计保持 safe-off
- **第三方真实 LLM Provider 未配置**：Advisor/Agnes 等无 API Key，保持 disabled
- **Laya workload benchmark / calibration 未做**：Laya 保持 Shadow，不能升级 AUTO（这是设计内状态，非缺陷）
- **UI 报告呈现为原始 JSON**：Executive Report 在项目页以 JSON 文本展示，非技术负责人可读性一般（见下一步建议）
- **npm audit 风险提示**：非 required gate，对外暴露部署前需单独复核

## E. 最终判断

1. **是否可作为本地可交付 Demo**：**可以**。部署、主链、治理、证据边界全部真实跑通，当前机器可直接 `npm run dev` 演示。
2. **Product R&D 主链是否真实跑通**：**是**。START→5 路专业→ResearchRun PUBLISHED→独立 QA→Executive Report→父任务自动关闭→人审→G1/G2 冻结，全链在本机 API + UI 双通道验证。
3. **是否存在阻断部署的问题**：**无**。所有部署问题（测试库迁移、陈旧构建缓存）已解决。
4. **是否存在阻断客户演示的问题**：**无阻断**。唯一影响体验的是报告 JSON 直出与无真实 LLM（数字员工输出为确定性规则合成，口径诚实标注）。
5. **下一步最值得做的 3 件事**：
   - **Executive Report 结构化渲染**：把 JSON 报告按 summary / conclusions / unknowns / risks / decisionsRequired 分区呈现，落实 Report-first 原则
   - **UI 内驱动 ResearchRun 轮询**：目前研究推进依赖 `GET /api/research-runs/[runId]` 轮询接管，前端尚未接入，演示时需 API 手动驱动
   - **接入一个真实本地模型（Muse 或其他 OpenAI-compatible）**：让专业数字员工输出从规则合成升级为真实生成，同时保持 safe-off 治理不变
