# 贡献指南

感谢你愿意参与这个项目。本文件说明本地环境、测试分层与提交要求。

## 环境要求

- **Node.js 22.x**（与 CI 一致）
- **PostgreSQL 14+**（本地实例或容器）
- **内存**：完整类型检查需要约 **4 GB** 可用内存。`npm run typecheck` 已显式设置
  `--max-old-space-size=4096`，低于该内存的机器可能无法跑完整类型检查。

## 快速开始

```bash
npm ci                       # 严格按 lockfile 安装
npx prisma generate          # 生成 Prisma Client（必须，否则类型全红）
cp .env.example .env         # 填入 DATABASE_URL
npx prisma migrate deploy    # 应用迁移
npm run db:verify            # 校验数据库链路
npm run dev                  # http://localhost:3100
```

种子数据：`npm run db:seed`。

## 测试分层

**`test:*` 脚本的档位见 [`docs/TEST_MATRIX.md`](docs/TEST_MATRIX.md)**，那是唯一事实表。
提交前请至少跑：

```bash
npm run test:source-guards   # 源码守卫（含 any 预算、动效契约、架构分层）
npm run test:frontend-v3     # 前端 v3 契约
```

需要数据库的测试请指向独立的测试库（`TEST_DATABASE_URL`），不要指向开发库。

## 守卫与基线

本仓库的守卫（`tests/*guard*.test.ts`、`tests/*-contract.test.ts`、`source-guards` 套件）
是**质量护栏，不是可以协商的橡皮图章**。三条硬规则：

1. **守卫只能在违规消失后转绿。** 不允许通过注释掉断言、放宽匹配、或扩大豁免来让守卫通过。
2. **豁免清单只减不增。** 每条豁免必须写明理由与到期日；新增豁免等于新增技术债。
3. **预算类基线只降不升。** 例如 `tests/any-budget.test.ts` 的 `any` 基线。
   确需提高时必须在本 PR 描述里给出理由与替换计划。

## 提交信息

采用约定式提交（Conventional Commits）：

```
<type>(<scope>): <简述>

type: feat | fix | refactor | perf | docs | test | chore | ci | build
```

`CHANGELOG.md` 由提交信息归类生成，因此**标题写清楚是什么变更、面向什么功能**。

## 提交 PR

- 使用仓库自带的 PR 模板，只写五节：**版本 / 用途 / 改动 / 验证 / 边界**。
- 「验证」一节写数字（跑了哪些脚本、通过多少项），不要写"已测试"这类无信息量的话。
- 「边界」一节写明**没有覆盖什么**。这比声称"全部完成"更有价值。
- 涉及安全敏感路径（见 `.github/CODEOWNERS`）的改动，需要对应负责人复核。

## 关于 AI 智能体产出的代码

本仓库接受由 AI 智能体产出的代码，但**责任仍在提交者身上**。要求：

- 提交者必须**逐行复核** AI 产出的改动，理解它为什么这样改，而不是仅凭测试通过就合并。
- 在 PR 描述中标注产出方式（人工编写 / AI 产出并已逐行复核，注明复核人）。
- AI 容易在以下地方出问题，请重点复核：边界条件、错误处理是否被静默吞掉、
  是否有硬编码的凭据或环境相关配置、是否绕过了既有守卫或权限检查。
- **不要**让 AI 在你没看懂的前提下改动 `prisma/`、`src/modules/identity/`、
  `src/modules/evidence/`、`src/modules/governance/` 与权限矩阵。

## 许可

本项目采用 [Apache-2.0](LICENSE)。提交贡献即表示你同意以该许可分发你的贡献。
