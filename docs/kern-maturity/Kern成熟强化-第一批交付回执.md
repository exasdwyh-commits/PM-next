# Kern 成熟强化：第一批交付回执

日期：2026-10-15

## 当前交付

- PR：[exasdwyh-commits/PM-next #102](https://github.com/exasdwyh-commits/PM-next/pull/102)
- 分支：`fix/kern-maturity-connectors`
- 基线：远端 main `e7d1e93ced411a7c319e0cffdfaeca7720d65936`，本轮使用 GitHub API 和 git fetch 核对。
- 本批 HEAD：`3856e86a3dff3b52a3e7de25b28226d3b4b88dd1`
- 改动：6 个文件，+283 / −17，3 个提交。
- **已经提交并推送，远端 6/6 检查全部通过；尚未合并、未部署。**

这是路线 V2 的首个独立安全强化批次，不代表整个阶段 A 或全部改造路线已完成。

## 一、本轮实际完成

### 1. 施工基线与 WIP 隔离

主机已有 GitHub 登录可用。本轮没有使用用户在聊天中发出的 token，也没有将其写入源码、配置、日志或提交；建议撤销已明文暴露的 token。

在 `D:/VScode/Kern-OS/.tmp-kern/maturity-connectors` 新建隔离工作树，从已核对的远端 main 开始，不在有历史 WIP 的 PM-next 或其他验收工作树上直接施工。

本地存在行尾差异噪声。本轮只 stage 目标文件；提交后 `git diff --ignore-cr-at-eol --name-only` 无剩余实质差异。没有把无关行尾变化带入 PR，也没有清理其他工作树。

### 2. 复用既有 U01 成果

独立 cherry-pick 已有两个安全提交，没有整包合入含 30 个提交的候选分支：

- `730843a`：声明冲突按写，无声明不再凭工具名称推断只读。
- `3b7f512`：记录分类依据和停用原因，界面提示需要重新确认。

### 3. 新增“升级立即生效”的历史快照保护

新增 `normalizeStoredSpecs()`，供设置读取和执行入口共同使用：

- 历史只读工具如果没有有效的只读分类依据，立即降为写并停用，不等待用户点击刷新。
- 只读字段彼此不一致时保守停用。
- 已明确启用的写工具可以保留开关，但 capability 根据当前策略重新绑定为受保护写能力，不能信任旧的读取 capability。
- 返回新的投影，不修改原记录；可重复执行且结果幂等。
- 无效快照结构安全处理，严格要求布尔授权，限制工具数量。
- 显式重开不等于批准实际外部写入，执行仍需对应动作的单次凭据。
- 用户关闭的连接器／工具，刷新声明后不会被静默重新打开。
- 被停用时展示中文原因；重开后不再显示过期的停用提示。

本轮未新增数据库表或迁移，没有批量改写用户快照。

### 4. 正式记录施工契约与后续队列

仓库文档：`docs/plans/KERN_MATURITY_PHASE_A.md`。

列明安全契约、升级行为、验证入口、web／Worker 运行边界与后续分批任务。

## 二、验证证据

| 验证 | 实际结果 | 范围说明 |
|---|---|---|
| 新增 U02／U03 修复前回归 | 2/2 失败 | 已复现旧快照仍暴露，以及错误 capability 导致模拟写调用被放行 |
| 修复后安全与架构专项 | **50/50 通过**，exit 0 | 连接器、本机确认、受保护动作、架构分层、运行时架构 |
| 官方 `test:regression-units` | **427/427 通过**，exit 0 | 与专项测试有重叠，不相加宣称独立测试总数 |
| `npm run typecheck` | **通过**，exit 0 | TypeScript 全项目检查 |
| `npm run lint` | **通过**，exit 0 | 0 errors；1 个既有 warning，位于未修改的 cost-scenario-manager.tsx |
| `npm run test:kern-project-map` | **通过**，668/668 源文件映射 | 100% 覆盖，无新增未归属模块 |
| Git 差异检查 | **通过** | 只提交目标差异，未包含 workflow 或无关 WIP |

官方单元回归显式使用不可连接的占位数据库地址，避免任何开发库访问。连接器测试调用本地模拟 MCP 服务，没有真实发送、付款或删除。

新增 U02–U07 已放入原有 `tests/kern-connectors.test.ts`；现有 Quality CI 通过 `test:regression-units` 自动执行，不需要新增工作流权限。

## 三、没有做的事

- 没有直接 push 或合并 main，没有改动 release。
- 没有合并现有批准卡、报告质量或 UI 候选分支。
- 没有重启当前 web／Worker，没有变更现有服务绑定的版本。
- 没有做完整数据库端到端、真实外部 MCP 写入、浏览器交互和生产部署验收。
- 没有在本地执行完整 build；包含 build 的远端 Quality CI 已通过，详见文末状态。
- 没有宣称完成统一任务卡、RequiredAction、ScheduleRun、专家咨询、Watch 或视觉操作。

## 四、部署时的明确影响

1. 历史读工具可能先被停用，这是防止旧权限继续放行的预期行为。
2. 用户可刷新工具声明并核对，再明确启用；无法证明只读的工具只能按写工具逐次确认。
3. 新代码只影响新加载的工具；旧进程已持有的工具闭包不会被追溯修改。
4. 合并／部署时必须协调 web 与 Worker 的版本及重启，不能只更新前端。
5. 回退代码不会自动恢复已持久化的开关，不应为了恢复便利重新引入名称推断只读。
6. 服务端 annotations 仍只是声明，本批不代替安装审核、数据权限与出站控制。

## 五、后续顺序

按照用户确认的成熟强化路线继续，不能跳过本批 review 与 CI：

1. Worker、租约、取消、回原会话的真实闭环验收。
2. 已有批准卡／报告成果的独立集成与同版本验收。
3. 定时任务认领后崩溃的持久化恢复与副作用幂等。
4. 统一任务与“需要你”的前端体验。
5. 逐个引入专家咨询、结构化 Watch 等低风险能力。
6. 最后才处理视觉接管、多主机和云电脑。

## 远端 CI 状态更新

2026-10-15 重新查询 GitHub：PR #102 仍为 OPEN，HEAD 为 `3856e86a3dff3b52a3e7de25b28226d3b4b88dd1`；该 PR 实际触发的 **6/6 检查全部 SUCCESS**。

- Quality CI / typecheck（包含官方回归、类型、lint 和完整 build）；
- Experience CI / experience；
- Desktop CI / mac-runtime；
- Core UX CI / Core contracts and types；
- Core UX CI / Desktop and mobile fixture evidence；
- Kern Supervisor CI / supervisor（2026-10-15T16:23:59Z 完成）。

不等于仓库所有工作流均已触发，不等于已部署。Core UX 浏览器检查是现有 fixture 场景，不是本轮专门针对连接器设置页的数据库交互验收。

本批代码／PR／CI 交付完成，仍由用户 review 和决定合并。下一批继续使用独立分支。
