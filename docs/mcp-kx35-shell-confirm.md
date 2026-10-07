# KX-35 本机命令分级确认（shell.run / agent.delegate）

> 分支 `feat/kern-experience`，仅本地提交。决策见路线图 §9 D-03。

## 1. 为什么做

以前 `shell.run`、`agent.delegate` 在服务端完全不设防（`DESKTOP_TOOL_RISK` 里 `enforcement: "NONE"`），
只靠执行端 `scripts/hermes-desktop.ts` 调 `isDangerousShellCommand` 黑名单兜底。黑名单天然不完备：
`npm publish`、`git push --force`、`curl … | sh` 都不在里面，用户说一句话就会在自己的 Mac 上直接执行。

## 2. 用户决定（D-03：分级确认）

| 档位 | 范围 | 行为 |
|---|---|---|
| AUTO | 只读单条命令：`ls` `pwd` `cat` `head` `tail` `wc` 等、`git status/diff/log/show/branch`、`npm test`、`npm run test*`、`npx tsc --noEmit`；以及 KX-35 范围外的其它工具 | 照旧直接排队 |
| CONFIRM | 其余 `shell.run`；**所有** `agent.delegate` | 任务停在 `WAITING_HUMAN`，确认卡显示完整命令与目录；「允许一次」才放行 |
| DENY | 命中 `isDangerousShellCommand`（sudo / rm -rf / mkfs 等） | 服务端直接 422，不入队 |

「只读单条」还要求命令里没有 `; & | < >`、反引号、`$(`、换行——出现任一即视为组合命令，需要确认。

## 3. 实现

- `src/modules/desktop-runtime/confirmation.ts`（纯函数）：`classifyDesktopAction`、`desktopActionHash`
  （规范化动作 → sha256）、`desktopGrantScope`（taskRef `desktop:<taskId>`，capability `shell.exec` /
  `desktop.agent.delegate`，resource = cwd）、`readDesktopConfirmation`。
- `service.ts`
  - `enqueueDesktopTask`：DENY → 422「危险命令已拒绝执行：…」；CONFIRM → 任务置 `WAITING_HUMAN`，
    快照写 `desktopConfirmation { policy, reason, actionHash, status: PENDING, … }`。
  - `confirmDesktopTask`（新）：门禁同 claim（同组织 + 同发起人 + Desktop Operator，否则 404）；
    只接受待确认任务（否则 409）；动作指纹与确认时不一致 → 409。
    ALLOW：`ApprovalService.issue` 签发 HMAC 签名、单次、1 小时有效的凭据，任务条件更新回 `QUEUED`
    （并发的第二次点击得 409）。DENY：任务 `CANCELLED`，结果写「你没有允许执行」。
  - `claimDesktopRuntimeTask`：DENY 一律 409；CONFIRM 必须有 APPROVED + grantId。
    **先 `startAgentTask` 再 `consume`**（usedByRunId = 真实 run）；消耗失败则撤销该 run、任务退回待确认。
- 接口 `POST /api/desktop-runtime/tasks/{id}/confirm`，body `{ decision: "ALLOW" | "DENY" }`。
- 执行端列表只返回 QUEUED / RUNNING，待确认任务天然拿不到；执行端代码不需要改。
- 「需要你」：新增 `DESKTOP_CONFIRM` 信号（INTERRUPT，排最前），条目带 `confirm`，首页直接渲染
  `DesktopConfirmCard`（完整命令 + 原因 + 长按「允许一次」+「不允许」），样式全部走 `--m-*` 变量，亮 / 暗主题通用。
- Kern 对话回复：需确认时明说「这一步需要你确认后才会执行」并指向「需要你」；危险命令照实说已拒绝。
- `DESKTOP_TOOL_RISK`：`shell.run`、`agent.delegate` 改为 `enforcement: "SERVER"`
  （PA12 守卫会核对 service.ts 确有授权校验）。

## 4. 回归中发现并修掉的缺陷

初版是「先消耗凭据、再启动任务」。DB 回归里 Desktop Operator 并发已满时，`startAgentTask` 409，
但凭据已被作废、任务停在 QUEUED，而重新确认又要求 `WAITING_HUMAN` —— 任务永久卡死。
改为先启动后消耗，并补回归：并发满时领取失败，凭据 `usedAt` 仍为 null。

## 5. 验证

| 项 | 结果 |
|---|---|
| `tests/desktop-confirm.test.ts` DC1–DC4（进 `test:desktop-runtime`） | 通过 |
| `npm run test:kern-desktop-confirm` DR1–DR7（真实测试库） | 通过 |
| kern-protected-actions / desktop-runtime-contract / kern-autonomy | 通过 |
| frontend-v3（15）/ kern-runtime-architecture（9）/ kern-supervisor | 通过 |
| `test:authz`（基线 87 路由 / 122 方法） | 通过：1071 项断言全绿 |
| `ui-quiet-enterprise` | 4 项失败，与本次无关：改动前基线（stash 后重跑）失败项完全相同（媒体查询顺序、54×21 链接、≤860 导航、.hermes-content 内边距），该套件不在 `test:*` 里，属存量债 |
| tsc / 改动文件 eslint | 0 / 0 |

## 6. 未做 / 后续

- `mac.applescript` 同为 UNBOUNDED，但执行端默认关闭（需 `HERMES_DESKTOP_ALLOW_APPLESCRIPT=1`），
  不在 D-03 范围内；如要开放，建议同样纳入 CONFIRM。
- 对话内确认卡：当前在「需要你」里确认，对话里是文字指引；如需对话内按钮可复用 `DesktopConfirmCard`。
- 白名单按需扩充：只改 `READ_ONLY_COMMANDS`，DC1 用例同步加。
