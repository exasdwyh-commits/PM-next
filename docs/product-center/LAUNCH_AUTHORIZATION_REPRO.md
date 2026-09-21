---
title: 上市"准备就绪"与"正式 G3 授权"的区分 · 只读复现（TASK-005a）
version: "1.0"
date: 2026-09-20
owner: 执行模型（本批：寇豆码/Kou）
plan: plan/architecture-hermes-product-center-deepseek-v1.md（TASK-005 / DEC-006）
scope: 只读定位：LaunchPlan 的 approvedAt 何时被当作授权；不修代码（5b 才改）
status: 5a 完成（定位/静态复现）；5b 待放行
---

# 上市"准备就绪"与"正式 G3 授权"的区分（TASK-005a）

> **本批只读**：未改任何源码/文案（`launch/service.ts`、`launch-tab.tsx` 一行未动）。
> **未连库、未起服务**；本节结论为**静态推理**，凡未实测处均明确标注「未实测（仅静态推理）」。
> 与 DEC-006 冲突的结论：**成立**。

## 结论速览

| # | 结论 |
| --- | --- |
| ① | `assertLaunchWritePermission` = `requireProductRole(..., PRODUCT_WRITE_ROLES)` = **`OWNER` 或 `DECISION_MAKER`**；**不要求"指定决策人"、无防自批**。DEC-006 两条禁令均被违反。 |
| ② | 仅凭 `approvedAt` 判"已放行"的读路径 **≥13 处**（`launch-tab.tsx` ×11、`product-overview-client.tsx` ×1、`briefing.ts` ×1）；**无任何 `valid-approval` 类函数覆盖 `LaunchPlan`**。 |
| ③ | UI 把 `approvedAt`/`g3=passed` 呈现为"已获准"的文案 **6 处**；其中部分与"获准≠已上市"并存（部分诚实），但**无一处**提示"这不是正式 G3 授权"。 |
| ④ | 旧 approve 入口 = `POST /api/launch/plans/{planId}/approve` → `approveLaunch`。**不绕过 evaluateGate**（未过 422），但**绕过"指定决策人 + 防自批"**。 |
| ⑤ | 复现：**未实测（仅静态推理）**。 |

---

## ① 服务层放行路径全景（`src/modules/launch/service.ts`）

**权限判定（唯一入口）** —— `assertLaunchWritePermission` `:79-89`：

```ts
const access = await requireProductRole(session, productId, PRODUCT_WRITE_ROLES);   // :83
```

- `PRODUCT_WRITE_ROLES = [Role.OWNER, Role.DECISION_MAKER]`（`src/modules/identity/product-access.ts:46`）。
- 即：**该产品任一关联项目里是 `OWNER` 或 `DECISION_MAKER` 即可**；**不校验"指定决策人"**（`decisionMakerId` 未被引用），**无防自批**（不比对提交人 ≠ 决定人）。
- 文件头 `:11-14` 自述："写入权限判定为「在该产品所属的任一项目中担任 OWNER 或 DECISION_MAKER」" —— 与实现一致，**与 DEC-006 冲突**。

**五个写函数**：

| 函数 | 权限（行） | 写什么 | 是否要求有效 G3 |
| --- | --- | --- | --- |
| `prepareLaunch` | `assertLaunchWritePermission` `:265` | 建 `LaunchPlan`（`status: ACTIVE` `:307`）+ 里程碑；`IDEA/ANALYSIS → LAUNCH_PREP` `:329-333` | 否 |
| `updateLaunchBasics` | `:364` | `title/targetDate/ownerId/notes` `:375-382` | 否 |
| `upsertMilestone` | `:407` | 里程碑字段 `:435-448`（改）/`:465-478`（增） | 否 |
| `approveLaunch` | `:508` | **`approvedAt` + `status: ACTIVE`** `:517-520` | **这就是"获准"本身**；仅要求 `evaluateGate(plan).ready` `:510-513` |
| `revokeLaunchApproval` | `:542` | `approvedAt: null` `:545` | 否 |
| `confirmLaunchExecution` | `:573` | `actualLaunchedAt` + `status: COMPLETED` + `Product.lifecycleStage → LAUNCHED` `:596-607` | **仅要求 `approvedAt` 非空** `:575`；**不校验 `approvedAt` 是否仍有效**（无 scope/失效判定） |

**`approveLaunch` 全文关键行**（`:498-532`）：

```ts
if (!plan || plan.organizationId !== session.organizationId) throw new NotFoundError(...);  // :507
await assertLaunchWritePermission(session, plan.productId);                                 // :508  ← 产品写权限，非"指定决策人"
const gate = evaluateGate(plan);                                                            // :510
if (!gate.ready) throw new UnprocessableEntityError(`未通过放行门禁，不得放行：...`);        // :511-513
await tx.launchPlan.update({ ..., data: { approvedAt, status: LaunchPlanStatus.ACTIVE } }); // :517-520
```

