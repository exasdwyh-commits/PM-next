---
title: 迁移链可重放性 · 隔离复现报告（TASK-004a）
version: "1.2"
date: 2026-09-20
owner: 执行模型（4a/4b：寇豆码/Kou；TASK-007 修复：Cline）
plan: plan/architecture-hermes-product-center-deepseek-v1.md（TASK-004 / D-006 → TASK-007）
scope: TASK-004 诊断（4a/4b）+ TASK-007 修复与复验（见文末）
status: 4a 完成（诊断）；4b 完成（脚本加固，见 §脚本加固（4b））；迁移链已由 TASK-007 修复并复验（见文末「TASK-007 修复与复验」）
---

# 迁移链可重放性：隔离复现报告（TASK-004a）

> **本批只诊断、不修**。未改 `prisma/migrations/**`、未改业务源码/`package.json`/schema。
> 全部实验在**新建的专用库**（`hermes_migration_replay_*`）上进行，**绝不**触碰 `hermes_next_dev` / `hermes_next_test`；实验后 4 个专用库**已全部 DROP**，既有两库完好。
> 每条结论均附**真实命令 + 真实输出**；未执行的一律标"未执行"。

## 结论速览

| 路径 | 判定 | 关键事实 |
| --- | --- | --- |
| ① 空库完整建库 | **失败（复现成功）** | 断在第 **6** 个迁移 `20260913220000`；`ERROR: relation "SignalItem" does not exist`（P3018 / 42P01） |
| ② 已知历史库升级（legacy-untracked） | **机制已证实；字面分支未复现** | 脚本对前 6 个迁移用 `migrate resolve --applied` **补账本不执行**（`prepare-test-database.sh:11-23`）；缺历史 schema 快照，无法构造 legacy 库 |
| ③ 当前库无操作重跑 | **幂等成立（复现成功）** | 补账本后 `migrate status` = **"Database schema is up to date!"**、`migrate deploy` = **"No pending migrations to apply."** |
| ④ 未知状态拒绝 | **拒绝成立（但路径与预期不同）** | 见 §④；shell `case *)` **不可达** |

**对 team-lead「假账本」假设的裁定：✅ 证实。**

---

## ① 空库完整建库（最关键证据）

### 现象

在**全新空库**上 `prisma migrate deploy`：前 5 个迁移成功，**第 6 个 `20260913220000_add_product_dev_advisor_knowledge_launch` 失败**，退出码 1。迁移链**无法从零重建数据库**。

### 复现命令

```bash
cd hermes-next
set -a; . ./.env; set +a
PG_BIN=/Applications/Postgres.app/Contents/Versions/17/bin
DB="hermes_migration_replay_$(date +%s)"
$PG_BIN/psql -h localhost -p 5433 -U hermes_app -d hermes_next_dev -c "CREATE DATABASE \"$DB\" OWNER hermes_app"
URL=$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/"+process.argv[1];process.stdout.write(u.toString())' "$DB")
DATABASE_URL="$URL" ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
```

### 原始输出（关键行）

```
Applying migration `0_init`
Applying migration `20260908070000_add_artifact_applicability`
Applying migration `20260908090000_user_password_hash`
Applying migration `20260909010000_add_evidence_claims_and_gaps`
Applying migration `20260913090000_add_opportunity_validation_fields`
Applying migration `20260913220000_add_product_dev_advisor_knowledge_launch`
Error: P3018
A migration failed to apply. ...
Migration name: 20260913220000_add_product_dev_advisor_knowledge_launch
Database error code: 42P01
Database error:
ERROR: relation "SignalItem" does not exist
```
退出码 = **1**。

### 判定

**失败（复现成功）。** 断点 = **第 6 个迁移**（`20260913220000`），报错 `relation "SignalItem" does not exist`。触发点：该迁移 `migration.sql:57` `ALTER TABLE "SignalItem" ADD COLUMN "organizationId" TEXT;`（`:60` 同款对 `SignalSource`；`:481/:484` 建索引）。

### 缺口清单（具体对象名）

**方法**：`grep CREATE TABLE`/`CREATE TYPE` 于全部迁移 → 与 `schema.prisma` 的 `model`/`enum` 取差集。

