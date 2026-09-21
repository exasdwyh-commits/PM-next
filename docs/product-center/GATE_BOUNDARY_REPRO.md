---
title: 门禁边界与幂等作用域——只读复现报告（TASK-003a）
version: "1.0"
date: 2026-09-20
owner: 执行模型（本批：寇豆码/Kou）
plan: plan/architecture-hermes-product-center-deepseek-v1.md（§6.1 / §1.8）
scope: G2 是否走 G1 通用批准分支 / 项目 PATCH 是否可绕门直写生产阶段 / 幂等键是否跨 commandScope 重放
status: 只读复现完成（未改任何生产源码）；3b 修复待用户放行
---

# 门禁边界与幂等作用域：只读复现报告（TASK-003a）

> 本报告为 **TASK-003a（只读复现）** 产出。**未修改任何 `src/**` 生产源码**；本批只新增本文件与一个下划线开头的临时探针（不提交）。
> 行号以**本次实测**为准（`grep -n` / `cat -n`），不照抄任何台账。

## 结论速览

| # | 问题 | 判定 | 关键证据（文件:行号） |
| --- | --- | --- | --- |
| ① | G2 输入是否会走 G1 的通用批准分支 | **可复现（成立）** | `decisions/service.ts:556` APPROVE 分支不按 gate 分派 → `:564` 写 `stage: SAMPLING`、`:580` 建打样任务 |
| ② | 项目 PATCH 能否绕门直写生产阶段 | **不可复现（已拦住）** | `projects/service.ts:217` 入参白名单 + `:241-245` 只写 target/constraints/revision；`stage` 被忽略 |
| ③ | `checkOrRecordIdempotency()` 是否跨 `commandScope` 重放 | **可复现（成立）** | `shared/idempotency.ts:23` 只比 `requestHash`/`actorId`，**不比对 `commandScope`**；探针实测 `wasReplayed=true` |

---

## ① G2 输入是否会走 G1 的通用批准分支

### 现象

`decideDecisionPacket` 的 **APPROVE** 分支在**推进项目阶段**与**派生准备任务**时**不区分 `GateType`**：只要 `decision === APPROVE`，就无条件把 `Project.stage` 写成 `SAMPLING` 并创建"打样准备"任务。因此对一个 `GateType.PRODUCTION_GATE` 的决策包批准，会**错误地把项目推进到打样阶段**并**派发打样任务**——而计划 §1.8 规定 G2 批准应"保留在 `PRODUCTION_PREP`"。

### 复现命令（只读）

```bash
cd hermes-next
# 1) 全仓 GateType 分支点：只有 RESEARCH_SAMPLING_GATE 被分派，PRODUCTION_GATE 无任何处理
grep -rn "GateType\." src/
# 2) 写 Project.stage 的全部位置
grep -rn "ProjectStage\." src/modules src/app
# 3) PRODUCTION_GATE 全仓引用
grep -rn "PRODUCTION_GATE" src/
```

### 证据（文件:行号 + 摘录）

- **gate 可被客户端指定并原样入库** —— `src/modules/decisions/service.ts:60`：
  ```ts
  const gate = params.gate || GateType.RESEARCH_SAMPLING_GATE;
  ```
  `:88` `gate,`（写入 `decisionPacket.create`）；路由 `src/app/api/projects/[id]/decision-packets/route.ts:14-17` 直接 `...body` 透传，`gate` 由请求体控制。
- **仅有的 gate 分支只认 RESEARCH_SAMPLING_GATE** —— `decisions/service.ts:65`（草稿自动绑版本）、`:269`（R07 固定产品禁止研究门）、`:331`（APPROVE 内产品版本一致性校验）：
  ```ts
  if (packet.gate === GateType.RESEARCH_SAMPLING_GATE) { ... }   // :331
  ```
  `PRODUCTION_GATE` 不进入任何分支。
- **APPROVE 的阶段推进未做 gate 守卫** —— `decisions/service.ts:556-590`：
  ```ts
  if (params.decision === DecisionOutcome.APPROVE) {          // :556  ← 无 gate 判断
    const projectUpdateResult = await tx.project.updateMany({
      where: { id: packet.projectId, revision: packet.project.revision },
      data: { stage: ProjectStage.SAMPLING, revision: { increment: 1 } },   // :564
    });
    ...
    nextWorkItem = await tx.workItem.create({                 // :580
      data: { projectId: packet.projectId, title: "打样准备与工厂技术对接", ... },
    });
  }
  ```
