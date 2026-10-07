# Kern 问题普查（KX-02）

- 日期：2026-09-28
- 分支：`feat/kern-experience`（基于 main 138059d + 8 个未推送分支，整合提交 77e67b8）
- 范围：全量 `test:*`（71 项）、验收服务器生产构建、UI 巡检（18 个页面 × 3 种宽度 × 深浅色 = 108 个组合）、已登记遗留问题复核
- 结论：**71 / 71 套件通过**；UI 巡检 **0 个页面异常 / 控制台错误 / hydration 警告 / 4xx·5xx / 横向溢出 / 无名按钮**；普查共发现 11 个代码问题，10 个已修复并配有回归测试，1 个（P1-2）列为 KX-05 待办

## 1. 怎么重跑

```bash
cd PM-next
# 全量（UI 类套件需要 chromium-1243；本机装在工作区内，不写用户目录）
export PLAYWRIGHT_BROWSERS_PATH="$(cd ../.pw-browsers && pwd -W)"   # Linux / macOS 用 pwd
npm run test:sweep                       # 或分批：bash scripts/run-test-sweep.sh test:authz test:ui ...

# UI 巡检（先起开发服务器：npx next dev -p 3100）
node scripts/kx-ui-patrol.mjs --out /tmp/kx-patrol          # 只看部分页面：--only /muse,/dashboard
```

- 巡检登录口令按 `DEV_LOGIN_PASSWORD` → `SEED_PASSWORD` → `.env` 顺序读取，不打印。
- 巡检有页面异常、5xx 或导航失败时退出码为 1；详细结果在 `<out>/report.json`，截图在同目录。
- 验收类套件（acc-server）首次或源码变更后会重建 `.next-acc`，单次约 13 分钟；Windows 上请前台分批跑，不要 `nohup` 后台跑（会话结束会被一并杀掉）。

## 2. 问题清单

分级：**P0** 阻断测试或主流程；**P1** 用户可见错误、安全覆盖缺口、静默丢数据；**P2** 工程健壮性。

| 编号 | 级别 | 问题 | 状态 | 提交 | 回归 |
|---|---|---|---|---|---|
| C-01 | P0 | 测试基建在 Windows 上 spawn `node_modules/.bin/prisma` 得到 ENOENT，误报「实库与 schema 不一致」，acc-server 拒绝启动，约 10 个验收套件被连带阻断 | ✅ | 5ea6b32 | LB1–LB4 |
| C-02 | P1 | Muse 的 `friendlyTime` / `formatClock` 未指定时区，服务端（UTC）与浏览器渲染不一致 → hydration 失败或时间差 8 小时 | ✅ | 5ea6b32 | datetime-format 6/6 |
| C-03 | P1 | 20 个测试文件没有被任何脚本或 CI 引用，其中时区守卫、状态标签守卫、诚实事件测试长期不跑，C-02 / C-04 因此溜进来 | ✅ | 5ea6b32 | `test:source-guards`（已接入 experience-ci）、`test:regression-units` |
| C-04 | P1 | 界面显示英文常量：43 个审计动作缺中文标签，6 处审计文案插值裸枚举，桌面任务卡直接渲染 `action.kind` | ✅ | 5ea6b32 | status-labels 13/13 |
| C-05 | P1 | 整合分支带入的 6 条任务类 API（8 个方法）未登记权限矩阵，越权测试完全没覆盖 | ✅ | 180f820 | acceptance-authz 927 项全过 |
| C-06 | P2 | 上述 3 个 POST 用 `req.json().catch(...)`，畸形 JSON 被静默当成空 body（违反 D-016） | ✅ | 180f820 | acceptance-authz 8.0b |
| C-07 | P1 | 「挑战我的判断」同时命中红队信号，被升级为任务，任务简报**整体覆盖**了当轮已生成的挑战报告（main 上同样存在） | ✅ | 2b47f5e | kern-supervisor-plan 新断言、science 3.3–3.6 |
| C-08 | P1 | 知识库同步在 Windows 上把 `relativePath` 存成反斜杠，按 `30-science/ingredients/` 前缀检索原料卡全部落空，挑战报告的科学证据维度被静默清空 | ✅ | 2b47f5e | science 1.4–1.6、3.6 |
| C-09 | P2 | `test:llm-e2e`、`test:mobile-layout`、`muse:check` 用 POSIX 环境变量前缀，Windows 的 cmd.exe 无法执行 | ✅ | 2b47f5e | LB5 |
| C-10 | P2 | `acc-llm-e2e.sh` 的归属校验只依赖 lsof，Windows 上恒得空 cwd，服务可用却 exit 4 | ✅ | 2b47f5e | test:llm-e2e 通过 |
| C-11 | P2 | worker W8 单实例锁用例假设 PID 1（Linux init）存活，Windows 上假红 | ✅ | 667d747 | test:worker 通过 |
| P1-2 | P1 | 产品研发流程 advance 失败后只写 `AUTO_ADVANCE_FAILED`，没有任何重试，父任务永久停在 RUNNING | ✅ | — | 转 KX-05 |

