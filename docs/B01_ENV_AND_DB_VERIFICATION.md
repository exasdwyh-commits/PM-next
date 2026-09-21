# HERMES-Next 环境配置与数据库验证记录 (B01)

日期：2026-09-07  
执行基线：`docs/HERMES_Gemini_执行包_P0_2026-09-07.md`

---

## 1. 端口与进程隔离检查

- **原有 5432 端口保留情况**：
  - 进程信息：`Python` (PID: 27280, USER: exasdwyh) 持续监听 `*:postgresql (5432)`。
  - 处理动作：**完整保留，未发送任何终止信号，未修改其配置**。
- **新版独立实例端口**：
  - 端口号：**5433**（经过 `lsof -i :5433` 验证处于完全空闲状态后绑定）。
  - 进程信息：`postgres` (PID: 41137) 监听 `localhost:5433`。

---

## 2. 独立 PostgreSQL 实例配置

- **PostgreSQL 工具链与引擎版本**：
  - 工具路径：`/Applications/Postgres.app/Contents/Versions/17/bin`
  - 引擎版本：`PostgreSQL 17.10 (Postgres.app) on aarch64-apple-darwin23.6.0`
- **数据存储目录**：
  - 绝对路径：`/Users/exasdwyh/Documents/VScode/PM-Agent/.pgdata_hermes_next`
  - 权限与所有者：`exasdwyh`，编码 `UTF8`，时区 `Asia/Shanghai`。
- **数据库与账号**：
  - 专用开发库：`hermes_next_dev`（应用账号 `hermes_app`）
  - 专用测试库：`hermes_next_test`（测试账号 `hermes_test`，已验证无法连接开发库）
  - 连接串只保存在环境配置中（见 `.env`，已被 .gitignore 忽略）；`.env.example` 仅含占位符，不含真实值。
  - 历史说明：早期文档曾明文记录本地口令，该口令已轮换（2026-09-08，B01-02），不得再使用。
- **启停运维脚本**：
  - 启动脚本：`scripts/pg_hermes_start.sh`
  - 停止脚本：`scripts/pg_hermes_stop.sh`

---

## 3. Prisma Schema 迁移与数据表结构

采用严格符合 P0 数据契约设计的 PostgreSQL 数据表（共 15 张表）：
1. `Organization`：企业租户隔离（`organizationId`）
2. `User`：用户账户（无客户端直接伪造角色，密码/凭证隔离）
3. `ProjectMember`：项目成员与角色关系（支持 OWNER, DECISION_MAKER, FEEDBACK_PROVIDER, VIEWER 等）
4. `Project`：新品/固定产品项目主表（包含 `mode`, `stage`, `revision`, `ownerId`, `decisionMakerId`）
5. `Product` & `ProductVersion`：产品定义与不可变版本规范（规格 `specs`、定点金额 `targetCost`、未知项）
6. `WorkItem`：工作任务项（支持输入版本 `inputRevision`，状态流转控制）
7. `RunReceipt`：运行回执（明确标明 `runMode: MANUAL / TEST_STUB / AUTOMATED`，执行起止时间与产物）
8. `Artifact`：交付物（标记 `producerType` 与输入版本，未检查通过不能视为人工确认）
9. `Evidence`：证据资料（区分 `nature: REAL / DEMO`，严格存储哈希值与信息来源）
10. `Feedback`：反馈闭环（关联目标对象、版本及修订任务）
11. `DecisionPacket`：决策包快照（包含 `scopeHash`、验证计划、预算投入范围）
12. `Decision`：追加式决策记录（仅追加不可覆盖，记录决定与附带义务）
13. `AuditEvent`：核心审计日志（与业务变更同一事务写入）
14. `IdempotencyRecord`：幂等控制表（请求摘要与缓存结果，避免并发或重复扣款/创任务）

---

## 4. 自动化测试与验证证据 (A11 & 并发幂等)

自动化测试命令：`npm run test:db`（基于 `tests/db-transaction-verification.ts`）

### 验证场景 1：连接与基础实例信息读取
```json
{
  "user": "hermes_app",
  "database": "hermes_next_dev",
  "version": "PostgreSQL 17.10"
}
```
**结论**：成功连接至 5433 端口独立库，数据库与账号完全正确。

### 验证场景 2：A11 多实体事务原子性成功场景
- 单一事务内依次执行：
  1. 决策包状态更新：`IN_REVIEW` $\to$ `APPROVED`
  2. 决策明细新增：`APPROVE`（理由、附带义务留痕）
  3. 项目阶段推进：`RESEARCH` $\to$ `SAMPLING`（并发控制 `revision` 自增）
  4. 自动生成打样准备任务：`WorkItem` (状态 `TODO`, 执行者 `HUMAN`, "打样准备与实验室原料备料")
  5. 审计日志写入：`AuditEvent` 记录决策人批准事件及详细上下文。
- **结论**：事务提交成功，5 张关联表状态在同一时刻原子生效。

### 验证场景 3：A11 事务模拟异常回滚场景
- 在同一事务推进过程中注入模拟业务异常（`SIMULATED_TRANSACTION_FAILURE`）。
- **回滚验证检查**：
  - `DecisionPacket` 状态未发生变更，依然保持 `IN_REVIEW`；
  - `Project.stage` 保持原状，未推进至下一阶段；
  - 任务表计数与事务前严格一致，未产生任何孤儿任务；
  - 审计日志计数严格一致，未产生半提交脏数据。
- **结论**：PostgreSQL ACID 事务机制完整回滚，满足 A11 验收标准。

### 验证场景 4：Idempotency-Key 幂等与防重放
- **首次调用**：执行业务逻辑并缓存响应结果，`wasReplayed: false`。
- **同 Key 同 Body 再次调用**：命中缓存直接返回原有结果，未重复触发业务逻辑，`wasReplayed: true`。
- **同 Key 不同 Body 冲突调用**：精准捕获并抛出 `ConflictError (409)`。
- **结论**：完全阻断并发重放与键冲突。

---

## 5. 项目构建验证

- TypeScript 静态类型检查：`npx tsc --noEmit` $\to$ **0 错误**。
- Next.js 生产环境构建：`npm run build` $\to$ **Compiled successfully**（输出静态首页与 `/api/health` 动态健康检查路由）。