- **"空门"侧证**：`PRODUCTION_GATE` 全仓仅两处出现，均非逻辑——UI 注释 `src/app/projects/[id]/project-detail-client.tsx:387`、展示文案 `src/modules/workspace/overview.ts:171`。无任何创建/校验/放行逻辑。
- 无 `assertGateImplemented()` 或等价集中保护（全仓 `grep -rn "assertGate" src/` 无命中）。

### 判定

**可复现（成立）。** 符号级即可确定，无需 DB/服务。

若 `gate=PRODUCTION_GATE` 的决策包被 APPROVE，实际写入：
1. `DecisionPacket.status → APPROVED`（`service.ts:527-533`）；
2. `Decision` 追加记录（`:542`）；
3. **`Project.stage → SAMPLING`**（`:564`，错误）；
4. **新建 WorkItem「打样准备与工厂技术对接」**（`:580`，错误）；
5. `AuditEvent DECISION_APPROVE`（`:593`）。

### 最小修复方案（3b，待放行）

在 APPROVE 分支的**阶段推进前**加集中门型保护（fail-closed）：新增 `assertGateImplemented(packet.gate)`，对**尚未实现**的门型（当前 `PRODUCTION_GATE`；`LAUNCH_GATE` 见契约 §6.4）返回 **422**，**不写 Decision、不推进阶段、不派生任务**。阶段推进改为按门分派（G1→`SAMPLING`；G2 预留→`PRODUCTION_PREP`）。不改动 G1 既有行为。

### 影响面与风险

- 影响：任何构造 `gate=PRODUCTION_GATE` 决策包并批准的真实调用，会把项目错误置为 `SAMPLING` 并产生打样任务（污染阶段与任务队列）。
- 风险：G1 路径**不应**被此保护误伤——修复须精确作用于"未实现门型"，并保留 G1 现状；建议同时补 `tests/regression-gate-boundaries.test.ts`（3c）。

---

## ② 项目 PATCH 能否绕门直写生产阶段

### 现象

`PATCH /api/projects/{id}` 把请求体原样交给 `updateProject`，但 `updateProject` 的入参是**白名单**（`target / constraints / expectedRevision`），`data` 只写 `target / constraints / revision`。因此客户端传 `stage` **不会**被写入。

### 复现命令（只读）

```bash
cd hermes-next
grep -rn "stage:" src/modules src/app | grep -v "\.test\."   # 唯一写 Project.stage 的领域点
cat -n src/app/api/projects/\[id\]/route.ts                  # PATCH 入口
```

### 证据（文件:行号 + 摘录）

- **路由入口** —— `src/app/api/projects/[id]/route.ts:27-28`：
  ```ts
  const body = await req.json();
  const updated = await updateProject(session, id, body);
  ```
- **入参白名单** —— `src/modules/projects/service.ts:214-217`：
  ```ts
  export async function updateProject(
    session: SessionContext,
    projectId: string,
    updates: { target?: string; constraints?: string; expectedRevision: number }  // :217  ← 无 stage
  ) {
  ```
- **写入字段集合** —— `projects/service.ts:241-245`：
  ```ts
  data: {
    target: updates.target !== undefined ? updates.target.trim() : undefined,
    constraints: updates.constraints !== undefined ? updates.constraints : undefined,
    revision: { increment: 1 },
  },
  ```
- **全仓 `Project.stage` 写入点仅两处** —— `projects/service.ts:64`（创建时 `initialStage`：FIXED_PRODUCT→`PRODUCTION_PREP`，否则 `DRAFT`）、`decisions/service.ts:564`（APPROVE 推进，即问题 ①）。

### 判定

**不可复现（无法绕门直写生产阶段）。** `stage` 既不在入参类型、也不在写入块，客户端传 `stage` 会被**静默忽略**。

> 说明（非缺陷，记录用）：此处是"字段被忽略"而非"显式拒绝未知字段"。当前**无绕过风险**；是否要显式 422 拒绝未知字段属可选加固，非本批必需。

### 最小修复方案（3b）

**无需修复**（现状安全）。可选：PATCH 入参显式拒绝 `stage` 等未允许字段（422），以把"静默忽略"变为"明确拒绝"。若采用，须与 ① 的 `assertGateImplemented()` 一并设计，避免误伤正常 PATCH。

