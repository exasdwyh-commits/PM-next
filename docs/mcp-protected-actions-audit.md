# 受保护动作清单审查与 guard 落地

日期：2026-09-28 · 分支 `feat/kern-protected-actions`（基于 `main` = `138059d`，未推送）
来源：`docs/KERN_AGENT_FIELD_REPORT_MUSE_2026-09-27.md` §4 建议 3「不可逆动作清单落成 guard 测试」

## 1. 结论

Kern 的 human gate 纪律在，但**清单不是一份，而是六份**，彼此之间没有任何校验；
本机执行（Desktop Runtime）在服务端**完全不经过** gate。本分支把清单收敛为唯一事实源，
用 15 项 guard 测试锁住所有入口与它的映射，并修复了执行端危险命令守卫的一个绕过。

## 2. 审查发现

### 2.1 清单散落六处

| 位置 | 形式 | 问题 |
|---|---|---|
| `src/modules/supervisor/plan.ts` `MISSION_HUMAN_GATES` | 7 个 id | 与下一行逐字重复；且以同一数组引用写入每个 plan 快照 |
| `src/modules/assistant-runtime/goal-plan.ts` `humanGates` | 7 个 id | 逐字复制 |
| `src/app/muse/mission-timeline.ts` `GATE_LABEL` | 中文标签 | 新增 gate 不加标签时 UI 显示原始 id |
| `src/modules/assistant-runtime/persona.ts` 硬约束第 3 条 | 自然语言 | 模型被告知的边界，与上面无校验 |
| `src/modules/assistant-runtime/autonomy.ts` | 7 个布尔维度 | 无法表达「法律承诺 / 凭证 / 个人肖像」 |
| `src/modules/governance/capability-policy.ts` `PROTECTED_CAPABILITIES` | 7 个能力名 | 与 gate 无映射，`secret.use` / `shell.exec` 对应不到任何 gate |

### 2.2 清单缺项

实测记录列出的最小清单是「花钱 / 发布 / 删除 / 对外发送 / 个人肖像 / 凭证」。
原有 7 个 gate 覆盖前四项，**缺「凭证」与「个人肖像」**。

### 2.3 本机执行在服务端不经 gate

`enqueueDesktopTask`（`src/modules/desktop-runtime/service.ts`）对任何工具都直接入队，
不经 ToolBroker / ApprovalGrant。`shell.exec` 在 `PROTECTED_CAPABILITIES` 里是受保护能力，
但本机 `shell.run` 走的是另一条路径。现有防护全部在执行端（`scripts/hermes-desktop.ts`）：

| 工具 | 最坏情况 | 执行端现有缓解 |
|---|---|---|
| `fs.write_text`（非追加） | 覆盖已有文件，无备份 | 限 allowed roots；已加执行端覆盖保护（§6 第 1 条） |
| `fs.move` | `fs.rename` 静默覆盖目标 | 限 allowed roots；已加执行端覆盖保护（§6 第 1 条） |
| `shell.run` | 任意命令 | cwd 限 allowed roots；危险命令黑名单 |
| `mac.applescript` | 任意 GUI 自动化（可发邮件等） | 默认关闭，需显式开启 |
| `agent.delegate` | 本机 Agent 任意修改 | Codex `--sandbox workspace-write` |

这不一定是缺陷——产品原则是「明确指令即授权普通内部工作」——但它与
`PROTECTED_CAPABILITIES` 的声明不一致，此前也没有任何地方写明。

### 2.4 危险命令黑名单的正则缺陷（已修复）

旧规则 `/\brm\s+-[^\n]*r[^\n]*f\b/i` 要求 `r` 在 `f` 之前且 `f` 位于词尾：

- `rm -fr ~/Projects` → **放行**（实测 `old-blocked=false`）；
- `rm -r report.pdf` → **误拦**（文件名以 f 结尾）。

## 3. 本分支改动

| 文件 | 改动 |
|---|---|
| `src/modules/governance/protected-actions.ts`（新） | 唯一事实源：9 个 gate（原 7 个 + `CREDENTIAL_USE_OR_DISCLOSURE`、`PERSONAL_DATA_OR_LIKENESS`）；autonomy 维度、受保护能力、15 个本机工具到 gate 的映射；persona 覆盖缺口登记表 |
| `supervisor/plan.ts`、`assistant-runtime/goal-plan.ts` | 改为引用清单；plan 快照写入副本而非共享引用 |
| `app/muse/mission-timeline.ts` | `GATE_LABEL` 改为引用清单标签 |
| `assistant-runtime/autonomy.ts` | `KernCapabilityRisk` 增加可选 `gates`，任一项强制 ASK，原因记为 `GATE:<id>`（向后兼容） |
| `desktop-runtime/contracts.ts` + `scripts/hermes-desktop.ts` | 危险命令判断移入 `isDangerousShellCommand` 供执行端调用并可单测；`rm` 递归 + 强制按参数解析，覆盖任意顺序、长选项、命令替换、`\rm`、`/bin/rm` |
| `tests/kern-protected-actions.test.ts`（新，接入 `test:kern-autonomy` / Experience CI） | PA1–PA11，见 §4 |
| `tests/desktop-runtime-contract.test.ts` | 危险命令拦截 15 例、不误拦 7 例 |
| `tests/kern-runtime-architecture.test.ts` | 原「goal-plan.ts 源码含 `STRATEGIC_VALUE_TRADEOFF`」的文本断言改为跟随清单 |

