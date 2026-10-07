# Kern 回归复核（HEAD 44f1c00 · 2026-10-01）

口径：对 `docs/mcp-project-status.md`（2026-09-30，HEAD `1d3ffb1`）之后的 4 个提交做回归，确认完成度结论不变。
本页所有结果都是 2026-10-01 在本机实测，不是复述日志。只读验证，未改动任何源码。

## 1. 结论

- **无回退。** 静态检查、单元、契约、数据库、HTTP、浏览器、生产构建七层全部通过。
- **全量扫描 84 通过 / 1 失败 / 2 跳过（共 87 项）**，与 09-30 盘点完全一致；唯一失败项是 `test:model-scenarios`，原因见 §3.5。
- `docs/mcp-project-status.md` 的完成度结论对当前 HEAD 依然成立：任务表 45 / 45，C 线只差「接第一个真实系统」。
- 领先 `main` 现为 **100 个提交**（盘点时 96），仍未推送。

## 2. 覆盖的提交

| 提交 | 内容 | 主要改动文件 |
|---|---|---|
| `a2dd83b` | 完成度盘点 + 全量回归复核 | `docs/mcp-project-status.md` |
| `8ebf4ba` | R-03 意图路由改为「先理解再分流」 | `assistant-runtime/router.ts`、`tests/kern-intent-router.test.ts` |
| `fa3a0f5` | R-04 QA 判 FAIL 进修订轮，契约打回从被点名的上游节点重跑 | `supervisor/plan.ts`、`controls.ts`、`metrics.ts`、`tests/kern-supervisor-plan.test.ts` |
| `44f1c00` | 窗口 B 代跑脚本与结果表；workforce 改走 worker 注册表 | `scripts/kx-window-b.ts`、`workforce/service.ts`、`tests/fixtures/architecture-baseline.json` |

## 3. 结果

### 3.1 静态与单元

| 检查 | 结果 |
|---|---|
| `tsc --noEmit -p .` | 退出码 0，无输出 |
| `eslint . --max-warnings=0` | 退出码 0，无输出 |
| `test:source-guards` | 61 / 61 |
| `test:architecture` | 11 / 11 |
| `test:kern-autonomy` | 16 / 16 |
| `test:regression-units` | 266 / 266（盘点时 263，新增 3 条对应 R-03） |
| `test:delivery-contracts` | 9 个子套件共 119 / 119，与盘点一致 |
| `test:kern-supervisor-plan` | 50 / 50，含 R-04「QA FAIL 进入修订轮」 |

### 3.2 数据库套件（`hermes_test`，127.0.0.1:5432）

| 套件 | 结果 |
|---|---|
| `test:workforce` | 通过（覆盖 `workforce/service.ts` 改动） |
| `test:worker` | 通过（W9 报告落盘，unknowns 9 项、risks 2 项） |
| `test:kern-supervisor` | 通过 |
| `test:kern-mission-controls` | 通过（60 个并发追加后序号 1..149 连续） |

### 3.3 HTTP 与浏览器验收（`scripts/acc-server.sh`）

| 套件 | 结果 | 耗时 |
|---|---|---|
| `test:authz` | 1118 项断言全过 | 75s |
| `test:gate-boundaries-http` | 43 项断言全过 | 48s |
| `test:product-rnd-e2e` | 75 项断言全过 | 44s |
| `test:ui` | 13 项检查全过 | 59s |
| `test:mobile-layout` | 条件态布局通过 | 51s |

浏览器套件使用本机 Chrome（`CHROME_PATH`）。每个套件启动前都因源码比构建产物新而重新构建，验证的是最新代码。

### 3.4 生产构建

`next build`：退出码 0，日志无警告。

### 3.5 全量扫描（`npm run test:sweep`）

设置 `CHROME_PATH` 后整轮约 27 分钟，日志在 `/tmp/pm-test-sweep/`。

| | 数量 |
|---|---|
| 通过 | 84 |
| 失败 | 1（`test:model-scenarios`） |
| 跳过 | 2（`test:critical` 别名、`test:sweep` 自身，脚本设计如此） |

`test:model-scenarios` 这次与 09-30 不同：dev 服务（`:3100`）和 `DATABASE_URL`（5432 `kern_dev`）都通，场景真的跑了，不再是缺前置。

| 场景 | 结果 |
|---|---|
| chat 普通对话 | 通过 |
| chat-knowledge 对话中引用知识库 | 通过 |
| mission 完整任务：简报 → 启动 → 执行 → 结果 | **失败**：结果为 `NEEDS_USER`，`synthesis` 节点 FAILED |
| export 导出 Word / Excel / PPT 并核对 SHA-256 | 通过 |

本轮模型调用 48 次，fallback 0 次，provider 返回 429 共 12 次（重试 12 次），provider 为 agnes（免费）。报告在 `outputs/kx66/2026-09-30T17-21-15/report.md`。

判断（未证实）：429 限流很可能是 `synthesis` 失败的诱因，与窗口 B 记录的「flash 上节点偶发失败」一致；但没有单独复现，不能排除流程缺陷。该场景会向 dev 库写入数据，并真实调用免费模型。

## 4. 已知限制

1. **归属校验偏弱。** Windows 上没有 `lsof`，`acc-server.sh` 日志显示 `listener=未由 lsof 解析`，只能用启动进程、工作目录和 `BUILD_ID` 判断服务归属。端口被并行进程占用时，这一层防护不生效。本次端口空闲，结果可信。
2. **`test:model-scenarios` 的 mission 场景失败原因未定位**，见 §3.5。
3. **GitHub CI 无记录。** 提交未推送，以上结果只证明本机本地提交可用。
4. `tsc` 与 `eslint` 合计约 11 秒，可能命中增量缓存（`tsbuildinfo`）。

## 5. 重跑方法

```bash
npx tsc --noEmit -p .
npx eslint . --max-warnings=0
npm run test:source-guards
npm run test:architecture
npm run test:kern-autonomy
npm run test:regression-units
npm run test:delivery-contracts
npm run test:kern-supervisor-plan
npm run test:workforce
npm run test:worker
npm run test:kern-supervisor
npm run test:kern-mission-controls
npm run test:authz
npm run test:gate-boundaries-http
npm run test:product-rnd-e2e
CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe' npm run test:ui
CHROME_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe' npm run test:mobile-layout
npx next build
```

注意：

- 在 Git Bash 里直接调 `./node_modules/.bin/tsc` 更干净，`npx` 会往输出里混终端标题转义码。
- `git log` 等命令要加 `--no-pager`，否则会卡在分页器上。
- 后台长任务用托管的 `run_command`（`background=true`）并轮询，`nohup ... &` 会随会话结束被杀。

## 6. 下一步

1. 定位 `test:model-scenarios` 的 mission 失败：先看 `outputs/kx66/2026-09-30T17-21-15/report.md`，再换时段或换模型复跑，区分 429 限流与流程缺陷。
2. 按 `docs/mcp-requests.md` 窗口 B 的结论，再跑一轮窗口 B 验证 R-04 修复（`npm run window-b`，会真实调用免费模型并写 `kern_dev` 库）。
3. 按阶段拆 PR（KX-00~05 / 10~26 / 30~41 / 50~66 / 70~74），推送需要用户提供 token。

窗口 A 已在 2026-09-30 关闭（D-12：项目在本地局域网运行，不接外部系统），C 线「接通真实系统」以通用 MCP 连接器 + 凭证层就绪为准，不再挂起。