- **缺表 5 个**（schema 41 model，迁移仅 CREATE 36）：`SignalItem`、`SignalSource`、`ResearchRun`、`ResearchRunTask`、`ResearchRunSnapshot`
- **缺枚举 3 个**（schema 36 enum，迁移仅 CREATE 33）：`ResearchRunStatus`、`ResearchRunTaskStatus`、`ResearchTaskType`
- 实证：全仓迁移中 **无任何** `CREATE TABLE "Signal*"` / `"ResearchRun*"`；`ResearchRun*` 在迁移里**根本不出现**（既不建也不改）。

### 与 D-006 的关系

**完全吻合** D-006 描述：`SignalItem` 等在任何迁移中都没有 `CREATE TABLE`，却有迁移 `ALTER` 它。本报告把 D-006 从"现象描述"升级为"**空库实测 + 具体缺口对象清单**"。

### 对 TASK-007 的建议

- 重建 `0_init` 基线（或补一段 `CREATE TABLE` 前导迁移）覆盖上表 5 表 + 3 枚举；补完后必须在**空库**上 `migrate deploy` 跑到 **exit 0** 才算修好（当前 `migrate diff` 对空库无意义）。

---

## ② 已知历史库升级（legacy-untracked 路径）

### 现象 / 机制

`scripts/prepare-test-database.sh` 对 **legacy-untracked** 状态：把**前 6 个**迁移逐个 `prisma migrate resolve --applied`（**补账本、不执行迁移**），再 `migrate deploy` 跑剩余 2 个（`:11-23`）。`current` 状态则把**全部 8 个**标为已应用（`:27-40`）。**关键**：`migrate resolve --applied` 只写 `_prisma_migrations` 账本行，**不执行任何 DDL**。

### 判定

**机制已证实；字面分支未复现（如实说明）。**
- 未复现原因：legacy-untracked 的 facts（`Artifact` 缺 3 列、无 `OrganizationMember`、`SignalItem.organizationId` 可空、`RunMode` 无 `LLM`，见 `scripts/prepare-test-database.ts:29-42`）对应的是**迁移 `20260916010000` 之前**的库形态；仓库内**无该历史 schema 快照**，且迁移链**无法从零构造**该基线（同 §① 断在第 6 个）。故无法在隔离环境里造出真正匹配 legacy 的库。
- 但该分支的**补账本机制**与 §③ 完全同源（同一 `migrate resolve --applied` 代码路径），已在 §③ 实测证实。
- 附带发现：legacy 分支补完账本后 `migrate deploy` 会**真正执行**迁移 7/8（`20260916010000`、`20260919010000`）；迁移 7 亦 `ALTER` `SignalItem`（见 §① 缺口），故**若该库缺 `SignalItem` 则同样失败**——与 §① 同因。

### 与 D-006 的关系

D-006 的**具体机制**：脚本用 `resolve --applied` 把"账本"补齐成"全跑过"，`migrate status` 因此变绿，而**迁移链从未被证明可回放**（§③ 实测）。

### 对 TASK-007 的建议

修迁移链后，legacy 分支的 6 个 `resolve --applied` 应替换为**真实可执行**的前置迁移，并在**空库 + legacy 库**两种起点各跑一遍验证。

---

## ③ 当前库无操作重跑（幂等表现）+ 假账本验证

### 现象

在 `db push` 建出的"结构正确但无账本"的库上：
- 补账本**前**：`migrate status` 列出全部 8 个"not yet applied"（**尽管结构已与 schema 一致**）。
- 执行脚本 `current` 分支等价的 `resolve --applied ×8` 后：`migrate status` → **"Database schema is up to date!"**；`migrate deploy` → **"No pending migrations to apply."**（exit 0）。
- 但该库结构来自 `db push`，**迁移链一次都没执行**。

### 复现命令