## 3. 复现与证据

### C-01
- 复现：Windows 上 `npm run test:authz`。
- 证据：`prepare-test-database` 报「结构比对未通过」但 diff 为空；手工执行 `npx prisma migrate diff --from-url $TEST_DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code` 退出码 0（No difference detected）；直接 `spawnSync("./node_modules/.bin/prisma")` 返回 status null、`error.code = ENOENT`。
- 修复：新增 `scripts/lib/local-bin.ts`，统一以「当前 node + 包 JS 入口」调用 prisma / tsx；`prepare-test-database.ts`、`verify-migration-replay.ts`、`tests/datetime-format.test.ts` 改用它。

### C-02
- 复现：`node --import tsx --test tests/datetime-format.test.ts`，源码守卫指出 `turn.tsx:172`、`mission-timeline.ts:389`。
- 修复：改用 `src/shared/datetime.ts`（固定 Asia/Shanghai）；「今天 / 昨天」也按业务时区的日期字符串比较。

### C-03
- 复现：逐个检查 `tests/*.ts` 是否出现在 package.json 或 CI 中。
- 处理：可独立运行的纯单元测试已接入两个新脚本；仍未接入的是需要服务器 / 数据库夹具的 `acceptance-gate-boundaries`、`acceptance-professional-analysis`、`regression-professional-analysis-integration`，以及非测试的辅助文件（`authz-matrix.ts`、`test-safety.ts` 等）。前三个列入 KX-03 后续。

### C-04
- 复现：`node --import tsx --test tests/status-labels.test.ts`（守卫 3 / 4 / 8）。
- 修复：`AUDIT_ACTION_LABELS` 补 43 项；新增渠道路线、验证结果、回测对齐、经验候选状态的标签表；桌面任务读模型字段 `action.kind` 更名为 `action.label`（它本来就是展示文案，而不是枚举）。

### C-05 / C-06
- 复现：`npm run test:authz`，1.1 / 1.3 / 1.4 报未登记路由（实际 77 / 基线 71）。
- 修复：6 条路由各按「发起人 / 会话所有人自作用域，其他人 404」登记；新增 brief 消息夹具；矩阵运行器遇到 `text/event-stream` 拿到状态码即断开，避免 SSE 挂死；3 个 POST 改用 `readJsonObjectBody`。

### C-07
- 复现：`npm run test:science`，3.3「挑战报告已持久化」失败；`/tmp/acc-acceptance-science-evidence_test_ts.log` 显示 3.1 / 3.2 通过（确实走了 `advisor.challenge`）。
- 根因：`collaboration-planner` 把「挑战…判断」识别为 RED_TEAM → `decideMissionLaunch` 返回 launch → `service.ts` 用 `kern-brief` 覆盖 citations。
- 修复：`decideMissionLaunch` 对 `CHALLENGE_THESIS` 返回 `DEDICATED_TOOL_ANSWERED`，且在协作模式判断之前。

### C-08
- 复现：Windows 上 `npm run test:science`，1.2「同步创建 2 张」通过但 1.4「库内可取到 2 张」为 0。
- 修复：`scanMarkdownFiles` 返回 POSIX 分隔符。已有的反斜杠记录会在下次同步时按「磁盘上已不存在」软删并以新路径重建，无需迁移。

## 4. 已登记遗留问题复核

| 条目 | 来源 | 结论 |
|---|---|---|
| P1-2 advance 失败无重试 | OPTIMIZATION_PLAN_2026-09-25 | **仍存在**（`workforce/service.ts` 约 1220 行，全仓无 `AUTO_ADVANCE_FAILED` 的消费者）→ KX-05 |
| P1-3 Executive Report 直出 JSON | 同上 | 已修复：`src/components/executive-report.tsx` 结构化渲染，UNKNOWN / 风险独立展示 |
| P2-1 synthesize 用 `find()` 取第一个 QA | 同上 | 已修复：product-rnd 中已无该写法 |
| MQ2 偶发失败 | kern-memory-quota | 本轮通过；保持观察 |
| Worker 常驻（崩溃重启、开机自启等） | KERN_WORKING_MEMORY Beta 验收 | 属运维验收，不是代码缺陷 → 并入 KX-34 |

## 5. 环境说明（不是代码问题）

- **Playwright 浏览器**：仓库依赖 `playwright ^1.63.0`，需要 chromium-1243；本机原来只有 1208–1228。已装到工作区内 `Kern-OS/.pw-browsers`（仓库外，不进 git），跑 UI 类套件和巡检前设置 `PLAYWRIGHT_BROWSERS_PATH`。
- **构建**：验收服务器每次都执行 `next build`（生产模式），本轮多次构建均成功。
- **eslint**：尚未全量跑，放到 KX-03 后续。