**用户可见变化**：任务工作区「Kern 只把这些带给你」列表从 7 项变为 9 项（新增「使用或披露凭证」
「个人信息或肖像」）。模型 prompt 与执行行为不变。

## 4. guard 测试锁住什么

| 用例 | 锁住的不变量 |
|---|---|
| PA1 | 清单 id 唯一、标签与范围非空；实测记录的最小清单全部在列 |
| PA2 | 任务计划与 GoalPlan 的 gate 列表等于清单，且不共享引用 |
| PA3 | 每个 gate 在 UI 都有标签 |
| PA4 | `KernCapabilityRisk` 每个布尔维度都映射到 gate 且真的触发 ASK；新增维度未映射即失败 |
| PA5 | 声明任一 gate 的能力一律 ASK；自动执行白名单里的提案不触及任何 gate |
| PA6 | `PROTECTED_CAPABILITIES` 与映射表键集合完全一致 |
| PA7 | ToolBroker 对每个受保护能力，无授权 / 伪造授权都拒绝且处理器未执行（真实拦截） |
| PA8 | persona 覆盖每个 gate；未覆盖的必须登记原因，覆盖后未删登记即失败 |
| PA9 | `DesktopAction` 类型与执行端 `case` 分支中的每个工具都已分级，且表中没有已删除的工具 |
| PA10 | 分级自洽：只读不触及 gate；覆盖类 / 无界类必须触及 gate；触及 gate 的必须写明拦截方式或缓解措施 |
| PA11 | 按参数判定：追加写入不算覆盖 |
| PA12 | 声明 `EXECUTOR` 拦截的工具，执行端对应分支必须走覆盖保护，不得直接 `fs.writeFile` / `fs.rename` |
| LF1–LF8 | `tests/desktop-local-fs.test.ts`：不存在直接写 / 已存在不动原文件 / 显式覆盖与追加 / 移动两边不动 / 移到自身 / 解析器 / 回执指令可原样解析 / 结果判定 |

## 5. 验证（Windows 本机，2026-09-28）

- `npx tsc --noEmit`：0 错误
- `npx eslint`（改动文件）：0 问题
- `test:kern-autonomy` 15/15、`test:desktop-runtime` 6/6、`test:kern-goal-plan` 4/4、
  `test:kern-supervisor-plan` 40/40、`test:kern-runtime-architecture` 9/9
- `test:delivery-contracts` 全链路通过
- 数据库回归：`test:kern-supervisor` S1–S8、`test:kern-takeaway` T1–T7、`test:assistant-persona` 通过
- 未跑 `next build`（改动均为纯 TS 模块，客户端只新增对纯数据模块的引用）

## 6. 已知缺口与待决定

1. **本机受保护工具的确认**（§2.3）。
   - 已完成：执行端覆盖保护（`src/modules/desktop-runtime/local-fs.ts`）。`fs.write_text` 目标已存在、
     `fs.move` 目标已存在时不改动任何内容，回 `WAITING_HUMAN`；对话里给出现有文件大小、修改时间，
     以及可以照说的确认指令（「本机覆盖写入 …」「本机追加到 …」「本机覆盖移动 … 到 …」）。
     `DESKTOP_TOOL_RISK` 字段 `serverGate` 改为 `enforcement: "SERVER" | "EXECUTOR" | "NONE"`，
     这两项为 `EXECUTOR`，PA12 校验执行端分支确实走覆盖保护。
   - 局限：移动的存在检查与 rename 之间有竞态窗口；防的是按指令误覆盖，不防并发写者。
   - 仍待负责人决定：`shell.run` / `agent.delegate` 是否加确认（产品取舍）。决定后在服务端入队前
     实现，并把对应项改为 `SERVER`。
2. **persona 未提到「凭证」「个人肖像」**：`feat/tenant-pack` 正在把 persona 升到 v3，
   为避免冲突，已登记在 `PERSONA_COVERAGE_GAPS`，待其合入后补进硬约束第 3 条并升版本号，
   PA8 会强制删除登记。
3. 危险命令黑名单仍是黑名单（`git push --force`、`git reset --hard`、`curl | sh` 等不拦），
   它只是兜底，正路是第 1 条的 gate。

## 7. 合入条件

- 上述测试在 CI 同一 head 上为绿（Experience CI 含 `test:kern-autonomy`，Desktop / Quality CI 含
  `test:desktop-runtime`）；
- 按协作约定走分支 → PR → 用户 review 后合入 `main`，不直接推 `main`。