```bash
DB="hermes_migration_replay_current_$(date +%s)_test"
psql -U hermes_app -d hermes_next_dev -c "CREATE DATABASE \"$DB\" OWNER hermes_app"
DATABASE_URL="$URL_APP" prisma db push --schema prisma/schema.prisma --skip-generate   # 建结构，无账本
DATABASE_URL="$URL_APP" prisma migrate status   # → 8 个 not yet applied
for m in <全部8个迁移>; do DATABASE_URL="$URL_APP" prisma migrate resolve --applied "$m"; done
DATABASE_URL="$URL_APP" prisma migrate status   # → Database schema is up to date!
DATABASE_URL="$URL_APP" prisma migrate deploy   # → No pending migrations to apply.
```

### 原始输出（关键行）

```
（补账本前）Following migrations have not yet been applied: 0_init ... 20260919010000_add_run_mode_llm
（resolve ×8 后）8 migrations found in prisma/migrations
Database schema is up to date!
（deploy）8 migrations found in prisma/migrations
No pending migrations to apply.
```

### 判定

**幂等成立；且「假账本」假设 ✅ 证实。** `migrate resolve --applied` 让 `migrate status` 变绿而**不执行迁移** → **"有账本" ≠ "结构正确 / 可回放"**（正是计划点名、也是 D-006 的核心机制）。

### 与 D-006 的关系

直接证明 D-006 的危害路径：新环境若靠 `prepare-test-database.sh` 的 `resolve --applied` 补账本，会得到"全绿"的假象。

### 对 TASK-007 的建议

修好后，`prepare-test-database.sh` 的 legacy/current 分支应改为**验证式**（用 `migrate diff --from-migrations --to-schema-datamodel` 证明迁移产物 == schema），而非仅补账本。

---

## ④ 未知状态拒绝

### 现象与实测（四种输入，四种结果）

| 输入 | `prepare-test-database.ts` 结果 | 位置 |
| --- | --- | --- |
| 库名**不以 `_test` 结尾**（`hermes_migration_replay_<ts>`） | `Error: Refusing database preparation: expected hermes_test on a *_test database, got hermes_test on hermes_migration_replay_...`（exit 1） | `prepare-test-database.ts:21` |
| **空** `_test` 库（无任何表/枚举） | **未走到友好拒绝**：直接抛 PG 原始错误 `ERROR: type "RunMode" does not exist`（42704，exit 1） | `:29-38` 的 facts 查询 |
| **失败过** `migrate deploy` 的库（`_prisma_migrations` 存在、含 1 条 `finished_at IS NULL`） | 返回 **`managed`**（exit 0） | `:24-27` |
| facts 既不匹配 legacy 也不匹配 current 的 `_test` 库 | `Error: ... Refusing to guess its history.`（exit 1） | `:46` |

### 判定

**拒绝成立，但路径与规格预期不同：**
- 规格问的 shell `case *)`（`prepare-test-database.sh:41-43`）**不可达**：`prepare-test-database.ts` 只会打印 3 个已知状态之一、或**抛异常**；抛异常时 `set -e` 会让 shell 在 `state=$(...)` 处**直接退出**，走不到 `case`。→ `case *)` 是**次级防御**，当前永不触发。
- 真正的未知状态拒绝发生在 **ts 层**：`:21`（库名/角色护栏）、`:46`（facts 不匹配 → 拒绝猜历史）。
- **新发现（风险）**：`:24-27` 仅凭 `_prisma_migrations` 存在就判 `managed`，**不检查是否有失败迁移**。实测：一次失败的 `migrate deploy` 会留下账本 → 被判 `managed` → 脚本打印"ledger verified"后 `migrate deploy` **再次失败**。建议 TASK-007 一并收紧（查 `finished_at IS NULL`）。
- 次要发现：facts 查询假定 `RunMode` 枚举存在（`'"RunMode"'::regtype`），空库上会抛**原始 PG 错误**而非友好拒绝。

### 对 TASK-007 的建议

① 把 `case *)` 或 ts 的拒绝逻辑补成**真正可达**的护栏；② `managed` 判定加"无未完成迁移"条件；③ facts 查询对缺枚举做兜底。

---

## 环境与相称检查

| 项 | 结果 |
| --- | --- |
| Postgres | 走既有 5433（已在运行，未重启） |
| 专用库 | 新建 4 个 `hermes_migration_replay_*`，**实验后全部 DROP**；`hermes_next_dev` / `hermes_next_test` 未触碰 |
| 沙箱 | **所有 psql / prisma 命令均需禁用沙箱**（与 3c 的 `next build` 同因）；未谎报 |
| 迁移文件 / 业务源码 / package.json / schema | **未改** |
| git 操作 | 无 |