### 判定

**DEC-006 的两条禁令均被违反**：①「产品编辑权限不得代替决策权」—— `:508` 正是产品写权限；②「正式 G3 与 G1/G2 同由指定决策人批准且禁止负责人自批」—— 无 `decisionMakerId` 校验、无防自批。**team-lead 假设：✅ 证实。**

### 对 5b 的最小改法建议

在 `approveLaunch` 增"指定决策人 + 防自批"（对齐 `decisions/service.ts` 的 A05 口径：`session.userId === plan.project.decisionMakerId && session.userId !== plan.project.ownerId`）。**不改 `decisions/**`**；`LaunchPlan` 的正式 G3 统一授权仍属 TASK-034/035。

### 与 DEC-006 / TEST-011 的关系

DEC-006 明令；本处为**直接冲突点**。TEST-011 的"旧 approve 入口不得绕过"——见 §④。

---

## ② 仅凭 `approvedAt` 判"已放行"的读路径清单

> 全仓 `grep -rn approvedAt src/`（排除 `*.test.*`）逐条核对。**关键缺口：无 `valid-approval` 类函数覆盖 `LaunchPlan`** —— 统一有效性判定只存在于 `src/modules/decisions/`（针对 `DecisionPacket`），`LaunchPlan` 的 `approvedAt` 被**原样**使用。

| # | 位置 | 判据 |
| --- | --- | --- |
| 1 | `src/app/products/[id]/launch-tab.tsx:288` | `const isApproved = !!plan.approvedAt;` |
| 2 | `launch-tab.tsx:301-302` | `g3State = plan.approvedAt || plan.actualLaunchedAt ? "passed"` |
| 3 | `launch-tab.tsx:308-309` | `g3Detail = plan.approvedAt ? "已获准（未上市）"` |
| 4 | `launch-tab.tsx:327-328` | 阶段导引条：`isApproved ? "上市计划已获准放行！..."` |
| 5 | `launch-tab.tsx:339` | `... {plan.approvedAt ? "已获准" : "未获准"}` |
| 6 | `launch-tab.tsx:349` | KV「获准时间」：`plan.approvedAt ? fmtDateTime(...) : "尚未获准"` |
| 7 | `launch-tab.tsx:398/402/410/412` | 放行按钮 `disabled ... || !!plan.approvedAt` / 文案「已获准」 |
| 8 | `launch-tab.tsx:528` | KV「获准」：`plan.approvedAt ? "已获准" : "未获准"` |
| 9 | `launch-tab.tsx:538/542` | 「确认实际上市」按钮 `disabled ... || !plan.approvedAt` |
| 10 | `src/app/products/[id]/product-overview-client.tsx:178` | `approvedAt: plan.approvedAt ?? null`（透传给主题结论） |
| 11 | `src/modules/workspace/briefing.ts:339` | `else if (plan.approvedAt) launchConclusion = "计划已获准放行，等待确认实际上市。"` |
| 12 | `src/modules/launch/service.ts:575` | `if (!plan.approvedAt) throw ...`（写前置，非展示，但同属"仅凭非空") |
| 13 | `src/modules/launch/service.ts:616` | 审计 details `approvedAt: plan.approvedAt?.toISOString() ?? null` |

### 判定

**≥13 处**仅凭 `approvedAt` 非空即判"已放行/可继续"；**无有效性（scope/失效）判定**。一个**过期/自批**的 `approvedAt` 会被全链路当作有效授权。

### 对 5b 的最小改法建议

5b **不新增** validity 引擎（那是 TASK-034/035）；最小改法是**在 UI 文案层显式标注**"当前 `approvedAt` 为**准备就绪/旧机制获准**，正式 G3 统一授权待 TASK-034/035"，避免被读成完整授权。

### 与 DEC-006 / TEST-011 的关系

DEC-006 要求"正式 G3 … 禁止负责人自批"；此处显示层无任何"是否由指定决策人批准"的提示。

---

## ③ UI/文案：把 `approvedAt`/`ACTIVE` 读成"已获准上市"的条目

| # | 位置 | 原文 | 归类 |
| --- | --- | --- | --- |
| 1 | `launch-tab.tsx:328` | "上市计划**已获准放行**！下一步动作：…点击下方「确认实际上市」…" | **易读成"已获准上市"**（要改） |
| 2 | `launch-tab.tsx:309` | g3 详情 "**已获准（未上市）**" | 部分诚实（括号注明未上市） |
| 3 | `launch-tab.tsx:339` | "… · **已获准**" | **易读成授权**（要改） |
| 4 | `launch-tab.tsx:349` | KV「**获准时间**」 | 中性（但无"由谁批准"） |
| 5 | `launch-tab.tsx:410` | 按钮 "**已获准**" | 中性偏授权 |
| 6 | `launch-tab.tsx:528` | KV「获准: **已获准**」 | 中性偏授权 |

