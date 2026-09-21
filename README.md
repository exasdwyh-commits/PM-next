# HERMES-Next

食品新品研发打样门与可信决策系统（B01 骨架工程）

遵循规格：《HERMES_Gemini_执行包_P0_2026-09-07.md》

## 0. 当前交付状态（项目完成验收，2026-09-20）

统一状态口径：**独立验收通过 / 实施方已验证 / 待验收 / 阻塞**。

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| B01-01 正式身份与权限 | 已完成 | 密码登录/退出/会话失效/角色与越权防护，HTTP 与权限矩阵全绿 |
| B01-02 凭证与测试库隔离 | 已完成 | 独立测试库、测试账号与开发库隔离验收通过 |
| B01-03 真实页面与 HTTP 验收 | 已完成（桌面/平板） | 构建、HTTP、浏览器反馈层与业务蓝图验收通过；手机界面按范围暂不处理 |
| B01-04 统一交付状态 | 已完成 | 见 `docs/PROJECT_COMPLETION_2026-09-20.md` |
| P1-01 ~ P1-05 产品开发闭环 | 已完成 | 需求解析、证据、机会分析、成本、路线与建议包闭环全绿 |

详细证据与范围限制见：[docs/PROJECT_COMPLETION_2026-09-20.md](./docs/PROJECT_COMPLETION_2026-09-20.md)。
旧验收报告（B01_ACCEPTANCE_REPORT 等）为历史记录，结论以上表与最新交付文档为准。

## 1. 环境与端口

- **应用端口**：`3100` (`http://localhost:3100`)
- **PostgreSQL 端口**：`5433` (独立实例，不干扰系统 5432 端口)
- **数据库**：`hermes_next_dev`
- **应用账号**：`hermes_app`
- **数据目录**：`../.pgdata_hermes_next`

## 2. 数据库快速管理

在项目根目录可使用以下脚本控制独立 PG 服务：
```bash
# 启动 PostgreSQL 实例 (5433)
../scripts/pg_hermes_start.sh

# 停止 PostgreSQL 实例 (5433)
../scripts/pg_hermes_stop.sh
```

## 3. 开发命令

```bash
# 启动开发服务器
npm run dev

# 数据库迁移同步
npm run prisma:push

# 运行数据库与事务完整性测试 (A11 / 幂等)
npm run test:db

# 生产构建
npm run build

# 创建正式账号（无公共注册，唯一开号入口；口令走参数或 NEW_USER_PASSWORD 环境变量）
npm run user:create -- --email a@b.test --name "张三" --password '至少8位' --org-code HERMES_FOOD_DEV
```

所有 `test:*` 脚本从环境配置读取 `TEST_DATABASE_URL`（见 `.env.example`，示例不含真实值），
未配置或目标不满足隔离校验（库名 `_test` 后缀、专用测试角色、测试账号无法连接开发库）时立即失败。

需要真实页面或接口的验收会自动准备独立测试库、构建当前源码并启动临时服务；不用手动启动应用。若测试库不是已知的历史基线或迁移记录不完整，准备流程会拒绝猜测和覆盖，而不是重置任何数据。

发布前的关键回归可直接运行 `npm run test:critical`。它会依次检查产品中心、权限边界、科学证据和顾问模型调用，并在每组测试结束后回收临时服务与合成数据。

## 4. 模块结构

```text
src/
├── app/               # Next.js App Router (UI & API 端点)
├── modules/           # 业务领域服务层
│   ├── identity/      # 身份与越权防御
│   ├── projects/      # 项目阶段管理与并发 revision
│   ├── products/      # 产品定义与不可变版本
│   ├── work/          # 工作项、回执 (MANUAL / TEST_STUB)
│   ├── evidence/      # 证据与信息来源哈希 (REAL / DEMO 隔离)
│   ├── collaboration/ # 反馈闭环与处置
│   ├── decisions/     # 研发打样门快照与 scopeHash 计算
│   ├── intelligence/  # 边界占位接口
│   ├── economics/     # 边界占位接口
│   ├── supply/        # 边界占位接口
│   ├── rules/         # 边界占位接口
│   └── jarvis/        # 只读企业事实投影约定
└── shared/            # 数据库实例、错误定义、审计、幂等保障
```

## 5. 交付文档索引

本工程严格遵照 P0 第 10 节交付规范，提供以下完整文档：
- **交接总结报告**：[docs/HANDOVER_SUMMARY.md](./docs/HANDOVER_SUMMARY.md)
- **A01–A12 全量验收报告**：[docs/B01_ACCEPTANCE_REPORT.md](./docs/B01_ACCEPTANCE_REPORT.md)
- **系统架构与 11 个核心 API 契约**：[docs/ARCHITECTURE_AND_API.md](./docs/ARCHITECTURE_AND_API.md)
- **功能台账 (F01–F34 对照)**：[docs/FEATURE_LEDGER.md](./docs/FEATURE_LEDGER.md)
- **旧版资产复用检查表**：[docs/REUSE_CHECKLIST.md](./docs/REUSE_CHECKLIST.md)
- **环境配置与数据库验证**：[docs/B01_ENV_AND_DB_VERIFICATION.md](./docs/B01_ENV_AND_DB_VERIFICATION.md)
- **架构决定与已知问题 (ADR)**：[docs/CHANGE_DECISIONS.md](./docs/CHANGE_DECISIONS.md)
# 最新基础修复状态

Codex 已修复数据库目标选择、事务测试清理范围、页面与接口退出行为，并完成完整业务浏览器与核心业务验收。最新桌面/平板交付结论与手机范围限制见 [docs/PROJECT_COMPLETION_2026-09-20.md](./docs/PROJECT_COMPLETION_2026-09-20.md)。

应用只使用 `DATABASE_URL`。测试使用 `npm run test:*`，启动器会在导入应用前将 `TEST_DATABASE_URL` 显式设置为测试进程的数据库；单独测试使用 `tsx scripts/run-test.ts tests/<文件名>`。测试服务本身也必须显式使用测试数据库。