### 影响面与风险

- 无绕过风险。唯一阶段推进路径是 `decideDecisionPacket`（见 ①），故 ① 修复即覆盖阶段推进面。

---

## ③ `checkOrRecordIdempotency()` 是否跨 `commandScope` 重放

### 现象

`checkOrRecordIdempotency()` 命中已存在记录时，**只比对 `requestHash` 与 `actorId`**，**不比对 `commandScope`**。故相同 `actor` + 相同 payload、**不同 `commandScope`** 会命中旧记录并直接返回其响应体（`wasReplayed: true`），即**跨命令重放**。

### 复现命令（可执行，纯逻辑，不连库）

```bash
cd hermes-next
node_modules/.bin/tsx scripts/_probe-idempotency-scope.ts
```

探针 `scripts/_probe-idempotency-scope.ts`（下划线开头，**不提交**）用内存 fake `tx` 替换 `Prisma.TransactionClient`，**不连库、不起服务**。

### 证据（文件:行号 + 摘录）

- **读取分支只比两个字段** —— `src/shared/idempotency.ts:22-31`：
  ```ts
  if (existing) {
    if (existing.requestHash !== requestHash || existing.actorId !== actorId) {   // :23  ← 未比对 commandScope
      throw new ConflictError("Idempotency key reused with different request payload or actor");
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, wasReplayed: true };  // :26-30
  }
  ```
- **`commandScope` 只写不读** —— `idempotency.ts:39`（`create` 时写入），全文件再无读取点。
- **实测输出**（探针）：
  ```
  NEG  (scope 不同): NO-THROW  wasReplayed=true  body={"from":"SCOPE_A"}  execute被调用=false  => 命中旧记录=跨命令重放【复现】
  POS  (scope 相同): wasReplayed=true  execute被调用=false  => 合法复用【预期】
  CTRL (payload 不同): THROW "Idempotency key reused with different request payload or actor"  => 已阻断【预期】
  ```
- **同缺陷的第二处（inline 版）** —— `decisions/service.ts:217-227` 的决策幂等内联实现同样只比 `requestHash`/`actorId`：
  ```ts
  if (existingIdemp.requestHash !== reqHash || existingIdemp.actorId !== session.userId) { ... }  // :222
  ```

### 判定

**可复现（成立）。** 负例复现**成功**：相同 actor + 相同 payload + 不同 `commandScope` → `wasReplayed=true`，返回旧命令的响应体，`execute` 未被调用。

### 最小修复方案（3b，待放行）

读取分支追加 `commandScope` 比对：`existing.commandScope !== commandScope` → 抛 `ConflictError`（同键不同命令 = 复用冲突，不重放）。`decisions/service.ts:222` 的内联版**同步补** `commandScope` 比对（其写入侧已固定为 `"DECIDE_DECISION_PACKET"`，见 `:625`）。注意：`IdempotencyRecord.key` 为**全局 `@unique`**（契约 §2.3），修复只改读取判定、不动 schema。

### 影响面与风险

- 影响：同键跨命令会返回**错误命令**的历史响应（调用方拿到"别人的结果"），破坏"幂等键作用域 = `(actorId, commandScope)`"（契约 §2.3）。
- 风险：修复后需回归"同键同命令合法重放"仍成立（探针 POS 用例）；改动面小、无 schema 迁移。

---

## 环境与相称检查

| 项 | 结果 |
| --- | --- |
| 是否连库/起服务 | **否**（③ 用纯逻辑 fake tx，符合降级路径；① ② 为静态复现） |
| `npm run lint` | `exit 0` |
| `./node_modules/.bin/tsc --noEmit` | `exit 0`（0 error） |
| 生产源码改动 | **无**（`src/**` 只读） |
| 新增（不提交） | `scripts/_probe-idempotency-scope.ts` |

## 待放行（3b 前置）

- ①：新增 `assertGateImplemented()` + APPROVE 阶段推进按门分派（fail-closed，未实现门型 422）。
- ③：`shared/idempotency.ts` 读取分支补 `commandScope` 比对；`decisions/service.ts` 内联版同步。
- ②：无需修复（可选加固）。
- 3c：`tests/regression-gate-boundaries.test.ts` 新增回归（含 ①③ 正反例）。