### 复现脚本状态判定源码位置（供追溯）

- `scripts/prepare-test-database.ts`：`getState()` `:14-47`；库名/角色护栏 `:20-22`；`managed` `:24-27`；facts `:29-38`；`legacy-untracked` `:40-42`；`current` `:43-45`；`Refusing to guess` `:46`。
- `scripts/prepare-test-database.sh`：`legacy-untracked` 分支 `:11-23`；`managed` `:24-26`；`current` 分支 `:27-40`；`case *)` `:41-43`。

---

## 脚本加固（4b）

> 对应计划 TASK-004 的"检查脚本"那一半：**不再把「有账本」当「结构正确」**。**迁移链本身仍未修（TASK-007）**。

### 改了什么

**`scripts/prepare-test-database.ts`**
- `managed` 判定不再只看 `_prisma_migrations` 是否存在：
  1. 先查**失败/未完成迁移**（`finished_at IS NULL OR rolled_back_at IS NOT NULL`）→ 有则返回新状态 **`failed-migrations`**，并把**具体迁移名**写 stderr；
  2. 再做**结构比对**（`prisma migrate diff --from-url <库> --to-schema-datamodel prisma/schema.prisma --exit-code`）→ 非 0 返回新状态 **`structure-unverified`**，并把**差异清单**写 stderr；
  3. 两者都通过才返回 `managed`（= 结构已验证）。
- 新增两个状态：`failed-migrations`、`structure-unverified`。

**`scripts/prepare-test-database.sh`**
- `failed-migrations` / `structure-unverified` → **明确拒绝**（exit 1，带处理指引）。
- `current`（结构来自 `db push`）补账本**前**打印**醒目警告**（账本为补齐、迁移未执行、结构来自 db push、链仍不可回放 D-006/TASK-007）；`legacy-untracked` 亦加同类警告。
- **删除不可达的 `case *)`**，注释指明"真正的未知状态拒绝在 ts 层 `prepare-test-database.ts` 的 `getState()`（库名/角色不符或 facts 不匹配时 throw）"。
- `managed` 提示改为 `ledger verified AND structure matches schema`。

### 加固前后对同一库的行为差异

| 库 | 加固前 | 加固后 |
| --- | --- | --- |
| `hermes_next_test`（账本齐全、结构一致） | `managed` | `managed`（**不变；套件仍可跑**） |
| 含**失败迁移**的库（`migrate deploy` 断在迁移 6） | **`managed`（谎报）** | **`failed-migrations` + 迁移名**（拒绝，exit 1） |
| 账本齐全但**结构不一致**（删 `Artifact.schemaVersion`） | **`managed`（谎报）** | **`structure-unverified` + 差异清单**（拒绝，exit 1） |

### 失败迁移拒绝的实测输出

构造方法：新建专用库 → `prisma migrate deploy`（断在迁移 6，留下 `finished_at IS NULL` 的账本行）→ 授权 → 跑脚本。

```
（stdout）failed-migrations
（stderr）检测到 1 条失败/未完成迁移：20260913220000_add_product_dev_advisor_knowledge_launch
（sh）❌ 拒绝：测试库存在失败/未完成迁移（具体迁移名见上方 stderr）。
       本脚本不在失败账本上继续；请修复迁移链（TASK-007）后重建测试库。
（SH_EXIT=1）
```

### 结构不一致拒绝的实测输出

```
（stdout）structure-unverified
（stderr）结构比对未通过（实库与 schema.prisma 不一致）：
        [*] Changed the `Artifact` table
          [+] Added column `schemaVersion`
（sh）❌ 拒绝：账本齐全，但结构未通过校验（实库与 schema.prisma 不一致，差异见上方）。
（SH_EXIT=1）
```

### 选择：醒目警告（非交互确认）