**合法（"准备就绪/进度"）**：`evaluateGate` 的逐项 checks（`:108-153`）、`g3Detail` 的 "待放行审批"（`:311`）、`LAUNCH_PLAN_STATUS_LABELS.ACTIVE = "执行中"`（`status-labels.ts:146-152`，中性）。`launch-tab.tsx:300/374` 已写"获准 ≠ 已上市"，**部分诚实**。

### 判定

**会被读成"已获准上市"的文案 ≥3 条**（#1/#3 最明显；#5/#6 次之）。**无一处**提示"这不是正式 G3 授权（缺指定决策人批准）"。

### 对 5b 的最小改法建议

- 将"已获准"改写为"**已获准（旧机制，准备就绪）**"或"**待正式 G3 授权**"；
- 阶段导引条（#1）补一句"正式上市授权将由指定决策人批准（TASK-034/035 落地）"。
- **不伪造 Decision 回填**。

### 与 DEC-006 / TEST-011 的关系

DEC-006「负责人整理和记录执行；正式 G3 由指定决策人批准」——当前文案未体现"由谁批准"。

---

## ④ 旧 approve 入口（能否绕门）

**入口**：`src/app/api/launch/plans/[planId]/approve/route.ts:12-22` → `POST` → `approveLaunch(session, planId, body?.note ?? null)`；`DELETE` `:24-34` → `revokeLaunchApproval`。另有 `POST /api/launch/plans/[planId]/launch`（`.../launch/route.ts:12-27`）→ `confirmLaunchExecution`。

- 路由**无直接 DB 写入**，全部经服务层 → 无法绕开 `evaluateGate`（未过 → **422**，`service.ts:511-513`）。
- 但**绕过 DEC-006 的"指定决策人 + 防自批"**：任何 `OWNER`/`DECISION_MAKER`（含**计划创建者本人**）均可 `POST` 获准 → **自批可行**。

### 判定

**不绕门禁（evaluateGate 仍拦），但绕过"决策人 + 防自批"。** 对 TEST-011："旧 approve 入口不得绕过"——在 G3 统一（TASK-034/035）后，此入口**必须**改为走统一 `DecisionPacket` 授权，否则就是"绕过新门禁"的旧入口。

### 对 5b 的最小改法建议

5b 只补"指定决策人 + 防自批"到 `approveLaunch`；**入口统一（DecisionPacket）留给 TASK-034/035**，5b **不**删除旧入口（避免破坏现有功能）。

---

## ⑤ 复现（一个只有 `approvedAt` 的旧记录会怎样）

**判定：未实测（仅静态推理）。** 未连库、未起服务；以下为按代码路径的静态推演：

1. **launch-tab**：`isApproved = true`（`:288`）→ 阶段导引条显示"上市计划已获准放行！"（`:328`）、g3 节点 `state="passed"`（`:301`）、"已获准"（`:339/:410/:528`）；
2. **确认实际上市**按钮**解锁**（`:538`）→ 同一个人可继续 `POST /launch` → 写 `actualLaunchedAt` 并把产品置 `LAUNCHED`（`service.ts:596-607`）；
3. **briefing**：产品主题结论变为"计划已获准放行，等待确认实际上市。"（`:339`）；
4. **product-overview**：把 `approvedAt` 透传进主题（`:178`）。

即：**一个只有 `approvedAt`（甚至由负责人自批）的旧记录，在 4 个界面被呈现为"已获准"，并可直接推进到"确认上市"。**

> 若需**实测**，建议在 5b 用专用测试库 + `acc-server.sh` 构造：`OWNER 自建计划 → 自批 approve → 观察 200 与 UI`。**本批未做**。

### 对 5b 的最小改法建议

5b 修 `approveLaunch` 的决策人/防自批后，同步把 §③ 的文案改为"旧机制/准备就绪"措辞；**不伪造 Decision 回填**。

---

## 环境与相称检查

| 项 | 结果 |
| --- | --- |
| 源码/文案改动 | **无**（`launch/service.ts`、`launch-tab.tsx` 一行未动） |
| 连库/起服务 | **否**（本批纯静态） |
| `npm run lint` / `tsc --noEmit` | 见 EXECUTION_STATUS TASK-005 行（预期 exit 0，未改源码） |
| git 操作 | 无 |
