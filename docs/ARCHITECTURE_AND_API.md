# HERMES-Next: 架构与接口说明文档 (P0)

日期：2026-09-07  
适用范围：`hermes-next/` (B01 研发打样门可运行骨架)

---

## 1. 系统总体架构

系统采用 Next.js (App Router) + TypeScript + React 19 + Prisma + PostgreSQL 17 的单应用模块化分层架构：

```text
hermes-next/
├── src/
│   ├── app/                      # Next.js App Router (UI 页面与 REST API 路由)
│   │   ├── api/                  # 11 个标准 RESTful 端点
│   │   ├── projects/[id]/        # 项目详情、打样门决策包审查看板
│   │   ├── page.tsx              # 负责人工作台看板
│   │   └── layout.tsx            # 全局响应式布局
│   ├── modules/                  # 严格模块边界服务层
│   │   ├── identity/             # 会话提取、服务端鉴权、角色矩阵防御
│   │   ├── projects/             # 项目模式、阶段流转模型、并发 revision
│   │   ├── products/             # 产品定义、不可变产品版本
│   │   ├── work/                 # 任务安排、迟到输入隔离、人工/TEST运行回执
│   │   ├── evidence/             # 真实数据与 DEMO 证据隔离、哈希存证
│   │   ├── collaboration/        # 反馈闭环、负责人处置与立项修订
│   │   ├── decisions/            # 研发打样门、结构化 scopeHash、冻结快照、不可篡改决策
│   │   ├── intelligence/         # 边界契约 (后续包)
│   │   ├── economics/            # 边界契约 (后续包)
│   │   ├── supply/               # 边界契约 (后续包)
│   │   ├── rules/                # 边界契约 (后续包)
│   │   └── jarvis/               # 只读企业事实投影约定
│   └── shared/                   # 基础设施
│       ├── db.ts                 # Prisma Client 单例
│       ├── audit.ts              # 强审计日志助手 (与关键业务同事务)
│       ├── idempotency.ts        # Idempotency-Key 并发防重放控制
│       ├── errors.ts             # 标准领域错误类
│       └── api-handler.ts        # 统一 API 错误与请求追踪响应
└── prisma/
    └── schema.prisma             # 15 张核心表结构定义
```

---

## 2. 核心 REST API 契约与语义

统一错误响应格式：
```json
{
  "code": "ERROR_CODE",
  "message": "错误具体描述",
  "fieldErrors": { "fieldName": ["字段错误描述"] },
  "requestId": "uuid"
}
```
HTTP 状态码对照：
- 401: 未认证
- 403: 越权操作（如负责人尝试自批打样门、浏览者尝试修改数据、生产环境启用 Mock Auth）
- 404: 资源不存在或跨租户隔离
- 409: 冲突（`expectedRevision` 版本并发冲突、scopeHash 失效、同幂等键篡改负载）
- 422: 业务规则阻断（缺少真实市场依据、缺少明确预算范围、固定产品未选确认版本）
- 500 / 503: 服务端内部异常 / 依赖不可用

### API 清单

1. `POST /api/projects`
   - 创建新项目。
   - 参数：`title`, `target`, `mode` (`NEW_PRODUCT` / `FIXED_PRODUCT`), `decisionMakerId`, `productVersionId` (固定产品必需)。
2. `GET /api/projects/:id`
   - 获取项目详情。仅限项目成员；返回打样门缺口诊断 (`gaps`) 及批准有效性。
3. `PATCH /api/projects/:id`
   - 修改项目目标与约束。必须携带 `expectedRevision` 作并发乐观锁控制。
4. `POST /api/projects/:id/work-items`
   - 负责人安排任务。参数：`title`, `target`, `deliverableReq`, `executorType`。
5. `POST /api/work-items/:id/submissions`
   - 提交任务成果。支持运行模式标记 (`MANUAL` / `TEST_STUB`)。若 `inputRevision` 过期则作为历史回执保留，不覆盖当前成果 (A09)。
6. `POST /api/work-items/:id/reviews`
   - 负责人检查验收成果。参数：`accepted: boolean`, `reason: string`。退回进入 `CHANGES_REQUESTED`。
7. `POST /api/projects/:id/feedback`
   - 提交方案反馈。反馈者与项目成员可用，浏览者禁写 (403)。
8. `POST /api/feedback/:id/disposition`
   - 负责人处置反馈。状态：`ACCEPTED` / `REJECTED` / `NEEDS_INFO`。采纳时可联动生成修订任务。
9. `POST /api/projects/:id/decision-packets`
   - 负责人起草打样门决策包。自动计算规范化 `scopeHash`。
10. `POST /api/decision-packets/:id/submit`
    - 冻结快照，状态转为 `IN_REVIEW`。
11. `POST /api/decision-packets/:id/decide`
    - 指定决策人执行裁决。支持 `Idempotency-Key`。
    - 若批准 (`APPROVE`)：单事务内原子更新决策包、追加决策记录、项目推进至 `SAMPLING`、生成首个打样准备任务并记录审计。

---

## 3. 核心机制设计

### 3.1 结构化 scopeHash 计算
不对页面富文本计算，而是对排序后的核心结构化元数据计算 SHA-256：
- `projectId`, `gate`, `productVersionId`
- 按 `type` 与 `version` 排序的 `artifactVersions`
- 按 `id` 与 `hash` 排序的 `evidenceVersions`
- `budgetAmount`, `budgetCurrency`, `budgetScope`, `validationPlan`

### 3.2 研发打样门守门规则
- **防自批**：`session.userId === project.ownerId` $\to$ 抛出 403 Forbidden。
- **市场依据**：必须包含核实通过的依据；若引用 `DEMO` 证据而项目为 `REAL` $\to$ 抛出 422 强行阻断 (A10)。
- **预算范围**：必须明确预算金额与具体授权动作范围，严禁“无限授权”草率放行。