`current` 分支采用**醒目警告**而非显式确认：`acc-server.sh` 以**非交互**方式调用本脚本，交互确认会**卡死**验收/CI。警告已明确"账本为补齐、迁移未执行、结构来自 db push、链仍不可回放（D-006/TASK-007）"，满足"不许在未告知的情况下把账本补齐成全跑过"。

### 四条命令真实退出码（本次实测）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `tsx scripts/run-test.ts tests/regression-gate-boundaries.test.ts` | **0** | 9/9 |
| `bash scripts/acc-server.sh --port 3182 3183 tests/acceptance-gate-boundaries.test.ts` | **0** | 43/43 |
| `npm run lint` | **0** | 无输出 |
| `./node_modules/.bin/tsc --noEmit` | **0** | 0 error |

**结论：不存在"加固 vs 套件可跑"的冲突** —— 加固后 `hermes_next_test` 仍判 `managed`，套件照常跑（43/43）。

### 环境说明（如实）

- 沙箱：psql / prisma / next 命令**需禁用沙箱**才能跑。
- 4b 期间 acc-server **一度失败**（`127.0.0.1:3182 未就绪`，`/api/health` 返回 **404**）。根因：**并行 `next dev`（PID 71915，监听 3180，非本团队）在 20:38 改写了 `.next` 的 manifest**（`route_client-reference-manifest.js` / `middleware-*.js` 时间戳 = 20:38，而 BUILD_ID = 08:36），使生产构建不一致——**与本次改动无关**。`touch src/app/api/health/route.ts` 触发 acc-server 重建（新 BUILD_ID）后即 **43/43 exit 0**。
- 未 kill 任何进程；4 个专用库全部 DROP；`hermes_next_dev` / `hermes_next_test` 完好。

---

## TASK-007 修复与复验（2026-09-20，修复方：Cline）

本报告 §① 判定的断链已由 TASK-007 修复并实测复验。

### 修复内容

新增 `prisma/migrations/20260913120000_add_signal_research_run_baseline/migration.sql`：3 枚举 + 5 表 + 索引/外键，表达 20260913220000 之前的历史时态。取证：`pg_dump --schema-only` 证实 dev/test 两库相关 DDL 逐字一致，减去后续三个迁移的作用后与 `schema.prisma` 逐项核对。**未修改任何已应用迁移文件**；未用当前整库 schema 冒充历史建表。

### 复验（`scripts/verify-migration-replay.ts`，新建专用库，结束全部 DROP）

- ① 空库完整建库：原断点（第 6 迁移 `relation "SignalItem" does not exist`）**不再复现**；9 迁移全落账 exit 0；结构 vs schema 零差异。
- ② legacy 升级：账本补录前 5 迁移 + 结构重建 → 补基线账本前与链上参考库做库对库 diff（不一致即拒绝）→ 仅补账本 → deploy 只补跑 3 个后续迁移。
- ②b 部分匹配拒绝：仅一张空 `SignalItem` 的库被结构核验拒绝，不补账本、不 deploy。
- ③ 幂等：status = up to date；重放 deploy = No pending migrations。

### 既有库收口

- `hermes_next_test`：`prepare-test-database.sh` 补基线账本 → `No pending migrations to apply.` → `managed`；`npm run test:product-center` 36/36。
- `hermes_next_dev`：结构与 schema 实测一致；**账本补录未执行**（业务库执行需用户授权，收口命令见 `EXECUTION_STATUS.md` §12.4）。

---

## 链上后续（TASK-008，2026-09-20）

TASK-008 新增迁移 `20260920235500_product_identity_code_org_scoped_unique`（`Product` 编码唯一性收敛到组织内，D-001/I-005）。**链现为 10 个迁移**；`scripts/verify-migration-replay.ts` 复跑仍全绿（空库建库 / legacy 升级只补跑 4 个后续迁移 / 部分匹配拒绝 / 幂等重放）。该脚本按 `prisma/migrations` 目录**动态枚举**，因此新增迁移无需改脚本即被覆盖。

既有库收口：`hermes_next_test` 由 `prepare-test-database.sh` 的 `pending` 分支前进（deploy → managed）；`hermes_next_dev` 仍未应用（业务库执行需用户授权，见 `EXECUTION_STATUS.md` §12.4 / §13.4）。
